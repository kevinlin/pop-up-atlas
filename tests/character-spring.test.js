import { expect, test } from 'vitest'
import { createHairMotion } from '../src/character/hair-motion.js'
import { stepSpring } from '../src/lib/spring.js'

const stopped = { x: 0, z: 0 }
const forward = { x: 0, z: 1.2 }

test.each([60, 120])('a stop crests, recoils once, and settles by 0.3 s at %d fps', (fps) => {
  const dt = 1 / fps
  const update = createHairMotion()
  for (let frame = 0; frame < fps; frame += 1) update(dt, forward, 0, false)
  expect(update(dt, forward, 0, false)).toEqual({ pitch: 0, roll: 0 })

  const samples = []
  for (let frame = 0; frame < 0.3 * fps; frame += 1) {
    samples.push(update(dt, stopped, 0, false).pitch)
  }
  const crest = Math.max(...samples)
  const crestTime = (samples.indexOf(crest) + 1) / fps
  expect(crestTime).toBeGreaterThanOrEqual(0.08)
  expect(crestTime).toBeLessThanOrEqual(0.12)
  expect(crest).toBeGreaterThan(0.13)
  expect(crest).toBeLessThan(0.3)
  expect(samples[0]).toBeLessThan(crest)
  expect(Math.min(...samples)).toBeLessThan(-0.02)
  expect(Math.min(...samples)).toBeGreaterThan(-crest / 3)
  expect(samples.filter((sample, index) => sample < 0 && samples[index - 1] >= 0)).toHaveLength(1)
  expect(samples.at(-1)).toBe(0)
})

test('travel direction changes bend the hair and dance suppresses the spring', () => {
  const update = createHairMotion()
  expect(update(0.08, forward, 0, false).pitch).toBeLessThan(0)
  const turn = update(0.08, { x: 1.2, z: 0 }, 0, false)
  expect(turn.roll).toBeGreaterThan(0)
  expect(update(0.08, stopped, 0, true)).toEqual({ pitch: 0, roll: 0 })
  expect(update(0.08, stopped, 0, false)).toEqual({ pitch: 0, roll: 0 })
})

test('rapid reversals keep the runtime bend bounded', () => {
  const update = createHairMotion()
  for (let frame = 0; frame < 120; frame += 1) {
    const speed = (frame % 8 < 4 ? 1 : -1) * 1.2
    const { pitch, roll } = update(1 / 120, { x: speed, z: 0 }, 0, false)
    expect(Math.hypot(pitch, roll)).toBeLessThanOrEqual(0.3)
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
