/** Progression constants: infinite levels, multiplier tiers, obby types. */

export interface LevelDef {
  level: number
  speed: number
  color: string
  name: string
}

/** Fixed identity for the first five levels (0 = base cream dumpling). */
const BASE_LEVELS: Array<{ speed: number; color: string; name: string }> = [
  { speed: 0, color: '#fff3df', name: 'Cream' },
  { speed: 100, color: '#8be06a', name: 'Green' },
  { speed: 300, color: '#6cc4ff', name: 'Blue' },
  { speed: 750, color: '#c084ff', name: 'Purple' },
  { speed: 1500, color: '#ffd24a', name: 'Gold' },
]

const EXTRA_NAMES = [
  'Radiant', 'Blazing', 'Turbo', 'Cosmic', 'Hyper', 'Ultra',
  'Mega', 'Stellar', 'Nova', 'Quantum', 'Inferno', 'Celestial',
]

/** Round to 2 significant digits so thresholds stay "nice" (7300, 16K, 35K...). */
function niceRound(n: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1)
  return Math.round(n / mag) * mag
}

/** Speed required to REACH `level`. Grows ~2.2× per level past Level 4. */
export function levelThreshold(level: number): number {
  if (level <= 0) return 0
  if (level <= 4) return BASE_LEVELS[level].speed
  return niceRound(1500 * Math.pow(2.2, level - 4))
}

export function levelForSpeed(speed: number): LevelDef {
  let level = 0
  while (speed >= levelThreshold(level + 1)) level++
  return levelDefFor(level)
}

export function levelDefFor(level: number): LevelDef {
  if (level < BASE_LEVELS.length) {
    const b = BASE_LEVELS[level]
    return { level, speed: b.speed, color: b.color, name: b.name }
  }
  const hue = (level * 47 + 160) % 360
  return {
    level,
    speed: levelThreshold(level),
    color: `hsl(${hue}, 80%, 62%)`,
    name: EXTRA_NAMES[(level - 5) % EXTRA_NAMES.length],
  }
}

export function nextLevelFor(speed: number): LevelDef {
  const cur = levelForSpeed(speed)
  return levelDefFor(cur.level + 1)
}

/** Milestone visual skins unlocked at high levels. */
export type MilestoneSkin = 'sparkle' | 'flame' | 'rainbow' | 'galaxy' | null

export function skinForLevel(level: number): MilestoneSkin {
  if (level >= 20) return 'galaxy'
  if (level >= 15) return 'rainbow'
  if (level >= 10) return 'flame'
  if (level >= 5) return 'sparkle'
  return null
}

/** Compact number formatting: 12.5K, 1.2M, ... */
export function fmt(n: number): string {
  if (n < 1000) return `${Math.floor(n)}`
  const units = ['K', 'M', 'B', 'T', 'Q']
  let u = -1
  let v = n
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u++
  }
  const rounded = v >= 100 ? `${Math.round(v)}` : v.toFixed(1).replace(/\.0$/, '')
  return `${rounded}${units[u]}`
}

export interface MultTier {
  mult: number
  wins: number
}

export const MULT_TIERS: MultTier[] = [
  { mult: 2, wins: 3 },
  { mult: 5, wins: 15 },
  { mult: 10, wins: 40 },
]

/** Next tier above the current multiplier, if any. */
export function nextMultTier(currentMult: number): MultTier | null {
  for (const t of MULT_TIERS) if (currentMult < t.mult) return t
  return null
}

/** Run speed in px/s derived from the speed stat. */
export function runSpeedFor(speed: number): number {
  return Math.min(2200, 240 + speed * 1.2)
}

// ---- shared world/physics constants (used by game + generator) ----

export const GRAV = 2400
export const JUMP_V = 900
/** Full jump airtime (up + back down to the same height), seconds. */
export const JUMP_AIRTIME = (2 * JUMP_V) / GRAV
/** Max jump height in px. */
export const JUMP_HEIGHT = (JUMP_V * JUMP_V) / (2 * GRAV)

