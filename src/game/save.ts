/**
 * Save v6 — migrates gracefully from v1 ({speed, wins, mult, muted}),
 * v2 (+ rebirths, records, achievements, settings),
 * v3 (+ pets, coins, cosmetics), v4 (+ weeklyBest),
 * v5 (+ ghost replays + ghost setting).
 * v6 adds per-obby medal counts (win-based progression).
 *
 * Storage: up to 5 save slots. Each slot lives under its own localStorage key
 * (`sde-save-slot-N`) holding a full SaveData; a small index key
 * (`sde-save-index`) tracks the active slot and per-slot display names.
 * The legacy single save (`speed-dumpling-escape-save-v1`) is migrated into
 * Slot 1 on first load.
 */

import { getObby } from './generator'
import { levelForSpeed, medalsForTime } from './levels'

/** Ghost replay sample: [t, x, y, facing, airborne] recorded at ~10Hz. */
export type GhostSample = [number, number, number, number, number]

export interface Settings {
  musicVol: number // 0..1
  sfxVol: number // 0..1
  shake: boolean
  particles: 'high' | 'low'
  ghost: boolean
}

export interface SaveData {
  speed: number
  wins: number
  mult: number
  muted: boolean
  rebirths: number
  maxObbyCompleted: number
  bestTimes: Record<string, number> // obby id -> seconds
  highestSpeed: number
  highestLevel: number
  totalPlayTime: number // seconds
  achievements: string[]
  settings: Settings
  // v3: pets + economy + cosmetics
  coins: number
  equippedPet: string | null
  ownedHats: string[]
  equippedHat: string | null
  ownedTrails: string[]
  equippedTrail: string
  charms: number
  // v4: weekly challenge (weekKey -> best seconds; key presence = completed that week)
  weeklyBest: Record<string, number>
  // v5: ghost replays for current bests (obby id, or "w:<weekKey>" for weekly)
  ghosts: Record<string, GhostSample[]>
  // v6: medals per obby (obby id -> 0..3: finish 🥉, target 🥈, stretch 🥇)
  medals: Record<string, number>
}

export const SLOT_COUNT = 5
const LEGACY_KEY = 'speed-dumpling-escape-save-v1'
const INDEX_KEY = 'sde-save-index'
const slotKey = (n: number): string => `sde-save-slot-${n}`

export const DEFAULT_SETTINGS: Settings = {
  musicVol: 0.8,
  sfxVol: 1,
  shake: true,
  particles: 'high',
  ghost: true,
}

export const DEFAULT_SAVE: SaveData = {
  speed: 0,
  wins: 0,
  mult: 1,
  muted: false,
  rebirths: 0,
  maxObbyCompleted: 0,
  bestTimes: {},
  highestSpeed: 0,
  highestLevel: 0,
  totalPlayTime: 0,
  achievements: [],
  settings: { ...DEFAULT_SETTINGS },
  coins: 0,
  equippedPet: null,
  ownedHats: [],
  equippedHat: null,
  ownedTrails: [],
  equippedTrail: 'default',
  charms: 0,
  weeklyBest: {},
  ghosts: {},
  medals: {},
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : []
}

/** Backfill v6 medals from recorded best times (existing players keep progress). */
function migrateMedals(p: Partial<SaveData>): Record<string, number> {
  const medals: Record<string, number> = {}
  if (p.medals && typeof p.medals === 'object') {
    for (const [k, v] of Object.entries(p.medals)) {
      if (typeof v === 'number') medals[k] = Math.max(0, Math.min(3, Math.floor(v)))
    }
  }
  const best = p.bestTimes && typeof p.bestTimes === 'object' ? p.bestTimes : {}
  for (const [k, t] of Object.entries(best)) {
    const id = Number(k)
    if (!Number.isInteger(id) || id < 1 || typeof t !== 'number') continue
    try {
      medals[k] = Math.max(medals[k] ?? 0, medalsForTime(getObby(id), t))
    } catch {
      medals[k] = Math.max(medals[k] ?? 0, 1)
    }
  }
  return medals
}

function parseSave(raw: string): SaveData {
  const p = JSON.parse(raw) as Partial<SaveData> & { settings?: Partial<Settings> }
  return {
    speed: num(p.speed, 0),
    wins: num(p.wins, 0),
    mult: num(p.mult, 1),
    muted: typeof p.muted === 'boolean' ? p.muted : false,
    rebirths: num(p.rebirths, 0),
    maxObbyCompleted: num(p.maxObbyCompleted, 0),
    bestTimes:
      p.bestTimes && typeof p.bestTimes === 'object' ? (p.bestTimes as Record<string, number>) : {},
    highestSpeed: num(p.highestSpeed, num(p.speed, 0)),
    highestLevel: num(p.highestLevel, 0),
    totalPlayTime: num(p.totalPlayTime, 0),
    achievements: strArr(p.achievements),
    settings: {
      musicVol: num(p.settings?.musicVol, DEFAULT_SETTINGS.musicVol),
      sfxVol: num(p.settings?.sfxVol, DEFAULT_SETTINGS.sfxVol),
      shake: typeof p.settings?.shake === 'boolean' ? p.settings.shake : true,
      particles: p.settings?.particles === 'low' ? 'low' : 'high',
      ghost: typeof p.settings?.ghost === 'boolean' ? p.settings.ghost : true,
    },
    coins: num(p.coins, 0),
    equippedPet: typeof p.equippedPet === 'string' ? p.equippedPet : null,
    ownedHats: strArr(p.ownedHats),
    equippedHat: typeof p.equippedHat === 'string' ? p.equippedHat : null,
    ownedTrails: strArr(p.ownedTrails),
    equippedTrail: typeof p.equippedTrail === 'string' ? p.equippedTrail : 'default',
    charms: Math.min(5, num(p.charms, 0)),
    weeklyBest:
      p.weeklyBest && typeof p.weeklyBest === 'object'
        ? (p.weeklyBest as Record<string, number>)
        : {},
    ghosts:
      p.ghosts && typeof p.ghosts === 'object'
        ? (p.ghosts as Record<string, GhostSample[]>)
        : {},
    medals: migrateMedals(p),
  }
}

