import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLayout } from '../src/world/layout.js'
import { cellAt } from '../src/world/tiles.js'
import { createSteppedPage, evidenceDir, launchChromium, previewURL, roundDir, writeJson } from './capture.mjs'

const viewport = { width: 1672, height: 941 }
const fps = 60
const referenceDir = 'reference/concept-claude'
const gameDir = join(roundDir, 'game')
const criticDir = join(roundDir, 'critic')
const keyDir = join(roundDir, 'key')
const baseURL = process.argv[2] ?? previewURL
const shots = [
  { seed: 42, cam: [13.2, 46], x: 23, z: -4, heading: 1.1, state: 'idle', model: 'yarn_bridge' },
  { seed: 0, cam: [4.6, 34], x: -0.6, z: -4.8, heading: 1.57, state: 'walk', key: 'KeyD', frames: 36 },
  { seed: 0, cam: [9.5, 36], x: 0, z: -1, heading: 1.1, state: 'idle', moveToZ: -1.6,
    frames: 9, fold: { dir: 'up', i: -1, j: -3 } },
  { seed: 42, cam: [6.5, 38], x: 21.2, z: -4, heading: 1.57, state: 'walk', key: 'KeyD', frames: 40,
    model: 'yarn_bridge' },
  { seed: 157, cam: [4.3, 34], x: 4, z: 10, heading: 0.55, state: 'dance', frames: 132, model: 'flower' },
  { seed: 0, cam: [10, 34], x: 0, z: -2, heading: 0, state: 'walk', key: 'KeyS', frames: 122,
    fold: { dir: 'down', i: -1, j: -3 } },
]

async function takeShot({ page, open, advance, errors }, shot, path) {
  const url = new URL(baseURL)
  url.searchParams.set('seed', shot.seed)
  url.searchParams.set('cam', shot.cam.join(','))
  url.searchParams.set('look-shots', '')
  url.searchParams.delete('debug')
  url.searchParams.delete('plain')

  await open(url.href)
  await page.waitForFunction(() => window.__atlasLookShots, undefined, { polling: 50, timeout: 5000 })
  const pose = (z) => page.evaluate((location) => window.__atlasLookShots.pose(location),
    { x: shot.x, z, heading: shot.heading, zoom: 1 })
  await pose(shot.z)
  await advance(1, fps, 90)
  assert.ok(await page.evaluate(() => window.__atlasLookShots.cameraSettled()), 'Camera did not settle')
  // Rebuild the tile batches after the camera has followed the staged pose.
  await page.evaluate((seed) => window.__atlas.setSeed(seed), shot.seed)
  await advance(91, fps, 60)
  if (shot.moveToZ !== undefined) await pose(shot.moveToZ)
  if (shot.key) await page.keyboard.down(shot.key)
  if (shot.frames) await advance(151, fps, shot.frames)

  const { player, foldAngleDeg } = await page.evaluate((fold) => {
    const { player, hingeTrace, foldLog } = window.__atlas
    if (!fold) return { player: { ...player } }
    const { i, j, dir } = fold
    const last = hingeTrace(`${i},${j}`).at(-1)
    const event = foldLog.findLast((entry) => entry.i === i && entry.j === j && entry.dir === dir)
    return {
      player: { ...player },
      foldAngleDeg: last && event && event.t < last.t ? last.angle * 180 / Math.PI : null,
    }
  }, shot.fold)
  assert.equal(player.state, shot.state, 'Shot captured the wrong animation state')
  if (shot.fold) {
    assert.ok(foldAngleDeg > -85 && foldAngleDeg < -5,
      `Shot captured ${foldAngleDeg}°, expected a hinge between flat and upright`)
  }
  if (shot.model) {
    assert.ok(await page.evaluate((id) => window.__atlasLookShots.hasModel(id), shot.model),
      `Shot is missing ${shot.model}`)
  }
  if (shot.model === 'yarn_bridge' && shot.state === 'walk') {
    const layout = createLayout(shot.seed)
    assert.equal(layout.getCell(cellAt(player.x), cellAt(player.z)).id, 'yarn_bridge',
      'Troll is outside the bridge tile')
  }
  assert.deepEqual(errors, [], 'Browser errors during still capture')
  await page.screenshot({ path })
  if (shot.key) await page.keyboard.up(shot.key)
  return { seed: shot.seed, camera: shot.cam, player, fold: shot.fold, foldAngleDeg }
}

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex')
const imageChunks = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])

