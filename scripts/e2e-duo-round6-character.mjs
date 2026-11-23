// Character checks for round 6 (docs/contracts.md "Round 6" → Characters, Face and secondary motion): R6-CHR-01..07. Pure analysis of
// the probe samples (`face`, `umbrella`, states, `leader`) and the recorder's events and per-frame squash and look flags.
// Every expected value below is the contract's, written out here; none is read from the game's source.
import { skipsOnStart } from '../src/character/animation.js'
import { distance, fps, frame, r3 } from './e2e-duo-round6-common.mjs'

export const characterNumbers = {
  // Mouth atlas cell order (row-major, top left): smile, open_smile, o, flat, frown, sing, ee, grin.
  cells: { smile: 0, open_smile: 1, o: 2, flat: 3, frown: 4, sing: 5, ee: 6, grin: 7 },
  rest: { a: 0, b: 3 },
  mouthHoldSeconds: 0.1,
  // cue word -> cell; "sing" (any sing_*) -> 5; "giggle" alternates open_smile / grin at 8 Hz.
  words: { ooh: 2, eep: 2, hmph: 4, hm: 3, hup: 6, whee: 1, lead: 1 },
  // 8 Hz alternation read either as 8 cycles or 8 toggles a second.
  giggleTogglesPerSecond: [7, 17],
  blinkInterval: [2.5, 5.5],
  blinkSeconds: 0.15,
  restClosure: { a: 0, b: 0.35 },
  squash: { contact: 0.95, landing: 0.88, takeoff: 1.1, tolerance: 0.012, landingMarker: 1.67, restTolerance: 0.004, restAfterSeconds: 0.8 },
  umbrella: { openSeconds: 1.2, gapSeconds: 3, bow: 2.19, slackFrames: 3 },
  look: { standingSeconds: 2, seconds: 0.6 },
  skip: { cycles: 2, seconds: 1 },
}
const N = characterNumbers
const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance
const ids = ['R6-CHR-01', 'R6-CHR-02', 'R6-CHR-03', 'R6-CHR-04', 'R6-CHR-05', 'R6-CHR-06', 'R6-CHR-07']

export function parseCue(name) {
  const match = /^(b_)?(voice|sing)_([a-z_]+)$/.exec(name)
  if (!match) return null
  const [, prefix, kind, word] = match
  const bank = prefix ? 'b' : 'a'
  if (kind === 'sing') return { bank, word: 'sing', cell: N.cells.sing }
  if (word === 'giggle') return { bank, word, cell: 'giggle' }
  return word in N.words ? { bank, word, cell: N.words[word] } : null
}
const bankId = (bank) => (bank === 'a' ? 'R6-CHR-01' : 'R6-CHR-02')

// ---- R6-CHR-01 / 02 mouth -----------------------------------------------------------------------------------------

