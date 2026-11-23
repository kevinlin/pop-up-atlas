import {
  BoxGeometry, Group, Matrix4, Mesh, MeshLambertMaterial, Scene,
} from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { stepSpring } from '../src/lib/spring.js'
import { events, follower } from '../src/scene/runtime.js'
import { createArt } from '../src/world/art.js'
import {
  createHistory, createSecondary, pushHistory, secondaryDelay, stepSecondary,
} from '../src/world/follow.js'
import { FLAT, UPRIGHT } from '../src/world/spring.js'
import { createTileStream } from '../src/world/stream.js'
import { VARIANTS } from '../src/world/tiles.js'

// Numbers come from docs/contracts.md "Round 6" → Folds, written out here on purpose.
const DEG = Math.PI / 180
const STAGE_ONE = -63 * DEG
const BEND_LIMIT = 8 * DEG
const FRAME = 0.01

const variant = (id) => VARIANTS.find((tile) => tile.id === id)
const flower = variant('flower')
const disposers = []
afterEach(() => {
  while (disposers.length) disposers.pop()()
  follower.position.set(0, 0, 0)
})

// A fixed-step harness: the leader stands at (x, 0); every frame is 10 ms.
function rig({ tile = flower, getCell, withArt } = {}) {
  const scene = new Scene()
  const layout = { getCell: getCell ?? (() => tile) }
  const art = createArt(scene, undefined, layout)
  withArt?.(art)
  const folds = []
  const stream = createTileStream(scene, layout, (fold) => folds.push(fold), undefined, { art })
  disposers.push(() => stream.dispose?.())
  const state = { frame: 0 }
  const origin = { x: 0, z: 0 }
  const leader = { x: 8, z: 0 }
  stream.update(0, 0, leader, 16 / 9)
  const api = {
    scene, folds, stream, state,
    get t() { return state.frame * FRAME },
    frame(x) {
      state.frame += 1
      leader.x = x
      stream.update(FRAME, state.frame * FRAME, leader, 16 / 9)
    },
    go(x, seconds, each) {
      for (let frame = 0; frame < Math.round(seconds / FRAME); frame += 1) {
        api.frame(x)
        each?.()
      }
    },
    trace: (id = '0,0') => stream.hingeTrace(id, origin),
    angle: (id = '0,0') => api.trace(id).at(-1).angle,
    foldsAt: (i, j = 0) => folds.filter((fold) => fold.i === i && fold.j === j),
    movers: () => scene.children.filter((mesh) => mesh.isInstancedMesh && mesh.castShadow && mesh.count > 0),
  }
  return api
}

function slotAt(mesh, x) {
  const matrix = new Matrix4()
  for (let slot = 0; slot < mesh.count; slot += 1) {
    mesh.getMatrixAt(slot, matrix)
    if (Math.abs(matrix.elements[12] - x) < 0.5 && Math.abs(matrix.elements[14]) < 0.5) return slot
  }
  throw new Error(`no instance near x=${x}`)
}

// A tile object as the loader would hand it over: hinge_0 with a card and a sec_0 pivot nested in it.
function fixtureTile(id) {
  const root = new Group()
  root.name = id
  const hinge = new Group()
  hinge.name = 'hinge_0'
  root.add(hinge)
  const cardMaterial = new MeshLambertMaterial()
  cardMaterial.name = 'card_fixture'
  const card = new Mesh(new BoxGeometry(0.6, 1, 0.01).translate(0, 0.5, 0), cardMaterial)
  card.name = 'card_part'
  hinge.add(card)
  const sec = new Group()
  sec.name = 'sec_0'
  sec.position.set(0, 1, 0)
  hinge.add(sec)
  const feltMaterial = new MeshLambertMaterial()
  feltMaterial.name = 'felt_fixture'
  const door = new Mesh(new BoxGeometry(0.2, 0.2, 0.01).translate(0, 0.1, 0), feltMaterial)
  door.name = 'door_part'
  sec.add(door)
  return root
}

