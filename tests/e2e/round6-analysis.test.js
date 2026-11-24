import { describe, expect, it } from 'vitest'
import { initHinge, startHinge, updateHinge } from '../../src/world/fold.js'
import { FLAT, STAGE_ONE, UPRIGHT } from '../../src/world/spring.js'
import { foldNumbers, makeSeries, measureFall, measureRise, riseProblems, simulateCell } from '../../scripts/e2e-duo-folds.mjs'
import { analyzeCamera, finishCamera, newCameraPool } from '../../scripts/e2e-duo-round6-camera.mjs'
import { followerStart } from '../../scripts/e2e-duo-plan.mjs'
import { analyzeCharacters, newCharacterPool } from '../../scripts/e2e-duo-round6-character.mjs'
import { createResults, prepare } from '../../scripts/e2e-duo-round6-common.mjs'

// The round-6 gate's analysers (scripts/e2e-duo-folds.mjs and friends) judged on the game's own hinge physics, on analytic
// springs with the wrong numbers, and on small hand-made traces. Numbers are the contract's (docs/contracts.md "Round 6").

const FPS = 60
const DEG = Math.PI / 180

// One hinge from `from` toward `target` as the stream would drive it, sampled every frame like __atlas.hingeTrace.
function playHinge({ from, kind, target, seconds = 3.4 }) {
  const hinge = initHinge({})
  hinge.angle = from
  startHinge(hinge, kind, target, 0, 0)
  updateHinge(hinge, 0, 1 / FPS)
  const samples = [[0, hinge.angle]]
  for (let frame = 1; frame <= Math.round(seconds * FPS); frame++) {
    updateHinge(hinge, frame / FPS, 1 / FPS)
    samples.push([frame / FPS, hinge.angle])
  }
  return makeSeries(samples)
}

// A rise whose spring is not the contract's: the 80 ms dip, then an exact underdamped spring from the release angle.
function analyticRise({ from, dipDeg = 4, omega = 6, zeta = 0.5, seconds = 3.4 }) {
  const release = Math.max(from - dipDeg * DEG, FLAT)
  const damped = omega * Math.sqrt(1 - zeta * zeta)
  const samples = []
  for (let frame = 0; frame <= Math.round(seconds * FPS); frame++) {
    const t = frame / FPS
    let angle = from
    if (t > 0 && t < 0.08) {
      const s = t / 0.08
      angle = from + (release - from) * s * s * (3 - 2 * s)
    } else if (t >= 0.08) {
      const u = t - 0.08
      angle = release * Math.exp(-zeta * omega * u) * (Math.cos(damped * u) + (zeta * omega / damped) * Math.sin(damped * u))
    }
    samples.push([t, angle])
  }
  return makeSeries(samples)
}

