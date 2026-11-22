// DUO-* acceptance checks for "Round 5: duo" (docs/contracts.md). Scenarios: tests/e2e/duo.feature.
// Sessions (scripts/e2e-duo-sessions.mjs) record one sample per stepped frame; everything here is offline
// analysis of those traces against the contract numbers in duoContract.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { launchChromium } from './capture.mjs'
import {
  checkTrollB, leaderBank, readCueBanks, summarizeTroll, trollA, trollB, voiceBPitch,
} from './e2e-duo-assets.mjs'
import { createTrail, duoContract as C, keyVectors, layoutFor, pathClear } from './e2e-duo-plan.mjs'
import { framingStats } from './e2e-duo-probe.mjs'
import {
  bridgeSession, cornerSession, droppedCues, duoViewports, fps, laneSession, missingSampleSession,
} from './e2e-duo-sessions.mjs'

export const duoScenarios = [
  ['DUO-01', 'debug surface and stable player identity'],
  ['DUO-02', 'troll B asset contract'],
  ['DUO-03', 'start formation'],
  ['DUO-04', 'trail reset and too-short hold'],
  ['DUO-05', 'follow distance while walking straight'],
  ['DUO-06', 'follower speed cap, catch-up and easing'],
  ['DUO-07', 'follower walk clip time scale'],
  ['DUO-08', 'separation and sidestep'],
  ['DUO-09', 'leader never blocked by the follower'],
  ['DUO-10', 'follower never enters a blocked cell'],
  ['DUO-11', 'idle side slot'],
  ['DUO-12', 'idle with neither slot free keeps the trail target'],
  ['DUO-13', 'dance canon'],
  ['DUO-14', 'both dances end on input or displacement'],
  ['DUO-15', 'recovery hop'],
  ['DUO-16', 'blocked hop line walks the trail'],
  ['DUO-17', 'swap by Space exchanges poses and rebinds models'],
  ['DUO-18', 'click on the follower swaps without a click-walk'],
  ['DUO-19', 'swap while walking keeps held keys and cancels click-walk'],
  ['DUO-20', 'swap while dancing ends both dances'],
  ['DUO-21', 'swap requested during a hop waits for landing'],
  ['DUO-22', 'swap cooldown and odd press parity'],
  ['DUO-23', 'even press parity cancels the pending swap'],
  ['DUO-24', 'swap cooldown overlapping a hop'],
  ['DUO-25', 'camera settles on the new leader'],
  ['DUO-26', 'folds driven by the leader only'],
  ['DUO-27', 'character cues follow the leader'],
  ['DUO-28', 'swap lines A to B to A'],
  ['DUO-29', 'swap line guard'],
  ['DUO-30', 'voice cut logged as end and pending state cleared'],
  ['DUO-31', 'missing B sample skipped without error'],
  ['DUO-32', 'B cue bank shipping gate'],
  ['DUO-33', 'voice B pitch'],
  ['DUO-34', 'both characters inside the frame'],
  ['DUO-35', 'overlap run length'],
  ['DUO-36', 'occlusion run length'],
  ['DUO-37', 'follower walks the leader path'],
  ['DUO-41', 'duo browser errors'],
]
export const duoRequiredChecks = duoScenarios.map(([id, title]) => `${id} ${title}`)
const titles = new Map(duoScenarios.map(([id, title]) => [id, `${id} ${title}`]))

const walkStep = C.clipSpeed / fps
const capStep = C.followSpeed / fps
const stretch = Math.round(C.stretchSeconds * fps)
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const followerOf = (s) => (s.leader === 'b' ? 'a' : 'b')
const gapOf = (s) => dist(s.L, s.F)
const r3 = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value)
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : NaN
}
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
const degrees = (radians) => radians * 180 / Math.PI
const forward = (heading) => ({ x: Math.sin(heading), z: Math.cos(heading) })
function segmentDistance(p, a, b) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const length2 = dx * dx + dz * dz
  const u = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0
  return Math.hypot(p.x - a.x - u * dx, p.z - a.z - u * dz)
}
const polylineDistance = (p, points) => points.length < 2 ? (points[0] ? dist(p, points[0]) : Infinity)
  : Math.min(...points.slice(1).map((b, i) => segmentDistance(p, points[i], b)))
const corridorClear = (layout, from, to, half = 0.1) => [-half, 0, half].every((offset) => {
  const length = dist(from, to) || 1
  const nx = -(to.z - from.z) / length * offset
  const nz = (to.x - from.x) / length * offset
  return pathClear(layout, { x: from.x + nx, z: from.z + nz }, { x: to.x + nx, z: to.z + nz })
})

// Collected results: id -> { measured, problems }.
function createResults() {
  const results = new Map(duoScenarios.map(([id]) => [id, { measured: {}, problems: [] }]))
  const entry = (id) => results.get(id)
  return {
    results,
    problem(id, where, message) {
      const { problems } = entry(id)
      if (problems.length < 24) problems.push(`${where}: ${message}`)
      else if (problems.length === 24) problems.push('... further problems truncated')
    },
    measure(id, where, value) {
      entry(id).measured[where] = { ...entry(id).measured[where], ...value }
    },
  }
}

// Per-session derived series, shared by every analysis.
function prepare(result) {
  const { trace, marks } = result
  const first = trace[0].f
  const index = (frame) => frame - first
  const layout = layoutFor(result.plan.seed)
  const swaps = []
  const swapAt = new Set()
  for (let k = 0; k < trace.length; k++) {
    const before = k ? trace[k - 1].swaps : result.initial?.swaps ?? 0
    if (trace[k].swaps > before) {
      swaps.push({ k, from: k ? trace[k - 1].leader : 'a', to: trace[k].leader, count: trace[k].swaps - before })
      swapAt.add(k)
    }
  }
  const hops = []
  const hopAt = new Set()
  let start = null
  for (let k = 0; k <= trace.length; k++) {
    const hopping = k < trace.length && trace[k].hop
    if (hopping && start === null) start = k
    if (!hopping && start !== null) {
      hops.push({ start, end: k - 1, land: k < trace.length ? k : null, label: followerOf(trace[start]) })
      for (let j = start; j <= Math.min(k, trace.length - 1); j++) hopAt.add(j)
      start = null
    }
  }
  const teleportAt = new Set(marks.filter(({ type }) => type === 'teleport').map(({ f }) => index(f)))
  const jumpAt = (k) => swapAt.has(k) || teleportAt.has(k)
  // Reference trail: reset at start and on every swap, extended with every leader position.
  const trail = createTrail()
  const origin = result.initial ?? trace[0]
  trail.reset(origin.F, origin.L)
  const target = []
  const trailLength = []
  const trailDistance = []
  for (let k = 0; k < trace.length; k++) {
    if (swapAt.has(k)) trail.reset(trace[k].F, trace[k].L)
    else trail.push(trace[k].L)
    target.push(trail.behind(C.followGap))
    trailLength.push(trail.length())
    trailDistance.push(polylineDistance(trace[k].F, trail.points))
  }
  const stationary = trace.map((s, k) => k >= 30 && dist(s.L, trace[k - 30].L) < C.stationaryDisplacement)
  const followerStep = trace.map((s, k) => (k ? dist(s.F, trace[k - 1].F) : 0))
  const leaderStep = trace.map((s, k) => (k ? dist(s.L, trace[k - 1].L) : 0))
  const markIndex = (mark) => mark && index(mark.f)
  return {
    result, trace, marks, first, index, layout, swaps, swapAt, hops, hopAt, teleportAt, jumpAt,
    target, trailLength, trailDistance, stationary, followerStep, leaderStep, markIndex,
    notes: result.notes ?? {}, where: `${result.label}`,
  }
}

