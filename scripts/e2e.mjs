import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  createSteppedPage, defaultRound, evidenceDir, foldContract, headless, launchChromium, lineClear, previewURL, readDanceSeconds,
  walkSpeed, writeJson,
} from './capture.mjs'
import { createLayout } from '../src/world/layout.js'
import { cellAt, FIRST_PAGE_ROW, LAST_PAGE_ROW, PAGE_MIN_Z, TILE_SIZE } from '../src/world/tiles.js'

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
const requiredChecks = [
  'assets-and-shaders-ready',
  'wasd-movement',
  'hair-tip-relative-to-player',
  'fold-rise-overshoot-settle',
  'dance-after-idle',
  'dance-completes-clip',
  'click-to-walk',
  'fold-down-after-departure',
  'book-edge-blocks-walking',
  'unlocked-fold-chimes-in-d-major-pentatonic',
  'browser-errors',
  'VOX-01 input unlock and sample manifest',
  'VOX-02 felt step cadence and alternation',
  'VOX-03 paper steps and bridge plucks',
  'VOX-04 edge bump and cooldown',
  'VOX-05 fold layers follow pops',
  'VOX-06 reaction gap and voice overlap',
  'VOX-07 idle hum timing and pitch',
  'VOX-08 dance cue timing and pitch',
  'VOX-09 interrupted dance drops its ending',
  'VOX-10 phrase hold and harmony',
]
const eighth = 60 / 96 / 2
const epsilon = 1e-6
const pentatonic = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]
const phrase = [74, 71, 76, 78, 74, 71, 69, 74]
const reactionCauses = new Set(['walk-start', 'walk-stop', 'bump', 'hero', 'bridge-exit'])
const byTime = (a, b) => a.t - b.t
const danceCues = [
  ['sfx_clap', 0], ['sfx_clap', eighth], ['voice_giggle', 0.45],
  ['sfx_spin', 0.92], ['voice_whee', 0.92], ['sing_ta', 2.19, 69],
  ['sing_da', 2.50, 74], ['chorus_yay', 2.65],
]
const danceNames = new Set(danceCues.map(([cue]) => cue))

function check(name, measured, verify) {
  const result = { name, measured, passed: false }
  try {
    verify()
    result.passed = true
  } catch (error) {
    result.error = error.message
  }
  checks.push(result)
  return result.passed
}

function phraseChimes(foldLog, eighth) {
  const expected = []
  let origin
  let previousFoldTime
  let lastSlot = 0
  let phrasePosition = 0
  for (const fold of foldLog) {
    if (fold.dir !== 'up' || fold.t === 0 || fold.t === previousFoldTime) continue
    const gap = fold.t - previousFoldTime
    previousFoldTime = fold.t
    const restart = origin === undefined || gap >= 6 - epsilon
    const reanchor = !restart && gap > 6 * eighth + epsilon
    let slot = 0
    if (restart || reanchor) {
      origin = fold.t
      if (restart) phrasePosition = 0
    } else {
      const closest = Math.round((fold.t - origin) / eighth)
      slot = closest + Number(origin + closest * eighth <= fold.t)
      if (slot <= lastSlot) continue // Multiple folds can share a boundary.
      // Leave one empty slot after the cadence before playing the next D.
      if (phrasePosition === 0) slot = Math.max(slot, lastSlot + 2)
    }
    const final = phrasePosition === phrase.length - 1
    expected.push({ fold, t: origin + slot * eighth, origin, slot, final, gap, restart, reanchor, phrasePosition })
    lastSlot = slot
    phrasePosition = (phrasePosition + 1) % phrase.length
  }
  return expected
}

