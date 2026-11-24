// Audio checks for round 6 (docs/contracts.md "Round 6" → Characters, "Events"): R6-AUD-01 footsteps and R6-AUD-02 the hum's octave.
import { distance, fps, frame, median, r3 } from './e2e-duo-round6-common.mjs'

export const audioNumbers = {
  stepToleranceSeconds: 0.04,
  // Contacts are at clip time 0 and half the playing clip: A 0 / 0.5 s, B 0 / 0.4 s (defaults; the rig files give the real clip lengths).
  halfClip: { a: 0.5, b: 0.4 },
  humAbove: 78,
  octave: 12,
  eighth: 60 / 96 / 2,
  humDelaySeconds: 1.5,
  humToleranceSeconds: 0.05,
  pitchToleranceSemitones: 0.25,
  settleFrames: 2,
}
const A = audioNumbers

// ---- R6-AUD-01 footsteps ----------------------------------------------------------------------------------------

export function analyzeFootsteps(x, out, pool, ctx) {
  const half = { a: ctx?.clips?.a?.walk ? ctx.clips.a.walk / 2 : A.halfClip.a, b: ctx?.clips?.b?.walk ? ctx.clips.b.walk / 2 : A.halfClip.b }
  const tolerance = A.stepToleranceSeconds
  const contacts = x.ofType('contact').map(({ f, detail }) => ({ f, who: detail.who, foot: detail.foot, t: detail.t }))
  const steps = (x.result.cueLog ?? []).filter(({ kind }) => kind === 'step')
  const unlocked = x.result.marks?.find(({ type }) => type === 'unlock')?.f ?? x.first
  const swaps = x.ofType('swap').map(({ f }) => f)
  const nearSwap = (f) => swaps.some((swap) => Math.abs(swap - f) <= A.settleFrames)
  const leaderAt = (f) => x.at(f)?.leader
  const audible = (c) => c.f > unlocked + 2
  const leaderContacts = contacts.filter((c) => leaderAt(c.f) === c.who && audible(c) && !nearSwap(c.f))
  const problems = []
  const note = (text) => { if (problems.length < 8) problems.push(text) }

  // Every leader contact plays one step, every step has a leader contact, follower contacts are silent.
  for (const c of leaderContacts) {
    if (!steps.some((step) => Math.abs(step.t - c.t) <= tolerance)) note(`${c.who.toUpperCase()} (leading) contact ${c.foot} at ${r3(c.t)} s has no step within ${tolerance * 1000} ms`)
  }
  for (const step of steps) {
    const near = contacts.filter((c) => Math.abs(c.t - step.t) <= tolerance)
    if (!near.length) note(`${step.cue} at ${r3(step.t)} s has no foot contact within ${tolerance * 1000} ms`)
    else if (!near.some((c) => leaderAt(c.f) === c.who || nearSwap(c.f))) note(`${step.cue} at ${r3(step.t)} s answers a follower's contact (${near.map((c) => c.who).join()})`)
  }
  const followerContacts = contacts.filter((c) => leaderAt(c.f) !== c.who && audible(c) && !nearSwap(c.f))
  const loud = followerContacts.filter((c) => steps.some((step) => Math.abs(step.t - c.t) <= tolerance)
    && !leaderContacts.some((other) => Math.abs(other.t - c.t) <= tolerance))
  if (loud.length) note(`${loud.length} follower contacts played a step (first: ${loud[0].who.toUpperCase()} at ${r3(loud[0].t)} s)`)

  // Cadence: half a clip between contacts of one walking leader, alternating feet.
  const intervals = { a: [], b: [] }
  for (const who of ['a', 'b']) {
    const mine = leaderContacts.filter((c) => c.who === who)
    for (const [n, c] of mine.entries()) {
      const previous = mine[n - 1]
      if (!previous) continue
      const between = x.trace.filter(({ f }) => f >= previous.f && f <= c.f)
      const continuous = between.length && between.every((s) => s.L.state === 'walk' && s.leader === who && !s.blockedBy)
        && !x.result.marks?.some(({ type, f }) => type === 'teleport' && f >= previous.f && f <= c.f)
      if (!continuous || c.t - previous.t > 1) continue
      const dt = c.t - previous.t
      intervals[who].push(dt)
      if (Math.abs(dt - half[who]) > tolerance) note(`${who.toUpperCase()} contacts ${r3(dt)} s apart at ${r3(c.t)} s, expected ${r3(half[who])} s (half the walk clip)`)
      if (c.foot === previous.foot) note(`${who.toUpperCase()} contacts at ${r3(previous.t)} s and ${r3(c.t)} s are both the ${c.foot} foot`)
    }
  }
  // Clip time 0: the first contact after a walk starts is the left foot, when the walk starts.
  const starts = []
  for (let k = 3; k < x.trace.length; k++) {
    const s = x.trace[k]
    const before = x.trace[k - 1]
    if (s.L.state !== 'walk' || before.L.state === 'walk' || before.leader !== s.leader || s.leader === undefined) continue
    if (!x.trace.slice(k - 3, k).every((p) => p.L.state === 'idle' && p.leader === s.leader) || nearSwap(s.f)) continue
    const c = contacts.find((contact) => contact.who === s.leader && contact.f >= s.f - 2 && contact.f <= s.f + 12)
    if (!audible({ f: s.f })) continue
    starts.push({ who: s.leader, f: s.f })
    if (!c || c.foot !== 'l' || Math.abs(c.t - s.f / fps) > tolerance + frame) {
      note(`${s.leader.toUpperCase()} started walking at frame ${s.f}: ${c ? `first contact ${c.foot} at ${r3(c.t)} s` : 'no contact'}, expected the left foot at clip time 0`)
    }
  }
  for (const text of problems) out.problem('R6-AUD-01', x.where, text)
  for (const who of ['a', 'b']) pool.leaderContacts[who] += leaderContacts.filter((c) => c.who === who).length
  pool.followerContacts += followerContacts.length
  out.measure('R6-AUD-01', x.where, {
    leaderContacts: leaderContacts.length, followerContacts: followerContacts.length, steps: steps.length, walkStarts: starts.length,
    medianInterval: { a: r3(median(intervals.a)), b: r3(median(intervals.b)) }, halfClip: { a: r3(half.a), b: r3(half.b) },
  })
}

