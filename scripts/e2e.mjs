import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  createSteppedPage, defaultRound, evidenceDir, headless, launchChromium, previewURL, readDanceSeconds, writeJson,
} from './capture.mjs'
import { PAGE_MIN_Z } from '../src/world/tiles.js'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, url: { type: 'string' } },
})
assert.ok(positionals.length <= 1 && !(positionals.length && values.out),
  'Usage: node scripts/e2e.mjs [REPORT_PATH | --out REPORT_PATH] [--url PREVIEW_URL]')
const output = values.out ?? positionals[0] ?? join(evidenceDir, `round-${defaultRound}`, 'e2e.json')
const url = new URL(values.url ?? previewURL)
url.searchParams.set('seed', '0')
url.searchParams.delete('cam')
const viewport = headless ? { width: 640, height: 360 } : { width: 1280, height: 720 }
const fps = 60
const tile = { i: -1, j: -3, id: 'cupcake_tree', x: -2, z: -6 }
const upRadius = 3
const downRadius = 4.5
const maxFrameTravel = 1.2 / fps + 1e-6
const tolerance = 2
const degrees = (radians) => radians * 180 / Math.PI
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const checks = []

function check(name, measured, verify) {
  const result = { name, measured, passed: false }
  try {
    verify()
    result.passed = true
  } catch (error) {
    result.error = error.message
  }
  checks.push(result)
}

