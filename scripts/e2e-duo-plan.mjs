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

function segmentGap(p, a, b) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const length2 = dx * dx + dz * dz
  const u = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0
  return Math.hypot(p.x - a.x - u * dx, p.z - a.z - u * dz)
}

// The page's camera right vector on XZ (read from the probe) must be axis aligned for the key-driven routes.
export function axesOf(right) {
  if (!right || !Number.isFinite(right.x) || !Number.isFinite(right.z)) throw new Error('camera right vector was not read from the page')
  if (Math.abs(right.x) >= 0.99) return { across: 'x', along: 'z' }
  if (Math.abs(right.z) >= 0.99) return { across: 'z', along: 'x' }
  throw new Error(`camera right ${JSON.stringify(right)} is not axis aligned; the duo routes need an axis-aligned default camera`)
}
const onAxes = (axes, across, along) => ({ [axes.across]: across, [axes.along]: along })

// A pose jump (test-only) that makes the contract's recovery hop legal: after the jump the follower is
// ≥ minGap away (so it is still > 2.6 away once it has walked the trail for 0.5 s at 1.6 units/s), and from
// every point it can reach by then the straight line to the landing (the trail point 1.1 behind the
// leader, on the jump segment) is clear at 0.05-unit samples and passes ≥ 0.45 (+margin) from the leader.
// Jumps run along the camera's right vector first (away from the follower) so both stay in frame, and
// stay below 8 units, the runtime's relocation threshold; jumps ≤ 4.4 inside `inside` are preferred, as
// they keep the leader in frame while the camera (τ 0.25) catches up. `back` also requires the line target -> follower
// to be clear (after a swap the trail is reset to that segment). Returns null when no jump is legal.
export function planTeleport(layout, { leader, follower, right, inside = () => true, minGap = 4.2, maxGap = 4.6, back = false }) {
  const away = (follower.x - leader.x) * right.x + (follower.z - leader.z) * right.z > 0 ? -1 : 1
  const angles = [0, 15, -15, 30, -30].map((deg) => deg * Math.PI / 180)
  const reach = (d, k) => ({ x: d.x * k, z: d.z * k })
  // Where the follower can be when the hop is decided: along its way to the leader, then along the jump.
  const toLeader = distance(follower, leader)
  const takeoffsFor = (direction) => {
    const points = []
    for (let k = 0; k <= 1.0 + 1e-9; k += 0.1) {
      if (k <= toLeader) points.push({ x: follower.x + (leader.x - follower.x) * k / (toLeader || 1), z: follower.z + (leader.z - follower.z) * k / (toLeader || 1) })
      else points.push({ x: leader.x + direction.x * (k - toLeader), z: leader.z + direction.z * (k - toLeader) })
    }
    return points
  }
  for (const pass of [true, false]) {
    for (const sign of [away, -away]) {
      for (const angle of angles) {
        const base = { x: right.x * sign, z: right.z * sign }
        const direction = {
          x: base.x * Math.cos(angle) - base.z * Math.sin(angle),
          z: base.x * Math.sin(angle) + base.z * Math.cos(angle),
        }
        const takeoffs = takeoffsFor(direction)
        for (let jump = 2; jump <= (pass ? 4.4 : 7.5); jump += 0.05) {
          const target = { x: leader.x + direction.x * jump, z: leader.z + direction.z * jump }
          const gap = distance(target, follower)
          if (gap < minGap) continue
          if (gap > maxGap) break
          if (pass && !inside(target)) continue
          if (!pathClear(layout, leader, target)) continue
          const ahead = reach(direction, 0.6)
          if (!bandClear(layout, { x: target.x - direction.x * 0.3, z: target.z - direction.z * 0.3 }, { x: target.x + ahead.x, z: target.z + ahead.z }, 0.6)) continue
          const landing = { x: target.x - direction.x * duoContract.followGap, z: target.z - direction.z * duoContract.followGap }
          const legal = takeoffs.every((point) => distance(point, target) > duoContract.recoveryGap + 0.2
            && pathClear(layout, point, landing) && segmentGap(target, point, landing) >= duoContract.separation + 0.05)
          if (!legal || (back && !pathClear(layout, target, follower))) continue
          return { ...target, heading: Math.atan2(direction.x, direction.z), landing, gap, jump, direction }
        }
      }
    }
  }
  return null
}

// A standing spot where both idle slots (0.75 along the camera right vector) are blocked, reached by walking
// along `across` at z = 0 (x = 0) and then along `along`; the follower trails on the second leg.
// Spots with a clear strip toward the camera are preferred so tiles do not hide the pair while it waits.
export function findNarrowSpot(layout, right, { reach = 8 } = {}) {
  const axes = axesOf(right)
  const towardCamera = { x: -right.z, z: right.x }
  const candidates = []
  for (let a = -reach; a <= reach + 1e-9; a += 0.25) {
    const legStart = onAxes(axes, a, 0)
    if (Math.abs(a) > 1e-9 && !bandClear(layout, { x: 0, z: 0 }, legStart, 0.6)) continue
    for (const dir of [-1, 1]) {
      for (let length = 1.5; length <= 4.5 + 1e-9; length += 0.05) {
        const spot = onAxes(axes, a, dir * length)
        if (!bandClear(layout, legStart, spot, 0.3)) break
        const slots = [-1, 1].map((side) => ({ x: spot.x + right.x * side * duoContract.slotOffset, z: spot.z + right.z * side * duoContract.slotOffset }))
        if (!slots.every((slot) => layout.isBlocked(slot.x, slot.z))) continue
        const clearView = bandClear(layout, spot, { x: spot.x + towardCamera.x * 1.5, z: spot.z + towardCamera.z * 1.5 }, 0.3)
        candidates.push({ spot, legStart, dir, axes, slots, clearView, walk: Math.abs(a) + length })
        break
      }
    }
  }
  candidates.sort((p, q) => Number(q.clearView) - Number(p.clearView) || p.walk - q.walk)
  return candidates[0] ?? null
}

// Session "bridge": a rotation-0 yarn bridge (deck along X, river along Z) reachable from spawn, plus a
// narrow spot (both camera-right idle slots blocked) on the same seed for the "neither slot free" case.
// Prefers the shortest total walk among the first `window` seeds that have both.
const bridgePlans = new Map()
export function planBridge({ right, from = 0, to = 6000, window = 200 } = {}) {
  const key = `${right?.x?.toFixed(3)},${right?.z?.toFixed(3)}`
  if (!bridgePlans.has(key)) bridgePlans.set(key, searchBridge({ right, from, to, window }))
  return bridgePlans.get(key)
}
function searchBridge({ right, from, to, window }) {
  axesOf(right)
  let best
  for (let seed = from; seed <= to && !(best && seed >= best.seed + window); seed++) {
    const layout = createLayout(seed)
    if (!startClear(layout)) continue
    let narrow
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
        // The contract's "neither side free" sidestep case: both sides of the deck are river.
        const sidesteps = [-1, 1].map((side) => layout.isBlocked(bx - 0.1, bz + side * duoContract.separation))
        if (!sidesteps.every(Boolean)) continue
        narrow ??= findNarrowSpot(layout, right) ?? false
        if (!narrow) continue
        const walk = Math.abs(bz) + bx + 2 * narrow.walk
        if (!best || walk < best.walk) best = { seed, layout, bridge: { i, j, x: bx, z: bz }, corner, entry, exit, narrow, walk }
      }
    }
  }
  if (!best) throw new Error('No seed has a reachable rotation-0 yarn bridge with blocked deck sides and a spot with both idle slots blocked')
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
