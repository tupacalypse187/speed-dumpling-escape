/** Weekly Challenge: ISO-week-seeded course that rotates every Monday. */

import { generateSeededObby } from './generator'
import type { ObbyDef } from './levels'

/** ISO-8601 week key, e.g. "2026-W29". */
export function currentWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / 604800000)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Milliseconds until next Monday 00:00 local time. */
export function msUntilNextWeek(d = new Date()): number {
  const dayNum = (d.getDay() + 6) % 7 // Monday = 0
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (7 - dayNum), 0, 0, 0, 0)
  return Math.max(0, next.getTime() - d.getTime())
}

export function fmtCountdown(ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${mins}m left`
  return `${mins}m left`
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Requirement so the weekly is almost always enterable. */
export function weeklyReqLevel(playerLevel: number): number {
  return Math.max(1, playerLevel - 1)
}

/**
 * Build this week's course. The shape is seeded by the ISO week (plus the
 * requirement level), so same week + same level = identical course everywhere.
 */
export function makeWeeklyObby(playerLevel: number, weekKey: string): ObbyDef {
  const req = weeklyReqLevel(playerLevel)
  return generateSeededObby({
    id: -1,
    seed: hashStr(weekKey) + req * 104729,
    reqLevel: req,
    name: 'Weekly Challenge',
    reward: 0, // custom coin payout handled on completion
    color: '#ffd24a',
    skyTop: '#ffe9a8',
    skyBottom: '#ffd9e8',
  })
}

/** First completion each week pays big; repeats pay a small amount. */
export function weeklyCoinReward(playerLevel: number, firstThisWeek: boolean): number {
  return firstThisWeek ? 50 + 25 * playerLevel : 15
}

/** Weekly grants a small fixed win bonus instead of scaling obby wins. */
export const WEEKLY_WIN_REWARD = 2