function analyzeSurface(x, out) {
  const { result, trace, where } = x
  const { surface } = result
  const id = 'DUO-01'
  for (const key of ['leader', 'follower', 'swaps', 'pendingSwap', 'swap']) {
    if (!surface.keys.includes(key)) out.problem(id, where, `__atlas.duo has no ${key}`)
  }
  if (surface.leader !== 'a') out.problem(id, where, `leader starts as ${surface.leader}, expected 'a'`)
  if (!Number.isFinite(surface.follower?.x) || !Number.isFinite(surface.follower?.z) || typeof surface.follower?.state !== 'string') {
    out.problem(id, where, `follower is not {x, z, state}: ${JSON.stringify(surface.follower)}`)
  }
  if (surface.swaps !== 0) out.problem(id, where, `swaps starts at ${surface.swaps}`)
  if (surface.pendingSwap !== false) out.problem(id, where, `pendingSwap starts as ${surface.pendingSwap}`)
  if (surface.swap !== 'function') out.problem(id, where, 'swap() is not a function')
  let identity = 0
  let labels = 0
  let unbound = 0
  for (const [k, s] of trace.entries()) {
    if (!s.samePlayer) identity++
    if (s.leader !== 'a' && s.leader !== 'b') labels++
    else if (!x.hopAt.has(k) && (dist(s[s.leader], s.L) > 0.03 || dist(s[followerOf(s)], s.F) > 0.03)) unbound++
  }
  if (identity) out.problem(id, where, `__atlas.player changed object identity on ${identity} frames`)
  if (labels) out.problem(id, where, `duo.leader was not 'a' or 'b' on ${labels} frames`)
  if (unbound) out.problem(id, where, `player/follower pose differs from the bound model by > 0.03 on ${unbound} frames`)
  out.measure(id, where, { surface, frames: trace.length, identityChanges: identity, unboundFrames: unbound })
}

function analyzeStart(x, out) {
  const { result, layout, where } = x
  const s = result.initial
  const id = 'DUO-03'
  const heading = s.a.ry
  const ahead = forward(heading)
  const behind = { x: s.L.x - ahead.x * C.startGap, z: s.L.z - ahead.z * C.startGap }
  const gap = gapOf(s)
  const along = (s.F.x - s.L.x) * ahead.x + (s.F.z - s.L.z) * ahead.z
  if (s.leader !== 'a') out.problem(id, where, `troll ${s.leader} leads at start`)
  if (Math.abs(gap - C.startGap) > 0.03) out.problem(id, where, `start gap ${r3(gap)}, expected ${C.startGap}`)
  if (!layout.isBlocked(behind.x, behind.z)) {
    if (dist(s.F, behind) > 0.05) out.problem(id, where, `follower ${JSON.stringify(s.F)} is not 1.1 behind the leader's heading`)
  } else if (Math.abs(along) > 0.05) out.problem(id, where, 'the point behind is blocked but the follower is not beside the leader')
  if (layout.isBlocked(s.F.x, s.F.z)) out.problem(id, where, 'follower starts on a blocked point')
  out.measure(id, where, { leader: s.L, follower: s.F, heading: r3(heading), gap: r3(gap) })
}

function analyzeTrail(x, out) {
  const { trace, where, trailLength, stationary, followerStep, hopAt, swapAt, notes, markIndex } = x
  const id = 'DUO-04'
  let held = 0
  let moved = 0
  for (let k = 1; k < trace.length; k++) {
    if (trailLength[k] >= C.followGap - 0.03 || stationary[k] || hopAt.has(k) || swapAt.has(k) || gapOf(trace[k]) < 0.6) continue
    held++
    if (followerStep[k] > 0.003) moved++
  }
  if (moved) out.problem(id, where, `follower moved on ${moved} of ${held} frames while the trail was shorter than ${C.followGap}`)
  if (notes.shortTrail) {
    const k0 = markIndex(notes.shortTrail)
    let witnessed = 0
    for (let k = k0; k < Math.min(trace.length, k0 + 60); k++) {
      if (trailLength[k] < C.followGap - 0.03 && !stationary[k]) witnessed++
    }
    if (witnessed < 8) out.problem(id, where, `route did not exercise a short trail after a swap (${witnessed} frames)`)
    out.measure(id, where, { shortTrailFrames: witnessed })
  }
  out.measure(id, where, { shortTrailHoldFrames: held, movedFrames: moved })
}

function straightRuns(x) {
  const { trace, jumpAt, leaderStep } = x
  const runs = []
  let run = 0
  for (let k = 1; k < trace.length; k++) {
    const d = { x: trace[k].L.x - trace[k - 1].L.x, z: trace[k].L.z - trace[k - 1].L.z }
    const previous = k > 1 ? { x: trace[k - 1].L.x - trace[k - 2].L.x, z: trace[k - 1].L.z - trace[k - 2].L.z } : null
    const straight = !jumpAt(k) && Math.abs(leaderStep[k] - walkStep) < 0.003
      && (!run || !previous || (d.x * previous.x + d.z * previous.z) / (leaderStep[k] * leaderStep[k - 1]) > 0.999)
    run = straight ? run + 1 : 0
    runs.push(run)
  }
  return [0, ...runs]
}

function analyzeFollow(x, out, pool) {
  const { trace, hopAt, swapAt, followerStep, notes, markIndex, target, where } = x
  const runs = straightRuns(x)
  for (let k = 0; k < trace.length; k++) {
    if (runs[k] >= C.straightWalkSeconds * fps && !hopAt.has(k)) pool.follow.push(gapOf(trace[k]))
  }
  // DUO-06: speed cap everywhere outside swaps and hops; catch-up speed when far behind.
  const id = 'DUO-06'
  let over = 0
  let worst = 0
  for (let k = 1; k < trace.length; k++) {
    if (swapAt.has(k) || hopAt.has(k) || hopAt.has(k - 1)) continue
    worst = Math.max(worst, followerStep[k])
    if (followerStep[k] > capStep + 0.001) over++
  }
  if (over) out.problem(id, where, `follower exceeded ${C.followSpeed} units/s on ${over} frames (max ${r3(worst * fps)})`)
  for (let k = 1; k < trace.length; k++) {
    if (runs[k] > 0 && gapOf(trace[k]) > C.catchUpGap + 0.4 && !hopAt.has(k) && !swapAt.has(k)) pool.catchUp.push(followerStep[k] * fps)
  }
  // Easing after the eastbound stop: speed never rises inside the last 0.3 units, no overshoot.
  if (notes.stopEast) {
    const k0 = markIndex(notes.stopEast)
    const stopTarget = target[k0]
    let rises = 0
    let overshoot = 0
    let lastNear = null
    for (let k = k0 + 1; k < Math.min(trace.length, k0 + 30); k++) {
      if (x.leaderStep[k] > 1e-4) break
      const near = stopTarget && dist(trace[k].F, stopTarget) < C.easeDistance
      if (near && lastNear !== null && followerStep[k] > lastNear + 0.0015) rises++
      if (near) lastNear = followerStep[k]
      if (stopTarget && trace[k].F.x > stopTarget.x + 0.03) overshoot++
    }
    if (rises) out.problem(id, where, `follower sped up on ${rises} frames inside the last ${C.easeDistance} units after the stop`)
    if (overshoot) out.problem(id, where, `follower passed the 1.1-behind point on ${overshoot} frames after the stop`)
    out.measure(id, where, { easingRises: rises, overshootFrames: overshoot })
  }
  out.measure(id, where, { maxSpeed: r3(worst * fps), overCapFrames: over })
}

