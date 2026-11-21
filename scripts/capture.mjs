import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createScheduler } from '../src/audio/music.js'
import { createLayout } from '../src/world/layout.js'
import { cellAt } from '../src/world/tiles.js'

export const previewURL = 'http://localhost:4173'
export const roundDir = 'deliverables/round-1'
export const evidenceDir = '.handoff/evidence/T10'
export const writeJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n')
export const headless = process.env.ATLAS_HEADLESS === '1'
export const launchChromium = () => chromium.launch(headless
  ? { headless: true, args: ['--single-process'] }
  : { headless: false })

export async function createSteppedPage(browser, viewport, { waitForAudio = false } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) {
      errors.push(message.text())
    }
  })
  await page.addInitScript(({ waitForAudio }) => {
    // The game takes its elapsed time from RAF. Leave real timers available for loading.
    let nextId = 0
    let pending = new Map()
    window.requestAnimationFrame = (callback) => {
      pending.set(++nextId, callback)
      return nextId
    }
    window.cancelAnimationFrame = (id) => pending.delete(id)
    window.__atlasStep = (frame, fps, count) => {
      for (let i = 0; i < count; i++) {
        // Callbacks requested during a frame belong to the next frame.
        const current = pending
        pending = new Map()
        for (const [id, callback] of current) {
          current.delete(id)
          callback(1000 * (frame + i) / fps)
        }
      }
    }
    if (waitForAudio) {
      const resume = AudioContext.prototype.resume
      AudioContext.prototype.resume = async function () {
        await resume.call(this)
        window.__atlasAudioUnlocked = this.state === 'running'
      }
    }
  }, { waitForAudio })
  const advance = (frame, fps, count = 1) => page.evaluate(
    ([first, rate, steps]) => window.__atlasStep(first, rate, steps), [frame, fps, count],
  )
  const open = async (url) => {
    errors.length = 0
    const response = await page.goto(url)
    assert.ok(response?.ok(), `Preview did not serve ${url}`)
    const deadline = Date.now() + 30_000
    let ready
    do {
      assert.deepEqual(errors, [], 'Game errors during startup')
      await advance(0, 60)
      ready = await page.evaluate(() => window.__atlas?.ready)
      if (!ready) await delay(50)
    } while (!ready && Date.now() < deadline)
    assert.ok(ready, 'Game assets and shaders did not become ready within 30 seconds')
    assert.ok(await page.evaluate(() => window.__atlas.hairBones.length === 4), 'Troll rig did not load')
  }
  return { page, open, advance, errors }
}

const viewport = { width: 1280, height: 720 }
const fps = 60
const duration = 30
const seed = 42
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args],
  { maxBuffer: 16 * 1024 * 1024 })

async function offlineAudio(page, filepath) {
  const folder = new URL('/__atlas_capture_audio/', page.url())
  await page.route(`${folder.href}*.js`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    assert.match(name, /^(index|music|sounds)\.js$/)
    return route.fulfill({
      path: fileURLToPath(new URL(`../src/audio/${name}`, import.meta.url)),
      contentType: 'text/javascript',
    })
  })
  const download = page.waitForEvent('download')
  const result = await page.evaluate(async ({ moduleURL, duration }) => {
    const { foldLog } = window.__atlas
    const { renderOffline, encodeWav } = await import(moduleURL)
    window.__atlas.audioLog.length = 0
    const buffer = await renderOffline(foldLog, duration)
    const url = URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: 'atlas.wav' })
    link.click()
    return { events: foldLog, notes: window.__atlas.audioLog }
  }, { moduleURL: new URL('index.js', folder).href, duration })
  await (await download).saveAs(filepath)
  return result
}

