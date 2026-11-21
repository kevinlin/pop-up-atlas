import { expect, test } from 'vitest'
import { cellJitter } from '../src/materials/cell-jitter.js'

test('felt variation is stable by cell, bounded, and changes across the grid', () => {
  const samples = new Set()
  for (let i = -12; i <= 12; i += 1) {
    for (let j = -12; j <= 12; j += 1) {
      const jitter = cellJitter(i, j)
      expect(cellJitter(i, j)).toEqual(jitter)
      expect(Math.abs(jitter.hue)).toBeLessThanOrEqual(0.12)
      expect(jitter.value).toBeGreaterThanOrEqual(0.89)
      expect(jitter.value).toBeLessThanOrEqual(1.11)
      samples.add(JSON.stringify(jitter))
    }
  }
  expect(samples.size).toBeGreaterThan(600)
})
