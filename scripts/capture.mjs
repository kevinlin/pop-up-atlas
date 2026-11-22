import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { createScheduler } from '../src/audio/music.js'
import { createLayout } from '../src/world/layout.js'
import { cellAt, FIRST_PAGE_ROW, LAST_PAGE_ROW, PAGE_MAX_Z, TILE_SIZE } from '../src/world/tiles.js'
import { cueKinds, decodeAudio, ffmpeg, masterMetrics, mixReport, writeCriticPairs } from './capture-audio.mjs'
import { bandClear, duoContract, pathClear } from './e2e-duo-plan.mjs'
import { framingStats, installProbe, overlapShare, serveThree } from './e2e-duo-probe.mjs'

export const previewURL = 'http://localhost:4173'
export const evidenceDir = '.handoff/evidence/T10'
export const defaultRound = 2
export const foldContract = { upRadius: 2, downRadius: 3, settleSeconds: 1.4 }
export const walkSpeed = 1.2
export const writeJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n')
export const headless = process.env.ATLAS_HEADLESS === '1'
export const launchChromium = () => chromium.launch(headless
  ? { headless: true }
  : { headless: false })

export function roundOptions(script) {
  const options = { round: { type: 'string', default: String(defaultRound) } }
  if (script === 'capture') {
    options.stems = { type: 'boolean' }
    options['baseline-rev'] = { type: 'string', default: '7b6489c' }
  }
  const { positionals, values } = parseArgs({
    options,
    allowPositionals: true,
  })
  const stemsUsage = script === 'capture' ? ' [--stems [--baseline-rev REV]]' : ''
  assert.ok(positionals.length <= 1 && /^[1-9]\d*$/.test(values.round) && Number.isSafeInteger(Number(values.round)),
    `Usage: node scripts/${script}.mjs [PREVIEW_URL] [--round N]${stemsUsage}, with N a positive integer`)
  const round = `round-${values.round}`
  return {
    baseURL: positionals[0] ?? previewURL,
    round: Number(values.round),
    roundDir: join('deliverables', round),
    evidence: join(values.stems ? '.handoff/evidence/P0' : evidenceDir, round),
    ...(script === 'capture' && { stems: values.stems, baselineRev: values['baseline-rev'] }),
  }
}

export async function readDanceSeconds(page) {
  const url = new URL('models/troll.glb', page.url())
  const response = await page.request.get(url.href)
  assert.ok(response.ok(), `Could not load the dance clip from ${url.href}`)
  const bytes = await response.body()
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', 'Expected the preview troll GLB')
  const { animations, accessors } = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
  const dance = animations.find(({ name }) => name === 'dance')
  assert.ok(dance, 'Troll GLB has no dance clip')
  const seconds = Math.max(...dance.samplers.map(({ input }) => accessors[input].max?.[0]))
  assert.ok(Number.isFinite(seconds) && seconds > 0, 'Troll GLB has no valid dance duration')
  return seconds
}

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
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = async function () {
      if (!waitForAudio) return
      await resume.call(this)
      if (this.state !== 'running') return
      // After a real gesture unlock, hold the device clock while testing the game-time schedule.
      // Otherwise a slow render can push a fold's automation into the audio device's past.
      await this.suspend()
      Object.defineProperty(this, 'state', { value: 'running' })
      window.__atlasAudioUnlocked = true
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
const cameraDistance = 8.3
const cameraPitch = 37
const faceCameraFrame = 20 * fps
const faceCameraFrames = 20
const preRollFrames = 120

export function lineClear(layout, from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.02))
  for (let i = 0; i <= steps; i++) {
    if (layout.isBlocked(from.x + (to.x - from.x) * i / steps, from.z + (to.z - from.z) * i / steps)) return false
  }
  return true
}

export function planCaptureRoute() {
  const stride = walkSpeed / fps
  const edgeZ = PAGE_MAX_Z - 0.22
  const bridgeZ = LAST_PAGE_ROW * TILE_SIZE
  const edgeFrames = Math.round(16 / stride)
  const alignFrames = Math.round((edgeZ - bridgeZ) * Math.SQRT2 / stride)
  const diagonal = alignFrames * stride * Math.SQRT1_2
  let best

  for (const seed of [112, ...Array.from({ length: 64 }, (_, i) => i)]) {
    const layout = createLayout(seed)
    for (let i = 9; i <= 22; i++) {
      const bridge = layout.getCell(i, LAST_PAGE_ROW)
      if (bridge.id !== 'yarn_bridge' || bridge.rotation !== 0) continue
      const bridgeX = i * TILE_SIZE
      const start = { x: bridgeX - 21, z: edgeZ, heading: Math.PI / 2, zoom: 1 }
      const edgeEnd = { x: start.x + edgeFrames * stride, z: edgeZ }
      const aligned = { x: edgeEnd.x + diagonal, z: edgeZ - diagonal }
      const approachFrames = Math.round((bridgeX - 1.4 - aligned.x) / stride)
      const approach = { x: aligned.x + approachFrames * stride, z: aligned.z }
      const clickTarget = { x: bridgeX + 1.35, z: bridgeZ }
      const danceAt = { x: clickTarget.x, z: bridgeZ + faceCameraFrames * stride }
      const legs = [start, edgeEnd, aligned, approach]
      if (!legs.slice(1).every((to, index) => lineClear(layout, legs[index], to))) continue
      // Leave clearance for the smoothed camera's Z and fractional pointer coordinates.
      if (![-0.03, 0, 0.03].every((dz) => lineClear(layout, approach, { ...clickTarget, z: bridgeZ + dz })
        && lineClear(layout, { ...clickTarget, z: bridgeZ + dz }, { ...danceAt, z: danceAt.z + dz }))) continue
      // Prefer routes that raise new props while the troll is visibly following the edge.
      let edgeProps = 0
      for (let col = Math.floor((start.x + foldContract.upRadius) / TILE_SIZE) + 1;
        col * TILE_SIZE <= edgeEnd.x; col++) {
        if (layout.getCell(col, LAST_PAGE_ROW).blockedRadius) edgeProps++
      }
      if (!best || edgeProps > best.edgeProps) {
        best = { seed, layout, start, edgeEnd, approach, clickTarget, edgeFrames, alignFrames, approachFrames, edgeProps }
      }
    }
  }
  assert.ok(best, 'No clear page-edge route to an eastbound bridge in the capture seed search')
  return best
}

