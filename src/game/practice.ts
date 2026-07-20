/**
 * Infinite practice mode: seeded, deterministic challenge segments appended
 * endlessly after the hand-built drill course. Worst-case gaps (breathing
 * pads counted at their minimum width) stay ≤150px so even a speed-0
 * dumpling (jump ≈ 180px) can always continue; difficulty scales gently
 * through movers, spikes and pads instead of distance.
 * No rewards, no records, no finish — R to escape.
 */

import type { Hazard, MovingPlatformDef, PadDef, Platform } from './levels'

export interface PracticeSegment {
  platforms: Platform[]
  pads: PadDef[]
  movers: MovingPlatformDef[]
  hazards: Hazard[]
  /** checkpoint flag at the segment's start platform */
  checkpoint: { x: number; y: number }
  /** end x of the segment (start of the next gap) */
  endX: number
  endY: number
  /** how much the last element shrinks the next reported gap (0.2·w for pads) */
  endShrink: number
}

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

const SEGMENT_SEED = 0x9e3779b9
/** Worst-case gap between landing surfaces (pads at min width), px. */
const EFF_MAX_GAP = 150

function clampY(y: number): number {
  return Math.max(430, Math.min(650, y))
}

/**
 * Build practice segment `index` (1-based) starting after a gap from
 * (startX, startY). `startShrink` is the previous segment's endShrink.
 * Deterministic per (index, startX, startY, startShrink).
 */
export function makePracticeSegment(
  index: number,
  startX: number,
  startY: number,
  startShrink = 0,
): PracticeSegment {
  const rng = mulberry32(SEGMENT_SEED + index * 31337)
  const t = Math.min(1, index / 24) // difficulty ramp 0 → 1 over 24 segments
  const spikeChance = 0.25 + t * 0.3
  const moverChance = 0.2 + t * 0.3
  const padChance = 0.3 + t * 0.2
  const hops = 3 + Math.floor(rng() * 2.4) // 3–4 hops per segment

  const platforms: Platform[] = []
  const pads: PadDef[] = []
  const movers: MovingPlatformDef[] = []
  const hazards: Hazard[] = []

  // entry hop onto the segment's start platform (hosts the checkpoint flag)
  let x = startX + Math.max(50, (EFF_MAX_GAP - startShrink) * (0.55 + rng() * 0.4))
  let y = clampY(startY + (rng() * 120 - 80))
  const startPlat = { x, y, w: 300, h: 40 }
  platforms.push(startPlat)
  const checkpoint = { x: x + 150, y }
  x += 300
  let prevShrink = 0

  for (let h = 0; h < hops; h++) {
    y = clampY(y + (rng() * 140 - 90))
    const roll = rng()
    if (roll < moverChance) {
      // mover bridging a wider span — hop on, ride, hop off
      const gap = 120 + rng() * 80
      x += gap
      movers.push({
        x: x - gap / 2 - 60,
        y: clampY(y + 20),
        w: 120,
        h: 24,
        axis: rng() < 0.6 ? 'x' : 'y',
        range: 50 + t * 40,
        speed: 1.4 + t * 1 + rng() * 0.5,
        phase: rng() * Math.PI * 2,
      })
      const w = 190 + rng() * 60
      platforms.push({ x, y, w, h: 32 })
      x += w
      prevShrink = 0
    } else if (roll < moverChance + padChance) {
      const w = 190 + rng() * 50
      const shrinkCur = 0.2 * w // pads are verified at 60% width (centered)
      const gap = Math.max(40, (EFF_MAX_GAP - prevShrink - shrinkCur) * (0.6 + rng() * 0.4))
      x += gap
      pads.push({ x, y, w, h: 26, phase: rng() * Math.PI * 2, speed: 1.2 + rng() * 0.8 })
      x += w
      prevShrink = shrinkCur
    } else {
      const w = 180 + rng() * 60
      const gap = Math.max(40, (EFF_MAX_GAP - prevShrink) * (0.6 + rng() * 0.4))
      x += gap
      platforms.push({ x, y, w, h: 32 })
      if (rng() < spikeChance) {
        const sw = 50 + rng() * 20
        hazards.push({ x: x + w / 2 - sw / 2, y, w: sw, h: 22, type: 'spikes' })
      }
      x += w
      prevShrink = 0
    }
  }

  return { platforms, pads, movers, hazards, checkpoint, endX: x, endY: y, endShrink: prevShrink }
}
