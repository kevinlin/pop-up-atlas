// Camera checks for round 6 (docs/contracts.md "Round 6" → Camera): R6-CAM-01..08. The numbers below are the contract's; the
// beat gate (hero fold-up within 2.5, 8 s gap, hop block, cancels) is modelled here from the logged events and checked
// against the camera state the probe sampled each frame (`__atlas.camera` = {distance, pitch, target, beat}).
import { duoContract } from './e2e-duo-plan.mjs'
import { insideFrame } from './e2e-duo-probe.mjs'
import { distance, fps, framingPerRoute, median, r3, runText, viewportOf } from './e2e-duo-round6-common.mjs'

export const cameraNumbers = {
  walk: { distance: 7.5, pitch: 35 },
  dance: { distance: 4.5, pitch: 22, aimY: 0.25, easeInSeconds: 0.6, easeOutSeconds: 0.8 },
  hero: { distance: 6.0, pitch: 30, seconds: 1.5, gapSeconds: 8, radius: 2.5, steadyAfterSeconds: 1, ids: ['mushroom_house', 'cupcake_tree', 'yarn_bridge'] },
  fixed: { distance: 9, pitch: 40 },
  fitMax: 10,
  pitchTolerance: 0.05,
  distanceTolerance: 0.02,
  // A frame is steady when no beat has been active for this long (the 0.8 s ease out, then the fit's τ 0.25 s smoothing).
  settleSeconds: 1.5,
  // Share of steady frames at the nominal distance: the fit only raises it when a character would leave the frame.
  nominalShare: 0.7,
  // Frames either side of an event in which the sampled state may change (the probe reads after the frame's update).
  slack: 3,
  // Beyond this pair gap a beat that never started may have been skipped by the fit (> 7.5 needed).
  closePair: 1.3,
  // docs/contracts.md "Duo" -> On screen: the follow bound keeps the follower in frame.
  followBound: 2.2,
}
const C = cameraNumbers
const ids = ['R6-CAM-01', 'R6-CAM-02', 'R6-CAM-03', 'R6-CAM-04', 'R6-CAM-05', 'R6-CAM-06', 'R6-CAM-07', 'R6-CAM-08']

// Per frame: true when the camera is in its walk state (no beat now, none for `seconds`).
export function steadyMask(trace, seconds = C.settleSeconds) {
  const need = Math.round(seconds * fps)
  let since = Infinity
  return trace.map((s) => {
    since = s.camera?.beat ? 0 : since + 1
    return !s.camera?.beat && since >= need
  })
}

const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance
const share = (values, test) => (values.length ? values.filter(test).length / values.length : 0)
// The pair is within the follow bound (2.2 while walking): only then does the camera owe its nominal distance, because the fit
// may raise it whenever a character would leave the frame.
const close = (s) => distance(s.L, s.F) <= C.followBound

function runsOf(trace, first, test) {
  const runs = []
  for (const [k, s] of trace.entries()) {
    if (test(s)) {
      if (runs.length && runs.at(-1).endK === k - 1) runs.at(-1).endK = k
      else runs.push({ startK: k, endK: k })
    }
  }
  return runs.map(({ startK, endK }) => ({ startK, endK, startF: first + startK, endF: first + endK, frames: endK - startK + 1 }))
}

function pitchProblems(label, frames, target, tolerance) {
  const off = frames.filter(({ camera }) => !near(camera.pitch, target, tolerance))
  return off.length ? [`${label}: ${off.length} frames with pitch outside ${target} ± ${tolerance}° (first at frame ${off[0].f}: ${r3(off[0].camera.pitch)}°)`] : []
}

// ---- R6-CAM-01 walk camera --------------------------------------------------------------------------------------