function measureOnsets(video, events, notes) {
  const rate = 48_000
  const channels = 2
  const sampleBytes = 4
  const pcm = ffmpeg(['-i', video, '-map', '0:a:0', '-t', String(duration), '-ac', '2', '-ar', String(rate),
    '-f', 'f32le', 'pipe:1'])
  const windowSeconds = 0.005
  const windowBytes = windowSeconds * rate * channels * sampleBytes
  const onsets = []
  let previous = 0
  let peak = 0
  for (let offset = 0; offset + windowBytes <= pcm.length; offset += windowBytes) {
    let energy = 0
    for (let sample = offset; sample < offset + windowBytes; sample += sampleBytes) {
      const amplitude = pcm.readFloatLE(sample)
      energy += amplitude ** 2
      peak = Math.max(peak, Math.abs(amplitude))
    }
    const rms = Math.sqrt(energy / (windowBytes / sampleBytes))
    const t = offset / (rate * channels * sampleBytes)
    if (rms - previous > 0.0015 && rms > 1.45 * previous && t - (onsets.at(-1) ?? -1) >= 0.025) {
      onsets.push(t)
    }
    previous = rms
  }

  const voices = events.flatMap(createScheduler()).filter(({ t }) => t < duration).sort((a, b) => a.t - b.t)
  const chimes = voices.filter(({ kind }) => kind === 'chime')
  assert.deepEqual(notes.map(({ t, midi }) => [t, midi]), chimes.map(({ t, midi }) => [t, midi]),
    'Offline notes differ from the game scheduler')
  let matched = 0
  let cursor = 0
  const tolerance = 0.025
  for (const onset of onsets) {
    while (voices[cursor]?.t < onset - tolerance) cursor++
    if (Math.abs(voices[cursor]?.t - onset) <= tolerance) {
      matched++
      cursor++
    }
  }
  assert.ok(chimes.length > 0 && voices.length > chimes.length && matched > 0 && peak > 0,
    'Expected chimes, pops, and detectable audio in the MP4')
  return {
    source: 'Decoded AAC stream of gameplay-30s.mp4',
    method: 'Stereo 5 ms RMS windows. Rise above 0.0015 and 1.45x prior RMS, spaced by at least 25 ms.',
    foldUpEvents: events.filter(({ dir }) => dir === 'up').length,
    foldDownEvents: events.filter(({ dir }) => dir === 'down').length,
    scheduledChimes: chimes.length,
    scheduledFoldUpPops: voices.filter(({ kind, dir }) => kind === 'pop' && dir === 'up').length,
    scheduledFoldDownPops: voices.filter(({ kind, dir }) => kind === 'pop' && dir === 'down').length,
    scheduledSounds: voices.length,
    detectedOnsets: onsets.length,
    matchedWithin25ms: matched,
    peakDbfs: 20 * Math.log10(peak),
    note: 'Voice limits drop some pops and merge chimes on the same eighth-note slot. Simultaneous voices can produce one energy onset.',
    onsetTimesSec: onsets,
  }
}

