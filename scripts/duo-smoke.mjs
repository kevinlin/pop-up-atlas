import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { TILE_SIZE } from '../src/world/tiles.js'

const url = new URL(process.argv[2] ?? 'http://localhost:4173')
const resolution = process.env.ATLAS_DUO_VIEWPORT ?? '1280x720'
const [width, height] = resolution.split('x').map(Number)
const headless = process.env.ATLAS_HEADLESS === '1'
const suffix = headless && resolution === '1280x720' ? '' : `-${headless ? 'headless' : 'headed'}-${resolution}`
const evidence = new URL('../.handoff/evidence/RT5/', import.meta.url)
const path = (name, extension) => fileURLToPath(new URL(`${name}${suffix}.${extension}`, evidence))
url.searchParams.set('duo-probe', '')
url.searchParams.set('look-shots', '')

await mkdir(evidence, { recursive: true })
const args = headless && process.platform === 'darwin' ? ['--use-angle=metal'] : []
const browser = await chromium.launch({ headless, args })
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(({ width, height }) => {
    const probe = { phase: 'ready', frames: [] }
    window.__duoSmoke = probe
    Object.defineProperty(window, '__atlasDuoProbe', {
      set(equipment) {
        const { scene, camera, raycaster } = equipment
        const vector = camera.position.clone()
        const centre = vector.clone()
        equipment.frame = (t, lead, follow, leadPosition, followPosition, leadTip, followTip) => {
          const tiles = scene.children.filter((mesh) => mesh.isInstancedMesh && mesh.count && mesh.name.startsWith('atlas/'))
          function covered(point) {
            vector.subVectors(point, camera.position)
            raycaster.far = vector.length()
            raycaster.set(camera.position, vector.normalize())
            return raycaster.intersectObjects(tiles, false).length > 0
          }
          function occluded(position, tip) {
            centre.copy(position).y += 0.31
            return Boolean(tip && covered(centre) && covered(tip))
          }
          const leadOccluded = occluded(leadPosition, leadTip)
          const followOccluded = occluded(followPosition, followTip)
          const cameraError = camera.getWorldDirection(vector).multiplyScalar(10)
            .add(camera.position).distanceTo(leadPosition)
          const { player, duo } = window.__atlas
          const inside = ({ left, right, top, bottom }) => left >= 0 && right <= width && top >= 0 && bottom <= height
          const overlap = Math.max(0, Math.min(lead.right, follow.right) - Math.max(lead.left, follow.left))
            * Math.max(0, Math.min(lead.bottom, follow.bottom) - Math.max(lead.top, follow.top))
            / ((follow.right - follow.left) * (follow.bottom - follow.top))
          probe.bounds = follow
          probe.frames.push({
            t, phase: probe.phase, leader: duo.leader, lx: player.x, lz: player.z, fx: duo.follower.x, fz: duo.follower.z,
            distance: Math.hypot(player.x - duo.follower.x, player.z - duo.follower.z),
            leadIn: inside(lead), followIn: inside(follow), overlap,
            leadState: player.state, followState: duo.follower.state,
            leadOccluded, followOccluded, cameraError, pending: duo.pendingSwap, followY: followPosition.y,
          })
        }
      },
    })
  }, { width, height })
  await page.goto(url.href)
  await page.waitForFunction(() => window.__duoSmoke.frames.length > 0)
  assert.equal(await page.evaluate(() => window.__atlas.hairBones.length), 4)

  const phase = (next) => page.evaluate((name) => { window.__duoSmoke.phase = name }, next)
  const shot = (name) => suffix ? undefined : page.screenshot({ path: path(name, 'png') })
  const snapshot = () => page.evaluate(() => window.__duoSmoke.frames.at(-1))
  const origin = await snapshot()
  assert.equal(origin.leader, 'a')
  assert.ok(Math.abs(origin.distance - 1.1) < 0.02)
  await phase('straight')
  await page.keyboard.down('KeyS')
  await page.waitForFunction((z) => window.__atlas.player.z >= z, origin.lz + 2.5)
  await shot('01-walk')
  await page.waitForFunction((z) => window.__atlas.player.z >= z, origin.lz + 3.2)
  await page.keyboard.up('KeyS')
  await phase('turn')
  await page.keyboard.down('KeyD')
  await page.waitForFunction((x) => window.__atlas.player.x >= x, origin.lx + 0.8)
  await page.keyboard.up('KeyD')

  await phase('stop-and-dance')
  await page.waitForFunction(() => window.__atlas.duo.follower.state === 'dance')
  assert.equal((await snapshot()).leadState, 'dance')
  await shot('02-dance')

  await phase('space-swap')
  const beforeSpace = await snapshot()
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.__atlas.duo.swaps === 1)
  const afterSpace = await snapshot()
  assert.equal(afterSpace.leader, 'b')
  assert.equal(await page.evaluate(() => window.__atlas.hairBones.length), 4)
  assert.ok(Math.hypot(afterSpace.lx - beforeSpace.fx, afterSpace.lz - beforeSpace.fz) < 0.02)
  assert.equal(afterSpace.leadState, 'idle')
  assert.notEqual(afterSpace.followState, 'dance')
  await page.waitForFunction((t) => window.__duoSmoke.frames.at(-1).t >= t + 0.75, afterSpace.t)
  assert.ok((await snapshot()).cameraError <= 0.2)
  await shot('03-space-swap')

  await phase('click-swap')
  const { left, top, bottom } = await page.evaluate(() => window.__duoSmoke.bounds)
  await page.mouse.click(left - 3, (top + bottom) / 2)
  await page.waitForFunction(() => window.__atlas.duo.swaps === 2)
  const afterClick = await snapshot()
  assert.equal(afterClick.leader, 'a')
  await page.waitForFunction((t) => window.__duoSmoke.frames.at(-1).t >= t + 0.6, afterClick.t)
  const end = await snapshot()
  assert.equal(Math.hypot(end.lx - afterClick.lx, end.lz - afterClick.lz), 0)
  await shot('04-click-swap')

  // Use the existing pose hook to give the follower a recovery gap in an open lane.
  await phase('hop')
  await page.evaluate(({ x, z }) => window.__atlasLookShots.pose({
    x: x + 3.9, z, zoom: 1, heading: Math.PI / 2,
  }), { x: end.lx, z: end.lz })
  await page.waitForFunction(() => window.__atlas.duo.follower.state === 'hop')
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.__atlas.duo.swaps === 3)
  const afterHop = await snapshot()
  assert.equal(afterHop.leader, 'b')
  assert.equal(afterHop.followY, 0)

  const { frames, foldLog } = await page.evaluate(() => ({
    frames: window.__duoSmoke.frames, foldLog: window.__atlas.foldLog,
  }))
  assert.ok(frames.some((f) => f.followState === 'hop' && f.followY > 0 && f.pending))
  const byTime = new Map(frames.map((f) => [f.t, f]))
  const measuredFolds = foldLog.filter(({ t }) => byTime.has(t))
  assert.ok(measuredFolds.length > 0)
  for (const { dir, i, j, t } of measuredFolds) {
    const { lx, lz } = byTime.get(t)
    const gap = Math.hypot(i * TILE_SIZE - lx, j * TILE_SIZE - lz)
    assert.ok(dir === 'up' ? gap <= 2 : gap > 3)
  }
  const csv = [
    't,phase,leader,leader_x,leader_z,follower_x,follower_z,distance,leader_inside,follower_inside,overlap,leader_state,follower_state,leader_occluded,follower_occluded,camera_error,pending_swap',
    ...frames.map((f) => [
      f.t.toFixed(5), f.phase, f.leader, f.lx, f.lz, f.fx, f.fz, f.distance, f.leadIn ? 'yes' : 'no',
      f.followIn ? 'yes' : 'no', f.overlap, f.leadState, f.followState,
      f.leadOccluded, f.followOccluded, f.cameraError, f.pending,
    ].join(',')),
  ]
  await writeFile(path('frames', 'csv'), `${csv.join('\n')}\n`)

  const walking = frames.filter((f) => f.leadState === 'walk')
  const inside = frames.filter((f) => !f.leadIn || !f.followIn)
  const straight = walking.filter((f) => f.phase === 'straight')
  function stats(samples) {
    const sorted = samples.map((f) => f.distance).sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return {
      frames: sorted.length,
      median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
      max: sorted.at(-1),
    }
  }
  function longestRun(predicate) {
    let start
    let longest = 0
    for (const f of frames) {
      if (predicate(f)) start ??= f.t
      if (start !== undefined) longest = Math.max(longest, f.t - start)
      if (!predicate(f)) start = undefined
    }
    return longest
  }
  const longestOverlap = longestRun((f) => f.overlap > 0.5)
  const longestOcclusion = Math.max(longestRun((f) => f.leadOccluded), longestRun((f) => f.followOccluded))
  const danceAt = frames.find((f) => f.leadState === 'dance').t
  const canon = frames.find((f) => f.followState === 'dance').t - danceAt
  const separation = frames.filter((f) => f.distance >= 0.45).length / frames.length
  const result = {
    width, height, headless, frames: frames.length, walking: stats(walking), straight: stats(straight),
    outside: inside.map((f) => f.t), separation, longestOverlap, longestOcclusion, canon,
  }
  console.log(JSON.stringify(result, null, 2))
  assert.deepEqual(errors, [])
  assert.deepEqual(inside, [], 'Both projected bounds must stay within the frame')
  assert.ok(separation >= 0.99)
  assert.ok(longestOverlap <= 0.5)
  assert.ok(longestOcclusion <= 0.5)
  assert.ok(Math.abs(canon - 0.3125) <= 0.05)
  assert.ok(straight.at(-1).t - straight[0].t >= 2)
  assert.ok(result.straight.median >= 0.9 && result.straight.median <= 1.4)
  assert.ok(result.straight.max <= 2.2)
} finally {
  await browser.close()
}