// Hips bob frequency over a window: linear detrend, interpolated zero crossings.
function bobFrequency(values) {
  const n = values.length
  const mx = (n - 1) / 2
  const my = values.reduce((sum, v) => sum + v, 0) / n
  let sxy = 0
  let sxx = 0
  values.forEach((v, i) => {
    sxy += (i - mx) * (v - my)
    sxx += (i - mx) ** 2
  })
  const slope = sxx ? sxy / sxx : 0
  const residual = values.map((v, i) => v - my - slope * (i - mx))
  const crossings = []
  for (let i = 1; i < n; i++) {
    const a = residual[i - 1]
    const b = residual[i]
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings.push(i - 1 + a / (a - b))
  }
  if (crossings.length < 5) return null
  return (crossings.length - 1) / 2 / ((crossings.at(-1) - crossings[0]) / fps)
}

function collectClipWindows(x, pool) {
  const { trace, swapAt, hopAt, followerStep } = x
  const runs = straightRuns(x)
  // Leader references at 1.2 units/s (clip time scale 1).
  for (let k = 1; k < trace.length; k++) {
    if (runs[k] >= 90 && (k === trace.length - 1 || runs[k + 1] === 0)) {
      const label = trace[k].leader
      const window = trace.slice(k - runs[k] + 20, k + 1).map((s) => s[label].hy)
      if (trace.slice(k - runs[k] + 20, k + 1).every((s) => s.leader === label)) {
        const frequency = bobFrequency(window)
        if (frequency) pool.clipRef[label].push(frequency)
      }
    }
  }
  // Follower windows at a steady speed.
  let start = null
  const close = (end) => {
    if (start === null) return
    const from = start + 20
    if (end - from >= 60) {
      const label = followerOf(trace[from])
      const speed = median(followerStep.slice(from, end + 1)) * fps
      const frequency = bobFrequency(trace.slice(from, end + 1).map((s) => s[label].hy))
      if (frequency && speed > 0.5) pool.clipFollow.push({ label, speed: r3(speed), frequency: r3(frequency), at: x.where, k: from })
    }
    start = null
  }
  for (let k = 1; k < trace.length; k++) {
    const steady = !swapAt.has(k) && !hopAt.has(k) && followerStep[k] * fps > 0.5
      && (start === null || Math.abs(followerStep[k] - followerStep[start + Math.min(20, k - start)]) < 0.06 / fps)
      && (start === null || trace[k].leader === trace[start].leader)
    if (steady && start === null) start = k
    else if (!steady) {
      close(k - 1)
      if (!swapAt.has(k) && !hopAt.has(k) && followerStep[k] * fps > 0.5) start = k
    }
  }
  close(trace.length - 1)
}

function analyzeSeparation(x, out, pool) {
  const { trace, layout, where, notes, markIndex, followerStep } = x
  for (const s of trace) {
    const ahead = forward(s[s.leader].ry)
    const side = { x: ahead.z, z: -ahead.x }
    const free = [-1, 1].some((sign) => !layout.isBlocked(s.F.x + side.x * sign * C.separation, s.F.z + side.z * sign * C.separation))
    if (!free) continue
    pool.separation.total++
    if (gapOf(s) >= C.separation) pool.separation.ok++
  }
  if (notes.approach) {
    const id = 'DUO-08'
    const k0 = markIndex(notes.approach)
    let sidesteps = 0
    let closest = Infinity
    for (let k = k0; k < Math.min(trace.length, k0 + 42); k++) {
      const s = trace[k]
      closest = Math.min(closest, gapOf(s))
      if (gapOf(s) > 0.75 || followerStep[k] < 0.005) continue
      const ahead = forward(s[s.leader].ry)
      const dx = s.F.x - trace[k - 1].F.x
      const dz = s.F.z - trace[k - 1].F.z
      if (Math.abs(dx * ahead.z - dz * ahead.x) > Math.abs(dx * ahead.x + dz * ahead.z)) sidesteps++
    }
    if (!sidesteps) out.problem(id, where, 'follower did not step sideways when the leader walked into it')
    if (closest < C.separation) out.problem(id, where, `leader came within ${r3(closest)} of a follower with a free side`)
    out.measure(id, where, { sidestepFrames: sidesteps, closest: r3(closest) })
  }
}

function heldDirection(held) {
  let dx = 0
  let dz = 0
  for (const code of held) {
    const vector = keyVectors[code]
    if (vector) {
      dx += vector[0]
      dz += vector[1]
    }
  }
  const length = Math.hypot(dx, dz)
  return length ? { x: dx / length, z: dz / length } : null
}

function analyzeLeaderFree(x, out) {
  const { trace, layout, jumpAt, leaderStep, followerStep, where, notes, markIndex } = x
  const id = 'DUO-09'
  let slowed = 0
  let checked = 0
  for (let k = 1; k < trace.length; k++) {
    const direction = heldDirection(trace[k].held)
    if (!direction || jumpAt(k) || !trace[k - 1].held.length) continue
    const next = { x: trace[k - 1].L.x + direction.x * walkStep, z: trace[k - 1].L.z + direction.z * walkStep }
    if (layout.isBlocked(next.x, next.z)) continue
    checked++
    if (Math.abs(leaderStep[k] - walkStep) > 0.002) slowed++
  }
  if (slowed) out.problem(id, where, `leader did not move ${C.clipSpeed} units/s on ${slowed} of ${checked} held-key frames with free ground`)
  if (notes.reverse) {
    const k0 = markIndex(notes.reverse)
    const through = trace.slice(k0).map((s, i) => ({ k: k0 + i, gap: gapOf(s) })).filter(({ gap }) => gap < C.separation)
    if (!through.length) out.problem(id, where, 'leader never passed through the follower on the bridge deck')
    const moving = through.filter(({ k }) => followerStep[k] > 0.003).length
    if (moving) out.problem(id, where, `follower moved on ${moving} pass-through frames instead of holding`)
    out.measure(id, where, { passThroughFrames: through.length, followerMovingFrames: moving })
  }
  out.measure(id, where, { heldFrames: checked, slowedFrames: slowed })
}

function analyzeBlocked(x, out) {
  const { trace, layout, where } = x
  const id = 'DUO-10'
  const blocked = []
  for (const s of trace) {
    if (layout.isBlocked(s.F.x, s.F.z) || layout.isBlocked(s[followerOf(s)].x, s[followerOf(s)].z)) blocked.push(s.f)
  }
  if (blocked.length) out.problem(id, where, `follower in a blocked cell on ${blocked.length} frames, first ${blocked.slice(0, 5)}`)
  out.measure(id, where, { frames: trace.length, blockedFrames: blocked.length })
}

