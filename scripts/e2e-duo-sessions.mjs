// Launch scaffolding for the DUO-* gate: page setup, the frame-stepped driver and the three scripted routes.
// Scenario text in tests/e2e/duo.feature never names seeds, URLs or frame numbers; they live here.
import assert from 'node:assert/strict'
import { createSteppedPage, headless, previewURL } from './capture.mjs'
import { installProbe, serveThree } from './e2e-duo-probe.mjs'
import { duoContract as C, pathClear, planBlockedHop, planBridge, planLane } from './e2e-duo-plan.mjs'

export const fps = 60
export const duoViewports = headless
  ? [{ width: 320, height: 180 }, { width: 480, height: 270 }]
  : [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]
export const frames = (seconds) => Math.round(seconds * fps)
const headingOf = (dx, dz) => Math.atan2(dx, dz)
const keyForAxis = { x: { 1: 'KeyD', '-1': 'KeyA' }, z: { 1: 'KeyS', '-1': 'KeyW' } }
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// Steps the game one frame at a time through the in-page probe and keeps the whole trace.
// A mark's `f` is the first frame whose update sees the action.
export class Driver {
  constructor({ page, errors }, label) {
    this.page = page
    this.errors = errors
    this.label = label
    this.frame = 0
    this.trace = []
    this.marks = []
    this.held = new Set()
  }

  async run(count, until = null, arg = null) {
    const { hit, trace } = await this.page.evaluate(
      ([first, total, test, value]) => window.__duoProbe.run(first, total, test, value),
      [this.frame + 1, count, until && until.toString(), arg],
    )
    const held = [...this.held]
    for (const sample of trace) this.trace.push({ ...sample, held })
    this.frame += trace.length
    return { hit, last: this.trace.at(-1) }
  }

  seconds(seconds, until, arg) {
    return this.run(frames(seconds), until, arg)
  }

  async waitFor(seconds, until, arg, what) {
    const { hit, last } = await this.run(frames(seconds), until, arg)
    assert.ok(hit, `${this.label}: ${what} did not happen within ${seconds}s (frame ${this.frame})`)
    return last
  }

  get last() {
    return this.trace.at(-1)
  }

  mark(type, extra = {}) {
    const mark = { f: this.frame + 1, type, ...extra }
    this.marks.push(mark)
    return mark
  }

  async down(code) {
    await this.page.keyboard.down(code)
    this.held.add(code)
    return this.mark('down', { code })
  }

  async up(code) {
    await this.page.keyboard.up(code)
    this.held.delete(code)
    return this.mark('up', { code })
  }

  async tap(code) {
    await this.page.keyboard.press(code)
    return this.mark(code === 'Space' ? 'space' : 'tap', { code })
  }

  async teleport(x, z, heading) {
    await this.page.evaluate((pose) => window.__atlasLookShots.pose(pose), { x, z, heading, zoom: 1 })
    return this.mark('teleport', { x, z })
  }

  async click(point, type = 'click') {
    await this.page.mouse.click(point.x, point.y)
    return this.mark(type, point)
  }

  project(x, z, y = 0) {
    return this.page.evaluate(([px, py, pz]) => window.__duoProbe.project(px, py, pz), [x, y, z])
  }