function analyzeWalk(x, out, pool) {
  const mask = steadyMask(x.trace)
  const steady = x.trace.filter((s, k) => mask[k])
  pool.steady += steady.length
  if (steady.length < 30) return out.measure('R6-CAM-01', x.where, { steadyFrames: steady.length })
  const distances = steady.map(({ camera }) => camera.distance)
  const calm = steady.filter(close).map(({ camera }) => camera.distance)
  const nominal = share(calm, (d) => near(d, C.walk.distance, C.distanceTolerance))
  out.measure('R6-CAM-01', x.where, { steadyFrames: steady.length, closeFrames: calm.length, medianDistance: r3(median(distances)), maxDistance: r3(Math.max(...distances)), nominalShare: r3(nominal) })
  for (const text of pitchProblems('walk camera', steady, C.walk.pitch, C.pitchTolerance)) out.problem('R6-CAM-01', x.where, text)
  const bad = steady.filter(({ camera }) => camera.distance < C.walk.distance - C.distanceTolerance || camera.distance > C.fitMax + C.distanceTolerance)
  if (bad.length) out.problem('R6-CAM-01', x.where, `${bad.length} steady frames with distance outside ${C.walk.distance}-${C.fitMax} (first at frame ${bad[0].f}: ${r3(bad[0].camera.distance)})`)
  if (calm.length >= 30 && nominal < C.nominalShare) out.problem('R6-CAM-01', x.where, `only ${r3(100 * nominal)} % of the ${calm.length} steady frames with the pair within ${C.followBound} are at ${C.walk.distance} (median ${r3(median(calm))}); the fit may only raise it when a character would leave the frame`)
}

// ---- R6-CAM-02 dance beat ---------------------------------------------------------------------------------------