function planBridgeWalk(layout, start) {
  for (let i = 1; i <= 32; i++) {
    for (let j = FIRST_PAGE_ROW; j <= LAST_PAGE_ROW; j++) {
      const bridge = layout.getCell(i, j)
      if (bridge.id !== 'yarn_bridge' || bridge.rotation !== 0) continue
      const path = layout.getCell(i - 1, j)
      if (!path.id.startsWith('path_')) continue
      const x = i * TILE_SIZE
      const z = j * TILE_SIZE
      const entry = { x: x - 1.4, z }
      const exit = { x: x + 1.4, z }
      if (!lineClear(layout, entry, exit)) continue
      for (let turnX = 1; turnX < entry.x; turnX += 0.5) {
        const edgeTurn = { x: turnX, z: start.z }
        const pathTurn = { x: turnX, z }
        if (!lineClear(layout, start, edgeTurn)) break
        const firstPath = cellAt(turnX)
        const pathIds = Array.from({ length: i - firstPath }, (_, index) => layout.getCell(firstPath + index, j).id)
        if (pathIds.every((id) => id.startsWith('path_')) &&
          lineClear(layout, edgeTurn, pathTurn) && lineClear(layout, pathTurn, entry)) {
          return { edgeTurn, pathTurn, entry, exit, turnOnBridgeX: x + 0.74, bridge: { i, j } }
        }
      }
    }
  }
  assert.fail('No clear route from the north edge to a path and an eastbound bridge on seed 0')
}

function foldLayerName(id) {
  if (id.startsWith('path_')) return 'fold_path'
  if (id.startsWith('river_')) return 'fold_river'
  return `fold_${id}`
}

function cueTime(cue, expected, tolerance) {
  assert.ok(Math.abs(cue.t - expected) <= tolerance + epsilon,
    `${cue.cue} began at ${cue.t}s, expected ${expected}s ± ${tolerance}s`)
}

function sungPitch(cue, target, manifest) {
  const take = manifest.cues[cue.cue]?.files.find(({ src }) => src === cue.file)
  assert.ok(Number.isFinite(take?.baseMidi) && cue.rate > 0, `No pitch metadata or rate for ${cue.file}`)
  const midi = take.baseMidi + 12 * Math.log2(cue.rate)
  assert.ok(Math.abs(midi - target) <= 0.25 + epsilon, `${cue.cue} sounded MIDI ${midi}, expected ${target} ± 0.25`)
}

