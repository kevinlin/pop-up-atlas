import { expect, test } from 'vitest'
import {
  bookShare, buildRoute6, evaluateRound6Framing, evaluateRound6Witnesses, hasHinges, insideBand, modelBookShares,
  plannedFolds, planRound6CaptureRoute, roundOptions, route6Anchors, route6Contract, route6Problems, simulateKeys, duoTiming,
} from '../scripts/capture.mjs'
import { createLayout } from '../src/world/layout.js'
import { PAGE_MAX_Z, PAGE_MIN_Z } from '../src/world/tiles.js'

const fps = 60
const walkCamera = (z) => ({ distance: 7.5, pitch: 35, beat: null, target: { x: 0, y: 0, z } })

test('bookShare measures the screen share past the page band from the camera pose', () => {
  // Centred on the front edge, the lower part of the frame shows the book edge and the table.
  expect(bookShare(walkCamera(PAGE_MAX_Z))).toBeGreaterThan(0.3)
  // Four units inside the edge, the walk camera shows only page.
  expect(bookShare(walkCamera(PAGE_MAX_Z - 4))).toBe(0)
  // The back edge shows further up the frame (the camera looks north), so it is visible at 4 units and gone at 10.
  expect(bookShare(walkCamera(PAGE_MIN_Z + 4))).toBeGreaterThan(0)
  expect(bookShare(walkCamera(PAGE_MIN_Z + 10))).toBe(0)
  // Mid-page at the fit limit and at both beat poses stays on the page.
  expect(bookShare({ distance: 10, pitch: 35, target: { x: 0, y: 0, z: 2 } })).toBe(0)
  expect(bookShare({ distance: 4.5, pitch: 22, target: { x: 0, y: 0.25, z: 2 } })).toBe(0)
  expect(bookShare({ distance: 6, pitch: 30, target: { x: 0, y: 0, z: 2 } })).toBe(0)
  // Moving toward the edge never shows less of it.
  const shares = [4, 5, 6, 7, 8, 9].map((z) => bookShare(walkCamera(z)))
  expect(shares).toEqual([...shares].sort((a, b) => a - b))
})

test('insideBand is the distance to the nearer page-band edge', () => {
  expect(insideBand(PAGE_MAX_Z - 3)).toBeCloseTo(3)
  expect(insideBand(PAGE_MIN_Z + 2)).toBeCloseTo(2)
  expect(insideBand(-1)).toBeCloseTo(Math.min(-1 - PAGE_MIN_Z, PAGE_MAX_Z + 1))
})

test('hinges: props and bridges always, a meadow unless it is in a clearing, never path or river', () => {
  expect(['flower', 'mushroom_house', 'cupcake_tree', 'yarn_bridge'].every((id) => hasHinges({ id }))).toBe(true)
  expect(hasHinges({ id: 'meadow', zone: 'grove' })).toBe(true)
  expect(hasHinges({ id: 'meadow', zone: 'clearing' })).toBe(false)
  expect(hasHinges({ id: 'path' })).toBe(false)
  expect(hasHinges({ id: 'river' })).toBe(false)
})

// A layout with one tile at cell (0, 0) of the given id and plain path elsewhere.
const oneTile = (id, zone = 'grove') => ({ getCell: (i, j) => (i === 0 && j === 0 ? { id, zone } : { id: 'path', zone }) })
const walkPast = (from, to, frames, z = 0) => Array.from({ length: frames }, (_, k) => ({ x: from + (to - from) * k / (frames - 1), z }))

