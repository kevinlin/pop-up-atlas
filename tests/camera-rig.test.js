import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createPlayer } from '../src/controls/movement.js'
import {
  createCameraRig, DANCE_BEAT, FIT, fitDistance, HERO_BEAT, WALK_CAMERA,
} from '../src/scene/camera-rig.js'

const STEP = 1 / 60

// Rig under test with synthetic controllers, event bus and fold bus (docs/contracts.md "Round 6" → Camera).
function setup(search = '') {
  vi.stubGlobal('window', { location: { search } })
  const camera = new PerspectiveCamera(30, 16 / 9, 0.1, 160)
  const player = createPlayer()
  const follower = createPlayer()
  follower.position.set(0.9, 0, 0.3)
  const events = new EventTarget()
  const foldListeners = new Set()
  const rig = createCameraRig(camera, player.position, {
    player, follower, events,
    onFold: (fn) => { foldListeners.add(fn); return () => foldListeners.delete(fn) },
  })
  const atlas = {}
  window.__atlas = atlas
  const run = (seconds) => {
    for (let t = 0; t < seconds - 1e-9; t += STEP) rig(STEP)
  }
  const emit = (type, detail = {}) => events.dispatchEvent(new CustomEvent(type, { detail }))
  // Tile (i, j) is centred at (2i, 2j).
  const fold = (id, i, j, dir = 'up') => foldListeners.forEach((fn) => fn({ dir, id, i, j, t: 0 }))
  rig(0)
  return { camera, player, follower, events, rig, atlas, run, emit, fold, foldListeners, state: () => atlas.camera }
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('walk camera', () => {
  test('defaults to distance 7.5, pitch 35, tau 0.25 and publishes __atlas.camera', () => {
    expect(WALK_CAMERA).toEqual({ distance: 7.5, pitch: 35, tau: 0.25 })
    const { camera, player, run, state } = setup()
    run(1)
    expect(state()).toMatchObject({ distance: 7.5, pitch: 35, beat: null })
    expect(Object.keys(state().target)).toEqual(['x', 'y', 'z'])
    expect(camera.position.y).toBeCloseTo(7.5 * Math.sin(35 * Math.PI / 180))
    expect(camera.position.z).toBeCloseTo(7.5 * Math.cos(35 * Math.PI / 180))
    expect(camera.position.x).toBeCloseTo(player.position.x)
  })

  test('the target follows the leader with an exponential tau of 0.25 s', () => {
    const { player, rig, state } = setup()
    player.position.set(4, 0, 0)
    for (let i = 0; i < 15; i += 1) rig(STEP)
    expect(state().target.x).toBeCloseTo(4 * (1 - Math.exp(-1)), 1)
  })

  test('assigns __atlas.camera whenever the atlas appears, whatever the module order', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const camera = new PerspectiveCamera(30, 16 / 9, 0.1, 160)
    const player = createPlayer()
    const rig = createCameraRig(camera, player.position,
      { player, follower: createPlayer(), events: new EventTarget(), onFold: () => () => {} })
    rig(STEP)
    window.__atlas = { foldLog: [] }
    rig(STEP)
    expect(window.__atlas.camera.pitch).toBe(35)
    expect(window.__atlas.foldLog).toEqual([])
  })
})

