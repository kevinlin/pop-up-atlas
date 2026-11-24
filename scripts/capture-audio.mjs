import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRandom } from '../src/audio/music.js'

export const cueKinds = ['voice', 'chorus', 'sfx', 'step']
export const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args],
  { maxBuffer: 16 * 1024 * 1024 })

export const decodeAudio = (video) => ffmpeg(['-i', video, '-map', '0:a:0', '-f', 'f32le', 'pipe:1'])

export function masterMetrics(pcm) {
  let peak = 0
  let clippedSamples = 0
  for (let offset = 0; offset < pcm.length; offset += 4) {
    const amplitude = Math.abs(pcm.readFloatLE(offset))
    peak = Math.max(peak, amplitude)
    if (amplitude >= 1) clippedSamples++
  }
  return { peakDbfs: peak > 0 ? 20 * Math.log10(peak) : null, clippedSamples }
}

export function mixReport(stemPeaksDbfs, master, baselineRev) {
  const difference = (a, b) => Number.isFinite(stemPeaksDbfs[a]) && Number.isFinite(stemPeaksDbfs[b])
    ? stemPeaksDbfs[a] - stemPeaksDbfs[b]
    : null
  const voiceAboveChimes = difference('voice', 'chimes')
  const stepBelowVoice = difference('voice', 'step')
  const chorusBelowVoice = difference('voice', 'chorus')
  const rules = {
    voiceAboveChimes: { db: voiceAboveChimes, minDb: 3, maxDb: 6,
      pass: voiceAboveChimes >= 3 && voiceAboveChimes <= 6 },
    stepBelowVoice: { db: stepBelowVoice, minDb: 12, pass: stepBelowVoice >= 12 },
    chorusBelowVoice: { db: chorusBelowVoice, minDb: 6, pass: chorusBelowVoice >= 6 },
    masterPeak: { dbfs: master.peakDbfs, maxDbfs: -1,
      pass: Number.isFinite(master.peakDbfs) && master.peakDbfs <= -1 },
    masterClipping: { samples: master.clippedSamples, maxSamples: 0, pass: master.clippedSamples === 0 },
  }
  return {
    baselineRev,
    stemPeaksDbfs,
    master: { source: 'Decoded AAC stream of gameplay-30s.mp4', ...master },
    rules,
    pass: Object.values(rules).every(({ pass }) => pass),
  }
}

// Blind pairs with an external answer key. `items` = [{name, first, second}]; the order of the pairs and the side each
// of `first` and `second` lands on are drawn from `seed`, so the same seed and items always give the same pairs. Returns
// `pairs` [{pair, a, b}] (what a judge sees) and `key` {seed, pairs: {pair: {name, a, b}}} (what to keep elsewhere).
export function blindPairs(items, { seed }) {
  const random = createRandom(seed)
  const order = [...items]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swapped = order[i]
    order[i] = order[j]
    order[j] = swapped
  }
  const pairs = []
  const key = { seed, pairs: {} }
  for (const [i, { name, first, second }] of order.entries()) {
    const pair = `pair-${i + 1}`
    const [a, b] = random() < 0.5 ? [first, second] : [second, first]
    pairs.push({ pair, a, b })
    key.pairs[pair] = { name, a, b }
  }
  return { pairs, key }
}

// Old-vs-new voice bank. A cue logged against one bank is replayed from the other: the same cue name, the same take
// index (modulo the other bank's take count), the other bank's gain, and the other take's length unless the log cut the
// cue short (a swap or the next voice). A cue the other bank lacks, or one without a file (a step pluck), is dropped
// or kept as is respectively; the result says which.
export function remapCue(cue, from, to) {
  if (cue.file === null || cue.file === undefined) return { cue }
  const source = from.cues?.[cue.cue]
  const target = to.cues?.[cue.cue]
  if (!source || !target?.files?.length) return { dropped: cue.cue }
  const index = Math.max(0, source.files.findIndex(({ src }) => src === cue.file))
  const file = target.files[index % target.files.length]
  const rate = cue.rate || 1
  const natural = cue.t + (source.files[index]?.duration ?? file.duration) / rate
  const cut = cue.end < natural - 1e-6
  return {
    cue: {
      ...cue, file: file.src, gain: cue.gain * (target.gain / source.gain),
      end: cut ? Math.min(cue.end, cue.t + file.duration / rate) : cue.t + file.duration / rate,
    },
  }
}