describe('stage 1', () => {
  it('lifts to -63° within 4.5 units and drops to flat beyond 5.5 with no fold event', () => {
    const r = rig()
    r.go(5.6, 3)
    expect(r.angle()).toBe(FLAT)
    r.go(4.501, 3)
    expect(r.angle()).toBe(FLAT)
    r.go(4.5, 3)
    expect(r.angle()).toBe(STAGE_ONE)
    r.go(5.5, 3)
    expect(r.angle()).toBe(STAGE_ONE)
    r.go(5.501, 3)
    expect(r.angle()).toBe(FLAT)
    expect(r.foldsAt(0)).toEqual([])
  })

  it('moves on a spring of ω 5, ζ 0.8 without overshooting -63°', () => {
    const r = rig()
    r.go(4, 0.6)
    const trace = r.trace()
    const triggered = trace.find(({ t }) => t > 0.005)
    const reference = { value: FLAT, velocity: 0 }
    for (let frame = 1; frame <= 40; frame += 1) {
      stepSpring(reference, STAGE_ONE, FRAME, 5, 0.8)
      const sample = trace.find(({ t }) => Math.abs(t - (triggered.t + frame * FRAME)) < 1e-9)
      expect(sample.angle).toBeCloseTo(reference.value, 6)
    }
    expect(Math.max(...trace.map(({ angle }) => angle))).toBeLessThanOrEqual(STAGE_ONE)
  })

  it('takes a stage-2 fold-down to -63° inside 5.5 units and to flat outside it', () => {
    const r = rig()
    r.go(0, 3)
    r.go(4, 3)
    expect(r.angle()).toBe(STAGE_ONE)
    expect(r.foldsAt(0).map(({ dir }) => dir)).toEqual(['up', 'down'])
    const far = rig()
    far.go(0, 3)
    far.go(6, 3)
    expect(far.angle()).toBe(FLAT)
  })
})

describe('anticipation dip', () => {
  it('holds a flat hinge for 80 ms before the up spring starts', () => {
    const r = rig()
    r.go(8, 1)
    r.go(0, 0.5)
    const [up] = r.foldsAt(0)
    const samples = r.trace().filter(({ t }) => t >= up.t)
    for (const { t, angle } of samples.filter(({ t }) => t < up.t + 0.075)) expect({ t, angle }).toEqual({ t, angle: FLAT })
    expect(samples.find(({ t }) => t >= up.t + 0.2).angle).toBeGreaterThan(FLAT + 0.05)
  })

  it('dips 4° below the stage-1 angle over 80 ms, then springs up', () => {
    const r = rig()
    r.go(4, 4)
    r.go(0, 0.6)
    const [up] = r.foldsAt(0)
    const after = r.trace().filter(({ t }) => t > up.t)
    const dip = after.filter(({ t }) => t <= up.t + 0.08)
    expect(Math.min(...dip.map(({ angle }) => angle))).toBeCloseTo(STAGE_ONE - 4 * DEG, 2)
    for (let i = 1; i < dip.length; i += 1) expect(dip[i].angle).toBeLessThanOrEqual(dip[i - 1].angle + 1e-12)
    expect(after.find(({ t }) => t >= up.t + 0.2).angle).toBeGreaterThan(STAGE_ONE)
  })

  it('never dips below the page: from just above flat it stops at -90°', () => {
    const r = rig()
    r.go(4, 4)
    while (r.angle() > -88.5 * DEG) r.go(8, 0.01)
    expect(r.angle()).toBeLessThan(-88 * DEG)
    r.go(0, 0.4)
    const [up] = r.foldsAt(0)
    const dip = r.trace().filter(({ t }) => t > up.t && t <= up.t + 0.1)
    const lowest = Math.min(...dip.map(({ angle }) => angle))
    expect(lowest).toBeGreaterThanOrEqual(FLAT - 1e-9)
    expect(lowest).toBeCloseTo(FLAT, 2)
  })

  it('is cancelled by a down trigger: the down spring starts from the current angle', () => {
    const r = rig()
    r.go(4, 4)
    r.go(0, 0.04)
    const atCancel = r.angle()
    expect(atCancel).toBeLessThan(STAGE_ONE - 0.2 * DEG)
    expect(atCancel).toBeGreaterThan(STAGE_ONE - 4 * DEG)
    const after = []
    r.go(8, 3, () => after.push(r.angle()))
    expect(Math.abs(after[0] - atCancel)).toBeLessThan(2 * DEG)
    expect(Math.max(...after)).toBeLessThanOrEqual(atCancel + 1e-9)
    expect(after.at(-1)).toBe(FLAT)
    expect(r.foldsAt(0).map(({ dir }) => dir)).toEqual(['up', 'down'])
  })
})

