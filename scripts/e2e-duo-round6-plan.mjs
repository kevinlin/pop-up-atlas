// Route planning for the round-6 sessions (scripts/e2e-duo-round6-sessions.mjs). Pure Node: only the deterministic
// world layout. Each plan names the seed and the geometry; scenario text never does (tests/e2e/round6.feature).
import { skipsOnStart } from '../src/character/animation.js'
import { createLayout } from '../src/world/layout.js'
import { bandClear, planLane } from './e2e-duo-plan.mjs'

const heroIds = new Set(['mushroom_house', 'cupcake_tree', 'yarn_bridge'])
const startClear = (layout) => bandClear(layout, { x: -1.3, z: 0 }, { x: 1.3, z: 0 }, 1.3)
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// True when a tile that triggers a hero beat (other than `except`) has its centre within `radius` of the polyline.
function heroNear(layout, points, radius, except) {
  const xs = points.map(({ x }) => x)
  const zs = points.map(({ z }) => z)
  const gap = (p, a, b) => {
    const length2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2
    const u = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / length2)) : 0
    return Math.hypot(p.x - a.x - u * (b.x - a.x), p.z - a.z - u * (b.z - a.z))
  }
  for (let i = Math.floor((Math.min(...xs) - radius) / 2); i <= Math.ceil((Math.max(...xs) + radius) / 2); i++) {
    for (let j = Math.max(-5, Math.floor((Math.min(...zs) - radius) / 2)); j <= Math.min(4, Math.ceil((Math.max(...zs) + radius) / 2)); j++) {
      if (i === except.i && j === except.j) continue
      if (!heroIds.has(layout.getCell(i, j).id)) continue
      const centre = { x: i * 2, z: j * 2 }
      if (points.slice(1).some((point, n) => gap(centre, points[n], point) <= radius)) return true
    }
  }
  return false
}

// A circle of free ground around a point (the leader is a point, so this is only a margin against stopping on an edge).
const standable = (layout, point, margin = 0.15) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
  .every(([dx, dz]) => !layout.isBlocked(point.x + dx * margin, point.z + dz * margin))

// Session "stage": one prop (mushroom_house or cupcake_tree) beside a straight east-west corridor.
//   legs   (0,0) -> (xs,0) -> (xs,z0), then east along z = z0 past the prop at a lateral offset of `lateral` (< 2, so the
//          stage-2 fold fires; > the prop's blocked radius, so the corridor is clear);
//   stop   a spot in the corridor within 1.7 of the prop's cell centre (inside the 1.8 dance-stage reach), where the
//          leader idles into its dance and later walks into the prop for a bump;
//   seed   chosen so the first walk start of troll A (after >= 1 s standing) is a skip.
// The hero beat rule needs the prop to be the only hero tile near the route; the plan keeps every other one out.
// Prefers the shortest approach among the first `window` seeds that qualify.
let stagePlan
export function planStage({ from = 1, to = 6000, window = 120 } = {}) {
  if (stagePlan) return stagePlan
  let best
  for (let seed = from; seed <= to && !(best && seed >= best.seed + window); seed++) {
    if (!skipsOnStart(seed, 0)) continue
    const layout = createLayout(seed)
    if (!startClear(layout)) continue
    for (let i = -2; i <= 12; i++) {
      for (let j = -3; j <= 3; j++) {
        const tile = layout.getCell(i, j)
        if (tile.id !== 'mushroom_house' && tile.id !== 'cupcake_tree') continue
        const prop = { id: tile.id, i, j, x: i * 2, z: j * 2 }
        for (const side of [-1, 1]) {
          for (let lateral = 1.45; lateral <= 1.72 + 1e-9; lateral += 0.03) {
            const z0 = prop.z + side * lateral
            if (Math.abs(z0) > 4.2) continue
            const xs = prop.x - 7.2
            const xe = prop.x + 3.6
            const legs = [{ x: 0, z: 0 }, { x: xs, z: 0 }, { x: xs, z: z0 }, { x: xe, z: z0 }]
            if (!bandClear(layout, { x: xs, z: z0 }, { x: xe, z: z0 }, 0.3)) continue
            if (xs !== 0 && !bandClear(layout, { x: 0, z: 0 }, { x: xs, z: 0 }, 0.4)) continue
            if (z0 !== 0 && !bandClear(layout, { x: xs, z: 0 }, { x: xs, z: z0 }, 0.4)) continue
            if (heroNear(layout, legs, 3.2, prop)) continue
            // The dance spot: the westernmost corridor point within 1.7 of the prop's centre that is free ground.
            let stop
            for (let sx = -1.2; sx <= 0.6 + 1e-9; sx += 0.05) {
              const point = { x: prop.x + sx, z: z0 }
              if (distance(point, prop) <= 1.7 && standable(layout, point)) {
                stop = { ...point, sx }
                break
              }
            }
            if (!stop) continue
            const walk = Math.abs(xs) + Math.abs(z0)
            if (!best || walk < best.walk) best = { seed, layout, prop, side, lateral, z0, xs, xe, stop, walk }
          }
        }
      }
    }
  }
  if (!best) throw new Error('No seed has a prop beside a clear corridor within reach of the dance stage for the stage session')
  stagePlan = best
  return best
}

// Session "river": troll B (leading after the start swap, standing 1.1 behind the origin) walks along x = 0 to the row
// z = river.z, then east along it into a river at x = river.x. Both legs are clear, so the first blocked point is the
// river. Prefers the shortest route among the first `window` seeds that qualify.
let riverPlan
export function planRiver({ from = 1, to = 6000, window = 60 } = {}) {
  if (riverPlan) return riverPlan
  const startZ = -1.1
  let best
  for (let seed = from; seed <= to && !(best && seed >= best.seed + window); seed++) {
    const layout = createLayout(seed)
    if (!startClear(layout) || layout.isBlocked(0, startZ)) continue
    for (let z = -9; z <= 7.4; z += 0.2) {
      const walkZ = Math.abs(z - startZ)
      if (z < -9 || (walkZ > 0.05 && !bandClear(layout, { x: 0, z: startZ }, { x: 0, z }, 0.3))) continue
      let x = 0
      while (x < 40 && !layout.isBlocked(x, z)) x += 0.1
      if (x < 2.6 || x >= 40 || layout.blockedBy(x, z) !== 'river') continue
      if (!bandClear(layout, { x: 0, z }, { x: x - 0.1, z }, 0.3)) continue
      const walk = walkZ + x
      if (!best || walk < best.walk) best = { seed, layout, river: { x: +x.toFixed(2), z: +z.toFixed(2) }, walk }
    }
  }
  if (!best) throw new Error('No seed has a clear route from troll B at its start to a river for the river session')
  riverPlan = best
  return best
}

// Session "hum": the lane of `planLane`, on a seed whose first walk start is a skip.
let humPlan
export function planHum() {
  if (humPlan) return humPlan
  for (let from = 1; from < 6000;) {
    const plan = planLane({ from })
    if (skipsOnStart(plan.seed, 0)) {
      humPlan = plan
      return plan
    }
    from = plan.seed + 1
  }
  throw new Error('No lane seed has a skip on its first walk start for the hum session')
}