function soundChecks({
  manifest, beforeInputCues, audioReadyMs, cueLog, popLog, foldLog, melody, unlockedAt,
  feltStart, feltEnd, paperStart, paperEnd, bridgeStart, bridgeEntry, bridgeExit, bridgeReentry, bridgeEnd, route,
  bumpAt, stoppedAt, danceStart, danceEndTime, interruptedDanceStart, interruptedAt, interruptedState,
}) {
  const cues = cueLog.toSorted(byTime)
  const voices = cues.filter(({ kind }) => kind === 'voice')
  const reactions = voices.filter(({ cause }) => reactionCauses.has(cause))
  const during = (start, end) => cues.filter(({ t }) => t > start && t <= end + epsilon)
  const voiceFree = (t) => {
    const priorReaction = reactions.findLast((reaction) => reaction.t < t - epsilon)
    assert.ok(!priorReaction || t - priorReaction.t >= 2.5 - epsilon, 'The previous reaction is too recent')
    assert.ok(!voices.some((voice) => voice.t < t - epsilon && voice.end > t + epsilon), 'A voice is still playing')
  }

  check('VOX-01 input unlock and sample manifest', { beforeInputCues, audioReadyMs, cues }, () => {
    assert.deepEqual(beforeInputCues, [], 'A cue played before the first input')
    assert.ok(Number.isFinite(audioReadyMs) && audioReadyMs >= 0, 'Sample decoding readiness was not logged')
    assert.ok(cues.some(({ file }) => typeof file === 'string'), 'No manifest sample played after input')
    for (const { t, cue, kind, cause, file, midi } of cues) {
      assert.ok(t >= unlockedAt - epsilon, `${cue} was timestamped before the first input`)
      if (file === null) {
        assert.ok(kind === 'step' && cause === 'step' && Number.isInteger(midi), 'Only pitched step plucks may omit a file')
      } else {
        assert.ok(typeof file === 'string' && manifest.cues[cue]?.files.some(({ src }) => src === file),
          `${cue} played a file absent from its manifest entry: ${file}`)
      }
    }
  })

  const felt = during(feltStart, feltEnd).filter(({ kind }) => kind === 'step')
  check('VOX-02 felt step cadence and alternation', { feltStart, feltEnd, felt }, () => {
    assert.ok(felt.length >= 3, 'The sustained felt walk produced fewer than three footfalls')
    for (const [index, step] of felt.entries()) {
      assert.equal(step.cue, 'step_felt')
      assert.ok(Math.sign(step.pan) === -1 || Math.sign(step.pan) === 1, 'Felt step has no left or right pan')
      if (index === 0) continue
      const previous = felt[index - 1]
      cueTime(step, previous.t + 0.5, 0.04)
      assert.equal(Math.sign(step.pan), -Math.sign(previous.pan), 'Felt step did not change pan side')
      assert.notEqual(step.file, previous.file, 'Adjacent felt steps used the same take')
    }
  })

  const paper = during(paperStart, paperEnd).filter(({ kind }) => kind === 'step')
  const plucks = during(bridgeStart, bridgeEnd).filter(({ kind, file }) => kind === 'step' && file === null)
  const firstPlucks = plucks.filter(({ t }) => t < bridgeExit - epsilon)
  const secondPlucks = plucks.filter(({ t }) => t >= bridgeExit - epsilon)
  const bridgeReactions = during(bridgeStart, bridgeEnd).filter(({ cause }) => cause === 'bridge-exit')
  check('VOX-03 paper steps and bridge plucks', {
    route, paper, firstPlucks, secondPlucks, bridgeEntry, bridgeExit, bridgeReentry, bridgeReactions,
  }, () => {
    assert.ok(paper.length > 0, 'No footfall occurred on the paper route')
    for (const step of paper) assert.equal(step.cue, 'step_paper')
    assert.ok(bridgeEntry < bridgeExit && bridgeExit < bridgeReentry, 'Bridge entry, exit and re-entry were not observed')
    assert.ok(firstPlucks.length >= 4, 'Turning on the bridge produced fewer than four plucks')
    assert.ok(secondPlucks.length >= 1, 'No pluck on re-entering the bridge')
    assert.ok(firstPlucks.every(({ t }) => t >= bridgeEntry - epsilon), 'A bridge pluck sounded before the first entry')
    assert.ok(secondPlucks.every(({ t }) => t >= bridgeReentry - epsilon), 'A bridge pluck sounded before re-entry')
    const climb = [74, 76, 78, 81, 83, 86]
    for (const crossing of [firstPlucks, secondPlucks]) {
      const played = crossing.slice(0, climb.length).map(({ midi }) => midi)
      assert.deepEqual(played, climb.slice(0, played.length), 'Bridge entry did not start a rising pluck sequence at D5')
    }
    voiceFree(bridgeExit)
    assert.ok(!reactions.some(({ t, cause }) => cause === 'bridge-exit' && t < bridgeExit - epsilon && bridgeExit - t < 15),
      'The bridge exit cooldown was still active')
    assert.equal(bridgeReactions.length, 1, 'Expected one reaction at the first exit')
    assert.equal(bridgeReactions[0].cue, 'voice_whee')
    assert.equal(bridgeReactions[0].kind, 'voice')
    cueTime(bridgeReactions[0], bridgeExit, 1 / fps)
  })

  const bumps = cues.filter(({ cue, t }) => ['sfx_bump', 'voice_hmph'].includes(cue) &&
    t >= bumpAt - epsilon && t < bumpAt + 3 - epsilon)
  check('VOX-04 edge bump and cooldown', { bumpAt, bumps }, () => {
    assert.ok(Number.isFinite(bumpAt), 'No blocked frame at the page edge')
    voiceFree(bumpAt)
    assert.ok(!reactions.some(({ t, cause }) => cause === 'bump' && t < bumpAt - epsilon && bumpAt - t < 3),
      'The bump cooldown was still active')
    assert.deepEqual(bumps.map(({ cue }) => cue).sort(), ['sfx_bump', 'voice_hmph'],
      'Expected one bump and one hmph during the contact and its cooldown')
    for (const cue of bumps) {
      assert.equal(cue.cause, 'bump')
      cueTime(cue, bumpAt, 0.3)
    }
    assert.equal(bumps.find(({ cue }) => cue === 'voice_hmph').kind, 'voice')
  })

  const layers = cues.filter(({ cue, cause }) => cause === 'fold' || cue.startsWith('fold_'))
  check('VOX-05 fold layers follow pops', { popLog, layers }, () => {
    assert.ok(popLog.every(({ dir }) => dir === 'up' || dir === 'down'), 'Pop has an unknown direction')
    const pops = popLog.filter(({ t }) => t > unlockedAt).sort(byTime)
    for (const dir of ['up', 'down']) {
      const directionPops = pops.filter((pop) => pop.dir === dir)
      const directionLayers = layers.filter(({ cue }) => (cue === 'fold_down') === (dir === 'down'))
      const times = new Set(directionPops.map(({ t }) => t))
      assert.equal(times.size, directionPops.length, `More than one ${dir} pop in a frame`)
      assert.ok(times.size >= (dir === 'up' ? 3 : 1), `Too few ${dir} frames with pops`)
      assert.equal(directionLayers.length, directionPops.length, `Fold ${dir} layers and pops do not match one-to-one`)
      for (const [index, pop] of directionPops.entries()) {
        const layer = directionLayers[index]
        assert.ok(foldLog.some(({ t, dir, id }) => t === pop.t && dir === pop.dir && id === pop.id),
          `Pop ${pop.id} has no matching ${dir} fold at ${pop.t}s`)
        assert.equal(layer.cue, dir === 'up' ? foldLayerName(pop.id) : 'fold_down')
        assert.equal(layer.kind, 'sfx')
        assert.equal(layer.cause, 'fold')
        cueTime(layer, pop.t, 0.01)
      }
    }
  })

  check('VOX-06 reaction gap and voice overlap', { voices, reactions }, () => {
    assert.ok(reactions.length >= 2, 'Fewer than two reaction lines to compare')
    for (const [index, reaction] of reactions.entries()) {
      if (index > 0) assert.ok(reaction.t - reactions[index - 1].t >= 2.5 - epsilon, 'Reaction lines are too close')
    }
    for (const [index, voice] of voices.entries()) {
      assert.ok(Number.isFinite(voice.t) && Number.isFinite(voice.end) && voice.end >= voice.t, 'Invalid voice interval')
      if (index > 0) assert.ok(voices[index - 1].end <= voice.t + epsilon, `${voices[index - 1].cue} overlaps ${voice.cue}`)
    }
  })

  const humAt = stoppedAt + 1.5
  const lastMelody = melody.filter(({ t }) => t <= humAt).sort(byTime).slice(-3)
  const hum = during(stoppedAt - epsilon, danceStart ?? danceEndTime).filter(({ cue }) => cue === 'sing_hum')
  check('VOX-07 idle hum timing and pitch', { stoppedAt, hum, lastMelody }, () => {
    assert.ok(lastMelody.length > 0 && humAt - lastMelody.at(-1).t <= 10, 'No recent melody to hum after the walk')
    assert.ok(hum.length > 0, 'No hum after stopping')
    assert.equal(hum.length, lastMelody.length, 'Hum did not echo the last available three melody notes')
    for (const [index, cue] of hum.entries()) {
      assert.equal(cue.cause, 'hum')
      assert.equal(cue.kind, 'voice')
      cueTime(cue, humAt + index * eighth, 0.05)
      sungPitch(cue, lastMelody[index].midi, manifest)
    }
  })

  const dance = during(danceStart - 0.05 - epsilon, danceEndTime).filter(({ cue }) => danceNames.has(cue))
  check('VOX-08 dance cue timing and pitch', { stoppedAt, danceStart, dance }, () => {
    assert.ok(Number.isFinite(danceStart) && Math.abs(danceStart - stoppedAt - 4) <= 1 / fps + epsilon,
      'Dance did not begin four seconds after stopping')
    assert.equal(dance.length, danceCues.length, 'Expected every dance cue once, with two claps')
    // The spin and whee share a beat and may be logged in either order.
    const unused = [...dance]
    for (const [name, offset, target] of danceCues) {
      const index = unused.findIndex(({ cue }) => cue === name)
      assert.ok(index >= 0, `Missing dance cue ${name}`)
      const [cue] = unused.splice(index, 1)
      assert.ok(cue.cause === 'dance' || (name === 'chorus_yay' && cue.cause === 'chorus'), `Wrong cause for ${name}`)
      assert.equal(cue.kind, name === 'chorus_yay' ? 'chorus' : name.startsWith('sfx_') ? 'sfx' : 'voice')
      cueTime(cue, danceStart + offset, 0.05)
      if (target !== undefined) sungPitch(cue, target, manifest)
    }
  })

  const interruptedDance = cues.filter(({ cue, t }) => danceNames.has(cue) && t >= interruptedDanceStart - 0.05 - epsilon)
  check('VOX-09 interrupted dance drops its ending', {
    interruptedDanceStart, interruptedAt, interruptedState, interruptedDance,
  }, () => {
    const elapsed = interruptedAt - interruptedDanceStart
    assert.ok(elapsed > 0.92 && elapsed < 2.19, 'The key press did not interrupt the dance between the spin and bow')
    assert.notEqual(interruptedState, 'dance', 'The key press did not exit the dance state')
    assert.ok(interruptedDance.some(({ cue, cause, t }) => cue === 'sfx_spin' && cause === 'dance' && t < interruptedAt),
      'The interrupted dance did not reach its spin cue')
    assert.ok(!interruptedDance.some(({ t, cue }) => t >= interruptedAt || ['sing_ta', 'sing_da', 'chorus_yay'].includes(cue)),
      'The interrupted dance still played cues from its ending')
  })
}