describe('release-relative timing', () => {
  it.each([
    ['stage 1 (-63°)', (r) => r.go(4, 4)],
    ['flat (-90°)', (r) => r.go(8, 1)],
  ])('crosses upright 0.40 ± 0.05 s after release, overshoots 12-20 %%, settles < 1.4 s from %s', (_, prepare) => {
    const r = rig()
    prepare(r)
    r.go(0, 1.9)
    const [up] = r.foldsAt(0)
    const release = up.t + 0.08
    const after = r.trace().filter(({ t }) => t >= release - 1e-9)
    const start = after[0].angle
    expect(start).toBeLessThan(STAGE_ONE + 1e-9)
    const crossing = after.find(({ angle }) => angle >= UPRIGHT)
    expect(crossing.t - release).toBeGreaterThanOrEqual(0.35)
    expect(crossing.t - release).toBeLessThanOrEqual(0.45)
    const overshoot = Math.max(...after.map(({ angle }) => angle)) / Math.abs(start)
    expect(overshoot).toBeGreaterThan(0.12)
    expect(overshoot).toBeLessThan(0.20)
    const lastOutside = after.findLast(({ angle }) => Math.abs(angle - UPRIGHT) > 2 * DEG)
    expect(lastOutside.t - release).toBeLessThan(1.4)
  })
})

describe('per-instance bend', () => {
  it('gives every moving batch an instanceBend attribute and the USE_INSTANCE_BEND define, and no static batch', () => {
    const r = rig()
    r.go(0, 0.1)
    const movers = r.movers()
    expect(movers.length).toBeGreaterThan(0)
    for (const mesh of movers) {
      const bend = mesh.geometry.attributes.instanceBend
      expect(bend.isInstancedBufferAttribute).toBe(true)
      expect(bend.itemSize).toBe(1)
      expect(bend.array).toBeInstanceOf(Float32Array)
      expect(bend.array.length).toBeGreaterThanOrEqual(mesh.count)
      expect(mesh.material.defines).toHaveProperty('USE_INSTANCE_BEND')
    }
    const statics = r.scene.children.filter((mesh) => mesh.isInstancedMesh && !mesh.castShadow)
    expect(statics.length).toBeGreaterThan(0)
    for (const mesh of statics) {
      expect(mesh.geometry.attributes.instanceBend).toBeUndefined()
      expect(mesh.material.defines?.USE_INSTANCE_BEND).toBeUndefined()
    }
  })

  it('bends two copies of one tile independently, follows -0.04·θ′ clamped to ±8°, and reads 0 when settled', () => {
    const r = rig()
    r.go(8, 1)
    const bloom = r.movers().at(-1)
    const bends = () => bloom.geometry.attributes.instanceBend.array
    const bendAt = (x) => bends()[slotAt(bloom, x)]
    const samples = []
    const record = () => samples.push({ angle: r.angle(), a: bendAt(0), b: bendAt(2), settled: bendAt(-8) })
    r.go(-1.5, 0.7, record)
    const phase = samples.length
    r.go(1.5, 0.15, record)

    expect(samples.every(({ settled }) => Object.is(settled, 0))).toBe(true)
    expect(samples.every(({ a, b }) => Math.abs(a) <= BEND_LIMIT + 1e-6 && Math.abs(b) <= BEND_LIMIT + 1e-6)).toBe(true)
    // The first copy is mid-rise while the second has only just been triggered.
    expect(samples.slice(phase).some(({ a, b }) => Math.abs(a) > 1e-3 && Math.abs(a - b) > 1e-3)).toBe(true)
    expect(Math.min(...samples.map(({ a }) => a))).toBeCloseTo(-BEND_LIMIT, 5)
    // bend = -0.04 · θ′ where unclamped (central difference of the traced angle).
    let checked = 0
    for (let n = 1; n < phase - 1; n += 1) {
      const velocity = (samples[n + 1].angle - samples[n - 1].angle) / (2 * FRAME)
      const expected = -0.04 * velocity
      if (Math.abs(expected) > BEND_LIMIT * 0.9 || Math.abs(expected) < 0.01) continue
      expect(samples[n].a).toBeCloseTo(expected, 2)
      checked += 1
    }
    expect(checked).toBeGreaterThan(5)

    r.go(1.5, 4)
    for (let slot = 0; slot < bloom.count; slot += 1) expect(Object.is(bends()[slot], 0)).toBe(true)
  })
})