// Round 5 (docs/contracts.md "Round 5: duo"): from this round on the capture follows the duo route.
export const duoRound = 5
export const duoTiming = {
  danceIdleSeconds: 4,
  followerDanceDelay: 0.3125,
  // Room after the follower's dance ends, so the clip does not cut the dance off.
  tailMarginSeconds: 0.7,
  faceCameraFrames,
  // The swap is applied by the next game frame; the held keys then steer the new leader.
  swapKeyDelayFrames: 3,
  followGap: 1.1,
  // Where B takes over, measured back from the bridge centre, and where the pair stops past it.
  swapBeforeBridge: 3.6,
  stopAfterBridge: 2.5,
  minAFrames: 3 * fps,
  minFoldUps: 4,
}

// Fold-ups a leader path raises (docs/contracts.md: up at 2 units, down beyond 3, tile centres on the 2-unit grid).
// Cells already up at frame 0 fold before the clip starts and are not counted. Flat tiles (meadow, river
// corners and straights) have no hinges and raise no fold event (matches the 10 events of the dry run).
const flatTile = (id) => id === 'meadow' || id.startsWith('river_')
export function plannedFoldUps(segments, layout, frames = duration * fps) {
  const { upRadius, downRadius } = foldContract
  const positionAt = (frame) => {
    let pose = segments[0].from
    for (const { f0, f1, from, to } of segments) {
      if (frame < f0) break
      const share = f1 > f0 ? Math.min(1, (frame - f0) / (f1 - f0)) : 1
      pose = { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share }
    }
    return pose
  }
  const up = new Set()
  const folds = []
  for (let frame = 0; frame < frames; frame++) {
    const { x, z } = positionAt(frame)
    const ci = cellAt(x)
    const cj = cellAt(z)
    for (let i = ci - 2; i <= ci + 2; i++) {
      for (let j = Math.max(FIRST_PAGE_ROW, cj - 2); j <= Math.min(LAST_PAGE_ROW, cj + 2); j++) {
        if (flatTile(layout.getCell(i, j).id)) continue
        const key = `${i},${j}`
        const distance = Math.hypot(x - i * TILE_SIZE, z - j * TILE_SIZE)
        if (up.has(key) && distance > downRadius) up.delete(key)
        else if (!up.has(key) && distance <= upRadius) {
          up.add(key)
          if (frame > 0) folds.push({ frame, i, j, t: frame / fps })
        }
      }
    }
  }
  return folds
}

