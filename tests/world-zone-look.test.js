import { expect, test } from 'vitest'
import { createLayout, zoneBlendAt, zoneKeyAt, zoneSeedFor, ZONE_KEYS } from '../src/world/layout.js'

test('zone keys are deterministic across chunk seams and layout reseeds', () => {
  const layout = createLayout(42)
  const samples = Array.from({ length: 64 }, (_, i) => [i - 32, -2])
  const keys = samples.map(([i, j]) => layout.zoneKeyAt(i, j))
  expect(keys.every((key) => ZONE_KEYS.includes(key))).toBe(true)
  expect(keys).toEqual(samples.map(([i, j]) => zoneKeyAt(42, i, j)))
  for (let cx = 3; cx >= -4; cx--) layout.generateChunk(cx, -1)
  expect(samples.map(([i, j]) => layout.zoneKeyAt(i, j))).toEqual(keys)
  layout.setSeed(167)
  expect(zoneSeedFor(layout.isBlocked)).toBe(167)
  expect(samples.map(([i, j]) => layout.zoneKeyAt(i, j))).not.toEqual(keys)
  layout.setSeed(42)
  expect(samples.map(([i, j]) => layout.zoneKeyAt(i, j))).toEqual(keys)
})

test('the grade is continuous across cell and chunk seams and reaches each zone interior', () => {
  const seen = new Set()
  const sample = (x, z) => zoneBlendAt(42, x, z, [0, 0, 0, 0])
  for (let i = -64; i < 64; i++) {
    const weight = sample(i, -2)
    expect(weight.reduce((sum, n) => sum + n, 0)).toBeCloseTo(1)
    if (weight.includes(1)) seen.add(ZONE_KEYS[weight.indexOf(1)])
    const left = sample(i - 0.0001, -2)
    const right = sample(i + 0.0001, -2)
    expect(Math.max(...left.map((value, key) => Math.abs(value - right[key])))).toBeLessThan(0.001)
    const north = sample(-2, i - 0.0001)
    const south = sample(-2, i + 0.0001)
    expect(Math.max(...north.map((value, key) => Math.abs(value - south[key])))).toBeLessThan(0.001)
  }
  expect(seen.size).toBe(4)
})