async function run() {
  const browser = await launchChromium()
  try {
    const { page, open, advance, errors } = await createSteppedPage(browser, viewport, { waitForAudio: true })
    await open(url.href)
    const clipSeconds = await readDanceSeconds(page)
    let frame = 0
    const step = async (count) => {
      await advance(frame + 1, fps, count)
      frame += count
    }
    const watchFold = async (count, direction) => {
      const position = await page.evaluate(({ frame, fps, count, direction, tile }) => {
        const { foldLog, player } = window.__atlas
        let position
        const before = foldLog.length
        for (let i = 1; i <= count; i++) {
          window.__atlasStep(frame + i, fps, 1)
          if (!position && foldLog.slice(before)
            .some(({ dir, i, j }) => dir === direction && i === tile.i && j === tile.j)) {
            position = { x: player.x, z: player.z }
          }
        }
        return position
      }, { frame, fps, count, direction, tile })
      frame += count
      return position
    }
    const pose = () => page.evaluate(() => ({
      ...window.__atlas.player,
      tip: { ...window.__atlas.hairBones[3] },
    }))
    const folds = () => page.evaluate(() => window.__atlas.foldLog)
    const trace = () => page.evaluate((id) => window.__atlas.hingeTrace(id), `${tile.i},${tile.j}`)
    const belongsToTile = ({ i, j, id }) => i === tile.i && j === tile.j && id === tile.id

    const loadMs = await page.evaluate(() => window.__atlas.loadMs)
    check('assets-and-shaders-ready', { loadMs }, () => assert.ok(Number.isFinite(loadMs)))
    const beforeInput = await page.evaluate(() => window.__atlas.audioLog.length)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.__atlasAudioUnlocked, undefined, { polling: 50, timeout: 5000 })

    const movement = []
    for (const [key, axis, sign] of [
      ['KeyA', 'x', -1], ['KeyD', 'x', 1], ['KeyS', 'z', 1], ['KeyW', 'z', -1],
    ]) {
      const start = await pose()
      await page.keyboard.down(key)
      await step(24)
      await page.keyboard.up(key)
      const end = await pose()
      movement.push({ key, axis, travel: sign * (end[axis] - start[axis]), state: end.state })
    }
    check('wasd-movement', movement, () => {
      for (const { key, travel, state } of movement) {
        assert.ok(travel >= 0.4 && travel <= 0.55 && state === 'walk', `${key} moved ${travel} units`)
      }
    })

    const offsets = []
    let upPosition
    await page.keyboard.down('KeyW')
    for (let i = 0; i < 52; i++) {
      if (upPosition) await step(5)
      else upPosition = await watchFold(5, 'up')
      const { x, z, state, tip } = await pose()
      if (state === 'walk') offsets.push([tip.x - x, tip.y, tip.z - z])
    }
    await page.keyboard.up('KeyW')
    const hairMotion = offsets.reduce((max, sample) => Math.max(max,
      Math.hypot(...sample.map((entry, index) => entry - offsets[0][index]))), 0)
    check('hair-tip-relative-to-player', { walkingSamples: offsets.length, maxOffsetUnits: hairMotion },
      () => assert.ok(offsets.length > 1 && hairMotion > 0.03, 'Hair tip moved less than 0.03 units'))

    const up = (await folds()).find((event) => belongsToTile(event) && event.dir === 'up')
    const risingTrace = (await trace()).map(({ t, angle }) => ({ t, angleDeg: degrees(angle) }))
    const rise = risingTrace.filter(({ t }) => up && t >= up.t)
    const peak = rise.reduce((max, { angleDeg }) => Math.max(max, angleDeg), -Infinity)
    const settledIndex = rise.findIndex((_, i) => i > 0 && i < rise.length - 1
      && rise.slice(i).every(({ angleDeg }) => Math.abs(angleDeg) <= tolerance))
    let settlingSeconds
    const settled = rise[settledIndex]
    if (settled) {
      // The final tolerance crossing can fall between the last out-of-band sample and 1.0 s.
      const previous = rise[settledIndex - 1]
      const previousError = Math.abs(previous.angleDeg)
      const fraction = (previousError - tolerance) / (previousError - Math.abs(settled.angleDeg))
      settlingSeconds = previous.t - up.t + fraction * (settled.t - previous.t)
    }
    const upDistance = upPosition && distance(tile, upPosition)
    check('fold-rise-overshoot-settle', {
      event: up, playerAtTrigger: upPosition, triggerDistanceUnits: upDistance, peakDeg: peak, overshootPercent: 100 * peak / 90,
      settlingSeconds, firstSettledSampleSeconds: settled && settled.t - up.t, trace: risingTrace,
    }, () => {
      assert.ok(up && rise.length > 1, 'No rising trace for the cupcake tree')
      assert.ok(upDistance <= upRadius && upDistance > upRadius - maxFrameTravel,
        `Up fold did not start as the troll entered the ${upRadius}-unit radius`)
      assert.ok(Math.abs(rise[0].angleDeg + 90) <= tolerance, 'Rise did not start flat')
      assert.ok(rise.some(({ angleDeg }) => angleDeg > -70 && angleDeg < -20), 'No intermediate rising angle')
      assert.ok(peak >= 0.12 * 90 && peak <= 0.20 * 90, `Peak angle ${peak}° is outside 12–20% overshoot`)
      assert.ok(settlingSeconds < 1 && rise.at(-1).t - up.t >= 1, 'Did not stay within ±2° before 1.0 s')
    })

    let firstDance
    for (let idleFrames = 5; idleFrames <= 5 * fps; idleFrames += 5) {
      await step(5)
      if ((await pose()).state === 'dance') {
        firstDance = idleFrames / fps
        break
      }
    }
    check('dance-after-idle', { idleSeconds: firstDance },
      () => assert.ok(firstDance >= 4 && firstDance <= 5, 'No dance between 4 and 5 seconds of idle'))

    let danceSeconds
    let danceEnd
    if (firstDance !== undefined) {
      for (let elapsed = 5; elapsed <= Math.ceil(clipSeconds * fps) + 10; elapsed += 5) {
        await step(5)
        danceEnd = (await pose()).state
        if (danceEnd !== 'dance') {
          danceSeconds = elapsed / fps
          break
        }
      }
    }
    check('dance-completes-clip', { clipSeconds, danceSeconds, endState: danceEnd }, () => {
      assert.ok(Math.abs(clipSeconds - 3) <= 0.25, `Expected an approximately 3s dance clip. Found ${clipSeconds}s`)
      assert.equal(danceEnd, 'idle', 'Dance did not return to idle')
      assert.ok(Math.abs(danceSeconds - clipSeconds) <= 6 / fps,
        `Dance lasted ${danceSeconds}s, expected ${clipSeconds}s from the GLB`)
    })

    // The stationary follow target settles on the troll during the idle test.
    const beforeClick = await pose()
    const target = { x: beforeClick.x, z: beforeClick.z - 3 }
    const riseToPoint = 3 * Math.SQRT1_2
    const ndcY = riseToPoint / ((10 + riseToPoint) * Math.tan(Math.PI / 12))
    const click = { x: viewport.width / 2, y: viewport.height * (1 - ndcY) / 2 }
    await page.mouse.click(click.x, click.y)
    await step(30)
    const clickWalk = await pose()
    await step(150)
    const arrived = await pose()
    const errorUnits = distance(arrived, target)
    check('click-to-walk', { click, target, arrived, errorUnits }, () => {
      assert.equal(clickWalk.state, 'walk')
      assert.equal(arrived.state, 'idle')
      assert.ok(errorUnits <= 0.5, `Click target missed by ${errorUnits} units`)
    })

    await page.keyboard.down('KeyW')
    const downPosition = await watchFold(4 * fps, 'down')
    await page.keyboard.up('KeyW')
    const end = await pose()
    const foldLog = await folds()
    const down = foldLog.find((event) => belongsToTile(event) && event.dir === 'down')
    const fallingTrace = (await trace()).map(({ t, angle }) => ({ t, angleDeg: degrees(angle) }))
    const fall = fallingTrace.filter(({ t }) => down && t >= down.t)
    const triggerDistance = downPosition && distance(tile, downPosition)
    check('fold-down-after-departure', {
      event: down, playerAtTrigger: downPosition, triggerDistanceUnits: triggerDistance, endDistanceUnits: distance(tile, end),
      finalAngleDeg: fall.at(-1)?.angleDeg, trace: fallingTrace,
    }, () => {
      assert.ok(down && up && down.t > up.t && triggerDistance > downRadius
        && triggerDistance <= downRadius + maxFrameTravel, `No down event just beyond the ${downRadius}-unit radius`)
      assert.ok(Math.abs(fall[0]?.angleDeg) <= tolerance, 'Down fold did not start upright')
      assert.ok(fall.some(({ angleDeg }) => angleDeg > -75 && angleDeg < -15), 'No intermediate falling angle')
      assert.ok(Math.abs(fall.at(-1)?.angleDeg + 90) <= tolerance, 'Down fold did not become flat')
    })
    check('book-edge-blocks-walking', { endZ: end.z, edgeZ: PAGE_MIN_Z }, () => {
      assert.ok(end.z >= PAGE_MIN_Z && end.z - PAGE_MIN_Z <= maxFrameTravel, 'Troll did not stop at the page edge')
      assert.equal(end.state, 'idle')
    })

    const notes = await page.evaluate(() => window.__atlas.audioLog)
    const eighth = 60 / 96 / 2
    const scale = new Set([2, 4, 6, 9, 11])
    // Initial t=0 folds happen during loading. Subsequent up folds share a chime per grid slot.
    const expectedSlots = new Map()
    for (const fold of foldLog) {
      if (fold.dir !== 'up' || fold.t === 0) continue
      const slot = Math.floor(fold.t / eighth) + 1
      if (!expectedSlots.has(slot)) expectedSlots.set(slot, fold)
    }
    check('unlocked-fold-chimes-in-d-major-pentatonic', {
      notesBeforeInput: beforeInput, expectedChimes: expectedSlots.size, notes,
    }, () => {
      assert.equal(beforeInput, 0, 'Chimes were scheduled before the input unlock')
      assert.ok(expectedSlots.size > 0, 'No post-unlock up folds occurred')
      assert.equal(notes.length, expectedSlots.size)
      assert.deepEqual(notes.map(({ t }) => t), [...expectedSlots.keys()].map((slot) => slot * eighth))
      for (const { t, id, i, j, midi } of notes) {
        const fold = expectedSlots.get(t / eighth)
        assert.deepEqual([id, i, j], [fold.id, fold.i, fold.j], 'Chime does not match the up fold in this slot')
        assert.ok(Number.isInteger(midi) && midi >= 62 && midi <= 86 && scale.has(midi % 12),
          `MIDI note ${midi} is outside D4–D6 D major pentatonic`)
      }
    })
    check('browser-errors', errors, () => assert.deepEqual(errors, []))
  } finally {
    await browser.close()
  }
}

try {
  await run()
} catch (error) {
  checks.push({ name: 'harness', passed: false, error: error.message.split('\n').slice(0, 12).join('\n') })
}
const passed = checks.length > 0 && checks.every((check) => check.passed)
await mkdir(dirname(output), { recursive: true })
await writeJson(output, { url: url.href, browser: headless ? 'headless Chromium' : 'headed Chromium', fps, passed, checks })
for (const { name, passed, error } of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${error ? `: ${error}` : ''}`)
console.log(output)
process.exitCode = passed ? 0 : 1