function analyzeDanceBeat(x, out, pool) {
  const starts = x.ofType('duo-dance-start')
  const ends = x.ofType('duo-dance-end')
  const last = x.first + x.trace.length - 1
  const summary = []
  for (const start of starts) {
    const over = ends.find((candidate) => candidate.f >= start.f)
    if (!over || over.f >= last - 1) continue
    // A swap or a hop inside the dance cancels the beat before the dance's own end event.
    const cut = x.events.find((event) => (event.type === 'swap' || event.type === 'hop') && event.f > start.f && event.f <= over.f)
    const end = cut ?? over
    const where = `${x.where}: dance at frame ${start.f}`
    const slack = C.slack
    const held = x.trace.filter(({ f }) => f >= start.f + slack && f <= end.f - slack)
    const notDance = held.filter(({ camera }) => camera?.beat !== 'dance')
    if (notDance.length) out.problem('R6-CAM-02', '', `${where}: ${notDance.length} of ${held.length} frames between duo-dance-start and duo-dance-end without the dance beat (first at frame ${notDance[0].f}: ${notDance[0].camera?.beat})`)
    const steady = x.trace.filter(({ f }) => f >= start.f + Math.round(C.dance.easeInSeconds * fps) + slack && f <= end.f - 1)
    if (steady.length >= 10) {
      pool.danceBeats += 1
      for (const text of pitchProblems('dance beat', steady, C.dance.pitch, C.pitchTolerance)) out.problem('R6-CAM-02', where, text)
      const distances = steady.map(({ camera }) => camera.distance)
      const low = steady.filter(({ camera }) => camera.distance < C.dance.distance - C.distanceTolerance || camera.distance > C.fitMax + C.distanceTolerance)
      if (low.length) out.problem('R6-CAM-02', where, `${low.length} frames with distance outside ${C.dance.distance}-${C.fitMax} (first at frame ${low[0].f}: ${r3(low[0].camera.distance)})`)
      const calm = steady.filter(close).map(({ camera }) => camera.distance)
      const nominal = share(calm, (d) => near(d, C.dance.distance, C.distanceTolerance))
      if (calm.length >= 10 && nominal < C.nominalShare) out.problem('R6-CAM-02', where, `only ${r3(100 * nominal)} % of the ${calm.length} dance frames with the pair within ${C.followBound} are at ${C.dance.distance} (median ${r3(median(calm))})`)
      const aim = steady.filter(({ camera }) => !near(camera.target.y, C.dance.aimY, 0.02))
      if (aim.length) out.problem('R6-CAM-02', where, `${aim.length} frames with the aim point off ${C.dance.aimY} (first at frame ${aim[0].f}: ${r3(aim[0].camera.target.y)})`)
      summary.push({ frame: start.f, frames: steady.length, medianDistance: r3(median(distances)), nominalShare: r3(nominal) })
    }
    // Eases: strictly between the two poses half way through each ease, and settled after it (unless another beat takes over).
    const between = (f) => {
      const pitch = x.at(f)?.camera?.pitch
      return pitch > C.dance.pitch + 0.3 && pitch < C.walk.pitch - 0.3
    }
    // A hero fold-up as the dance props come back (the usual rules apply from duo-dance-end) starts a hero beat straight away.
    const heroFold = (from, to) => (x.result.foldLog ?? []).some((fold) => fold.dir === 'up' && !fold.cause && C.hero.ids.includes(fold.id)
      && fold.t * fps >= from - 1 && fold.t * fps <= to)
    const quiet = (from, to) => !heroFold(from, to) && !x.events.some((event) => ['swap', 'hop', 'duo-dance-start', 'duo-dance-end'].includes(event.type) && event.f > from && event.f <= to && event !== start && event !== end)
    const priorBeat = x.at(start.f - 2)?.camera?.beat
    if (!priorBeat && x.at(start.f - 2) && quiet(start.f, start.f + 18) && !between(start.f + 18)) {
      out.problem('R6-CAM-02', where, `no ease in: pitch ${r3(x.at(start.f + 18)?.camera?.pitch)}° 0.3 s after duo-dance-start`)
    }
    if (!cut && end.f + 0.9 * fps + slack < last && quiet(end.f, end.f + Math.round(0.9 * fps) + slack)) {
      if (x.at(end.f + slack)?.camera?.beat === 'dance') out.problem('R6-CAM-02', where, `the dance beat was still active ${slack} frames after duo-dance-end`)
      if (!between(end.f + 24)) out.problem('R6-CAM-02', where, `no ease out: pitch ${r3(x.at(end.f + 24)?.camera?.pitch)}° 0.4 s after duo-dance-end`)
      const settled = x.at(end.f + Math.round((C.dance.easeOutSeconds + 0.15) * fps))
      if (!near(settled.camera.pitch, C.walk.pitch, C.pitchTolerance)) out.problem('R6-CAM-02', where, `pitch ${r3(settled.camera.pitch)}° 0.95 s after duo-dance-end, expected ${C.walk.pitch}°`)
    }
  }
  out.measure('R6-CAM-02', x.where, { dances: summary })
}

// ---- R6-CAM-03 / 04 hero beat ----------------------------------------------------------------------------------

