import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectPitch, selectSungWindow, voicedPitchFrames } from './pitch.js'

export const SAMPLE_RATE = 44100
const db = amplitude => 20 * Math.log10(amplitude)
const amplitude = decibels => 10 ** (decibels / 20)
const ffmpeg = (...args) => ['-hide_banner', '-nostdin', '-v', 'error', ...args]

function run(command, args, input) {
  const result = spawnSync(command, args, { input, maxBuffer: 32 * 1024 ** 2 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.toString().trim()}`)
  return result.stdout
}

export function verifyMediaTools() {
  run('ffmpeg', ['-version'])
  run('ffprobe', ['-version'])
}

export function decodeArgs(file, rate = 1) {
  const filters = rate === 1 ? [] : ['-af',
    `aresample=${SAMPLE_RATE},asetrate=${Math.round(SAMPLE_RATE * rate)},aresample=${SAMPLE_RATE}`]
  return ffmpeg('-i', file, '-map', '0:a:0', ...filters, '-ac', '1', '-ar', String(SAMPLE_RATE),
    '-f', 'f32le', 'pipe:1')
}

export function decode(file, rate = 1) {
  const data = run('ffmpeg', decodeArgs(file, rate))
  return new Float32Array(data.buffer, data.byteOffset, data.length / 4)
}

export function encodeArgs({ start, length, gain, bitrate, file }) {
  const fade = Math.min(length, Math.round(0.015 * SAMPLE_RATE))
  const filters = [
    `atrim=start_sample=${start}`,
    `afade=t=out:ss=${length - fade}:ns=${fade}`,
    `volume=${gain}dB`,
  ]
  return ffmpeg('-y', '-f', 'f32le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
    '-af', filters.join(','), '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, file)
}

export function sampleMeasurements(samples, threshold = amplitude(-40)) {
  let first = -1
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const absolute = Math.abs(samples[i])
    if (absolute > threshold && first < 0) first = i
    max = Math.max(max, absolute)
  }
  return {
    first, startMs: first < 0 ? Infinity : 1000 * first / SAMPLE_RATE,
    peakDbfs: db(max), duration: samples.length / SAMPLE_RATE,
  }
}

const levelsPass = ({ startMs, peakDbfs }) => startMs <= 10 && Math.abs(peakDbfs + 1) <= 0.5

export function probe(file) {
  return JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]))
}

export function inspect(file, { kind, sung, measureSpokenPitch }, metadata = probe(file)) {
  const stream = metadata.streams.find(stream => stream.codec_type === 'audio')
  const samples = decode(file)
  const { first, ...levels } = sampleMeasurements(samples)
  const bytes = statSync(file).size
  const kbps = Number(stream?.bit_rate ?? metadata.format.bit_rate) / 1000
  const pass = levelsPass(levels) && stream?.codec_name === 'mp3' && stream.channels === 1
    && Number(stream.sample_rate) === SAMPLE_RATE && kbps <= (kind === 'step' ? 64 : 96)
  return { ...levels, bytes, kbps, pass, ...(sung ? detectPitch(samples, SAMPLE_RATE) : {}),
    ...(measureSpokenPitch ? { voicedF0Hz: voicedPitchFrames(samples, SAMPLE_RATE) } : {}) }
}

export function processTake(raw, cue) {
  const decoded = decode(raw)
  const window = cue.sung ? selectSungWindow(decoded, SAMPLE_RATE, cue.sungWindow ?? 0.4) : null
  const samples = window ? decoded.subarray(window.start, window.end) : decoded
  const before = sampleMeasurements(samples)
  if (!Number.isFinite(before.peakDbfs)) throw new Error('Audio is silent')
  const directory = mkdtempSync(join(tmpdir(), 'atlas-audio-'))
  const file = join(directory, 'take.mp3')
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const bitrate = cue.kind === 'step' ? 64 : 96
  let gain = -1 - before.peakDbfs
  const { first } = sampleMeasurements(samples, amplitude(-40 - gain))
  let start = Math.max(0, first - Math.round(0.002 * SAMPLE_RATE))
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      run('ffmpeg', encodeArgs({ start, length: samples.length - start, gain, bitrate, file }), input)
      const measured = inspect(file, cue)
      if (measured.pass) {
        return { ...measured, ...(window ? { windowStart: window.start / SAMPLE_RATE } : {}),
          audio: readFileSync(file) }
      }
      if (!Number.isFinite(measured.peakDbfs)) break
      if (measured.startMs > 10 && Number.isFinite(measured.startMs)) {
        const trim = Math.round((measured.startMs - 2) * SAMPLE_RATE / 1000)
        start = Math.min(samples.length - 1, start + trim)
      }
      gain += -1 - measured.peakDbfs
    }
    throw new Error('Could not encode a take within the decoded MP3 onset, peak and format limits')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export const retunedPitch = (file, rate) => detectPitch(decode(file, rate), SAMPLE_RATE)
