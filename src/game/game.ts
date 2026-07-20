import { AudioManager } from './audio'
import {
  GRAV,
  JUMP_V,
  PRACTICE_OBBY,
  fmt,
  levelDefFor,
  levelForSpeed,
  medalTimes,
  nextLevelFor,
  nextMultTier,
  padScale,
  runSpeedFor,
  skinForLevel,
  type MilestoneSkin,
  type MovingPlatformDef,
  type ObbyDef,
} from './levels'
import { getObby } from './generator'
import { makePracticeSegment } from './practice'
import {
  WEEKLY_WIN_REWARD,
  currentWeekKey,
  fmtCountdown,
  makeWeeklyObby,
  msUntilNextWeek,
  weeklyCoinReward,
  weeklyReqLevel,
} from './weekly'
import { checkAchievements } from './achievements'
import { petById, type PetDef, type PetUnlockCtx } from './pets'
import { HATS, TRAILS, CHARM_BONUS, CHARM_MAX, charmPrice } from './shop'
import { storeSave, fmtTime, type GhostSample, type SaveData, type Settings } from './save'

export interface HudState {
  speed: number
  speedText: string
  wins: number
  coins: number
  mult: number
  rebirths: number
  rebirthMult: number
  gain: number
  gainText: string
  level: number
  levelName: string
  levelColor: string
  nextLevelAt: number
  nextLevelText: string
  muted: boolean
  mode: 'hub' | 'obby'
  obbyId: number | null
  obbyName: string | null
  obbyReward: number | null
  obbyTime: number | null
  obbyBest: number | null
  /** medal time goals for the current obby run (null in weekly/practice) */
  obbyGoals: { target: number; stretch: number } | null
  /** medals already earned on the current obby (0–3; null outside normal obbies) */
  obbyMedals: number | null
  practice: { checkpoints: number; segment: number } | null
  readyMult: number | null
  lockedMult: { mult: number; wins: number } | null
  rebirthReady: boolean
  rebirthReqLevel: number
}

export interface ToastEvent {
  icon: string
  title: string
  desc?: string
}

export interface GameCallbacks {
  onHud: (hud: HudState) => void
  onToast: (toast: ToastEvent) => void
  onPauseToggle: () => void
  onPetsToggle: () => void
  onOpenShop: () => void
  onSaveChanged?: () => void
}

const VIEW_W = 1280
const VIEW_H = 720
const TICK_EVERY = 0.4
const PLAYER_R = 26
const REBIRTH_REQ_LEVEL = 5
const MAX_PARTICLES = 650
const COIN_VALUE = 5

// Hub layout
const GROUND_Y = 620
const HUB_SPAWN = { x: 160, y: GROUND_Y }
const TREADMILLS = [
  { x: 340, w: 380 },
  { x: 860, w: 380 },
]
const SHOP_X = 262
const SHRINE_X = 1470
const PRACTICE_X = 1330
const BUTTON_X = 1760
const WEEKLY_X = 1930
const GATE_0_X = 2140
const GATE_STEP = 300
const GROUND_ROW_GATES = 6 // gates 0–5 on the ground, 6+ up on the arcade deck
const DECK_Y = 445

// treadmill rides: conveyor carry + drop-off speed bonus
const CONVEYOR_SPEED = 260 // px/s
const RIDE_BONUS = 25 // × full gain multiplier, awarded once per ride
const RIDE_COOLDOWN = 1 // s before the same treadmill can pay again
/** Passive (grass) tick gains use at most this much of the gain multiplier. */
const GRASS_GAIN_CAP = 3

/**
 * Two-row door arcade: first GROUND_ROW_GATES doors along the ground,
 * further doors on an elevated deck (climbable via steps, jump height is 169px).
 */
function gatePos(index: number): { x: number; y: number } {
  if (index < GROUND_ROW_GATES) return { x: GATE_0_X + index * GATE_STEP, y: GROUND_Y }
  return { x: GATE_0_X + 150 + (index - GROUND_ROW_GATES) * GATE_STEP, y: DECK_Y }
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  grav: number
}

interface FloatText {
  x: number
  y: number
  text: string
  life: number
  color: string
  size: number
}

interface RuntimeMover {
  def: MovingPlatformDef
  cx: number
  cy: number
  px: number
  py: number
}

interface Cloud {
  x: number
  y: number
  s: number
  speed: number
}

interface RuntimeCoin {
  x: number
  y: number
  taken: boolean
}

interface Ring {
  x: number
  y: number
  life: number
}

interface Mote {
  x: number
  y: number
  phase: number
  speed: number
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export class Game {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cb: GameCallbacks
  readonly audio: AudioManager

  private raf = 0
  private lastT = 0
  private time = 0
  private destroyed = false
  private paused = false

  // ---- persisted state ----
  private speed: number
  private wins: number
  private mult: number
  private rebirths: number
  private maxObbyCompleted: number
  private bestTimes: Record<string, number>
  private highestSpeed: number
  private highestLevel: number
  private totalPlayTime: number
  private achievements: Set<string>
  private settings: Settings
  private coins: number
  private equippedPet: string | null
  private ownedHats: string[]
  private equippedHat: string | null
  private ownedTrails: string[]
  private equippedTrail: string
  private charms: number
  private weeklyBest: Record<string, number>
  private ghosts: Record<string, GhostSample[]>
  private medals: Record<string, number>

  // ---- player ----
  private px = HUB_SPAWN.x
  private py = HUB_SPAWN.y
  private pvx = 0
  private pvy = 0
  private grounded = false
  private faceDir = 1
  private squashX = 1
  private squashY = 1
  private coyote = 0
  private jumpBuffer = 0
  private prevLevel: number
  private blink = 0
  private blinkTimer = 2.5

  // ---- pet ----
  private petX = HUB_SPAWN.x - 50
  private petY = HUB_SPAWN.y - 70
  private petVx = 0
  private petVy = 0
  private petTilt = 0
  private dragonSegs: Array<{ x: number; y: number }> = []

  // ---- world ----
  private mode: 'hub' | 'obby' = 'hub'
  private obby: ObbyDef | null = null
  private movers: RuntimeMover[] = []
  private standingMover: RuntimeMover | null = null
  private winTimer = -1
  private deathCooldown = 0
  private obbyStartTime = 0
  private obbyCoins: RuntimeCoin[] = []
  private weeklyMode = false
  private weeklyKey = ''
  private practiceMode = false
  private checkpointsTouched = new Set<number>()
  private practiceRespawn = { x: 0, y: 0 }
  // ghost replay: recording for the current run + playback of the stored best
  private ghostRec: GhostSample[] = []
  private ghostRecTimer = 0
  private ghostPlay: GhostSample[] | null = null
  private ghostIdx = 0
  private ghostFxTimer = 0
  // treadmill rides
  private ridingIdx = -1 // treadmill index currently carrying the player
  private rideCooldown = 0
  // infinite practice: appended segment count + current world end
  private practiceSegments = 0
  private practiceEndX = 0
  private practiceEndY = 620
  private practiceEndShrink = 0

  // ---- ceremony ----
  private ceremonyT = 0
  private flash = 0

  // ---- camera ----
  private camX = 0
  private camY = 0
  private shake = 0
  private zoom = 1

  // ---- fx ----
  private particles: Particle[] = []
  private floats: FloatText[] = []
  private rings: Ring[] = []
  private tickTimer = 0
  private tickChain = 0
  private lastTickAt = -10
  private steamTimer = 0
  private gateFxTimer = 0
  private clouds: Cloud[] = []
  private motes: Mote[] = []

  // ---- input ----
  private keys = new Set<string>()
  private interactQueued = false

  // ---- throttling ----
  private hudTimer = 0
  private saveTimer = 0
  private saveDirty = false

  constructor(canvas: HTMLCanvasElement, save: SaveData, cb: GameCallbacks) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    this.ctx = ctx
    this.cb = cb
    this.speed = save.speed
    this.wins = save.wins
    this.mult = save.mult
    this.rebirths = save.rebirths
    this.maxObbyCompleted = save.maxObbyCompleted
    this.bestTimes = { ...save.bestTimes }
    this.highestSpeed = Math.max(save.highestSpeed, save.speed)
    this.highestLevel = Math.max(save.highestLevel, levelForSpeed(save.speed).level)
    this.totalPlayTime = save.totalPlayTime
    this.achievements = new Set(save.achievements)
    this.settings = { ...save.settings }
    this.coins = save.coins
    this.equippedPet = save.equippedPet
    this.ownedHats = [...save.ownedHats]
    this.equippedHat = save.equippedHat
    this.ownedTrails = [...save.ownedTrails]
    this.equippedTrail = save.equippedTrail
    this.charms = save.charms
    this.weeklyBest = { ...save.weeklyBest }
    this.ghosts = { ...save.ghosts }
    this.medals = { ...save.medals }
    this.audio = new AudioManager(save.muted, this.settings.musicVol, this.settings.sfxVol)
    this.prevLevel = levelForSpeed(this.speed).level
    for (let i = 0; i < 8; i++) {
      this.clouds.push({
        x: Math.random() * 3200,
        y: 40 + Math.random() * 200,
        s: 0.6 + Math.random() * 0.9,
        speed: 8 + Math.random() * 14,
      })
    }
    for (let i = 0; i < 22; i++) {
      this.motes.push({
        x: Math.random() * VIEW_W,
        y: Math.random() * VIEW_H,
        phase: Math.random() * Math.PI * 2,
        speed: 6 + Math.random() * 10,
      })
    }
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('pagehide', this.flushSave)
  }

