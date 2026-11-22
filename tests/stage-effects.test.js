import { Group, PerspectiveCamera, Scene, Vector3 } from 'three'
import { expect, it, vi } from 'vitest'
import { stageFlags } from '../src/effects/flags.js'
import { makeFronds } from '../src/effects/fronds.js'
import { motePlacements, MOTE_COUNT, placeLantern } from '../src/effects/placement.js'
import { createBurstPool, createResponse, FOLD_GLOW, setFold, updateResponse } from '../src/effects/response.js'
import { afterWorldReady, warmStage } from '../src/effects/startup.js'
import { createLayout } from '../src/world/layout.js'
import { FLAT, stepSpring, UPRIGHT } from '../src/world/spring.js'

it('creates effects after the ready frame and shows them only after shader warmup', async () => {
  const scene = new Scene()
  const inactive = new Group()
  inactive.visible = false
  let nextFrame
  vi.stubGlobal('requestAnimationFrame', (callback) => { nextFrame = callback })
  try {
    afterWorldReady(scene, (root) => root.add(inactive))
    const shaders = Promise.withResolvers()
    const ready = warmStage(scene, (stage) => {
      expect(stage).toBe(scene.children[0])
      expect(stage.visible).toBe(false)
      expect(inactive.visible).toBe(false)
      return shaders.promise
    })
    expect(scene.children).toHaveLength(0)
    nextFrame()
    await Promise.resolve()
    const [stage] = scene.children
    expect(stage.visible).toBe(false)
    scene.onAfterRender({})
    expect(stage.visible).toBe(false)
    expect(inactive.visible).toBe(false)
    shaders.resolve()
    await ready
    expect(stage.visible).toBe(true)
    expect(inactive.visible).toBe(false)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('reuses the same burst storage across 1,000 folds, with at most two bursts and 200 particles including motes', () => {
  const pool = createBurstPool()
  const { particles, slots } = pool
  const originalSlots = slots.slice()
  const perBurst = particles.length / (slots.length * 8)
  expect(perBurst).toBeGreaterThanOrEqual(24)
  expect(perBurst).toBeLessThanOrEqual(48)
  expect(perBurst * slots.length + MOTE_COUNT).toBeLessThanOrEqual(200)
  expect(slots).toHaveLength(2)

  for (let i = 0; i < 1_000; i += 1) {
    expect(pool.fire(i, 1, 2, 3, i)).toBe(true)
    expect(pool.fire(i, 4, 5, 6, i + 1)).toBe(true)
    expect(pool.fire(i, 7, 8, 9, i + 2)).toBe(false)
    expect(pool.particles).toBe(particles)
    expect(pool.slots).toBe(slots)
    expect(slots[0]).toBe(originalSlots[0])
    expect(slots[1]).toBe(originalSlots[1])
  }
  expect(particles[0]).toBe(1)
  expect(particles[perBurst * 8]).toBe(4)
  pool.reset()
  expect(pool.fire(0, 0, 0, 0, 1)).toBe(true)
})

it('bursts only after the spring passes upright, settles within three units, and fades in 0.6s', () => {
  const state = createResponse()
  const hinge = { angle: FLAT, velocity: 0 }
  setFold(state, true, 0)
  let uprightAt
  let burstAt
  for (let frame = 1; frame <= 60; frame += 1) {
    const t = frame / 60
    stepSpring(hinge, 'up', 1 / 60)
    if (hinge.angle >= UPRIGHT) uprightAt ??= t
    if (!updateResponse(state, t, hinge.angle, 4)) continue
    expect(burstAt).toBeUndefined()
    burstAt = t
    expect(state.glow).toBeCloseTo(1.5 * FOLD_GLOW)
  }
  expect(burstAt).toBeGreaterThanOrEqual(uprightAt)
  expect(burstAt).toBeLessThanOrEqual(uprightAt + 0.3)
  expect(state.glow).toBeCloseTo(FOLD_GLOW)
  updateResponse(state, 1.1, hinge.angle, 9)
  expect(state.glow).toBeCloseTo(FOLD_GLOW)
  updateResponse(state, 1.2, hinge.angle, 9.01)
  expect(state.glow).toBe(0)
  updateResponse(state, 1.3, hinge.angle, 9)
  setFold(state, false, 1.4)
  updateResponse(state, 1.7, hinge.angle, 9.05)
  expect(state.glow).toBeCloseTo(FOLD_GLOW / 2)
  updateResponse(state, 2, hinge.angle, 10)
  expect(state.glow).toBe(0)
})

it('cancels a fold that reverses before upright and rearms on the next fold-up', () => {
  const state = createResponse()
  setFold(state, true, 0)
  expect(updateResponse(state, 0.2, -0.3, 4)).toBe(false)
  setFold(state, false, 0.21)
  expect(updateResponse(state, 0.4, 0.1, 9.1)).toBe(false)
  expect(state.glow).toBe(0)
  setFold(state, true, 0.5)
  expect(updateResponse(state, 0.9, 0.05, 4)).toBe(true)
  expect(updateResponse(state, 1, 0.05, 4)).toBe(false)
})

it('places motes deterministically by seed', () => {
  const first = motePlacements(42)
  expect(first).toEqual(motePlacements(42))
  expect(first).not.toEqual(motePlacements(43))
  expect(first).toHaveLength(MOTE_COUNT)
  expect(first.filter(({ twinkle }) => twinkle)).toHaveLength(MOTE_COUNT / 5)
  for (const mote of first) {
    expect(mote.speed).toBeGreaterThanOrEqual(0.05)
    expect(mote.speed).toBeLessThanOrEqual(0.2)
  }
})

it('places lantern spans deterministically between grove supports on a seeded layout', () => {
  const placements = (seed) => {
    const layout = createLayout(seed)
    return Array.from({ length: 88 }, (_, slot) => {
      const i = slot % 11 - 5
      const j = Math.floor(slot / 11) - 4
      const span = placeLantern(layout, i, j)
      if (span) {
        expect(layout.getCell(i, j).zone).toBe('grove')
        expect(layout.getCell(span.endI, span.endJ).blockedRadius).toBeGreaterThan(0)
      }
      return span
    })
  }
  const first = placements(42)
  expect(first.some(Boolean)).toBe(true)
  expect(first).toEqual(placements(42))
  expect(first).not.toEqual(placements(43))
})

it.each([
  [5, 'moss'], [7, 'fronds'], [10, 'motes'], [11, 'lanterns'], [13, 'response'],
])('disables only item %d when its number is omitted', (item, name) => {
  const enabled = [5, 7, 10, 11, 13].filter((number) => number !== item)
  const allOn = { moss: true, fronds: true, motes: true, lanterns: true, response: true }
  expect(stageFlags(`?effects=${enabled.join(',')}`)).toEqual({ ...allOn, [name]: false })
})

it('ships motes, lanterns and the fold-up response by default; moss and fronds only on request', () => {
  expect(stageFlags()).toEqual({ moss: false, fronds: false, motes: true, lanterns: true, response: true })
  expect(stageFlags('?effects=')).toEqual({ moss: false, fronds: false, motes: false, lanterns: false, response: false })
})

it('hides a frond if the actor can project across its corner', () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 16 / 9)
  camera.position.set(0, 0, 10)
  camera.updateMatrixWorld()
  const update = makeFronds(scene, camera)
  const [left, right] = scene.getObjectByName('atlas/foreground-fronds').children
  update(new Vector3(0, 0, 0))
  expect(left.visible && right.visible).toBe(true)
  update(new Vector3(-3.0, -2.4, 0))
  expect(left.visible).toBe(false)
  expect(right.visible).toBe(true)
  update(new Vector3(3.0, -2.4, 0))
  expect(right.visible).toBe(false)
  expect(left.visible).toBe(true)
})