// Walks the logged events in frame order and decides, for every hero fold-up, whether the contract starts a beat. The camera's own
// state before the event stands in for "a beat is active"; the 8 s gap runs from the previous beat that was observed to start.
function analyzeHero(x, out, pool) {
  const H = C.hero
  const items = []
  for (const fold of x.result.foldLog ?? []) {
    if (fold.dir === 'up' && !fold.cause && H.ids.includes(fold.id) && fold.t > 0) items.push({ f: Math.round(fold.t * fps), kind: 'fold', fold })
  }
  for (const event of x.events) {
    if (event.type === 'swap') items.push({ f: event.f, kind: 'swap' })
    else if (event.type === 'hop') items.push({ f: event.f, kind: event.detail.phase === 'land' ? 'land' : 'takeoff' })
    else if (event.type === 'duo-dance-start') items.push({ f: event.f, kind: 'dance-start' })
    else if (event.type === 'duo-dance-end') items.push({ f: event.f, kind: 'dance-end' })
  }
  items.sort((a, b) => a.f - b.f)
  const runs = runsOf(x.trace, x.first, (s) => s.camera?.beat === 'hero')
  const last = x.first + x.trace.length - 1
  const tally = { start: 0, 'beat active': 0, 'hop block': 0, gap: 0, 'too far': 0, ambiguous: 0, 'fit skip': 0 }
  const matched = new Set()
  let hopStart = null
  let lastStart = -Infinity
  // The tiles around the spawn point fold up at t = 0 (before the first sample): a hero one within the radius legitimately starts a
  // beat on the first frames. It counts for the 8 s gap and is not judged any further.
  const spawnHero = (x.result.foldLog ?? []).some((fold) => fold.dir === 'up' && !fold.cause && fold.t === 0 && H.ids.includes(fold.id)
    && distance({ x: fold.i * 2, z: fold.j * 2 }, x.trace[0].L) <= H.radius + 0.06)
  const spawnRun = spawnHero ? runs.find((run) => run.startF <= x.first + C.slack + 1) : undefined
  if (spawnRun) {
    matched.add(spawnRun)
    lastStart = spawnRun.startF
  }
  for (const item of items) {
    if (item.kind === 'takeoff') hopStart = item.f
    else if (item.kind === 'land') hopStart = null
    if (item.kind !== 'fold') continue
    const { fold } = item
    const sample = x.at(item.f)
    if (!sample || item.f < x.first + 2 || item.f > last - 4) continue
    const where = `${x.where}: hero fold-up of ${fold.id} ${fold.i},${fold.j} at frame ${item.f}`
    const away = distance({ x: fold.i * 2, z: fold.j * 2 }, sample.L)
    const crowded = items.some((other) => other !== item && other.kind !== 'fold' && Math.abs(other.f - item.f) <= 1)
    const sinceStart = item.f - lastStart
    const started = runs.find((run) => run.startF >= item.f - 1 && run.startF <= item.f + C.slack)
    let verdict
    if (Math.abs(away - H.radius) < 0.06 || crowded || Math.abs(sinceStart - H.gapSeconds * fps) <= 2) verdict = 'ambiguous'
    else if (away > H.radius) verdict = 'too far'
    else if (x.at(item.f - 1)?.camera?.beat) verdict = 'beat active'
    else if (hopStart !== null && item.f - hopStart < 3 * fps) verdict = 'hop block'
    else if (sinceStart < H.gapSeconds * fps) verdict = 'gap'
    else verdict = 'start'
    if (verdict === 'start' && !started) {
      verdict = distance(sample.L, sample.F) <= C.closePair ? 'missing' : 'fit skip'
    }
    if (verdict === 'missing') out.problem('R6-CAM-03', '', `${where}: ${r3(away)} units from the leader with the pair ${r3(distance(sample.L, sample.F))} apart and no beat active, but no hero beat started`)
    else if (started && verdict !== 'start' && verdict !== 'ambiguous') {
      out.problem(verdict === 'gap' ? 'R6-CAM-04' : 'R6-CAM-03', '', `${where}: a hero beat started although the contract blocks it (${verdict}; ${r3(away)} from the leader, ${r3(sinceStart / fps)} s since the last beat)`)
    }
    if (started) {
      matched.add(started)
      if (verdict === 'start' || verdict === 'ambiguous') lastStart = started.startF
    }
    if (verdict in tally) tally[verdict] += 1
    else tally[verdict] = 1
  }
  pool.gapBlocked += tally.gap
  pool.hopBlocked += tally['hop block']
  // Every observed beat needs a fold-up.
  for (const run of runs) {
    if (!matched.has(run)) {
      const crowded = items.some((item) => item.kind === 'fold' && Math.abs(item.f - run.startF) <= C.slack + 1)
      if (!crowded) out.problem('R6-CAM-03', '', `${x.where}: a hero beat started at frame ${run.startF} with no hero fold-up within ${H.radius} units`)
    }
  }
  // Each beat: 1.5 s long unless something cancelled it, and at the hero pose before it ends.
  const starts = []
  for (const run of runs) {
    starts.push(run.startF)
    pool.heroBeats += 1
    const where = `${x.where}: hero beat at frame ${run.startF}`
    const cancelled = items.some((item) => item.kind !== 'fold' && item.f > run.startF && item.f <= run.endF + C.slack)
    if (!cancelled && run.endF < last - 2 && !near(run.frames, H.seconds * fps, 2)) {
      out.problem('R6-CAM-03', where, `lasted ${run.frames} frames (${r3(run.frames / fps)} s), expected ${H.seconds} s`)
    }
    const steady = x.trace.filter(({ f }) => f >= run.startF + Math.round(H.steadyAfterSeconds * fps) && f <= run.endF)
    if (!cancelled && steady.length >= 5) {
      pool.heroSteady.push(...steady.filter(close))
      for (const text of pitchProblems('hero beat', steady, H.pitch, C.pitchTolerance)) out.problem('R6-CAM-03', where, text)
      const low = steady.filter(({ camera }) => camera.distance < H.distance - C.distanceTolerance || camera.distance > C.fitMax + C.distanceTolerance)
      if (low.length) out.problem('R6-CAM-03', where, `${low.length} frames with distance outside ${H.distance}-${C.fitMax} (first: ${r3(low[0].camera.distance)})`)
    }
  }
  for (const [n, start] of starts.entries()) {
    if (n && start - starts[n - 1] < H.gapSeconds * fps - 2) {
      out.problem('R6-CAM-04', x.where, `hero beats at frames ${starts[n - 1]} and ${start} are ${r3((start - starts[n - 1]) / fps)} s apart, at most one per ${H.gapSeconds} s`)
    }
  }
  out.measure('R6-CAM-03', x.where, { beats: runs.length, folds: tally })
  out.measure('R6-CAM-04', x.where, { starts, blockedByGap: tally.gap, blockedByHop: tally['hop block'] })
}

