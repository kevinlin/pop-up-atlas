// Launch scaffolding for the round-6 gate (R6-*): the four scripted routes. Scenario text in tests/e2e/round6.feature never
// names seeds, URLs or frame numbers; they live here and in e2e-duo-round6-plan.mjs. Every session returns a result shaped
// like the duo sessions' (trace, marks, logs, rec) so the analyses in e2e-duo-round6.mjs read all of them the same way.
import { frames, headingOf, keyForAxis, openDuo, predicates, walkAxis } from './e2e-duo-sessions.mjs'
import { planHum, planRiver, planStage } from './e2e-duo-round6-plan.mjs'

// Scenarios each route step serves. A failed step fails these (and only these) with its error.
export const round6SessionScenarios = {
  stage: ['R6-CAM-01', 'R6-CAM-02', 'R6-CAM-03', 'R6-CAM-04', 'R6-CAM-05', 'R6-CAM-07', 'R6-CAM-08', 'R6-FOLD-01', 'R6-FOLD-02',
    'R6-FOLD-03', 'R6-FOLD-04', 'R6-FOLD-05', 'R6-CHR-02', 'R6-CHR-03', 'R6-CHR-04', 'R6-CHR-05', 'R6-CHR-06', 'R6-AUD-01'],
  river: ['R6-CHR-02', 'R6-CHR-05', 'R6-CHR-07', 'R6-AUD-01'],
  hum: ['R6-CHR-01', 'R6-CHR-06', 'R6-AUD-01', 'R6-AUD-02'],
  'fixed-camera': ['R6-CAM-06'],
}

const heroBeat = (s) => s.camera?.beat === 'hero'
// What a result carries about its plan: everything but the layout object, which does not serialise.
const planNotes = ({ layout, ...rest }) => rest

// Stage: a hero prop beside a straight corridor. A leads past it (hero beat; a second hero fold-up inside the 8 s gap), a
// swap inside a later beat, B dances next to the prop (dance stage, dance beat, umbrella bow, B's voice bank), B walks into
// the prop (bump), A takes over and walks away (the prop drops to -90°), and a recovery hop lands inside a third hero beat.
export async function stageSession(browser, viewport, options) {
  const plan = planStage()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'stage' })
  const notes = { seed: plan.seed }
  const s = () => driver.last
  const ids = round6SessionScenarios.stage
  const step = (name, fn) => driver.phase(name, ids, notes, fn)
  const { prop, xs, z0, stop, lateral } = plan
  const along = (x) => walkAxis(driver, 'x', x)

  // The first walk start after 1 s standing is a skip by the seed's hash; it carries on into the legs below.
  await step('S1 stand 1.2 s, walk to the corridor', async () => {
    await driver.seconds(1.2)
    notes.start = driver.mark('first-walk')
    await along(xs)
    await walkAxis(driver, 'z', z0)
    await driver.seconds(0.5)
  })
  // Pass 1: east past the prop (hero beat, fold-down beyond 3), then back west (a second fold-up 5 s after the first beat's
  // start, which the 8 s gap suppresses).
  await step('S2 pass 1 and back', async () => {
    notes.pass1 = driver.mark('pass-1')
    await along(prop.x + 3.2)
    await along(stop.x - 4.6)
    await driver.seconds(0.5)
  })
  // Pass 2: a hero beat, cut short by a swap.
  await step('S3 pass 2: a swap inside a hero beat', async () => {
    await driver.down('KeyD')
    driver.mark('follow-leg')
    await driver.waitFor(14, heroBeat, null, 'a hero beat')
    notes.beat2 = { f: s().f }
    await driver.seconds(0.5)
    notes.swapInBeat = await driver.tap('Space')
    await driver.seconds(0.3)
    await driver.up('KeyD')
    driver.mark('follow-leg-end')
    await driver.seconds(1)
  })
  // B (leading) walks to the dance spot and idles into the dance: dance stage, dance beat, bow.
  await step('S4 B dances beside the prop', async () => {
    await along(stop.x)
    notes.stopped = driver.mark('stop')
    await driver.waitFor(8, predicates.leaderDance, null, 'the leader starting to dance')
    notes.danceStart = { f: s().f }
    await driver.waitFor(8, predicates.bothIdle, null, 'the dance finishing')
    await driver.seconds(0.6)
  })
  // B walks into the prop: hmph and frown, a bump event.
  await step('S5 B bumps the prop', async () => {
    await driver.seconds(3.2)
    const toward = keyForAxis.z[Math.sign(prop.z - s().L.z) || 1]
    notes.bump = await driver.down(toward)
    await driver.seconds(1.4)
    await driver.up(toward)
    await driver.seconds(0.6)
  })
  await step('S6 swap back to A', async () => {
    notes.swapBack = await driver.tap('Space')
    await driver.seconds(1.6)
  })
  // A walks west until the prop is beyond 5.5 units away: the prop drops to -90° (stage 1 ends) without a sound.
  await step('S7 walk away beyond 5.5', async () => {
    await along(prop.x - Math.sqrt(5.9 ** 2 - lateral ** 2))
    await driver.seconds(2)
  })
  // The third hero beat; a recovery hop inside it cancels it.
  await step('S8 pass 3: a hop inside a hero beat', async () => {
    await driver.down('KeyD')
    driver.mark('follow-leg')
    await driver.waitFor(14, heroBeat, null, 'the third hero beat')
    await driver.seconds(0.3)
    // 4.4 units: beyond the 2.6 recovery gap, still inside the frame of the default camera (R6-CAM-08 has no exemption).
    notes.hopJump = await driver.teleport(s().L.x - 4.4, z0, headingOf(1, 0))
    driver.mark('follow-leg-end')
    await driver.waitFor(3, predicates.hop, null, 'the recovery hop')
    await driver.up('KeyD')
    await driver.waitFor(3, predicates.landed, null, 'the hop landing')
    await driver.seconds(1.2)
  })
  return driver.result({ plan: planNotes(plan), notes })
}