function analyzeIdle(x, out, pool) {
  const { trace, layout, stationary, swapAt, teleportAt, hopAt, target, where } = x
  for (let start = 1; start < trace.length; start++) {
    if (!stationary[start] || stationary[start - 1]) continue
    let end = start
    while (end + 1 < trace.length && stationary[end + 1] && !swapAt.has(end + 1) && !teleportAt.has(end + 1) && !hopAt.has(end + 1)) end++
    const s = trace[start]
    const heading = s[s.leader].ry
    const ahead = forward(heading)
    const side = { x: ahead.z, z: -ahead.x }
    const slots = [-1, 1].map((sign) => ({ x: s.L.x + side.x * sign * C.slotOffset, z: s.L.z + side.z * sign * C.slotOffset }))
    const usable = slots.filter((slot) => !layout.isBlocked(slot.x, slot.z) && pathClear(layout, s.F, slot))
    if (!usable.length) {
      const id = 'DUO-12'
      pool.neitherFree.push(where)
      const hold = target[start]
      for (let k = start; k <= end; k++) {
        const offset = Math.abs((trace[k].F.x - s.L.x) * side.x + (trace[k].F.z - s.L.z) * side.z)
        if (offset > 0.15) {
          out.problem(id, where, `follower left the trail toward a side slot at frame ${trace[k].f}`)
          break
        }
      }
      if (end - start >= 60) {
        const finalGap = hold ? dist(trace[end].F, hold) : dist(trace[end].F, s.F)
        if (finalGap > 0.15) out.problem(id, where, `follower ended ${r3(finalGap)} from the trail target (frame ${trace[end].f})`)
        out.measure(id, where, { episodeFrames: end - start + 1, finalOffset: r3(finalGap) })
      }
      continue
    }
    const id = 'DUO-11'
    const nearest = Math.min(...usable.map((slot) => dist(s.F, slot)))
    const accepted = usable.filter((slot) => dist(s.F, slot) <= nearest + 0.05)
    const needed = Math.ceil((nearest / C.followSpeed + 0.6) * fps)
    if (end - start < needed) continue
    let arrival = null
    for (let k = start; k <= end && arrival === null; k++) if (accepted.some((slot) => dist(trace[k].F, slot) <= 0.08)) arrival = k
    pool.idle.push({ where, f: s.f, arrival: arrival === null ? null : trace[arrival].f })
    if (arrival === null) {
      out.problem(id, where, `follower did not reach the nearer free side slot (episode from frame ${s.f}, at ${JSON.stringify(trace[end].F)})`)
      continue
    }
    const slot = accepted.find((candidate) => dist(trace[arrival].F, candidate) <= 0.08)
    const off = Math.max(...trace.slice(start, arrival + 1).map(({ F }) => segmentDistance(F, s.F, slot)))
    if (off > 0.06) out.problem(id, where, `path to the slot strayed ${r3(off)} from a straight line (frame ${s.f})`)
    let turnAt = Math.min(end, arrival + 30)
    for (let k = arrival; k <= turnAt; k++) if (trace[k].F.state === 'dance') turnAt = k - 1
    if (turnAt > arrival) {
      const turn = degrees(angleDiff(trace[turnAt][followerOf(trace[turnAt])].ry, trace[turnAt][trace[turnAt].leader].ry))
      if (turn > C.slotHeadingDeg + 3) out.problem(id, where, `follower in slot faces ${r3(turn)} deg from the leader's heading`)
    }
  }
}

function dances(x) {
  const { trace } = x
  const list = []
  for (let k = 1; k < trace.length; k++) {
    if (trace[k].L.state !== 'dance' || trace[k - 1].L.state === 'dance' || x.swapAt.has(k)) continue
    let follower = null
    for (let j = k - 1; j < Math.min(trace.length, k + fps); j++) {
      if (trace[j].F.state === 'dance' && trace[j - 1]?.F.state !== 'dance') {
        follower = j
        break
      }
    }
    list.push({ leader: k, follower })
  }
  return list
}

function analyzeDance(x, out) {
  const { trace, where, notes, markIndex } = x
  const list = dances(x)
  const id = 'DUO-13'
  const delays = []
  for (const { leader, follower } of list) {
    if (follower === null) {
      out.problem(id, where, `follower did not start dancing within 1 s of the leader (frame ${trace[leader].f})`)
      continue
    }
    const delay = (follower - leader) / fps
    delays.push(r3(delay))
    if (Math.abs(delay - C.danceDelay) > C.danceDelayTolerance) out.problem(id, where, `follower started ${r3(delay)} s after the leader`)
  }
  if (x.result.session === 'lane' && list.length < 3) out.problem(id, where, `only ${list.length} dances on the lane route`)
  out.measure(id, where, { dances: list.length, delays })
  const ends = { key: notes.danceKey, clickWalk: notes.groundClick, displacement: notes.danceNudge }
  const measured = {}
  for (const [cause, mark] of Object.entries(ends)) {
    if (!mark) continue
    const k = markIndex(mark)
    if (trace[k - 1]?.L.state !== 'dance' || trace[k - 1]?.F.state !== 'dance') {
      out.problem('DUO-14', where, `both trolls were not dancing before the ${cause} ending`)
      continue
    }
    const stopped = (role) => {
      for (let j = k; j < Math.min(trace.length, k + 10); j++) if (trace[j][role].state !== 'dance') return j - k
      return null
    }
    const leaderEnd = stopped('L')
    const followerEnd = stopped('F')
    measured[cause] = { leaderFrames: leaderEnd, followerFrames: followerEnd }
    if (leaderEnd === null || leaderEnd > 2) out.problem('DUO-14', where, `leader kept dancing after the ${cause} ending`)
    if (followerEnd === null || followerEnd > 2) out.problem('DUO-14', where, `follower kept dancing after the ${cause} ending`)
  }
  if (Object.keys(measured).length) out.measure('DUO-14', where, measured)
}

function analyzeHops(x, out, pool) {
  const { trace, hops, layout, target, where, swapAt } = x
  const id = 'DUO-15'
  for (const hop of hops) {
    const takeoff = trace[hop.start - 1]
    if (!takeoff || hop.land === null) {
      out.problem(id, where, `hop at frame ${trace[hop.start].f} did not land inside the trace`)
      continue
    }
    const landing = trace[hop.land].F
    const ground = dist(takeoff.F, landing)
    const frames = hop.land - hop.start + 1
    const expected = (C.hopBase + C.hopPerUnit * Math.max(0, ground - C.hopFreeDistance)) * fps
    const heights = trace.slice(hop.start, hop.land).map((s) => s[hop.label].y)
    const apex = Math.max(...heights)
    const curve = Math.max(...heights.map((y, i) => {
      const u = (i + 1) / frames
      return Math.abs(y - 4 * apex * u * (1 - u))
    }))
    let runStart = hop.start - 1
    while (runStart > 0 && gapOf(trace[runStart - 1]) > C.recoveryGap) runStart--
    const waited = hop.start - runStart
    const aim = target[hop.start - 1]
    const report = { f: trace[hop.start].f, ground: r3(ground), frames, expected: r3(expected), apex: r3(apex), curve: r3(curve), waited }
    pool.hops.push({ where, ...report })
    if (gapOf(takeoff) <= C.recoveryGap) out.problem(id, where, `hop at frame ${report.f} started with the pair ${r3(gapOf(takeoff))} apart`)
    if (waited < C.recoverySeconds * fps - 1) out.problem(id, where, `hop at frame ${report.f} started after ${waited} frames beyond ${C.recoveryGap}`)
    if (waited > C.recoverySeconds * fps + 2) {
      const due = runStart + C.recoverySeconds * fps
      if (target[due] && corridorClear(layout, trace[due].F, target[due])) out.problem(id, where, `hop at frame ${report.f} was ${waited - 30} frames late with a clear line`)
    }
    if (Math.abs(frames - expected) > 2) out.problem(id, where, `hop lasted ${frames} frames, expected ${r3(expected)}`)
    if (Math.abs(apex - C.hopApex) > 0.04) out.problem(id, where, `hop apex ${r3(apex)}, expected ${C.hopApex}`)
    if (curve > 0.05) out.problem(id, where, `hop height strays ${r3(curve)} from a parabola`)
    if (!aim || dist(landing, aim) > 0.2) out.problem(id, where, `hop landed ${aim ? r3(dist(landing, aim)) : 'n/a'} from the trail point 1.1 behind`)
    if (!pathClear(layout, takeoff.F, landing)) out.problem(id, where, `hop at frame ${report.f} crossed a blocked cell`)
    if (trace.slice(hop.start, hop.land).some((s, i) => swapAt.has(hop.start + i))) out.problem(id, where, `a swap was applied mid-hop at frame ${report.f}`)
  }
  // A recovery that is due with a clear line must hop.
  let run = 0
  for (let k = 0; k < trace.length; k++) {
    run = gapOf(trace[k]) > C.recoveryGap ? run + 1 : 0
    if (run !== C.recoverySeconds * fps + 3 || x.hopAt.has(k) || x.hopAt.has(k - 1) || x.hopAt.has(k - 2)) continue
    if (target[k] && corridorClear(layout, trace[k].F, target[k])) out.problem(id, where, `no hop although the follower was ${C.recoveryGap}+ away for 0.5 s with a clear line (frame ${trace[k].f})`)
  }
}