describe('sec_<k> follow-through', () => {
  it('delays each secondary by 80 ± 20 ms', () => {
    for (let k = 0; k < 12; k += 1) {
      expect(secondaryDelay(k)).toBeGreaterThanOrEqual(0.06 - 1e-9)
      expect(secondaryDelay(k)).toBeLessThanOrEqual(0.10 + 1e-9)
    }
    expect(new Set(Array.from({ length: 12 }, (_, k) => secondaryDelay(k))).size).toBeGreaterThan(1)
  })

  it.each([0, 1, 2, 3])('sec %i holds still for its delay, then tracks the parent on ω 9, ζ 0.4, and φ = s − θ', (k) => {
    const history = createHistory()
    const sec = createSecondary(k)
    const dt = 0.005
    let t = 0
    const step = (angle, atRest) => {
      t += dt
      pushHistory(history, t, angle)
      return stepSecondary(sec, history, t, dt, angle, atRest)
    }
    for (let i = 0; i < 200; i += 1) step(0, true)
    expect(sec.phi).toBe(0)
    const jumpAt = t
    let angle = 0
    const values = []
    for (let i = 0; i < 40; i += 1) {
      angle = 0.5
      step(angle, false)
      values.push({ dt: t - jumpAt, value: sec.value, phi: sec.phi })
    }
    for (const { dt: since, value, phi } of values) {
      if (since <= 0.05) expect(value).toBe(0)
      expect(phi).toBeCloseTo(value - 0.5, 12)
    }
    expect(values.find(({ dt: since }) => since >= 0.12).value).toBeGreaterThan(1e-3)
    // Underdamped: the follower overshoots the parent's new angle before settling.
    let peak = 0
    for (let i = 0; i < 800; i += 1) {
      step(angle, true)
      peak = Math.max(peak, sec.value)
    }
    expect(peak).toBeGreaterThan(0.5 * 1.1)
    expect(sec.phi).toBe(0)
    expect(sec.value).toBe(0.5)
  })

  it('rotates the secondary pose by φ about its own X axis, 0 at rest, and works unchanged without secs', () => {
    const fixtures = ['meadow_a', 'meadow_b', 'meadow_c']
    const r = rig({
      tile: variant('meadow'),
      withArt: (art) => { for (const id of fixtures) art.addTile(id, fixtureTile(id)) },
    })
    const meshes = (suffix) => r.scene.children.filter((mesh) => mesh.isInstancedMesh && mesh.name.endsWith(suffix) && mesh.count > 0)
    // The hinge and its sec_0 are placed together, so they share an instance slot in their own batches.
    const pose = (x) => {
      const cards = meshes('/card_part')
      const card = cards.find((mesh) => { try { slotAt(mesh, x); return true } catch { return false } })
      const door = meshes('/door_part').find((mesh) => mesh.name.split('/')[1] === card.name.split('/')[1])
      const slot = slotAt(card, x)
      const hingeMatrix = new Matrix4()
      const secMatrix = new Matrix4()
      card.getMatrixAt(slot, hingeMatrix)
      door.getMatrixAt(slot, secMatrix)
      const relative = new Matrix4().copy(hingeMatrix).multiply(new Matrix4().makeTranslation(0, 1, 0)).invert().multiply(secMatrix)
      return Math.atan2(relative.elements[6], relative.elements[5])
    }
    r.go(8, 1)
    expect(Math.abs(pose(0))).toBeLessThan(1e-5)
    const phis = []
    r.go(0, 0.07, () => phis.push(pose(0)))
    expect(phis.every((phi) => Math.abs(phi) < 1e-5)).toBe(true)
    r.go(0, 1.5, () => phis.push(pose(0)))
    // Rising parent: the secondary lags behind, so φ is negative first.
    expect(Math.min(...phis)).toBeLessThan(-0.03)
    expect(phis.find((phi) => Math.abs(phi) > 1e-4)).toBeLessThan(0)
    r.go(0, 3)
    expect(Math.abs(pose(0))).toBeLessThan(1e-5)
  })
})