describe('dance beat', () => {
  test('eases in over 0.6 s to 4.5 / 22 degrees and out over 0.8 s', () => {
    expect(DANCE_BEAT).toMatchObject({ distance: 4.5, pitch: 22, aimY: 0.25, easeIn: 0.6, easeOut: 0.8 })
    const { run, emit, state } = setup()
    run(1)
    emit('duo-dance-start', { t: 1 })
    run(0.3)
    expect(state().beat).toBe('dance')
    expect(state().distance).toBeGreaterThan(4.6)
    expect(state().distance).toBeLessThan(7.4)
    run(0.31)
    expect(state().distance).toBeCloseTo(4.5, 1)
    expect(state().pitch).toBeCloseTo(22, 1)
    expect(state().target.y).toBeCloseTo(0.25, 2)
    run(2)
    expect(state().beat).toBe('dance')
    emit('duo-dance-end', { t: 4, interrupted: false })
    expect(state().beat).toBe('dance') // label is refreshed by the next frame
    run(STEP)
    expect(state().beat).toBe(null)
    run(0.4)
    expect(state().distance).toBeGreaterThan(5)
    expect(state().distance).toBeLessThan(7.4)
    run(0.45)
    expect(state().distance).toBeCloseTo(7.5, 1)
    expect(state().pitch).toBeCloseTo(35, 1)
    expect(state().target.y).toBeCloseTo(0, 2)
  })

  test('outranks a running hero beat', () => {
    const { run, emit, fold, state } = setup()
    run(1)
    fold('mushroom_house', 0, 1)
    run(0.3)
    expect(state().beat).toBe('hero')
    emit('duo-dance-start', { t: 1.3 })
    run(STEP)
    expect(state().beat).toBe('dance')
    fold('cupcake_tree', 0, 1)
    run(10)
    expect(state().beat).toBe('dance')
  })
})

describe('hero beat', () => {
  test('lasts 1.5 s at distance 6.0 / pitch 30 and then eases back', () => {
    expect(HERO_BEAT).toMatchObject({ distance: 6.0, pitch: 30, duration: 1.5, minGap: 8, radius: 2.5 })
    const { player, run, fold, state } = setup()
    run(1)
    player.position.set(0, 0, 0)
    fold('mushroom_house', 1, 1) // centre (2, 2): 2.83 away
    expect(state().beat).toBe(null)
    fold('mushroom_house', 1, 0) // centre (2, 0): 2.0 away
    run(STEP)
    expect(state().beat).toBe('hero')
    run(0.7)
    expect(state().distance).toBeCloseTo(6.0, 1)
    expect(state().pitch).toBeCloseTo(30, 1)
    run(0.6)
    expect(state().beat).toBe('hero')
    run(0.3)
    expect(state().beat).toBe(null)
    run(1)
    expect(state().distance).toBeCloseTo(7.5, 1)
    expect(state().pitch).toBeCloseTo(35, 1)
  })

  test('only fold-ups of the hero tiles near the leader count, at most one per 8 s', () => {
    const { run, fold, state } = setup()
    run(1)
    fold('mushroom_house', 1, 0, 'down')
    fold('flower', 1, 0)
    fold('river', 1, 0)
    fold('cupcake_tree', 2, 0) // 4 away
    run(STEP)
    expect(state().beat).toBe(null)
    fold('yarn_bridge', 1, 0)
    run(STEP)
    expect(state().beat).toBe('hero')
    run(2.5)
    expect(state().beat).toBe(null)
    fold('cupcake_tree', 1, 0)
    run(STEP)
    expect(state().beat).toBe(null)
    run(5)
    fold('cupcake_tree', 1, 0) // 7.5 s after the first
    run(STEP)
    expect(state().beat).toBe(null)
    run(0.6)
    fold('cupcake_tree', 1, 0)
    run(STEP)
    expect(state().beat).toBe('hero')
  })
})