// ---- R6-CAM-05 cancels --------------------------------------------------------------------------------------------

function analyzeCancels(x, out, pool) {
  const events = x.events.filter(({ type, detail }) => type === 'swap' || (type === 'hop' && detail.phase === 'takeoff'))
  const last = x.first + x.trace.length - 1
  const cancels = { swap: 0, hop: 0 }
  for (const event of events) {
    const before = x.at(event.f - 1)
    if (!before?.camera?.beat || event.f + C.slack + 1 > last) continue
    const where = `${x.where}: ${event.type} at frame ${event.f} during the ${before.camera.beat} beat`
    const others = x.events.filter((other) => other !== event && other.f >= event.f - 1 && other.f <= event.f + Math.round(0.9 * fps) + C.slack
      && ['swap', 'duo-dance-start', 'duo-dance-end'].includes(other.type))
    const hop = event.type === 'hop'
    cancels[hop ? 'hop' : 'swap'] += 1
    const after = x.at(event.f + C.slack)
    if (after.camera.beat && !x.events.some((other) => other.type === 'duo-dance-start' && other.f >= event.f && other.f <= event.f + C.slack)) {
      out.problem('R6-CAM-05', where, `the ${after.camera.beat} beat was still active ${C.slack} frames later`)
    }
    const jump = Math.abs(after.camera.pitch - before.camera.pitch)
    if (jump > 2.5) out.problem('R6-CAM-05', where, `pitch jumped ${r3(jump)}° within ${C.slack + 1} frames; a cancelled beat eases out over ${C.dance.easeOutSeconds} s`)
    const settledAt = event.f + Math.round((C.dance.easeOutSeconds + 0.2) * fps)
    if (!others.length && settledAt <= last && !x.events.some((other) => other.type === 'hop' && other.f > event.f && other.f <= settledAt)) {
      const settled = x.at(settledAt)
      if (settled.camera.beat || !near(settled.camera.pitch, C.walk.pitch, C.pitchTolerance)) {
        out.problem('R6-CAM-05', where, `pitch ${r3(settled.camera.pitch)}° (beat ${settled.camera.beat}) ${r3((settledAt - event.f) / fps)} s later, expected ${C.walk.pitch}° with no beat`)
      }
    }
  }
  pool.swapCancels += cancels.swap
  pool.hopCancels += cancels.hop
  out.measure('R6-CAM-05', x.where, cancels)
}

