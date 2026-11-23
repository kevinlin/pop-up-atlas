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

  // Round 6: the walk camera is 7.5 units out at 35° (the fit may only raise the distance) and the duo dance beat (4.5 units, 22°)
  // eases out 0.8 s after the dance, so wait for the dance and the beat to end, then read the camera the page reports.
  await page.waitForFunction(() => {
    const { camera, player } = window.__atlas
    return player.state !== 'dance' && camera.beat === null && Math.abs(camera.pitch - 35) < 0.02
  }, undefined, { timeout: 8000 })
  const camera = await page.evaluate(() => ({ distance: window.__atlas.camera.distance, pitch: window.__atlas.camera.pitch }))
  assert.ok(camera.distance >= 7.5 - 0.05, `The walk camera is ${camera.distance} units out, expected 7.5 or more`)
  // Project a point 3 units north along the open spawn corridor. It lies 3·sin(pitch) above and (distance + 3·cos(pitch))
  // in front of the camera's look-at point, the player's ground position; the vertical field of view is 30°.
  const target = { x: dance.x, z: dance.z - 3 }
  const pitch = camera.pitch * Math.PI / 180
  const ndcY = 3 * Math.sin(pitch) / ((camera.distance + 3 * Math.cos(pitch)) * Math.tan(Math.PI / 12))
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
