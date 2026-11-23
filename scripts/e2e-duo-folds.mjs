// Fold checks for round 6 (docs/contracts.md "Round 6" → Folds): R6-FOLD-01..05 and the shared rise/fall helpers that
// scripts/e2e.mjs moved to the new numbers. Pure analysis of what a session recorded (scripts/e2e-duo-recorder.mjs):
// per-tile hinge angle samples, the fold log, the leader's and follower's per-frame positions and the dance events.
//
// The expected behaviour is written down here from the contract, not read from the game: a small model of the two
// thresholds (stage 2: up within 2, down beyond 3; stage 1: lift within 4.5, drop beyond 5.5; dance stage within 1.8)
// predicts every transition of every tile from the leader's positions, and the recorded hinges and events have to agree.
import { layoutFor } from './e2e-duo-plan.mjs'

export const foldNumbers = {
  fps: 60,
  up: 2,
  down: 3,
  lift: 4.5,
  drop: 5.5,
  stageDeg: -63,
  flatDeg: -90,
  dipDeg: 4,
  dipToleranceDeg: 1,
  dipSeconds: 0.08,
  holdWithinDeg: 1,
  crossingSeconds: 0.4,
  crossingToleranceSeconds: 0.05,
  overshootShare: [0.12, 0.2],
  settleSeconds: 1.4,
  settleDeg: 2,
  danceRadius: 1.8,
  danceTiles: ['flower', 'mushroom_house', 'cupcake_tree'],
  // Frames either side in which an event may sit relative to the model's frame (the game reads the leader before or after its move).
  slackFrames: 2,
}
const N = foldNumbers
const radiansToDegrees = (radians) => radians * 180 / Math.PI
const cellAt = (position) => Math.floor(position / 2 + 0.5)
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// ---- series ---------------------------------------------------------------------------------------------------

// `samples` are [t, radians] pairs, ascending. Rest is stored as its edge samples only, so the angle at `t` is the
// last sample at or before it (flat before the first sample: a tile starts at -90°).
export function makeSeries(samples) {
  const times = samples.map(([t]) => t)
  const degrees = samples.map(([, angle]) => radiansToDegrees(angle))
  const eps = 1e-7
  const indexAt = (t) => {
    let low = 0
    let high = times.length - 1
    let found = -1
    while (low <= high) {
      const middle = (low + high) >> 1
      if (times[middle] <= t + eps) {
        found = middle
        low = middle + 1
      } else high = middle - 1
    }
    return found
  }
  return {
    times, degrees,
    first: times[0], last: times.at(-1),
    at: (t) => { const k = indexAt(t); return k < 0 ? N.flatDeg : degrees[k] },
    // Samples with t0 < t <= t1.
    between(t0, t1) {
      const out = []
      for (let k = Math.max(0, indexAt(t0) + 1); k < times.length && times[k] <= t1 + eps; k++) out.push({ t: times[k], deg: degrees[k] })
      return out
    },
  }
}

// ---- rise (shared with scripts/e2e.mjs) ----------------------------------------------------------------------

// Measures one stage-2 fold-up: the dip, the release (the dip's end, event + 80 ms), the upright crossing, the
// overshoot as a share of the release travel and the settle time, the last three from the release.
// `series` as from makeSeries (or any object with `at` and `between`), `up` is the fold event ({t}). The rise is judged over 3 s
// from the release, or until `until` (the time of the tile's next fold, which ends it).
export function measureRise(series, up, { until = Infinity } = {}) {
  const t0 = up.t
  const frame = 1 / N.fps
  const release = t0 + N.dipSeconds
  const start = series.at(t0)
  const dipWindow = [{ t: t0, deg: start }, ...series.between(t0, release + 2 * frame)]
  const trough = Math.min(...dipWindow.map(({ deg }) => deg))
  const travel = -trough
  const after = series.between(release, Math.min(release + 3, until))
  let crossing = null
  let previous = { t: release, deg: series.at(release) }
  for (const sample of after) {
    if (crossing === null && sample.deg >= 0) {
      crossing = previous.t + (sample.t - previous.t) * (0 - previous.deg) / (sample.deg - previous.deg) - release
    }
    previous = sample
  }
  const peak = Math.max(0, ...after.map(({ deg }) => deg))
  const loud = after.filter(({ deg }) => Math.abs(deg) > N.settleDeg)
  const covered = series.last ?? 0
  const settleAt = loud.length ? loud.at(-1).t : release
  // Estimate the last tolerance crossing between the bracketing samples, as scripts/e2e.mjs always did.
  let settle = settleAt - release
  if (loud.length) {
    const next = after.find(({ t }) => t > settleAt)
    if (next) {
      const from = Math.abs(loud.at(-1).deg)
      const to = Math.abs(next.deg)
      if (from > to) settle += frame * (from - N.settleDeg) / (from - to)
    }
  }
  const dipSamples = series.between(t0, t0 + 2 * frame)
  return {
    startDeg: start, troughDeg: trough, dipDeg: start - trough, travelDeg: travel, release, crossingSeconds: crossing,
    peakDeg: peak, overshootShare: travel > 0 ? peak / travel : NaN, settleSeconds: settle,
    // The frame after the event is the first that moves a dipping hinge; the event frame itself still shows the start.
    movedAfterEvent: dipSamples.some(({ deg }) => Math.abs(deg - start) > 0.01),
    coveredSeconds: covered - release, loudAtEnd: loud.length > 0 && loud.at(-1).t >= covered - 1e-7,
  }
}

