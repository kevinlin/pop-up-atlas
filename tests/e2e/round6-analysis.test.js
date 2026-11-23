import { describe, expect, it } from 'vitest'
import { initHinge, startHinge, updateHinge } from '../../src/world/fold.js'
import { FLAT, STAGE_ONE, UPRIGHT } from '../../src/world/spring.js'
import { foldNumbers, makeSeries, measureFall, measureRise, riseProblems, simulateCell } from '../../scripts/e2e-duo-folds.mjs'
import { analyzeCamera, newCameraPool } from '../../scripts/e2e-duo-round6-camera.mjs'
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