function analyzeBlockedHop(x, out) {
  const { trace, layout, target, notes, markIndex, where, followerStep, trailDistance } = x
  if (!notes.teleport) return
  const id = 'DUO-16'
  const t = markIndex(notes.teleport)
  const due = t + C.recoverySeconds * fps
  if (due >= trace.length) return out.problem(id, where, 'trace ended before the recovery decision')
  const gapHeld = trace.slice(t, due + 1).every((s) => gapOf(s) > C.recoveryGap)
  const blocked = target[due] && !pathClear(layout, trace[due].F, target[due])
  if (!gapHeld || !blocked) {
    out.problem(id, where, `route did not exercise a blocked hop line (gap held ${gapHeld}, line blocked ${Boolean(blocked)})`)
    return
  }
  const hopped = trace.slice(due - 1, due + 7).some((s) => s.hop)
  if (hopped) out.problem(id, where, 'follower hopped although the straight hop line was blocked')
  let offTrail = 0
  let fast = 0
  for (let k = t; k < Math.min(trace.length, due + 60); k++) {
    if (trace[k].hop) break
    if (trailDistance[k] > 0.1) offTrail++
    if (followerStep[k] > capStep + 0.001) fast++
  }
  if (offTrail) out.problem(id, where, `follower left the trail on ${offTrail} frames instead of walking it`)
  if (fast) out.problem(id, where, `follower exceeded the walk cap on ${fast} frames`)
  out.measure(id, where, { decisionFrame: trace[due].f, hopped, offTrail })
}

// Expected swap frames from the request marks: cooldown, hop landing and press parity.
function simulateSwaps(x) {
  const { trace, marks, markIndex, swapAt } = x
  const requests = marks.filter(({ type }) => type === 'space' || type === 'follower-click').map(markIndex)
  const expected = []
  let last = -Infinity
  let pending = null
  let next = 0
  for (let k = 0; k < trace.length; k++) {
    while (next < requests.length && requests[next] === k) {
      pending = pending === null ? k : null
      next++
    }
    const hopping = k > 0 && trace[k - 1].hop
    if (pending !== null && k >= last + C.swapCooldown * fps && !hopping) {
      expected.push({ k, requested: pending })
      pending = null
    }
    if (swapAt.has(k)) last = k
  }
  return expected
}

function analyzeSwaps(x, out) {
  const { trace, swaps, where, notes, markIndex, hops } = x
  // DUO-17: every applied swap exchanges poses by value and rebinds both models without a jump.
  for (const { k, from, to, count } of swaps) {
    const before = trace[k - 1]
    const after = trace[k]
    const id = 'DUO-17'
    if (!before) continue
    if (count !== 1 || from === to) out.problem(id, where, `frame ${after.f}: swaps +${count}, leader ${from} -> ${to}`)
    if (dist(after.L, before.F) > 0.06 || dist(after.F, before.L) > 0.06) {
      out.problem(id, where, `frame ${after.f}: poses were not exchanged (${JSON.stringify(before.L)}/${JSON.stringify(before.F)} -> ${JSON.stringify(after.L)}/${JSON.stringify(after.F)})`)
    }
    for (const label of ['a', 'b']) {
      if (dist(after[label], before[label]) > 0.03) out.problem(id, where, `frame ${after.f}: model ${label} jumped ${r3(dist(after[label], before[label]))} on rebind`)
      if (degrees(angleDiff(after[label].ry, before[label].ry)) > 25) out.problem(id, where, `frame ${after.f}: model ${label} heading snapped`)
    }
    if (dist(after[after.leader], after.L) > 0.03) out.problem(id, where, `frame ${after.f}: new leader model is not on player`)
    if (after.blockedBy !== undefined && after.blockedBy !== null) out.problem(id, where, `frame ${after.f}: blockedBy not cleared (${after.blockedBy})`)
    if (!after.samePlayer) out.problem(id, where, `frame ${after.f}: player object replaced`)
  }
  // DUO-22: observed swaps match the cooldown / parity / hop-landing model.
  const expected = simulateSwaps(x)
  const observed = swaps.map(({ k }) => k)
  for (const { k, requested } of expected) {
    if (!observed.some((o) => Math.abs(o - k) <= 1)) out.problem('DUO-22', where, `request at frame ${trace[requested].f} should apply at frame ${trace[k].f}; none did`)
  }
  for (const o of observed) {
    if (!expected.some(({ k }) => Math.abs(o - k) <= 1)) out.problem('DUO-22', where, `unexpected swap at frame ${trace[o].f}`)
  }
  const swapNear = (k, slack = 1) => swaps.find((swap) => Math.abs(swap.k - k) <= slack)
  const stillFor = (k, frames) => {
    const end = Math.min(trace.length - 1, k + frames)
    return dist(trace[end].L, trace[k].L) < 0.01 && trace.slice(k + 1, end + 1).every((s) => s.L.state !== 'walk')
  }
  if (notes.swapStanding) {
    const k = markIndex(notes.swapStanding)
    if (!swapNear(k)) out.problem('DUO-17', where, 'Space with the cooldown clear did not swap at once')
  }
  if (notes.followerClick) {
    const k = markIndex(notes.followerClick)
    const swap = swapNear(k)
    if (!swap) out.problem('DUO-18', where, 'clicking the follower did not swap the lead')
    else if (!stillFor(swap.k, fps)) out.problem('DUO-18', where, 'clicking the follower started a click-walk')
    out.measure('DUO-18', where, { click: notes.followerClick, applied: swap && trace[swap.k].f })
  }
  if (notes.swapWalking) {
    const k = markIndex(notes.swapWalking)
    const swap = swapNear(k)
    if (!swap) out.problem('DUO-19', where, 'Space while walking did not swap')
    else {
      const steps = trace.slice(swap.k + 1, swap.k + 31).map((s, i) => ({ dx: s.L.x - trace[swap.k + i].L.x, step: dist(s.L, trace[swap.k + i].L) }))
      const wrong = steps.filter(({ dx, step }) => Math.abs(step - walkStep) > 0.002 || dx > -walkStep * 0.9).length
      if (wrong) out.problem('DUO-19', where, `held key did not drive the new leader west on ${wrong} of 30 frames`)
    }
  }
  if (notes.clickDuringWalk) {
    const k = markIndex(notes.clickDuringWalk)
    const swap = swapNear(k)
    if (!swap) out.problem('DUO-19', where, 'clicking the follower during a click-walk did not swap')
    else if (!stillFor(swap.k, fps)) out.problem('DUO-19', where, 'the click-walk continued after the swap')
    if (trace[k - 1]?.L.state !== 'walk') out.problem('DUO-19', where, 'route did not exercise a click-walk at the swap')
  }
  if (notes.swapDancing) {
    const k = markIndex(notes.swapDancing)
    const swap = swapNear(k)
    if (!swap) out.problem('DUO-20', where, 'Space while dancing did not swap')
    else {
      const before = trace[swap.k - 1]
      if (before.L.state !== 'dance' || before.F.state !== 'dance') out.problem('DUO-20', where, 'route did not have both trolls dancing at the swap')
      const after = trace[Math.min(trace.length - 1, swap.k + 1)]
      if (after.L.state === 'dance' || after.F.state === 'dance') out.problem('DUO-20', where, 'a dance continued after the swap')
    }
  }
  const landingAfter = (k) => hops.find(({ start, land }) => start <= k && (land === null || land >= k))
  if (notes.swapHopping) {
    const k = markIndex(notes.swapHopping)
    const hop = landingAfter(k)
    if (!hop || hop.land === null) out.problem('DUO-21', where, 'route did not press Space during a hop')
    else {
      const swap = swaps.find(({ k: at }) => at >= k)
      const pending = trace.slice(k + 1, hop.land - 1).every((s) => s.pending === true)
      if (!pending) out.problem('DUO-21', where, 'pendingSwap was not true while waiting for the landing')
      if (!swap || Math.abs(swap.k - hop.land) > 1) out.problem('DUO-21', where, `swap applied at ${swap ? trace[swap.k].f : 'never'}, landing at ${trace[hop.land].f}`)
      out.measure('DUO-21', where, { pressed: trace[k].f, landing: trace[hop.land].f, applied: swap && trace[swap.k].f })
    }
  }
  if (notes.swapStanding && notes.oddPresses?.length === 3) {
    const k = markIndex(notes.swapStanding)
    const first = swapNear(k)
    const presses = notes.oddPresses.map(markIndex)
    if (!first) out.problem('DUO-22', where, 'route did not start the odd-press sequence with a swap')
    else {
      const due = first.k + C.swapCooldown * fps
      const inWindow = swaps.filter(({ k: at }) => at > first.k && at <= first.k + 90)
      if (inWindow.length !== 1 || Math.abs(inWindow[0].k - due) > 1) {
        out.problem('DUO-22', where, `three presses in the cooldown gave ${inWindow.length} swaps at ${inWindow.map(({ k: at }) => trace[at].f)}, expected one at ${trace[due]?.f}`)
      }
      const flags = [[presses[0] + 1, presses[1] - 1, true], [presses[1] + 1, presses[2] - 1, false], [presses[2] + 1, due - 2, true]]
      for (const [from, to, value] of flags) {
        if (trace.slice(from, to + 1).some((s) => s.pending !== value)) out.problem('DUO-22', where, `pendingSwap was not ${value} between frames ${trace[from]?.f} and ${trace[to]?.f}`)
      }
      out.measure('DUO-22', where, { first: trace[first.k].f, presses: presses.map((p) => trace[p]?.f), applied: inWindow.map(({ k: at }) => trace[at].f) })
    }
  }
  if (notes.swapWalking && notes.evenFirst && notes.evenSecond) {
    const k = markIndex(notes.swapWalking)
    const [a, b] = [markIndex(notes.evenFirst), markIndex(notes.evenSecond)]
    const extra = swaps.filter(({ k: at }) => at > k + 1 && at <= k + 90)
    if (extra.length) out.problem('DUO-23', where, `even presses still swapped at ${extra.map(({ k: at }) => trace[at].f)}`)
    if (trace.slice(a + 1, b).some((s) => s.pending !== true)) out.problem('DUO-23', where, 'pendingSwap was not true after the first press')
    if (trace.slice(b + 1, k + 90).some((s) => s.pending !== false)) out.problem('DUO-23', where, 'pendingSwap stayed true after the cancelling press')
    out.measure('DUO-23', where, { presses: [trace[a]?.f, trace[b]?.f], extraSwaps: extra.length })
  }
  if (notes.overlapSwap && notes.overlapPending) {
    const k = markIndex(notes.overlapSwap)
    const first = swapNear(k)
    if (!first) out.problem('DUO-24', where, 'first swap of the overlap sequence did not apply at once')
    else {
      const due = first.k + C.swapCooldown * fps
      const hop = landingAfter(due)
      if (!hop || hop.land === null) out.problem('DUO-24', where, 'route did not exercise a hop across the end of the cooldown')
      else {
        const second = swaps.find(({ k: at }) => at > first.k)
        if (!second || Math.abs(second.k - hop.land) > 1) out.problem('DUO-24', where, `pending swap applied at ${second ? trace[second.k].f : 'never'}, landing at ${trace[hop.land].f}`)
        out.measure('DUO-24', where, { first: trace[first.k].f, cooldownEnd: trace[due].f, landing: trace[hop.land].f, applied: second && trace[second.k].f })
      }
    }
  }
  // DUO-25: camera on the new leader within 1 s of a standing swap.
  for (const { k } of swaps) {
    const before = trace[k - 1]
    const end = k + C.cameraSettleSeconds * fps
    if (!before || end >= trace.length || before.L.state === 'walk' || before.F.state === 'walk') continue
    if (swaps.some(({ k: at }) => at > k && at <= end) || dist(trace[end].L, trace[k].L) > 0.01 || x.teleportAt.has(k)) continue
    const off = dist(trace[end].cam, trace[end].L)
    out.measure('DUO-25', where, { [`frame ${trace[k].f}`]: r3(off) })
    if (off > C.cameraSettleUnits) out.problem('DUO-25', where, `camera target ${r3(off)} from the new leader 1 s after the swap at frame ${trace[k].f}`)
  }
}

