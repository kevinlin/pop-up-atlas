import assert from 'node:assert/strict'
import { randomBytes, randomInt } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLayout } from '../src/world/layout.js'
import { cellAt, TILE_SIZE } from '../src/world/tiles.js'
import { createSteppedPage, foldContract, launchChromium, lineClear, roundOptions, walkSpeed, writeJson } from './capture.mjs'
import { blindPairs } from './capture-audio.mjs'
import { duoContract } from './e2e-duo-plan.mjs'
import { installProbe, serveThree } from './e2e-duo-probe.mjs'

const panel = { width: 1672, height: 941 }
// Overscan gives the fixed follow camera room for an off-centre 1672x941 composition.
export const shotViewport = { width: 2232, height: 1381 }
const fps = 60
export const shots = [
  // Wide enough to see both long edges of the accordion and tabletop beyond the cover.
  { seed: 42, cam: [44, 34], x: 21, z: 0, heading: 0.9, state: 'idle', model: 'yarn_bridge' },
  { seed: 0, cam: [4.5, 32], x: -0.48, z: -5.25, heading: Math.PI / 4, anchor: [0.5, 0.72],
    state: 'walk', keys: ['KeyD', 'KeyS'], frames: 39 },
  // The mushroom is ahead and to the right of the troll when it starts to rise.
  { seed: 0, cam: [5.6, 38], x: 0.65, z: -2.7, heading: 0.95, anchor: [1 / 3, 0.71],
    state: 'idle', frames: 17, fold: { dir: 'up', i: 1, j: -2 } },
  { seed: 42, cam: [5.8, 24], x: 23.2, z: 8, heading: Math.PI / 2, anchor: [0.5, 0.71],
    state: 'walk', keys: ['KeyD'], frames: 40, model: 'yarn_bridge' },
  { seed: 167, cam: [4.4, 32], x: -4, z: 8.56, heading: 0.1, anchor: [0.5, 0.69],
    state: 'dance', frames: 123, model: 'flower' },
  // Walk toward the camera, with the falling cupcake still in the back-left.
  { seed: 0, cam: [4.6, 26], x: -0.95, z: -4.75, heading: 0, anchor: [2 / 3, 0.71],
    state: 'walk', keys: ['KeyS'], fold: { dir: 'down', i: -1, j: -3 } },
]

// Round 5 (docs/contracts.md "Round 5: duo"): the same four moments as reference/concept-r5, with both trolls.
// `duo` shots stage the pair: the follower is placed 1.1 behind the leader on its heading (two relocations
// of the leader), `swap` hands the lead to B first, `followerState` is asserted at the capture frame, and both
// characters' projected bounds must sit inside the blind panel.
export const duoShots = [
  // 01 walk: A leads down the felt path toward the camera, B a body length behind.
  { seed: 0, cam: [7, 36], x: -0.48, z: -5.25, heading: Math.PI / 4, anchor: [0.56, 0.64],
    state: 'walk', keys: ['KeyD', 'KeyS'], frames: 39, duo: true, followerState: 'walk' },
  // 02 fold-up: the mushroom house springs up beside the pair, both standing.
  { seed: 0, cam: [7.4, 38], x: 0.65, z: -2.7, heading: 0.95, anchor: [0.4, 0.68],
    state: 'idle', frames: 17, fold: { dir: 'up', i: 1, j: -2 }, duo: true },
  // 03 dance: the leader about a second into the dance, the follower starting 0.3125 s behind.
  { seed: 167, cam: [6.4, 34], x: -4, z: 8.56, heading: 0.1, anchor: [0.5, 0.62],
    state: 'dance', followerState: 'dance', frames: 150, model: 'flower', duo: true },
  // 04 bridge: B leads over the yarn bridge, A right behind.
  { seed: 42, cam: [7, 26], x: 23.2, z: 8, heading: Math.PI / 2, anchor: [0.5, 0.66],
    state: 'walk', keys: ['KeyD'], frames: 40, model: 'yarn_bridge', duo: true, swap: true, followerState: 'walk' },
]