// Problems (strings) in a rise measured by measureRise. The start must be at rest at -63° (stage 1) or flat (-90°) unless
// `anyStart`; the dip is 4 ± 1° (clamped at the page, no dip within 1° of flat), the upright crossing 0.40 ± 0.05 s from the
// release, the overshoot 12-20 % of the release travel and the settle (±2°) under 1.4 s from the release.
export function riseProblems(rise, { anyStart = true } = {}) {
  const problems = []
  const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance
  if (!anyStart && !near(rise.startDeg, N.stageDeg, N.settleDeg) && !near(rise.startDeg, N.flatDeg, N.settleDeg)) {
    problems.push(`rise started at ${rise.startDeg.toFixed(1)}°, not at -63° or flat`)
  }
  const flat = rise.startDeg <= N.flatDeg + N.holdWithinDeg
  const expectedDip = flat ? 0 : Math.min(N.dipDeg, rise.startDeg - N.flatDeg)
  const tolerance = flat ? 0.2 : N.dipToleranceDeg
  if (!near(rise.dipDeg, expectedDip, tolerance)) {
    problems.push(`dip ${rise.dipDeg.toFixed(2)}° from ${rise.startDeg.toFixed(1)}°, expected ${expectedDip.toFixed(1)} ± ${tolerance}°`)
  }
  if (!flat && !rise.movedAfterEvent) problems.push('the hinge had not started to dip in the frame after the fold event')
  if (!(rise.crossingSeconds >= N.crossingSeconds - N.crossingToleranceSeconds && rise.crossingSeconds <= N.crossingSeconds + N.crossingToleranceSeconds)) {
    problems.push(`upright crossing ${rise.crossingSeconds === null ? 'never' : `${rise.crossingSeconds.toFixed(3)} s`} after the release, expected ${N.crossingSeconds} ± ${N.crossingToleranceSeconds} s`)
  }
  const [low, high] = N.overshootShare
  if (!(rise.overshootShare >= low && rise.overshootShare <= high)) {
    problems.push(`overshoot ${(100 * rise.overshootShare).toFixed(1)} % of the ${rise.travelDeg.toFixed(1)}° release travel (${rise.peakDeg.toFixed(1)}°), expected ${100 * low}-${100 * high} %`)
  }
  if (!(rise.settleSeconds < N.settleSeconds) || rise.loudAtEnd) {
    problems.push(`did not stay within ±${N.settleDeg}° before ${N.settleSeconds} s from the release (settled after ${rise.settleSeconds.toFixed(2)} s)`)
  }
  return problems
}

// The return to rest after a stage-2 fold-down: the angle `after` seconds after the event and the lowest angle before it.
export function measureFall(series, down, after = 1) {
  const samples = series.between(down.t, down.t + after)
  return {
    startDeg: series.at(down.t), endDeg: series.at(down.t + after),
    lowestDeg: Math.min(series.at(down.t), ...samples.map(({ deg }) => deg)),
    covered: (series.last ?? 0) >= down.t + after - 1e-7,
  }
}

// ---- model ------------------------------------------------------------------------------------------------------