  // A point inside the follower's projected bounds that is not inside the leader's, else its centre.
  followerPoint() {
    const s = this.last
    const follower = s[s.leader === 'b' ? 'a' : 'b'].rect
    const leader = s[s.leader].rect
    const inside = ([x0, y0, x1, y1], x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
    for (const v of [0.5, 0.35, 0.65, 0.2, 0.8]) for (const u of [0.5, 0.3, 0.7]) {
      const point = { x: follower[0] + (follower[2] - follower[0]) * u, y: follower[1] + (follower[3] - follower[1]) * v }
      if (!inside(leader, point.x, point.y)) return point
    }
    return { x: (follower[0] + follower[2]) / 2, y: (follower[1] + follower[3]) / 2 }
  }

  logs() {
    return this.page.evaluate(() => ({
      cueLog: window.__atlas.cueLog.map((cue) => ({ ...cue })),
      foldLog: window.__atlas.foldLog.map((fold) => ({ ...fold })),
    }))
  }

  async result(extra = {}) {
    return {
      label: this.label, surface: this.surface, initial: this.initial, trace: this.trace, marks: this.marks,
      ...(await this.logs()), errors: [...this.errors], ...extra,
    }
  }
}

const predicates = {
  leaderDance: (s) => s.L.state === 'dance',
  followerDance: (s) => s.F.state === 'dance',
  bothIdle: (s) => s.L.state !== 'dance' && s.F.state !== 'dance',
  hop: (s) => s.hop,
  landed: (s) => !s.hop,
  swapped: (s, count) => s.swaps > count,
  leaderVoice: (s, count, atlas) => atlas.cueLog.slice(count).some(({ kind, cause }) => kind === 'voice' && cause === 'dance'),
  followerInDeck: (s, deck) => Math.abs(s.F.x - deck.x) <= 0.3 && s.F.x < s.L.x,
  leaderPast: (s, x) => s.L.x <= x,
}

export async function openDuo(browser, viewport, { baseURL = previewURL, seed, label, manifest } = {}) {
  const stepped = await createSteppedPage(browser, viewport, { waitForAudio: true })
  const { page } = stepped
  await serveThree(page)
  if (manifest) {
    await page.route('**/audio/manifest.json', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, json: manifest(await response.json()) })
    })
  }
  const url = new URL(baseURL)
  for (const name of ['debug', 'plain', 'cam', 'focus']) url.searchParams.delete(name)
  url.searchParams.set('seed', String(seed))
  url.searchParams.set('look-shots', '')
  url.searchParams.set('look-probe', '')
  await stepped.open(url.href)
  await page.waitForFunction(() => Number.isFinite(window.__atlas.audioReadyMs), undefined, { polling: 50, timeout: 30_000 })
  await page.waitForFunction(() => window.__atlasLookShots?.scene, undefined, { polling: 50, timeout: 5000 })
  const surface = await page.evaluate(() => {
    const { duo } = window.__atlas
    if (!duo) return null
    const follower = duo.follower && { x: duo.follower.x, z: duo.follower.z, state: duo.follower.state }
    return { keys: Object.keys(duo), leader: duo.leader, follower, swaps: duo.swaps, pendingSwap: duo.pendingSwap, swap: typeof duo.swap }
  })
  assert.ok(surface, 'window.__atlas.duo is missing: the duo implementation is not in this build')
  await installProbe(page)
  const driver = new Driver(stepped, `${label} ${viewport.width}x${viewport.height}`)
  driver.surface = surface
  driver.initial = await page.evaluate(() => window.__duoProbe.peek())
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__atlasAudioUnlocked, undefined, { polling: 50, timeout: 5000 })
  driver.mark('unlock')
  return { driver, page }
}

// Walk along one axis with a held key until `target` is reached (to within one frame of travel).
async function walkAxis(driver, axis, target, limitSeconds = 20) {
  const start = driver.last ?? driver.initial
  const sign = Math.sign(target - start.L[axis])
  if (!sign) return
  const code = keyForAxis[axis][sign]
  await driver.down(code)
  await driver.waitFor(limitSeconds, `(s, a) => (s.L[a.axis] - a.target) * a.sign >= -0.01`, { axis, target, sign },
    `leader reaching ${axis}=${target}`)
  await driver.up(code)
}