function analyzeFolds(x, out, pool) {
  const { trace, result, first, where } = x
  const id = 'DUO-26'
  for (const fold of result.foldLog) {
    if (!(fold.t > 0)) continue
    const k = Math.round(fold.t * fps) - first
    if (k < 1 || k >= trace.length) continue
    const centre = { x: fold.i * 2, z: fold.j * 2 }
    const leader = [trace[k - 1], trace[k]].map((s) => dist(s.L, centre))
    const follower = dist(trace[k].F, centre)
    if (fold.dir === 'up' && Math.min(...leader) > 2 + 0.03) out.problem(id, where, `tile ${fold.i},${fold.j} folded up with the leader ${r3(Math.min(...leader))} away`)
    if (fold.dir === 'down' && Math.max(...leader) < 3 - 0.03) out.problem(id, where, `tile ${fold.i},${fold.j} folded down with the leader ${r3(Math.max(...leader))} away`)
    if (fold.dir === 'down' && follower < 3 - 0.03) pool.foldWitness++
  }
}

function cueFrames(x) {
  const { trace } = x
  const frames = []
  let k = 0
  for (let i = 0; i < x.result.cueLog.length; i++) {
    while (k < trace.length && trace[k].cues <= i) k++
    frames.push(k < trace.length ? k : null)
  }
  return frames
}
const isCharacterCue = ({ kind, cause }) => kind === 'voice' || kind === 'step' || (kind === 'sfx' && cause !== 'fold')

function analyzeCues(x, out, pool) {
  const { trace, result, where, stationary, followerStep } = x
  const id = 'DUO-27'
  const frames = cueFrames(x)
  let checked = 0
  for (const [i, cue] of result.cueLog.entries()) {
    const k = frames[i]
    if (k === null || k === 0 || !isCharacterCue(cue)) continue
    checked++
    const leaders = new Set([trace[k].leader, trace[k - 1].leader])
    if (cue.who !== 'a' && cue.who !== 'b') out.problem(id, where, `${cue.cue} at ${r3(cue.t)} has who=${cue.who}`)
    else if (!leaders.has(cue.who)) out.problem(id, where, `${cue.cue} at ${r3(cue.t)} logged by follower ${cue.who}`)
    const bank = leaderBank(cue.cue)
    if (bank && bank !== cue.who) out.problem(id, where, `${cue.cue} played from troll ${cue.who}'s bank`)
    if (cue.kind === 'step') {
      const moved = trace.slice(Math.max(1, k - 36), Math.min(trace.length, k + 7)).some((s, j) => !x.jumpAt(Math.max(1, k - 36) + j) && x.leaderStep[Math.max(1, k - 36) + j] > 0.005)
      if (!moved) out.problem(id, where, `step cue at ${r3(cue.t)} while only the follower walked`)
    }
  }
  for (let k = 36; k < trace.length; k++) if (stationary[k] && stationary[k - 6] && followerStep[k] > 0.005) pool.followerOnly++
  out.measure(id, where, { characterCues: checked })
}