describe('the rise measured on the game\'s own hinge', () => {
  it('passes from the stage-1 angle: a 4° dip, upright at 0.40 s, 12-20 % overshoot, settled before 1.4 s', () => {
    const series = playHinge({ from: STAGE_ONE, kind: 'up', target: UPRIGHT })
    const rise = measureRise(series, { t: 0 })
    expect(rise.startDeg).toBeCloseTo(-63, 1)
    expect(rise.dipDeg).toBeCloseTo(4, 1)
    expect(rise.crossingSeconds).toBeGreaterThan(0.38)
    expect(rise.crossingSeconds).toBeLessThan(0.42)
    expect(rise.overshootShare).toBeGreaterThan(0.12)
    expect(rise.overshootShare).toBeLessThan(0.2)
    expect(rise.settleSeconds).toBeLessThan(foldNumbers.settleSeconds)
    expect(riseProblems(rise, { anyStart: false })).toEqual([])
  })

  it('passes from flat: no dip, an 80 ms hold, the same crossing and settle from the release', () => {
    const series = playHinge({ from: FLAT, kind: 'up', target: UPRIGHT })
    const rise = measureRise(series, { t: 0 })
    expect(rise.startDeg).toBeCloseTo(-90, 1)
    expect(rise.dipDeg).toBeCloseTo(0, 2)
    expect(series.between(0, 0.07).every(({ deg }) => Math.abs(deg + 90) < 0.01)).toBe(true)
    expect(riseProblems(rise, { anyStart: false })).toEqual([])
  })

  it('judges a rise only up to the tile\'s next fold, so a later fall does not count as a wobble', () => {
    // The tile rises at t = 0 and folds down again at 2.4 s (the leader walked on).
    const rise = playHinge({ from: STAGE_ONE, kind: 'up', target: UPRIGHT, seconds: 2.4 })
    const fall = playHinge({ from: UPRIGHT, kind: 'down', target: STAGE_ONE, seconds: 1 })
    const joined = makeSeries([...rise.times.map((t, k) => [t, rise.degrees[k] * DEG]),
      ...fall.times.slice(1).map((t, k) => [2.4 + t, fall.degrees[k + 1] * DEG])])
    expect(riseProblems(measureRise(joined, { t: 0 }), { anyStart: false }).join('\n')).toMatch(/did not stay within/)
    expect(riseProblems(measureRise(joined, { t: 0 }, { until: 2.4 - 1e-6 }), { anyStart: false })).toEqual([])
  })

  it('names the dip when a rise from -63° has none, and the start when it is neither -63° nor flat', () => {
    const rise = measureRise(analyticRise({ from: STAGE_ONE, dipDeg: 0 }), { t: 0 })
    expect(riseProblems(rise).join('\n')).toMatch(/dip 0\.00°/)
    const mid = measureRise(playHinge({ from: -40 * DEG, kind: 'up', target: UPRIGHT }), { t: 0 })
    expect(riseProblems(mid, { anyStart: false }).join('\n')).toMatch(/not at -63° or flat/)
  })

  it('fails a spring that is too fast, too stiff or too slow', () => {
    const fast = riseProblems(measureRise(analyticRise({ from: STAGE_ONE, omega: 8 }), { t: 0 }))
    expect(fast.join('\n')).toMatch(/upright crossing 0\.30/)
    const stiff = riseProblems(measureRise(analyticRise({ from: STAGE_ONE, zeta: 0.8 }), { t: 0 }))
    expect(stiff.join('\n')).toMatch(/overshoot [0-9.]+ %/)
    const slow = riseProblems(measureRise(analyticRise({ from: STAGE_ONE, omega: 3 }), { t: 0 }))
    expect(slow.join('\n')).toMatch(/upright crossing/)
    expect(slow.join('\n')).toMatch(/did not stay within/)
  })
})

describe('the fall measured on the game\'s own hinge', () => {
  it('returns to -63° without going lower when the leader stays within 5.5 units', () => {
    const series = playHinge({ from: UPRIGHT, kind: 'down', target: STAGE_ONE })
    const fall = measureFall(series, { t: 0 }, foldNumbers.settleSeconds)
    expect(fall.covered).toBe(true)
    expect(fall.startDeg).toBeCloseTo(0, 1)
    expect(Math.abs(fall.endDeg + 63)).toBeLessThanOrEqual(2)
    expect(fall.lowestDeg).toBeGreaterThanOrEqual(-65)
  })

  it('settles at -90° when the leader is beyond 5.5, and that is not -63°', () => {
    const series = playHinge({ from: UPRIGHT, kind: 'down', target: FLAT })
    const fall = measureFall(series, { t: 0 }, foldNumbers.settleSeconds)
    expect(Math.abs(fall.endDeg + 90)).toBeLessThanOrEqual(2)
    expect(Math.abs(fall.endDeg + 63)).toBeGreaterThan(2)
  })

  it('reports a trace that stops before the horizon as not covered', () => {
    const series = playHinge({ from: UPRIGHT, kind: 'down', target: STAGE_ONE, seconds: 0.5 })
    expect(measureFall(series, { t: 0 }, foldNumbers.settleSeconds).covered).toBe(false)
  })
})

