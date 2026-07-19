/**
 * Seeded, deterministic procedural obby generator (Obby 4+ and Weekly Challenge).
 * A given seed always produces the exact same course.
 *
 * Difficulty philosophy: gaps use ~55–70% of the jump distance at the required
 * level's speed, so entering at exactly the required level is comfortable.
 * Challenge comes from spikes, movers and timing — never barely-makeable jumps.
 * `verifyObby` / `verifyCoins` re-check the math (pads counted at min width).
 */

import {
  JUMP_AIRTIME,
  JUMP_HEIGHT,
  OBBIES,
  levelThreshold,
  runSpeedFor,
  type Hazard,
  type MovingPlatformDef,
  type ObbyDef,
  type PadDef,
  type Platform,
} from './levels'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PALETTES: Array<{ color: string; top: string; bottom: string }> = [
  { color: '#ff9aa2', top: '#ffd3e0', bottom: '#fff1d6' },
  { color: '#ffb26b', top: '#ffe0b3', bottom: '#e8f7ff' },
  { color: '#7ee0d2', top: '#c9f7ef', bottom: '#fff3d1' },
  { color: '#a78bfa', top: '#e2d4ff', bottom: '#ffe4ef' },
  { color: '#f9f871', top: '#fdf6c9', bottom: '#dff4ff' },
  { color: '#6ee7b7', top: '#c8f7e2', bottom: '#fff0e0' },
]

/** Fraction of the true max jump that generated gaps may use: 55% → 70%. */
function gapUtilization(reqLevel: number): number {
  return Math.min(0.55 + Math.max(0, reqLevel - 4) * 0.015, 0.7)
}

/** Win reward for generated obbies: Obby 4 = 25, doubling each obby. */
export function generatedObbyReward(id: number): number {
  return 25 * Math.pow(2, id - 4)
}

const generated = new Map<number, ObbyDef>()

/** Hand-made for ids 1–3, deterministic generation beyond. */
export function getObby(id: number): ObbyDef {
  if (id >= 1 && id <= OBBIES.length) return OBBIES[id - 1]
  let def = generated.get(id)
  if (!def) {
    def = generateObby(id)
    generated.set(id, def)
  }
  return def
}

export function generateObby(id: number): ObbyDef {
  const palette = PALETTES[id % PALETTES.length]
  return generateSeededObby({
    id,
    seed: id * 7919 + 13,
    reqLevel: id,
    name: `Obby ${id}`,
    reward: generatedObbyReward(id),
    color: palette.color,
    skyTop: palette.top,
    skyBottom: palette.bottom,
  })
}

export interface SeedObbyOpts {
  id: number
  seed: number
  reqLevel: number
  name: string
  reward: number
  color: string
  skyTop: string
  skyBottom: string
}

/** Core generator used by both numbered obbies and the weekly challenge. */
export function generateSeededObby(o: SeedObbyOpts): ObbyDef {
  const rng = mulberry32(o.seed)
  const reqSpeed = levelThreshold(o.reqLevel)
  const jumpLen = runSpeedFor(reqSpeed) * JUMP_AIRTIME
  const maxGap = jumpLen * gapUtilization(o.reqLevel)

  const segments = Math.min(5 + o.reqLevel, 16)
  const spikeChance = clampNum(0.22 + (o.reqLevel - 4) * 0.02, 0.18, 0.45)
  const moverChance = clampNum(0.15 + o.reqLevel * 0.03, 0.2, 0.45)
  const moverSpeed = Math.min(1.5 + o.reqLevel * 0.12, 3.2)

  const platforms: Platform[] = []
  const pads: PadDef[] = []
  const movers: MovingPlatformDef[] = []
  const spikes: Hazard[] = []
  const coins: Array<{ x: number; y: number }> = []

  // start platform
  platforms.push({ x: -100, y: 620, w: 520, h: 40 })
  let x = 420
  let y = 620

  for (let s = 0; s < segments; s++) {
    const isMover = rng() < moverChance
    if (isMover) {
      // Two feasible hops joined by a mover at the midpoint.
      const total = maxGap * 1.5
      const range = maxGap * 0.35
      const my = clampY(y + (rng() * 80 - 40))
      movers.push({
        x: x + total / 2 - 60,
        y: my,
        w: 120,
        h: 24,
        axis: rng() < 0.6 ? 'x' : 'y',
        range,
        speed: moverSpeed,
        phase: rng() * Math.PI * 2,
      })
      if (rng() < 0.7) coins.push({ x: x + total / 2, y: my - 60 })
      x += total
      y = clampY(my + (rng() * 60 - 30))
      // breathing pad after a mover hop — friendly landing
      const w = 190 + rng() * 50
      pads.push({ x, y, w, h: 26, phase: rng() * Math.PI * 2, speed: 1.2 + rng() * 0.8 })
      x += w
    } else {
      const gap = maxGap * (0.5 + rng() * 0.45)
      x += gap
      const dy = rng() * 160 - 100
      y = clampY(y + Math.max(dy, -(JUMP_HEIGHT - 60)))
      // pads show up generously, and always after a big gap
      const makePad = gap > maxGap * 0.8 || rng() < 0.35
      if (makePad) {
        const w = 190 + rng() * 50
        pads.push({ x, y, w, h: 26, phase: rng() * Math.PI * 2, speed: 1.2 + rng() * 0.8 })
        if (rng() < 0.6) coins.push({ x: x + w / 2, y: y - 55 })
        x += w
      } else {
        const w = 170 + rng() * 60
        platforms.push({ x, y, w, h: 32 })
        if (rng() < spikeChance && w >= 170) {
          const sw = 50 + rng() * 20
          spikes.push({ x: x + w / 2 - sw / 2, y, w: sw, h: 22, type: 'spikes' })
          if (rng() < 0.8) coins.push({ x: x + w / 2, y: y - 70 })
        } else if (rng() < 0.6) {
          const n = 1 + Math.floor(rng() * 2.4)
          for (let c = 0; c < n; c++) {
            coins.push({ x: x + w / 2 + (c - (n - 1) / 2) * 34, y: y - 45 - (c % 2) * 18 })
          }
        }
        x += w
      }
    }
  }

  // trophy platform
  const finalGap = maxGap * (0.55 + rng() * 0.3)
  x += finalGap
  platforms.push({ x, y: 620, w: 460, h: 40 })
  coins.push({ x: x + 80, y: 575 }, { x: x + 380, y: 575 })
  const trophy = { x: x + 230, y: 620 }
  const width = x + 460 + 60

  return {
    id: o.id,
    name: o.name,
    reqLevel: o.reqLevel,
    reward: o.reward,
    color: o.color,
    skyTop: o.skyTop,
    skyBottom: o.skyBottom,
    width,
    generated: true,
    start: { x: 120, y: 620 },
    platforms,
    pads,
    movers,
    hazards: [...spikes, { x: -400, y: 800, w: width + 800, h: 300, type: 'lava' }],
    trophy,
    coins,
  }
}