test('plannedFolds models stage 1 (lift within 4.5, drop beyond 5.5) and stage 2 (up within 2, down beyond 3)', () => {
  const events = plannedFolds(walkPast(12, -12, 1200), oneTile('mushroom_house'))
  const first = (list) => list.find(({ i, j }) => i === 0 && j === 0)
  const lift = first(events.lifts)
  const up = first(events.ups)
  const down = first(events.downs)
  const drop = first(events.drops)
  // The leader moves 24 units over 1200 frames: x(frame) = 12 - 24 * frame / 1199.
  const xAt = (frame) => 12 - 24 * frame / 1199
  expect(xAt(lift.frame)).toBeLessThanOrEqual(4.5)
  expect(xAt(lift.frame - 1)).toBeGreaterThan(4.5)
  expect(xAt(up.frame)).toBeLessThanOrEqual(2)
  expect(xAt(up.frame - 1)).toBeGreaterThan(2)
  expect(-xAt(down.frame)).toBeGreaterThan(3)
  expect(-xAt(drop.frame)).toBeGreaterThan(5.5)
  expect([lift.frame, up.frame, down.frame, drop.frame]).toEqual([...[lift.frame, up.frame, down.frame, drop.frame]].sort((a, b) => a - b))
  expect(events.stageDowns).toEqual([])
})

test('plannedFolds: paths and rivers have no hinges, a clearing meadow has none, a grove meadow has', () => {
  for (const [id, zone, count] of [['path', 'grove', 0], ['river', 'grove', 0], ['meadow', 'clearing', 0], ['meadow', 'grove', 1], ['yarn_bridge', 'grove', 1]]) {
    expect(plannedFolds(walkPast(12, 0, 600), oneTile(id, zone)).ups.filter(({ i, j }) => i === 0 && j === 0)).toHaveLength(count)
  }
})

test('plannedFolds: the dance stage flattens props within 1.8 of either character until the dance ends', () => {
  // Stand next to the tile from frame 300; a dance starts at 400 and ends at 600.
  const positions = [...walkPast(8, 1.5, 300), ...Array.from({ length: 500 }, () => ({ x: 1.5, z: 0 }))]
  const dance = { startFrame: 400, endFrame: 600, follower: () => ({ x: 2.25, z: 0 }) }
  const events = plannedFolds(positions, oneTile('flower'), { dance })
  expect(events.stageDowns).toEqual([expect.objectContaining({ frame: 400, cause: 'stage', id: 'flower' })])
  // After the end, the normal rules apply again: a stage-2 fold-up fires there.
  const ups = events.ups.filter(({ i, j }) => i === 0 && j === 0)
  expect(ups.at(-1).frame).toBe(600)
  expect(ups.some(({ frame }) => frame > 400 && frame < 600)).toBe(false)
  // Tiles beyond 1.8 of both characters stay as they were; stage-1 tiles drop silently.
  const far = plannedFolds([...walkPast(8, 3.5, 300), ...Array.from({ length: 500 }, () => ({ x: 3.5, z: 0 }))], oneTile('flower'),
    { dance: { startFrame: 400, endFrame: 600, follower: () => ({ x: 4.25, z: 0 }) } })
  expect(far.stageDowns).toEqual([])
  const silent = plannedFolds([...walkPast(12, 3.9, 300), ...Array.from({ length: 500 }, () => ({ x: 3.9, z: 0 }))], oneTile('flower'),
    { dance: { startFrame: 400, endFrame: 600, follower: () => ({ x: 1.5, z: 0 }) } })
  expect(silent.drops.some(({ frame, cause }) => frame === 400 && cause === 'stage')).toBe(true)
  expect(silent.stageDowns).toEqual([])
})

test('simulateKeys integrates held keys, refuses blocked steps and hands the lead to B behind A', () => {
  const layout = { blockedBy: (x) => (x >= 3 ? 'river' : null) }
  const sim = simulateKeys(layout, { x: 0, z: 0 }, [
    { frame: 0, down: ['KeyD'] },
    { frame: 60, press: ['Space'] },
    { frame: 61, up: ['KeyD'] },
  ], 200)
  const stride = 1.2 / 60
  expect(sim.positions[59].x).toBeCloseTo(60 * stride)
  expect(sim.swapFrame).toBe(60)
  expect(sim.leaders[59]).toBe('a')
  expect(sim.leaders[60]).toBe('b')
  // B takes the follower's place, followGap back along the path.
  expect(sim.positions[60].x).toBeLessThan(sim.positions[59].x - duoTiming.followGap + 2 * stride)
  const walled = simulateKeys(layout, { x: 2.9, z: 0 }, [{ frame: 0, down: ['KeyD'] }], 60)
  expect(walled.bumps.length).toBeGreaterThan(0)
  expect(walled.bumps[0]).toMatchObject({ reason: 'river', who: 'a' })
  expect(walled.positions.at(-1).x).toBeLessThan(3)
})

