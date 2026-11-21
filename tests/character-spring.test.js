import { expect, test } from 'vitest'
import { createHairMotion } from '../src/character/hair-motion.js'
import { stepSpring } from '../src/lib/spring.js'

const stopped = { x: 0, z: 0 }
const forward = { x: 0, z: 1.2 }
const facing = { value: 0, velocity: 0 }
const bob = (time) => 0.03 * Math.sin(4 * Math.PI * time)

test('the runtime tip keeps bending over two seconds at constant walking speed', () => {
  const update = createHairMotion()
  const dt = 1 / 120
  const samples = Array.from({ length: 360 }, (_, frame) =>
    update(dt, forward, facing, bob(frame * dt), false).pitch).slice(120)
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length
  expect(variance).toBeGreaterThan(0.001)
})

test.each([60, 120])('a stop swings past rest, recoils once, and settles by 0.4 s at %d fps', (fps) => {
  const dt = 1 / fps
  const update = createHairMotion()
  for (let frame = 0; frame < fps; frame += 1) {
    update(dt, forward, facing, bob(frame * dt + (fps === 60 ? 0.125 : 0.375)), false)
  }

  const samples = []
  for (let frame = 0; frame < 0.4 * fps; frame += 1) {
    samples.push(update(dt, stopped, facing, 0, false).pitch)
  }
  const crest = Math.max(...samples)
  const crestTime = (samples.indexOf(crest) + 1) / fps
  expect(crestTime).toBeGreaterThan(0.05)
  expect(crestTime).toBeLessThan(0.15)
  expect(crest).toBeGreaterThan(0.2)
  expect(crest).toBeLessThan(0.35)
  expect(samples[0]).toBeLessThan(crest)
  expect(Math.min(...samples)).toBeLessThan(-0.02)
  expect(Math.min(...samples)).toBeGreaterThan(-crest / 3)
  expect(samples.filter((sample, index) => sample < 0 && samples[index - 1] >= 0)).toHaveLength(1)
  expect(samples.at(-1)).toBe(0)
})

test.each([0.1, 0.5])('tip yaw follows the head through %f of a 90° walking turn', (fraction) => {
  const update = createHairMotion()
  const dt = 1 / 120
  const head = { ...facing }
  for (let frame = 0; frame < 120; frame += 1) update(dt, forward, head, 0, false)

  const angle = fraction * Math.PI / 2
  let headCrossing
  let tipCrossing
  for (let frame = 0; frame < 120; frame += 1) {
    stepSpring(head, Math.PI / 2, dt, 32, 1)
    const { yaw } = update(dt, { x: 1.2, z: 0 }, head, 0, false)
    if (head.value >= angle) headCrossing ??= frame * dt
    if (head.value + yaw >= angle) tipCrossing ??= frame * dt
  }
  expect(tipCrossing - headCrossing).toBeGreaterThanOrEqual(0.08)
  expect(tipCrossing - headCrossing).toBeLessThanOrEqual(0.12)
})

test('travel direction changes bend the hair and dance suppresses the springs', () => {
  const update = createHairMotion()
  expect(update(0.08, forward, facing, 0, false).pitch).toBeLessThan(0)
  const turn = update(0.08, { x: 1.2, z: 0 }, facing, 0, false)
  expect(turn.roll).toBeGreaterThan(0)
  expect(update(0.08, stopped, facing, 0, true)).toEqual({ pitch: 0, roll: 0, yaw: 0 })
  expect(update(0.08, stopped, facing, 0, false)).toEqual({ pitch: 0, roll: 0, yaw: 0 })
})

test('rapid reversals keep the runtime bend bounded', () => {
  const update = createHairMotion()
  for (let frame = 0; frame < 120; frame += 1) {
    const speed = (frame % 8 < 4 ? 1 : -1) * 1.2
    const { pitch, roll } = update(1 / 120, { x: speed, z: 0 }, facing, 0, false)
    expect(Math.hypot(pitch, roll)).toBeLessThanOrEqual(0.35)
  }
})

test('critical damping approaches the target without overshooting', () => {
  const spring = { value: 0, velocity: 0 }
  stepSpring(spring, 1, 0.12, 32, 1)
  expect(spring.value).toBeGreaterThan(0.89)
  expect(spring.value).toBeLessThan(1)
  stepSpring(spring, 1, 0.5, 32, 1)
  expect(spring.value).toBeLessThanOrEqual(1)
  expect(spring.value).toBeCloseTo(1, 4)
})