describe('the threshold model', () => {
  // The leader walks east along z = 0 at 1.2 units per second from x = -8; the tile is at (4, 0).
  const walk = (frames, speed = 1.2) => Array.from({ length: frames }, (_, k) => ({ L: { x: -8 + speed * k / FPS, z: 0 } }))
  const kinds = (transitions) => transitions.map(({ kind }) => kind)

  it('lifts within 4.5, rises within 2, falls beyond 3 to -63° and drops beyond 5.5 to -90°', () => {
    const transitions = simulateCell(2, 0, walk(1200), [])
    expect(kinds(transitions)).toEqual(['lift', 'up', 'down', 'drop'])
    expect(transitions.map(({ target }) => target)).toEqual([-63, 0, -63, -90])
    const frameOf = (kind) => transitions.find((transition) => transition.kind === kind).k
    expect(Math.abs(frameOf('lift') - 375)).toBeLessThanOrEqual(1)
    expect(Math.abs(frameOf('up') - 500)).toBeLessThanOrEqual(1)
    expect(Math.abs(frameOf('down') - 750)).toBeLessThanOrEqual(1)
    expect(Math.abs(frameOf('drop') - 875)).toBeLessThanOrEqual(1)
  })

  it('has a fold-down beyond 5.5 go straight to -90°', () => {
    // Up at frame 500, then a pose jump 8 units east in one frame (still a loaded tile): beyond both thresholds at once.
    const jump = [...walk(520), ...Array.from({ length: 100 }, () => ({ L: { x: 10, z: 0 } }))]
    const transitions = simulateCell(2, 0, jump, [])
    expect(kinds(transitions)).toEqual(['lift', 'up', 'down'])
    expect(transitions.find(({ kind }) => kind === 'down').target).toBe(-90)
  })

  it('drops a lifted prop silently at duo-dance-start and holds it flat until duo-dance-end', () => {
    // At frame 450 the leader is 3 units away (lifted, not up); the dance lasts until frame 600, where it stands on the tile.
    const transitions = simulateCell(2, 0, walk(900), [{ startK: 450, endK: 600, members: new Set(['2,0']) }])
    expect(kinds(transitions)).toEqual(['lift', 'stage-drop', 'up', 'down', 'drop'])
    expect(transitions.find(({ kind }) => kind === 'stage-drop').k).toBe(450)
    expect(transitions.find(({ kind }) => kind === 'up').k).toBe(600)
  })

  it('folds an upright prop down with a stage event at duo-dance-start', () => {
    const transitions = simulateCell(2, 0, walk(900), [{ startK: 560, endK: 700, members: new Set(['2,0']) }])
    expect(kinds(transitions)).toEqual(['lift', 'up', 'stage-down', 'up', 'down', 'drop'])
    expect(transitions[2]).toMatchObject({ k: 560, target: -90 })
  })
})