test('the round 6 capture plan holds every route rule on its layout', () => {
  const plan = planRound6CaptureRoute()
  const { layout, sim, frames, shares } = plan
  expect(route6Problems(plan, layout).problems).toEqual([])
  expect(sim.positions).toHaveLength(30 * fps)
  // Opening: the front edge shows; later: never more than 10 %, the leader at least 4 units inside the band from 6 s.
  expect(shares.opening).toBeGreaterThanOrEqual(0.05)
  expect(shares.later).toBeLessThanOrEqual(0.10)
  const from = 6 * fps
  expect(Math.min(...sim.positions.slice(from).map(({ z }) => insideBand(z)))).toBeGreaterThanOrEqual(4)
  // A swap, then B walks into a river (and only B, and only a river), then the dance on the planned frame.
  expect(sim.swapFrame).toBe(frames.swap)
  expect(sim.bumps.every(({ reason, who }) => reason === 'river' && who === 'b')).toBe(true)
  expect(sim.bumps.length).toBeGreaterThan(0)
  expect(sim.bumps[0].frame).toBeLessThan(frames.face - 40)
  expect(plan.danceSeconds).toBe(route6Contract.danceSeconds)
  // The dance ends before the clip does, with the follower's canon offset inside it.
  expect(frames.danceEnd).toBeLessThanOrEqual(30 * fps - duoTiming.tailMarginSeconds * fps + 1)
  // Both fold stages are planned: fold-ups with chimes (>= 4) and a hero fold-up before the swap.
  expect(plan.folds.ups.length).toBeGreaterThanOrEqual(duoTiming.minFoldUps)
  expect(plan.heroBeats.length).toBeGreaterThan(0)
  expect(plan.heroBeats[0].frame).toBeLessThan(frames.swap)
  expect(plan.folds.lifts.length).toBeGreaterThan(0)
  // The plan is deterministic and cached.
  expect(planRound6CaptureRoute()).toBe(plan)
})

test('the search plans the same kind of route on its own and reports a missing one', () => {
  // Fixed seed 0 through the search path (not the pinned parameters): the same sound plan comes out.
  const plan = planRound6CaptureRoute({ seeds: [0] })
  expect(route6Problems(plan, plan.layout).problems).toEqual([])
  expect(() => planRound6CaptureRoute({ seeds: [] })).toThrow(/No round-6 capture route/)
  // A tighter clip budget that cannot close is refused by the builder.
  const layout = createLayout(0)
  expect(buildRoute6(layout, { zA: 3.2, riverX: 39.64, edgeFrames: 0, eastFrames: 300 },
    route6Anchors({ total: 600 }))).toBeNull()
}, 60_000)

test('a plan whose lane is blocked, or whose follower dance slot is blocked, fails the plan check', () => {
  const plan = planRound6CaptureRoute()
  const walled = { ...plan.layout, getCell: (...args) => plan.layout.getCell(...args), isBlocked: (x, z) => z < plan.zB + 0.4 && z > plan.zB - 0.4,
    blockedBy: (x, z) => (z < plan.zB + 0.4 && z > plan.zB - 0.4 ? 'prop' : null) }
  expect(route6Problems(plan, walled).problems.join('\n')).toMatch(/corridor is blocked/)
})

test('modelBookShares widens the share where a beat pose or its ease could show more of the edge', () => {
  const positions = Array.from({ length: 600 }, () => ({ x: 0, z: PAGE_MAX_Z - 2.5 }))
  const plain = modelBookShares(positions)
  const beat = modelBookShares(positions, { dance: { startFrame: 300, endFrame: 400 } })
  expect(Math.max(...beat)).toBeGreaterThanOrEqual(Math.max(...plain))
  expect(beat[0]).toBeCloseTo(plain[0])
  expect(beat[340]).toBeGreaterThanOrEqual(plain[340])
})

