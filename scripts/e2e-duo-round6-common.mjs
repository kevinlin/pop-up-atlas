// Shared pieces of the round-6 analyses (R6-*): the scenario list, the result collector and a session wrapper.
// Every analysis is a pure function of what a session recorded (scripts/e2e-duo-sessions.mjs result objects).
import { framingStats } from './e2e-duo-probe.mjs'

export const fps = 60
export const frame = 1 / fps

export const round6Scenarios = [
  ['R6-CAM-01', 'walk camera 7.5 at 35°'],
  ['R6-CAM-02', 'dance beat 4.5 at 22° from duo-dance-start to duo-dance-end'],
  ['R6-CAM-03', 'hero beat on a hero fold-up within 2.5 units'],
  ['R6-CAM-04', 'at most one hero beat per 8 s'],
  ['R6-CAM-05', 'a swap or a recovery hop cancels a beat'],
  ['R6-CAM-06', 'a fixed camera turns beats off'],
  ['R6-CAM-07', 'yaw never changes'],
  ['R6-CAM-08', 'both characters on screen under every shipped camera'],
  ['R6-FOLD-01', 'stage 1 lifts and drops silently'],
  ['R6-FOLD-02', 'stage-2 fold-up starts with the anticipation dip'],
  ['R6-FOLD-03', 'upright crossing, overshoot and settle from the release'],
  ['R6-FOLD-04', 'fold-down returns to -63° within 5.5 units and to -90° beyond'],
  ['R6-FOLD-05', 'dance stage holds props flat'],
  ['R6-CHR-01', 'mouth cell per cue, voice bank A'],
  ['R6-CHR-02', 'mouth cell per cue, voice bank B'],
  ['R6-CHR-03', 'blink interval and rest closure'],
  ['R6-CHR-04', 'squash on contacts, dance landing and hop'],
  ['R6-CHR-05', 'umbrella pops on a river collision and at the bow, closes after 1.2 s'],
  ['R6-CHR-06', 'a skip keeps the state walk'],
  ['R6-CHR-07', 'B look holds the follower and a swap interrupts it'],
  ['R6-AUD-01', 'footsteps at clip time 0 and half the clip, leader only'],
  ['R6-AUD-02', 'hum sings melody notes above MIDI 78 an octave down'],
]
export const round6RequiredChecks = round6Scenarios.map(([id, title]) => `${id} ${title}`)
export const round6Titles = new Map(round6Scenarios.map(([id, title]) => [id, `${id} ${title}`]))

export const r3 = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value)
export const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : NaN
}
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
export const firstLine = (error) => String(error?.message ?? error).split('\n')[0]
export const viewportOf = (result) => result.viewport ?? /(\d+x\d+)$/.exec(result.label ?? '')?.[1] ?? 'unknown'

// Collected results: id -> { measured, problems }. A problem line is prefixed with where it was found.
export function createResults() {
  const results = new Map(round6Scenarios.map(([id]) => [id, { measured: {}, problems: [] }]))
  return {
    results,
    problem(id, where, text) { results.get(id).problems.push(where ? `${where}: ${text}` : text) },
    measure(id, where, value) { results.get(id).measured[where] = value },
  }
}

// What every analysis reads about one session result.
export function prepare(result) {
  const { trace } = result
  if (!trace?.length) throw new Error(`${result.label}: the trace is empty`)
  if (!result.rec?.events) throw new Error(`${result.label}: the round-6 recorder returned no data`)
  const first = trace[0].f
  const events = result.rec.events
  return {
    result, trace, first, events, where: result.label,
    at: (f) => trace[f - first],
    ofType: (...types) => events.filter(({ type }) => types.includes(type)),
    fixedCamera: /^fixed-camera/.test(result.label),
    frames: result.rec.frames ?? {},
  }
}

// Framing (DUO-34..36, R6-CAM-08) per route: the overlap and hidden runs are counted inside one route, so a run never
// continues from the last frame of one route into the first frame of the next. Each route is `{ label, trace }`;
// `frames` is the length of a run and `span` its first and last frame; the
// result has the totals, the longest run of each kind with the route, the frames it spans and what stood where.
export function framingPerRoute(routes, contract) {
  const describe = ({ trace }, at, length) => {
    const end = trace.find((s) => s.f === at)
    if (!end) return { span: [at - length + 1, at] }
    return {
      span: [at - length + 1, at],
      leader: { x: r3(end.L.x), z: r3(end.L.z) }, follower: { x: r3(end.F.x), z: r3(end.F.z) }, beat: end.camera?.beat ?? null,
      states: `${end.L.state}/${end.F.state}`,
    }
  }
  const total = { frames: 0, outsideFrames: 0, firstOutside: [], longestOverlap: { frames: 0 }, longestHidden: { a: { frames: 0 }, b: { frames: 0 } }, routes: [] }
  for (const route of routes) {
    const stats = framingStats(route.trace, { fps, contract })
    total.frames += stats.frames
    total.outsideFrames += stats.outsideFrames
    for (const outside of stats.firstOutside) if (total.firstOutside.length < 5) total.firstOutside.push({ route: route.label, ...outside })
    if (stats.longestOverlapFrames > total.longestOverlap.frames) {
      total.longestOverlap = { frames: stats.longestOverlapFrames, route: route.label, ...describe(route, stats.longestOverlapAt, stats.longestOverlapFrames) }
    }
    for (const label of ['a', 'b']) {
      if (stats.longestHiddenFrames[label] > total.longestHidden[label].frames) {
        total.longestHidden[label] = { frames: stats.longestHiddenFrames[label], route: route.label, ...describe(route, stats.longestHiddenAt[label], stats.longestHiddenFrames[label]) }
      }
    }
    total.routes.push({ route: route.label, outsideFrames: stats.outsideFrames, longestOverlapFrames: stats.longestOverlapFrames, longestHiddenFrames: stats.longestHiddenFrames })
  }
  return total
}

// A run as one line for a problem text: where it was and what the camera and the pair were doing.
export const runText = ({ route, span, leader, follower, beat, states }) =>
  `${route}, frames ${span[0]}-${span[1]}${leader ? `, leader (${leader.x}, ${leader.z}) follower (${follower.x}, ${follower.z}), ${states}, camera beat ${beat}` : ''}`