describe('the camera analyses', () => {
  const frames = (count, camera, extra = {}) => Array.from({ length: count }, (_, k) => ({
    f: 100 + k, camera, right: { x: 1, z: 0 }, L: { x: 0, z: 0 }, F: { x: 0, z: 1 }, leader: 'a', held: [], ...extra,
  }))
  const fixed = { distance: 9, pitch: 40, beat: null, target: { x: 0, y: 0, z: 0 } }
  const analyse = ({ trace, foldLog = [], events = [], label = 'fixed-camera 1280x720' }) => {
    const out = createResults()
    const x = prepare({ label, trace, foldLog, rec: { events, frames: {} }, marks: [] })
    analyzeCamera(x, out, newCameraPool())
    return out
  }
  const witnesses = {
    foldLog: [{ dir: 'up', id: 'mushroom_house', i: 0, j: 0, t: 2 }],
    events: [{ type: 'swap', f: 150, detail: { leader: 'b', t: 2.5 } }, { type: 'duo-dance-start', f: 160, detail: { t: 2.7 } }],
  }

  it('passes a fixed camera that never moves and saw a hero fold-up, a swap and a dance', () => {
    const out = analyse({ trace: frames(200, fixed), ...witnesses })
    expect(out.results.get('R6-CAM-06').problems).toEqual([])
    expect(out.results.get('R6-CAM-07').problems).toEqual([])
  })

  it('fails a fixed camera that starts a beat, and a route that never offered one', () => {
    const trace = frames(200, fixed).map((s, k) => (k === 120 ? { ...s, camera: { ...fixed, beat: 'hero', distance: 6, pitch: 30 } } : s))
    expect(analyse({ trace, ...witnesses }).results.get('R6-CAM-06').problems.join('\n')).toMatch(/1 frames off the fixed camera/)
    expect(analyse({ trace: frames(200, fixed) }).results.get('R6-CAM-06').problems.join('\n')).toMatch(/no hero fold-up within 2.5/)
  })

  it('counts the hero tile beside the spawn point (folded up at t = 0) as a beat and as the start of the 8 s gap', () => {
    const walk = { distance: 7.5, pitch: 35, beat: null, target: { x: 0, y: 0, z: 0 } }
    const hero = { ...walk, beat: 'hero', distance: 6, pitch: 30 }
    // A beat on frames 1-90, then the walk camera; a second hero fold-up 7.4 s in is held back by the gap.
    const trace = Array.from({ length: 600 }, (_, k) => ({
      f: 1 + k, camera: k < 90 ? hero : walk, right: { x: 1, z: 0 }, L: { x: 0, z: 0 }, F: { x: 0, z: 1 }, leader: 'a', held: [],
    }))
    const foldLog = [{ dir: 'up', id: 'cupcake_tree', i: 1, j: 0, t: 0 }, { dir: 'up', id: 'cupcake_tree', i: 1, j: 0, t: 7.4 }]
    const text = analyse({ trace, foldLog, label: 'river 1280x720' }).results.get('R6-CAM-03').problems.join('\n')
    expect(text).not.toMatch(/no hero fold-up within|no hero beat started|although the contract blocks/)
  })

  it('fails a camera that yaws', () => {
    const trace = frames(50, fixed).map((s, k) => (k > 10 ? { ...s, right: { x: 0.99, z: 0.1 } } : s))
    expect(analyse({ trace, ...witnesses }).results.get('R6-CAM-07').problems.join('\n')).toMatch(/39 frames where the camera right vector is not \(1, 0\)/)
  })

  it('reports a missing camera in the probe sample against every camera scenario', () => {
    const out = analyse({ trace: frames(20, null), ...witnesses })
    for (const id of ['R6-CAM-01', 'R6-CAM-06', 'R6-CAM-08']) expect(out.results.get(id).problems.join('\n')).toMatch(/camera is missing/)
  })
})