async function run() {
  const browser = await launchChromium()
  try {
    const { page, open, errors } = await createSteppedPage(browser, viewport, { waitForAudio: true })
    await open(url.href)
    const clipSeconds = await readDanceSeconds(page)
    let frame = 0
    const now = () => frame / fps
    const step = async (count, watch, boundary) => {
      const observed = await page.evaluate(async ({ frame, fps, count, watch, boundary, maxFrameTravel }) => {
        const { player } = window.__atlas
        let observed
        let z = player.z
        for (let i = 1; i <= count; i++) {
          window.__atlasStep(frame + i, fps, 1)
          // Flush the frame's fold and audio callbacks before advancing the clock.
          await Promise.resolve()
          if (observed === undefined && ((watch === 'dance' && player.state === 'dance')
            || (watch === 'edge' && player.z === z && player.z >= boundary && player.z - boundary <= maxFrameTravel)
            || (watch === 'bridge-entry' && player.x >= boundary)
            || (watch === 'bridge-exit' && player.x < boundary))) {
            observed = (frame + i) / fps
          }
          z = player.z
        }
        return observed
      }, { frame, fps, count, watch, boundary, maxFrameTravel })
      frame += count
      return observed
    }
    const watchFold = async (count, direction, tile) => {
      const { observed, steps } = await page.evaluate(async ({ frame, fps, count, direction, tile, tileSize, tieFrames }) => {
        const { foldLog, player } = window.__atlas
        const candidates = []
        let last = count
        let first
        for (let i = 1; i <= last; i++) {
          const before = foldLog.length
          window.__atlasStep(frame + i, fps, 1)
          await Promise.resolve()
          const events = foldLog.slice(before).filter(({ dir, i, j }) =>
            dir === direction && (!tile || (i === tile.i && j === tile.j)))
          for (const event of events) candidates.push({ event, player: { x: player.x, z: player.z } })
          // Tiles entering the radius within a few frames of each other are one tie. Float noise orders them, so
          // keep watching briefly and pick the tile on the walk line rather than the first one logged.
          if (candidates.length && !tile) {
            first ??= i
            last = Math.max(count, first + tieFrames)
          }
        }
        const lateral = (candidate) => Math.abs(candidate.event.i * tileSize - candidate.player.x)
        const observed = tile ? candidates[0] : candidates.reduce((best, candidate) =>
          !best || lateral(candidate) < lateral(best) - 1e-6 ? candidate : best, undefined)
        return { observed, steps: last }
      }, { frame, fps, count, direction, tile, tileSize: TILE_SIZE, tieFrames: 3 })
      frame += steps
      return observed
    }
    const pose = () => page.evaluate(() => ({
      ...window.__atlas.player,
      tip: { ...window.__atlas.hairBones[3] },
    }))
    const folds = () => page.evaluate(() => window.__atlas.foldLog)
    const walkAxisTo = async (axis, coordinate, watch, boundary) => {
      const start = await pose()
      const delta = coordinate - start[axis]
      const key = axis === 'x' ? (delta < 0 ? 'KeyA' : 'KeyD') : (delta < 0 ? 'KeyW' : 'KeyS')
      const count = Math.round(Math.abs(delta) * fps / walkSpeed)
      await page.keyboard.down(key)
      const observed = await step(count, watch, boundary)
      await page.keyboard.up(key)
      const end = await pose()
      assert.ok(Math.abs(end[axis] - coordinate) <= maxFrameTravel, `Walk to ${axis}=${coordinate} stopped at ${end[axis]}`)
      return observed
    }
    const trace = async ({ i, j }) => (await page.evaluate((id) => window.__atlas.hingeTrace(id), `${i},${j}`))
      .map(({ t, angle }) => ({ t, angleDeg: degrees(angle) }))

    const loadMs = await page.evaluate(() => window.__atlas.loadMs)
    check('assets-and-shaders-ready', { loadMs }, () => assert.ok(Number.isFinite(loadMs)))
    const manifestURL = new URL('audio/manifest.json', page.url())
    const manifestResponse = await page.request.get(manifestURL.href)
    assert.ok(manifestResponse.ok(), `Could not load ${manifestURL.href}`)
    const manifest = await manifestResponse.json()
    await page.waitForFunction(() => Number.isFinite(window.__atlas.audioReadyMs), undefined,
      { polling: 50, timeout: 30_000 })
    // Let an entire idle dance elapse while the browser is still locked.
    await step(Math.ceil((4 + clipSeconds) * fps) + 2)
    const beforeInput = await page.evaluate(() => window.__atlas.audioLog.length)
    const beforeInputCues = await page.evaluate(() => window.__atlas.cueLog)
    const unlockedAt = now()
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
    const feltStart = now()
    let rising
    await page.keyboard.down('KeyW')
    for (let i = 0; i < 52; i++) {
      if (rising) await step(5)
      else rising = await watchFold(5, 'up')
      const { x, z, state, tip } = await pose()
      if (state === 'walk') offsets.push([tip.x - x, tip.y, tip.z - z])
    }
    await page.keyboard.up('KeyW')
    const feltEnd = now()
    const stoppedAt = feltEnd + 1 / fps
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
    let danceStart
    for (let idleFrames = 5; idleFrames <= 5 * fps; idleFrames += 5) {
      danceStart = await step(5, 'dance')
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
    const danceEndTime = now()
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

    // Reverse without an idle frame, retreating only 2 units: the hero tiles beside the lane stay folded up, so the
    // approach starts no new voice, and walking on avoids walk-start/stop and hum voices before the contact.
    await walkAxisTo('z', PAGE_MIN_Z + 2)
    const beforeBump = await pose()
    await page.keyboard.down('KeyW')
    const bumpAt = await step(Math.ceil((beforeBump.z - PAGE_MIN_Z) * fps / walkSpeed) + 1, 'edge', PAGE_MIN_Z)
    await step(2 * fps)
    await page.keyboard.up('KeyW')

    await walkAxisTo('z', (await pose()).z + walkSpeed / fps)
    const layout = createLayout(0)
    const route = planBridgeWalk(layout, await pose())
    await walkAxisTo('x', route.edgeTurn.x)
    await walkAxisTo('z', route.pathTurn.z)
    const paperStart = now()
    await walkAxisTo('x', route.entry.x)
    const paperEnd = now()
    // The next fold re-anchors the chime grid within the same phrase.
    await step(Math.round(2.25 * fps))
    const bridgeStart = now()
    const bridgeBoundary = (route.bridge.i - 0.5) * TILE_SIZE
    const bridgeEntry = await walkAxisTo('x', route.turnOnBridgeX, 'bridge-entry', bridgeBoundary)
    const bridgeExit = await walkAxisTo('x', route.entry.x, 'bridge-exit', bridgeBoundary)
    const bridgeReentry = await walkAxisTo('x', route.turnOnBridgeX, 'bridge-entry', bridgeBoundary)
    const bridgeEnd = now()

    const interruptedDanceStart = await step(4 * fps + 5, 'dance')
    await step(Math.round(fps))
    await page.keyboard.down('KeyA')
    await step(1)
    const interruptedAt = now()
    const interruptedState = (await pose()).state
    await page.keyboard.up('KeyA')
    await step(Math.ceil(clipSeconds * fps))

    const { cueLog, popLog, audioReadyMs, audioLog: notes } = await page.evaluate(() => {
      const { cueLog, popLog, audioReadyMs, audioLog } = window.__atlas
      return { cueLog, popLog, audioReadyMs, audioLog }
    })
    const foldLog = (await folds()).filter(({ t }) => t > unlockedAt)
    const melody = notes.filter(({ harmony }) => harmony !== true)
    const harmony = notes.filter(({ harmony }) => harmony === true)
    soundChecks({
      manifest, beforeInputCues, audioReadyMs, cueLog, popLog, foldLog, melody, unlockedAt,
      feltStart, feltEnd, paperStart, paperEnd, bridgeStart, bridgeEntry, bridgeExit, bridgeReentry, bridgeEnd, route,
      bumpAt, stoppedAt, danceStart, danceEndTime, interruptedDanceStart, interruptedAt, interruptedState,
    })

    const scale = new Set([2, 4, 6, 9, 11])
    const expected = phraseChimes(foldLog, eighth)
    const melodyPassed = check('unlocked-fold-chimes-in-d-major-pentatonic', {
      notesBeforeInput: beforeInput, expectedChimes: expected.length, phraseOrigins: expected.filter(({ slot }) => slot === 0)
        .map(({ origin }) => origin), notes,
    }, () => {
      assert.equal(beforeInput, 0, 'Chimes were scheduled before the input unlock')
      assert.ok(expected.length > 0, 'No post-unlock up folds occurred')
      assert.equal(melody.length, expected.length)
      for (const [index, { t, id, i, j, midi }] of melody.entries()) {
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
    check('VOX-10 phrase hold and harmony', { expected, melody, harmony }, () => {
      assert.ok(melodyPassed, 'Melody chime grid, range or cadence check failed')
      assert.ok(expected.some(({ reanchor, phrasePosition }) => reanchor && phrasePosition !== 0),
        'No fold resumed an unfinished phrase after a gap of more than six eighths and less than six seconds')
      assert.ok(expected.some(({ restart, gap }) => restart && gap >= 6 - epsilon), 'No fold restarted the phrase after six seconds')
      for (const [index, { midi }] of melody.entries()) {
        const { phrasePosition } = expected[index]
        const allowed = phrasePosition === 3 ? [phrase[3], 81] : [phrase[phrasePosition]]
        assert.ok(allowed.includes(midi), `MIDI ${midi} is not a phrase note at position ${phrasePosition + 1}`)
      }
      assert.ok(harmony.length > 0, 'No harmony chimes were scheduled')
      const harmonized = new Set()
      for (const note of harmony) {
        const index = melody.findIndex(({ t }) => Math.abs(t - note.t) < epsilon)
        assert.ok(index >= 0, `Harmony at ${note.t}s did not share a melody onset`)
        assert.ok(!harmonized.has(index), `More than one harmony at ${note.t}s`)
        harmonized.add(index)
        const degree = pentatonic.indexOf(melody[index].midi)
        assert.equal(note.midi, pentatonic[degree >= 2 ? degree - 2 : degree + 2],
          `Harmony at ${note.t}s is not two pentatonic degrees below the melody (above at the range floor)`)
        const { fold } = expected[index]
        const second = foldLog.find(({ t, dir, id }) => t === fold.t && dir === 'up' && id !== fold.id)
        assert.ok(second, `Harmony at ${note.t}s had no second tile type on its fold frame`)
        assert.deepEqual([note.id, note.i, note.j], [second.id, second.i, second.j], 'Harmony uses the wrong tile')
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
const missingChecks = requiredChecks.filter((name) => !checks.some((check) => check.name === name))
const passed = missingChecks.length === 0 && checks.every((check) => check.passed)
await mkdir(dirname(output), { recursive: true })
await writeJson(output, { url: url.href, browser: headless ? 'headless Chromium' : 'headed Chromium', fps, passed, missingChecks, checks })
for (const { name, passed, error } of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${error ? `: ${error}` : ''}`)
for (const name of missingChecks) console.log(`FAIL ${name}: required check did not run`)
console.log(output)
process.exitCode = passed ? 0 : 1