function analyzeSwapAudio(x, out) {
  const { trace, result, swaps, where, notes, markIndex } = x
  const log = result.cueLog
  const lineFor = (label) => (label === 'b' ? 'b_voice_lead' : 'voice_lead')
  const skipLines = result.session === 'missing-sample'
  const measured = []
  for (const { k, to } of swaps) {
    const before = trace[k - 1]
    if (!before) continue
    const frame = trace[k].f
    const tR = frame / fps
    const after = log.slice(before.cues)
    const line = after.find(({ cue }) => cue === lineFor(to))
    const voice = before.voice
    const active = voice && voice.t <= tR + 1e-6 && voice.end > tR + 1e-6
    const entry = { frame, to, voice: voice && { cue: voice.cue, t: r3(voice.t), naturalEnd: r3(voice.end) }, line: line && r3(line.t) }
    if (active) {
      const cutEnd = log[voice.i].end
      entry.cutEnd = r3(cutEnd)
      const lo = (frame - 1) / fps + C.voiceFade - 1e-3
      const hi = frame / fps + C.voiceFade + 1e-3
      // A voice whose natural end falls inside the fade window may simply finish.
      const fades = voice.end > hi
      if (fades && (cutEnd < lo || cutEnd > hi)) out.problem('DUO-30', where, `swap at frame ${frame}: ${voice.cue} end ${r3(cutEnd)} not ${C.voiceFade}s after the swap`)
      const age = tR - voice.t
      entry.age = r3(age)
      if (!skipLines && age >= C.swapLineGuard + 1 / fps) {
        const [from, until] = fades ? [cutEnd - 1e-3, cutEnd + 1e-3] : [voice.end - 1e-3, hi]
        if (!line || line.t < from || line.t > until) out.problem('DUO-28', where, `swap at frame ${frame}: ${lineFor(to)} ${line ? `at ${r3(line.t)}` : 'missing'}, expected at the fade end ${r3(fades ? cutEnd : voice.end)}`)
      }
      if (age < C.swapLineGuard - 1 / fps && line && line.t <= tR + 1) out.problem('DUO-29', where, `swap at frame ${frame}: ${line.cue} played although the cut voice was ${r3(age)} s old`)
    } else if (!skipLines && (!line || line.t < tR - 1 / fps - 1e-3 || line.t > tR + C.voiceFade + 1 / fps + 1e-3)) {
      out.problem('DUO-28', where, `swap at frame ${frame} with no voice playing: ${lineFor(to)} ${line ? `at ${r3(line.t)}` : 'missing'}`)
    }
    if (line && line.who !== to) out.problem('DUO-28', where, `swap line ${line.cue} logged who=${line.who}`)
    for (const cue of after) {
      if (cue.cause === 'hum' && cue.t > tR && cue.t <= tR + 0.6) out.problem('DUO-30', where, `hum ${cue.cue} at ${r3(cue.t)} survived the swap at ${r3(tR)}`)
      if (cue.cause === 'dance' && cue.t > tR && cue.t <= tR + 1) out.problem('DUO-30', where, `dance cue ${cue.cue} at ${r3(cue.t)} survived the swap at ${r3(tR)}`)
    }
    measured.push(entry)
  }
  out.measure('DUO-28', where, { swaps: measured })
  const swapNear = (mark) => mark && swaps.find(({ k }) => Math.abs(k - markIndex(mark)) <= 1)
  const find = (mark) => measured.find(({ frame }) => frame === trace[swapNear(mark)?.k]?.f)
  if (result.session === 'lane') {
    const ab = find(notes.swapStanding)
    const oddApplied = notes.swapStanding && swaps.find(({ k }) => k > markIndex(notes.swapStanding) + 1)
    const ba = oddApplied && measured.find(({ frame }) => frame === trace[oddApplied.k].f)
    if (!ab?.line || ab.to !== 'b') out.problem('DUO-28', where, 'A -> B standing swap had no b_voice_lead line')
    if (!ba?.line || ba.to !== 'a') out.problem('DUO-28', where, 'the following B -> A swap had no voice_lead line')
    const guarded = find(notes.swapDancing)
    if (!guarded?.age || guarded.age >= C.swapLineGuard) out.problem('DUO-29', where, 'route did not swap within 0.3 s of a voice starting')
    if (!guarded?.cutEnd) out.problem('DUO-30', where, 'route did not cut an active voice on a swap')
    out.measure('DUO-29', where, { guarded })
    out.measure('DUO-30', where, { cut: guarded })
  }
}

function analyzeMissing(x, out) {
  const { trace, result, where } = x
  const id = 'DUO-31'
  const played = result.cueLog.filter(({ cue }) => droppedCues.includes(cue)).map(({ cue }) => cue)
  const bCues = result.cueLog.filter(({ who }) => who === 'b').length
  const danced = trace.some((s) => s.L.state === 'dance' && s.leader === 'b')
  if (result.errors.length) out.problem(id, where, `errors: ${result.errors.slice(0, 3).join(' | ')}`)
  if (played.length) out.problem(id, where, `missing samples were logged as played: ${played}`)
  if (trace.at(-1).swaps !== 1 || trace.at(-1).leader !== 'b') out.problem(id, where, 'swap to troll B did not complete')
  if (!danced) out.problem(id, where, 'troll B did not dance after the missing sample')
  if (!bCues) out.problem(id, where, 'troll B logged no cues at all')
  out.measure(id, where, { errors: result.errors, bCues, droppedCues })
}

function analyzeTrailPath(x, out) {
  const { trace, stationary, trailDistance, hopAt, swapAt, teleportAt, where } = x
  const id = 'DUO-37'
  let joined = false
  let quiet = 0
  let checked = 0
  const off = []
  for (let k = 0; k < trace.length; k++) {
    const disturbed = stationary[k] || hopAt.has(k) || teleportAt.has(k) || gapOf(trace[k]) < 0.6 || trace[k].F.state === 'dance'
    if (disturbed) {
      joined = false
      quiet = 0
      continue
    }
    if (swapAt.has(k)) joined = false
    quiet++
    if (!joined && trailDistance[k] <= 0.05) joined = true
    if (!joined || quiet < 30) continue
    checked++
    if (trailDistance[k] > 0.1) off.push(trace[k].f)
  }
  if (off.length) out.problem(id, where, `follower left the leader's path by > 0.1 on ${off.length} frames, first ${off.slice(0, 5)}`)
  if (x.result.session !== 'missing-sample' && checked < 120) out.problem(id, where, `only ${checked} trail-following frames checked`)
  out.measure(id, where, { checked, offFrames: off.length })
}

