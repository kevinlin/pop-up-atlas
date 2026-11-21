import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173'
const viewport = { width: 1280, height: 720 }
const evidence = new URL('../.handoff/evidence/T8/', import.meta.url)
const screenshotPath = (name) => fileURLToPath(new URL(`${name}.png`, evidence))
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: false })
try {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => window.__atlas?.hairBones.length === 4
    && window.__atlas.hairBones.every(({ y }) => y > 0))

  const player = () => page.evaluate(() => ({ ...window.__atlas.player }))
  const start = await player()
  await page.keyboard.down('KeyW')
  const [walk, , hairMotion] = await Promise.all([
    delay(3000).then(async () => {
      const snapshot = await player()
      await page.keyboard.up('KeyW')
      return snapshot
    }),
    delay(2000).then(() => page.screenshot({ path: screenshotPath('walk') })),
    page.evaluate(() => new Promise((resolve) => {
      let initial
      let maxOffset = 0
      const start = performance.now()
      function sample(now) {
        const { player, hairBones } = window.__atlas
        if (now - start >= 400 && player.state === 'walk') {
          const tip = hairBones[3]
          // Exclude player translation so a rigid rig cannot pass the check.
          const offset = [tip.x - player.x, tip.y, tip.z - player.z]
          initial ??= offset
          maxOffset = Math.max(maxOffset, Math.hypot(...offset.map((v, i) => v - initial[i])))
        }
        if (now - start < 2900) requestAnimationFrame(sample)
        else resolve(maxOffset)
      }
      requestAnimationFrame(sample)
    })),
  ])
  const walked = distance(start, walk)
  assert.equal(walk.state, 'walk')
  assert.ok(walked > 2, `Walked ${walked.toFixed(3)} units, expected more than 2`)
  assert.ok(hairMotion > 0.03, `Hair moved ${hairMotion.toFixed(3)} units relative to the player`)

  await delay(5000)
  const dance = await player()
  assert.equal(dance.state, 'dance')
  await page.screenshot({ path: screenshotPath('dance') })

  // The settled 45° camera follows the player. Project a point 3 units north
  // along the open spawn corridor using the camera's 14-unit distance and 30° FOV.
  const target = { x: dance.x, z: dance.z - 3 }
  const rise = 3 * Math.SQRT1_2
  const ndcY = rise / ((10 + rise) * Math.tan(Math.PI / 12))
  await page.mouse.click(viewport.width / 2, viewport.height * (1 - ndcY) / 2)
  await page.waitForFunction(() => window.__atlas.player.state === 'walk', undefined, { timeout: 1000 })
  await page.waitForFunction(({ x, z }) => {
    const player = window.__atlas.player
    return player.state === 'idle' && Math.hypot(player.x - x, player.z - z) <= 0.5
  }, target, { timeout: 7000 })
  const clickError = distance(await player(), target)

  assert.deepEqual(errors, [])
  console.log(`Walked ${walked.toFixed(3)} units, hair moved ${hairMotion.toFixed(3)} units, click error ${clickError.toFixed(3)} units`)
} finally {
  await browser.close()
}