describe('framing is judged inside one route', () => {
  const view = [1280, 720]
  const walk = { distance: 7.5, pitch: 35, beat: null, target: { x: 0, y: 0, z: 0 } }
  const rect = (x0) => [x0, 100, x0 + 100, 300]
  const apart = { a: { rect: rect(100), hidden: false }, b: { rect: rect(400), hidden: false } }
  const stacked = { a: { rect: rect(100), hidden: false }, b: { rect: rect(100), hidden: false } }
  const hiddenB = { a: apart.a, b: { rect: rect(400), hidden: true } }
  const route = (label, shapes) => ({
    label, rec: { events: [], frames: {} }, marks: [], foldLog: [],
    trace: shapes.map((shape, k) => ({ f: 1 + k, camera: walk, view, right: { x: 1, z: 0 }, L: { x: 0, z: 0 }, F: { x: 0, z: 1 }, leader: 'a', held: [], ...shape })),
  })
  const framing = (results) => {
    const out = createResults()
    const pool = newCameraPool()
    for (const result of results) analyzeCamera(prepare(result), out, pool)
    finishCamera(pool, out, { fixedSeen: true })
    // The witness minimums (frames under each camera) are not under test here.
    return out.results.get('R6-CAM-08').problems.filter((text) => !/frames under the/.test(text))
  }

  it('does not join an overlap run that ends one route to one that starts the next (20 + 20 frames, limit 30)', () => {
    // 100 frames apart then 20 stacked, then 20 stacked then 100 apart.
    const shapes1 = [...Array(100).fill(apart), ...Array(20).fill(stacked)]
    const shapes2 = [...Array(20).fill(stacked), ...Array(100).fill(apart)]
    expect(framing([route('lane 1280x720', shapes1), route('bridge 1280x720', shapes2)])).toEqual([])
  })

  it('does not join a hidden run across routes either', () => {
    const shapes1 = [...Array(100).fill(apart), ...Array(20).fill(hiddenB)]
    const shapes2 = [...Array(20).fill(hiddenB), ...Array(100).fill(apart)]
    expect(framing([route('lane 1280x720', shapes1), route('bridge 1280x720', shapes2)])).toEqual([])
  })

  it('still fails a run longer than 0.5 s inside one route and names the route, the frames and the camera', () => {
    const problems = framing([route('lane 1280x720', [...Array(50).fill(apart), ...Array(31).fill(stacked), ...Array(50).fill(apart)])])
    expect(problems.join('\n')).toMatch(/overlapped the leader by > 50 % for 31 frames \(lane 1280x720, frames 51-81, leader \(0, 0\) follower \(0, 1\), .*camera beat null\)/)
    const hidden = framing([route('bridge 1280x720', [...Array(50).fill(apart), ...Array(31).fill(hiddenB), ...Array(50).fill(apart)])])
    expect(hidden.join('\n')).toMatch(/troll b hidden behind tiles for 31 frames \(bridge 1280x720, frames 51-81/)
  })
})

describe('the start rule for troll B', () => {
  const right = { x: 1, z: 0 }
  const layoutOf = (blocked) => ({ isBlocked: (x, z) => blocked.some((box) => x >= box[0] && x <= box[1] && z >= box[2] && z <= box[3]) })
  const start = (blocked, heading = 0) => followerStart(layoutOf(blocked), { leader: { x: 0, z: 0 }, heading, right })

  it('takes the left slot, 0.75 to the screen left, when the path is clear', () => {
    expect(start([])).toMatchObject({ rule: 'left slot', point: { x: -0.75, z: 0 }, gap: 0.75 })
  })

  it('takes the right slot when the left path is blocked', () => {
    expect(start([[-0.5, -0.4, -1, 1]])).toMatchObject({ rule: 'right slot', point: { x: 0.75, z: 0 } })
  })

  it('stands 1.1 behind the heading when both slots are blocked and that point is free, else beside', () => {
    const slots = [[-0.8, -0.3, -1, 1], [0.3, 0.8, -1, 1]]
    expect(start(slots, 0)).toMatchObject({ rule: 'behind', gap: 1.1 })
    expect(start(slots, 0).point.z).toBeCloseTo(-1.1)
    expect(start([...slots, [-1, 1, -1.3, -0.9]], 0)).toMatchObject({ rule: 'beside', point: null })
  })
})

// Round 6 C6 (motion critic): the dancing follower mirrors the leader's mouth one canon delay (0.3125 s) later, and the dance
// landing has a 1.04 stretch 0.1 s before it (docs/contracts.md "Round 6" -> Face and secondary motion).
describe('the character analyses after the C6 motion fix', () => {
  const sample = (f, { leader = 'a', followerState = 'idle', cells = { a: 0, b: 3 } } = {}) => ({
    f, leader, held: [], L: { x: 0, z: 0, state: 'idle' }, F: { x: 0.75, z: 0, state: followerState },
    face: { a: { cell: cells.a, lid: 0 }, b: { cell: cells.b, lid: 0.35 } }, umbrella: { open: false },
  })

  describe('R6-CHR-01 / R6-CHR-02: the dancing follower\'s mouth', () => {
    // B leads and says "whee" (cell 1) from 1.0 s to 1.5 s, held 0.1 s more; troll A follows. B shows cell 1 from 1.0 to 1.6 s.
    // A, dancing, shows it from 1.3125 to 1.9125 s; any other time it shows its rest cell 0.
    const whee = [{ who: 'b', cue: 'b_voice_whee', t: 1, end: 1.5 }]
    const leaderCell = (now) => (now >= 1 && now < 1.6 ? 1 : 3)
    const mirrored = (now) => (now >= 1.3125 && now < 1.9125 ? 1 : 0)
    const problemsOf = (followerCell, followerState = 'dance') => {
      const trace = Array.from({ length: 240 }, (_, k) => {
        const now = (k + 1) / FPS
        return sample(k + 1, { leader: 'b', followerState, cells: { a: followerCell(now), b: leaderCell(now) } })
      })
      const out = createResults()
      analyzeCharacters(prepare({ label: 'lane 1280x720', trace, cueLog: whee, rec: { events: [], frames: {} }, marks: [], foldLog: [] }), out, newCharacterPool())
      return ['R6-CHR-01', 'R6-CHR-02'].flatMap((id) => out.results.get(id).problems)
    }

    it('passes a dancing follower that shows the leader\'s cell 0.3125 s later and its rest cell otherwise', () => {
      expect(problemsOf(mirrored)).toEqual([])
    })

    it('fails a dancing follower that shows the cell at the leader\'s own time (no delay)', () => {
      expect(problemsOf((now) => (now >= 1 && now < 1.6 ? 1 : 0)).join('\n')).toMatch(/a mirroring .*expected cell \d, shows \d/)
    })

    it('fails a dancing follower that keeps its rest cell (the round-5 wording)', () => {
      expect(problemsOf(() => 0).join('\n')).toMatch(/a mirroring b_voice_whee \(now - 0\.3125 s\) expected cell 1, shows 0/)
    })

    it('still expects the rest cell from a follower that is not dancing, and fails one that mirrors anyway', () => {
      expect(problemsOf(() => 0, 'idle')).toEqual([])
      expect(problemsOf(mirrored, 'idle').join('\n')).toMatch(/a at rest expected cell 0, shows 1/)
    })
  })

  describe('R6-CHR-04: the dance anticipation stretch', () => {
    // Troll A starts its dance at 1.0 s: the stretch is at 1.57 s of clip time (frame 154), the landing at 1.67 s (frame 160).
    const run = ({ values, end }) => {
      const trace = Array.from({ length: 400 }, (_, k) => sample(k + 1))
      const frames = {}
      for (const { f } of trace) {
        const sy = values[f] ?? 1
        frames[f] = [0, 0, sy, 1, 1 / Math.sqrt(sy), 1]
      }
      const events = [{ type: 'dance-start', f: 60, detail: { who: 'a', t: 1 } }]
      if (end) events.push({ type: 'dance-end', f: end, detail: { who: 'a' } })
      const out = createResults()
      const pool = newCharacterPool()
      analyzeCharacters(prepare({ label: 'lane 1280x720', trace, cueLog: [], rec: { events, frames }, marks: [], foldLog: [] }), out, pool)
      return { problems: out.results.get('R6-CHR-04').problems, pool }
    }

    it('passes a 1.04 stretch at 1.57 s followed by the 0.88 landing, and counts both', () => {
      const { problems, pool } = run({ values: { 154: 1.04, 160: 0.88 } })
      expect(problems).toEqual([])
      expect(pool.squash['dance anticipation']).toBe(1)
      expect(pool.squash['dance landing']).toBe(1)
    })

    it('treats the stretch as a trigger for the 0.8 s rest rule, and skips both when the dance ends before the marker', () => {
      expect(run({ values: {}, end: 100 }).problems).toEqual([])
      expect(run({ values: {}, end: 100 }).pool.squash['dance anticipation']).toBeUndefined()
    })

    it('fails a dance without the stretch, and one with the wrong stretch', () => {
      expect(run({ values: { 160: 0.88 } }).problems.join('\n')).toMatch(/A dance anticipation at frame 154: scale.y 1, expected 1.04/)
      expect(run({ values: { 154: 1.1, 160: 0.88 } }).problems.join('\n')).toMatch(/A dance anticipation at frame 154: scale.y 1.1, expected 1.04/)
    })

    it('fails a stretch that nothing triggered (the dance ended first): it is not settled 0.8 s after the last trigger', () => {
      expect(run({ values: { 154: 1.04 }, end: 100 }).problems.join('\n')).toMatch(/A scale.y 1.04 at frame \d+, 0.8 s after its last trigger/)
    })
  })
})