// ---- R6-CAM-06 fixed camera ----------------------------------------------------------------------------------------

function analyzeFixed(x, out) {
  const bad = x.trace.filter(({ camera }) => !camera || camera.beat !== null || !near(camera.distance, C.fixed.distance, 1e-3)
    || !near(camera.pitch, C.fixed.pitch, 1e-3))
  const heroFolds = (x.result.foldLog ?? []).filter((fold) => fold.dir === 'up' && !fold.cause && C.hero.ids.includes(fold.id)
    && x.at(Math.round(fold.t * fps)) && distance({ x: fold.i * 2, z: fold.j * 2 }, x.at(Math.round(fold.t * fps)).L) <= C.hero.radius)
  const witness = { frames: x.trace.length, heroFoldUps: heroFolds.length, swaps: x.ofType('swap').length, dances: x.ofType('duo-dance-start').length }
  out.measure('R6-CAM-06', x.where, witness)
  if (bad.length) {
    const s = bad[0]
    out.problem('R6-CAM-06', x.where, `${bad.length} frames off the fixed camera ${C.fixed.distance} / ${C.fixed.pitch}° or with a beat (first at frame ${s.f}: ${JSON.stringify(s.camera)})`)
  }
  for (const [name, count] of [['hero fold-up within 2.5', witness.heroFoldUps], ['swap', witness.swaps], ['duo dance', witness.dances]]) {
    if (!count) out.problem('R6-CAM-06', x.where, `the route had no ${name}, so no beat was ever due`)
  }
}

// ---- R6-CAM-07 yaw -----------------------------------------------------------------------------------------------

function analyzeYaw(x, out) {
  const bad = x.trace.filter(({ right }) => !right || !near(right.x, 1, 1e-3) || !near(right.z, 0, 1e-3))
  out.measure('R6-CAM-07', x.where, { frames: x.trace.length, offAxis: bad.length })
  if (bad.length) out.problem('R6-CAM-07', x.where, `${bad.length} frames where the camera right vector is not (1, 0) (first at frame ${bad[0].f}: ${JSON.stringify(bad[0].right)})`)
}

// ---- R6-CAM-08 framing under every camera ------------------------------------------------------------------------

function analyzeFraming(group, out) {
  const stretch = Math.round(duoContract.stretchSeconds * fps)
  for (const [viewport, list] of group) {
    // Runs are counted inside one route (framingPerRoute): a run never continues across a route boundary.
    const stats = framingPerRoute(list.map((x) => ({ label: x.where, trace: x.trace })), duoContract)
    const outsideByCamera = {}
    const framesByCamera = {}
    for (const x of list) {
      const mask = steadyMask(x.trace)
      for (const [k, s] of x.trace.entries()) {
        const category = s.camera?.beat ?? (mask[k] ? 'walk' : 'blend')
        framesByCamera[category] = (framesByCamera[category] ?? 0) + 1
        if (!insideFrame(s.a.rect, s.view) || !insideFrame(s.b.rect, s.view)) outsideByCamera[category] = (outsideByCamera[category] ?? 0) + 1
      }
    }
    out.measure('R6-CAM-08', viewport, {
      frames: stats.frames, framesByCamera, outsideByCamera, longestOverlap: stats.longestOverlap, longestHidden: stats.longestHidden, routes: stats.routes,
    })
    if (stats.outsideFrames) out.problem('R6-CAM-08', viewport, `${stats.outsideFrames} frames with a character outside the frame (${JSON.stringify(outsideByCamera)}; first ${JSON.stringify(stats.firstOutside[0])})`)
    if (stats.longestOverlap.frames > stretch) out.problem('R6-CAM-08', viewport, `follower overlapped the leader by > 50 % for ${stats.longestOverlap.frames} frames (${runText(stats.longestOverlap)})`)
    for (const label of ['a', 'b']) {
      const hidden = stats.longestHidden[label]
      if (hidden.frames > stretch) out.problem('R6-CAM-08', viewport, `troll ${label} hidden behind tiles for ${hidden.frames} frames (${runText(hidden)})`)
    }
    for (const [camera, least] of [['walk', 300], ['dance', 60], ['hero', 30]]) {
      if ((framesByCamera[camera] ?? 0) < least) out.problem('R6-CAM-08', viewport, `only ${framesByCamera[camera] ?? 0} frames under the ${camera} camera (need ${least}): the routes did not show it`)
    }
  }
}

