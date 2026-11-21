import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' } },
})
if (positionals.length > 1) throw new Error('Usage: node scripts/perf.mjs [URL] [--out PATH]')

const url = positionals[0] ?? 'http://localhost:4173'
const viewport = { width: 1280, height: 720 }
const route = [
  { keys: ['KeyW'], ms: 15_000 },
  { keys: ['KeyW', 'KeyD'], ms: 15_000 },
  { keys: ['KeyD'], ms: 15_000 },
  { keys: ['KeyW', 'KeyD'], ms: 15_000 },
]
const warmupMs = 3_000
const routeMs = route.reduce((total, leg) => total + leg.ms, 0)

async function playRoute(keyboard) {
  let held = []
  for (const { keys, ms } of route) {
    for (const key of held) if (!keys.includes(key)) await keyboard.up(key)
    for (const key of keys) if (!held.includes(key)) await keyboard.down(key)
    held = keys
    await delay(ms)
  }
  for (const key of held) await keyboard.up(key)
}

function frameDeltas(page, duration) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const deltas = []
    requestAnimationFrame((start) => {
      let previous = start
      function sample(now) {
        deltas.push(now - previous)
        previous = now
        if (now - start < ms) requestAnimationFrame(sample)
        else resolve(deltas)
      }
      requestAnimationFrame(sample)
    })
  }), duration)
}

function summarize(deltas) {
  const sorted = deltas.toSorted((a, b) => a - b)
  const frames = sorted.length
  const p = (fraction) => sorted[Math.ceil(fraction * frames) - 1]
  const round = (value) => Number(value.toFixed(3))
  const middle = Math.floor(frames / 2)
  const median = frames % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return {
    frames,
    median: round(median),
    p95: round(p(0.95)),
    p99: round(p(0.99)),
    max: round(sorted.at(-1)),
    pct_over_20ms: round(100 * sorted.filter((delta) => delta > 20).length / frames),
    frames_over_50ms: sorted.filter((delta) => delta > 50).length,
  }
}

const results = {
  url,
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
    await page.goto(url)
    await page.waitForFunction(() => window.__atlas?.player)
    // Steady-state budget starts once assets are loaded and shaders compiled; load time is reported separately.
    await page.waitForFunction(() => window.__atlas.ready, undefined, { timeout: 30_000 })
    const loadMs = await page.evaluate(() => window.__atlas.loadMs)
    await page.bringToFront()
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
    const warmup = summarize(await frameDeltas(page, warmupMs))
    const [deltas] = await Promise.all([frameDeltas(page, routeMs), playRoute(page.keyboard)])
    if (errors.length) throw new Error(errors.join('\n'))
    results.runs.push({
      ...device,
      estimated_refresh_hz: Math.round(1000 / warmup.median),
      load_ms: loadMs,
      ...summarize(deltas),
    })
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