  start(): void {
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.loop)
    this.emitHud()
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.audio.stopBgm()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('pagehide', this.flushSave)
    this.flushSave()
  }

  // ---------------- public API for React ----------------

  toggleMute(): void {
    this.audio.setMuted(!this.audio.muted)
    this.saveDirty = true
    this.flushSave()
    this.emitHud()
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  updateSettings(settings: Settings): void {
    this.settings = { ...settings }
    this.audio.setMusicVol(settings.musicVol)
    this.audio.setSfxVol(settings.sfxVol)
    this.saveDirty = true
    this.flushSave()
  }

  /** Activate the next per-tick multiplier tier if unlocked. */
  activateMultiplier(): boolean {
    const tier = nextMultTier(this.mult)
    if (!tier || this.wins < tier.wins) {
      this.audio.denied()
      return false
    }
    this.mult = tier.mult
    this.audio.click()
    this.spawnBurst(this.px, this.py - PLAYER_R * 2, '#ff5a5f', 26)
    this.addFloat(this.px, this.py - PLAYER_R * 2 - 20, `+${tier.mult} SPEED!`, '#ff5a5f', 30)
    this.saveDirty = true
    this.flushSave()
    this.emitHud()
    return true
  }

  /** Rebirth: reset speed/level, gain a permanent ×2 speed-gain multiplier. */
  tryRebirth(): boolean {
    if (levelForSpeed(this.speed).level < REBIRTH_REQ_LEVEL) {
      this.audio.denied()
      this.addFloat(this.px, this.py - 90, `Requires Lv ${REBIRTH_REQ_LEVEL}!`, '#e0444a', 22)
      return false
    }
    this.rebirths++
    this.speed = 0
    this.prevLevel = 0
    this.ceremonyT = 2.2
    this.flash = 1
    this.audio.ceremony()
    this.cb.onToast({
      icon: '🌀',
      title: `REBIRTH #${this.rebirths}!`,
      desc: `Permanent ×${Math.pow(2, this.rebirths)} speed gain`,
    })
    const n = Math.round(220 * this.particleMul)
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: this.px + (Math.random() * 1400 - 700),
        y: this.py - 200 - Math.random() * 500,
        vx: Math.random() * 160 - 80,
        vy: Math.random() * 200 - 60,
        life: 0,
        max: 1.6 + Math.random() * 1.2,
        size: 4 + Math.random() * 5,
        color: ['#ff5a5f', '#ffd24a', '#8be06a', '#6cc4ff', '#c084ff', '#ffffff'][i % 6],
        grav: 500,
      })
    }
    this.saveDirty = true
    this.flushSave()
    this.emitHud()
    return true
  }

  exitToHub(): void {
    if (this.mode === 'obby') this.exitObby()
    else {
      this.px = HUB_SPAWN.x
      this.py = HUB_SPAWN.y
      this.pvx = 0
      this.pvy = 0
    }
  }

  // ---- pets ----

  private petCtx(): PetUnlockCtx {
    return {
      wins: this.wins,
      rebirths: this.rebirths,
      highestLevel: this.highestLevel,
      maxObbyCompleted: this.maxObbyCompleted,
      achievements: this.achievements.size,
    }
  }

  equipPet(id: string | null): boolean {
    if (id != null) {
      const def = petById(id)
      if (!def || !def.unlocked(this.petCtx())) {
        this.audio.denied()
        return false
      }
    }
    this.equippedPet = id
    this.audio.click()
    this.saveDirty = true
    this.flushSave()
    return true
  }

  private get petDef(): PetDef | null {
    return petById(this.equippedPet)
  }

  // ---- shop ----

  private spendCoins(cost: number): boolean {
    if (this.coins < cost) {
      this.audio.denied()
      this.cb.onToast({ icon: '🪙', title: 'Not enough coins!', desc: `Need ${cost} 🪙` })
      return false
    }
    this.coins -= cost
    this.audio.click()
    this.saveDirty = true
    return true
  }

  buyHat(id: string): boolean {
    const hat = HATS.find((h) => h.id === id)
    if (!hat || this.ownedHats.includes(id)) return false
    if (!this.spendCoins(hat.price)) return false
    this.ownedHats.push(id)
    this.equippedHat = id
    this.cb.onToast({ icon: hat.icon, title: `${hat.name} equipped!` })
    this.flushSave()
    this.emitHud()
    return true
  }

  equipHat(id: string | null): void {
    if (id != null && !this.ownedHats.includes(id)) return
    this.equippedHat = id
    this.audio.click()
    this.saveDirty = true
    this.flushSave()
  }

  buyTrail(id: string): boolean {
    const trail = TRAILS.find((t) => t.id === id)
    if (!trail || id === 'default' || this.ownedTrails.includes(id)) return false
    if (!this.spendCoins(trail.price)) return false
    this.ownedTrails.push(id)
    this.equippedTrail = id
    this.cb.onToast({ icon: '🌈', title: `${trail.name} trail equipped!` })
    this.flushSave()
    return true
  }

  equipTrail(id: string): void {
    if (id !== 'default' && !this.ownedTrails.includes(id)) return
    this.equippedTrail = id
    this.audio.click()
    this.saveDirty = true
    this.flushSave()
  }

  buyCharm(): boolean {
    if (this.charms >= CHARM_MAX) {
      this.audio.denied()
      return false
    }
    if (!this.spendCoins(charmPrice(this.charms))) return false
    this.charms++
    this.cb.onToast({
      icon: '🧿',
      title: `Speed Charm +${Math.round(CHARM_BONUS * 100)}%!`,
      desc: `${this.charms}/${CHARM_MAX} charms — permanent speed-gain boost`,
    })
    this.flushSave()
    this.emitHud()
    return true
  }

  // ---------------- input ----------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase()
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) {
      e.preventDefault()
    }
    if (k === 'escape') {
      this.cb.onPauseToggle()
      return
    }
    if (k === 'tab' || k === 'p') {
      this.cb.onPetsToggle()
      return
    }
    if (this.paused) return
    if (k === 'm') {
      this.toggleMute()
      return
    }
    if (k === 'e') this.interactQueued = true
    if (k === 'r' && this.mode === 'obby') {
      this.exitObby()
      return
    }
    if (k === ' ' || k === 'w' || k === 'arrowup') this.jumpBuffer = 0.12
    this.keys.add(k)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase())
  }

  private get moveDir(): number {
    const l = this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0
    const r = this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0
    return r - l
  }

  // ---------------- derived ----------------

  private get rebirthMult(): number {
    return Math.pow(2, this.rebirths)
  }

  private get petSpeedMul(): number {
    return 1 + (this.petDef?.speedMul ?? 0)
  }

  private get charmMul(): number {
    return 1 + this.charms * CHARM_BONUS
  }

  private get coinMul(): number {
    return 1 + (this.petDef?.coinMul ?? 0)
  }

  private get jumpMul(): number {
    return 1 + (this.petDef?.jumpMul ?? 0)
  }

  /** Effective per-tick speed gain (float — pets/charms add fractions). */
  private get gainValue(): number {
    return this.mult * this.rebirthMult * this.petSpeedMul * this.charmMul
  }

  private get particleMul(): number {
    return this.settings.particles === 'low' ? 0.35 : 1
  }

  private get gateCount(): number {
    return Math.max(3, this.maxObbyCompleted + 3)
  }

  private get hubWidth(): number {
    const last = gatePos(this.gateCount - 1)
    return Math.max(last.x + 340, WEEKLY_X + 400)
  }

  // ---------------- save / hud ----------------

  private snapshot(): SaveData {
    return {
      speed: Math.floor(this.speed),
      wins: this.wins,
      mult: this.mult,
      muted: this.audio.muted,
      rebirths: this.rebirths,
      maxObbyCompleted: this.maxObbyCompleted,
      bestTimes: { ...this.bestTimes },
      highestSpeed: Math.floor(this.highestSpeed),
      highestLevel: this.highestLevel,
      totalPlayTime: this.totalPlayTime,
      achievements: [...this.achievements],
      settings: { ...this.settings },
      coins: Math.floor(this.coins),
      equippedPet: this.equippedPet,
      ownedHats: [...this.ownedHats],
      equippedHat: this.equippedHat,
      ownedTrails: [...this.ownedTrails],
      equippedTrail: this.equippedTrail,
      charms: this.charms,
      weeklyBest: { ...this.weeklyBest },
      ghosts: { ...this.ghosts },
      medals: { ...this.medals },
    }
  }

  private flushSave = (): void => {
    if (!this.saveDirty) return
    storeSave(this.snapshot())
    this.saveDirty = false
    this.cb.onSaveChanged?.()
  }

  private emitHud(): void {
    const lvl = levelForSpeed(this.speed)
    const next = nextLevelFor(this.speed)
    const tier = nextMultTier(this.mult)
    const g = this.gainValue
    this.cb.onHud({
      speed: Math.floor(this.speed),
      speedText: fmt(this.speed),
      wins: this.wins,
      coins: Math.floor(this.coins),
      mult: this.mult,
      rebirths: this.rebirths,
      rebirthMult: this.rebirthMult,
      gain: g,
      gainText: Number.isInteger(g) ? `${g}` : g.toFixed(1),
      level: lvl.level,
      levelName: lvl.name,
      levelColor: lvl.color,
      nextLevelAt: next.speed,
      nextLevelText: fmt(next.speed),
      muted: this.audio.muted,
      mode: this.mode,
      obbyId: this.obby ? this.obby.id : null,
      obbyName: this.obby ? this.obby.name : null,
      obbyReward: this.obby ? this.obby.reward : null,
      obbyTime: this.mode === 'obby' && this.obby ? this.time - this.obbyStartTime : null,
      obbyBest: this.obby
        ? this.weeklyMode
          ? (this.weeklyBest[this.weeklyKey] ?? null)
          : (this.bestTimes[String(this.obby.id)] ?? null)
        : null,
      practice:
        this.mode === 'obby' && this.practiceMode
          ? { checkpoints: this.checkpointsTouched.size, segment: this.practiceSegments }
          : null,
      obbyGoals:
        this.mode === 'obby' && this.obby && !this.practiceMode && !this.weeklyMode
          ? medalTimes(this.obby)
          : null,
      obbyMedals:
        this.mode === 'obby' && this.obby && !this.practiceMode && !this.weeklyMode
          ? (this.medals[String(this.obby.id)] ?? 0)
          : null,
      readyMult: tier && this.wins >= tier.wins ? tier.mult : null,
      lockedMult: tier && this.wins < tier.wins ? { mult: tier.mult, wins: tier.wins } : null,
      rebirthReady: lvl.level >= REBIRTH_REQ_LEVEL,
      rebirthReqLevel: REBIRTH_REQ_LEVEL,
    })
    this.checkAchievements(lvl.level)
  }

  private checkAchievements(level: number): void {
    const fresh = checkAchievements(
      {
        speed: this.speed,
        wins: this.wins,
        mult: this.mult,
        rebirths: this.rebirths,
        level,
        highestSpeed: this.highestSpeed,
        highestLevel: this.highestLevel,
        maxObbyCompleted: this.maxObbyCompleted,
        totalPlayTime: this.totalPlayTime,
      },
      this.achievements,
    )
    for (const a of fresh) {
      this.achievements.add(a.id)
      this.saveDirty = true
      this.audio.achievement()
      this.cb.onToast({ icon: a.icon, title: `Achievement: ${a.name}`, desc: a.desc })
    }
  }

  // ---------------- world switching ----------------

  /** Obby 1 is always open; obby N requires all 3 medals on obby N-1. */
  private isObbyUnlocked(index: number): boolean {
    if (index === 0) return true
    return (this.medals[String(index)] ?? 0) >= 3
  }

  private enterObby(index: number): void {
    const def = getObby(index + 1)
    if (!this.isObbyUnlocked(index)) {
      this.audio.denied()
      this.shake = Math.max(this.shake, 6)
      this.addFloat(this.px, this.py - 90, `Earn 🥉🥈🥇 on Obby ${index} first!`, '#e0444a', 20)
      return
    }
    this.startObbyRun(def, 'normal', '')
  }

  private enterWeekly(): void {
    const lvl = levelForSpeed(this.speed).level
    const key = currentWeekKey()
    const def = makeWeeklyObby(lvl, key)
    if (lvl < def.reqLevel) {
      this.audio.denied()
      this.addFloat(this.px, this.py - 90, `Requires Lv ${def.reqLevel}!`, '#e0444a', 22)
      return
    }
    this.audio.click()
    this.startObbyRun(def, 'weekly', key)
  }

  private enterPractice(): void {
    this.audio.click()
    this.startObbyRun(PRACTICE_OBBY, 'practice', '')
  }

  private startObbyRun(def: ObbyDef, kind: 'normal' | 'weekly' | 'practice', weekKey: string): void {
    this.mode = 'obby'
    // practice world gets mutated as infinite segments append — work on a clone
    this.obby = kind === 'practice' ? structuredClone(def) : def
    this.weeklyMode = kind === 'weekly'
    this.weeklyKey = weekKey
    this.practiceMode = kind === 'practice'
    this.checkpointsTouched = new Set()
    this.practiceRespawn = { ...def.start }
    this.practiceSegments = 0
    if (kind === 'practice') {
      // world tail: last hand-built platform ends at x=6100 (y=620, static)
      this.practiceEndX = 6100
      this.practiceEndY = 620
      this.practiceEndShrink = 0
    }
    // ghost: record every run (except practice); play back the stored best
    this.ghostRec = []
    this.ghostRecTimer = 0
    this.ghostIdx = 0
    const ghostKey = kind === 'weekly' ? `w:${weekKey}` : String(def.id)
    this.ghostPlay =
      kind !== 'practice' && this.settings.ghost ? (this.ghosts[ghostKey] ?? null) : null
    this.movers = this.obby.movers.map((m) => ({ def: m, cx: m.x, cy: m.y, px: m.x, py: m.y }))
    this.obbyCoins = this.obby.coins.map((c) => ({ ...c, taken: false }))
    this.px = def.start.x
    this.py = def.start.y
    this.pvx = 0
    this.pvy = 0
    this.obbyStartTime = this.time
    this.camX = clamp(this.px - VIEW_W / 2, -200, def.width - VIEW_W + 200)
    this.camY = 0
    this.audio.portal()
    this.emitHud()
  }

  private exitObby(): void {
    this.mode = 'hub'
    this.obby = null
    this.weeklyMode = false
    this.weeklyKey = ''
    this.practiceMode = false
    this.ghostPlay = null
    this.ghostRec = []
    this.movers = []
    this.obbyCoins = []
    this.standingMover = null
    this.winTimer = -1
    this.px = HUB_SPAWN.x
    this.py = HUB_SPAWN.y
    this.pvx = 0
    this.pvy = 0
    this.audio.portal()
    this.emitHud()
  }

  /** Infinite practice: append the next seeded segment (checkpoint at its start). */
  private extendPractice(): void {
    const def = this.obby
    if (!def || !this.practiceMode) return
    this.practiceSegments++
    const seg = makePracticeSegment(
      this.practiceSegments,
      this.practiceEndX,
      this.practiceEndY,
      this.practiceEndShrink,
    )
    def.platforms.push(...seg.platforms)
    def.pads.push(...seg.pads)
    def.movers.push(...seg.movers)
    this.movers.push(...seg.movers.map((m) => ({ def: m, cx: m.x, cy: m.y, px: m.x, py: m.y })))
    // insert spikes before the trailing lava sheet, then stretch the lava
    def.hazards.splice(def.hazards.length - 1, 0, ...seg.hazards)
    def.checkpoints = def.checkpoints ?? []
    def.checkpoints.push(seg.checkpoint)
    def.labels = def.labels ?? []
    def.labels.push({ x: seg.checkpoint.x, y: 480, text: `SEGMENT ${this.practiceSegments}` })
    this.practiceEndX = seg.endX
    this.practiceEndY = seg.endY
    this.practiceEndShrink = seg.endShrink
    def.width = seg.endX + 500
    const lava = def.hazards[def.hazards.length - 1]
    if (lava.type === 'lava') lava.w = def.width + 800
    this.emitHud()
  }

  private completeObby(): void {
    if (!this.obby) return
    const runTime = this.time - this.obbyStartTime

    if (this.weeklyMode) {
      // Weekly Challenge: coin payout (+ small fixed wins), weekly best-time record
      const lvl = levelForSpeed(this.speed).level
      const firstThisWeek = this.weeklyBest[this.weeklyKey] == null
      const payout = Math.round(weeklyCoinReward(lvl, firstThisWeek) * this.coinMul)
      this.wins += WEEKLY_WIN_REWARD
      this.coins += payout
      this.saveDirty = true
      this.audio.win()
      this.addFloat(this.px, this.py - 110, `+${payout} 🪙`, '#ffd24a', 32)
      this.addFloat(this.px, this.py - 80, `+${WEEKLY_WIN_REWARD} WINS 🏆`, '#ffb400', 22)
      const prevBest = this.weeklyBest[this.weeklyKey]
      if (prevBest == null || runTime < prevBest) {
        this.weeklyBest[this.weeklyKey] = runTime
        // Keep the ghost for this week's best run; prune ghosts from past weeks
        this.ghosts[`w:${this.weeklyKey}`] = [...this.ghostRec]
        for (const k of Object.keys(this.ghosts)) {
          if (k.startsWith('w:') && k !== `w:${this.weeklyKey}`) delete this.ghosts[k]
        }
        this.saveDirty = true
        if (prevBest != null) {
          this.audio.record()
          this.addFloat(this.px, this.py - 150, 'NEW RECORD!', '#ffd24a', 26)
        }
        this.cb.onToast({
          icon: '⭐',
          title: prevBest != null ? 'NEW WEEKLY RECORD!' : 'Weekly Challenge complete!',
          desc: `${this.weeklyKey} — ${fmtTime(runTime)}${firstThisWeek ? ` · +${payout} 🪙 bonus` : ''}`,
        })
      }
      this.winConfetti()
      this.winTimer = 1.4
      this.emitHud()
      return
    }

    const id = this.obby.id
    const reward = this.obby.reward
    this.wins += reward
    const coinBonus = Math.round((4 + 2 * id) * this.coinMul)
    this.coins += coinBonus
    this.saveDirty = true
    this.audio.win()
    this.addFloat(this.px, this.py - 110, `+${reward} WIN${reward > 1 ? 'S' : ''}! 🏆`, '#ffb400', 34)
    this.addFloat(this.px, this.py - 80, `+${coinBonus} 🪙`, '#ffd24a', 22)

    const key = String(id)
    const prevBest = this.bestTimes[key]
    if (prevBest == null || runTime < prevBest) {
      this.bestTimes[key] = runTime
      this.ghosts[key] = [...this.ghostRec]
      this.saveDirty = true
      if (prevBest != null) {
        this.audio.record()
        this.addFloat(this.px, this.py - 150, 'NEW RECORD!', '#ffd24a', 26)
        this.cb.onToast({
          icon: '⏱️',
          title: 'NEW RECORD!',
          desc: `${this.obby.name} — ${fmtTime(runTime)} (was ${fmtTime(prevBest)})`,
        })
      }
    }

    // Medals: 🥉 finish · 🥈 under target · 🥇 under stretch (one-time each)
    const goals = medalTimes(this.obby)
    const earnedNow =
      1 + (runTime <= goals.target ? 1 : 0) + (runTime <= goals.stretch ? 1 : 0)
    const prevMedals = this.medals[key] ?? 0
    const newMedals = Math.max(0, Math.min(3, earnedNow) - prevMedals)
    if (newMedals > 0) {
      this.medals[key] = Math.min(3, earnedNow)
      this.wins += newMedals
      this.saveDirty = true
      this.audio.record()
      const icons = ['🥉', '🥈', '🥇']
      const names = ['BRONZE', 'SILVER', 'GOLD']
      for (let m = prevMedals; m < prevMedals + newMedals; m++) {
        this.addFloat(this.px, this.py - 140 - (m - prevMedals) * 30, `${icons[m]} ${names[m]} MEDAL +1 🏆`, '#ffd24a', 26)
      }
      this.cb.onToast({
        icon: icons[this.medals[key] - 1],
        title: `${names[this.medals[key] - 1]} medal earned!`,
        desc: `${this.obby.name} — ${this.medals[key]}/3 medals${this.medals[key] >= 3 ? ' · next obby unlocked!' : ''}`,
      })
    }
    // Frontier unlock: 3 medals on this obby opens the next door
    if ((this.medals[key] ?? 0) >= 3 && id === this.maxObbyCompleted) {
      const gp = gatePos(id)
      this.spawnBurst(gp.x, gp.y - 80, '#ffd24a', 40)
    }

    if (id >= this.maxObbyCompleted) {
      this.maxObbyCompleted = id
      const gp = gatePos(id)
      this.spawnBurst(gp.x, gp.y - 80, '#ffd24a', 40)
      this.cb.onToast({ icon: '🔓', title: `Obby ${id + 1} gate revealed!`, desc: 'Earn all 🥉🥈🥇 here to unlock it' })
    }

    this.winConfetti()
    this.winTimer = 1.4
    this.emitHud()
  }

  private winConfetti(): void {
    const n = Math.round(90 * this.particleMul)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 150 + Math.random() * 420
      this.pushParticle({
        x: this.px,
        y: this.py - 40,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 260,
        life: 0,
        max: 1.2 + Math.random() * 0.8,
        size: 4 + Math.random() * 5,
        color: ['#ff5a5f', '#ffd24a', '#8be06a', '#6cc4ff', '#c084ff'][i % 5],
        grav: 700,
      })
    }
  }

  private die(): void {
    if (this.deathCooldown > 0) return
    this.deathCooldown = 0.5
    this.audio.death()
    this.shake = 18
    this.spawnBurst(this.px, this.py - PLAYER_R, '#ffffff', 18)
    const spawn =
      this.mode === 'obby' && this.practiceMode
        ? this.practiceRespawn
        : this.mode === 'obby' && this.obby
          ? this.obby.start
          : HUB_SPAWN
    this.px = spawn.x
    this.py = spawn.y
    this.pvx = 0
    this.pvy = 0
    this.standingMover = null
  }

  // ---------------- fx helpers ----------------

  private addFloat(x: number, y: number, text: string, color: string, size = 20): void {
    this.floats.push({ x, y, text, life: 0, color, size })
  }

  private pushParticle(p: Particle): void {
    this.particles.push(p)
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES)
    }
  }

  private spawnBurst(x: number, y: number, color: string, n: number): void {
    const count = Math.round(n * this.particleMul)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 100 + Math.random() * 300
      this.pushParticle({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 120,
        life: 0,
        max: 0.5 + Math.random() * 0.5,
        size: 2 + Math.random() * 3.5,
        color,
        grav: 350,
      })
    }
  }

  private levelUpCheck(): void {
    const lvl = levelForSpeed(this.speed)
    if (lvl.level > this.prevLevel) {
      this.prevLevel = lvl.level
      this.highestLevel = Math.max(this.highestLevel, lvl.level)
      this.audio.levelUp()
      this.spawnBurst(this.px, this.py - PLAYER_R, lvl.color, 34)
      this.addFloat(this.px, this.py - 100, `LEVEL ${lvl.level}!`, lvl.color, 32)
      if (skinForLevel(lvl.level) && lvl.level === 5) {
        this.cb.onToast({ icon: '✨', title: 'Milestone skin: Sparkle Aura!', desc: 'Reach Lv 10 for the Flame Trail' })
      }
      this.emitHud()
    }
  }

  // ---------------- update ----------------

  private loop = (t: number): void => {
    if (this.destroyed) return
    const rawDt = clamp((t - this.lastT) / 1000, 0, 1 / 30)
    this.lastT = t
    let dt = rawDt
    if (this.ceremonyT > 0) {
      this.ceremonyT = Math.max(0, this.ceremonyT - rawDt)
      dt = rawDt * (0.2 + 0.8 * (1 - this.ceremonyT / 2.2))
    }
    this.flash = Math.max(0, this.flash - rawDt * 0.7)
    this.time += dt
    if (!this.paused) this.update(dt)
    this.render()
    this.raf = requestAnimationFrame(this.loop)
  }

  private update(dt: number): void {
    this.deathCooldown = Math.max(0, this.deathCooldown - dt)
    this.shake = Math.max(0, this.shake - dt * 30)
    this.totalPlayTime += dt
    this.saveDirty = true

    // blink cycle
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) {
      this.blink = 0.12
      this.blinkTimer = 2.5 + Math.random() * 3
    }
    this.blink = Math.max(0, this.blink - dt)

    // movers
    for (const m of this.movers) {
      m.px = m.cx
      m.py = m.cy
      const s = Math.sin(this.time * m.def.speed + (m.def.phase ?? 0)) * m.def.range
      m.cx = m.def.axis === 'x' ? m.def.x + s : m.def.x
      m.cy = m.def.axis === 'y' ? m.def.y + s : m.def.y
    }
    if (this.standingMover) {
      this.px += this.standingMover.cx - this.standingMover.px
      this.py += this.standingMover.cy - this.standingMover.py
    }

    if (this.winTimer > 0) {
      this.winTimer -= dt
      this.pvx = 0
      if (this.winTimer <= 0) this.exitObby()
    } else {
      this.updatePlayer(dt)
    }

    this.updatePet(dt)
    this.updateFx(dt)
    this.updateCamera(dt)

    // treadmill rides: stand on a belt and it carries you to the end,
    // where it pays +RIDE_BONUS × full gain multiplier (once per ride)
    if (this.mode === 'hub') {
      this.rideCooldown = Math.max(0, this.rideCooldown - dt)
      const beltIdx = this.treadmillIndex()
      if (this.ridingIdx >= 0 && (!this.grounded || beltIdx < 0)) {
        this.ridingIdx = -1 // jumped off mid-ride: no bonus, can re-step later
      }
      if (this.ridingIdx < 0 && beltIdx >= 0 && this.grounded && this.rideCooldown <= 0) {
        this.ridingIdx = beltIdx
        this.addFloat(this.px, this.py - PLAYER_R * 2 - 10, '🎢 riding!', '#6cc4ff', 16)
      }
      if (this.ridingIdx >= 0) {
        const belt = TREADMILLS[this.ridingIdx]
        this.px += CONVEYOR_SPEED * dt
        // riding sparkles
        if (Math.random() < 14 * dt * this.particleMul) {
          this.pushParticle({
            x: this.px + (Math.random() * 40 - 20),
            y: this.py - Math.random() * PLAYER_R * 2,
            vx: -40 - Math.random() * 40,
            vy: -20 - Math.random() * 30,
            life: 0,
            max: 0.5,
            size: 2.5 + Math.random() * 2.5,
            color: Math.random() < 0.5 ? '#aee9ff' : '#fff7ae',
            grav: 0,
          })
        }
        if (this.px >= belt.x + belt.w + 2) {
          // drop-off: pay the ride bonus at the FULL multiplier
          const bonus = Math.round(RIDE_BONUS * this.gainValue)
          this.speed += bonus
          this.highestSpeed = Math.max(this.highestSpeed, this.speed)
          this.saveDirty = true
          this.audio.whoosh()
          this.addFloat(this.px, this.py - PLAYER_R * 2 - 16, `+${fmt(bonus)} ⚡`, '#2f9e44', 30)
          this.spawnBurst(this.px, this.py - PLAYER_R, '#aee9ff', 14)
          this.ridingIdx = -1
          this.rideCooldown = RIDE_COOLDOWN
          this.levelUpCheck()
          this.emitHud()
        }
      }
    } else {
      this.ridingIdx = -1
    }

    // grass running ticks — passive gain capped at ×GRASS_GAIN_CAP of the
    // multiplier (rides + medals are the fast path now)
    const pet = this.petDef
    const autoTick =
      pet?.autoTickRadius != null &&
      Math.abs(this.py - GROUND_Y) < 170 &&
      TREADMILLS.some((t) => Math.abs(this.px - (t.x + t.w / 2)) < pet.autoTickRadius!)
    const manualTick = !this.onTreadmill() && this.moveDir !== 0
    if (this.mode === 'hub' && this.grounded && (manualTick || autoTick)) {
      this.tickTimer += dt
      if (this.tickTimer >= TICK_EVERY) {
        this.tickTimer -= TICK_EVERY
        const g = Math.min(this.gainValue, GRASS_GAIN_CAP)
        this.speed += g
        this.highestSpeed = Math.max(this.highestSpeed, this.speed)
        this.saveDirty = true
        this.audio.tick()
        // combo pop
        this.tickChain = this.time - this.lastTickAt < 1.2 ? this.tickChain + 1 : 1
        this.lastTickAt = this.time
        const size = 22 + Math.min(this.tickChain, 8) * 2.5
        const gainTxt = Number.isInteger(g) ? `${g}` : g.toFixed(1)
        this.addFloat(
          this.px + (Math.random() * 30 - 15),
          this.py - PLAYER_R * 2 - 8,
          this.tickChain >= 3 ? `+${gainTxt} ×${this.tickChain}` : `+${gainTxt}`,
          '#2f9e44',
          size,
        )
        this.levelUpCheck()
      }
      this.steamTimer += dt
      if (this.steamTimer > 0.18 / this.particleMul) {
        this.steamTimer = 0
        this.pushParticle({
          x: this.px + (Math.random() * 16 - 8),
          y: this.py - PLAYER_R * 2,
          vx: Math.random() * 20 - 10,
          vy: -60 - Math.random() * 40,
          life: 0,
          max: 0.9,
          size: 5 + Math.random() * 5,
          color: 'rgba(255,255,255,0.85)',
          grav: -40,
        })
      }
    } else {
      this.tickTimer = 0
      this.tickChain = 0
    }

    // gate portal ambience
    this.gateFxTimer += dt
    if (this.mode === 'hub' && this.gateFxTimer > 0.14 && Math.random() < this.particleMul) {
      this.gateFxTimer = 0
      const i = Math.floor(Math.random() * this.gateCount)
      const gp = gatePos(i)
      this.pushParticle({
        x: gp.x + (Math.random() * 60 - 30),
        y: gp.y - Math.random() * 130 - 10,
        vx: Math.random() * 20 - 10,
        vy: -30 - Math.random() * 30,
        life: 0,
        max: 0.8,
        size: 2 + Math.random() * 2,
        color: levelDefFor(getObby(i + 1).reqLevel).color,
        grav: -30,
      })
    }

    if (this.interactQueued) {
      this.interactQueued = false
      this.tryInteract()
    }

    this.hudTimer += dt
    if (this.hudTimer > 0.12) {
      this.hudTimer = 0
      this.emitHud()
    }
    this.saveTimer += dt
    if (this.saveTimer > 2) {
      this.saveTimer = 0
      this.flushSave()
    }
  }

  private onTreadmill(): boolean {
    return this.treadmillIndex() >= 0
  }

  /** Index of the treadmill the player is standing on (hub ground only). */
  private treadmillIndex(): number {
    if (this.mode !== 'hub' || Math.abs(this.py - GROUND_Y) > 4) return -1
    return TREADMILLS.findIndex((t) => this.px > t.x && this.px < t.x + t.w)
  }

  private tryInteract(): void {
    if (this.mode !== 'hub') return
    if (Math.abs(this.px - SHOP_X) < 80) {
      this.cb.onOpenShop()
      return
    }
    if (Math.abs(this.px - SHRINE_X) < 70) {
      this.tryRebirth()
      return
    }
    if (Math.abs(this.px - BUTTON_X) < 70) {
      this.activateMultiplier()
      return
    }
    if (Math.abs(this.px - PRACTICE_X) < 60 && Math.abs(this.py - GROUND_Y) < 60) {
      this.enterPractice()
      return
    }
    if (Math.abs(this.px - WEEKLY_X) < 80 && Math.abs(this.py - GROUND_Y) < 60) {
      this.enterWeekly()
      return
    }
    for (let i = 0; i < this.gateCount; i++) {
      const gp = gatePos(i)
      if (Math.abs(this.px - gp.x) < 80 && Math.abs(this.py - gp.y) < 110) {
        this.enterObby(i)
        return
      }
    }
  }

  private updatePlayer(dt: number): void {
    const runSpeed = runSpeedFor(this.speed)
    const dir = this.moveDir
    const target = dir * runSpeed
    const accel = this.grounded ? 3000 : 1900
    if (this.pvx < target) this.pvx = Math.min(target, this.pvx + accel * dt)
    else if (this.pvx > target) this.pvx = Math.max(target, this.pvx - accel * dt)
    if (dir !== 0) this.faceDir = dir

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt)
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.jumpBuffer = 0
      this.coyote = 0
      this.pvy = -JUMP_V * this.jumpMul
      this.grounded = false
      this.standingMover = null
      this.audio.jump()
      this.squashX = 0.75
      this.squashY = 1.3
    }

    const wasGrounded = this.grounded
    const prevBottom = this.py
    this.pvy = Math.min(1500, this.pvy + GRAV * dt)
    this.px += this.pvx * dt
    this.py += this.pvy * dt

    this.grounded = false
    let landedMover: RuntimeMover | null = null
    const surfaces = this.currentSurfaces()
    for (const s of surfaces) {
      const overlapX = this.px + PLAYER_R * 0.7 > s.x && this.px - PLAYER_R * 0.7 < s.x + s.w
      if (!overlapX) continue
      if (this.pvy >= 0 && prevBottom <= s.y + 8 && this.py >= s.y) {
        this.py = s.y
        this.pvy = 0
        this.grounded = true
        landedMover = s.mover
      }
    }
    this.standingMover = landedMover

    if (!wasGrounded && this.grounded) {
      this.audio.land()
      this.squashX = 1.35
      this.squashY = 0.65
      this.rings.push({ x: this.px, y: this.py, life: 0 })
      if (Math.random() < this.particleMul) {
        for (let i = 0; i < 6; i++) {
          this.pushParticle({
            x: this.px + (Math.random() * 30 - 15),
            y: this.py,
            vx: Math.random() * 120 - 60,
            vy: -30 - Math.random() * 60,
            life: 0,
            max: 0.4,
            size: 3,
            color: 'rgba(190,160,120,0.7)',
            grav: 400,
          })
        }
      }
    }

    const k = 1 - Math.exp(-10 * dt)
    this.squashX = lerp(this.squashX, 1, k)
    this.squashY = lerp(this.squashY, 1, k)
    if (!this.grounded) {
      const st = clamp(Math.abs(this.pvy) / 1600, 0, 0.28)
      this.squashY = 1 + st
      this.squashX = 1 - st * 0.6
    }

    const worldW = this.mode === 'hub' ? this.hubWidth : (this.obby?.width ?? this.hubWidth)
    this.px = clamp(this.px, -300, worldW + 100)

    if (this.mode === 'obby' && this.obby) {
      for (const hz of this.obby.hazards) {
        if (
          this.px + PLAYER_R * 0.6 > hz.x &&
          this.px - PLAYER_R * 0.6 < hz.x + hz.w &&
          this.py > hz.y + 4 &&
          this.py - PLAYER_R * 1.6 < hz.y + hz.h
        ) {
          this.die()
          break
        }
      }
      if (this.py > 1000) this.die()

      // coin pickups (with a friendly magnet radius)
      for (const c of this.obbyCoins) {
        if (c.taken) continue
        const dx = c.x - this.px
        const dy = c.y - (this.py - PLAYER_R)
        if (dx * dx + dy * dy < 44 * 44) {
          c.taken = true
          const value = Math.round(COIN_VALUE * this.coinMul)
          this.coins += value
          this.saveDirty = true
          this.audio.coin()
          this.addFloat(c.x, c.y - 16, `+${value} 🪙`, '#ffd24a', 18)
          this.spawnBurst(c.x, c.y, '#ffd24a', 8)
        }
      }
    }

    if (this.mode === 'obby' && this.obby && this.winTimer < 0) {
      // practice never ends: no trophy, just ever more segments
      const t = this.obby.trophy
      if (!this.practiceMode && Math.abs(this.px - t.x) < 42 && Math.abs(this.py - t.y) < 80) {
        this.completeObby()
      }

      // Infinite practice: append the next seeded segment before the tail
      if (this.practiceMode && this.px > this.obby.width - 900) {
        this.extendPractice()
      }

      // Ghost recording (10 Hz) — skipped in practice mode
      if (!this.practiceMode && this.ghostRec.length < 3000) {
        this.ghostRecTimer += dt
        while (this.ghostRecTimer >= 0.1 && this.ghostRec.length < 3000) {
          this.ghostRecTimer -= 0.1
          this.ghostRec.push([
            Math.round((this.time - this.obbyStartTime) * 10) / 10,
            Math.round(this.px),
            Math.round(this.py),
            this.faceDir,
            this.grounded ? 0 : 1,
          ])
        }
        if (this.ghostRec.length >= 3000) this.ghostRecTimer = 0
      }

      // Practice checkpoints
      if (this.practiceMode && this.obby.checkpoints) {
        for (let i = 0; i < this.obby.checkpoints.length; i++) {
          if (this.checkpointsTouched.has(i)) continue
          const c = this.obby.checkpoints[i]
          if (Math.abs(this.px - c.x) < 50 && Math.abs(this.py - c.y) < 60) {
            this.checkpointsTouched.add(i)
            this.practiceRespawn = { x: c.x, y: c.y }
            this.audio.coin()
            this.addFloat(this.px, this.py - 60, 'CHECKPOINT!', '#4ade80', 22)
            this.emitHud()
          }
        }
      }
    }

    // speed trail (color from equipped trail pack or level color)
    const spd = Math.abs(this.pvx)
    if (spd > 320) {
      const rate = ((spd - 320) / 1800) * 90 * this.particleMul
      if (Math.random() < rate * dt) {
        const lvl = levelForSpeed(this.speed)
        const trail = TRAILS.find((t) => t.id === this.equippedTrail)
        const color =
          trail && trail.colors.length > 0
            ? trail.colors[Math.floor(Math.random() * trail.colors.length)]
            : lvl.level > 0
              ? lvl.color
              : 'rgba(255,220,180,0.8)'
        this.pushParticle({
          x: this.px - this.faceDir * PLAYER_R * 0.8,
          y: this.py - PLAYER_R + Math.random() * 20 - 10,
          vx: -this.faceDir * (40 + Math.random() * 60),
          vy: Math.random() * 30 - 15,
          life: 0,
          max: 0.35 + Math.random() * 0.2,
          size: 3 + Math.random() * 4,
          color,
          grav: 0,
        })
      }
    }

    // milestone skin ambient effects
    const skin = skinForLevel(levelForSpeed(this.speed).level)
    if (skin === 'sparkle' && Math.random() < 8 * dt * this.particleMul) {
      const a = Math.random() * Math.PI * 2
      this.pushParticle({
        x: this.px + Math.cos(a) * (PLAYER_R + 12),
        y: this.py - PLAYER_R + Math.sin(a) * (PLAYER_R + 12),
        vx: 0,
        vy: -20,
        life: 0,
        max: 0.7,
        size: 2.5,
        color: '#fff7ae',
        grav: 0,
      })
    }
    if (skin === 'flame' && spd > 300 && Math.random() < 60 * dt * this.particleMul) {
      this.pushParticle({
        x: this.px - this.faceDir * PLAYER_R,
        y: this.py - PLAYER_R + Math.random() * 16 - 8,
        vx: -this.faceDir * (80 + Math.random() * 60),
        vy: -40 - Math.random() * 60,
        life: 0,
        max: 0.4,
        size: 4 + Math.random() * 4,
        color: Math.random() < 0.5 ? '#ff9a3c' : '#ff5a3c',
        grav: -120,
      })
    }
    if (skin === 'galaxy' && Math.random() < 6 * dt * this.particleMul) {
      this.pushParticle({
        x: this.px + (Math.random() * 80 - 40),
        y: this.py - PLAYER_R + (Math.random() * 80 - 40),
        vx: 0,
        vy: -14,
        life: 0,
        max: 1,
        size: 1.8,
        color: '#cfe6ff',
        grav: 0,
      })
    }
  }

  // ---------------- pet ----------------

  private updatePet(dt: number): void {
    const pet = this.petDef
    if (!pet) return
    // springy follow anchor: behind + above the player with a gentle bob
    const ax = this.px - this.faceDir * 52
    const ay = this.py - 68 + Math.sin(this.time * 3.2) * 5
    const k = 60
    const d = 10
    this.petVx += ((ax - this.petX) * k - this.petVx * d) * dt
    this.petVy += ((ay - this.petY) * k - this.petVy * d) * dt
    this.petX += this.petVx * dt
    this.petY += this.petVy * dt
    this.petTilt = lerp(this.petTilt, clamp(this.petVx * 0.004, -0.5, 0.5), 1 - Math.exp(-8 * dt))

    if (pet.id === 'dragon') {
      // chain of body segments following the head
      while (this.dragonSegs.length < 4) {
        this.dragonSegs.push({ x: this.petX, y: this.petY })
      }
      let px = this.petX
      let py = this.petY
      const chase = 1 - Math.exp(-14 * dt)
      for (const seg of this.dragonSegs) {
        seg.x += (px - seg.x) * chase
        seg.y += (py - seg.y) * chase
        const dx = seg.x - px
        const dy = seg.y - py
        const dist = Math.hypot(dx, dy)
        if (dist > 20) {
          seg.x = px + (dx / dist) * 20
          seg.y = py + (dy / dist) * 20
        }
        px = seg.x
        py = seg.y
      }
    }
  }

  private currentSurfaces(): Array<{ x: number; y: number; w: number; mover: RuntimeMover | null }> {
    if (this.mode === 'hub') {
      return [
        { x: -400, y: GROUND_Y, w: this.hubWidth + 800, mover: null },
        // arcade deck + climb steps (jump height is 169px)
        { x: GATE_0_X - 100, y: DECK_Y, w: this.hubWidth - GATE_0_X + 200, mover: null },
        { x: GATE_0_X - 180, y: GROUND_Y - 75, w: 80, mover: null },
        { x: GATE_0_X - 140, y: GROUND_Y - 150, w: 80, mover: null },
      ]
    }
    const def = this.obby
    if (!def) return []
    const out: Array<{ x: number; y: number; w: number; mover: RuntimeMover | null }> = []
    for (const p of def.platforms) out.push({ x: p.x, y: p.y, w: p.w, mover: null })
    // breathing pads: collision follows the animated width (center-anchored)
    for (const pad of def.pads) {
      const w = pad.w * padScale(pad, this.time)
      const cx = pad.x + pad.w / 2
      out.push({ x: cx - w / 2, y: pad.y, w, mover: null })
    }
    for (const m of this.movers) out.push({ x: m.cx, y: m.cy, w: m.def.w, mover: m })
    return out
  }

  /** Highest surface below (or at) a point, for soft drop shadows. */
  private surfaceBelow(x: number, y: number): number | null {
    let best: number | null = null
    for (const s of this.currentSurfaces()) {
      if (x > s.x - 10 && x < s.x + s.w + 10 && s.y >= y - 2) {
        if (best == null || s.y < best) best = s.y
      }
    }
    return best
  }

  private updateFx(dt: number): void {
    for (const p of this.particles) {
      p.life += dt
      p.vy += p.grav * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    this.particles = this.particles.filter((p) => p.life < p.max)
    for (const f of this.floats) {
      f.life += dt
      f.y -= 55 * dt
    }
    this.floats = this.floats.filter((f) => f.life < 1.1)
    for (const r of this.rings) r.life += dt
    this.rings = this.rings.filter((r) => r.life < 0.45)
    for (const c of this.clouds) {
      c.x += c.speed * dt
      if (c.x > 3400) c.x = -300
    }
    for (const m of this.motes) {
      m.x += Math.sin(this.time * 0.5 + m.phase) * m.speed * dt
      m.y += Math.cos(this.time * 0.4 + m.phase * 1.3) * m.speed * 0.6 * dt - 2 * dt
      if (m.y < -20) m.y = VIEW_H + 20
      if (m.x < -20) m.x = VIEW_W + 20
      if (m.x > VIEW_W + 20) m.x = -20
    }
  }

  private updateCamera(dt: number): void {
    const worldW = this.mode === 'hub' ? this.hubWidth : (this.obby?.width ?? this.hubWidth)
    const look = clamp(this.pvx * 0.25, -170, 170)
    const targetX = clamp(this.px + look - VIEW_W / 2, -220, worldW - VIEW_W + 220)
    const targetY = clamp(this.py - 500, -60, 160)
    const k = 1 - Math.exp(-6 * dt)
    this.camX = lerp(this.camX, targetX, k)
    this.camY = lerp(this.camY, targetY, k)
    // subtle zoom-out at high speed
    const targetZoom = 1 - clamp((Math.abs(this.pvx) - 800) / 2400, 0, 0.16)
    this.zoom = lerp(this.zoom, targetZoom, 1 - Math.exp(-3 * dt))
  }

  // ---------------- render ----------------

  private render(): void {
    const ctx = this.ctx
    const dpr = window.devicePixelRatio || 1
    const cw = this.canvas.clientWidth
    const ch = this.canvas.clientHeight
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr)
      this.canvas.height = Math.round(ch * dpr)
    }
    const scale = Math.min(this.canvas.width / VIEW_W, this.canvas.height / VIEW_H)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    const ox = (this.canvas.width / scale - VIEW_W) / 2
    const oy = (this.canvas.height / scale - VIEW_H) / 2
    ctx.translate(ox, oy)

    const skyTop = this.obby ? this.obby.skyTop : '#ffd9a8'
    const skyBot = this.obby ? this.obby.skyBottom : '#ffeef4'
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H)
    grad.addColorStop(0, skyTop)
    grad.addColorStop(1, skyBot)
    ctx.fillStyle = grad
    ctx.fillRect(-ox, -oy, VIEW_W + ox * 2, VIEW_H + oy * 2)

    this.renderParallax(ctx)
    this.renderGodRays(ctx)

    // subtle warm day-cycle tint
    ctx.fillStyle = `rgba(255,170,90,${0.05 + 0.04 * Math.sin(this.time * 0.07)})`
    ctx.fillRect(-ox, -oy, VIEW_W + ox * 2, VIEW_H + oy * 2)

    // speed-sensitive zoom around screen center
    ctx.save()
    ctx.translate(VIEW_W / 2, VIEW_H / 2)
    ctx.scale(this.zoom, this.zoom)
    ctx.translate(-VIEW_W / 2, -VIEW_H / 2)

    const shakeMag = this.settings.shake ? this.shake : 0
    const shakeX = shakeMag > 0 ? (Math.random() - 0.5) * shakeMag : 0
    const shakeY = shakeMag > 0 ? (Math.random() - 0.5) * shakeMag : 0
    ctx.translate(-this.camX + shakeX, -this.camY + shakeY)

    if (this.mode === 'hub') this.renderHub(ctx)
    else this.renderObby(ctx)

    this.renderShadow(ctx, this.px, this.py, PLAYER_R)
    if (this.petDef) {
      this.renderShadow(ctx, this.petX, this.petY + 24, 12)
      this.renderPet(ctx)
    }
    this.renderRings(ctx)
    this.renderParticles(ctx)
    this.renderPlayer(ctx)
    this.renderFloats(ctx)

    ctx.restore()

    // dust motes drift in near-screen space
    ctx.save()
    for (const m of this.motes) {
      const tw = 0.25 + 0.2 * Math.sin(this.time * 1.4 + m.phase * 2)
      ctx.globalAlpha = tw * this.particleMul
      ctx.fillStyle = '#fff8e0'
      ctx.beginPath()
      ctx.arc(m.x, m.y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    // speed lines at very high speed (screen space)
    const spd = Math.abs(this.pvx)
    if (spd > 1300) {
      const alpha = clamp((spd - 1300) / 900, 0, 0.32)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      const cx = VIEW_W / 2
      const cy = VIEW_H / 2
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + this.time * 2
        const r0 = 260 + ((i * 137 + this.time * 900) % 320)
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        ctx.lineTo(cx + Math.cos(a) * (r0 + 90), cy + Math.sin(a) * (r0 + 90))
        ctx.stroke()
      }
      ctx.restore()
    }

    if (this.flash > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, this.flash)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(-ox, -oy, VIEW_W + ox * 2, VIEW_H + oy * 2)
      ctx.restore()
    }
  }

  private renderShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    const sy = this.surfaceBelow(x, y)
    if (sy == null || sy - y > 380) return
    const t = 1 - clamp((sy - y) / 380, 0, 0.85)
    ctx.save()
    ctx.globalAlpha = 0.22 * t
    ctx.fillStyle = '#3a2a20'
    ctx.beginPath()
    ctx.ellipse(x, sy + 5, r * (0.7 + 0.3 * t), r * 0.22 * (0.7 + 0.3 * t), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private renderParallax(ctx: CanvasRenderingContext2D): void {
    // sun
    ctx.fillStyle = '#fff3b0'
    ctx.beginPath()
    ctx.arc(1050, 110, 52, 0, Math.PI * 2)
    ctx.fill()

    // far mountains (parallax 0.12)
    const mOff = this.camX * 0.12
    ctx.fillStyle = 'rgba(176,156,204,0.55)'
    for (let i = -1; i < 7; i++) {
      const mx = i * 420 - (mOff % 420)
      ctx.beginPath()
      ctx.moveTo(mx - 240, VIEW_H - 40)
      ctx.quadraticCurveTo(mx, VIEW_H - 320 - (i % 3) * 40, mx + 240, VIEW_H - 40)
      ctx.closePath()
      ctx.fill()
    }

    // steamer-basket silhouettes (parallax 0.3)
    const sOff = this.camX * 0.3
    ctx.save()
    ctx.globalAlpha = 0.16
    for (let i = -1; i < 5; i++) {
      const bx = i * 700 + 260 - (sOff % 700)
      const by = VIEW_H - 60
      ctx.fillStyle = '#a9703f'
      ctx.beginPath()
      ctx.arc(bx, by, 240, Math.PI, 0)
      ctx.fill()
      ctx.strokeStyle = '#7a4b2a'
      ctx.lineWidth = 6
      for (let l = -2; l <= 2; l++) {
        ctx.beginPath()
        ctx.moveTo(bx - 200, by - 60 + l * 40)
        ctx.quadraticCurveTo(bx, by - 110 + l * 40, bx + 200, by - 60 + l * 40)
        ctx.stroke()
      }
    }
    ctx.restore()

    // clouds (parallax 0.25)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    for (const c of this.clouds) {
      const cx = c.x - this.camX * 0.25
      const cy = c.y - this.camY * 0.1
      ctx.beginPath()
      ctx.arc(cx, cy, 26 * c.s, 0, Math.PI * 2)
      ctx.arc(cx + 26 * c.s, cy + 6 * c.s, 20 * c.s, 0, Math.PI * 2)
      ctx.arc(cx - 26 * c.s, cy + 8 * c.s, 18 * c.s, 0, Math.PI * 2)
      ctx.fill()
    }

    // dumpling hills (parallax 0.45)
    const hillOff = this.camX * 0.45
    const hills = [
      { x: 200, r: 190, c: '#ffd9b8' },
      { x: 750, r: 150, c: '#ffe3c7' },
      { x: 1300, r: 210, c: '#ffd0ac' },
      { x: 1900, r: 160, c: '#ffe3c7' },
      { x: 2500, r: 200, c: '#ffd9b8' },
      { x: 3100, r: 170, c: '#ffe3c7' },
      { x: 3700, r: 210, c: '#ffd0ac' },
    ]
    for (const h of hills) {
      const hx = h.x - hillOff
      const hy = VIEW_H - 60 - this.camY * 0.3
      ctx.fillStyle = h.c
      ctx.beginPath()
      ctx.arc(hx, hy, h.r, Math.PI, 0)
      ctx.fill()
      ctx.strokeStyle = 'rgba(214,150,100,0.5)'
      ctx.lineWidth = 4
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.arc(hx + i * h.r * 0.28, hy - h.r * 0.72, h.r * 0.22, Math.PI * 1.15, Math.PI * 1.85)
        ctx.stroke()
      }
    }
  }

  private renderGodRays(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.translate(1050, 110)
    for (let i = 0; i < 3; i++) {
      ctx.save()
      ctx.rotate(0.5 + i * 0.35 + Math.sin(this.time * 0.1 + i) * 0.04)
      const ray = ctx.createLinearGradient(0, 0, 0, 700)
      ray.addColorStop(0, 'rgba(255,245,200,0.14)')
      ray.addColorStop(1, 'rgba(255,245,200,0)')
      ctx.fillStyle = ray
      ctx.beginPath()
      ctx.moveTo(-24, 0)
      ctx.lineTo(24, 0)
      ctx.lineTo(90, 700)
      ctx.lineTo(-90, 700)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  }

  private renderHub(ctx: CanvasRenderingContext2D): void {
    // ground with ambient-occlusion shading near the top edge
    ctx.fillStyle = '#c98d5e'
    ctx.fillRect(-400, GROUND_Y, this.hubWidth + 800, VIEW_H - GROUND_Y + 200)
    const ao = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 60)
    ao.addColorStop(0, 'rgba(70,40,20,0.28)')
    ao.addColorStop(1, 'rgba(70,40,20,0)')
    ctx.fillStyle = ao
    ctx.fillRect(-400, GROUND_Y, this.hubWidth + 800, 60)
    const grass = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 18)
    grass.addColorStop(0, '#a5e8a8')
    grass.addColorStop(1, '#7cc97f')
    ctx.fillStyle = grass
    ctx.fillRect(-400, GROUND_Y, this.hubWidth + 800, 18)

    // foreground grass tufts
    ctx.strokeStyle = '#5fa763'
    ctx.lineWidth = 2.5
    for (let x = -360; x < this.hubWidth + 400; x += 90) {
      const sway = Math.sin(this.time * 1.6 + x * 0.05) * 3
      ctx.beginPath()
      ctx.moveTo(x, GROUND_Y + 2)
      ctx.quadraticCurveTo(x + sway, GROUND_Y - 10, x + 3 + sway, GROUND_Y - 14)
      ctx.moveTo(x + 7, GROUND_Y + 2)
      ctx.quadraticCurveTo(x + 7 + sway, GROUND_Y - 8, x + 10 + sway, GROUND_Y - 11)
      ctx.stroke()
    }

    // shop stall
    this.renderShopStall(ctx)

    // treadmills with chevron belt
    for (const t of TREADMILLS) {
      const y = GROUND_Y
      ctx.fillStyle = '#5b5b6e'
      this.roundRect(ctx, t.x - 10, y - 16, t.w + 20, 16, 8)
      ctx.fill()
      ctx.fillStyle = '#3d3d4d'
      this.roundRect(ctx, t.x, y - 12, t.w, 10, 5)
      ctx.fill()
      const off = (this.time * 220) % 40
      ctx.strokeStyle = '#9a9ab0'
      ctx.lineWidth = 3
      for (let x = t.x - 40 + off; x < t.x + t.w; x += 40) {
        const cx = clamp(x, t.x + 4, t.x + t.w - 14)
        ctx.beginPath()
        ctx.moveTo(cx, y - 11)
        ctx.lineTo(cx + 8, y - 7)
        ctx.lineTo(cx, y - 3)
        ctx.stroke()
      }
      ctx.fillStyle = '#7a4b2a'
      ctx.font = 'bold 16px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('🎢 TREADMILL — hop on, ride for +25⚡!', t.x + t.w / 2, y - 64)
      ctx.fillStyle = '#a9703f'
      ctx.fillRect(t.x + t.w / 2 - 4, y - 60, 8, 44)
    }

    this.renderShrine(ctx)
    this.renderPracticeDoor(ctx)
    this.renderHubButton(ctx)
    this.renderWeeklyDoor(ctx)

    // arcade deck for the upper door row + climb steps
    ctx.fillStyle = '#b98a5f'
    this.roundRect(ctx, GATE_0_X - 100, DECK_Y, this.hubWidth - GATE_0_X + 200, 26, 10)
    ctx.fill()
    ctx.fillStyle = '#8fd694'
    this.roundRect(ctx, GATE_0_X - 100, DECK_Y, this.hubWidth - GATE_0_X + 200, 8, 4)
    ctx.fill()
    ctx.fillStyle = '#e8b06f'
    this.roundRect(ctx, GATE_0_X - 180, GROUND_Y - 75, 80, 20, 8)
    ctx.fill()
    this.roundRect(ctx, GATE_0_X - 140, GROUND_Y - 150, 80, 20, 8)
    ctx.fill()

    for (let i = 0; i < this.gateCount; i++) {
      const gp = gatePos(i)
      this.renderGate(ctx, gp.x, gp.y, getObby(i + 1), i)
    }

    // spawn flag
    ctx.fillStyle = '#a9703f'
    ctx.fillRect(HUB_SPAWN.x - 40, GROUND_Y - 90, 6, 90)
    ctx.fillStyle = '#ff8fab'
    ctx.beginPath()
    ctx.moveTo(HUB_SPAWN.x - 34, GROUND_Y - 90)
    ctx.lineTo(HUB_SPAWN.x + 16, GROUND_Y - 76)
    ctx.lineTo(HUB_SPAWN.x - 34, GROUND_Y - 62)
    ctx.closePath()
    ctx.fill()
  }

  private renderShopStall(ctx: CanvasRenderingContext2D): void {
    const x = SHOP_X
    const y = GROUND_Y
    // counter
    ctx.fillStyle = '#a9703f'
    this.roundRect(ctx, x - 60, y - 46, 120, 46, 6)
    ctx.fill()
    ctx.fillStyle = '#8a5a33'
    ctx.fillRect(x - 60, y - 24, 120, 6)
    // posts + striped awning
    ctx.fillStyle = '#8a5a33'
    ctx.fillRect(x - 56, y - 110, 8, 66)
    ctx.fillRect(x + 48, y - 110, 8, 66)
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#ff5a5f' : '#fff3df'
      ctx.beginPath()
      ctx.moveTo(x - 66 + i * 22, y - 118)
      ctx.lineTo(x - 44 + i * 22, y - 118)
      ctx.lineTo(x - 44 + i * 22, y - 100)
      ctx.quadraticCurveTo(x - 55 + i * 22, y - 92, x - 66 + i * 22, y - 100)
      ctx.closePath()
      ctx.fill()
    }
    // wares
    ctx.font = '16px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('👑', x - 30, y - 28)
    ctx.fillText('🎩', x, y - 28)
    ctx.fillText('🧿', x + 30, y - 28)
    ctx.fillStyle = '#5b3a1e'
    ctx.font = 'bold 16px system-ui, sans-serif'
    ctx.fillText('🛒 SHOP — press E', x, y - 130)
  }

  private renderShrine(ctx: CanvasRenderingContext2D): void {
    const x = SHRINE_X
    const y = GROUND_Y
    const ready = levelForSpeed(this.speed).level >= REBIRTH_REQ_LEVEL
    ctx.fillStyle = '#8d8da8'
    this.roundRect(ctx, x - 50, y - 20, 100, 20, 8)
    ctx.fill()
    ctx.fillStyle = '#a8a8c4'
    this.roundRect(ctx, x - 36, y - 44, 72, 26, 8)
    ctx.fill()
    ctx.save()
    ctx.translate(x, y - 74)
    if (ready) {
      ctx.shadowColor = '#c084ff'
      ctx.shadowBlur = 18
    }
    ctx.fillStyle = ready ? '#c084ff' : '#9a9ab0'
    ctx.beginPath()
    ctx.arc(0, 0, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.arc(0, 0, 12, this.time * 2, this.time * 2 + Math.PI * 1.4)
    ctx.stroke()
    ctx.restore()
    for (let i = 0; i < Math.min(this.rebirths, 5); i++) {
      ctx.strokeStyle = `hsla(${(this.rebirths * 63 + i * 40) % 360}, 85%, 65%, 0.8)`
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(x, y - 74, 28 + i * 6, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = '#4a3a5e'
    ctx.font = 'bold 16px system-ui, sans-serif'
    ctx.textAlign = 'center'
    if (ready) {
      ctx.fillText('🌀 REBIRTH — press E!', x, y - 116)
      ctx.font = 'bold 12px system-ui, sans-serif'
      ctx.fillText('reset speed → permanent ×2 gain', x, y - 100)
    } else {
      ctx.fillText(`🌀 Rebirth (needs Lv ${REBIRTH_REQ_LEVEL})`, x, y - 116)
    }
  }

  private renderHubButton(ctx: CanvasRenderingContext2D): void {
    const tier = nextMultTier(this.mult)
    const ready = tier != null && this.wins >= tier.wins
    const x = BUTTON_X
    const y = GROUND_Y
    ctx.fillStyle = '#6d6d7f'
    this.roundRect(ctx, x - 55, y - 14, 110, 14, 6)
    ctx.fill()
    const pressed = this.mult > 1 && !tier
    ctx.fillStyle = ready ? '#ff5a5f' : pressed ? '#c93b40' : '#e8848a'
    ctx.beginPath()
    ctx.arc(x, y - 14, 34, Math.PI, 0)
    ctx.fill()
    if (ready) {
      ctx.save()
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 6) * 0.3
      ctx.strokeStyle = '#ffd24a'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(x, y - 14, 42, Math.PI, 0)
      ctx.stroke()
      ctx.restore()
    }
    ctx.fillStyle = '#5b2b2e'
    ctx.font = 'bold 16px system-ui, sans-serif'
    ctx.textAlign = 'center'
    const label = tier
      ? ready
        ? `+${tier.mult} SPEED — press E!`
        : `+${tier.mult} Speed (needs ${tier.wins} 🏆)`
      : 'MAX MULTIPLIER!'
    ctx.fillText(label, x, y - 64)
  }

  /** Draw centered text, shrinking the font (never growing) until it fits maxW. */
  private fitText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxW: number,
    weight: string,
    baseSize: number,
    minSize = 9,
  ): void {
    let size = baseSize
    ctx.font = `${weight} ${size}px system-ui, sans-serif`
    while (size > minSize && ctx.measureText(text).width > maxW) {
      size--
      ctx.font = `${weight} ${size}px system-ui, sans-serif`
    }
    ctx.fillText(text, x, y)
  }

  private renderGate(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    def: ObbyDef,
    index: number,
  ): void {
    const y = gy
    const w = 96
    const doorColor = levelDefFor(def.reqLevel).color
    const unlocked = this.isObbyUnlocked(index)
    const earned = this.medals[String(def.id)] ?? 0
    const goals = medalTimes(def)
    ctx.fillStyle = '#8a6b4f'
    ctx.fillRect(gx - w / 2 - 8, y - 150, 16, 150)
    ctx.fillRect(gx + w / 2 - 8, y - 150, 16, 150)
    ctx.fillRect(gx - w / 2 - 16, y - 166, w + 32, 18)
    // glowing portal with swirl, color-themed to the required level
    ctx.save()
    ctx.globalAlpha = unlocked ? 0.75 + Math.sin(this.time * 3) * 0.15 : 0.35
    const pg = ctx.createLinearGradient(gx, y - 146, gx, y)
    pg.addColorStop(0, unlocked ? doorColor : '#9a9aa5')
    pg.addColorStop(1, unlocked ? '#ffffff' : '#b5b5c0')
    ctx.fillStyle = pg
    this.roundRect(ctx, gx - w / 2 + 6, y - 146, w - 12, 146, 10)
    ctx.fill()
    ctx.restore()
    if (unlocked) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(gx, y - 73, 26, this.time * 2.4, this.time * 2.4 + Math.PI * 1.3)
      ctx.stroke()
      ctx.restore()
    }
    // gold pulsing frame while this door is the unlockable frontier
    if (!unlocked && index > 0 && (this.medals[String(index)] ?? 0) > 0) {
      ctx.save()
      ctx.globalAlpha = 0.6 + Math.sin(this.time * 4) * 0.3
      ctx.strokeStyle = '#ffd24a'
      ctx.lineWidth = 4
      this.roundRect(ctx, gx - w / 2 - 12, y - 162, w + 24, 162, 12)
      ctx.stroke()
      ctx.restore()
    }
    // signage — uniform base sizes on every door, shrunk to fit wide text
    ctx.textAlign = 'center'
    // medal status row (earned = bright, missing = faint)
    ctx.font = '15px system-ui, sans-serif'
    const medalIcons = ['🥉', '🥈', '🥇']
    for (let m = 0; m < 3; m++) {
      ctx.save()
      ctx.globalAlpha = m < earned ? 1 : 0.22
      ctx.fillText(medalIcons[m], gx - 22 + m * 22, y - 232)
      ctx.restore()
    }
    ctx.fillStyle = '#5b3a1e'
    this.fitText(ctx, def.name.toUpperCase(), gx, y - 210, 150, 'black', 20)
    if (unlocked) {
      ctx.fillStyle = '#2f9e44'
      this.fitText(
        ctx,
        `+${fmt(def.reward)}🏆 · 🥈${fmtTime(goals.target)} · 🥇${fmtTime(goals.stretch)}`,
        gx,
        y - 190,
        175,
        'bold',
        13,
      )
      ctx.fillStyle = 'rgba(91,58,30,0.85)'
      this.fitText(ctx, 'press E', gx, y - 12, 80, 'bold', 12)
    } else {
      ctx.fillStyle = '#e0444a'
      this.fitText(
        ctx,
        index === 0 ? '' : `🔒 3 medals on Obby ${index} · +${fmt(def.reward)}🏆`,
        gx,
        y - 190,
        175,
        'bold',
        13,
      )
      ctx.font = '30px system-ui, sans-serif'
      ctx.fillText('🔒', gx, y - 70)
    }
  }

  /** Distinctive golden weekly-challenge door with countdown. */
  private renderWeeklyDoor(ctx: CanvasRenderingContext2D): void {
    const gx = WEEKLY_X
    const y = GROUND_Y
    const w = 110
    const lvl = levelForSpeed(this.speed).level
    const req = weeklyReqLevel(lvl)
    const unlocked = lvl >= req // virtually always true
    const doneThisWeek = this.weeklyBest[currentWeekKey()] != null

    // golden frame
    ctx.fillStyle = '#b8860b'
    ctx.fillRect(gx - w / 2 - 10, y - 168, 20, 168)
    ctx.fillRect(gx + w / 2 - 10, y - 168, 20, 168)
    ctx.fillRect(gx - w / 2 - 20, y - 186, w + 40, 20)
    // starburst portal
    ctx.save()
    if (unlocked) {
      ctx.shadowColor = '#ffd24a'
      ctx.shadowBlur = 16 + Math.sin(this.time * 4) * 6
    }
    const pg = ctx.createLinearGradient(gx, y - 164, gx, y)
    pg.addColorStop(0, doneThisWeek ? '#e8c96a' : '#ffd24a')
    pg.addColorStop(1, '#fff8dc')
    ctx.fillStyle = pg
    this.roundRect(ctx, gx - w / 2 + 6, y - 164, w - 12, 164, 12)
    ctx.fill()
    ctx.restore()
    // spinning star
    ctx.save()
    ctx.translate(gx, y - 82)
    ctx.rotate(this.time * 0.8)
    ctx.fillStyle = 'rgba(184,134,11,0.75)'
    ctx.font = 'bold 34px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('★', 0, 12)
    ctx.restore()
    // labels
    ctx.textAlign = 'center'
    ctx.fillStyle = '#7a4b1a'
    ctx.font = 'black 19px system-ui, sans-serif'
    ctx.fillText('⭐ WEEKLY', gx, y - 200)
    ctx.font = 'bold 13px system-ui, sans-serif'
    ctx.fillStyle = '#2f9e44'
    ctx.fillText(doneThisWeek ? 'DONE — replay for 15🪙 · press E' : `Big 🪙 payout · Lv ${req}+ · press E`, gx, y - 219)
    ctx.fillStyle = '#b8860b'
    ctx.font = 'bold 12px system-ui, sans-serif'
    ctx.fillText(`⏳ ${fmtCountdown(msUntilNextWeek())}`, gx, y - 238)
  }

  private renderPracticeDoor(ctx: CanvasRenderingContext2D): void {
    const x = PRACTICE_X
    const y = GROUND_Y
    // wooden posts + crossbar arch
    ctx.fillStyle = '#8a5a33'
    ctx.fillRect(x - 52, y - 150, 10, 150)
    ctx.fillRect(x + 42, y - 150, 10, 150)
    ctx.fillRect(x - 60, y - 166, 120, 18)
    // hanging target: pulsing concentric rings
    const pulse = 1 + Math.sin(this.time * 3) * 0.06
    ctx.save()
    ctx.translate(x, y - 96)
    ctx.scale(pulse, pulse)
    const rings: Array<[number, string]> = [
      [34, '#e0444a'],
      [26, '#fff3df'],
      [18, '#e0444a'],
      [10, '#fff3df'],
      [4, '#e0444a'],
    ]
    for (const [r, color] of rings) {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    // rope from crossbar to target
    ctx.strokeStyle = '#8a5a33'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x, y - 148)
    ctx.lineTo(x, y - 96 - 34 * pulse)
    ctx.stroke()
    // soft green glow at the base
    ctx.save()
    ctx.globalAlpha = 0.35 + Math.sin(this.time * 2.4) * 0.1
    ctx.fillStyle = '#8be06a'
    ctx.beginPath()
    ctx.ellipse(x, y - 4, 56, 10, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    // labels
    ctx.textAlign = 'center'
    ctx.fillStyle = '#7a4b1a'
    ctx.font = 'black 18px system-ui, sans-serif'
    ctx.fillText('🎯 PRACTICE', x, y - 182)
    ctx.font = 'bold 12px system-ui, sans-serif'
    ctx.fillStyle = '#2f9e44'
    ctx.fillText('free play · no rewards · press E', x, y - 200)
  }

  private renderObby(ctx: CanvasRenderingContext2D): void {
    const def = this.obby
    if (!def) return

    // animated lava with bubbles + glow
    for (const hz of def.hazards) {
      if (hz.type !== 'lava') continue
      ctx.fillStyle = '#ff6b35'
      ctx.fillRect(hz.x, hz.y, hz.w, hz.h)
      const glow = ctx.createLinearGradient(0, hz.y - 50, 0, hz.y)
      glow.addColorStop(0, 'rgba(255,120,40,0)')
      glow.addColorStop(1, 'rgba(255,120,40,0.3)')
      ctx.fillStyle = glow
      ctx.fillRect(hz.x, hz.y - 50, hz.w, 50)
      ctx.fillStyle = '#ffa45c'
      const wave = Math.sin(this.time * 3) * 6
      for (let x = hz.x; x < hz.x + hz.w; x += 60) {
        ctx.beginPath()
        ctx.arc(x + 30, hz.y + wave + Math.sin(x * 0.05 + this.time * 4) * 5, 22, Math.PI, 0)
        ctx.fill()
      }
      // rising bubbles
      for (let i = 0; i < 14; i++) {
        const bx = hz.x + ((i * 173.3) % hz.w)
        const rise = (this.time * 46 + i * 97) % 260
        const by = hz.y + 240 - rise
        const ba = clamp(rise / 60, 0, 1) * clamp((260 - rise) / 60, 0, 1)
        ctx.save()
        ctx.globalAlpha = ba * 0.7
        ctx.fillStyle = '#ffd0a0'
        ctx.beginPath()
        ctx.arc(bx + Math.sin(this.time * 2 + i) * 8, by, 4 + (i % 3) * 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    // gradient-lit platforms with edge highlights
    for (const p of def.platforms) {
      const pg = ctx.createLinearGradient(0, p.y, 0, p.y + p.h)
      pg.addColorStop(0, '#f3c88f')
      pg.addColorStop(1, '#cf9550')
      ctx.fillStyle = pg
      this.roundRect(ctx, p.x, p.y, p.w, p.h, 10)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      this.roundRect(ctx, p.x + 3, p.y + 2, p.w - 6, 4, 2)
      ctx.fill()
      const gg = ctx.createLinearGradient(0, p.y, 0, p.y + 12)
      gg.addColorStop(0, '#a5e8a8')
      gg.addColorStop(1, '#7cc97f')
      ctx.fillStyle = gg
      this.roundRect(ctx, p.x, p.y, p.w, Math.min(12, p.h), 6)
      ctx.fill()
    }

    // breathing landing pads (teal, glowing, rippling as they resize)
    for (const pad of def.pads) {
      const s = padScale(pad, this.time)
      const w = pad.w * s
      const cx = pad.x + pad.w / 2
      const px = cx - w / 2
      ctx.save()
      ctx.shadowColor = 'rgba(94,224,210,0.8)'
      ctx.shadowBlur = 10 + s * 8
      const pg = ctx.createLinearGradient(0, pad.y, 0, pad.y + pad.h)
      pg.addColorStop(0, '#8ff0e2')
      pg.addColorStop(1, '#46b8a8')
      ctx.fillStyle = pg
      this.roundRect(ctx, px, pad.y, w, pad.h, 12)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      this.roundRect(ctx, px + 4, pad.y + 3, w - 8, 4, 2)
      ctx.fill()
      // ripple ring tracking the current size
      ctx.save()
      ctx.globalAlpha = 0.35 + (1.3 - s) * 0.5
      ctx.strokeStyle = '#bff5ee'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.ellipse(cx, pad.y + 2, w / 2 + 8, 8, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // movers
    for (const m of this.movers) {
      const mg = ctx.createLinearGradient(0, m.cy, 0, m.cy + m.def.h)
      mg.addColorStop(0, '#9a8ae0')
      mg.addColorStop(1, '#6a5bc0')
      ctx.fillStyle = mg
      this.roundRect(ctx, m.cx, m.cy, m.def.w, m.def.h, 8)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.fillRect(m.cx + 6, m.cy + 4, m.def.w - 12, 5)
      ctx.fillStyle = '#ece7ff'
      ctx.font = 'bold 14px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(m.def.axis === 'x' ? '↔' : '↕', m.cx + m.def.w / 2, m.cy + m.def.h / 2 + 5)
    }

    // spikes
    for (const hz of def.hazards) {
      if (hz.type !== 'spikes') continue
      ctx.fillStyle = '#8d8d9e'
      const n = Math.max(2, Math.floor(hz.w / 18))
      const step = hz.w / n
      for (let i = 0; i < n; i++) {
        const sx = hz.x + i * step
        ctx.beginPath()
        ctx.moveTo(sx, hz.y)
        ctx.lineTo(sx + step / 2, hz.y - hz.h)
        ctx.lineTo(sx + step, hz.y)
        ctx.closePath()
        ctx.fill()
      }
    }

    // coins with spin + shine
    for (const c of this.obbyCoins) {
      if (c.taken) continue
      const spin = Math.abs(Math.cos(this.time * 4 + c.x * 0.01)) * 0.85 + 0.15
      const bobY = Math.sin(this.time * 3 + c.x * 0.05) * 4
      ctx.save()
      ctx.translate(c.x, c.y + bobY)
      ctx.scale(spin, 1)
      ctx.fillStyle = '#ffd24a'
      ctx.beginPath()
      ctx.arc(0, 0, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#e8a91c'
      ctx.beginPath()
      ctx.arc(0, 0, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff3b0'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, 0, 9, this.time * 5, this.time * 5 + 1.1)
      ctx.stroke()
      ctx.restore()
    }

    // trophy with spinning shine (practice has no finish — play until R)
    if (!this.practiceMode) {
      const t = def.trophy
      const bob = Math.sin(this.time * 3) * 6
      const tx = t.x
      const ty = t.y - 34 + bob
      ctx.save()
      ctx.translate(tx, ty)
      ctx.fillStyle = '#ffd24a'
      ctx.beginPath()
      ctx.moveTo(-16, -14)
      ctx.lineTo(16, -14)
      ctx.quadraticCurveTo(16, 10, 0, 12)
      ctx.quadraticCurveTo(-16, 10, -16, -14)
      ctx.fill()
      ctx.strokeStyle = '#ffd24a'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(-18, -6, 8, Math.PI * 0.5, Math.PI * 1.6)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(18, -6, 8, Math.PI * 1.4, Math.PI * 0.5)
      ctx.stroke()
      ctx.fillRect(-4, 12, 8, 10)
      this.roundRect(ctx, -14, 22, 28, 8, 3)
      ctx.fill()
      ctx.fillStyle = '#fff3b0'
      ctx.font = 'bold 14px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('★', 0, 2)
      // spinning shine
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(0, 0, 24, this.time * 3, this.time * 3 + 0.9)
      ctx.stroke()
      ctx.restore()
      if (Math.random() < 0.15 * this.particleMul) {
        this.pushParticle({
          x: tx + (Math.random() * 50 - 25),
          y: ty + (Math.random() * 40 - 20),
          vx: 0,
          vy: -25,
          life: 0,
          max: 0.6,
          size: 2.5,
          color: '#fff3b0',
          grav: 0,
        })
      }
      ctx.fillStyle = '#7a4b1a'
      ctx.font = 'bold 16px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`+${fmt(def.reward)} WINS!`, tx, t.y - 90)
    }

    ctx.fillStyle = '#7a6a55'
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.fillText(
      this.practiceMode ? 'START — endless drills (R = exit)' : 'START (R = exit)',
      def.start.x + 60,
      580,
    )

    // section labels (practice drills)
    if (def.labels) {
      ctx.textAlign = 'center'
      for (const l of def.labels) {
        ctx.font = 'black 22px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(90,60,30,0.85)'
        ctx.fillText(l.text, l.x, l.y)
      }
    }

    // checkpoint flags: gray until touched, then green with a wave
    if (def.checkpoints) {
      for (let i = 0; i < def.checkpoints.length; i++) {
        const c = def.checkpoints[i]
        const touched = this.checkpointsTouched.has(i)
        ctx.fillStyle = '#8a5a33'
        ctx.fillRect(c.x - 3, c.y - 90, 6, 90)
        const wave = touched ? Math.sin(this.time * 6 + i) * 5 : 0
        ctx.fillStyle = touched ? '#4ade80' : '#b8b8c4'
        ctx.beginPath()
        ctx.moveTo(c.x + 3, c.y - 90)
        ctx.lineTo(c.x + 46, c.y - 78 + wave)
        ctx.lineTo(c.x + 3, c.y - 62)
        ctx.closePath()
        ctx.fill()
        if (touched) {
          ctx.fillStyle = '#166534'
          ctx.font = 'bold 13px system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('✓', c.x + 20, c.y - 68 + wave * 0.5)
        }
      }
    }

    this.renderGhost(ctx)
  }

  // Best-run ghost: cyan translucent dumpling replaying the recorded line.
  private renderGhost(ctx: CanvasRenderingContext2D): void {
    const g = this.ghostPlay
    if (!g || g.length === 0 || this.mode !== 'obby') return
    const runT = this.time - this.obbyStartTime
    if (runT < g[0][0]) return
    while (this.ghostIdx < g.length - 1 && g[this.ghostIdx + 1][0] <= runT) this.ghostIdx++
    const a = g[this.ghostIdx]
    const b = g[Math.min(this.ghostIdx + 1, g.length - 1)]
    const span = b[0] - a[0]
    const f = span > 0 ? clamp((runT - a[0]) / span, 0, 1) : 0
    const gx = a[1] + (b[1] - a[1]) * f
    const gy = a[2] + (b[2] - a[2]) * f
    const facing = b[3] >= 0 ? 1 : -1
    const airborne = b[4] === 1

    // faint cyan trail behind the ghost
    if (this.time - this.ghostFxTimer > 0.09 && Math.abs(b[1] - a[1]) > 2) {
      this.ghostFxTimer = this.time
      this.pushParticle({
        x: gx,
        y: gy - PLAYER_R,
        vx: -facing * 30,
        vy: 0,
        life: 0,
        max: 0.45,
        size: 4,
        color: 'rgba(103,232,249,0.55)',
        grav: 0,
      })
    }

    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.translate(gx, gy)
    ctx.scale(facing, 1)
    if (airborne) ctx.scale(0.92, 1.1)
    // dumpling body
    const r = PLAYER_R
    ctx.fillStyle = '#67e8f9'
    ctx.beginPath()
    ctx.moveTo(-r, 0)
    ctx.quadraticCurveTo(-r, -r * 1.35, 0, -r * 1.35)
    ctx.quadraticCurveTo(r, -r * 1.35, r, 0)
    ctx.closePath()
    ctx.fill()
    // pleat lines
    ctx.strokeStyle = 'rgba(14,116,144,0.8)'
    ctx.lineWidth = 2
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath()
      ctx.moveTo(i * r * 0.4, -r * 1.3)
      ctx.quadraticCurveTo(i * r * 0.55, -r * 0.8, i * r * 0.5, -r * 0.45)
      ctx.stroke()
    }
    // eyes
    ctx.fillStyle = '#0e7490'
    ctx.beginPath()
    ctx.arc(r * 0.28, -r * 0.62, 2.6, 0, Math.PI * 2)
    ctx.arc(r * 0.72, -r * 0.62, 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // "GHOST" tag
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#0e7490'
    ctx.font = 'bold 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('👻 BEST', gx, gy - PLAYER_R * 1.7)
    ctx.restore()
  }

  private renderRings(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const t = r.life / 0.45
      ctx.save()
      ctx.globalAlpha = (1 - t) * 0.6
      ctx.strokeStyle = '#e8d0a8'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.ellipse(r.x, r.y, 12 + t * 70, (12 + t * 70) * 0.3, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  // ---------------- pet rendering ----------------

  private renderPet(ctx: CanvasRenderingContext2D): void {
    const pet = this.petDef
    if (!pet) return
    if (pet.id === 'dragon') {
      // tail-first so the head draws on top
      for (let i = this.dragonSegs.length - 1; i >= 0; i--) {
        const seg = this.dragonSegs[i]
        const r = 9 - i * 1.2
        ctx.fillStyle = i % 2 === 0 ? '#5ec9a7' : '#4ab895'
        ctx.beginPath()
        ctx.arc(seg.x, seg.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.save()
    ctx.translate(this.petX, this.petY)
    ctx.rotate(this.petTilt)
    switch (pet.id) {
      case 'pup':
        this.drawPup(ctx)
        break
      case 'sprite':
        this.drawSprite(ctx)
        break
      case 'wonton':
        this.drawWonton(ctx)
        break
      case 'imp':
        this.drawImp(ctx)
        break
      case 'dragon':
        this.drawDragonHead(ctx)
        break
    }
    ctx.restore()
  }

  private petFace(ctx: CanvasRenderingContext2D, r: number, eyeY = -2): void {
    for (const ex of [-r * 0.34, r * 0.34]) {
      ctx.fillStyle = '#3a2a20'
      ctx.beginPath()
      ctx.arc(ex, eyeY, 2.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(ex + 0.9, eyeY - 0.9, 0.9, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(255,140,150,0.6)'
    ctx.beginPath()
    ctx.arc(-r * 0.6, eyeY + 4, 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(r * 0.6, eyeY + 4, 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#7a4b3a'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(0, eyeY + 3, 3, Math.PI * 0.15, Math.PI * 0.85)
    ctx.stroke()
  }

  private drawPup(ctx: CanvasRenderingContext2D): void {
    // ears
    ctx.fillStyle = '#d9a066'
    ctx.beginPath()
    ctx.ellipse(-9, -10, 5, 8, -0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(9, -10, 5, 8, 0.5, 0, Math.PI * 2)
    ctx.fill()
    // body
    ctx.fillStyle = '#fff3df'
    ctx.beginPath()
    ctx.arc(0, 0, 13, 0, Math.PI * 2)
    ctx.fill()
    // tail
    ctx.strokeStyle = '#d9a066'
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.arc(14, 2, 5, -Math.PI * 0.6, Math.PI * 0.4)
    ctx.stroke()
    this.petFace(ctx, 13)
  }

  private drawSprite(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(-7, 2, 8, 0, Math.PI * 2)
    ctx.arc(7, 2, 8, 0, Math.PI * 2)
    ctx.arc(0, -5, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    this.petFace(ctx, 11, -1)
  }

  private drawWonton(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#ffe9c9'
    ctx.beginPath()
    ctx.moveTo(-11, 3)
    ctx.quadraticCurveTo(-11, -10, 0, -11)
    ctx.quadraticCurveTo(11, -10, 11, 3)
    ctx.quadraticCurveTo(11, 10, 0, 10)
    ctx.quadraticCurveTo(-11, 10, -11, 3)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(120,80,50,0.4)'
    ctx.lineWidth = 1.6
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath()
      ctx.arc(i * 5, -8.5, 3.4, Math.PI * 1.1, Math.PI * 1.9)
      ctx.stroke()
    }
    this.petFace(ctx, 11)
  }

  private drawImp(ctx: CanvasRenderingContext2D): void {
    // horns
    ctx.fillStyle = '#c93b40'
    ctx.beginPath()
    ctx.moveTo(-8, -8)
    ctx.lineTo(-11, -17)
    ctx.lineTo(-4, -11)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(8, -8)
    ctx.lineTo(11, -17)
    ctx.lineTo(4, -11)
    ctx.closePath()
    ctx.fill()
    // body
    ctx.fillStyle = '#ff5a5f'
    ctx.beginPath()
    ctx.arc(0, 0, 12, 0, Math.PI * 2)
    ctx.fill()
    // tail
    ctx.strokeStyle = '#c93b40'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(10, 6)
    ctx.quadraticCurveTo(18, 10, 16, 2)
    ctx.stroke()
    this.petFace(ctx, 12)
  }

  private drawDragonHead(ctx: CanvasRenderingContext2D): void {
    // horns
    ctx.strokeStyle = '#e8b06f'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(-5, -9)
    ctx.quadraticCurveTo(-9, -18, -13, -19)
    ctx.moveTo(5, -9)
    ctx.quadraticCurveTo(9, -18, 13, -19)
    ctx.stroke()
    // head
    ctx.fillStyle = '#5ec9a7'
    ctx.beginPath()
    ctx.arc(0, 0, 12, 0, Math.PI * 2)
    ctx.fill()
    // whiskers
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(-9, 3)
    ctx.quadraticCurveTo(-18, 5 + Math.sin(this.time * 5) * 2, -22, 1)
    ctx.moveTo(9, 3)
    ctx.quadraticCurveTo(18, 5 + Math.cos(this.time * 5) * 2, 22, 1)
    ctx.stroke()
    this.petFace(ctx, 12)
  }

  // ---------------- player rendering ----------------

  private bodyPath(ctx: CanvasRenderingContext2D, r: number): void {
    ctx.beginPath()
    ctx.moveTo(-r, 4)
    ctx.quadraticCurveTo(-r, -r * 0.95, 0, -r)
    ctx.quadraticCurveTo(r, -r * 0.95, r, 4)
    ctx.quadraticCurveTo(r, r * 0.9, 0, r * 0.92)
    ctx.quadraticCurveTo(-r, r * 0.9, -r, 4)
    ctx.closePath()
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    const lvl = levelForSpeed(this.speed)
    const skin: MilestoneSkin = skinForLevel(lvl.level)
    const r = PLAYER_R
    ctx.save()
    ctx.translate(this.px, this.py - r)

    // rebirth halo ring
    if (this.rebirths > 0) {
      const hue = (this.rebirths * 63) % 360
      ctx.save()
      ctx.globalAlpha = 0.85
      ctx.strokeStyle = `hsl(${hue}, 90%, 62%)`
      ctx.lineWidth = 4
      ctx.setLineDash([14, 8])
      ctx.lineDashOffset = -this.time * 30
      ctx.beginPath()
      ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    ctx.scale(this.squashX * this.faceDir, this.squashY)
    const fx = this.faceDir

    // scurrying feet (before body so they peek from under it)
    if (this.grounded) {
      const scurry = Math.abs(this.pvx) > 40 ? Math.sin(this.time * 18) * 4 : 0
      ctx.fillStyle = '#e8c9a0'
      ctx.beginPath()
      ctx.ellipse(-8 + scurry, r * 0.9, 6, 4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(8 - scurry, r * 0.9, 6, 4, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // body color by skin
    let body = lvl.color
    let stroke = 'rgba(120,80,50,0.35)'
    if (skin === 'rainbow') body = `hsl(${(this.time * 140) % 360}, 85%, 65%)`
    if (skin === 'galaxy') {
      body = '#1b2340'
      stroke = 'rgba(190,150,255,0.7)'
    }

    // soft body shading: base + radial light + bottom shade
    this.bodyPath(ctx, r)
    ctx.fillStyle = body
    ctx.fill()
    ctx.save()
    this.bodyPath(ctx, r)
    ctx.clip()
    const light = ctx.createRadialGradient(-r * 0.4, -r * 0.5, r * 0.1, 0, 0, r * 1.5)
    light.addColorStop(0, 'rgba(255,255,255,0.4)')
    light.addColorStop(0.55, 'rgba(255,255,255,0)')
    light.addColorStop(1, 'rgba(60,30,10,0.14)')
    ctx.fillStyle = light
    ctx.fillRect(-r, -r, r * 2, r * 2)
    ctx.restore()
    this.bodyPath(ctx, r)
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2.5
    ctx.stroke()

    // galaxy starfield speckles
    if (skin === 'galaxy') {
      for (let i = 0; i < 9; i++) {
        const hx = Math.sin(i * 12.9898) * 0.5 + 0.5
        const hy = Math.sin(i * 78.233) * 0.5 + 0.5
        const tw = 0.5 + Math.sin(this.time * 3 + i * 1.7) * 0.5
        ctx.fillStyle = `rgba(255,255,255,${0.35 + tw * 0.6})`
        ctx.beginPath()
        ctx.arc((hx - 0.5) * r * 1.5, (hy - 0.5) * r * 1.5, 1.4 + tw, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // animated pleats (wobble while running)
    const running = this.grounded && Math.abs(this.pvx) > 50
    ctx.strokeStyle = skin === 'galaxy' ? 'rgba(190,150,255,0.6)' : 'rgba(120,80,50,0.45)'
    ctx.lineWidth = 2.2
    for (let i = -2; i <= 2; i++) {
      const wob = running ? Math.sin(this.time * 14 + i) * 1.4 : 0
      ctx.beginPath()
      ctx.arc(i * r * 0.26, -r * 0.82 + wob * 0.4, r * 0.2 + wob * 0.3, Math.PI * 1.1, Math.PI * 1.9)
      ctx.stroke()
    }
    ctx.fillStyle = skin === 'galaxy' ? 'rgba(190,150,255,0.7)' : 'rgba(120,80,50,0.5)'
    ctx.beginPath()
    ctx.arc(0, -r * 0.98, 4, 0, Math.PI * 2)
    ctx.fill()

    // cheeks (rosier when happy at high level)
    ctx.fillStyle = lvl.level >= 5 ? 'rgba(255,120,140,0.7)' : 'rgba(255,140,150,0.55)'
    ctx.beginPath()
    ctx.ellipse(-r * 0.52, r * 0.18, 6, 4.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(r * 0.52, r * 0.18, 6, 4.5, 0, 0, Math.PI * 2)
    ctx.fill()

    // eyes (blink cycle; look toward movement)
    const lookX = clamp(this.pvx / 600, -1, 1) * 2.6 * fx
    const lookY = clamp(this.pvy / 900, -1, 1) * 2
    for (const ex of [-r * 0.3, r * 0.3]) {
      if (this.blink > 0) {
        ctx.strokeStyle = '#3a2a20'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(ex - 5, -r * 0.12)
        ctx.quadraticCurveTo(ex, -r * 0.12 + 3, ex + 5, -r * 0.12)
        ctx.stroke()
      } else {
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(ex, -r * 0.12, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#3a2a20'
        ctx.beginPath()
        ctx.arc(ex + lookX, -r * 0.12 + lookY, 3.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(ex + lookX + 1.2, -r * 0.12 + lookY - 1.2, 1.1, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // mouth (bigger smile at high level)
    ctx.strokeStyle = '#7a4b3a'
    ctx.fillStyle = '#8e3b46'
    ctx.lineWidth = 2
    if (!this.grounded) {
      ctx.beginPath()
      ctx.ellipse(0, r * 0.34, 5.5, 7, 0, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const smile = lvl.level >= 5 ? 8.5 : 6
      ctx.beginPath()
      ctx.arc(0, r * 0.24, smile, Math.PI * 0.12, Math.PI * 0.88)
      ctx.stroke()
    }

    // hat
    this.renderHat(ctx, r)

    ctx.restore()

    // level label
    if (lvl.level > 0) {
      ctx.fillStyle = lvl.color
      ctx.strokeStyle = 'rgba(60,40,20,0.6)'
      ctx.lineWidth = 3
      ctx.font = 'bold 17px system-ui, sans-serif'
      ctx.textAlign = 'center'
      const ly = this.py - r * 2 - 26
      ctx.strokeText(`Lv ${lvl.level}`, this.px, ly)
      ctx.fillText(`Lv ${lvl.level}`, this.px, ly)
    }
  }

  private renderHat(ctx: CanvasRenderingContext2D, r: number): void {
    if (!this.equippedHat) return
    ctx.save()
    ctx.translate(0, -r * 0.95)
    switch (this.equippedHat) {
      case 'steamer':
        // bamboo steamer lid
        ctx.fillStyle = '#d9b380'
        ctx.beginPath()
        ctx.ellipse(0, -4, r * 0.75, 8, 0, Math.PI, 0)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = '#a9703f'
        ctx.lineWidth = 1.8
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath()
          ctx.moveTo(i * r * 0.28, -11)
          ctx.lineTo(i * r * 0.28, -3)
          ctx.stroke()
        }
        ctx.fillStyle = '#a9703f'
        ctx.beginPath()
        ctx.arc(0, -13, 3, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'chef':
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(-8, -12, 8, 0, Math.PI * 2)
        ctx.arc(8, -12, 8, 0, Math.PI * 2)
        ctx.arc(0, -16, 9, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#f0f0f0'
        this.roundRect(ctx, -12, -8, 24, 8, 3)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'
        ctx.lineWidth = 1.5
        this.roundRect(ctx, -12, -8, 24, 8, 3)
        ctx.stroke()
        break
      case 'party': {
        ctx.rotate(Math.sin(this.time * 6) * 0.06)
        const pg = ctx.createLinearGradient(0, -26, 0, 0)
        pg.addColorStop(0, '#ff8fab')
        pg.addColorStop(1, '#c084ff')
        ctx.fillStyle = pg
        ctx.beginPath()
        ctx.moveTo(-11, 0)
        ctx.lineTo(0, -26)
        ctx.lineTo(11, 0)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = '#ffd24a'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(-7, -9)
        ctx.lineTo(7, -11)
        ctx.moveTo(-4, -17)
        ctx.lineTo(4, -18.5)
        ctx.stroke()
        ctx.fillStyle = '#ffd24a'
        ctx.beginPath()
        ctx.arc(0, -27, 4, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 'crown':
        ctx.fillStyle = '#ffd24a'
        ctx.beginPath()
        ctx.moveTo(-13, 0)
        ctx.lineTo(-13, -10)
        ctx.lineTo(-7, -5)
        ctx.lineTo(-4, -14)
        ctx.lineTo(0, -6)
        ctx.lineTo(4, -14)
        ctx.lineTo(7, -5)
        ctx.lineTo(13, -10)
        ctx.lineTo(13, 0)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#ff5a5f'
        ctx.beginPath()
        ctx.arc(0, -4, 2.4, 0, Math.PI * 2)
        ctx.fill()
        break
    }
    ctx.restore()
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const a = 1 - p.life / p.max
      ctx.save()
      ctx.globalAlpha = a
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  private renderFloats(ctx: CanvasRenderingContext2D): void {
    for (const f of this.floats) {
      const a = 1 - f.life / 1.1
      ctx.save()
      ctx.globalAlpha = a
      ctx.font = `bold ${f.size}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 4
      ctx.strokeText(f.text, f.x, f.y)
      ctx.fillStyle = f.color
      ctx.fillText(f.text, f.x, f.y)
      ctx.restore()
    }
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
  }
}
