// Route planning and the reference trail model for the DUO-* acceptance checks.
// Pure Node: depends only on the deterministic world layout, never on the browser.
import { createLayout } from '../src/world/layout.js'
import { FIRST_PAGE_ROW, LAST_PAGE_ROW, TILE_SIZE } from '../src/world/tiles.js'

// Numbers from docs/contracts.md "Round 5: duo". Change them there first.
export const duoContract = {
  startGap: 1.1,
  trailSpacing: 0.05,
  trailKeep: 8,
  followGap: 1.1,
  followSpeed: 1.6,
  catchUpGap: 1.4,
  easeDistance: 0.3,
  clipSpeed: 1.2,
  clipScale: [0.6, 1.4],
  separation: 0.45,
  separationShare: 0.99,
  followMedian: [0.9, 1.4],
  followMax: 2.2,
  straightWalkSeconds: 2,
  stationaryDisplacement: 0.02,
  stationarySeconds: 0.5,
  slotOffset: 0.75,
  slotHeadingDeg: 30,
  danceIdleSeconds: 4,
  danceDelay: 0.3125,
  danceDelayTolerance: 0.05,
  danceEndDisplacement: 0.02,
  danceEndSeconds: 0.25,
  recoveryGap: 2.6,
  recoverySeconds: 0.5,
  hopApex: 0.25,
  hopBase: 0.35,
  hopPerUnit: 0.1,
  hopFreeDistance: 1.5,
  swapCooldown: 0.5,
  clickMarginPx: 8,
  cameraSettleUnits: 0.2,
  cameraSettleSeconds: 1,
  voiceFade: 0.02,
  swapLineGuard: 0.3,
  stretchSeconds: 0.5,
  overlapShare: 0.5,
  focusShare: 0.3,
  voiceF0: [220, 380],
  maxTriangles: 20_000,
  maxTexture: 1024,
  bodyHeight: [0.5, 0.6],
  hairTip: 0.95,
  perfMarginMs: 1.5,
  perfBaseline: '06da353',
}

export const keyVectors = { KeyD: [1, 0], KeyA: [-1, 0], KeyW: [0, -1], KeyS: [0, 1] }
export const sampleStep = 0.05
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// Every 0.05 units, both ends included: the contract's sampling for idle-slot and hop paths.
export function pathClear(layout, from, to, step = sampleStep) {
  const steps = Math.max(1, Math.ceil(distance(from, to) / step))
  for (let i = 0; i <= steps; i++) {
    if (layout.isBlocked(from.x + (to.x - from.x) * i / steps, from.z + (to.z - from.z) * i / steps)) return false
  }
  return true
}

// A straight corridor with parallel lines at the given lateral offsets.
export function bandClear(layout, from, to, halfWidth, step = 0.1) {
  const length = distance(from, to) || 1
  const nx = -(to.z - from.z) / length
  const nz = (to.x - from.x) / length
  for (let offset = -halfWidth; offset <= halfWidth + 1e-9; offset += step) {
    const shift = (point) => ({ x: point.x + nx * offset, z: point.z + nz * offset })
    if (!pathClear(layout, shift(from), shift(to), 0.04)) return false
  }
  return true
}

const startClear = (layout) => bandClear(layout, { x: -1.3, z: 0 }, { x: 1.3, z: 0 }, 1.3)

// Session "lane": a long open east-west corridor through the spawn point.
export function planLane({ from = 1, to = 6000 } = {}) {
  for (let seed = from; seed <= to; seed++) {
    const layout = createLayout(seed)
    if (!startClear(layout)) continue
    if (!bandClear(layout, { x: -2, z: 0 }, { x: 14, z: 0 }, 1.3)) continue
    return { seed, layout, lane: { z: 0, minX: -2, maxX: 14, halfWidth: 1.3 } }
  }
  throw new Error('No seed has a clear 16 x 2.6 unit lane through the spawn point')
}

