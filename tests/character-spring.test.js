import { expect, test } from 'vitest'
import { stepSpring } from '../src/lib/spring.js'

test('hair lags behind its target, overshoots a little, and settles', () => {
  const spring = { value: 0, velocity: 0 }
  const dt = 1 / 60
  const target = 0.14
  stepSpring(spring, target, dt, 14, 0.58)
  expect(spring.value).toBeGreaterThan(0)
  expect(spring.value).toBeLessThan(target / 4)

  let peak = spring.value
  for (let frame = 0; frame < 120; frame += 1) {
    stepSpring(spring, target, dt, 14, 0.58)
    peak = Math.max(peak, spring.value)
  }
  expect(peak).toBeGreaterThan(target)
  expect(peak).toBeLessThan(0.17)
  expect(spring.value).toBeCloseTo(target, 4)

  stepSpring(spring, 0, dt, 14, 0.58)
  expect(spring.value).toBeGreaterThan(target * 0.75)
  stepSpring(spring, 0, 2, 14, 0.58)
  expect(spring.value).toBeCloseTo(0, 4)
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