async function capture(baseURL) {
  await Promise.all([mkdir(roundDir, { recursive: true }), mkdir(evidenceDir, { recursive: true })])
  const temp = await mkdtemp(join(tmpdir(), 'atlas-capture-'))
  const video = join(temp, 'gameplay-30s.mp4')
  const wav = join(temp, 'audio.wav')
  const layout = createLayout(seed)
  const url = new URL(baseURL)
  url.searchParams.set('seed', seed)
  const toFrame = (seconds) => Math.round(seconds * fps)
  const turn = toFrame(11.25)
  const turnBack = turn + toFrame(4 * Math.SQRT2 / 1.2)
  const click = turnBack + toFrame(2)
  let audio
  let danceFrames = 0
  let danceRun = 0
  let bridgeFrames = 0
  let clickedFrom
  let arrival
  try {
    const browser = await launchChromium()
    try {
      const { page, open, advance, errors } = await createSteppedPage(browser, viewport)
      await open(url.href)
      const player = () => page.evaluate(() => ({ ...window.__atlas.player }))
      for (let frame = 0; frame < duration * fps; frame++) {
        if (frame === 1) await page.keyboard.down('KeyD')
        if (frame === turn + 1) await page.keyboard.down('KeyW')
        if (frame === turnBack + 1) await page.keyboard.up('KeyW')
        if (frame === click + 1) {
          await page.keyboard.up('KeyD')
          clickedFrom = await player()
          // The camera follows 0.25 s behind the eastbound troll. At mid-height
          // the ray lands on the camera target's Z, already aligned with the bridge.
          const targetX = 23.2
          const cameraX = clickedFrom.x - (1.2 / fps) / Math.expm1(1 / (fps * 0.25))
          const x = viewport.width / 2 + (targetX - cameraX) * viewport.height / (20 * Math.tan(Math.PI / 12))
          assert.ok(x > 0 && x < viewport.width)
          await page.mouse.click(x, viewport.height / 2)
        }
        await advance(frame, fps)
        await page.screenshot({ path: join(temp, `frame-${String(frame).padStart(4, '0')}.jpg`),
          type: 'jpeg', quality: 94, timeout: 15_000 })
        if (frame > click) {
          const pose = await player()
          if (!arrival && pose.state === 'idle') arrival = pose
          if (pose.state === 'walk' && layout.getCell(cellAt(pose.x), cellAt(pose.z)).id === 'yarn_bridge') {
            bridgeFrames++
          }
          danceRun = pose.state === 'dance' ? danceRun + 1 : 0
          danceFrames = Math.max(danceFrames, danceRun)
        }
        if ((frame + 1) % 120 === 0) console.log(`Captured ${frame + 1}/${duration * fps} frames`)
      }
      assert.ok(arrival && Math.hypot(arrival.x - 23.2, arrival.z + 4) <= 0.5,
        `Click from ${JSON.stringify(clickedFrom)} missed: ${JSON.stringify(arrival)}`)
      assert.ok(bridgeFrames > 0, 'Route did not cross a yarn bridge')
      assert.ok(danceFrames >= 4 * fps, `Only ${danceFrames / fps} seconds of continuous dance`)
      audio = await offlineAudio(page, wav)
      assert.deepEqual(errors, [], 'Browser errors during capture')
    } finally {
      await browser.close()
    }

    ffmpeg(['-framerate', String(fps), '-i', join(temp, 'frame-%04d.jpg'), '-i', wav,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17',
      '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(duration), video])
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]))
    const [picture, sound] = probe.streams
    assert.equal(probe.streams.length, 2)
    assert.equal(picture.codec_type, 'video')
    assert.equal(picture.codec_name, 'h264')
    assert.equal(sound.codec_type, 'audio')
    assert.equal(sound.codec_name, 'aac')
    assert.deepEqual([picture.width, picture.height, picture.avg_frame_rate, Number(picture.nb_frames)],
      [viewport.width, viewport.height, `${fps}/1`, duration * fps])
    assert.ok(Number(probe.format.duration) >= 29 && Number(probe.format.duration) <= 31)

    const onsets = measureOnsets(video, audio.events, audio.notes)
    onsets.route = { seed, headless, clickedFrom, arrival, bridgeSeconds: bridgeFrames / fps, danceSeconds: danceFrames / fps }
    const output = join(roundDir, 'gameplay-30s.mp4')
    // Read from the temporary encode before installing the validated file.
    await copyFile(video, output)
    probe.format.filename = output
    await writeJson(join(evidenceDir, 'capture-ffprobe.json'), probe)
    await writeJson(join(evidenceDir, 'capture-onsets.json'), onsets)
    ffmpeg(['-i', output, '-vf', 'fps=2/5,scale=320:180,tile=4x3:padding=4:margin=4',
      '-frames:v', '1', join(evidenceDir, 'capture-contact-sheet.png')])
    console.log(JSON.stringify({ output, duration: probe.format.duration, fps, ...onsets, onsetTimesSec: undefined }))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await capture(process.argv[2] ?? previewURL)
}