function analyzeMouth(x, out, pool) {
  if (x.trace.some((s) => !s.face)) {
    for (const id of ['R6-CHR-01', 'R6-CHR-02']) out.problem(id, x.where, 'window.__atlas.face is missing from the probe sample')
    return
  }
  const swaps = x.ofType('swap').map(({ f }) => f)
  const cues = (x.result.cueLog ?? []).map((cue) => ({ ...cue, parsed: parseCue(cue.cue) })).filter(({ parsed, who }) => parsed && who)
  const hold = N.mouthHoldSeconds
  const report = { checked: { a: 0, b: 0 }, wrong: { a: 0, b: 0 }, words: { a: [], b: [] } }
  const examples = []
  const giggles = new Map()
  for (const who of ['a', 'b']) {
    const mine = cues.filter((cue) => cue.who === who)
    for (const s of x.trace) {
      const now = s.f / fps
      if (swaps.some((f) => Math.abs(f - s.f) <= 2)) continue
      // The frames at a boundary (cue start, end + hold) may land on either side of it.
      if (mine.some((cue) => Math.abs(now - cue.t) < 1.5 * frame || Math.abs(now - (cue.end + hold)) < 1.5 * frame)) continue
      const active = s.leader === who ? mine.filter((cue) => cue.t <= now && now < cue.end + hold).at(-1) : undefined
      const bank = active?.parsed.bank ?? who
      const actual = s.face[who].cell
      const expected = active ? active.parsed.cell : N.rest[who]
      const ok = expected === 'giggle' ? actual === N.cells.open_smile || actual === N.cells.grin : actual === expected
      report.checked[bank] += 1
      if (!ok) {
        report.wrong[bank] += 1
        if (examples.length < 6) examples.push({ id: bankId(bank), text: `frame ${s.f}: ${who} ${active ? active.cue : 'at rest'} expected cell ${expected}, shows ${actual}` })
      }
      if (active) {
        if (ok && !report.words[bank].includes(active.parsed.word)) report.words[bank].push(active.parsed.word)
        if (active.parsed.cell === 'giggle') {
          const entry = giggles.get(active) ?? { frames: 0, toggles: 0, last: actual }
          entry.toggles += Number(actual !== entry.last)
          entry.last = actual
          entry.frames += 1
          giggles.set(active, entry)
        }
      }
    }
  }
  for (const [cue, { frames, toggles }] of giggles) {
    if (frames < 0.4 * fps) continue
    const rate = toggles / (frames / fps)
    if (rate < N.giggleTogglesPerSecond[0] || rate > N.giggleTogglesPerSecond[1]) {
      out.problem(bankId(cue.parsed.bank), x.where, `${cue.cue} at ${r3(cue.t)} s alternated ${r3(rate)} times a second, expected ${N.giggleTogglesPerSecond.join('-')}`)
    }
  }
  for (const bank of ['a', 'b']) {
    for (const word of report.words[bank]) if (!pool.words[bank].includes(word)) pool.words[bank].push(word)
    pool.checked[bank] += report.checked[bank]
    out.measure(bankId(bank), x.where, { framesChecked: report.checked[bank], wrong: report.wrong[bank], words: report.words[bank] })
  }
  for (const { id, text } of examples) out.problem(id, x.where, text)
  for (const bank of ['a', 'b']) {
    if (report.wrong[bank] > examples.filter(({ id }) => id === bankId(bank)).length) {
      out.problem(bankId(bank), x.where, `${report.wrong[bank]} frames with the wrong mouth cell in all`)
    }
  }
}

// ---- R6-CHR-03 blinks ---------------------------------------------------------------------------------------------

function analyzeBlink(x, out, pool) {
  if (x.trace.some((s) => !s.face)) return out.problem('R6-CHR-03', x.where, 'window.__atlas.face is missing from the probe sample')
  const summary = {}
  for (const who of ['a', 'b']) {
    const rest = N.restClosure[who]
    const lids = x.trace.map((s) => s.face[who].lid)
    const blinking = lids.map((lid) => lid > rest + 0.02)
    const runs = []
    for (const [k, on] of blinking.entries()) {
      if (!on) continue
      if (runs.length && runs.at(-1).endK === k - 1) runs.at(-1).endK = k
      else runs.push({ startK: k, endK: k })
    }
    const near2 = new Set()
    for (const { startK, endK } of runs) for (let k = startK - 2; k <= endK + 2; k++) near2.add(k)
    const offRest = lids.map((lid, k) => (near2.has(k) || near(lid, rest, 0.005) ? null : { f: x.trace[k].f, lid })).filter(Boolean)
    if (offRest.length) out.problem('R6-CHR-03', x.where, `${who.toUpperCase()}: ${offRest.length} frames between blinks with the lid at ${r3(offRest[0].lid)} instead of ${rest} (first at frame ${offRest[0].f})`)
    const primaries = []
    let doubled = 0
    for (const [n, run] of runs.entries()) {
      const peak = Math.max(...lids.slice(run.startK, run.endK + 1))
      const length = run.endK - run.startK + 1
      const at = `${who.toUpperCase()} blink at frame ${x.trace[run.startK].f}`
      const edge = run.startK === 0 || run.endK === lids.length - 1
      if (!edge && (length < 5 || length > 11)) out.problem('R6-CHR-03', x.where, `${at} closed for ${length} frames, expected about ${N.blinkSeconds * fps}`)
      if (!edge && peak < 0.9) out.problem('R6-CHR-03', x.where, `${at} peaked at ${r3(peak)}, a blink closes the lid`)
      const t = x.trace[run.startK].f / fps
      if (n && t - primaries.at(-1) <= 0.4) doubled += 1
      else primaries.push(t)
    }
    const intervals = primaries.slice(1).map((t, n) => t - primaries[n])
    for (const interval of intervals) {
      if (interval < N.blinkInterval[0] - 0.03 || interval > N.blinkInterval[1] + 0.03) {
        out.problem('R6-CHR-03', x.where, `${who.toUpperCase()}: blinks ${r3(interval)} s apart, expected ${N.blinkInterval.join('-')} s`)
      }
    }
    pool.blinkIntervals[who] += intervals.length
    summary[who] = { blinks: primaries.length, doubled, intervals: intervals.length, min: r3(Math.min(...intervals)), max: r3(Math.max(...intervals)) }
  }
  out.measure('R6-CHR-03', x.where, summary)
}