// ---- R6-AUD-02 the hum ----------------------------------------------------------------------------------------------

// Pitch a sample cue sounded: the take's base MIDI shifted by its playback rate.
export function sungMidi(cue, manifest) {
  const take = manifest.cues[cue.cue]?.files.find(({ src }) => src === cue.file)
  if (!Number.isFinite(take?.baseMidi) || !(cue.rate > 0)) throw new Error(`no pitch metadata or rate for ${cue.file}`)
  return take.baseMidi + 12 * Math.log2(cue.rate)
}

export function analyzeHum(x, out, pool, ctx) {
  const melody = (x.result.audioLog ?? []).filter(({ harmony }) => harmony !== true).toSorted((a, b) => a.t - b.t)
  let lastWalk = -1
  for (const [k, s] of x.trace.entries()) if (s.L.state === 'walk') lastWalk = k
  if (lastWalk < 0 || lastWalk + 1 >= x.trace.length) return out.problem('R6-AUD-02', x.where, 'the leader never stopped after walking')
  const stoppedAt = x.trace[lastWalk + 1].f / fps
  const humAt = stoppedAt + A.humDelaySeconds
  const lastMelody = melody.filter(({ t }) => t <= humAt).slice(-3)
  const hum = (x.result.cueLog ?? []).filter(({ cue, t }) => cue === 'sing_hum' && t >= stoppedAt - 0.05 && t < stoppedAt + 8)
  out.measure('R6-AUD-02', x.where, { stoppedAt: r3(stoppedAt), melody: lastMelody.map(({ midi }) => midi), hum: hum.map(({ t, midi, who }) => ({ t: r3(t), midi, who })) })
  const high = lastMelody.filter(({ midi }) => midi > A.humAbove)
  if (!high.length) return out.problem('R6-AUD-02', x.where, `the last three melody notes before the hum (${lastMelody.map(({ midi }) => midi).join(', ')}) include none above MIDI ${A.humAbove}`)
  pool.humOctave += high.length
  if (hum.length !== lastMelody.length) return out.problem('R6-AUD-02', x.where, `${hum.length} hum notes for ${lastMelody.length} melody notes`)
  for (const [index, cue] of hum.entries()) {
    const target = lastMelody[index].midi > A.humAbove ? lastMelody[index].midi - A.octave : lastMelody[index].midi
    const at = `hum note ${index + 1} (melody MIDI ${lastMelody[index].midi}, expected ${target})`
    if (cue.who !== 'a') out.problem('R6-AUD-02', x.where, `${at} was sung by ${cue.who}`)
    if (Math.abs(cue.t - (humAt + index * A.eighth)) > A.humToleranceSeconds + 1e-6) out.problem('R6-AUD-02', x.where, `${at} began at ${r3(cue.t)} s, expected ${r3(humAt + index * A.eighth)} s ± ${A.humToleranceSeconds}`)
    try {
      const midi = sungMidi(cue, ctx.manifest)
      if (Math.abs(midi - target) > A.pitchToleranceSemitones + 1e-6) out.problem('R6-AUD-02', x.where, `${at} sounded MIDI ${r3(midi)} ± ${A.pitchToleranceSemitones}`)
    } catch (error) {
      out.problem('R6-AUD-02', x.where, `${at}: ${error.message}`)
    }
  }
}

export const newAudioPool = () => ({ leaderContacts: { a: 0, b: 0 }, followerContacts: 0, humOctave: 0 })

export function finishAudio(pool, out) {
  for (const who of ['a', 'b']) {
    if (pool.leaderContacts[who] < 8) out.problem('R6-AUD-01', '', `only ${pool.leaderContacts[who]} contacts of ${who.toUpperCase()} leading in all routes, need 8`)
  }
  if (pool.followerContacts < 5) out.problem('R6-AUD-01', '', `only ${pool.followerContacts} follower contacts in all routes, need 5 to show they are silent`)
  if (!pool.humOctave) out.problem('R6-AUD-02', '', 'no hum with a melody note above MIDI 78 was observed')
}