// Lane: the long open corridor. Covers following, idle slots, dances, every swap path and hops.
export async function laneSession(browser, viewport, options) {
  const plan = planLane()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'lane' })
  const notes = { seed: plan.seed }
  const s = () => driver.last
  const sideOf = (point) => {
    // Pick the X direction that stays inside the planned lane.
    const east = point.x + 4.4 <= plan.lane.maxX
    return east ? 1 : -1
  }

  // P1 start and stand.
  await driver.seconds(1)
  // P2 straight walk east, with a 1-unit leader jump at 3 s to force a sustained catch-up.
  await driver.down('KeyD')
  await driver.seconds(3)
  notes.catchUp = await driver.teleport(s().L.x + 1, s().L.z, headingOf(1, 0))
  await driver.seconds(5)
  await driver.up('KeyD')
  notes.stopEast = driver.mark('stop')
  // P3 idle slot.
  await driver.seconds(2)
  // P4 walk into the follower standing in its slot, then back to the lane centre.
  const side = Math.sign(s().F.z - s().L.z) || 1
  const toward = side > 0 ? 'KeyS' : 'KeyW'
  const back = side > 0 ? 'KeyW' : 'KeyS'
  notes.approach = await driver.down(toward)
  await driver.seconds(0.7)
  await driver.up(toward)
  await driver.down(back)
  await driver.seconds(0.7)
  await driver.up(back)
  // P5 dance 1, ended by a movement key tap.
  await driver.waitFor(6, predicates.leaderDance, null, 'leader dance 1')
  await driver.waitFor(1, predicates.followerDance, null, 'follower dance 1')
  await driver.seconds(0.8)
  notes.danceKey = await driver.tap('KeyW')
  await driver.seconds(0.5)
  // P6 dance 2: swap two frames after the leader's dance voice starts (guard suppresses the swap line).
  await driver.waitFor(6, predicates.leaderDance, null, 'leader dance 2')
  const cueCount = s().cues
  await driver.waitFor(2, predicates.leaderVoice, cueCount, 'leader dance voice')
  await driver.run(2)
  notes.swapDancing = await driver.tap('Space')
  await driver.seconds(0.3)
  // P7 the new leader walks off: the reset trail (follower to leader) is shorter than 1.1.
  await driver.down('KeyA')
  notes.shortTrail = driver.mark('short-trail')
  await driver.seconds(1.5)
  // P8 swap while walking; two presses in the cooldown cancel each other.
  notes.swapWalking = await driver.tap('Space')
  await driver.seconds(0.1)
  notes.evenFirst = await driver.tap('Space')
  await driver.seconds(0.1)
  notes.evenSecond = await driver.tap('Space')
  await driver.seconds(1.5)
  await driver.up('KeyA')
  notes.stopWest = driver.mark('stop')
  // P9 A->B with a line, then three presses in the cooldown: the odd one swaps back at +0.5 s.
  await driver.seconds(1.2)
  notes.swapStanding = await driver.tap('Space')
  notes.oddPresses = []
  for (let i = 0; i < 3; i++) {
    await driver.seconds(0.1)
    notes.oddPresses.push(await driver.tap('Space'))
  }
  await driver.seconds(1.8)
  // P10 click on the follower.
  notes.followerClick = await driver.click(driver.followerPoint(), 'follower-click')
  await driver.seconds(1.5)
  // P11 dance 3 (troll B leads), ended by a click-walk; a click on the follower during the walk swaps and cancels it.
  await driver.waitFor(6, predicates.leaderDance, null, 'leader dance 3')
  await driver.waitFor(1, predicates.followerDance, null, 'follower dance 3')
  await driver.seconds(0.6)
  const dir = sideOf(s().L) > 0 && pathClear(plan.layout, s().L, { x: s().L.x + 1.5, z: s().L.z }) ? 1 : -1
  notes.walkTarget = { x: s().L.x + dir * 1.5, z: s().L.z }
  const ground = await driver.project(notes.walkTarget.x, notes.walkTarget.z)
  notes.groundClick = await driver.click(ground, 'ground-click')
  await driver.seconds(0.4)
  notes.clickDuringWalk = await driver.click(driver.followerPoint(), 'follower-click')
  await driver.seconds(1.5)
  // P12a swap requested during a recovery hop waits for the landing.
  const jump = (point) => {
    const sx = sideOf(point)
    return { x: point.x + sx * 4, z: point.z, sx }
  }
  let to = jump(s().L)
  notes.hopTeleport = await driver.teleport(to.x, to.z, headingOf(to.sx, 0))
  await driver.waitFor(1.5, predicates.hop, null, 'recovery hop')
  await driver.run(2)
  notes.swapHopping = await driver.tap('Space')
  await driver.waitFor(2, predicates.landed, null, 'hop landing')
  await driver.seconds(2)
  // P12b a swap, then a second request whose cooldown ends inside a hop that started in between.
  to = jump(s().L)
  notes.overlapTeleport = await driver.teleport(to.x, to.z, headingOf(to.sx, 0))
  await driver.seconds(0.3)
  notes.overlapSwap = await driver.tap('Space')
  await driver.seconds(0.1)
  notes.overlapPending = await driver.tap('Space')
  await driver.seconds(2.5)
  // P13 dance 4, ended by leader displacement alone (no input).
  await driver.waitFor(6, predicates.leaderDance, null, 'leader dance 4')
  await driver.waitFor(1, predicates.followerDance, null, 'follower dance 4')
  await driver.seconds(0.5)
  const nudge = sideOf(s().L)
  notes.danceNudge = await driver.teleport(s().L.x + nudge * 0.3, s().L.z, headingOf(nudge, 0))
  await driver.seconds(1)
  return driver.result({ session: 'lane', plan: { seed: plan.seed, lane: plan.lane }, notes })
}