// ---- R6-CHR-04 squash ------------------------------------------------------------------------------------------------

function analyzeSquash(x, out, pool) {
  const S = N.squash
  const column = { a: 2, b: 3 }
  const columnX = { a: 4, b: 5 }
  const sy = (who, f) => x.frames[f]?.[column[who]]
  const sx = (who, f) => x.frames[f]?.[columnX[who]]
  if (!Object.keys(x.frames).length) return out.problem('R6-CHR-04', x.where, 'the recorder has no per-frame squash samples')
  const danceEnds = x.ofType('dance-end')
  const triggers = []
  for (const { type, f, detail } of x.events) {
    if (type === 'contact') triggers.push({ who: detail.who, f, kind: 'contact', value: S.contact })
    else if (type === 'hop') triggers.push({ who: detail.who, f, kind: detail.phase === 'land' ? 'hop land' : 'hop take-off', value: detail.phase === 'land' ? S.landing : S.takeoff })
    else if (type === 'dance-start') {
      const f1 = Math.round((detail.t + S.landingMarker) * fps)
      const interrupted = danceEnds.some((end) => end.detail.who === detail.who && end.f >= f && end.f <= f1 + 4)
      if (!interrupted) triggers.push({ who: detail.who, f: f1, kind: 'dance landing', value: S.landing, window: 4 })
    }
  }
  const counted = {}
  const swaps = x.ofType('swap').map(({ f }) => f)
  for (const trigger of triggers) {
    const { who, f, kind, value } = trigger
    const mine = triggers.filter((other) => other !== trigger && other.who === who)
    if (mine.some((other) => Math.abs(other.value - 1) > Math.abs(value - 1) && other.f >= f - 3 && other.f <= f + 8)) continue
    const window = trigger.window ?? 0
    const lo = f - window
    const hi = f + window + 1
    const values = []
    for (let k = lo; k <= hi; k++) if (sy(who, k) !== undefined) values.push([k, sy(who, k)])
    if (values.length < 2 || swaps.some((s) => Math.abs(s - f) <= 1 && kind === 'contact')) continue
    const [k, extreme] = values.reduce((best, pair) => (value < 1 ? (pair[1] < best[1] ? pair : best) : (pair[1] > best[1] ? pair : best)))
    counted[kind] = (counted[kind] ?? 0) + 1
    if (!near(extreme, value, S.tolerance)) {
      out.problem('R6-CHR-04', x.where, `${who.toUpperCase()} ${kind} at frame ${f}: scale.y ${r3(extreme)}, expected ${value} ± ${S.tolerance}`)
    }
    const side = sx(who, k)
    if (side !== undefined && !near(side, 1 / Math.sqrt(extreme), 0.01)) {
      out.problem('R6-CHR-04', x.where, `${who.toUpperCase()} ${kind} at frame ${f}: scale.x ${r3(side)} with scale.y ${r3(extreme)}, expected 1/√sy = ${r3(1 / Math.sqrt(extreme))}`)
    }
    if (kind === 'dance landing') (pool.landingOffsets ??= []).push(k - f)
  }
  // Settled: at rest the scale is 1.
  const restAfter = Math.round(S.restAfterSeconds * fps)
  let rested = 0
  for (const who of ['a', 'b']) {
    const marks = triggers.filter((trigger) => trigger.who === who).map(({ f }) => f)
    for (const s of x.trace) {
      if (s.f < x.first + 5 || marks.some((f) => f <= s.f + 1 && s.f - f < restAfter)) continue
      const value = sy(who, s.f)
      if (value === undefined) continue
      rested += 1
      if (!near(value, 1, S.restTolerance)) {
        out.problem('R6-CHR-04', x.where, `${who.toUpperCase()} scale.y ${r3(value)} at frame ${s.f}, 0.8 s after its last trigger; it springs back to 1`)
        break
      }
    }
  }
  for (const [kind, count] of Object.entries(counted)) pool.squash[kind] = (pool.squash[kind] ?? 0) + count
  out.measure('R6-CHR-04', x.where, { ...counted, restFrames: rested })
}