function clampY(y: number): number {
  return Math.max(400, Math.min(660, y))
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Pads as worst-case (minimum-width) platforms for feasibility math. */
function padsAsPlatforms(def: ObbyDef): Platform[] {
  return def.pads.map((p) => {
    const minW = p.w * 0.6
    const cx = p.x + p.w / 2
    return { x: cx - minW / 2, y: p.y, w: minW, h: p.h }
  })
}

export interface VerifyResult {
  ok: boolean
  issues: string[]
  maxGapFound: number
  maxGapAllowed: number
}

/**
 * Re-verify a course: every consecutive static gap (pads at min width) must
 * fit inside the jump range at the required level's speed with ≥5% headroom,
 * and step-ups must fit under the jump height with headroom. Mover gaps are
 * feasible by construction (each hop ≤ 0.75×maxGap − range).
 */
export function verifyObby(def: ObbyDef): VerifyResult {
  const jumpLen = runSpeedFor(levelThreshold(def.reqLevel)) * JUMP_AIRTIME
  const hardGap = jumpLen * 0.95
  const hardStepUp = JUMP_HEIGHT - 40
  const issues: string[] = []
  let maxGapFound = 0

  const sorted = [...def.platforms, ...padsAsPlatforms(def)].sort((a, b) => a.x - b.x)
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    const gap = b.x - (a.x + a.w)
    const bridged = def.movers.some((m) => m.x > a.x && m.x + m.w < b.x + b.w)
    if (!bridged) {
      maxGapFound = Math.max(maxGapFound, gap)
      if (gap > hardGap) {
        issues.push(`gap ${Math.round(gap)}px between platforms ${i}→${i + 1} exceeds ${Math.round(hardGap)}px`)
      }
      const stepUp = a.y - b.y
      if (stepUp > hardStepUp) {
        issues.push(`step-up ${Math.round(stepUp)}px at platform ${i + 1} exceeds ${Math.round(hardStepUp)}px`)
      }
    }
  }
  return { ok: issues.length === 0, issues, maxGapFound, maxGapAllowed: hardGap }
}

/**
 * Every coin must hover within the jump envelope of some platform, pad or
 * mover: horizontally over/near it (±30px) and ≤150px above it
 * (jump height is 169px, so 150px leaves headroom).
 */
export function verifyCoins(def: ObbyDef): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const flats = [...def.platforms, ...def.pads.map((p) => ({ x: p.x, y: p.y, w: p.w }))]
  def.coins.forEach((c, i) => {
    const overPlatform = flats.some(
      (p) => c.x >= p.x - 30 && c.x <= p.x + p.w + 30 && c.y <= p.y - 5 && c.y >= p.y - 150,
    )
    const overMover = def.movers.some((m) => {
      const minX = m.axis === 'x' ? m.x - m.range : m.x
      const maxX = m.axis === 'x' ? m.x + m.range + m.w : m.x + m.w
      const minY = m.axis === 'y' ? m.y - m.range : m.y
      const maxY = m.axis === 'y' ? m.y + m.range : m.y
      return c.x >= minX - 30 && c.x <= maxX + 30 && c.y <= maxY - 5 && c.y >= minY - 150
    })
    if (!overPlatform && !overMover) {
      issues.push(`coin ${i} at (${Math.round(c.x)}, ${Math.round(c.y)}) is unreachable`)
    }
  })
  return { ok: issues.length === 0, issues }
}