// Predicted transitions of the cell (i, j) from the leader's per-frame positions (`start` is the leader's position before
// the first traced frame, so cells already within a threshold at the start are in the right state). `windows` are the
// dance-stage windows ({ startK, endK, members: Set of cell keys within 1.8 of a character at the start }).
export function simulateCell(i, j, trace, windows, start = trace[0].L) {
  const cx = i * 2
  const cz = j * 2
  const key = `${i},${j}`
  let up = false
  let lifted = false
  let staged = false
  const transitions = []
  const record = (transition) => { if (transition.k >= 0) transitions.push(transition) }
  for (let k = -1; k < trace.length; k++) {
    const { x, z } = k < 0 ? start : trace[k].L
    if (Math.abs(cellAt(x) - i) > 6) {
      // The stream drops cells more than six cells away; a revisit builds them flat again.
      up = false
      lifted = false
      staged = false
      continue
    }
    for (const window of windows) {
      if (k === window.endK) staged = false
      if (k === window.startK && window.members.has(key)) {
        staged = true
        if (up) {
          up = false
          lifted = false
          record({ k, kind: 'stage-down', target: N.flatDeg })
        } else if (lifted) {
          lifted = false
          record({ k, kind: 'stage-drop', target: N.flatDeg })
        }
      }
    }
    if (staged) continue
    const d2 = (cx - x) ** 2 + (cz - z) ** 2
    const nowUp = up ? d2 <= N.down ** 2 : d2 <= N.up ** 2
    const nowLifted = lifted ? d2 <= N.drop ** 2 : d2 <= N.lift ** 2
    if (nowUp !== up) {
      record({ k, kind: nowUp ? 'up' : 'down', target: nowUp ? 0 : nowLifted ? N.stageDeg : N.flatDeg, d: Math.sqrt(d2) })
      up = nowUp
      lifted = nowLifted
    } else if (nowLifted !== lifted) {
      lifted = nowLifted
      record({ k, kind: lifted ? 'lift' : 'drop', target: lifted ? N.stageDeg : N.flatDeg, d: Math.sqrt(d2) })
    }
  }
  return transitions
}

// Dance-stage windows from the recorded `duo-dance-start` / `duo-dance-end` events.
export function stageWindows(result, layout) {
  const { trace } = result
  const first = trace[0].f
  const events = result.rec?.events ?? []
  const windows = []
  for (const [n, event] of events.entries()) {
    if (event.type !== 'duo-dance-start') continue
    const startK = event.f - first
    if (startK < 1 || startK >= trace.length) continue
    const end = events.slice(n + 1).find(({ type }) => type === 'duo-dance-end')
    const endK = end ? end.f - first : trace.length + 1
    const members = new Set()
    const ambiguous = new Set()
    const around = [trace[startK - 1], trace[startK]]
    const radius = N.danceRadius
    const lo = Math.min(...around.flatMap((s) => [s.L.x, s.F.x])) - radius
    const hi = Math.max(...around.flatMap((s) => [s.L.x, s.F.x])) + radius
    for (let i = Math.floor(lo / 2) - 1; i <= Math.ceil(hi / 2) + 1; i++) {
      for (let j = -5; j <= 4; j++) {
        if (!N.danceTiles.includes(layout.getCell(i, j).id)) continue
        const centre = { x: i * 2, z: j * 2 }
        const inside = around.map((s) => Math.min(distance(centre, s.L), distance(centre, s.F)) <= radius)
        if (inside.every(Boolean)) members.add(`${i},${j}`)
        else if (inside.some(Boolean)) ambiguous.add(`${i},${j}`)
      }
    }
    windows.push({ startK, endK, startF: event.f, endF: end?.f ?? null, t: event.detail.t, members, ambiguous, interrupted: end?.detail?.interrupted ?? null })
  }
  return windows
}

// ---- session analysis -----------------------------------------------------------------------------------------

const kindOfRise = (deg) => (deg <= N.flatDeg + N.holdWithinDeg ? 'up from flat' : Math.abs(deg - N.stageDeg) <= N.settleDeg ? 'up from -63°' : 'up from another angle')