// Six matched segments of one capture's cue log that carry voices: each `length` seconds starting 0.3 s before a
// voice or sung cue, taken one per cue name first (so the six cover different lines), then by time, never overlapping
// (chorus and sfx cues fill in when the log has fewer voices).
export function pickVoiceSegments(cues, { count = 6, length = 3, duration = 30, lead = 0.3, kinds = ['voice'] } = {}) {
  const candidates = cues.filter(({ kind, file }) => kinds.includes(kind) && file).sort((a, b) => a.t - b.t)
  const chosen = []
  const free = (start) => chosen.every((other) => start >= other.end || start + length <= other.start)
  const consider = (cue, uniqueNames) => {
    if (chosen.length >= count) return
    const start = Math.min(Math.max(0, cue.t - lead), Math.max(0, duration - length))
    if (!free(start)) return
    if (uniqueNames && chosen.some((segment) => segment.names.includes(cue.cue))) return
    chosen.push({ start, end: Math.min(duration, start + length), names: [cue.cue] })
  }
  for (const cue of candidates) consider(cue, true)
  for (const cue of candidates) consider(cue, false)
  // Too few voices in the log: fill with the other sample kinds that carry a file (chorus, then sfx), same rules.
  const rest = cues.filter(({ kind, file }) => !kinds.includes(kind) && kind !== 'step' && file).sort((a, b) => a.t - b.t)
  for (const cue of rest) consider(cue, true)
  chosen.sort((a, b) => a.start - b.start)
  for (const segment of chosen) {
    segment.names = [...new Set(cues.filter(({ t, end, file }) => file && t < segment.end && end > segment.start).map(({ cue }) => cue))]
  }
  return chosen
}

// Cues overlapping a segment, for a render that is later trimmed to it.
export const cuesInSegment = (cues, { start, end }) => cues.filter(({ t, end: stop }) => t < end && stop > start)

export async function writeCriticPairs(stagedDir, roundDir) {
  const audioDir = join(stagedDir, 'audio')
  const criticPath = join('critic-inputs', 'audio')
  const criticDir = join(stagedDir, criticPath)
  const keyDir = join(stagedDir, 'key')
  await Promise.all([mkdir(criticDir, { recursive: true }), mkdir(keyDir, { recursive: true })])

  const comparisons = [
    ['whole', 'baseline', 'full'],
    ['music', 'folds-baseline', 'folds'],
    ...cueKinds.map((kind) => [`with-vs-without-${kind}`, 'full', `full-minus-${kind}`]),
  ]
  const { pairs: blind, key } = blindPairs(comparisons.map(([name, first, second]) => ({ name, first, second })),
    { seed: randomBytes(4).readUInt32LE() })
  const pairs = []
  for (const { pair, a: x, b: y } of blind) {
    const originals = { x: `${x}.wav`, y: `${y}.wav` }
    const clips = {}
    for (const [side, source] of Object.entries(originals)) {
      const clip = join(criticDir, `${pair}-${side}`)
      await copyFile(join(audioDir, source), `${clip}.wav`)
      ffmpeg(['-i', `${clip}.wav`, '-lavfi', 'showspectrumpic=s=1200x600:legend=disabled',
        '-frames:v', '1', `${clip}.png`])
      clips[side] = join(roundDir, criticPath, `${pair}-${side}.wav`)
    }
    pairs.push({ pair, a: clips.x, b: clips.y })
    key.pairs[pair] = { name: key.pairs[pair].name, ...originals }
  }

  await Promise.all([
    writeFile(join(criticDir, 'pairs.json'), JSON.stringify(pairs, null, 2) + '\n'),
    writeFile(join(keyDir, 'audio-key.json'), JSON.stringify(key, null, 2) + '\n'),
  ])
}

// Blind old-vs-new voice-bank pairs. `segments` = [{index, start, end, names}] and the stems directory holds
// `voice-bank/segment-<index>-old.wav` and `-new.wav` (already trimmed to the segment). The judge folder gets
// `pair-<n>-a|b.wav`; the answer key (which side is the old bank, the segment and its cues) goes to `key/voice-bank-key.json`,
// outside the folder the judge reads.
export async function writeVoiceBankPairs(stagedDir, roundDir, segments, { seed = randomBytes(4).readUInt32LE() } = {}) {
  const sourceDir = join(stagedDir, 'audio', 'voice-bank')
  const criticPath = join('critic-inputs', 'voice-bank')
  const criticDir = join(stagedDir, criticPath)
  const keyDir = join(stagedDir, 'key')
  await Promise.all([mkdir(criticDir, { recursive: true }), mkdir(keyDir, { recursive: true })])
  const { pairs: blind, key } = blindPairs(segments.map(({ index }) => ({
    name: `segment-${index}`, first: `segment-${index}-old`, second: `segment-${index}-new`,
  })), { seed })
  const bySegment = new Map(segments.map((segment) => [`segment-${segment.index}`, segment]))
  const pairs = []
  for (const { pair, a, b } of blind) {
    const clips = {}
    for (const [side, source] of Object.entries({ a, b })) {
      await copyFile(join(sourceDir, `${source}.wav`), join(criticDir, `${pair}-${side}.wav`))
      clips[side] = join(roundDir, criticPath, `${pair}-${side}.wav`)
    }
    pairs.push({ pair, a: clips.a, b: clips.b })
    const { name } = key.pairs[pair]
    const { start, end, names } = bySegment.get(name)
    key.pairs[pair] = { name, old: a.endsWith('-old') ? 'a' : 'b', a: `${a}.wav`, b: `${b}.wav`, start, end, cues: names }
  }
  await Promise.all([
    writeFile(join(criticDir, 'pairs.json'), JSON.stringify(pairs, null, 2) + '\n'),
    writeFile(join(keyDir, 'voice-bank-key.json'), JSON.stringify(key, null, 2) + '\n'),
  ])
  return { pairs, key }
}