test('the book-edge verdict: the opening must show the edge, later frames must not, the leader stays inside', () => {
  const sample = (index, z, camZ = z, camera = {}) => ({ L: { z }, camera: { ...walkCamera(camZ), ...camera } })
  const good = Array.from({ length: 1800 }, (_, i) => (i < 120 ? sample(i, 8.5) : sample(i, 4)))
  const verdict = evaluateRound6Framing(good, { fps })
  expect(verdict.pass).toBe(true)
  expect(verdict.openingMaxShare).toBeGreaterThanOrEqual(0.05)
  expect(verdict.laterMaxShare).toBeLessThanOrEqual(0.10)
  expect(verdict.minInside).toBeGreaterThanOrEqual(4)

  const noEdge = Array.from({ length: 1800 }, (_, i) => sample(i, 4))
  expect(evaluateRound6Framing(noEdge, { fps }).problems.join()).toMatch(/first 4 s show at most/)

  const lateEdge = good.map((s, i) => (i === 700 ? sample(i, 4, PAGE_MAX_Z) : s))
  expect(evaluateRound6Framing(lateEdge, { fps }).problems.join()).toMatch(/of frame 700/)

  const close = good.map((s, i) => (i === 900 ? sample(i, PAGE_MAX_Z - 3, 4) : s))
  expect(evaluateRound6Framing(close, { fps }).problems.join()).toMatch(/3.00 units inside the page band at frame 900/)

  // The first six seconds are exempt from the margin and the 10 % limit.
  const early = good.map((s, i) => (i === 300 ? sample(i, PAGE_MAX_Z - 1, PAGE_MAX_Z) : s))
  expect(evaluateRound6Framing(early, { fps }).pass).toBe(true)

  // A build without the camera rig cannot be measured: that is a failure, not a pass.
  expect(evaluateRound6Framing([{ L: { z: 4 }, camera: null }], { fps }).pass).toBe(false)
})

// A 30 s trace with every witness present; tests break one thing at a time.
function witnessTrace() {
  const clipStart = 2
  const total = 1800
  const trace = Array.from({ length: total }, (_, f) => ({
    f, leader: f < 600 ? 'a' : 'b', swaps: f < 600 ? 0 : 1,
    L: { x: f < 1000 ? 9 + f / 1000 : 9.97, z: 3, state: f >= 1200 && f < 1420 ? 'dance' : 'walk' },
    F: { x: 8, z: 3, state: f >= 1219 && f < 1420 ? 'dance' : 'walk' },
    camera: { distance: 7.5, pitch: 35, target: { x: 0, y: 0, z: 3 }, beat: null },
    umbrella: { open: false, t: 0 },
  }))
  for (let f = 100; f < 190; f++) trace[f].camera.beat = 'hero'
  for (let f = 1000; f < 1072; f++) trace[f].umbrella = { open: true, t: clipStart + 1000 / fps }
  for (let f = 1190; f < 1420; f++) trace[f].camera.beat = 'dance'
  const foldLog = [{ dir: 'up', id: 'cupcake_tree', i: 5, j: 1, t: clipStart + 100 / fps }]
  const layout = { blockedBy: (x) => (x >= 9.99 ? 'river' : null) }
  return { trace, foldLog, layout, clipStart }
}

test('witnesses: a trace with a hero beat, a swap, the umbrella pop at a river and the full duo dance passes', () => {
  const { trace, foldLog, layout, clipStart } = witnessTrace()
  const result = evaluateRound6Witnesses(trace, { foldLog, layout, clipStart, fps })
  expect(result.problems).toEqual([])
  expect(result.pass).toBe(true)
  expect(result.hero).toMatchObject({ observed: true, frame: 100, fold: { id: 'cupcake_tree' } })
  expect(result.swap).toMatchObject({ observed: true, frame: 600, swaps: 1, leaderAtEnd: 'b' })
  expect(result.river).toMatchObject({ observed: true, frame: 1000, leader: 'b', riverBesideLeader: true })
  expect(result.dance).toMatchObject({ observed: true, startFrame: 1200, endFrame: 1420, followerStartFrame: 1219 })
  expect(result.dance.followerOffsetSeconds).toBeCloseTo(duoTiming.followerDanceDelay, 1)
  expect(result.dance.beatFramesMissing).toBe(0)
})

