/** Feasibility verification: handmade + generated obbies + infinite practice. */
import { getObby, verifyObby, verifyCoins } from './src/game/generator'
import { PRACTICE_OBBY, medalTimes, type ObbyDef } from './src/game/levels'
import { makePracticeSegment } from './src/game/practice'

let failures = 0

// 1) handmade obbies 1–3 and generated obbies 4–30
for (let id = 1; id <= 30; id++) {
  const def = getObby(id)
  const v = verifyObby(def)
  const c = verifyCoins(def)
  if (!v.ok || !c.ok) {
    failures++
    console.log(`❌ Obby ${id}:`, [...v.issues, ...c.issues])
  }
}
console.log('✓ obbies 1–30 verified (gaps + coins)')

// 2) medal time sanity for a few obbies
for (const id of [1, 2, 3, 4, 8, 16]) {
  const def = getObby(id)
  const m = medalTimes(def)
  console.log(
    `  Obby ${id}: width=${def.width} reqLv=${def.reqLevel} 🥈${m.target.toFixed(1)}s 🥇${m.stretch.toFixed(1)}s`,
  )
}

// 3) infinite practice: base course + 40 appended segments, feasible at speed 0
const world: ObbyDef = structuredClone(PRACTICE_OBBY)
world.reqLevel = 0
let endX = 6100
let endY = 620
let endShrink = 0
for (let i = 1; i <= 40; i++) {
  const seg = makePracticeSegment(i, endX, endY, endShrink)
  world.platforms.push(...seg.platforms)
  world.pads.push(...seg.pads)
  world.movers.push(...seg.movers)
  world.hazards.splice(world.hazards.length - 1, 0, ...seg.hazards)
  endX = seg.endX
  endY = seg.endY
  endShrink = seg.endShrink
}
world.width = endX + 500
const lava = world.hazards[world.hazards.length - 1]
if (lava.type === 'lava') lava.w = world.width + 800

const pv = verifyObby(world)
if (!pv.ok) {
  failures++
  console.log('❌ practice world (40 segments):', pv.issues)
} else {
  console.log(
    `✓ practice base + 40 segments feasible at speed 0 (max gap ${Math.round(pv.maxGapFound)}px ≤ ${Math.round(pv.maxGapAllowed)}px)`,
  )
}

// 4) segment determinism: same index → identical segment
const a = makePracticeSegment(7, 6160, 620)
const b = makePracticeSegment(7, 6160, 620)
if (JSON.stringify(a) !== JSON.stringify(b)) {
  failures++
  console.log('❌ practice segment 7 not deterministic')
} else {
  console.log('✓ practice segments deterministic')
}

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
