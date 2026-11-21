const limits = {
  median: 16.7,
  p95: 18,
  p99: 25,
  pct_over_20ms: 2,
  frames_over_50ms: 0,
}

export function perfMisses(run) {
  const misses = []
  const upperLimits = { ...limits, load_ms: { 1: 461, 2: 428 }[run.dpr] }
  for (const [metric, limit] of Object.entries(upperLimits)) {
    if (!Number.isFinite(run[metric]) || !(run[metric] <= limit)) {
      misses.push(`${metric} = ${run[metric]} (must be <= ${limit})`)
    }
  }
  if (!Number.isFinite(run.chunks_crossed) || run.chunks_crossed < 6) {
    misses.push(`chunks_crossed = ${run.chunks_crossed} (must be >= 6)`)
  }
  return misses
}
