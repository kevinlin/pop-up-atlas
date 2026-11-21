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
  const seed = randomBytes(4).readUInt32LE()
  const random = createRandom(seed)
  for (let i = comparisons.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const comparison = comparisons[i]
    comparisons[i] = comparisons[j]
    comparisons[j] = comparison
  }

  const pairs = []
  const key = { seed, pairs: {} }
  for (const [i, [name, first, second]] of comparisons.entries()) {
    const pair = `pair-${i + 1}`
    const [x, y] = random() < 0.5 ? [first, second] : [second, first]
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
    key.pairs[pair] = { name, ...originals }
  }

  await Promise.all([
    writeFile(join(criticDir, 'pairs.json'), JSON.stringify(pairs, null, 2) + '\n'),
    writeFile(join(keyDir, 'audio-key.json'), JSON.stringify(key, null, 2) + '\n'),
  ])
}