// Fixed camera: the stage corridor under `?cam=9,40`: a hero fold-up, a swap and the dance, and the camera never moves.
export async function fixedCameraSession(browser, viewport, options) {
  const plan = planStage()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'fixed-camera', params: { cam: '9,40' } })
  const notes = { seed: plan.seed }
  const ids = round6SessionScenarios['fixed-camera']
  const step = (name, fn) => driver.phase(name, ids, notes, fn)
  const { xs, z0, stop } = plan

  await step('F1 walk past the prop (a hero fold-up) and stop', async () => {
    await driver.seconds(1.2)
    await walkAxis(driver, 'x', xs)
    await walkAxis(driver, 'z', z0)
    await walkAxis(driver, 'x', stop.x)
    notes.stopped = driver.mark('stop')
    await driver.seconds(0.6)
  })
  await step('F2 swap', async () => {
    notes.swap = await driver.tap('Space')
    await driver.seconds(1)
  })
  await step('F3 dance', async () => {
    await driver.waitFor(8, predicates.leaderDance, null, 'the leader starting to dance')
    await driver.waitFor(8, predicates.bothIdle, null, 'the dance finishing')
    await driver.seconds(1.2)
  })
  return driver.result({ plan: planNotes(plan), notes })
}

// River: A stands, walks, B (follower) looks, a swap interrupts the look; B leads east into a river and holds against it.
export async function riverSession(browser, viewport, options) {
  const plan = planRiver()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'river' })
  const notes = { seed: plan.seed }
  const s = () => driver.last
  const ids = round6SessionScenarios.river
  const step = (name, fn) => driver.phase(name, ids, notes, fn)
  const { river } = plan

  await step('V1 stand 2.6 s, walk, B looks, a swap interrupts it', async () => {
    await driver.seconds(2.6)
    notes.walk = await driver.down('KeyD')
    await driver.waitFor(4, (_s, _a, atlas) => atlas.duo.look?.active === true, null, 'troll B starting its look')
    notes.lookSeen = { f: s().f }
    await driver.seconds(0.2)
    notes.swapInLook = await driver.tap('Space')
    await driver.up('KeyD')
    await driver.seconds(1.2)
  })
  // Make sure B leads from here on, wherever the look step ended, and stands on the river's row.
  await step('V2 B leads', async () => {
    if (s().leader !== 'b') {
      notes.swapB = await driver.tap('Space')
      await driver.seconds(1.2)
    }
    await walkAxis(driver, 'z', river.z)
    await walkAxis(driver, 'x', 0.2)
    await driver.seconds(0.4)
  })
  // East along the row until blocked, then keep the key down: bumps repeat every 3 s, the umbrella with them.
  await step('V3 into the river', async () => {
    notes.east = await driver.down('KeyD')
    driver.mark('follow-leg')
    await driver.waitFor(14, (sample) => sample.blockedBy === 'river', null, 'the river collision')
    notes.collision = { f: s().f }
    await driver.seconds(6.6)
    await driver.up('KeyD')
    driver.mark('follow-leg-end')
    await driver.seconds(1.6)
  })
  return driver.result({ plan: planNotes(plan), notes })
}

// Hum: troll A stands, walks on a skip and keeps walking until the melody's top note (MIDI 81, which its hum sings an
// octave down) has been scheduled; then it stands for the hum.
export async function humSession(browser, viewport, options) {
  const plan = planHum()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'hum' })
  const notes = { seed: plan.seed }
  const ids = round6SessionScenarios.hum
  const step = (name, fn) => driver.phase(name, ids, notes, fn)
  const { lane } = plan
  const high = () => driver.page.evaluate(() => window.__atlas.audioLog.some((note) => note.harmony !== true && note.midi > 78))

  await step('H1 stand 1.2 s', () => driver.seconds(1.2))
  await step('H2 walk until the top note', async () => {
    notes.start = driver.mark('first-walk')
    await walkAxis(driver, 'z', 0.6)
    let sign = 1
    for (let leg = 0; leg < 6; leg++) {
      const code = keyForAxis.x[sign]
      await driver.down(code)
      driver.mark('follow-leg')
      await driver.run(frames(30), (sample, a, atlas) => (sample.L.x - a.edge) * a.sign >= 0
        || atlas.audioLog.some((note) => note.harmony !== true && note.midi > 78),
      { edge: sign > 0 ? lane.maxX - 1.6 : lane.minX + 1.6, sign })
      driver.mark('follow-leg-end')
      await driver.up(code)
      if (await high()) break
      sign = -sign
    }
    if (!await high()) throw new Error(`${driver.label}: no melody note above MIDI 78 was scheduled in six legs`)
    notes.high = { f: driver.frame }
  })
  // The hum starts after the stand-still delay and sings the last three notes of the phrase.
  await step('H3 stand for the hum', () => driver.seconds(4.5))
  return driver.result({ plan: planNotes(plan), notes })
}
