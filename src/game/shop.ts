/** Shop inventory: cosmetic hats, trail color packs, and stackable charms. */

export interface HatDef {
  id: string
  icon: string
  name: string
  price: number
}

export const HATS: HatDef[] = [
  { id: 'steamer', icon: '🎍', name: 'Steamer Lid', price: 50 },
  { id: 'chef', icon: '👨‍🍳', name: 'Chef Hat', price: 120 },
  { id: 'party', icon: '🎉', name: 'Party Hat', price: 200 },
  { id: 'crown', icon: '👑', name: 'Crown', price: 300 },
]

export function hatById(id: string | null): HatDef | null {
  if (!id) return null
  return HATS.find((h) => h.id === id) ?? null
}

export interface TrailDef {
  id: string
  name: string
  price: number
  /** particle colors cycled for the speed trail; empty = use level color */
  colors: string[]
}

export const TRAILS: TrailDef[] = [
  { id: 'default', name: 'Classic (level color)', price: 0, colors: [] },
  { id: 'sunset', name: 'Sunset', price: 80, colors: ['#ff9a3c', '#ff5a5f', '#ffc93c'] },
  { id: 'ocean', name: 'Ocean', price: 80, colors: ['#6cc4ff', '#4a93d9', '#a8e6ff'] },
  { id: 'candy', name: 'Candy', price: 150, colors: ['#ff8fab', '#c084ff', '#ffd24a'] },
]

export function trailById(id: string): TrailDef {
  return TRAILS.find((t) => t.id === id) ?? TRAILS[0]
}

/** Permanent +5% speed-gain charm, stackable up to CHARM_MAX with doubling cost. */
export const CHARM_MAX = 5
export const CHARM_BONUS = 0.05

export function charmPrice(owned: number): number {
  return 100 * Math.pow(2, owned)
}