// Bridge: troll B leads over a yarn bridge whose deck has river on both sides.
export async function bridgeSession(browser, viewport, options) {
  const plan = planBridge()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'bridge' })
  const notes = { seed: plan.seed, bridge: plan.bridge }
  await driver.seconds(0.5)
  notes.swapStart = await driver.tap('Space')
  await driver.seconds(1)
  await walkAxis(driver, 'x', 0)
  await walkAxis(driver, 'z', plan.corner.z)
  notes.turn = driver.mark('turn')
  await walkAxis(driver, 'x', plan.bridge.x)
  notes.deckStop = driver.mark('deck-stop')
  await driver.seconds(2)
  await driver.down('KeyD')
  await driver.waitFor(4, predicates.followerInDeck, plan.bridge, 'follower on the deck')
  await driver.up('KeyD')
  notes.reverse = await driver.down('KeyA')
  await driver.waitFor(6, predicates.leaderPast, plan.entry.x, 'leader passing back over the deck')
  await driver.up('KeyA')
  await driver.seconds(2)
  return driver.result({ session: 'bridge', plan: { seed: plan.seed, bridge: plan.bridge, corner: plan.corner, entry: plan.entry, exit: plan.exit }, notes })
}

// Corner: the leader jumps away from a corner so the follower's straight hop line crosses a prop.
export async function cornerSession(browser, viewport, options) {
  const plan = planBlockedHop()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'corner' })
  const notes = { seed: plan.seed }
  await driver.seconds(0.5)
  await walkAxis(driver, 'x', plan.corner.x)
  await walkAxis(driver, 'z', plan.corner.z)
  await driver.seconds(0.1)
  notes.teleport = await driver.teleport(plan.leader.x, plan.leader.z, headingOf(plan.sx, 0))
  await driver.seconds(4)
  return driver.result({
    session: 'corner', plan: { seed: plan.seed, corner: plan.corner, leader: plan.leader, landing: plan.landing, dirZ: plan.dirZ, sx: plan.sx }, notes,
  })
}

// Missing samples: the routed manifest drops two B cues; the game must skip them silently.
export const droppedCues = ['b_voice_lead', 'b_voice_giggle']
export async function missingSampleSession(browser, viewport, options) {
  const plan = planLane()
  const { driver } = await openDuo(browser, viewport, {
    ...options, seed: plan.seed, label: 'missing-sample',
    manifest: (json) => {
      for (const cue of droppedCues) delete json.cues[cue]
      return json
    },
  })
  await driver.seconds(0.5)
  const swap = await driver.tap('Space')
  await driver.seconds(1)
  await driver.waitFor(6, predicates.leaderDance, null, 'troll B dance')
  await driver.waitFor(5, predicates.bothIdle, null, 'dance end')
  return driver.result({ session: 'missing-sample', plan: { seed: plan.seed }, notes: { swap } })
}

export { distance }
