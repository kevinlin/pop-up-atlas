import { expect, test } from 'vitest'
import { perfMisses } from './perf-contract.mjs'

const atLimit = {
  dpr: 1,
  median: 16.7,
  p95: 18,
  p99: 25,
  pct_over_20ms: 2,
  frames_over_50ms: 0,
  chunks_crossed: 6,
  load_ms: 461,
}

test('perf accepts exact limits at both DPRs', () => {
  expect(perfMisses(atLimit)).toEqual([])
  expect(perfMisses({ ...atLimit, dpr: 2, load_ms: 428 })).toEqual([])
})

test('perf identifies every missed limit at DPR 2 before rounding', () => {
  const misses = perfMisses({
    dpr: 2,
    median: 16.7001,
    p95: 18.0001,
    p99: 25.0001,
    pct_over_20ms: 2.0001,
    frames_over_50ms: 1,
    chunks_crossed: 5,
    load_ms: 429,
  })
  expect(misses).toEqual([
    'median = 16.7001 (must be <= 16.7)',
    'p95 = 18.0001 (must be <= 18)',
    'p99 = 25.0001 (must be <= 25)',
    'pct_over_20ms = 2.0001 (must be <= 2)',
    'frames_over_50ms = 1 (must be <= 0)',
    'load_ms = 429 (must be <= 428)',
    'chunks_crossed = 5 (must be >= 6)',
  ])
})