// ---- R6-CHR-05 umbrella -----------------------------------------------------------------------------------------------

function analyzeUmbrella(x, out, pool) {
  const U = N.umbrella
  if (x.trace.some((s) => !s.umbrella)) return out.problem('R6-CHR-05', x.where, 'window.__atlas.umbrella is missing from the probe sample')
  const last = x.first + x.trace.length - 1
  const edges = []
  for (const [k, s] of x.trace.entries()) {
    if (s.umbrella.open && (k === 0 ? false : !x.trace[k - 1].umbrella.open)) edges.push(s.f)
  }
  const closes = (f) => {
    let k = f - x.first
    while (k < x.trace.length && x.trace[k].umbrella.open) k += 1
    return k < x.trace.length ? x.trace[k].f : null
  }
  // What the contract opens it for, from the events (a river collision with B leading; B's bow).
  const expected = []
  let lastCollision = -Infinity
  for (const bump of x.ofType('bump')) {
    if (bump.detail.who !== 'b' || bump.detail.reason !== 'river') continue
    if (bump.detail.t - lastCollision < U.gapSeconds - 1e-6) continue
    lastCollision = bump.detail.t
    expected.push({ f: bump.f, why: 'river collision', endF: bump.f + Math.round(U.openSeconds * fps) })
  }
  for (const start of x.ofType('dance-start')) {
    if (start.detail.who !== 'b') continue
    const end = x.ofType('dance-end').find((candidate) => candidate.detail.who === 'b' && candidate.f >= start.f)
    const bowF = Math.round((start.detail.t + U.bow) * fps)
    if (end && end.f < bowF - 2) continue
    expected.push({ f: bowF, why: 'dance bow', endF: Math.min(bowF + Math.round(U.openSeconds * fps), end?.f ?? Infinity) })
  }
  const slack = U.slackFrames
  const claimed = new Set()
  let verified = 0
  for (const want of expected) {
    if (want.f + Math.round(U.openSeconds * fps) + 4 > last) continue
    const edge = edges.find((f) => Math.abs(f - want.f) <= slack)
    if (edge === undefined) {
      out.problem('R6-CHR-05', x.where, `no umbrella pop at frame ${want.f} (${want.why})`)
      continue
    }
    claimed.add(edge)
    const closed = closes(edge)
    const crowded = edges.some((f) => f !== edge && f > edge && f < want.endF + 8)
    if (!crowded) {
      if (closed === null || !near(closed, want.endF, slack + 1)) {
        out.problem('R6-CHR-05', x.where, `umbrella popped at frame ${edge} (${want.why}) and closed at ${closed ?? 'never'}, expected about frame ${want.endF} (${U.openSeconds} s later${want.why === 'dance bow' ? ' or at the dance end' : ''})`)
      }
    }
    verified += 1
    pool.umbrella[want.why] = (pool.umbrella[want.why] ?? 0) + 1
  }
  for (const edge of edges) {
    if (!claimed.has(edge) && !expected.some((want) => Math.abs(want.f - edge) <= slack)) {
      out.problem('R6-CHR-05', x.where, `the umbrella opened at frame ${edge} with no river collision of B leading and no dance bow`)
    }
  }
  // A river collision with A leading never opens it (A has no umbrella; the rig's own `who` decides).
  out.measure('R6-CHR-05', x.where, { pops: edges.length, expected: expected.length, verified })
}