// The 30 s duo route along the front book edge, then over an eastbound yarn bridge:
//   A leads east along the edge; Space swaps mid-walk; B (1.1 behind) steps one row north (perpendicular to the
//   old heading, so the pair never pass through each other), then leads east over the bridge, takes one step
//   toward the camera and stops; after 4 s idle both dance in canon (the follower starts 0.3125 s later).
// Everything is key driven at the default camera, so the plan is pure geometry on the deterministic layout.
export function planDuoCaptureRoute({ danceSeconds = 3, seeds = [112, ...Array.from({ length: 200 }, (_, i) => i)] } = {}) {
  const t = duoTiming
  const stride = walkSpeed / fps
  const edgeZ = PAGE_MAX_Z - 0.22
  const bridgeZ = LAST_PAGE_ROW * TILE_SIZE
  const northFrames = Math.round((edgeZ - bridgeZ) / stride)
  const tailFrames = Math.ceil((t.danceIdleSeconds + danceSeconds + t.followerDanceDelay + t.tailMarginSeconds) * fps)
  const total = duration * fps
  const clear = (layout, from, to, half) => bandClear(layout, from, to, half, 0.05)
  let best

  for (const seed of seeds) {
    const layout = createLayout(seed)
    for (let i = 4; i <= 40; i++) {
      const bridge = layout.getCell(i, LAST_PAGE_ROW)
      if (bridge.id !== 'yarn_bridge' || bridge.rotation !== 0) continue
      const bridgeX = i * TILE_SIZE
      const swapX = bridgeX - t.swapBeforeBridge
      const bStart = { x: swapX - t.followGap, z: edgeZ }
      const stop = { x: bridgeX + t.stopAfterBridge, z: bridgeZ }
      const eastFrames = Math.round((stop.x - bStart.x) / stride)
      // The frame the pair stand still: D is pressed at frame 1, A walks, swap, north step, east leg, face camera.
      const aFrames = total - tailFrames - t.faceCameraFrames - eastFrames - northFrames - t.swapKeyDelayFrames - 1
      if (aFrames < t.minAFrames) continue
      const start = { x: swapX - aFrames * stride, z: edgeZ, heading: Math.PI / 2, zoom: 1 }
      const behind = { x: start.x - t.followGap - 0.1, z: edgeZ }
      const faced = { x: stop.x, z: bridgeZ + t.faceCameraFrames * stride }
      const swapAt = { x: swapX, z: edgeZ }
      const northEnd = { x: bStart.x, z: bridgeZ }
      // Edge legs tolerate 0.1 either side; the bridge deck is 0.32 each side of its centre line.
      const legsClear = clear(layout, behind, swapAt, 0.1)
        && clear(layout, bStart, northEnd, 0.1)
        && clear(layout, northEnd, stop, 0.15)
        && clear(layout, stop, faced, 0.1)
        // Both idle slots (0.75 left and right of the leader along the camera's right vector) with a clear walk to them.
        && [-1, 1].every((side) => {
          const slot = { x: faced.x + side * 0.75, z: faced.z }
          return pathClear(layout, faced, slot) && pathClear(layout, { x: stop.x + side * 0.75, z: bridgeZ }, slot)
        })
      if (!legsClear) continue
      let edgeProps = 0
      for (let col = Math.floor((start.x + foldContract.upRadius) / TILE_SIZE) + 1; col * TILE_SIZE <= swapX; col++) {
        if (layout.getCell(col, LAST_PAGE_ROW).blockedRadius) edgeProps++
      }
      if (best && edgeProps <= best.edgeProps) continue

      const swapFrame = 1 + aFrames
      const northFrame = swapFrame + t.swapKeyDelayFrames
      const eastFrame = northFrame + northFrames
      const stopFrame = eastFrame + eastFrames
      const releaseFrame = stopFrame + t.faceCameraFrames
      const danceFrame = releaseFrame + t.danceIdleSeconds * fps
      const segments = [
        { leader: 'a', f0: 1, f1: swapFrame, from: start, to: swapAt },
        { leader: 'b', f0: northFrame, f1: eastFrame, from: bStart, to: northEnd },
        { leader: 'b', f0: eastFrame, f1: stopFrame, from: northEnd, to: stop },
        { leader: 'b', f0: stopFrame, f1: releaseFrame, from: stop, to: faced },
      ]
      const keys = [
        { frame: 1, down: ['KeyD'] },
        { frame: swapFrame, press: ['Space'] },
        { frame: northFrame, up: ['KeyD'], down: ['KeyW'] },
        { frame: eastFrame, up: ['KeyW'], down: ['KeyD'] },
        { frame: stopFrame, up: ['KeyD'], down: ['KeyS'] },
        { frame: releaseFrame, up: ['KeyS'] },
      ]
      const folds = plannedFoldUps(segments, layout)
      const bridgeFrames = [
        eastFrame + Math.round((bridgeX - 1 - bStart.x) / stride),
        eastFrame + Math.round((bridgeX + 1 - bStart.x) / stride),
      ]
      best = {
        seed, layout, bridgeX, bridgeZ, edgeZ, edgeProps, start, swapAt, bStart, northEnd, stop, faced,
        keys, segments, folds,
        frames: { swap: swapFrame, north: northFrame, east: eastFrame, bridge: bridgeFrames, stop: stopFrame,
          release: releaseFrame, dance: danceFrame, danceEnd: danceFrame + Math.ceil((danceSeconds + t.followerDanceDelay) * fps) },
        danceSeconds,
      }
    }
  }
  assert.ok(best, 'No clear page-edge route to an eastbound bridge in the duo capture seed search')
  assert.ok(best.folds.length >= t.minFoldUps, `Duo route plans only ${best.folds.length} fold-ups`)
  return best
}