// Round 6 (docs/contracts.md "Round 6"): the four moments of reference/concept-r6 plus two more staged poses, so the
// old-vs-new mode has six. Same staging rules as `duoShots`. `collide` stages a walk into a river: `x` is the river's
// first blocked x on the lane (the walk stops there), `umbrella` asserts B's umbrella is open at the capture frame
// (skipped for a legacy build, which has none). Shot cameras are `?cam=` values at the contract's walk (7.5 / 35),
// dance beat (4.5 / 22) and hero beat (6.0 / 30) poses, which turns the beats off so the pose is exactly that.
export const r6Shots = [
  // 01 walk: A skips ahead, B a body length behind, props rising around them (seed 0, the round-5 walk pose).
  { seed: 0, cam: [7.5, 35], x: -0.48, z: -5.25, heading: Math.PI / 4, anchor: [0.5, 0.64],
    state: 'walk', keys: ['KeyD', 'KeyS'], frames: 39, duo: true, followerState: 'walk' },
  // 02 dance: the leader about a second into the dance, the follower 0.3125 s behind, on the dance beat's pose.
  { seed: 167, cam: [4.5, 22], x: -4, z: 5.4, heading: 0.1, anchor: [0.5, 0.6],
    state: 'dance', followerState: 'dance', frames: 150, model: 'flower', duo: true },
  // 03 umbrella pop: B leads east into the river bank on seed 0 (lane z 2.4, first blocked x 39.64).
  { seed: 0, cam: [6.2, 28], x: 38.2, z: 2.4, heading: Math.PI / 2, anchor: [0.5, 0.64],
    keys: ['KeyD'], frames: 90, duo: true, swap: true, collide: { x: 39.64 }, umbrella: true },
  // 04 hero fold: a cupcake tree springs up beside the pair, both standing (hero beat pose).
  { seed: 0, cam: [6, 30], x: 9, z: 3.2, heading: 0.95, anchor: [0.4, 0.64],
    state: 'idle', frames: 17, fold: { dir: 'up', i: 5, j: 1 }, duo: true },
  // 05 bridge: B leads over the yarn bridge, A right behind (the round-5 bridge pose).
  { seed: 42, cam: [7.5, 26], x: 23.2, z: 8, heading: Math.PI / 2, anchor: [0.5, 0.66],
    state: 'walk', keys: ['KeyD'], frames: 40, model: 'yarn_bridge', duo: true, swap: true, followerState: 'walk' },
  // 06 fold-up: the mushroom house springs up beside the pair, both standing (the round-5 fold pose).
  { seed: 0, cam: [7.4, 38], x: 0.65, z: -2.7, heading: 0.95, anchor: [0.4, 0.68],
    state: 'idle', frames: 17, fold: { dir: 'up', i: 1, j: -2 }, duo: true },
]

// Round 4 concepts each name their earlier concept in reference/concept-r4/style.md; reuse that concept's shot.
// Round 5 has its own four shots; its character sheet (-00-sheet-b) is not a gameplay frame. Round 6 pairs frames
// 01-04 with `r6Shots` 0-3; the two character sheets (-00-sheet-a, -00-sheet-b) are excluded.
const referenceSets = {
  claude: { dir: 'reference/concept-claude', pattern: /^concept-claude-\d\d-.+\.png$/, shotFor: [0, 1, 2, 3, 4, 5], shots },
  r4: { dir: 'reference/concept-r4', pattern: /^concept-r4-\d\d-.+\.png$/, shotFor: [0, 1, 1, 3, 2, 4], shots },
  r5: { dir: 'reference/concept-r5', pattern: /^concept-r5-(?!00-)\d\d-duo-.+\.png$/, shotFor: [0, 1, 2, 3], shots: duoShots },
  r6: { dir: 'reference/concept-r6', pattern: /^concept-r6-(?!00-)\d\d-.+\.png$/, shotFor: [0, 1, 2, 3], shots: r6Shots },
}
export const referenceSet = (round) => referenceSets[round >= 6 ? 'r6' : round >= 5 ? 'r5' : round >= 4 ? 'r4' : 'claude']