// ---- R6-CHR-06 skip keeps the state walk --------------------------------------------------------------------------

function analyzeSkip(x, out, pool) {
  const states = new Set(x.trace.flatMap((s) => [s.L.state, s.F.state]))
  if (states.has('skip')) out.problem('R6-CHR-06', x.where, `a character reported the state "skip" (states seen: ${[...states].join(', ')})`)
  const seed = x.result.plan?.seed
  if (seed === undefined) return
  // The leader's first walk start after standing: troll A leads from the start, so this is walk start 0.
  const k0 = x.trace.findIndex((s) => s.L.state !== 'idle')
  const standing = k0 >= Math.round(N.skip.seconds * fps) && x.trace.slice(0, k0).every((s) => s.leader === 'a')
  const expectSkip = skipsOnStart(seed, 0)
  if (k0 < 0 || !standing || x.trace[k0].L.state !== 'walk') {
    return out.measure('R6-CHR-06', x.where, { note: 'no walk start after 1 s of standing', expectSkip })
  }
  const end = k0 + Math.round(N.skip.cycles * N.skip.seconds * fps)
  const stray = []
  for (let k = k0; k < Math.min(end, x.trace.length); k++) {
    const s = x.trace[k]
    if (!s.held.length || s.blockedBy) break
    if (s.L.state !== 'walk' && !x.ofType('swap').some(({ f }) => Math.abs(f - s.f) <= 1)) stray.push(s)
  }
  out.measure('R6-CHR-06', x.where, { seed, firstWalkStartFrame: x.trace[k0].f, skipByHash: expectSkip, framesInSkipWindow: end - k0, stray: stray.length })
  if (stray.length) out.problem('R6-CHR-06', x.where, `${stray.length} frames in the first 2 s of walking with the state ${stray[0].L.state} (frame ${stray[0].f}); a skip plays under the state walk`)
  if (expectSkip) pool.skipWalks += 1
}

// ---- R6-CHR-07 B look ---------------------------------------------------------------------------------------------------

function analyzeLook(x, out, pool, look) {
  const L = N.look
  const seconds = look ?? L.seconds
  const flags = x.trace.map((s) => x.frames[s.f]?.[0] ?? 0)
  if (!Object.keys(x.frames).length) return out.problem('R6-CHR-07', x.where, 'the recorder has no per-frame look flags')
  const runs = []
  for (const [k, flag] of flags.entries()) {
    if (!flag) continue
    if (runs.length && runs.at(-1).endK === k - 1) runs.at(-1).endK = k
    else runs.push({ startK: k, endK: k })
  }
  const swaps = x.ofType('swap').map(({ f }) => f)
  const last = x.trace.length - 1
  const summary = []
  for (const { startK, endK } of runs) {
    const length = endK - startK + 1
    const slice = x.trace.slice(startK, endK + 1)
    const at = `look at frame ${slice[0].f}`
    const wasLeader = slice.filter((s) => s.leader === 'b')
    if (wasLeader.length) out.problem('R6-CHR-07', x.where, `${at}: B played the look while leading (${wasLeader.length} frames); the look is the follower's`)
    const moved = slice.some((s) => distance(s.F, slice[0].F) > 0.01)
    if (moved || slice.some((s) => s.F.state !== 'idle')) out.problem('R6-CHR-07', x.where, `${at}: the follower did not hold still and idle for the whole look`)
    if (startK >= L.standingSeconds * fps) {
      const before = x.trace.slice(startK - L.standingSeconds * fps, startK)
      const stood = before.every((s) => (s.F.state === 'idle' || s.F.state === 'dance') && distance(s.F, before[0].F) < 0.05)
      const reset = swaps.some((f) => f >= before[0].f && f <= slice[0].f)
      if (!stood || reset) out.problem('R6-CHR-07', x.where, `${at}: the follower had not stood for ${L.standingSeconds} s before it`)
    }
    const swap = swaps.find((f) => f >= slice.at(-1).f && f <= slice.at(-1).f + 2)
    const interrupted = x.events.some((event) => ['swap', 'hop', 'dance-start'].includes(event.type) && event.f >= slice.at(-1).f - 1 && event.f <= slice.at(-1).f + 3)
    if (endK === last) continue
    if (swap !== undefined) {
      pool.looksInterrupted += 1
      if (length >= seconds * fps - 3) out.problem('R6-CHR-07', x.where, `${at}: a swap at frame ${swap} should cut the look short, but it ran ${length} frames`)
    } else if (!interrupted) {
      pool.looksComplete += 1
      if (!near(length, seconds * fps, 3)) out.problem('R6-CHR-07', x.where, `${at}: lasted ${length} frames (${r3(length / fps)} s), expected ${seconds} s`)
      if (x.trace[Math.min(last, endK + 4)].F.state !== 'walk') out.problem('R6-CHR-07', x.where, `${at}: the follower did not set off when the look ended`)
    }
    summary.push({ frame: slice[0].f, frames: length, swap: swap ?? null })
  }
  out.measure('R6-CHR-07', x.where, { looks: summary })
}

