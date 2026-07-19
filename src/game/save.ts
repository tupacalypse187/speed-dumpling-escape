/**
 * Save v5 — migrates gracefully from v1 ({speed, wins, mult, muted}),
 * v2 (+ rebirths, records, achievements, settings),
 * v3 (+ pets, coins, cosmetics), v4 (+ weeklyBest).
 * v5 adds ghost replays + the ghost visibility setting.
 */

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
}

const KEY = 'speed-dumpling-escape-save-v1' // same key; shape migrated in place

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
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : []
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULT_SAVE)
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
    }
  } catch {
    return structuredClone(DEFAULT_SAVE)
  }
}

export function storeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // storage unavailable — play session continues unsaved
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(KEY) != null
  } catch {
    return false
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
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