// Checks one session against the model. `sink` = { problem(id, message), measure(id, value), witness(name) }.
export function analyzeFoldSession(result, sink) {
  const where = result.label
  const { trace, foldLog = [], rec } = result
  if (!rec?.hinges) {
    for (const id of ['R6-FOLD-01', 'R6-FOLD-02', 'R6-FOLD-03', 'R6-FOLD-04', 'R6-FOLD-05']) sink.problem(id, `${where}: the recorder returned no hinge samples`)
    return
  }
  const first = trace[0].f
  const frame = 1 / N.fps
  const layout = layoutFor(result.plan.seed)
  const windows = stageWindows(result, layout)
  const tStart = (k) => (first + k) / N.fps
  const slack = N.slackFrames * frame + 1e-6
  const eventsOf = (key) => foldLog.filter((fold) => `${fold.i},${fold.j}` === key)
  const counts = {}
  const bump = (name) => { counts[name] = (counts[name] ?? 0) + 1 }
  const stageEvents = []

  for (const [key, samples] of Object.entries(rec.hinges)) {
    if (samples.length < 2) continue
    const [i, j] = key.split(',').map(Number)
    // A prop on the edge of a dance window's 1.8-unit reach is not decided by the leader's frame; leave it out.
    if (windows.some((window) => window.ambiguous.has(key))) {
      bump('skipped (on the 1.8 edge of a dance)')
      continue
    }
    const series = makeSeries(samples)
    const events = eventsOf(key)
    const transitions = simulateCell(i, j, trace, windows, result.initial?.L)
    const used = new Set()
    // The id a transition's problem is filed under.
    const owner = (kind) => ({ up: 'R6-FOLD-02', down: 'R6-FOLD-04', lift: 'R6-FOLD-01', drop: 'R6-FOLD-01' })[kind] ?? 'R6-FOLD-05'

    for (const [n, transition] of transitions.entries()) {
      const t = tStart(transition.k)
      const next = transitions[n + 1]
      const label = `${where}: tile ${key} ${transition.kind} at ${t.toFixed(3)} s`
      const loud = transition.kind === 'up' || transition.kind === 'down' || transition.kind === 'stage-down'
      const matching = events.filter((event) => Math.abs(event.t - t) <= slack
        && event.dir === (transition.kind === 'up' ? 'up' : 'down') && (transition.kind === 'stage-down') === (event.cause === 'stage'))
      const anyEvent = events.some((event) => Math.abs(event.t - t) <= slack)
      if (loud) {
        if (matching.length !== 1) sink.problem(owner(transition.kind), `${label}: ${matching.length} matching fold events (${anyEvent ? 'a different one at the time' : 'none'})`)
        for (const event of matching) used.add(event)
      } else if (anyEvent) {
        sink.problem(transition.kind === 'stage-drop' ? 'R6-FOLD-05' : 'R6-FOLD-01', `${label}: a fold event fired for a silent transition (${JSON.stringify(events.find((event) => Math.abs(event.t - t) <= slack))})`)
        for (const event of events) if (Math.abs(event.t - t) <= slack) used.add(event)
      }
      bump(transition.kind)

      // The hinge: moves toward the target from rest (a loud rise dips first), and settles there.
      const before = series.at(t)
      const wasAtRest = series.between(t - 4 * frame, t).every(({ deg }) => Math.abs(deg - before) < 0.01)
      if (transition.kind !== 'up' && wasAtRest && Math.abs(before - transition.target) > 0.5 && t + 3 * frame <= series.last) {
        const moved = series.between(t, t + slack + frame).find(({ deg }) => Math.abs(deg - before) > 0.02)
        const expectedSign = Math.sign(transition.target - before)
        if (!moved || Math.sign(moved.deg - before) !== expectedSign) {
          sink.problem(owner(transition.kind), `${label}: the hinge did not start toward ${transition.target}° within ${N.slackFrames} frames (was ${before.toFixed(1)}°)`)
        }
      }
      // A rise has its own settle check (R6-FOLD-03); a fall or a stage-1 move is at rest well inside 1.4 s (ω 5-7, ζ 0.8-0.85 over at
      // most 90°), so a leader that walks on to the next threshold does not hide it.
      const settleAt = t + (transition.kind === 'up' ? 3 : N.settleSeconds)
      if (settleAt <= series.last && (!next || tStart(next.k) > settleAt + slack)) {
        const settled = series.at(settleAt)
        if (Math.abs(settled - transition.target) > N.settleDeg + 0.5) {
          sink.problem(transition.kind === 'up' ? 'R6-FOLD-03' : owner(transition.kind),
            `${label}: the hinge is at ${settled.toFixed(1)}° ${settleAt - t} s later, expected ${transition.target}° (${transition.kind === 'down' && transition.target === N.stageDeg ? 'the leader is within 5.5' : transition.kind === 'down' ? 'the leader is beyond 5.5' : ''})`)
        } else if (transition.kind === 'down') bump(transition.target === N.stageDeg ? 'down settled at -63°' : 'down settled at -90°')
        else if (transition.kind === 'lift') bump('lift settled at -63°')
        else if (transition.kind === 'drop') bump('drop settled at -90°')
        else if (transition.kind === 'stage-down' || transition.kind === 'stage-drop') bump('stage settled flat')
      }
    }

    // Fold events with no matching transition: a fold fired where the contract has none (a stage-1 crossing, say).
    for (const event of events) {
      if (event.cause === 'stage') stageEvents.push(event)
      if (used.has(event) || !(event.t > 0)) continue
      const k = Math.round(event.t * N.fps) - first
      if (k < 1 || k >= trace.length) continue
      sink.problem(event.cause === 'stage' ? 'R6-FOLD-05' : 'R6-FOLD-01',
        `${where}: fold event ${JSON.stringify(event)} has no matching ${event.cause === 'stage' ? 'dance-stage window with the tile upright within 1.8' : 'stage-2 threshold crossing'} (leader ${distance({ x: i * 2, z: j * 2 }, trace[k].L).toFixed(2)} away)`)
    }

    // R6-FOLD-02 / 03: every undisturbed stage-2 rise.
    for (const up of events.filter((event) => event.dir === 'up' && !event.cause && event.t > 0)) {
      const next = events.find((event) => event.t > up.t + 1e-6)
      const nextTransition = transitions.find((transition) => tStart(transition.k) > up.t + slack)
      const horizon = up.t + N.dipSeconds + 1.6
      if (horizon > series.last + 1e-7 || (next && next.t < horizon) || (nextTransition && tStart(nextTransition.k) < horizon)) continue
      // The tile's next fold (event or silent stage-1 move) ends this rise; it is at least 1.6 s away here.
      const rise = measureRise(series, up, { until: Math.min(next?.t ?? Infinity, nextTransition ? tStart(nextTransition.k) : Infinity) - 1e-6 })
      const kind = kindOfRise(rise.startDeg)
      bump(kind)
      const dipProblems = []
      const curveProblems = []
      for (const problem of riseProblems(rise)) (/dip|started to dip/.test(problem) ? dipProblems : curveProblems).push(problem)
      for (const problem of dipProblems) sink.problem('R6-FOLD-02', `${where}: tile ${key} up at ${up.t.toFixed(3)} s: ${problem}`)
      for (const problem of curveProblems) sink.problem('R6-FOLD-03', `${where}: tile ${key} up at ${up.t.toFixed(3)} s: ${problem}`)
      // Two examples per kind of start go into the report; the counts say how many were checked.
      if (counts[kind] <= 2) {
        sink.measure('R6-FOLD-03', { [`${where} ${key} @${up.t.toFixed(2)}`]: {
          kind, startDeg: +rise.startDeg.toFixed(2), dipDeg: +rise.dipDeg.toFixed(2), crossing: +rise.crossingSeconds?.toFixed(3),
          overshootPct: +(100 * rise.overshootShare).toFixed(1), settle: +rise.settleSeconds.toFixed(2),
        } })
      }
    }
  }

  // R6-FOLD-05: windows. Members go flat and stay flat until the dance ends; non-members are left to the model above.
  for (const window of windows) {
    for (const key of window.members) {
      const samples = rec.hinges[key]
      if (!samples) continue
      const series = makeSeries(samples)
      const from = tStart(window.startK) + 1.7
      const to = Math.min(tStart(Math.min(window.endK, trace.length - 1)), series.last)
      const label = `${where}: tile ${key} in the dance stage from ${tStart(window.startK).toFixed(3)} s`
      if (to > from) {
        const highest = Math.max(...series.between(from, to).map(({ deg }) => deg), series.at(from))
        if (highest > N.flatDeg + N.settleDeg) sink.problem('R6-FOLD-05', `${label}: rose to ${highest.toFixed(1)}° before the dance ended`)
        else bump('stage held flat')
      }
      const rises = (foldLog).filter((event) => event.i === Number(key.split(',')[0]) && event.j === Number(key.split(',')[1])
        && event.dir === 'up' && event.t > tStart(window.startK) + slack && event.t < tStart(Math.min(window.endK, trace.length - 1)) - slack)
      if (rises.length) sink.problem('R6-FOLD-05', `${label}: folded up again during the dance (${JSON.stringify(rises[0])})`)
    }
  }
  sink.measure('R6-FOLD-01', { [where]: counts })
  sink.measure('R6-FOLD-05', { [where]: { windows: windows.map(({ t, members, ambiguous, interrupted }) => ({ t, members: [...members], ambiguous: [...ambiguous], interrupted })), stageEvents: stageEvents.length } })
  sink.counts(where, counts)
}