test('witnesses: each missing or mistimed witness is reported', () => {
  const run = (change) => {
    const input = witnessTrace()
    change(input)
    return evaluateRound6Witnesses(input.trace, { ...input, fps })
  }
  const failing = (change, pattern) => {
    const result = run(change)
    expect(result.pass).toBe(false)
    expect(result.problems.join('\n')).toMatch(pattern)
  }
  failing(({ trace }) => trace.forEach((s) => { s.camera.beat = s.camera.beat === 'hero' ? null : s.camera.beat }), /no hero beat observed/)
  failing(({ foldLog }) => foldLog.splice(0), /did not start with a hero fold-up/)
  failing(({ foldLog }) => { foldLog[0].id = 'flower' }, /did not start with a hero fold-up/)
  failing(({ foldLog }) => { foldLog[0].i = 40 }, /hero fold-up was .* units from the leader/)
  failing(({ trace }) => { for (let f = 150; f < 190; f++) trace[f].camera.beat = null }, /hero beat lasted/)
  failing(({ trace }) => trace.forEach((s) => { s.leader = 'a'; s.swaps = 0 }), /lead swap not observed/)
  failing(({ trace }) => trace.forEach((s) => { s.umbrella = { open: false, t: 0 } }), /no umbrella pop observed/)
  failing(({ trace }) => { trace.forEach((s, f) => { if (f >= 1000 && f < 1072) s.umbrella.t = 0.5 }) }, /stale pop/)
  failing(({ layout }) => { layout.blockedBy = () => null }, /no river beside the leader/)
  failing(({ trace }) => { for (let f = 1050; f < 1072; f++) trace[f].umbrella.open = false }, /umbrella stayed open/)
  failing(({ trace }) => { trace.forEach((s) => { if (s.F.state === 'dance') s.F.state = 'walk' }) }, /duo dance never finished|never danced/)
  failing(({ trace }) => { for (let f = 1300; f < 1320; f++) trace[f].camera.beat = null }, /dance beat missing on 20 frames/)
  failing(({ trace }) => { for (let f = 1190; f < 1250; f++) trace[f].camera.beat = null }, /dance beat/)
  failing(({ trace }) => { trace.forEach((s, f) => { if (f >= 1219 && f < 1250 && s.F.state === 'dance') s.F.state = 'walk' }); trace.forEach((s, f) => { if (f >= 1250 && f < 1420) s.F.state = 'dance' }) }, /follower started the dance/)
  failing(({ trace }) => trace.forEach((s) => { s.L.state = 'walk' }), /never danced/)
})

test('witnesses: the umbrella must pop on the collision, not at the dance bow', () => {
  const input = witnessTrace()
  // Only the bow pop remains: umbrella open during the dance, none before it.
  input.trace.forEach((s, f) => { s.umbrella = f >= 1380 && f < 1450 ? { open: true, t: input.clipStart + 1380 / fps } : { open: false, t: 0 } })
  const result = evaluateRound6Witnesses(input.trace, { ...input, fps })
  expect(result.pass).toBe(false)
  expect(result.river.observed).toBe(false)
})

test('the sbs script accepts --old-url and capture does not', () => {
  const argv = process.argv
  try {
    process.argv = [...argv.slice(0, 2), '--round', '6', '--old-url', 'http://localhost:4174']
    expect(roundOptions('sbs')).toMatchObject({ round: 6, oldURL: 'http://localhost:4174' })
    // Only sbs knows the option.
    expect(() => roundOptions('capture')).toThrow()
  } finally {
    process.argv = argv
  }
})
