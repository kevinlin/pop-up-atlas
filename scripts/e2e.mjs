import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  createSteppedPage, defaultRound, evidenceDir, foldContract, headless, launchChromium, previewURL, readDanceSeconds,
  walkSpeed, writeJson,
} from './capture.mjs'
import { PAGE_MIN_Z, TILE_SIZE } from '../src/world/tiles.js'

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
const viewport = headless ? { width: 320, height: 180 } : { width: 1280, height: 720 }
const fps = 60
const { upRadius, downRadius, settleSeconds } = foldContract
const maxFrameTravel = walkSpeed / fps + 1e-6
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

function phraseChimes(foldLog, eighth) {
  const restSlots = 6
  const phraseNotes = 8
  const expected = []
  let origin
  let previousFoldTime
  let lastSlot = 0
  let phrasePosition = 0
  for (const fold of foldLog) {
    if (fold.dir !== 'up' || fold.t === 0 || fold.t === previousFoldTime) continue
    previousFoldTime = fold.t
    const gridOrigin = origin ?? fold.t
    const closest = Math.round((fold.t - gridOrigin) / eighth)
    let slot = closest + Number(gridOrigin + closest * eighth <= fold.t)
    const restart = origin === undefined || slot - lastSlot > restSlots
    if (restart) {
      origin = fold.t
      slot = 0
      phrasePosition = 0
    } else {
      if (slot <= lastSlot) continue // Multiple folds can share a boundary.
      // Leave one empty slot after the cadence before playing the next D.
      if (phrasePosition === 0) slot = Math.max(slot, lastSlot + 2)
    }
    const final = phrasePosition === phraseNotes - 1
    expected.push({ fold, t: origin + slot * eighth, origin, slot, final })
    lastSlot = slot
    phrasePosition = (phrasePosition + 1) % phraseNotes
  }
  return expected
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
    const watchFold = async (count, direction, tile) => {
      const observed = await page.evaluate(({ frame, fps, count, direction, tile }) => {
        const { foldLog, player } = window.__atlas
        let observed
        for (let i = 1; i <= count; i++) {
          const before = foldLog.length
          window.__atlasStep(frame + i, fps, 1)
          if (observed) continue
          const event = foldLog.slice(before).find(({ dir, i, j }) =>
            dir === direction && (!tile || (i === tile.i && j === tile.j)))
          if (event) observed = { event, player: { x: player.x, z: player.z } }
        }
        return observed
      }, { frame, fps, count, direction, tile })
      frame += count
      return observed
    }
    const pose = () => page.evaluate(() => ({
      ...window.__atlas.player,
      tip: { ...window.__atlas.hairBones[3] },
    }))
    const folds = () => page.evaluate(() => window.__atlas.foldLog)
    const trace = async ({ i, j }) => (await page.evaluate((id) => window.__atlas.hingeTrace(id), `${i},${j}`))
      .map(({ t, angle }) => ({ t, angleDeg: degrees(angle) }))

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
    let rising
    await page.keyboard.down('KeyW')
    for (let i = 0; i < 52; i++) {
      if (rising) await step(5)
      else rising = await watchFold(5, 'up')
      const { x, z, state, tip } = await pose()
      if (state === 'walk') offsets.push([tip.x - x, tip.y, tip.z - z])
    }
    await page.keyboard.up('KeyW')
    const hairMotion = offsets.reduce((max, sample) => Math.max(max,
      Math.hypot(...sample.map((entry, index) => entry - offsets[0][index]))), 0)
    check('hair-tip-relative-to-player', { walkingSamples: offsets.length, maxOffsetUnits: hairMotion },
      () => assert.ok(offsets.length > 1 && hairMotion > 0.03, 'Hair tip moved less than 0.03 units'))

    const up = rising?.event
    const tileCenter = up && { x: up.i * TILE_SIZE, z: up.j * TILE_SIZE }
    const risingTrace = up ? await trace(up) : []
    const rise = risingTrace.filter(({ t }) => up && t >= up.t)
    const peak = rise.reduce((max, { angleDeg }) => Math.max(max, angleDeg), -Infinity)
    const settledIndex = rise.findIndex((_, i) => i > 0 && i < rise.length - 1
      && rise.slice(i).every(({ angleDeg }) => Math.abs(angleDeg) <= tolerance))
    let settlingSeconds
    const settled = rise[settledIndex]
    if (settled) {
      // Estimate the final tolerance crossing between the two bracketing RAF samples.
      const previous = rise[settledIndex - 1]
      const previousError = Math.abs(previous.angleDeg)
      const fraction = (previousError - tolerance) / (previousError - Math.abs(settled.angleDeg))
      settlingSeconds = previous.t - up.t + fraction * (settled.t - previous.t)
    }
    const upDistance = rising && distance(tileCenter, rising.player)
    check('fold-rise-overshoot-settle', {
      event: up, playerAtTrigger: rising?.player, triggerDistanceUnits: upDistance, peakDeg: peak, overshootPercent: 100 * peak / 90,
      settlingSeconds, firstSettledSampleSeconds: settled && settled.t - up.t, trace: risingTrace,
    }, () => {
      assert.ok(up && rise.length > 1, 'No rising trace for the first tile folded up during the walk')
      assert.ok(upDistance <= upRadius + 1e-6 && upDistance > upRadius - maxFrameTravel,
        `Up fold did not start as the troll entered the ${upRadius}-unit radius`)
      assert.ok(Math.abs(rise[0].angleDeg + 90) <= tolerance, 'Rise did not start flat')
      assert.ok(rise.some(({ angleDeg }) => angleDeg > -70 && angleDeg < -20), 'No intermediate rising angle')
      assert.ok(peak >= 0.12 * 90 && peak <= 0.20 * 90, `Peak angle ${peak}° is outside 12–20% overshoot`)
      assert.ok(settlingSeconds < settleSeconds && rise.at(-1).t - up.t >= settleSeconds,
        `Did not stay within ±2° before ${settleSeconds} s`)
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

    let falling
    let fallingTrace = []
    const watchDeparture = async (count) => {
      if (up && !falling) falling = await watchFold(count, 'down', up)
      else await step(count)
      if (falling && !fallingTrace.length && frame / fps - falling.event.t >= settleSeconds) {
        fallingTrace = await trace(up)
      }
    }
    // Click-walk can already leave the tracked tile's down radius.
    const beforeClick = await pose()
    const target = { x: beforeClick.x, z: beforeClick.z - 3 }
    const riseToPoint = 3 * Math.SQRT1_2
    const ndcY = riseToPoint / ((10 + riseToPoint) * Math.tan(Math.PI / 12))
    const click = { x: viewport.width / 2, y: viewport.height * (1 - ndcY) / 2 }
    await page.mouse.click(click.x, click.y)
    await watchDeparture(30)
    const clickWalk = await pose()
    await watchDeparture(150)
    const arrived = await pose()
    const errorUnits = distance(arrived, target)
    check('click-to-walk', { click, target, arrived, errorUnits }, () => {
      assert.equal(clickWalk.state, 'walk')
      assert.equal(arrived.state, 'idle')
      assert.ok(errorUnits <= 0.5, `Click target missed by ${errorUnits} units`)
    })

    await page.keyboard.down('KeyW')
    await watchDeparture(2 * fps)
    await watchDeparture(2 * fps)
    await page.keyboard.up('KeyW')
    if (falling && !fallingTrace.length) {
      await watchDeparture(Math.max(1, Math.ceil((falling.event.t + settleSeconds) * fps) - frame))
    }
    const end = await pose()
    const foldLog = await folds()
    const down = falling?.event
    const downPosition = falling?.player
    const fall = fallingTrace.filter(({ t }) => down && t >= down.t)
    const triggerDistance = downPosition && distance(tileCenter, downPosition)
    check('fold-down-after-departure', {
      event: down, playerAtTrigger: downPosition, triggerDistanceUnits: triggerDistance,
      endDistanceUnits: tileCenter && distance(tileCenter, end),
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
    const expected = phraseChimes(foldLog, eighth)
    check('unlocked-fold-chimes-in-d-major-pentatonic', {
      notesBeforeInput: beforeInput, expectedChimes: expected.length, phraseOrigins: expected.filter(({ slot }) => slot === 0)
        .map(({ origin }) => origin), notes,
    }, () => {
      assert.equal(beforeInput, 0, 'Chimes were scheduled before the input unlock')
      assert.ok(expected.length > 0, 'No post-unlock up folds occurred')
      assert.equal(notes.length, expected.length)
      for (const [index, { t, id, i, j, midi }] of notes.entries()) {
        const { fold, t: scheduled, slot, final } = expected[index]
        assert.ok(Math.abs(t - scheduled) < 1e-6, slot === 0
          ? `Phrase starter should sound on its fold at ${scheduled}s, got ${t}s`
          : `Expected phrase slot ${slot} at ${scheduled}s, got ${t}s`)
        assert.deepEqual([id, i, j], [fold.id, fold.i, fold.j], 'Chime does not match the up fold in this slot')
        assert.ok(Number.isInteger(midi) && midi >= 62 && midi <= 86 && scale.has(midi % 12),
          `MIDI note ${midi} is outside D4–D6 D major pentatonic`)
        if (final) assert.equal(midi % 12, 2, 'Phrase did not end on D')
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