function pngSize(bytes) {
  assert.ok(bytes.subarray(0, 8).equals(pngSignature), 'Expected PNG')
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

function stripMetadata(bytes) {
  const chunks = [bytes.subarray(0, 8)]
  for (let offset = 8; offset < bytes.length;) {
    const end = offset + 12 + bytes.readUInt32BE(offset)
    assert.ok(end <= bytes.length, 'Truncated PNG chunk')
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (imageChunks.has(type)) chunks.push(bytes.subarray(offset, end))
    offset = end
  }
  assert.equal(chunks.at(-1).toString('ascii', 4, 8), 'IEND')
  return Buffer.concat(chunks)
}

async function compose(page, rows, panelWidth, panelHeight, labels) {
  const encoded = await page.evaluate(async ({ rows, panelWidth, panelHeight, labels }) => {
    const canvas = document.createElement('canvas')
    const labelHeight = 40
    canvas.width = panelWidth * 2
    canvas.height = rows.length * (panelHeight + labelHeight)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#151515'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 23px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.imageSmoothingQuality = 'high'

    const images = await Promise.all(rows.flat().map(async (base64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${base64}`
      await img.decode()
      return img
    }))
    for (const [index, img] of images.entries()) {
      const column = index % 2
      const x = column * panelWidth
      const y = Math.floor(index / 2) * (panelHeight + labelHeight)
      ctx.fillText(labels[column], x + panelWidth / 2, y + labelHeight / 2)
      ctx.drawImage(img, x, y + labelHeight, panelWidth, panelHeight)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, { rows, panelWidth, panelHeight, labels })
  const bytes = Buffer.from(encoded, 'base64')
  assert.deepEqual(pngSize(bytes), [panelWidth * 2, rows.length * (panelHeight + 40)])
  return stripMetadata(bytes)
}

const references = (await readdir(referenceDir)).filter((name) => /^concept-claude-\d\d-.+\.png$/.test(name)).sort()
assert.equal(references.length, shots.length, 'Expected one concept per shot')
const blindNames = shots.map((_, i) => `pair-${String(i + 1).padStart(2, '0')}.png`)
await Promise.all([gameDir, criticDir, keyDir, evidenceDir].map((dir) => mkdir(dir, { recursive: true })))
assert.ok((await readdir(criticDir)).every((name) => blindNames.includes(name)),
  'Critic directory contains a file outside the blind set')

const browser = await launchChromium()
try {
  const steppedPage = await createSteppedPage(browser, viewport)
  const rows = []
  const framing = []
  for (const [index, reference] of references.entries()) {
    const rawName = `game-${String(index + 1).padStart(2, '0')}.png`
    const path = join(gameDir, rawName)
    const shot = await takeShot(steppedPage, shots[index], path)
    const images = await Promise.all([join(referenceDir, reference), path].map((name) => readFile(name)))
    for (const img of images) assert.deepEqual(pngSize(img), [viewport.width, viewport.height])
    rows.push(images.map((img) => img.toString('base64')))
    framing.push({ reference, game: rawName, ...shot })
    console.log(`Captured still ${index + 1}/${shots.length}`)
  }

  const { page } = steppedPage
  await page.goto('about:blank')
  const key = []
  for (const [index, pair] of blindNames.entries()) {
    const gameOnLeft = randomInt(2) === 1
    const [reference, game] = rows[index]
    const row = gameOnLeft ? [game, reference] : [reference, game]
    const bytes = await compose(page, [row], viewport.width, viewport.height, ['A', 'B'])
    await writeFile(join(criticDir, pair), bytes)
    key.push({ pair, A: gameOnLeft ? 'game' : 'reference', B: gameOnLeft ? 'reference' : 'game',
      ...framing[index] })
  }

  const contact = await compose(page, rows, 836, 471, ['Reference', 'Game'])
  await writeFile(join(evidenceDir, 'stills-contact-sheet.png'), contact)
  await writeJson(join(keyDir, 'key.json'), { pairs: key })
  assert.deepEqual((await readdir(criticDir)).sort(), blindNames)
  console.log(`Wrote ${key.length} blind PNG pairs, ${framing.length} raw stills, and a separate key`)
} finally {
  await browser.close()
}