// Blind still pairs with an external key: pair file names `pair-NN.png`, the order of the shots and the side each
// of `first` and `second` lands on drawn from `seed` (`blindPairs`). `key` is written outside the folder the judge reads.
export function blindStills(items, { seed }) {
  const file = (pair) => `${pair.replace(/^pair-(\d+)$/, (_, n) => `pair-${n.padStart(2, '0')}`)}.png`
  const { pairs, key } = blindPairs(items, { seed })
  return {
    pairs: pairs.map(({ pair, a, b }) => ({ file: file(pair), a, b })),
    key: { seed: key.seed, pairs: Object.fromEntries(Object.entries(key.pairs).map(([pair, entry]) => [file(pair), entry])) },
  }
}

export function planShot(shot, layout) {
  const { upRadius, downRadius } = foldContract
  const center = shot.fold && { x: shot.fold.i * TILE_SIZE, z: shot.fold.j * TILE_SIZE }
  // The follower starts 1.1 behind the leader on its heading and walks the leader's trail.
  function followerClear(point) {
    if (!shot.duo) return true
    const behind = {
      x: point.x - duoContract.startGap * Math.sin(shot.heading),
      z: point.z - duoContract.startGap * Math.cos(shot.heading),
    }
    return lineClear(layout, behind, point)
  }

  function stageAt(x, z) {
    if (layout.isBlocked(x, z)) return
    const point = { x, z }
    let frames = shot.frames
    if (center) {
      const dx = x - center.x
      const dz = z - center.z
      const radius = Math.hypot(dx, dz)
      if (radius > upRadius - 0.06 || dz < 0.55) return
      if (shot.fold.dir === 'up') {
        if (dx > -0.55) return
        const scale = (upRadius + 0.17) / radius
        const from = { x: center.x + dx * scale, z: center.z + dz * scale }
        if (lineClear(layout, from, point) && followerClear(from)) return { from, moveTo: point, frames }
        return
      }
      if (dx < 0.55) return
      const leaveAtZ = center.z + Math.sqrt(downRadius ** 2 - dx ** 2)
      frames = Math.ceil((leaveAtZ - z) / walkSpeed * fps) + 16
    }
    if (!followerClear(point)) return
    if (shot.keys) {
      const travel = frames / fps * walkSpeed
      const end = { x: x + travel * Math.sin(shot.heading), z: z + travel * Math.cos(shot.heading) }
      // A staged collision walks up to the obstacle and stops there: the lane must be clear up to just before it.
      if (shot.collide) {
        if (Math.abs(shot.heading - Math.PI / 2) > 1e-9 || x + travel < shot.collide.x - 0.01 || x > shot.collide.x - 0.2) return
        if (!layout.isBlocked(shot.collide.x + 0.005, z) || layout.isBlocked(shot.collide.x - 0.005, z)) return
        if (!lineClear(layout, point, { x: shot.collide.x - 0.02, z })) return
      } else if (!lineClear(layout, point, end)) return
      if (shot.model === 'yarn_bridge' && layout.getCell(cellAt(end.x), cellAt(end.z)).id !== shot.model) return
    }
    return { from: point, frames }
  }

  const exact = stageAt(shot.x, shot.z)
  if (exact) return exact
  let nearest
  let best = Infinity
  // Small offsets preserve the lens, crop anchor and action planned for this concept.
  for (let dx = -20; dx <= 20; dx++) {
    for (let dz = -20; dz <= 20; dz++) {
      const distance = dx ** 2 + dz ** 2
      if (distance > 20 ** 2 || distance >= best) continue
      const stage = stageAt(shot.x + dx * 0.05, shot.z + dz * 0.05)
      if (stage) {
        best = distance
        nearest = stage
      }
    }
  }
  assert.ok(nearest, `No clear staging position within 1 unit of (${shot.x}, ${shot.z}) on seed ${shot.seed}`)
  return nearest
}

