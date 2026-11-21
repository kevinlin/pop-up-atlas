import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createSteppedPage, launchChromium, previewURL } from './capture.mjs'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { before: { type: 'boolean' }, plain: { type: 'boolean' } },
})
assert(positionals.length <= 1 && !(values.before && values.plain),
  'Usage: node scripts/look-shots.mjs [URL] [--before | --plain]')
const baseURL = positionals[0] ?? previewURL
const variant = values.before ? 'before' : values.plain ? 'plain' : 'after'
const out = resolve('.handoff/evidence/T7/r2')
const fps = 60
const shots = [
  { name: '01-establishing', seed: 42, cam: [13.2, 46], x: 23, z: -4, heading: 1.1, state: 'idle' },
  { name: '02-walking', seed: 0, cam: [4.6, 34], x: -0.6, z: -4.8, heading: 1.57, state: 'walk', key: 'KeyD', frames: 36 },
  { name: '03-fold-up', seed: 0, cam: [9.5, 36], x: 0, z: -1, heading: 1.1, state: 'idle', moveToZ: -1.6, frames: 9 },
  { name: '04-river-bridge', seed: 42, cam: [6.5, 38], x: 21.2, z: -4, heading: 1.57, state: 'walk',
    key: 'KeyD', frames: 40, model: 'yarn_bridge' },
  { name: '05-dance', seed: 157, cam: [4.3, 34], x: 4, z: 10, heading: 0.55, state: 'dance', frames: 132, model: 'flower' },
  { name: '06-fold-back', seed: 0, cam: [10, 34], x: 0, z: -2, heading: 0, state: 'walk', key: 'KeyS', frames: 122 },
]

await mkdir(out, { recursive: true })
const browser = await launchChromium()
try {
  const { page, open, advance, errors } = await createSteppedPage(browser, { width: 1280, height: 720 })
  for (const shot of shots) {
    const url = new URL(baseURL)
    url.searchParams.set('look-shots', '')
    url.searchParams.set('cam', shot.cam.join(','))
    url.searchParams.set('seed', shot.seed)
    url.searchParams.delete('plain')
    if (values.plain) url.searchParams.set('plain', '')

    await open(url.href)
    await page.waitForFunction(() => window.__atlasLookShots, undefined, { polling: 50 })
    const pose = (z) => page.evaluate((location) => window.__atlasLookShots.pose(location),
      { x: shot.x, z, heading: shot.heading, zoom: 1 })
    await pose(shot.z)
    await advance(1, fps, 90)
    assert(await page.evaluate(() => window.__atlasLookShots.cameraSettled()), 'Camera did not settle')
    await page.evaluate((seed) => window.__atlas.setSeed(seed), shot.seed)
    await advance(91, fps, 60)
    if (shot.moveToZ !== undefined) await pose(shot.moveToZ)
    if (shot.key) await page.keyboard.down(shot.key)
    if (shot.frames) await advance(151, fps, shot.frames)

    assert.equal(await page.evaluate(() => window.__atlas.player.state), shot.state, shot.name)
    if (shot.model) assert(await page.evaluate((id) => window.__atlasLookShots.hasModel(id), shot.model), shot.name)
    assert.deepEqual(errors, [], `Rendering errors in ${shot.name}`)
    await page.screenshot({ path: resolve(out, `${shot.name}-${variant}.png`) })
    if (shot.key) await page.keyboard.up(shot.key)
  }
} finally {
  await browser.close()
}
