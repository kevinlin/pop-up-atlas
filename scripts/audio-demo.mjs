import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createRandom, createScheduler } from '../src/audio/music.js'

const duration = 20
const random = createRandom(2026)
const tileIds = ['flower', 'mushroom_house', 'cupcake_tree', 'meadow', 'yarn_bridge']
const events = []
for (let i = 0, t = 0.18; t < 18.7; i++, t += 0.33 + 0.14 * random()) {
  const event = { dir: 'up', id: tileIds[i % tileIds.length], i, j: i % 3, t }
  events.push(event)
  if (i % 4 === 2) events.push({ ...event, dir: 'down', i: i - 2, t: t + 0.11 + 0.16 * random() })
}

const evidence = new URL('../.handoff/evidence/T6/', import.meta.url)
const wavPath = fileURLToPath(new URL('demo.wav', evidence))
const origin = 'http://atlas-audio.test'
await mkdir(evidence, { recursive: true })

const browser = await chromium.launch({ headless: true })
let notes
try {
  const page = await browser.newPage()
  await page.route(`${origin}/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Atlas audio demo</title>' })
    }
    if (!/^\/src\/audio\/[a-z]+\.js$/.test(pathname)) return route.fulfill({ status: 404 })
    const path = fileURLToPath(new URL(`..${pathname}`, import.meta.url))
    return route.fulfill({ path, contentType: 'text/javascript' })
  })
  await page.goto(origin)
  const [download, audioLog] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(async ({ events, duration }) => {
      const { renderOffline, encodeWav } = await import('/src/audio/index.js')
      window.__atlas = { audioLog: [] }
      const wav = encodeWav(await renderOffline(events, duration))
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
      link.download = 'demo.wav'
      link.click()
      return window.__atlas.audioLog
    }, { events, duration }),
  ])
  await download.saveAs(wavPath)
  notes = audioLog
} finally {
  await browser.close()
}

const scheduled = events.flatMap(createScheduler()).filter(({ t }) => t < duration)
const chimes = scheduled.filter(({ kind }) => kind === 'chime')
assert.deepEqual(notes.map(({ t, midi }) => [t, midi]), chimes.map(({ t, midi }) => [t, midi]))

const wav = await readFile(wavPath)
const channels = wav.readUInt16LE(22)
const sampleRate = wav.readUInt32LE(24)
const frameSize = channels * 2
const windowFrames = Math.round(sampleRate * 0.005)
const windowBytes = windowFrames * frameSize
const onsets = []
let previousRms = 0
let peak = 0
for (let offset = 44; offset + windowBytes <= wav.length; offset += windowBytes) {
  let energy = 0
  for (let sample = offset; sample < offset + windowBytes; sample += 2) {
    const amplitude = wav.readInt16LE(sample) / 32768
    energy += amplitude * amplitude
    peak = Math.max(peak, Math.abs(amplitude))
  }
  const rms = Math.sqrt(energy / (windowFrames * channels))
  const time = (offset - 44) / (frameSize * sampleRate)
  if (rms - previousRms > 0.0015 && rms > 1.45 * previousRms && time - (onsets.at(-1) ?? -1) >= 0.025) {
    onsets.push(time)
  }
  previousRms = rms
}
assert.ok(onsets.length > 0 && peak < 32767 / 32768, 'Expected audible audio with headroom')

const expected = scheduled.map(({ t }) => t).sort((a, b) => a - b)
const tolerance = 0.02
let cursor = 0
let matches = 0
for (const onset of onsets) {
  while (expected[cursor] < onset - tolerance) cursor++
  if (Math.abs(expected[cursor] - onset) <= tolerance) {
    cursor++
    matches++
  }
}

const report = [
  `demo.wav contains ${duration} s of ${sampleRate} Hz, ${channels}-channel, 16-bit PCM audio.`,
  `Scheduled ${scheduled.length} sounds (${scheduled.length - notes.length} pops and ${notes.length} chimes).`,
  `Detected ${onsets.length} energy onsets.`,
  `${matches} onsets matched a scheduled sound within 20 ms. ${scheduled.length - matches} scheduled sounds and ${onsets.length - matches} detections had no match.`,
  `The sample peak was ${(20 * Math.log10(peak)).toFixed(1)} dBFS.`,
  'Detection uses 5 ms RMS windows across both channels, a rise greater than 0.0015 and 1.45 times the prior window, and a minimum onset spacing of 25 ms.',
  'Nearby pops and chimes can register as one onset. The compressor adds a short delay.',
].join('\n') + '\n'
await writeFile(new URL('onsets.txt', evidence), report)
process.stdout.write(report)