// `legacy`: the page is the previous build, which has none of the round-6 runtime (umbrella, camera rig), so the
// assertions about those are skipped; the staging and the other assertions are the same.
// `panel: false` (look-stats, which renders at 1280x720 and crops nothing) skips the check that both characters sit inside the
// blind panel's crop of the overscan viewport; the leader, follower state and gap checks stay.
export async function takeShot({ page, open, advance, errors }, baseURL, shot, path, inspect, { legacy = false, panel: inPanel = true } = {}) {
  const url = new URL(baseURL)
  url.searchParams.set('seed', shot.seed)
  if (shot.cam) url.searchParams.set('cam', shot.cam.join(','))
  else url.searchParams.delete('cam')
  url.searchParams.set('look-shots', '')
  // The duo probe measures both characters' projected bounds (scripts/e2e-duo-probe.mjs).
  if (shot.duo) url.searchParams.set('look-probe', '')
  url.searchParams.delete('debug')
  url.searchParams.delete('plain')

  const layout = createLayout(shot.seed)
  const { from, moveTo, frames } = planShot(shot, layout)
  if (shot.duo) await serveThree(page)
  await open(url.href)
  await page.waitForFunction(() => window.__atlasLookShots, undefined, { polling: 50, timeout: 5000 })
  const pose = (position) => page.evaluate((location) => window.__atlasLookShots.pose(location),
    { ...position, heading: shot.heading, zoom: 1 })
  // The stepped clock must keep rising across the whole shot.
  let next = 1
  const step = async (count) => {
    await advance(next, fps, count)
    next += count
  }
  if (shot.duo) {
    await page.waitForFunction(() => window.__atlasLookShots.scene, undefined, { polling: 50, timeout: 5000 })
    // A leads at load, so the probe tells the rigs apart by their distance to the leader.
    await installProbe(page)
    if (shot.swap) {
      await page.evaluate(() => window.__atlas.duo.swap())
      await step(4)
      assert.equal(await page.evaluate(() => window.__atlas.duo.leader), 'b', 'Space did not hand the lead to B')
    }
    // A relocation of more than 8 units places the follower 1.1 behind the leader's heading. Hop away and
    // back, so it also happens for shots staged near the spawn point.
    const away = Math.abs(from.x + 10) > Math.abs(from.x - 10) ? 10 : -10
    await pose({ x: from.x + away, z: from.z })
    await step(1)
  }
  await pose(from)
  await step(90)
  assert.ok(await page.evaluate(() => window.__atlasLookShots.cameraSettled()), 'Camera did not settle')
  // Rebuild the tile batches after the camera has followed the staged pose.
  await page.evaluate((seed) => window.__atlas.setSeed(seed), shot.seed)
  await step(60)
  if (moveTo) await pose(moveTo)
  for (const key of shot.keys ?? []) await page.keyboard.down(key)
  if (frames) await step(frames)

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
  if (shot.state) assert.equal(player.state, shot.state, 'Shot captured the wrong animation state')
  if (shot.fold) {
    assert.ok(foldAngleDeg > -80 && foldAngleDeg < -15,
      `Shot captured ${foldAngleDeg}°, expected a hinge between flat and upright`)
  }
  if (shot.model) {
    assert.ok(await page.evaluate((id) => window.__atlasLookShots.hasModel(id), shot.model),
      `Shot is missing ${shot.model}`)
  }
  if (shot.model === 'yarn_bridge' && shot.state === 'walk') {
    assert.equal(layout.getCell(cellAt(player.x), cellAt(player.z)).id, 'yarn_bridge',
      'Troll is outside the bridge tile')
  }
  const umbrella = shot.umbrella && !legacy
    ? await page.evaluate(() => ({ open: Boolean(window.__atlas.umbrella?.open), t: window.__atlas.umbrella?.t ?? null }))
    : undefined
  if (umbrella) assert.ok(umbrella.open, 'B\'s umbrella is not open at the capture frame')
  assert.deepEqual(errors, [], 'Browser errors during still capture')
  await inspect?.()
  const anchor = shot.anchor ?? [0.5, 0.5]
  const duo = shot.duo && await checkDuo(page, shot, anchor, inPanel)
  if (path) {
    await page.screenshot({ path, clip: {
      x: Math.round(shotViewport.width / 2 - anchor[0] * panel.width),
      y: Math.round(shotViewport.height / 2 - anchor[1] * panel.height),
      ...panel,
    } })
  }
  for (const key of shot.keys ?? []) await page.keyboard.up(key)
  return { seed: shot.seed, camera: shot.cam, anchor, start: from, player, fold: shot.fold, foldAngleDeg, ...(duo && { duo }), ...(umbrella && { umbrella }) }
}

