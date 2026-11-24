import { expect, test } from 'vitest'
import { DEFAULT_EFFECTS } from '../src/effects/flags.js'
import { DEFAULT_LOOK_OFF, look } from '../src/materials/stage-look.js'
import { effectiveFlags, pb6Comparison, pb6Margin, pb6Misses, perfMisses } from '../scripts/perf-contract.mjs'

const baseline = { url: 'http://localhost:4180/?look-shots=&seed=112', runs: [{ dpr: 1, p95: 9.7 }, { dpr: 2, p95: 9.6 }] }

test('PB6 comparison: p95 within the baseline plus 1.5 ms passes at each DPR', () => {
  expect(pb6Margin).toBe(1.5)
  expect(pb6Comparison({ dpr: 1, p95: 11.2 }, baseline)).toMatchObject({
    revision: 'fa6d96b', baseline_p95: 9.7, p95: 11.2, limit_ms: 11.2, pass: true,
  })
  expect(pb6Comparison({ dpr: 2, p95: 9.2 }, baseline)).toMatchObject({ baseline_p95: 9.6, pass: true })
  expect(pb6Comparison({ dpr: 2, p95: 9.2 }, baseline).delta_ms).toBeCloseTo(-0.4)
})

test('PB6 comparison: a p95 over the limit fails with a miss that names the baseline', () => {
  const over = pb6Comparison({ dpr: 1, p95: 11.2001 }, baseline)
  expect(over.pass).toBe(false)
  expect(pb6Misses(over)).toEqual(['p95 = 11.2001 (must be <= PB6 baseline 9.7 + 1.5 = 11.2, fa6d96b)'])
  // The other DPR's baseline is not used.
  expect(pb6Comparison({ dpr: 2, p95: 11.2 }, baseline).pass).toBe(false)
})

test('PB6 comparison without a baseline (or its DPR) is recorded as not judged and raises no miss', () => {
  for (const missing of [null, undefined, { runs: [] }, { runs: [{ dpr: 2, p95: 9 }] }]) {
    const comparison = pb6Comparison({ dpr: 1, p95: 20 }, missing)
    expect(comparison).toMatchObject({ pass: null, baseline_p95: null, p95: 20, limit_ms: null })
    expect(pb6Misses(comparison)).toEqual([])
  }
  expect(pb6Comparison({ dpr: 1, p95: Number.NaN }, baseline).pass).toBeNull()
})

test('the PB6 comparison is added to the existing limits, not instead of them', () => {
  const run = { dpr: 1, median: 8, p95: 9.7, p99: 10, pct_over_20ms: 0, frames_over_50ms: 0, chunks_crossed: 6, load_ms: 400 }
  expect(perfMisses(run)).toEqual([])
  expect(perfMisses({ ...run, p95: 18.5 })).toEqual(['p95 = 18.5 (must be <= 18)'])
})

test('the recorded flag set is the URL\'s own, else the shipped defaults', () => {
  const defaults = { defaultEffects: DEFAULT_EFFECTS, defaultLookOff: DEFAULT_LOOK_OFF, lookNames: Object.keys(look) }
  const shipped = effectiveFlags('?look-shots=&seed=112', defaults)
  expect(shipped).toMatchObject({
    effects: '10,11,13', effectsOn: ['10', '11', '13'], lookOff: DEFAULT_LOOK_OFF, custom: { effects: false, lookOff: false }, plain: false,
  })
  // Shipped look: bloom and the round-6 rim are on; grade, backlight, bounce, zones, haze, backdrop and dapple are off.
  expect(shipped.lookOn.sort()).toEqual(['bloom', 'rim'])
  expect(shipped.lookOffList.sort()).toEqual(['backdrop', 'backlight', 'bounce', 'dapple', 'grade', 'haze', 'zones'])
  const custom = effectiveFlags('?effects=5,7,10,11,13&lookOff=', defaults)
  expect(custom.custom).toEqual({ effects: true, lookOff: true })
  expect(custom.effectsOn).toEqual(['5', '7', '10', '11', '13'])
  expect(custom.lookOn.sort()).toEqual([...Object.keys(look)].sort())
  expect(effectiveFlags('?plain', defaults).plain).toBe(true)
})