describe('fit', () => {
  // Largest |ndc| of the sphere's outermost points (centre +- radius along the camera's right and up).
  function extent(camera, point) {
    camera.updateMatrixWorld()
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    const centre = new Vector3(point.x, point.y + FIT.lift, point.z)
    let x = 0
    let y = 0
    for (const [axis, sign] of [[right, 1], [right, -1], [up, 1], [up, -1]]) {
      const ndc = centre.clone().addScaledVector(axis, sign * FIT.radius).project(camera)
      x = Math.max(x, Math.abs(ndc.x))
      y = Math.max(y, Math.abs(ndc.y))
    }
    return { x, y }
  }

  test('a close pair leaves the walk distance alone', () => {
    const { run, state } = setup()
    run(1)
    expect(state().distance).toBeCloseTo(7.5, 3)
  })

  test('a lateral gap raises the distance until both spheres fit with a 6 % margin', () => {
    const { camera, player, follower, run, state } = setup()
    follower.position.set(3.4, 0, 0)
    run(3)
    const distance = state().distance
    expect(distance).toBeGreaterThan(7.5)
    expect(distance).toBeLessThan(10)
    const limit = 1 - 2 * FIT.margin
    for (const who of [player, follower]) {
      const { x, y } = extent(camera, { x: who.position.x, y: who.position.y, z: who.position.z })
      expect(x).toBeLessThanOrEqual(limit + 0.01)
      expect(y).toBeLessThanOrEqual(limit + 0.01)
    }
    // Minimal: the follower's far edge sits on the margin.
    expect(extent(camera, follower.position).x).toBeGreaterThan(limit - 0.06)
  })

  test('a 4.6-unit gap needs more than the cap, so the distance stops at 10', () => {
    const { follower, run, state } = setup()
    follower.position.set(4.6, 0, 0)
    run(3)
    expect(state().distance).toBeCloseTo(10, 3)
    expect(FIT.maxDistance).toBe(10)
  })

  test('the distance rises with tau 0.25 and falls back when the gap closes', () => {
    const { follower, run, state } = setup()
    run(1)
    follower.position.set(3.4, 0, 0)
    run(0.25)
    const early = state().distance
    run(3)
    expect(early).toBeGreaterThan(7.5)
    expect(early).toBeLessThan(state().distance)
    follower.position.set(0.9, 0, 0)
    run(3)
    expect(state().distance).toBeCloseTo(7.5, 2)
  })

  test('reads the controller positions on every call', () => {
    const { follower, rig, state } = setup()
    for (let i = 0; i < 120; i += 1) rig(STEP)
    follower.position.set(3.4, 0, 0)
    for (let i = 0; i < 120; i += 1) rig(STEP)
    expect(state().distance).toBeGreaterThan(8)
  })

  test('fitDistance is pure, monotone in the gap and never above the cap', () => {
    const view = { pitch: 35, fov: 30, aspect: 16 / 9, from: 7.5 }
    const look = { x: 0, y: 0, z: 0 }
    const at = (gap) => fitDistance(look, [{ x: 0, y: 0.5, z: 0 }, { x: gap, y: 0.5, z: 0 }], view)
    expect(at(0.9)).toBe(7.5)
    expect(at(3.4)).toBeGreaterThan(at(3))
    expect(at(3)).toBeGreaterThan(7.5)
    expect(at(30)).toBe(10)
  })
})

describe('skipped beats', () => {
  test('a dance or hero beat whose fit needs more than 7.5 is skipped', () => {
    const { follower, run, emit, fold, state } = setup()
    follower.position.set(3.4, 0, 0) // walk fit is about 9: far above 7.5 at every beat pitch
    run(2)
    emit('duo-dance-start', { t: 2 })
    run(1)
    expect(state().beat).toBe(null)
    expect(state().distance).toBeGreaterThan(8)
    fold('mushroom_house', 1, 0)
    run(STEP)
    expect(state().beat).toBe(null)
    emit('duo-dance-end', { t: 3, interrupted: false })
    run(1)
    expect(state().beat).toBe(null)
  })

  test('a skipped hero beat does not use up the 8 s slot', () => {
    const { follower, run, fold, state } = setup()
    follower.position.set(3.4, 0, 0)
    run(2)
    fold('mushroom_house', 1, 0)
    run(STEP)
    expect(state().beat).toBe(null)
    follower.position.set(0.9, 0, 0)
    run(2)
    fold('mushroom_house', 1, 0)
    run(STEP)
    expect(state().beat).toBe('hero')
  })

  test('a beat whose fit stays within 7.5 runs with the fit applied during the blend', () => {
    const { follower, run, emit, state } = setup()
    follower.position.set(1.8, 0, 0)
    run(2)
    emit('duo-dance-start', { t: 2 })
    run(1.5)
    expect(state().beat).toBe('dance')
    expect(state().distance).toBeGreaterThan(4.5)
    expect(state().distance).toBeLessThanOrEqual(7.5)
  })
})