describe('dance stage', () => {
  const dispatch = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }))

  // Leader (-0.5, 0), follower (5, 0): cell 0 and -1 are up, 1 is stage 1 outside 1.8, 2 is stage 1 inside it, 3 is flat inside it.
  function stage(options) {
    const r = rig(options)
    follower.position.set(5, 0, 0)
    r.go(-0.5, 3)
    return r
  }

  it('drops stage-2 tiles within 1.8 units with a down event marked cause stage, stage-1 tiles silently, and leaves flat tiles flat', () => {
    const r = stage()
    expect(r.angle('0,0')).toBe(UPRIGHT)
    expect(r.angle('1,0')).toBe(STAGE_ONE)
    expect(r.angle('2,0')).toBe(STAGE_ONE)
    expect(r.angle('3,0')).toBe(FLAT)
    const before = r.folds.length
    dispatch('duo-dance-start', { t: r.t })
    r.go(-0.5, 3)
    const added = r.folds.slice(before)
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((fold) => fold.dir === 'down' && fold.cause === 'stage')).toBe(true)
    expect(added.map(({ i, j }) => `${i},${j}`).sort()).toEqual(['-1,0', '0,0'])
    expect(r.angle('0,0')).toBe(FLAT)
    expect(r.angle('2,0')).toBe(FLAT)
    expect(r.angle('3,0')).toBe(FLAT)
    expect(r.angle('1,0')).toBe(STAGE_ONE)
    expect(r.folds.slice(before).some((fold) => fold.i === 2 || fold.i === 3)).toBe(false)
    dispatch('duo-dance-end', { t: r.t, interrupted: false })
  })

  it('keeps the tiles flat while the dance runs and reopens them at duo-dance-end with the usual events', () => {
    const r = stage()
    dispatch('duo-dance-start', { t: r.t })
    r.go(-0.5, 4)
    const during = r.folds.length
    r.go(-0.2, 2)
    expect(r.folds.length).toBe(during)
    expect(r.angle('0,0')).toBe(FLAT)
    expect(r.angle('2,0')).toBe(FLAT)
    dispatch('duo-dance-end', { t: r.t, interrupted: false })
    r.go(-0.5, 3)
    const reopened = r.folds.slice(during)
    expect(reopened.map(({ dir, i, j, cause }) => ({ dir, i, j, cause })).sort((a, b) => a.i - b.i))
      .toEqual([{ dir: 'up', i: -1, j: 0, cause: undefined }, { dir: 'up', i: 0, j: 0, cause: undefined }])
    expect(r.angle('0,0')).toBe(UPRIGHT)
    expect(r.angle('2,0')).toBe(STAGE_ONE)
    expect(r.angle('1,0')).toBe(STAGE_ONE)
  })

  it('only stages prop tiles', () => {
    const meadow = variant('meadow')
    const r = rig({ getCell: (i, j) => (i === 0 && j === 0 ? meadow : flower) })
    r.go(0, 3)
    expect(r.angle('0,0')).toBe(UPRIGHT)
    const before = r.folds.length
    dispatch('duo-dance-start', { t: r.t })
    r.go(0, 2)
    expect(r.angle('0,0')).toBe(UPRIGHT)
    expect(r.folds.slice(before).some((fold) => fold.i === 0 && fold.j === 0)).toBe(false)
    dispatch('duo-dance-end', { t: r.t, interrupted: false })
  })
})
