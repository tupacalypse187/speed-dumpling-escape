/** Pet definitions: passive bonuses + progression unlock conditions. */

export interface PetUnlockCtx {
  wins: number
  rebirths: number
  highestLevel: number
  maxObbyCompleted: number
  achievements: number
}

export interface PetDef {
  id: string
  icon: string
  name: string
  desc: string
  bonus: string
  /** fractional speed-gain bonus (0.1 = +10%) */
  speedMul?: number
  /** fractional jump-power bonus */
  jumpMul?: number
  /** fractional coin bonus */
  coinMul?: number
  /** auto-collect treadmill ticks within this px radius */
  autoTickRadius?: number
  unlockText: string
  unlocked: (ctx: PetUnlockCtx) => boolean
}

export const PETS: PetDef[] = [
  {
    id: 'pup',
    icon: '🐶',
    name: 'Dumpling Pup',
    desc: 'A tiny dumpling dog that never leaves your side.',
    bonus: '+10% speed gain',
    speedMul: 0.1,
    unlockText: 'Earn 10 wins',
    unlocked: (c) => c.wins >= 10,
  },
  {
    id: 'sprite',
    icon: '💨',
    name: 'Steam Sprite',
    desc: 'A warm little cloud that soaks up treadmill energy for you.',
    bonus: 'Auto-collects treadmill ticks nearby',
    autoTickRadius: 200,
    unlockText: 'Reach Level 3',
    unlocked: (c) => c.highestLevel >= 3,
  },
  {
    id: 'wonton',
    icon: '🥟',
    name: 'Mini Wonton',
    desc: 'Small, springy, and always bouncing.',
    bonus: '+15% jump power',
    jumpMul: 0.15,
    unlockText: 'Complete Obby 2',
    unlocked: (c) => c.maxObbyCompleted >= 2,
  },
  {
    id: 'imp',
    icon: '🌶️',
    name: 'Chili Imp',
    desc: 'A spicy little troublemaker who sniffs out coins.',
    bonus: '+20% coins',
    coinMul: 0.2,
    unlockText: 'Unlock 5 achievements',
    unlocked: (c) => c.achievements >= 5,
  },
  {
    id: 'dragon',
    icon: '🐉',
    name: 'Soup Dragon',
    desc: 'A legendary serpent of the broth. Its segments ripple behind you.',
    bonus: '+50% all speed gain',
    speedMul: 0.5,
    unlockText: 'Rebirth once',
    unlocked: (c) => c.rebirths >= 1,
  },
]

export function petById(id: string | null): PetDef | null {
  if (!id) return null
  return PETS.find((p) => p.id === id) ?? null
}