// ---- entry points ----------------------------------------------------------------------------------------------------

export const newCharacterPool = () => ({
  words: { a: [], b: [] }, checked: { a: 0, b: 0 }, blinkIntervals: { a: 0, b: 0 }, squash: {}, umbrella: {}, skipWalks: 0,
  looksComplete: 0, looksInterrupted: 0,
})

export function analyzeCharacters(x, out, pool, { look } = {}) {
  const step = (fn, list, ...rest) => {
    try {
      fn(x, out, pool, ...rest)
    } catch (error) {
      for (const id of list) out.problem(id, x.where, `analysis ${fn.name} failed: ${String(error?.message ?? error).split('\n')[0]}`)
    }
  }
  step(analyzeMouth, ['R6-CHR-01', 'R6-CHR-02'])
  if (x.trace.length >= 20 * fps) step(analyzeBlink, ['R6-CHR-03'])
  step(analyzeSquash, ['R6-CHR-04'])
  step(analyzeUmbrella, ['R6-CHR-05'])
  step(analyzeSkip, ['R6-CHR-06'])
  step(analyzeLook, ['R6-CHR-07'], look)
}

// What the whole run has to have shown, and what the rig files have to carry for it to be possible.
export function finishCharacters(pool, out, ctx) {
  for (const bank of ['a', 'b']) {
    if (pool.words[bank].length < 3) out.problem(bankId(bank), '', `only ${pool.words[bank].length} cue words with a correct mouth in all routes (${pool.words[bank].join(', ') || 'none'}), need 3`)
  }
  for (const who of ['a', 'b']) {
    if (pool.blinkIntervals[who] < 3) out.problem('R6-CHR-03', '', `only ${pool.blinkIntervals[who]} blink intervals of ${who.toUpperCase()} in all routes, need 3`)
  }
  const squash = pool.squash
  for (const [kind, least] of [['contact', 10], ['dance landing', 1], ['hop take-off', 1], ['hop land', 1]]) {
    if ((squash[kind] ?? 0) < least) out.problem('R6-CHR-04', '', `only ${squash[kind] ?? 0} checked ${kind} triggers in all routes, need ${least}`)
  }
  for (const why of ['river collision', 'dance bow']) {
    if (!pool.umbrella[why]) out.problem('R6-CHR-05', '', `no umbrella pop for a ${why} was observed`)
  }
  if (!pool.skipWalks) out.problem('R6-CHR-06', '', 'no route started its first walk on a skip (by the seed hash) after 1 s of standing')
  if (ctx?.clips && !ctx.clips.a?.skip) out.problem('R6-CHR-06', 'public/models/troll.glb', 'the rig has no skip clip, so nothing can play under the state walk')
  if (!pool.looksComplete) out.problem('R6-CHR-07', '', 'no complete B look was observed')
  if (!pool.looksInterrupted) out.problem('R6-CHR-07', '', 'no B look was interrupted by a swap')
  if (ctx?.clips && !ctx.clips.b?.look) out.problem('R6-CHR-07', 'public/models/troll_b.glb', 'the rig has no look clip')
}