// Session "bridge": a rotation-0 yarn bridge (deck along X, river along Z) reachable from spawn.
// Prefers the nearest bridge among the first `window` seeds that have one, to keep the walk short.
export function planBridge({ from = 0, to = 6000, window = 200 } = {}) {
  let best
  for (let seed = from; seed <= to && !(best && seed >= best.seed + window); seed++) {
    const layout = createLayout(seed)
    if (!startClear(layout)) continue
    for (let i = 2; i <= 12; i++) {
      for (let j = FIRST_PAGE_ROW + 1; j <= LAST_PAGE_ROW - 1; j++) {
        const cell = layout.getCell(i, j)
        if (cell.id !== 'yarn_bridge' || cell.rotation !== 0) continue
        const bx = i * TILE_SIZE
        const bz = j * TILE_SIZE
        const corner = { x: 0, z: bz }
        const entry = { x: bx - 1.6, z: bz }
        const exit = { x: bx + 2.2, z: bz }
        if (Math.abs(bz) > 4) continue
        if (bz !== 0 && !bandClear(layout, { x: 0, z: 0 }, corner, 0.6)) continue
        if (!bandClear(layout, corner, entry, 0.6) || !pathClear(layout, entry, exit)) continue
        if (!bandClear(layout, { x: bx + 0.6, z: bz }, exit, 0.6)) continue
        // The contract's "neither side free" cases: both idle slots and both sidesteps on the deck are river.
        const slots = [-1, 1].map((side) => layout.isBlocked(bx, bz + side * duoContract.slotOffset))
        const sidesteps = [-1, 1].map((side) => layout.isBlocked(bx - 0.1, bz + side * duoContract.separation))
        if (!slots.every(Boolean) || !sidesteps.every(Boolean)) continue
        const walk = Math.abs(bz) + bx
        if (!best || walk < best.walk) best = { seed, layout, bridge: { i, j, x: bx, z: bz }, corner, entry, exit, walk }
      }
    }
  }
  if (!best) throw new Error('No seed has a reachable rotation-0 yarn bridge with blocked deck sides')
  return best
}

// Session "corner": walk east, then north or south to a corner C, stop and move the leader 4 units
// along X. The hop line from wherever the follower stands on the vertical leg to the landing cuts a
// prop, while the trail (vertical leg, then the jump segment) stays clear.
export function planBlockedHop({ from = 0, to = 6000, jump = 4 } = {}) {
  const landingBack = jump - duoContract.followGap
  for (let seed = from; seed <= to; seed++) {
    const layout = createLayout(seed)
    if (!startClear(layout)) continue
    for (let cx = 1; cx <= 10; cx += 0.25) {
      if (!bandClear(layout, { x: -0.5, z: 0 }, { x: cx, z: 0 }, 0.6)) break
      for (const dirZ of [-1, 1]) {
        for (let legLength = 2.2; legLength <= 4; legLength += 0.1) {
          const corner = { x: cx, z: dirZ * legLength }
          if (!bandClear(layout, { x: cx, z: 0 }, corner, 0.35)) break
          for (const sx of [1, -1]) {
            const landing = { x: cx + sx * landingBack, z: corner.z }
            const leader = { x: cx + sx * jump, z: corner.z }
            if (!pathClear(layout, corner, { x: cx + sx * (jump + 0.6), z: corner.z })) continue
            if (!bandClear(layout, { x: leader.x - sx * 0.2, z: corner.z }, { x: leader.x + sx * 0.6, z: corner.z }, 0.9)) continue
            const takeoffs = [0.15, 0.3, 0.5, 0.8, 1.1].map((k) => ({ x: cx, z: corner.z - dirZ * k }))
            if (takeoffs.some((point) => pathClear(layout, point, landing))) continue
            return { seed, layout, lane: { z: 0, toX: cx }, corner, dirZ, sx, jump, landing, leader, takeoffs }
          }
        }
      }
    }
  }
  throw new Error('No seed has a corner whose hop line is blocked while the trail stays clear')
}

export const layoutFor = (seed) => createLayout(seed)

// Reference trail: reset to the straight follower -> leader segment, then extended by leader positions.
export function createTrail() {
  let points = []
  const length = () => points.reduce((sum, point, index) => index ? sum + distance(points[index - 1], point) : 0, 0)
  return {
    reset(follower, leader) { points = [{ ...follower }, { ...leader }] },
    push(leader) {
      const last = points.at(-1)
      if (!last || distance(last, leader) >= 1e-4) points.push({ x: leader.x, z: leader.z })
      let total = length()
      while (points.length > 2 && total - distance(points[0], points[1]) >= duoContract.trailKeep) {
        total -= distance(points[0], points[1])
        points.shift()
      }
    },
    length,
    // The point `back` units of path length behind the trail's head, or null when the trail is shorter.
    behind(back = duoContract.followGap) {
      let left = back
      for (let i = points.length - 1; i > 0; i--) {
        const a = points[i]
        const b = points[i - 1]
        const segment = distance(a, b)
        if (segment >= left) return { x: a.x + (b.x - a.x) * left / segment, z: a.z + (b.z - a.z) * left / segment }
        left -= segment
      }
      return null
    },
    get points() { return points.map((point) => ({ ...point })) },
  }
}
