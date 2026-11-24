import { Matrix4, PerspectiveCamera, Scene, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { createArt } from '../src/world/art.js'
import { FLAT, STAGE_ONE, stepSpring, UPRIGHT } from '../src/world/spring.js'
import { createTileStream } from '../src/world/stream.js'
import { VARIANTS } from '../src/world/tiles.js'

function sampleSpring(direction, from) {
  const state = { angle: from, velocity: 0 }
  return Array.from({ length: 3000 }, () => {
    stepSpring(state, direction, 0.001)
    return state.angle
  })
}

it('first crosses upright at about 0.40 seconds, overshoots 12-20%, and settles within 2° before 1.4 seconds', () => {
  const angles = sampleSpring('up', FLAT)
  expect((angles.findIndex((angle) => angle >= UPRIGHT) + 1) / 1000).toBeCloseTo(0.40, 2)
  const overshoot = Math.max(...angles) / Math.abs(FLAT)
  expect(overshoot).toBeGreaterThan(0.12)
  expect(overshoot).toBeLessThan(0.20)

  const lastOutside = angles.findLastIndex((angle) => Math.abs(angle - UPRIGHT) > Math.PI / 90)
  expect((lastOutside + 2) / 1000).toBeLessThan(1.4)
})

it('folds down with less than 2% overshoot', () => {
  const angles = sampleSpring('down', UPRIGHT)
  const overshoot = (FLAT - Math.min(...angles)) / Math.abs(FLAT)
  expect(overshoot).toBeLessThan(0.02)
  expect(angles[299]).toBeCloseTo(-1.072, 2)
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
  update(2.001, 0)
  update(2, 0.01)
  update(2.5, 0.02)
  update(3, 0.03)
  update(3.001, 0.04)
  update(2.5, 0.05)
  expect(events).toEqual([
    { dir: 'up', id: 'flower', i: 0, j: 0, t: 0.01 },
    { dir: 'down', id: 'flower', i: 0, j: 0, t: 0.04 },
  ])

  for (let frame = 6; frame < 250; frame += 1) update(2.5, frame / 100)
  const trace = stream.hingeTrace('0,0', { x: 2.5, z: 0 })
  expect(trace).toHaveLength(200)
  expect(trace[0].t).toBe(0.5)
  // Round 6: a tile left 2.5 units away rests at the stage-1 angle (-63°), not flat (flat beyond 5.5).
  expect(trace.at(-1)).toEqual({ t: 2.49, angle: STAGE_ONE })
})

it('starts the tallest flower hinge first and waits 180 ms to move the stem', () => {
  const flower = VARIANTS.find(({ id }) => id === 'flower')
  const scene = new Scene()
  const stream = createTileStream(scene, { getCell: () => flower }, () => {})
  const origin = { x: 0, z: 0 }
  stream.update(0, 0, origin, 16 / 9)

  const [stem, bloom] = scene.children.filter((mesh) => mesh.castShadow && mesh.count > 0)
  const angles = (mesh) => Array.from({ length: mesh.count }, (_, index) => mesh.instanceMatrix.array[16 * index + 5])
  const flatStem = angles(stem)
  const flatBloom = angles(bloom)
  stream.update(0.179, 0.179, origin, 16 / 9)
  expect(angles(bloom)).not.toEqual(flatBloom)
  expect(angles(stem)).toEqual(flatStem)
  stream.update(0.002, 0.181, origin, 16 / 9)
  expect(angles(stem)).not.toEqual(flatStem)
})

it.each(['flower', 'mushroom_house', 'cupcake_tree'])('folds the %s lead across the page toward either camera side', (id) => {
  const tile = VARIANTS.find((variant) => variant.id === id)
  for (const side of [-1, 1]) {
    const camera = new PerspectiveCamera()
    camera.position.set(0, 7, side * 7)
    camera.lookAt(0, 0, 0)
    const art = createArt(new Scene(), camera)
    const cell = { tile, i: 0, j: 0, x: 0, z: 0 }
    cell.art = art.create(cell)
    art.begin(1)
    art.placeTile(cell)
    const [lead] = cell.art.hinges
    const matrix = new Matrix4()
    lead.batches[0].mesh.getMatrixAt(0, matrix)
    const direction = new Vector3(0, 1, 0).transformDirection(matrix)
    expect(side * direction.z).toBeGreaterThan(0.25)
    expect(Math.abs(direction.x)).toBeGreaterThan(0.25)
    expect(Math.abs(direction.y)).toBeLessThan(1e-6)

    lead.angle = UPRIGHT
    art.poseHinge(cell.art, lead)
    lead.batches[0].mesh.getMatrixAt(0, matrix)
    expect(new Vector3(0, 1, 0).transformDirection(matrix).y).toBeCloseTo(1, 6)
  }
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

it('keeps prop cards in the +Z hemisphere with repeatable per-cell yaw', () => {
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
  for (const angle of angles) expect(Math.abs(angle)).toBeLessThan(Math.PI / 3)
  expect(new Set(angles).size).toBeGreaterThan(1)
  stream.dropRender()
  stream.update(0, 1, origin, 16 / 9)
  expect(sampleYaw()).toEqual(angles)
})
