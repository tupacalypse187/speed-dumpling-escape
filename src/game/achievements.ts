/** Achievement definitions + unlock checking. */

export interface AchievementDef {
  id: string
  icon: string
  name: string
  desc: string
}

export interface AchievementContext {
  speed: number
  wins: number
  mult: number
  rebirths: number
  level: number
  highestSpeed: number
  highestLevel: number
  maxObbyCompleted: number
  totalPlayTime: number
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-speed', icon: '👣', name: 'First Steps', desc: 'Gain your first speed point' },
  { id: 'level-1', icon: '🟢', name: 'Green Machine', desc: 'Reach Level 1' },
  { id: 'first-win', icon: '🏆', name: 'First Win', desc: 'Complete your first obby' },
  { id: 'level-5', icon: '✨', name: 'Radiant Dumpling', desc: 'Reach Level 5' },
  { id: 'rebirth-1', icon: '🌀', name: 'Reborn', desc: 'Rebirth for the first time' },
  { id: 'wins-100', icon: '💯', name: 'Century', desc: 'Earn 100 wins' },
  { id: 'speed-10k', icon: '⚡', name: 'Speed Demon', desc: 'Reach 10K speed' },
  { id: 'obby-5', icon: '🥇', name: 'Obby Master', desc: 'Beat Obby 5' },
  { id: 'marathon', icon: '⏱️', name: 'Marathon', desc: 'Play for 10 total minutes' },
  { id: 'mult-10', icon: '🔴', name: 'Max Power', desc: 'Unlock the +10 per-tick multiplier' },
  { id: 'rebirth-3', icon: '🌟', name: 'Triple Halo', desc: 'Rebirth 3 times' },
  { id: 'obby-10', icon: '🚀', name: 'Endless Legend', desc: 'Beat Obby 10' },
]

function conditionMet(id: string, ctx: AchievementContext): boolean {
  switch (id) {
    case 'first-speed':
      return ctx.highestSpeed >= 1
    case 'level-1':
      return ctx.highestLevel >= 1
    case 'first-win':
      return ctx.wins >= 1
    case 'level-5':
      return ctx.highestLevel >= 5
    case 'rebirth-1':
      return ctx.rebirths >= 1
    case 'wins-100':
      return ctx.wins >= 100
    case 'speed-10k':
      return ctx.highestSpeed >= 10000
    case 'obby-5':
      return ctx.maxObbyCompleted >= 5
    case 'marathon':
      return ctx.totalPlayTime >= 600
    case 'mult-10':
      return ctx.mult >= 10
    case 'rebirth-3':
      return ctx.rebirths >= 3
    case 'obby-10':
      return ctx.maxObbyCompleted >= 10
    default:
      return false
  }
}

/** Returns defs that are newly unlocked given the already-unlocked set. */
export function checkAchievements(
  ctx: AchievementContext,
  unlocked: Set<string>,
): AchievementDef[] {
  const fresh: AchievementDef[] = []
  for (const a of ACHIEVEMENTS) {
    if (!unlocked.has(a.id) && conditionMet(a.id, ctx)) fresh.push(a)
  }
  return fresh
}