// ---------------- slot index ----------------

export interface SaveIndex {
  /** 1-based active slot. */
  active: number
  /** Display name per slot (null = unnamed). */
  names: Array<string | null>
}

function readRawIndex(): SaveIndex | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<SaveIndex>
    const names = Array.isArray(p.names) ? p.names.slice(0, SLOT_COUNT) : []
    while (names.length < SLOT_COUNT) names.push(null)
    const active = num(p.active, 1)
    return {
      active: active >= 1 && active <= SLOT_COUNT ? Math.floor(active) : 1,
      names: names.map((n) => (typeof n === 'string' && n.trim() ? n.slice(0, 24) : null)),
    }
  } catch {
    return null
  }
}

function writeIndex(idx: SaveIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx))
  } catch {
    // storage unavailable
  }
}

/**
 * Load the slot index, migrating the legacy single save into Slot 1 the
 * first time a v6 client runs.
 */
export function loadIndex(): SaveIndex {
  let idx = readRawIndex()
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy != null && localStorage.getItem(slotKey(1)) == null) {
      localStorage.setItem(slotKey(1), legacy) // same shape; parseSave migrates in place
      localStorage.removeItem(LEGACY_KEY)
      if (!idx) idx = { active: 1, names: Array(SLOT_COUNT).fill(null) }
      writeIndex(idx)
    }
  } catch {
    // storage unavailable
  }
  return idx ?? { active: 1, names: Array(SLOT_COUNT).fill(null) }
}

export function getActiveSlot(): number {
  return loadIndex().active
}

export function setActiveSlot(n: number): void {
  const idx = loadIndex()
  idx.active = Math.max(1, Math.min(SLOT_COUNT, Math.floor(n)))
  writeIndex(idx)
}

export function renameSlot(n: number, name: string): void {
  const idx = loadIndex()
  idx.names[n - 1] = name.trim() ? name.trim().slice(0, 24) : null
  writeIndex(idx)
}

export function slotName(n: number): string {
  return loadIndex().names[n - 1] ?? `Player ${n}`
}

// ---------------- per-slot save access ----------------

export function loadSave(slot = getActiveSlot()): SaveData {
  try {
    const raw = localStorage.getItem(slotKey(slot))
    if (!raw) return structuredClone(DEFAULT_SAVE)
    return parseSave(raw)
  } catch {
    return structuredClone(DEFAULT_SAVE)
  }
}

export function storeSave(data: SaveData, slot = getActiveSlot()): void {
  try {
    localStorage.setItem(slotKey(slot), JSON.stringify(data))
  } catch {
    // storage unavailable — play session continues unsaved
  }
}

export function hasSave(slot = getActiveSlot()): boolean {
  try {
    return localStorage.getItem(slotKey(slot)) != null
  } catch {
    return false
  }
}

/** Delete a slot's save. If it was active, fall back to the first used slot. */
export function deleteSlot(n: number): void {
  try {
    localStorage.removeItem(slotKey(n))
    const idx = loadIndex()
    if (idx.active === n) {
      let fallback = 1
      for (let i = 1; i <= SLOT_COUNT; i++) {
        if (i !== n && localStorage.getItem(slotKey(i)) != null) {
          fallback = i
          break
        }
      }
      idx.active = fallback
      writeIndex(idx)
    }
  } catch {
    // ignore
  }
}

export interface SlotSummary {
  slot: number
  name: string
  exists: boolean
  level: number
  wins: number
  rebirths: number
  medals: number // total medals earned (0..3 per obby)
  playTime: number
}

/** Title-screen summary for one slot (null when empty). */
export function slotSummary(n: number): SlotSummary {
  const name = slotName(n)
  if (!hasSave(n)) {
    return { slot: n, name, exists: false, level: 0, wins: 0, rebirths: 0, medals: 0, playTime: 0 }
  }
  const s = loadSave(n)
  return {
    slot: n,
    name,
    exists: true,
    level: levelForSpeed(s.speed).level,
    wins: s.wins,
    rebirths: s.rebirths,
    medals: Object.values(s.medals).reduce((a, b) => a + b, 0),
    playTime: s.totalPlayTime,
  }
}

/** Format seconds as m:ss.t (or h:mm:ss for long play times). */
export function fmtTime(sec: number): string {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m > 0) return `${m}:${s.toFixed(1).padStart(4, '0')}`
  return `${s.toFixed(1)}s`
}