export interface Platform {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Breathing landing pad: smoothly scales between ~60% and ~130% of base width
 * on a sine cycle (staggered phases). Collision follows the animated size.
 */
export interface PadDef {
  x: number
  y: number
  w: number
  h: number
  phase: number
  speed: number
}

/** Width scale of a pad at a given time (0.6 – 1.3). */
export function padScale(pad: PadDef, time: number): number {
  return 0.95 + 0.35 * Math.sin(time * pad.speed + pad.phase)
}

export interface MovingPlatformDef {
  x: number
  y: number
  w: number
  h: number
  axis: 'x' | 'y'
  range: number
  speed: number
  phase?: number
}

export interface Hazard {
  x: number
  y: number
  w: number
  h: number
  type: 'spikes' | 'lava'
}

export interface ObbyDef {
  id: number
  name: string
  reqLevel: number
  reward: number
  color: string
  skyTop: string
  skyBottom: string
  width: number
  generated: boolean
  start: { x: number; y: number }
  platforms: Platform[]
  pads: PadDef[]
  movers: MovingPlatformDef[]
  hazards: Hazard[]
  trophy: { x: number; y: number }
  coins: Array<{ x: number; y: number }>
}

const LAVA_H = 300
const LAVA_Y = 800

function obby(
  id: number,
  reqLevel: number,
  reward: number,
  color: string,
  skyTop: string,
  skyBottom: string,
  width: number,
  platforms: Platform[],
  pads: PadDef[],
  movers: MovingPlatformDef[],
  spikes: Hazard[],
  trophy: { x: number; y: number },
  coins: Array<{ x: number; y: number }>,
): ObbyDef {
  return {
    id,
    name: `Obby ${id}`,
    reqLevel,
    reward,
    color,
    skyTop,
    skyBottom,
    width,
    generated: false,
    start: { x: 120, y: 620 },
    platforms,
    pads,
    movers,
    hazards: [...spikes, { x: -400, y: LAVA_Y, w: width + 800, h: LAVA_H, type: 'lava' }],
    trophy,
    coins,
  }
}

/**
 * Hand-crafted obbies 1–3 (ids beyond this are procedurally generated).
 * Gaps are tuned to ~55–70% of the jump distance at the required level so
 * entering at exactly the required level feels comfortable; challenge comes
 * from spikes, movers and timing.
 */
export const OBBIES: ObbyDef[] = [
  // Obby 1 — req Lv 1 (jump ≈ 270px; gaps ≤ 180)
  obby(
    1,
    1,
    1,
    '#8be06a',
    '#bfe9ff',
    '#ffe9c9',
    3250,
    [
      { x: -100, y: 620, w: 520, h: 40 },
      { x: 600, y: 580, w: 210, h: 32 },
      { x: 990, y: 540, w: 210, h: 32 },
      { x: 1970, y: 500, w: 200, h: 32 },
      { x: 2730, y: 620, w: 460, h: 40 },
    ],
    [
      { x: 1560, y: 560, w: 230, h: 26, phase: 0.5, speed: 1.5 },
      { x: 2350, y: 460, w: 200, h: 26, phase: 2.4, speed: 1.3 },
    ],
    [{ x: 1300, y: 500, w: 120, h: 24, axis: 'x', range: 100, speed: 1.4 }],
    [{ x: 1050, y: 540, w: 60, h: 22, type: 'spikes' }],
    { x: 2920, y: 620 },
    [
      { x: 705, y: 535 },
      { x: 1080, y: 490 },
      { x: 1360, y: 455 },
      { x: 1675, y: 505 },
      { x: 2070, y: 455 },
      { x: 2450, y: 405 },
      { x: 2840, y: 575 },
    ],
  ),
  // Obby 2 — req Lv 2 (jump ≈ 450px; gaps ≤ 300)
  obby(
    2,
    2,
    3,
    '#6cc4ff',
    '#a8d8ff',
    '#ffd9e8',
    3740,
    [
      { x: -100, y: 620, w: 520, h: 40 },
      { x: 700, y: 580, w: 200, h: 32 },
      { x: 1180, y: 520, w: 200, h: 32 },
      { x: 2260, y: 500, w: 200, h: 32 },
      { x: 3220, y: 620, w: 460, h: 40 },
    ],
    [
      { x: 1780, y: 560, w: 220, h: 26, phase: 1.2, speed: 1.6 },
      { x: 2740, y: 560, w: 220, h: 26, phase: 3.1, speed: 1.4 },
    ],
    [{ x: 1520, y: 480, w: 120, h: 24, axis: 'y', range: 110, speed: 1.6, phase: 1 }],
    [
      { x: 1260, y: 520, w: 60, h: 22, type: 'spikes' },
      { x: 2330, y: 500, w: 60, h: 22, type: 'spikes' },
    ],
    { x: 3400, y: 620 },
    [
      { x: 800, y: 535 },
      { x: 1290, y: 465 },
      { x: 1580, y: 425 },
      { x: 1890, y: 505 },
      { x: 2360, y: 445 },
      { x: 2850, y: 505 },
      { x: 3320, y: 575 },
      { x: 3500, y: 575 },
    ],
  ),
  // Obby 3 — req Lv 3 (jump ≈ 855px; gaps ≤ 560)
  obby(
    3,
    3,
    10,
    '#c084ff',
    '#d9b8ff',
    '#ffe0b3',
    5290,
    [
      { x: -100, y: 620, w: 520, h: 40 },
      { x: 940, y: 560, w: 200, h: 32 },
      { x: 1780, y: 540, w: 200, h: 32 },
      { x: 2500, y: 480, w: 200, h: 32 },
      { x: 4770, y: 620, w: 460, h: 40 },
    ],
    [
      { x: 3330, y: 560, w: 230, h: 26, phase: 0.8, speed: 1.5 },
      { x: 4050, y: 500, w: 230, h: 26, phase: 2.9, speed: 1.7 },
    ],
    [
      { x: 1370, y: 500, w: 120, h: 24, axis: 'x', range: 160, speed: 1.8 },
      { x: 2930, y: 480, w: 120, h: 24, axis: 'y', range: 150, speed: 2.0, phase: 2 },
    ],
    [
      { x: 1850, y: 540, w: 60, h: 22, type: 'spikes' },
      { x: 2580, y: 480, w: 60, h: 22, type: 'spikes' },
    ],
    { x: 4960, y: 620 },
    [
      { x: 1040, y: 515 },
      { x: 1430, y: 450 },
      { x: 1880, y: 480 },
      { x: 2610, y: 425 },
      { x: 2990, y: 420 },
      { x: 3445, y: 505 },
      { x: 4165, y: 445 },
      { x: 4870, y: 575 },
      { x: 5050, y: 575 },
    ],
  ),
]