export async function offlineAudio(page, filepath, clipStart, durationSec = duration, { stemsDir, baselineRev, ablationDir } = {}) {
  const folder = new URL('/__atlas_capture_audio/', page.url())
  await page.route(`${folder.href}*.js`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    assert.match(name, /^(index|music|sounds|samples)\.js$/)
    return route.fulfill({
      path: fileURLToPath(new URL(`../src/audio/${name}`, import.meta.url)),
      contentType: 'text/javascript',
    })
  })
  const { events, pops, cues } = await page.evaluate(({ clipStart, duration }) => {
    const atlas = window.__atlas
    const relative = (entries) => entries
      .filter(({ t }) => t >= clipStart && t < clipStart + duration)
      .map((event) => ({ ...event, t: event.t - clipStart }))
    return {
      events: relative(atlas.foldLog),
      pops: relative(atlas.popLog),
      cues: relative(atlas.cueLog).map((cue) => ({ ...cue, end: cue.end - clipStart })),
    }
  }, { clipStart, duration: durationSec })

  async function render(path, folds, sampleCues, { source = folder, baseline = false, chimesOnly = false } = {}) {
    const [download, result] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(async ({ source, duration, events, cues, baseline, chimesOnly }) => {
        const atlas = window.__atlas
        const { renderOffline, encodeWav } = await import(new URL('index.js', source))
        const manifestURL = new URL('audio/manifest.json', document.baseURI).href
        const sampleRate = 48_000
        const liveNotes = atlas.audioLog
        const notes = []
        atlas.audioLog = notes
        let buffer
        try {
          if (chimesOnly) {
            const { createScheduler } = await import(new URL('music.js', source))
            const { createSoundBank } = await import(new URL('sounds.js', source))
            const context = new OfflineAudioContext(2, Math.round(duration * sampleRate), sampleRate)
            const sound = createSoundBank(context)
            // Keep scheduler decisions from the full fold log, then omit pops from the mix.
            const ordered = events.toSorted((a, b) => a.t - b.t)
            for (const voice of ordered.flatMap(createScheduler())) {
              if (voice.kind === 'chime' && voice.t < duration) sound(voice, 0)
            }
            buffer = await context.startRendering()
          } else {
            // The pre-change renderer accepts a positional sample rate.
            buffer = await renderOffline(events, duration, baseline ? sampleRate : { cues, sampleRate, manifestURL })
          }
        } finally {
          atlas.audioLog = liveNotes
        }
        let peak = 0
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample))
        }
        const url = URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }))
        Object.assign(document.createElement('a'), { href: url, download: 'atlas.wav' }).click()
        return { notes, peakDbfs: peak > 0 ? 20 * Math.log10(peak) : null, url }
      }, { source: source.href, duration: durationSec, events: folds, cues: sampleCues, baseline, chimesOnly }),
    ])
    await download.saveAs(path)
    await page.evaluate((url) => URL.revokeObjectURL(url), result.url)
    return result
  }

  const full = await render(filepath, events, cues)
  const result = { events, pops, cues, notes: full.notes }
  if (!stemsDir && ablationDir) {
    // Without stems, still render each kind's ablation: a loud overlapping voice (B's sung dance) can hide a quieter
    // cue's onset in the final mix, and measureOnsets then checks the cue's own effect on the mix.
    await copyFile(filepath, join(ablationDir, 'full.wav'))
    for (const kind of cueKinds) {
      await render(join(ablationDir, `full-minus-${kind}.wav`), events, cues.filter((cue) => cue.kind !== kind))
    }
  }
  if (!stemsDir) return result

  const revision = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${baselineRev}^{commit}`],
    { encoding: 'utf8' }).trim()
  const baselineFolder = new URL('/__atlas_baseline_audio/', page.url())
  const modules = new Map(['index.js', 'music.js', 'sounds.js'].map((name) => [name,
    execFileSync('git', ['show', `${revision}:src/audio/${name}`], { encoding: 'utf8' })]))
  await page.route(`${baselineFolder.href}*.js`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    assert.ok(modules.has(name), `Unexpected baseline audio module ${name}`)
    return route.fulfill({ body: modules.get(name), contentType: 'text/javascript' })
  })

  const wav = (stem) => join(stemsDir, `${stem}.wav`)
  // The cue list behind every stem, so a stem's loudest moment can be traced to its cue.
  await writeJson(join(stemsDir, 'cues.json'), cues)
  await copyFile(filepath, wav('full'))
  const peaks = { full: full.peakDbfs }
  peaks.folds = (await render(wav('folds'), events, [])).peakDbfs
  peaks.chimes = (await render(wav('chimes'), events, [], { chimesOnly: true })).peakDbfs
  peaks.baseline = (await render(wav('baseline'), events, [], { source: baselineFolder, baseline: true })).peakDbfs
  await copyFile(wav('baseline'), wav('folds-baseline'))
  peaks['folds-baseline'] = peaks.baseline
  for (const kind of cueKinds) {
    peaks[kind] = (await render(wav(kind), [], cues.filter((cue) => cue.kind === kind))).peakDbfs
    const ablation = `full-minus-${kind}`
    peaks[ablation] = (await render(wav(ablation), events, cues.filter((cue) => cue.kind !== kind))).peakDbfs
  }
  return { ...result, peaks, baselineRev: revision }
}

function detectOnsets(pcm, ablated) {
  const rate = 48_000
  const channels = 2
  const sampleBytes = 4
  if (ablated) assert.equal(pcm.length, ablated.length, 'Ablation must have the same duration as the full mix')
  const windowSeconds = 0.005
  const windowBytes = windowSeconds * rate * channels * sampleBytes
  const onsets = []
  const envelope = []
  let previous = 0
  let prior = 0
  let peak = 0
  for (let offset = 0; offset + windowBytes <= pcm.length; offset += windowBytes) {
    let energy = 0
    for (let sample = offset; sample < offset + windowBytes; sample += sampleBytes) {
      const amplitude = pcm.readFloatLE(sample) - (ablated ? ablated.readFloatLE(sample) : 0)
      energy += amplitude ** 2
      peak = Math.max(peak, Math.abs(amplitude))
    }
    const rms = Math.sqrt(energy / (windowBytes / sampleBytes))
    envelope.push(rms)
    const t = offset / (rate * channels * sampleBytes)
    const risesFrom = (level) => rms - level > 0.0015 && rms > 1.45 * level
    const singleWindowRise = risesFrom(previous)
    // A quiet sample over a sustained note can take two windows to clear the threshold.
    const twoWindowRise = rms > previous && previous > prior && risesFrom(prior)
    const onset = singleWindowRise ? t : t - windowSeconds
    if ((singleWindowRise || twoWindowRise) && onset - (onsets.at(-1) ?? -1) >= 0.025) {
      onsets.push(onset)
    }
    prior = previous
    previous = rms
  }
  return { onsets, envelope, peak, windowSeconds }
}

export function measureOnsets(video, { events, notes, pops, cues }, { stemsDir, ablationDir } = {}) {
  const ablations = stemsDir ?? ablationDir
  const pcm = ffmpeg(['-i', video, '-map', '0:a:0', '-t', String(duration), '-ac', '2', '-ar', '48000',
    '-f', 'f32le', 'pipe:1'])
  const { onsets, envelope, peak, windowSeconds } = detectOnsets(pcm)
  const voices = events.flatMap(createScheduler()).filter(({ t }) => t < duration).sort((a, b) => a.t - b.t)
  const chimes = voices.filter(({ kind }) => kind === 'chime')
  assert.deepEqual(notes.map(({ t, midi, harmony }) => [t, midi, harmony]),
    chimes.map(({ t, midi, harmony }) => [t, midi, harmony]),
    'Offline notes differ from the game scheduler')
  const scheduledPops = voices.filter(({ kind }) => kind === 'pop')
  assert.deepEqual(pops.map(({ t, dir, id }) => [t, dir, id]),
    scheduledPops.map(({ t, dir, id }) => [t, dir, id]),
    'Offline pops differ from the live pop log')
  const tolerance = 0.025
  const matches = (sounds, times = onsets) => sounds.filter(({ t }) => times.some((onset) => Math.abs(onset - t) <= tolerance))
  const required = {
    chime: [chimes],
    pop: [scheduledPops],
    footstep: [cues.filter(({ cause, file }) => cause === 'step' && file !== null), 'step'],
    foldLayer: [cues.filter(({ cause }) => cause === 'fold'), 'sfx'],
    // Round 5: whoever leads sings the dance, A with sing_*, B with b_sing_*.
    sing_ta: [cues.filter(({ cue }) => /^(b_)?sing_ta$/.test(cue)), 'voice'],
    sing_da: [cues.filter(({ cue }) => /^(b_)?sing_da$/.test(cue)), 'voice'],
    chorus_yay: [cues.filter(({ cue }) => cue === 'chorus_yay'), 'chorus'],
  }
  const matchedByAblation = {}
  let fullPcm
  const matchedByCategory = Object.fromEntries(Object.entries(required).map(([name, [sounds, kind]]) => {
    let matched = matches(sounds)
    if (!matched.length && sounds.length && ablations && kind) {
      // A louder overlapping cue can mask the rise in the final mix. Check the cue's effect on the mix directly.
      fullPcm ??= decodeAudio(join(ablations, 'full.wav'))
      const ablation = `full-minus-${kind}.wav`
      const difference = detectOnsets(fullPcm, decodeAudio(join(ablations, ablation)))
      matched = matches(sounds, difference.onsets)
      if (matched.length) matchedByAblation[name] = `full.wav minus ${ablation} (before AAC)`
    }
    if (!matched.length) {
      const nearby = sounds.slice(0, 1).map(({ t }) => {
        const index = Math.round(t / windowSeconds)
        const rms = envelope.slice(Math.max(0, index - 5), index + 6)
        return { t, rms: rms.map((value) => Number(value.toFixed(4))) }
      })
      assert.fail(`Capture needs a logged ${name} with an onset within 25 ms (${sounds.length} scheduled). ${JSON.stringify(nearby)}`)
    }
    return [name, matched.length]
  }))
  if (!stemsDir) assert.ok(peak <= 10 ** (-1 / 20), `Decoded AAC peak is ${(20 * Math.log10(peak)).toFixed(2)} dBFS`)
  return {
    source: 'Decoded AAC stream of gameplay-30s.mp4',
    method: 'Stereo 5 ms RMS windows. A rise greater than 0.0015 and 1.45x prior RMS over one or two rising windows, spaced at least 25 ms apart.',
    foldUpEvents: events.filter(({ dir }) => dir === 'up').length,
    foldDownEvents: events.filter(({ dir }) => dir === 'down').length,
    scheduledChimes: chimes.length,
    scheduledFoldUpPops: voices.filter(({ kind, dir }) => kind === 'pop' && dir === 'up').length,
    scheduledFoldDownPops: voices.filter(({ kind, dir }) => kind === 'pop' && dir === 'down').length,
    scheduledSounds: voices.length,
    detectedOnsets: onsets.length,
    scheduledCues: cues.length,
    matchedWithin25ms: matches(voices).length,
    matchedByCategory,
    ...(ablations && { matchedByAblation }),
    peakDbfs: 20 * Math.log10(peak),
    note: 'Voice limits drop some pops and merge chimes on the same eighth-note slot. Simultaneous voices can produce one energy onset.',
    onsetTimesSec: onsets,
  }
}

// DUO-34..36 on every captured frame: the verdict of the capture's framing check.
export function framingVerdict(stats) {
  const limit = stats.limitFrames
  const problems = []
  if (stats.outsideFrames) problems.push(`${stats.outsideFrames} frames with a character outside the frame (first: ${JSON.stringify(stats.firstOutside[0])})`)
  if (stats.longestOverlapFrames > limit) {
    problems.push(`follower covered > ${duoContract.overlapShare * 100} % of the leader for ${stats.longestOverlapFrames} frames at frame ${stats.longestOverlapAt} (limit ${limit})`)
  }
  for (const label of ['a', 'b']) {
    if (stats.longestHiddenFrames[label] > limit) {
      problems.push(`troll ${label} hidden behind tiles for ${stats.longestHiddenFrames[label]} frames at frame ${stats.longestHiddenAt[label]} (limit ${limit})`)
    }
  }
  return { pass: problems.length === 0, problems }
}

const round1 = (value) => Math.round(value * 10) / 10
const roundRect = (rect) => rect.map(round1)

export async function runDuoCaptureRoute({ page, open, advance }, baseURL, captureFrame) {
  const plan = planDuoCaptureRoute()
  const { seed, layout, start, frames: planned } = plan
  const total = duration * fps
  const url = new URL(baseURL)
  url.searchParams.set('seed', seed)
  // Default camera (distance 10, pitch 45) and focus: the framing the gate checks.
  for (const name of ['cam', 'focus', 'debug', 'plain']) url.searchParams.delete(name)
  url.searchParams.set('look-shots', '')
  url.searchParams.set('look-probe', '')
  const clipStart = (preRollFrames + 1) / fps
  const actionsAt = new Map(plan.keys.map((action) => [action.frame, action]))
  const trace = []
  const swapMarks = []
  let bridgeFrames = 0
  let danceRun = 0
  let danceFrames = 0
  let completeDance = false
  let firstLeaderDance
  let firstFollowerDance
  let idleSince

  await serveThree(page)
  await open(url.href)
  await page.waitForFunction(() => Number.isFinite(window.__atlas.audioReadyMs), undefined,
    { polling: 50, timeout: 30_000 })
  const expectedDanceSeconds = await readDanceSeconds(page)
  assert.ok(expectedDanceSeconds <= plan.danceSeconds,
    `The dance clip lasts ${expectedDanceSeconds}s, the duo route reserves ${plan.danceSeconds}s`)
  await page.waitForFunction(() => window.__atlasLookShots?.scene, undefined, { polling: 50, timeout: 5000 })
  // A leads at load, so the probe can tell the rigs apart by their distance to the leader.
  await installProbe(page)
  await page.evaluate((pose) => window.__atlasLookShots.pose(pose), start)
  await advance(1, fps, preRollFrames)
  assert.ok(await page.evaluate(() => window.__atlasLookShots.cameraSettled()), 'Capture camera did not settle')
  const initial = await page.evaluate(() => window.__duoProbe.peek())
  const gap = Math.hypot(initial.L.x - initial.F.x, initial.L.z - initial.F.z)
  // After the pre-roll standing B has taken its idle slot, 0.75 to the screen left or right of A (west: B starts behind A).
  const west = initial.F.x < initial.L.x
  assert.ok(initial.leader === 'a' && west && gap > 0.7 && gap < 1.4,
    `Duo did not start as A leading with B beside or behind it, to the west: ${JSON.stringify({ leader: initial.leader, gap, west })}`)
  await page.evaluate(() => { window.__atlas.foldLog.length = 0 })

  for (let frame = 0; frame < total; frame++) {
    const action = actionsAt.get(frame)
    for (const code of action?.up ?? []) await page.keyboard.up(code)
    for (const code of action?.down ?? []) await page.keyboard.down(code)
    for (const code of action?.press ?? []) {
      await page.keyboard.press(code)
      swapMarks.push(frame)
    }
    if (frame === 1) await page.waitForFunction(() => window.__atlasAudioUnlocked, undefined, { polling: 50, timeout: 5000 })
    await advance(preRollFrames + 1 + frame, fps)
    const s = await page.evaluate((n) => window.__duoProbe.sample(n), frame)
    trace.push(s)
    if (captureFrame) await captureFrame(frame)

    if (frame === plan.keys[1].frame + duoTiming.swapKeyDelayFrames + 1) {
      assert.ok(s.swaps === 1 && s.leader === 'b', `Space did not swap the lead: ${JSON.stringify({ swaps: s.swaps, leader: s.leader })}`)
    }
    if (s.leader === 'b' && s.L.state === 'walk') {
      const row = Math.min(LAST_PAGE_ROW, cellAt(s.L.z))
      if (layout.getCell(cellAt(s.L.x), row).id === 'yarn_bridge') bridgeFrames++
    }
    if (frame >= planned.release) {
      if (s.L.state === 'idle') idleSince ??= frame
      if (s.L.state === 'dance') firstLeaderDance ??= frame
      if (s.F.state === 'dance') firstFollowerDance ??= frame
      if (s.L.state === 'dance') danceRun++
      else if (danceRun) {
        danceFrames = danceRun
        completeDance = s.L.state === 'idle'
        danceRun = 0
      }
    }
  }

  const final = trace.at(-1)
  assert.equal(final.swaps, 1, 'The route must swap the lead exactly once')
  assert.equal(final.leader, 'b', 'B must be leading at the end of the route')
  assert.ok(final.samePlayer, '__atlas.player changed identity')
  assert.ok(bridgeFrames > 0, 'B did not lead across the yarn bridge')
  const stopAt = trace[planned.release]
  assert.ok(Math.hypot(stopAt.L.x - plan.faced.x, stopAt.L.z - plan.faced.z) < 0.5,
    `Leader missed the dance spot: ${JSON.stringify(stopAt.L)} vs ${JSON.stringify(plan.faced)}`)
  assert.ok(firstLeaderDance !== undefined && idleSince !== undefined
    && (firstLeaderDance - idleSince) / fps >= duoTiming.danceIdleSeconds - 2 / fps,
  `Leader danced after ${((firstLeaderDance ?? NaN) - (idleSince ?? NaN)) / fps}s idle, expected >= ${duoTiming.danceIdleSeconds}s`)
  assert.ok(completeDance && Math.abs(danceFrames / fps - expectedDanceSeconds) <= 2 / fps,
    `Dance lasted ${danceFrames / fps}s, expected the full ${expectedDanceSeconds}s clip`)
  const followerDelay = (firstFollowerDance - firstLeaderDance) / fps
  assert.ok(firstFollowerDance !== undefined && Math.abs(followerDelay - duoTiming.followerDanceDelay) <= duoContract.danceDelayTolerance + 1 / fps,
    `Follower started the dance ${followerDelay}s after the leader, expected ${duoTiming.followerDanceDelay}s`)
  const foldUps = await page.evaluate(() => window.__atlas.foldLog.filter(({ dir }) => dir === 'up').map(({ t }) => t))
  assert.ok(foldUps.length >= duoTiming.minFoldUps, `Only ${foldUps.length} fold-ups in the capture`)

  const stats = framingStats(trace, { fps, contract: duoContract })
  const verdict = framingVerdict(stats)
  const framing = {
    contract: 'docs/contracts.md "Round 5: duo", DUO-34..36 (DUO-40 capture framing)',
    viewport: final.view,
    camera: 'default (no ?cam, distance 10, pitch 45)',
    limits: { stretchSeconds: duoContract.stretchSeconds, overlapShare: duoContract.overlapShare },
    ...stats,
    ...verdict,
    perFrame: {
      columns: ['f', 'leader', 'leaderState', 'followerState', 'aRect', 'bRect', 'aHidden', 'bHidden', 'followerOverlapShare', 'gap'],
      rows: trace.map((s) => {
        const [leader, follower] = s.leader === 'b' ? ['b', 'a'] : ['a', 'b']
        return [s.f, s.leader, s.L.state, s.F.state, roundRect(s.a.rect), roundRect(s.b.rect), s.a.hidden, s.b.hidden,
          Math.round(overlapShare(s[follower].rect, s[leader].rect) * 100) / 100,
          Math.round(Math.hypot(s.L.x - s.F.x, s.L.z - s.F.z) * 100) / 100]
      }),
    },
  }
  return {
    clipStart,
    framing,
    route: {
      seed, headless, camera: 'default', start, plan: {
        swapAt: plan.swapAt, bStart: plan.bStart, stop: plan.stop, faced: plan.faced, frames: planned,
        plannedFoldUps: plan.folds.length,
      },
      swapPressedAtFrame: swapMarks, swapAtSec: planned.swap / fps, bridgeSeconds: bridgeFrames / fps,
      idleBeforeDanceSeconds: (firstLeaderDance - idleSince) / fps, danceSeconds: danceFrames / fps, expectedDanceSeconds,
      followerDanceDelaySeconds: followerDelay, foldUps: foldUps.length, foldUpTimesSec: foldUps.map((t) => round1(t - clipStart)),
    },
  }
}

export async function runCaptureRoute(session, baseURL, captureFrame, { round = defaultRound } = {}) {
  if (round >= duoRound) return runDuoCaptureRoute(session, baseURL, captureFrame)
  return runClassicCaptureRoute(session, baseURL, captureFrame)
}

async function runClassicCaptureRoute({ page, open, advance }, baseURL, captureFrame) {
  const { seed, layout, start, approach, clickTarget, edgeFrames, alignFrames, approachFrames } = planCaptureRoute()
  const { width, height } = page.viewportSize()
  const url = new URL(baseURL)
  url.searchParams.set('seed', seed)
  url.searchParams.set('cam', `${cameraDistance},${cameraPitch}`)
  url.searchParams.set('look-shots', '')
  url.searchParams.delete('debug')
  url.searchParams.delete('plain')
  const click = edgeFrames + alignFrames + approachFrames
  const clipStart = (preRollFrames + 1) / fps
  let danceFrames = 0
  let danceRun = 0
  let completeDance = false
  let bridgeFrames = 0
  let edgeEnd
  let clickedFrom
  let arrival
  await open(url.href)
  await page.waitForFunction(() => Number.isFinite(window.__atlas.audioReadyMs), undefined,
    { polling: 50, timeout: 30_000 })
  const expectedDanceSeconds = await readDanceSeconds(page)
  await page.waitForFunction(() => window.__atlasLookShots, undefined, { polling: 50, timeout: 5000 })
  await page.evaluate((pose) => window.__atlasLookShots.pose(pose), start)
  await advance(1, fps, preRollFrames)
  assert.ok(await page.evaluate(() => window.__atlasLookShots.cameraSettled()), 'Capture camera did not settle')
  await page.evaluate(() => { window.__atlas.foldLog.length = 0 })

  const player = () => page.evaluate(() => ({ ...window.__atlas.player }))
  for (let frame = 0; frame < duration * fps; frame++) {
    if (frame === 1) {
      await page.keyboard.down('KeyD')
      await page.waitForFunction(() => window.__atlasAudioUnlocked, undefined, { polling: 50, timeout: 5000 })
    }
    if (frame === edgeFrames + 1) {
      edgeEnd = await player()
      await page.keyboard.down('KeyW')
    }
    if (frame === edgeFrames + alignFrames + 1) await page.keyboard.up('KeyW')
    if (frame === click + 1) {
      await page.keyboard.up('KeyD')
      clickedFrom = await player()
      // The camera follows 0.25 s behind the eastbound troll. At mid-height
      // the ray lands on the camera target's Z, already aligned with the bridge.
      assert.ok(Math.hypot(clickedFrom.x - approach.x, clickedFrom.z - approach.z) < 0.08,
        `Troll did not reach the bridge approach: ${JSON.stringify(clickedFrom)}`)
      const cameraX = clickedFrom.x - (walkSpeed / fps) / Math.expm1(1 / (fps * 0.25))
      const x = width / 2
        + (clickTarget.x - cameraX) * height / (2 * cameraDistance * Math.tan(Math.PI / 12))
      assert.ok(x > 0 && x < width, `Bridge click projected outside the canvas at x=${x}`)
      await page.mouse.click(x, height / 2)
    }
    if (frame === faceCameraFrame) {
      assert.ok(arrival, 'Click walk did not finish before the dance staging step')
      await page.keyboard.down('KeyS')
    }
    if (frame === faceCameraFrame + faceCameraFrames) await page.keyboard.up('KeyS')
    await advance(preRollFrames + 1 + frame, fps)
    if (captureFrame) await captureFrame(frame)
    if (frame > click) {
      const pose = await player()
      if (!arrival && pose.state === 'idle') arrival = pose
      if (pose.state === 'walk' && layout.getCell(cellAt(pose.x), cellAt(pose.z)).id === 'yarn_bridge') {
        bridgeFrames++
      }
      if (pose.state === 'dance') danceRun++
      else if (danceRun) {
        danceFrames = danceRun
        completeDance = pose.state === 'idle'
        danceRun = 0
      }
    }
  }
  assert.ok(edgeEnd && edgeEnd.x - start.x >= 15 && Math.abs(edgeEnd.z - start.z) < 0.05,
    'Route did not follow the front book edge')
  assert.ok(arrival && Math.hypot(arrival.x - clickTarget.x, arrival.z - clickTarget.z) <= 0.5,
    `Click from ${JSON.stringify(clickedFrom)} missed: ${JSON.stringify(arrival)}`)
  assert.ok(bridgeFrames > 0, 'Route did not cross a yarn bridge')
  assert.ok(completeDance && Math.abs(danceFrames / fps - expectedDanceSeconds) <= 2 / fps,
    `Dance lasted ${danceFrames / fps}s, expected the full ${expectedDanceSeconds}s clip`)
  return {
    clipStart,
    route: {
      seed, headless, camera: [cameraDistance, cameraPitch], start, edgeEnd, clickedFrom, arrival,
      bridgeSeconds: bridgeFrames / fps, danceSeconds: danceFrames / fps, expectedDanceSeconds,
    },
  }
}

async function capture({ baseURL, round, roundDir, evidence, stems, baselineRev }) {
  await Promise.all([mkdir(roundDir, { recursive: true }), mkdir(evidence, { recursive: true })])
  const temp = await mkdtemp(join(tmpdir(), 'atlas-capture-'))
  const stagedDir = join(temp, 'deliverables')
  const stemsDir = stems ? join(stagedDir, 'audio') : undefined
  const video = join(temp, 'gameplay-30s.mp4')
  const wav = join(temp, 'audio.wav')
  const ablationDir = !stems && round >= duoRound ? join(temp, 'ablation') : undefined
  let audio
  let route
  try {
    if (stemsDir) await mkdir(stemsDir, { recursive: true })
    if (ablationDir) await mkdir(ablationDir, { recursive: true })
    const browser = headless && process.platform === 'darwin'
      ? await chromium.launch({ headless: true, args: ['--use-angle=metal'] })
      : await launchChromium()
    try {
      const stepped = await createSteppedPage(browser, viewport, { waitForAudio: true })
      const { page, errors } = stepped
      const gameplay = await runCaptureRoute(stepped, baseURL, async (frame) => {
        await page.screenshot({ path: join(temp, `frame-${String(frame).padStart(4, '0')}.jpg`),
          type: 'jpeg', quality: 94, timeout: 15_000 })
        if ((frame + 1) % 120 === 0) console.log(`Captured ${frame + 1}/${duration * fps} frames`)
      }, { round })
      route = gameplay.route
      if (gameplay.framing) {
        // Written before the verdict is enforced, so a failing run leaves its per-frame evidence behind.
        await writeJson(join(evidence, 'capture-framing.json'), gameplay.framing)
        const { pass, problems } = gameplay.framing
        assert.ok(pass, `Duo framing check failed (see ${join(evidence, 'capture-framing.json')}): ${problems.join('; ')}`)
        const { perFrame, ...summary } = gameplay.framing
        route.framing = summary
      }
      audio = await offlineAudio(page, wav, gameplay.clipStart, duration, { stemsDir, baselineRev, ablationDir })
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

    const onsets = measureOnsets(video, audio, { stemsDir, ablationDir })
    onsets.route = route
    if (round >= duoRound) {
      assert.ok(onsets.scheduledChimes >= duoTiming.minFoldUps && onsets.foldUpEvents >= duoTiming.minFoldUps,
        `Duo capture needs >= ${duoTiming.minFoldUps} fold-ups with chimes, got ${onsets.foldUpEvents} and ${onsets.scheduledChimes}`)
    }
    const output = join(roundDir, 'gameplay-30s.mp4')
    if (stemsDir) {
      const mix = mixReport(audio.peaks, masterMetrics(decodeAudio(video)), audio.baselineRev)
      await writeJson(join(stemsDir, 'mix.json'), mix)
      await writeCriticPairs(stagedDir, roundDir)
      // Publish the validated encode and its critic inputs after all renders succeed.
      await rename(video, join(stagedDir, 'gameplay-30s.mp4'))
      await cp(stagedDir, roundDir, { recursive: true })
      console.log(JSON.stringify(mix))
    } else {
      await copyFile(video, output)
    }
    probe.format.filename = output
    await writeJson(join(evidence, 'capture-ffprobe.json'), probe)
    await writeJson(join(evidence, 'capture-onsets.json'), onsets)
    ffmpeg(['-i', output, '-vf', 'fps=2/5,scale=320:180,tile=4x3:padding=4:margin=4',
      '-frames:v', '1', join(evidence, 'capture-contact-sheet.png')])
    console.log(JSON.stringify({ output, duration: probe.format.duration, fps, ...onsets, onsetTimesSec: undefined }))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await capture(roundOptions('capture'))
}
