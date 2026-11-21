import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createLayout } from '../src/world/layout.js'
import { cellAt } from '../src/world/tiles.js'

const baseURL = process.argv[2] ?? 'http://localhost:4173'
const out = resolve('.handoff/evidence/T7')
const viewport = { width: 1280, height: 720 }
const seed = 42
const shots = [
  { name: 'establishing', x: 24.8, z: 2.1, zoom: 0.91, heading: 0.52 },
  { name: 'troll', x: 31.1, z: -3.2, zoom: 2.14, heading: 0.62 },
  { name: 'river-bridge', x: 22.25, z: 4.1, zoom: 2.05, heading: 0.82, model: 'yarn_bridge' },
]

const layout = createLayout(seed)
for (const { x, z, name, model } of shots) {
  assert(!layout.isBlocked(x, z), `${name} pose is blocked`)
  if (model) assert.equal(layout.getCell(cellAt(x), cellAt(z)).id, model)
}

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: false })
try {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    const { url } = message.location()
    if (message.type() === 'error' && !url.endsWith('/favicon.ico')) errors.push(`${url} ${message.text()}`)
  })

  for (const plain of [false, true]) {
    const url = new URL(baseURL)
    url.searchParams.set('look-shots', '')
    if (plain) url.searchParams.set('plain', '')

    for (const shot of shots) {
      errors.length = 0
      await page.goto(url.href)
      await page.waitForFunction(() => window.__atlasLookShots && window.__atlas?.hairBones.length === 4)
      await page.evaluate((shot) => window.__atlasLookShots.pose(shot), shot)
      await page.waitForFunction(() => window.__atlasLookShots.cameraSettled())
      // Streaming culls against the current camera when rebuilding the cell range.
      await page.evaluate((seed) => window.__atlas.setSeed(seed), seed)
      await page.keyboard.press('Shift')
      await page.waitForFunction(({ model, x, z }) => {
        const debug = window.__atlas
        const posed = debug.player.x === x && debug.player.z === z
        return posed && debug.foldLog.length > 0 && window.__atlasLookShots.hasModel('page_a') &&
          (!model || window.__atlasLookShots.hasModel(model))
      }, shot)
      // Let the camera and pop-up hinges settle before the idle dance starts.
      await page.waitForTimeout(1700)
      assert.deepEqual(errors, [], `Rendering errors in ${shot.name}`)
      await page.screenshot({ path: resolve(out, `${shot.name}${plain ? '-plain' : ''}.png`) })
    }
  }
} finally {
  await browser.close()
}