describe('priority and cancellation', () => {
  test('a swap cancels a beat and eases out over 0.8 s', () => {
    const { run, emit, state } = setup()
    run(1)
    emit('duo-dance-start', { t: 1 })
    run(1)
    emit('swap', { leader: 'b', t: 2 })
    run(STEP)
    expect(state().beat).toBe(null)
    run(0.3)
    expect(state().distance).toBeGreaterThan(4.6)
    expect(state().distance).toBeLessThan(7.4)
    run(0.55)
    expect(state().distance).toBeCloseTo(7.5, 1)
    emit('duo-dance-end', { t: 3, interrupted: true })
    run(STEP)
    expect(state().beat).toBe(null)
  })

  test('a hop cancels a beat', () => {
    const { run, emit, fold, state } = setup()
    run(1)
    fold('mushroom_house', 1, 0)
    run(0.5)
    expect(state().beat).toBe('hero')
    emit('hop', { who: 'b', phase: 'takeoff', t: 1.5 })
    run(STEP)
    expect(state().beat).toBe(null)
    run(0.85)
    expect(state().distance).toBeCloseTo(7.5, 1)
  })

  test('a hop blocks a new hero beat until it lands', () => {
    const { run, emit, fold, state } = setup()
    run(1)
    emit('hop', { who: 'b', phase: 'takeoff', t: 1 })
    run(1)
    fold('cupcake_tree', 1, 0)
    run(STEP)
    expect(state().beat).toBe(null)
    emit('hop', { who: 'b', phase: 'land', t: 2 })
    fold('cupcake_tree', 1, 0)
    run(STEP)
    expect(state().beat).toBe('hero')
  })

  test('a hop whose landing is lost stops blocking after a few seconds', () => {
    const { run, emit, fold, state } = setup()
    run(1)
    emit('hop', { who: 'b', phase: 'takeoff', t: 1 })
    run(4)
    fold('yarn_bridge', 1, 0)
    run(STEP)
    expect(state().beat).toBe('hero')
  })
})

describe('?cam= and yaw', () => {
  test('?cam= sets the framing, turns beats and fit off', () => {
    const { follower, camera, run, emit, fold, state } = setup('?cam=9,50')
    follower.position.set(4.6, 0, 0)
    run(1)
    expect(state()).toMatchObject({ distance: 9, pitch: 50, beat: null })
    emit('duo-dance-start', { t: 1 })
    fold('mushroom_house', 1, 0)
    run(1)
    expect(state()).toMatchObject({ distance: 9, pitch: 50, beat: null })
    expect(camera.position.y).toBeCloseTo(9 * Math.sin(50 * Math.PI / 180))
  })

  test('an invalid ?cam= keeps the shipped camera and its beats', () => {
    const { run, fold, state } = setup('?cam=9')
    run(1)
    expect(state().distance).toBeCloseTo(7.5, 3)
    fold('mushroom_house', 1, 0)
    run(STEP)
    expect(state().beat).toBe('hero')
  })

  test('yaw never changes through beats, swaps and fit', () => {
    const { camera, player, follower, run, emit, fold, state } = setup()
    const yaws = []
    const sample = () => {
      const direction = camera.getWorldDirection(new Vector3())
      yaws.push(direction.x, camera.position.x - state().target.x)
    }
    const step = (seconds) => {
      for (let t = 0; t < seconds; t += STEP) { run(STEP); sample() }
    }
    player.position.set(3, 0, -2)
    step(1)
    fold('mushroom_house', 2, -1)
    step(1)
    follower.position.set(6, 0, -2)
    emit('swap', { leader: 'b', t: 3 })
    step(1)
    emit('duo-dance-start', { t: 4 })
    step(1)
    emit('duo-dance-end', { t: 5 })
    step(1.5)
    for (const value of yaws) expect(Math.abs(value)).toBeLessThan(1e-9)
  })

  test('dispose unhooks the event and fold listeners', () => {
    const { rig, run, emit, state, foldListeners } = setup()
    rig.dispose()
    expect(foldListeners.size).toBe(0)
    emit('duo-dance-start', { t: 0 })
    run(1)
    expect(state().beat).toBe(null)
  })
})
