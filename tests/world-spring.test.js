import { Matrix4, Scene } from 'three'
import { expect, it } from 'vitest'
import { FLAT, stepSpring, UPRIGHT } from '../src/world/spring.js'
import { createTileStream } from '../src/world/stream.js'
import { VARIANTS } from '../src/world/tiles.js'

function sampleSpring(direction, from) {
  const state = { angle: from, velocity: 0 }
  return Array.from({ length: 2000 }, () => {
    stepSpring(state, direction, 0.001)
    return state.angle
  })
}

it('folds up with 15-25% overshoot and stays within 2° before 0.9 seconds', () => {
  const angles = sampleSpring('up', FLAT)
  const overshoot = Math.max(...angles) / Math.abs(FLAT)
  expect(overshoot).toBeGreaterThan(0.15)
  expect(overshoot).toBeLessThan(0.25)

  const lastOutside = angles.findLastIndex((angle) => Math.abs(angle - UPRIGHT) > Math.PI / 90)
  expect((lastOutside + 2) / 1000).toBeLessThan(0.9)
})

it('folds down with less than 2% overshoot', () => {
  const angles = sampleSpring('down', UPRIGHT)
  const overshoot = (FLAT - Math.min(...angles)) / Math.abs(FLAT)
  expect(overshoot).toBeLessThan(0.02)
  expect(angles.at(-1)).toBeCloseTo(FLAT, 5)
})

it('advances the same spring by the same amount across different frame sizes', () => {
  const whole = { angle: FLAT, velocity: 0.25 }
  const subdivided = { ...whole }
  stepSpring(whole, 'up', 0.04)
  for (let i = 0; i < 4; i += 1) stepSpring(subdivided, 'up', 0.01)
  expect(subdivided.angle).toBeCloseTo(whole.angle, 12)
  expect(subdivided.velocity).toBeCloseTo(whole.velocity, 12)
})

it('starts folds at the hysteresis boundaries and keeps a bounded trace for a single tile', () => {
  const tile = VARIANTS.find(({ id }) => id === 'flower')
  const events = []
  const stream = createTileStream(new Scene(), { getCell: () => tile }, (fold) => {
    if (fold.i === 0 && fold.j === 0) events.push(fold)
  })
  const update = (x, t, dt = 0.01) => stream.update(dt, t, { x, z: 0 }, 16 / 9)
  update(5.001, 0)
  update(5, 0.01)
  update(6, 0.02)
  update(6.5, 0.03)
  update(6.501, 0.04)
  update(6, 0.05)
  expect(events).toEqual([
    { dir: 'up', id: 'flower', i: 0, j: 0, t: 0.01 },
    { dir: 'down', id: 'flower', i: 0, j: 0, t: 0.04 },
  ])

  for (let frame = 6; frame < 250; frame += 1) update(6, frame / 100)
  const trace = stream.hingeTrace('0,0', { x: 6, z: 0 })
  expect(trace).toHaveLength(200)
  expect(trace[0].t).toBe(0.5)
  expect(trace.at(-1)).toEqual({ t: 2.49, angle: FLAT })
})

it('folds both bridge rails within the flat page height band', () => {
  const bridge = VARIANTS.find(({ id }) => id === 'yarn_bridge')
  const scene = new Scene()
  const stream = createTileStream(scene, { getCell: () => bridge }, () => {})
  stream.update(0, 0, { x: 0, z: 0 }, 16 / 9)

  const rails = scene.children.filter((mesh) => mesh.castShadow && mesh.count > 0)
  expect(rails).toHaveLength(2)
  const matrix = new Matrix4()
  for (const rail of rails) {
    rail.getMatrixAt(0, matrix)
    rail.geometry.computeBoundingBox()
    const bounds = rail.geometry.boundingBox.clone().applyMatrix4(matrix)
    expect(bounds.min.y).toBeGreaterThanOrEqual(0.005 - 1e-6)
    expect(bounds.max.y).toBeLessThanOrEqual(0.02 + 1e-6)
  }
})

it('keeps prop cards facing +Z with repeatable per-cell yaw', () => {
  const flower = VARIANTS.find(({ id }) => id === 'flower')
  const scene = new Scene()
  const stream = createTileStream(scene, { getCell: () => flower }, () => {})
  const origin = { x: 0, z: 0 }
  const matrix = new Matrix4()

  function sampleYaw() {
    const batch = scene.children.find((mesh) => mesh.castShadow && mesh.count > 0)
    return [0, 1, 2, 3].map((index) => {
      batch.getMatrixAt(index, matrix)
      return Math.atan2(-matrix.elements[2], matrix.elements[0])
    })
  }

  stream.update(0, 0, origin, 16 / 9)
  const angles = sampleYaw()
  for (const angle of angles) expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI / 15)
  expect(new Set(angles).size).toBeGreaterThan(1)
  stream.dropRender()
  stream.update(0, 1, origin, 16 / 9)
  expect(sampleYaw()).toEqual(angles)
})
