import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { CHUNK_SIZE } from '../src/world/layout.js'
import { PAGE_MAX_Z, TILE_SIZE } from '../src/world/tiles.js'
import { DEFAULT_EFFECTS } from '../src/effects/flags.js'
import { DEFAULT_LOOK_OFF, look } from '../src/materials/stage-look.js'
import { effectiveFlags, perfMisses, pb6Comparison, pb6Misses } from './perf-contract.mjs'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    // The PB6 baseline run (fa6d96b, same host, route and DPR) as a perf JSON; round 6 compares p95 against it.
    baseline: { type: 'string', default: 'deliverables/round-6/perf-baseline.json' },
    // The commit the served build was made from, when it is not this checkout's HEAD.
    commit: { type: 'string' },
  },
})
if (positionals.length > 1) throw new Error('Usage: node scripts/perf.mjs [URL] [--out PATH] [--baseline PATH] [--commit REV]')

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}
let baseline = null
try {
  baseline = JSON.parse(await readFile(values.baseline, 'utf8'))
} catch {
  // No baseline file: the PB6 comparison is recorded as not judged.
}

const url = new URL(positionals[0] ?? 'http://localhost:4173')
url.searchParams.set('look-shots', '')
url.searchParams.set('seed', '112')
for (const flag of ['plain', 'debug', 'effects', 'lookOff']) url.searchParams.delete(flag)
const viewport = { width: 1280, height: 720 }
const warmupMs = 3_000
const routeMs = 60_000
// Start just west of a chunk seam on seed 112's clear front edge.
const startPose = { x: 30.5, z: PAGE_MAX_Z - 0.02, zoom: 1, heading: Math.PI / 2 }

function sampleFrames(page, duration, trackChunks = false) {
  return page.evaluate(({ ms, trackChunks, cellOffset, chunkSpan }) => new Promise((resolve) => {
    const deltas = []
    const chunks = []
    const player = window.__atlas.player
    function visitChunk() {
      const x = Math.floor((player.x + cellOffset) / chunkSpan)
      const z = Math.floor((player.z + cellOffset) / chunkSpan)
      const previous = chunks.at(-1)
      if (!previous || previous[0] !== x || previous[1] !== z) chunks.push([x, z])
    }
    requestAnimationFrame((start) => {
      let previous = start
      if (trackChunks) visitChunk()
      function sample(now) {
        deltas.push(now - previous)
        previous = now
        if (trackChunks) visitChunk()
        if (now - start < ms) requestAnimationFrame(sample)
        else resolve({ deltas, chunks })
      }
      requestAnimationFrame(sample)
    })
  }), { ms: duration, trackChunks, cellOffset: TILE_SIZE / 2, chunkSpan: CHUNK_SIZE * TILE_SIZE })
}

function summarize(deltas) {
  const sorted = deltas.toSorted((a, b) => a - b)
  const frames = sorted.length
  const p = (fraction) => sorted[Math.ceil(fraction * frames) - 1]
  const middle = Math.floor(frames / 2)
  const median = frames % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return {
    frames,
    median,
    p95: p(0.95),
    p99: p(0.99),
    max: sorted.at(-1),
    pct_over_20ms: 100 * sorted.filter((delta) => delta > 20).length / frames,
    frames_over_50ms: sorted.filter((delta) => delta > 50).length,
  }
}

// The flags the page runs with: perf drops `effects` and `lookOff` from the URL, so these are the shipped defaults.
const flags = effectiveFlags(url.search, { defaultEffects: DEFAULT_EFFECTS, defaultLookOff: DEFAULT_LOOK_OFF, lookNames: Object.keys(look) })
const results = {
  url: url.href,
  commit: values.commit ?? git('rev-parse', 'HEAD'),
  commit_source: values.commit ? '--commit' : 'checkout HEAD',
  dirty: Boolean(git('status', '--porcelain', '--untracked-files=no')),
  flags,
  pb6_baseline: baseline ? { file: values.baseline, url: baseline.url ?? null, machine_model: baseline.machine_model ?? null } : null,
  viewport,
  warmup_seconds: warmupMs / 1000,
  route_seconds: routeMs / 1000,
  timing_unit: 'ms',
  machine_model: process.platform === 'darwin'
    ? execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim()
    : null,
  runs: [],
}

const browser = await chromium.launch({ headless: false })
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: dpr })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().startsWith('THREE.')) errors.push(message.text())
    })
    await page.goto(url.href)
    await page.waitForFunction(() => window.__atlas?.player)
    // Steady-state budget starts once assets are loaded and shaders compiled; load time is reported separately.
    await page.waitForFunction(() => window.__atlas.ready, undefined, { timeout: 30_000 })
    const loadMs = await page.evaluate(() => window.__atlas.loadMs)
    await page.bringToFront()
    await page.waitForFunction(() => window.__atlasLookShots)
    await page.evaluate((pose) => window.__atlasLookShots.pose(pose), startPose)
    await page.keyboard.press('Shift')
    const device = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      const gl = canvas.getContext('webgl2')
      const extension = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        dpr: devicePixelRatio,
        framebuffer: { width: canvas.width, height: canvas.height },
        user_agent: navigator.userAgent,
        gpu_renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      }
    })
    const warmup = summarize((await sampleFrames(page, warmupMs)).deltas)
    await page.keyboard.down('KeyD')
    const { deltas, chunks } = await sampleFrames(page, routeMs, true)
    await page.keyboard.up('KeyD')
    const audioReadyMs = await page.evaluate(() => window.__atlas.audioReadyMs ?? null)
    if (errors.length) throw new Error(errors.join('\n'))
    const run = {
      ...device,
      estimated_refresh_hz: Math.round(1000 / warmup.median),
      load_ms: loadMs,
      audio_ready_ms: audioReadyMs,
      chunks_crossed: new Set(chunks.map((chunk) => chunk.join(','))).size,
      chunk_itinerary: chunks,
      ...summarize(deltas),
    }
    run.pb6 = pb6Comparison(run, baseline)
    run.misses = [...perfMisses(run), ...pb6Misses(run.pb6)]
    results.runs.push(run)
    await page.close()
  }
} finally {
  await browser.close()
}

const json = JSON.stringify(results, null, 2) + '\n'
if (values.out) {
  await mkdir(dirname(values.out), { recursive: true })
  await writeFile(values.out, json)
}
process.stdout.write(json)
for (const { dpr, misses } of results.runs) {
  for (const miss of misses) process.stderr.write(`DPR ${dpr}: ${miss}\n`)
  if (misses.length) process.exitCode = 1
}