// ---- entry points ------------------------------------------------------------------------------------------------

export const newCameraPool = () => ({ steady: 0, danceBeats: 0, heroBeats: 0, heroSteady: [], gapBlocked: 0, hopBlocked: 0, swapCancels: 0, hopCancels: 0, byViewport: new Map() })

export function analyzeCamera(x, out, pool) {
  if (!x.trace.every((s) => s.camera)) {
    for (const id of ids) out.problem(id, x.where, 'window.__atlas.camera is missing from the probe sample')
    return
  }
  analyzeYaw(x, out)
  if (x.fixedCamera) {
    analyzeFixed(x, out)
    return
  }
  const step = (fn, list) => {
    try {
      fn(x, out, pool)
    } catch (error) {
      for (const id of list) out.problem(id, x.where, `analysis ${fn.name} failed: ${String(error?.message ?? error).split('\n')[0]}`)
    }
  }
  step(analyzeWalk, ['R6-CAM-01'])
  step(analyzeDanceBeat, ['R6-CAM-02'])
  step(analyzeHero, ['R6-CAM-03', 'R6-CAM-04'])
  step(analyzeCancels, ['R6-CAM-05'])
  const group = pool.byViewport
  const key = viewportOf(x.result)
  group.set(key, [...(group.get(key) ?? []), x])
}

// The checks that need the whole run: each camera and each cancel was actually seen.
export function finishCamera(pool, out, { fixedSeen }) {
  if (pool.steady < 300) out.problem('R6-CAM-01', '', `only ${pool.steady} steady walk-camera frames in all routes (need 300)`)
  if (!pool.danceBeats) out.problem('R6-CAM-02', '', 'no complete duo dance with a dance beat was observed')
  if (!pool.heroBeats) out.problem('R6-CAM-03', '', 'no hero beat was observed')
  const heroDistances = pool.heroSteady.map(({ camera }) => camera.distance)
  if (heroDistances.length && share(heroDistances, (d) => near(d, C.hero.distance, C.distanceTolerance)) < C.nominalShare) {
    out.problem('R6-CAM-03', '', `only ${r3(100 * share(heroDistances, (d) => near(d, C.hero.distance, C.distanceTolerance)))} % of the steady hero-beat frames are at ${C.hero.distance} (median ${r3(median(heroDistances))})`)
  }
  if (!pool.gapBlocked) out.problem('R6-CAM-04', '', 'no hero fold-up was held back by the 8 s gap: the route never offered a second one inside it')
  if (!pool.swapCancels) out.problem('R6-CAM-05', '', 'no swap happened during a beat')
  if (!pool.hopCancels) out.problem('R6-CAM-05', '', 'no recovery hop started during a beat')
  if (!fixedSeen) out.problem('R6-CAM-06', '', 'the fixed-camera route did not run')
  try {
    analyzeFraming(pool.byViewport, out)
  } catch (error) {
    out.problem('R6-CAM-08', '', `analysis analyzeFraming failed: ${String(error?.message ?? error).split('\n')[0]}`)
  }
}