function evaluatePools(viewportKey, pool, out) {
  const where = viewportKey
  const follow = pool.follow
  const followMedian = median(follow)
  const followMax = Math.max(...follow)
  out.measure('DUO-05', where, { frames: follow.length, median: r3(followMedian), max: r3(followMax) })
  if (follow.length < 60) out.problem('DUO-05', where, `only ${follow.length} straight-walk frames after 2 s`)
  else {
    if (followMedian < C.followMedian[0] || followMedian > C.followMedian[1]) out.problem('DUO-05', where, `median distance ${r3(followMedian)}`)
    if (followMax > C.followMax) out.problem('DUO-05', where, `max distance ${r3(followMax)}`)
  }
  const catchUp = median(pool.catchUp)
  out.measure('DUO-06', where, { catchUpFrames: pool.catchUp.length, catchUpMedianSpeed: r3(catchUp) })
  if (pool.catchUp.length < 30 || !(catchUp >= C.followSpeed - 0.1)) out.problem('DUO-06', where, `catch-up speed ${r3(catchUp)} over ${pool.catchUp.length} frames, expected ~${C.followSpeed}`)
  // DUO-07
  const refs = { a: median(pool.clipRef.a), b: median(pool.clipRef.b) }
  const windows = pool.clipFollow.filter(({ label }) => Number.isFinite(refs[label]))
  for (const { label, speed, frequency, at, k } of windows) {
    const expected = Math.min(C.clipScale[1], Math.max(C.clipScale[0], speed / C.clipSpeed))
    const ratio = frequency / refs[label]
    if (Math.abs(ratio - expected) > 0.1 * expected) out.problem('DUO-07', where, `${at} frame ${k}: troll ${label} at ${speed} units/s plays the walk at x${r3(ratio)}, expected x${r3(expected)}`)
  }
  for (const label of ['a', 'b']) if (!Number.isFinite(refs[label])) out.problem('DUO-07', where, `no reference walk for troll ${label} as leader`)
  if (!windows.some(({ speed }) => speed >= 1.45)) out.problem('DUO-07', where, 'no steady catch-up window to measure')
  out.measure('DUO-07', where, { references: { a: r3(refs.a), b: r3(refs.b) }, windows })
  // DUO-08
  const share = pool.separation.ok / pool.separation.total
  out.measure('DUO-08', where, { frames: pool.separation.total, share: r3(share) })
  if (!(share >= C.separationShare)) out.problem('DUO-08', where, `separation >= ${C.separation} on ${r3(share * 100)} % of frames`)
  // DUO-11 / DUO-12 witnesses
  out.measure('DUO-11', where, { episodes: pool.idle })
  if (!pool.idle.length) out.problem('DUO-11', where, 'route had no idle episode long enough to reach a slot')
  if (!pool.neitherFree.length) out.problem('DUO-12', where, 'route never stopped where neither slot was free')
  // DUO-15
  out.measure('DUO-15', where, { hops: pool.hops })
  if (pool.hops.length < 2) out.problem('DUO-15', where, `only ${pool.hops.length} recovery hops on the route`)
  // DUO-26
  out.measure('DUO-26', where, { downFoldsWithFollowerNear: pool.foldWitness })
  if (!pool.foldWitness) out.problem('DUO-26', where, 'no tile folded down while the follower stood within 3 units')
  // DUO-27
  if (pool.followerOnly < 30) out.problem('DUO-27', where, 'route never had the follower walking while the leader stood')
  // DUO-34..36
  const stats = framingStats(pool.framing, { fps, contract: C })
  out.measure('DUO-34', where, { frames: stats.frames, outsideFrames: stats.outsideFrames, firstOutside: stats.firstOutside })
  out.measure('DUO-35', where, { longestOverlapFrames: stats.longestOverlapFrames, at: stats.longestOverlapAt })
  out.measure('DUO-36', where, { longestHiddenFrames: stats.longestHiddenFrames, at: stats.longestHiddenAt })
  if (stats.outsideFrames) out.problem('DUO-34', where, `${stats.outsideFrames} frames with a character outside the frame`)
  if (stats.longestOverlapFrames > stretch) out.problem('DUO-35', where, `follower overlapped the leader by > 50 % for ${stats.longestOverlapFrames} frames`)
  for (const label of ['a', 'b']) {
    if (stats.longestHiddenFrames[label] > stretch) out.problem('DUO-36', where, `troll ${label} hidden behind tiles for ${stats.longestHiddenFrames[label]} frames`)
  }
}

function newPool() {
  return {
    follow: [], catchUp: [], clipRef: { a: [], b: [] }, clipFollow: [], separation: { ok: 0, total: 0 },
    idle: [], neitherFree: [], hops: [], foldWitness: 0, followerOnly: 0, framing: [],
  }
}

async function staticChecks(out) {
  try {
    const a = await summarizeTroll(trollA)
    let b
    try {
      b = await summarizeTroll(trollB)
    } catch (error) {
      out.problem('DUO-02', 'troll_b.glb', error.code === 'ENOENT' ? 'public/models/troll_b.glb does not exist' : error.message)
    }
    if (b) {
      for (const problem of checkTrollB(a, b, C)) out.problem('DUO-02', 'troll_b.glb', problem)
      out.measure('DUO-02', 'troll_b.glb', { triangles: b.triangles, top: r3(b.top), clips: b.clips, bones: b.bones.length, textures: b.textures.length })
    }
  } catch (error) {
    out.problem('DUO-02', 'troll.glb', error.message)
  }
  let banks
  try {
    banks = await readCueBanks()
    for (const cue of banks.missing) out.problem('DUO-32', 'manifest', `required cue ${cue} is missing`)
    for (const file of banks.missingFiles) out.problem('DUO-32', 'manifest', `sample ${file} is missing`)
    for (const text of banks.wordy) out.problem('DUO-32', 'cue sheet', `B line longer than 2 words: ${text}`)
    out.measure('DUO-32', 'manifest', { required: banks.required, note: 'audio/generate.mjs --check is the shipping gate; run it separately' })
  } catch (error) {
    out.problem('DUO-32', 'manifest', error.message)
  }
  try {
    if (!banks) throw new Error('cue banks unreadable')
    const pitch = voiceBPitch(banks.manifest, banks.sheet)
    out.measure('DUO-33', 'voice B', pitch)
    if (!pitch.takes) out.problem('DUO-33', 'voice B', 'no non-sung b_voice_* takes in the manifest')
    else if (!(pitch.medianF0Hz >= C.voiceF0[0] && pitch.medianF0Hz <= C.voiceF0[1])) out.problem('DUO-33', 'voice B', `median f0 ${r3(pitch.medianF0Hz)} Hz`)
  } catch (error) {
    out.problem('DUO-33', 'voice B', error.message)
  }
  return banks
}

async function browserChecks(out, { baseURL, traceOut }) {
  const browser = await launchChromium()
  const kept = []
  try {
    const errors = []
    for (const viewport of duoViewports) {
      const key = `${viewport.width}x${viewport.height}`
      const pool = newPool()
      for (const session of [laneSession, bridgeSession, cornerSession]) {
        const result = await session(browser, viewport, { baseURL })
        const { trace } = result
        await closeSession(browser)
        const x = prepare(result)
        errors.push(...result.errors.map((error) => `${x.where}: ${error}`))
        analyzeSurface(x, out)
        analyzeStart(x, out)
        analyzeTrail(x, out)
        analyzeFollow(x, out, pool)
        collectClipWindows(x, pool)
        analyzeSeparation(x, out, pool)
        analyzeLeaderFree(x, out)
        analyzeBlocked(x, out)
        analyzeIdle(x, out, pool)
        analyzeDance(x, out)
        analyzeHops(x, out, pool)
        analyzeBlockedHop(x, out)
        analyzeSwaps(x, out)
        analyzeFolds(x, out, pool)
        analyzeCues(x, out, pool)
        analyzeSwapAudio(x, out)
        analyzeTrailPath(x, out)
        pool.framing.push(...trace)
        if (traceOut) kept.push(result)
      }
      evaluatePools(key, pool, out)
    }
    const missing = await missingSampleSession(browser, duoViewports[0], { baseURL })
    await closeSession(browser)
    const mx = prepare(missing)
    analyzeMissing(mx, out)
    analyzeSwapAudio(mx, out)
    analyzeCues(mx, out, newPool())
    out.measure('DUO-41', 'all sessions', { errors })
    for (const error of errors) out.problem('DUO-41', 'browser', error)
    if (traceOut) {
      await mkdir(dirname(traceOut), { recursive: true })
      await writeFile(traceOut, JSON.stringify(kept.concat(missing)))
    }
  } finally {
    await browser.close()
  }
}

async function closeSession(browser) {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.close()
}

// Runs every DUO-* check and reports through the caller's `check(name, measured, verify)`.
export async function runDuo({ baseURL, check, traceOut }) {
  const out = createResults()
  let failure
  await staticChecks(out)
  try {
    await browserChecks(out, { baseURL, traceOut })
  } catch (error) {
    failure = error.message.split('\n').slice(0, 6).join('\n')
  }
  const staticOnly = new Set(['DUO-02', 'DUO-32', 'DUO-33'])
  for (const [id] of duoScenarios) {
    const { measured, problems } = out.results.get(id)
    check(titles.get(id), measured, () => {
      if (failure && !staticOnly.has(id)) assert.fail(`not reached: ${failure}`)
      assert.deepEqual(problems, [])
    })
  }
}
