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

// Round 6 (docs/contracts.md "Performance"): p95 <= the PB6 baseline (fa6d96b, same host, route and DPR) + 1.5 ms at DPR 1 and 2.
export const pb6Margin = 1.5
export const pb6Revision = 'fa6d96b'

// `baseline` is a perf JSON (the PB6 run); its run at the same DPR is the reference. The comparison is recorded in the
// result whether or not a baseline exists: without one, `pass` is null (not judged) and no miss is raised.
export function pb6Comparison(run, baseline) {
  const reference = baseline?.runs?.find(({ dpr }) => dpr === run.dpr)
  const base = { revision: pb6Revision, margin_ms: pb6Margin, baseline_p95: reference?.p95 ?? null, p95: run.p95 ?? null }
  if (!Number.isFinite(reference?.p95) || !Number.isFinite(run.p95)) {
    return { ...base, delta_ms: null, limit_ms: null, pass: null }
  }
  const limit = reference.p95 + pb6Margin
  return { ...base, delta_ms: run.p95 - reference.p95, limit_ms: limit, pass: run.p95 <= limit }
}

export function pb6Misses(comparison) {
  if (comparison?.pass !== false) return []
  return [`p95 = ${comparison.p95} (must be <= PB6 baseline ${comparison.baseline_p95} + ${pb6Margin} = ${comparison.limit_ms}, ${pb6Revision})`]
}

// The flag set the page runs with: the URL's own `effects` and `lookOff` values, else the shipped defaults. `lookOff` also
// lists which look layers that leaves on (`lookLayers`, the names in `names` minus the list); `effects` lists the stage
// effect numbers. Both are recorded in the perf JSON so a result can be tied to the flags it measured.
export function effectiveFlags(search, { defaultEffects, defaultLookOff, lookNames }) {
  const params = new URLSearchParams(search)
  const effects = params.get('effects') ?? defaultEffects
  const lookOff = params.get('lookOff') ?? defaultLookOff
  const off = new Set(lookOff.split(','))
  return {
    effects,
    lookOff,
    custom: { effects: params.has('effects'), lookOff: params.has('lookOff') },
    effectsOn: effects.split(',').filter(Boolean),
    lookOn: lookNames.filter((name) => !off.has(name)),
    lookOffList: lookNames.filter((name) => off.has(name)),
    plain: params.has('plain'),
  }
}