// Both trolls are in the shot: the right one leads, the follower is in the expected state and close, and
// both projected bounds sit inside the panel that will be cropped from the viewport.
async function checkDuo(page, shot, anchor, checkPanel = true) {
  const s = await page.evaluate(() => window.__duoProbe.sample(0))
  assert.equal(s.leader, shot.swap ? 'b' : 'a', 'Wrong troll leading the shot')
  if (shot.followerState) assert.equal(s.F.state, shot.followerState, 'Follower is in the wrong animation state')
  const gap = Math.hypot(s.L.x - s.F.x, s.L.z - s.F.z)
  assert.ok(gap <= duoContract.followMax, `Follower is ${gap.toFixed(2)} units from the leader`)
  const crop = [shotViewport.width / 2 - anchor[0] * panel.width, shotViewport.height / 2 - anchor[1] * panel.height]
  if (!checkPanel) return { leader: s.leader, follower: { x: s.F.x, z: s.F.z, state: s.F.state }, gap: Math.round(gap * 100) / 100 }
  for (const label of ['a', 'b']) {
    const [x0, y0, x1, y1] = s[label].rect
    assert.ok(x0 >= crop[0] && x1 <= crop[0] + panel.width && y0 >= crop[1] && y1 <= crop[1] + panel.height,
      `Troll ${label} is outside the ${panel.width}x${panel.height} panel: ${JSON.stringify(s[label].rect.map(Math.round))} vs crop ${JSON.stringify(crop.map(Math.round))}`)
  }
  const inPanel = (rect) => [rect[0] - crop[0], rect[1] - crop[1], rect[2] - crop[0], rect[3] - crop[1]].map(Math.round)
  return {
    leader: s.leader, follower: { x: s.F.x, z: s.F.z, state: s.F.state }, gap: Math.round(gap * 100) / 100,
    panelRects: { a: inPanel(s.a.rect), b: inPanel(s.b.rect) },
  }
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

async function compose(page, rows, panelWidth, panelHeight, labels, crops) {
  const columns = labels.length
  const encoded = await page.evaluate(async ({ rows, panelWidth, panelHeight, labels, columns, crops }) => {
    const canvas = document.createElement('canvas')
    const labelHeight = 40
    canvas.width = panelWidth * columns
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
      const column = index % columns
      const x = column * panelWidth
      const row = Math.floor(index / columns)
      const y = row * (panelHeight + labelHeight)
      const crop = crops?.[row]
      ctx.fillText(crop ? `Shot ${row + 1} · ${labels[column]}` : labels[column],
        x + panelWidth / 2, y + labelHeight / 2)
      ctx.drawImage(img, ...(crop ?? [0, 0, img.width, img.height]), x, y + labelHeight, panelWidth, panelHeight)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, { rows, panelWidth, panelHeight, labels, columns, crops })
  const bytes = Buffer.from(encoded, 'base64')
  assert.deepEqual(pngSize(bytes), [panelWidth * columns, rows.length * (panelHeight + 40)])
  return stripMetadata(bytes)
}

export async function compareStills(page, reference, game, out, { width, height }) {
  const images = await Promise.all([reference, game].map((path) => readFile(path, 'base64')))
  const comparison = await compose(page, [images], width, height, ['Reference', 'Game'])
  await writeFile(out, comparison)
}

export async function compareTrollStills(page, rows, crops, out) {
  const encoded = rows.map((row) => row.map((png) => png.toString('base64')))
  const strip = await compose(page, encoded, 320, 320, ['Pre-stage', 'After', 'All off'], crops)
  await writeFile(out, strip)
}

async function sbs({ baseURL, round, roundDir, evidence, oldURL }) {
  const gameDir = join(roundDir, 'game')
  const criticDir = join(roundDir, 'critic')
  const keyDir = join(roundDir, 'key')
  const { dir: referenceDir, pattern, shotFor, shots: roundShots } = referenceSet(round)
  const references = (await readdir(referenceDir)).filter((name) => pattern.test(name)).sort()
  assert.equal(references.length, shotFor.length, 'Expected one concept per mapped shot')
  // Round 6 shuffles the pair order too and keeps its seed in the key; earlier rounds only flip the sides.
  const stills = round >= 6
    ? blindStills(references.map((_, i) => ({ name: `shot-${i + 1}`, first: 'reference', second: 'game' })),
      { seed: randomBytes(4).readUInt32LE() })
    : undefined
  const blindNames = stills ? stills.pairs.map(({ file }) => file).sort()
    : references.map((_, i) => `pair-${String(i + 1).padStart(2, '0')}.png`)
  await Promise.all([gameDir, criticDir, keyDir, evidence].map((dir) => mkdir(dir, { recursive: true })))
  assert.ok((await readdir(criticDir)).every((name) => blindNames.includes(name)),
    'Critic directory contains a file outside the blind set')

  const browser = await launchChromium()
  try {
    const steppedPage = await createSteppedPage(browser, shotViewport)
    const rows = []
    const framing = []
    for (const [index, reference] of references.entries()) {
      const rawName = `game-${String(index + 1).padStart(2, '0')}.png`
      const path = join(gameDir, rawName)
      const shot = await takeShot(steppedPage, baseURL, roundShots[shotFor[index]], path)
      const images = await Promise.all([join(referenceDir, reference), path].map((name) => readFile(name)))
      assert.deepEqual(pngSize(images[1]), [panel.width, panel.height])
      // compose() scales each panel; references only need the panel's 16:9 aspect.
      const [width, height] = pngSize(images[0])
      assert.ok(Math.abs(width / height - panel.width / panel.height) < 0.01, `${reference} is not 16:9`)
      rows.push(images.map((img) => img.toString('base64')))
      framing.push({ reference, game: rawName, ...shot })
      console.log(`Captured still ${index + 1}/${references.length}`)
    }

    const { page } = steppedPage
    await page.goto('about:blank')
    const key = []
    if (stills) {
      for (const { file, a, b } of stills.pairs) {
        const index = Number(stills.key.pairs[file].name.replace('shot-', '')) - 1
        const [reference, game] = rows[index]
        const bytes = await compose(page, [a === 'game' ? [game, reference] : [reference, game]], panel.width, panel.height, ['A', 'B'])
        await writeFile(join(criticDir, file), bytes)
        key.push({ pair: file, A: a, B: b, ...framing[index] })
      }
    } else {
      for (const [index, pair] of blindNames.entries()) {
        const gameOnLeft = randomInt(2) === 1
        const [reference, game] = rows[index]
        const row = gameOnLeft ? [game, reference] : [reference, game]
        const bytes = await compose(page, [row], panel.width, panel.height, ['A', 'B'])
        await writeFile(join(criticDir, pair), bytes)
        key.push({ pair, A: gameOnLeft ? 'game' : 'reference', B: gameOnLeft ? 'reference' : 'game',
          ...framing[index] })
      }
    }

    const contact = await compose(page, rows, 836, 471, ['Reference', 'Game'])
    await writeFile(join(evidence, 'stills-contact-sheet.png'), contact)
    await writeJson(join(keyDir, 'key.json'), { ...(stills && { seed: stills.key.seed }), pairs: key })
    assert.deepEqual((await readdir(criticDir)).sort(), blindNames)
    console.log(`Wrote ${key.length} blind PNG pairs, ${framing.length} raw stills, and a separate key`)
    if (oldURL) {
      assert.ok(round >= 6, '--old-url needs --round 6 or later')
      await oldVsNew(browser, { baseURL, oldURL, roundDir, evidence })
    }
  } finally {
    await browser.close()
  }
}

// Old-vs-new: the same six staged poses (`r6Shots`) rendered from the previous build (`oldURL`, the fa6d96b build served on
// a second port) and from the current one, as blind shuffled pairs. The pairs go to `old-vs-new/`, the answer key (seed, which
// side is the old build) to `key/old-vs-new-key.json`, outside the pair folder; the raw stills sit under `game/old-vs-new/`.
async function oldVsNew(browser, { baseURL, oldURL, roundDir, evidence }) {
  const pairDir = join(roundDir, 'old-vs-new')
  const rawDir = join(roundDir, 'game', 'old-vs-new')
  const keyDir = join(roundDir, 'key')
  await Promise.all([pairDir, rawDir, keyDir].map((dir) => mkdir(dir, { recursive: true })))
  const sources = [['old', oldURL, { legacy: true }], ['new', baseURL, {}]]
  const rows = r6Shots.map(() => ({}))
  const framing = r6Shots.map(() => ({}))
  for (const [bank, url, options] of sources) {
    const stepped = await createSteppedPage(browser, shotViewport)
    for (const [index, shot] of r6Shots.entries()) {
      const name = `${bank}-${String(index + 1).padStart(2, '0')}.png`
      framing[index][bank] = await takeShot(stepped, url, shot, join(rawDir, name), undefined, options)
      rows[index][bank] = await readFile(join(rawDir, name))
      console.log(`Captured ${bank} still ${index + 1}/${r6Shots.length}`)
    }
    await stepped.page.close()
  }
  const { pairs, key } = blindStills(r6Shots.map((_, i) => ({ name: `shot-${i + 1}`, first: 'old', second: 'new' })),
    { seed: randomBytes(4).readUInt32LE() })
  const { page } = await createSteppedPage(browser, shotViewport)
  await page.goto('about:blank')
  const answers = []
  for (const { file, a, b } of pairs) {
    const index = Number(key.pairs[file].name.replace('shot-', '')) - 1
    const row = [a, b].map((bank) => rows[index][bank].toString('base64'))
    await writeFile(join(pairDir, file), await compose(page, [row], panel.width, panel.height, ['A', 'B']))
    answers.push({ pair: file, A: a, B: b, shot: index + 1, old: framing[index].old, new: framing[index].new })
  }
  const contact = await compose(page, rows.map(({ old, new: current }) => [old, current].map((png) => png.toString('base64'))),
    836, 471, ['Old', 'New'])
  await writeFile(join(evidence, 'old-vs-new-contact-sheet.png'), contact)
  await writeJson(join(keyDir, 'old-vs-new-key.json'), { seed: key.seed, oldURL, newURL: baseURL, pairs: answers })
  assert.deepEqual((await readdir(pairDir)).sort(), pairs.map(({ file }) => file).sort())
  console.log(`Wrote ${pairs.length} blind old-vs-new pairs and a separate key`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await sbs(roundOptions('sbs'))
}
