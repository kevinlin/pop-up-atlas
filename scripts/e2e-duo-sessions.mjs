// Launch scaffolding for the DUO-* gate: page setup, the frame-stepped driver and the three scripted routes.
// Scenario text in tests/e2e/duo.feature never names seeds, URLs or frame numbers; they live here.
import assert from 'node:assert/strict'
import { createSteppedPage, headless, previewURL } from './capture.mjs'
import { installProbe, serveThree } from './e2e-duo-probe.mjs'
import { pathClear, planBlockedHop, planBridge, planLane, planTeleport } from './e2e-duo-plan.mjs'

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
    this.failures = []
  }

  // Runs one route step. A failure is recorded against the scenarios `ids` that depend on the step (the
  // notes it set are dropped so no check reads a half-done step); held keys are released, the pair gets
  // 0.5 s to settle and the route carries on.
  async phase(name, ids, notes, fn) {
    const before = new Set(Object.keys(notes))
    try {
      await fn()
      return true
    } catch (error) {
      for (const key of Object.keys(notes)) if (!before.has(key)) delete notes[key]
      this.failures.push({ phase: name, ids, error: String(error?.message ?? error).split('\n')[0] })
      this.mark('phase-failed', { phase: name })
      try {
        for (const code of [...this.held]) await this.up(code)
        await this.seconds(0.5)
      } catch {
        // The page is gone; later steps fail on their own.
      }
      return false
    }
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
      ...(await this.logs()), errors: [...this.errors], failures: [...this.failures], ...extra,
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
  // Every axis walk is ordinary following (DUO-05); pass-through legs drive keys directly and are not marked.
  driver.mark('follow-leg')
  await driver.waitFor(limitSeconds, `(s, a) => (s.L[a.axis] - a.target) * a.sign >= -0.01`, { axis, target, sign },
    `leader reaching ${axis}=${target}`)
  driver.mark('follow-leg-end')
  await driver.up(code)
}

// The movement key whose direction is closest to (dx, dz).
const keyToward = (dx, dz) => (Math.abs(dx) >= Math.abs(dz) ? keyForAxis.x[dx >= 0 ? 1 : -1] : keyForAxis.z[dz >= 0 ? 1 : -1])
const opposite = { KeyD: 'KeyA', KeyA: 'KeyD', KeyW: 'KeyS', KeyS: 'KeyW' }

// Scenarios each route step serves. A failed step fails these (and only these) with its error.
export const sessionScenarios = {
  lane: ['DUO-01', 'DUO-03', 'DUO-04', 'DUO-05', 'DUO-06', 'DUO-07', 'DUO-08', 'DUO-09', 'DUO-10', 'DUO-11', 'DUO-13', 'DUO-14',
    'DUO-15', 'DUO-17', 'DUO-18', 'DUO-19', 'DUO-20', 'DUO-21', 'DUO-22', 'DUO-23', 'DUO-24', 'DUO-25', 'DUO-26', 'DUO-27',
    'DUO-28', 'DUO-29', 'DUO-30', 'DUO-34', 'DUO-35', 'DUO-36', 'DUO-37', 'DUO-41'],
  bridge: ['DUO-09', 'DUO-10', 'DUO-12', 'DUO-34', 'DUO-35', 'DUO-36', 'DUO-41'],
  corner: ['DUO-16', 'DUO-34', 'DUO-35', 'DUO-36', 'DUO-41'],
  'missing-sample': ['DUO-31', 'DUO-41'],
}

// Reads the page's camera right vector (XZ) when no earlier session has.
export async function readCameraRight(browser, viewport, options) {
  const { seed } = planLane()
  const { driver, page } = await openDuo(browser, viewport, { ...options, seed, label: 'camera' })
  await page.close()
  return driver.initial.right
}

// Lane: the long open corridor. Covers following, idle slots, dances, every swap path and hops.
export async function laneSession(browser, viewport, options) {
  const plan = planLane()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'lane' })
  const notes = { seed: plan.seed }
  const s = () => driver.last
  const step = (name, ids, fn) => driver.phase(name, ids, notes, fn)
  const { lane } = plan
  const inside = (point) => point.x >= lane.minX + 0.6 && point.x <= lane.maxX - 0.6 && Math.abs(point.z - lane.z) <= lane.halfWidth - 0.6
  const room = (from, sign, length) => {
    const to = { x: from.x + sign * length, z: from.z }
    return inside(to) && pathClear(plan.layout, from, to)
  }
  // The sign along the camera's right vector that leads away from the follower, if `length` of it is clear.
  const awayAlongRight = (length) => {
    const { L, F, right } = s()
    const away = (F.x - L.x) * right.x + (F.z - L.z) * right.z > 0 ? -1 : 1
    for (const sign of [away, -away]) {
      const to = { x: L.x + right.x * sign * length, z: L.z + right.z * sign * length }
      if (inside(to) && pathClear(plan.layout, L, to)) return { sign, to }
    }
    throw new Error(`no clear ${length}-unit step along the camera right vector from ${JSON.stringify(L)}`)
  }
  // Walk to the lane centre so the follower trails behind, let it settle in a slot, then make a legal hop jump.
  const hopJump = async (back) => {
    const centre = (lane.minX + lane.maxX) / 2
    await walkAxis(driver, 'x', s().L.x > centre ? centre - 1 : centre + 1)
    await driver.seconds(1.2)
    const { L, F, right } = s()
    const jump = planTeleport(plan.layout, { leader: L, follower: F, right, inside, back })
    assert.ok(jump, `no legal recovery-hop jump from leader ${JSON.stringify(L)} with follower ${JSON.stringify(F)}`)
    return { jump, mark: await driver.teleport(jump.x, jump.z, jump.heading) }
  }

  // P1 start and stand.
  await step('P1 start', ['DUO-03'], () => driver.seconds(1))
  // P2 straight walk east, with a 1-unit leader jump at 3 s to force a sustained catch-up.
  await step('P2 straight walk and catch-up', ['DUO-05', 'DUO-06', 'DUO-07', 'DUO-37'], async () => {
    await driver.down('KeyD')
    driver.mark('follow-leg')
    await driver.seconds(3)
    notes.catchUp = await driver.teleport(s().L.x + 1, s().L.z, headingOf(1, 0))
    await driver.seconds(5)
    driver.mark('follow-leg-end')
    await driver.up('KeyD')
    notes.stopEast = driver.mark('stop')
  })
  // P3 idle slot.
  await step('P3 idle slot', ['DUO-11'], () => driver.seconds(2))
  // P4 walk into the follower standing in its slot, then back.
  await step('P4 walk into the follower', ['DUO-08'], async () => {
    const toward = keyToward(s().F.x - s().L.x, s().F.z - s().L.z)
    notes.approach = await driver.down(toward)
    await driver.seconds(0.7)
    await driver.up(toward)
    await driver.down(opposite[toward])
    await driver.seconds(0.7)
    await driver.up(opposite[toward])
  })
  // P5 dance 1, ended by a movement key tap.
  await step('P5 dance 1, key ending', ['DUO-13', 'DUO-14'], async () => {
    await driver.waitFor(6, predicates.leaderDance, null, 'leader dance 1')
    await driver.waitFor(1, predicates.followerDance, null, 'follower dance 1')
    await driver.seconds(0.8)
    notes.danceKey = await driver.tap('KeyW')
    await driver.seconds(0.5)
  })
  // P6 dance 2: swap two frames after the leader's dance voice starts (guard suppresses the swap line).
  await step('P6 swap while dancing', ['DUO-20', 'DUO-29', 'DUO-30'], async () => {
    await driver.waitFor(6, predicates.leaderDance, null, 'leader dance 2')
    const cueCount = s().cues
    await driver.waitFor(2, predicates.leaderVoice, cueCount, 'leader dance voice')
    await driver.run(2)
    notes.swapDancing = await driver.tap('Space')
    await driver.seconds(0.3)
  })
  // P7 the new leader walks away from the follower: the reset trail (follower to leader) is shorter than 1.1.
  let walkKey = 'KeyA'
  await step('P7 short trail', ['DUO-04'], async () => {
    const sign = Math.sign(s().L.x - s().F.x) || -1
    const chosen = room(s().L, sign, 4.2) ? sign : -sign
    walkKey = keyForAxis.x[chosen]
    await driver.down(walkKey)
    notes.shortTrail = driver.mark('short-trail')
    await driver.seconds(1.5)
  })
  // P8 swap while walking; two presses in the cooldown cancel each other.
  await step('P8 swap while walking, even presses', ['DUO-19', 'DUO-23'], async () => {
    if (!driver.held.has(walkKey)) await driver.down(walkKey)
    notes.swapWalking = await driver.tap('Space')
    await driver.seconds(0.1)
    notes.evenFirst = await driver.tap('Space')
    await driver.seconds(0.1)
    notes.evenSecond = await driver.tap('Space')
    await driver.seconds(1.5)
    await driver.up(walkKey)
    notes.stopWest = driver.mark('stop')
  })
  // P9 A->B with a line, then three presses in the cooldown: the odd one swaps back at +0.5 s.
  await step('P9 standing swap, odd presses', ['DUO-17', 'DUO-22', 'DUO-25', 'DUO-28'], async () => {
    await driver.seconds(1.2)
    notes.swapStanding = await driver.tap('Space')
    const presses = []
    for (let i = 0; i < 3; i++) {
      await driver.seconds(0.1)
      presses.push(await driver.tap('Space'))
    }
    notes.oddPresses = presses
    await driver.seconds(1.8)
  })
  // P10 click on the follower.
  await step('P10 click on the follower', ['DUO-18'], async () => {
    notes.followerClick = await driver.click(driver.followerPoint(), 'follower-click')
    await driver.seconds(1.5)
  })
  // P11 dance 3, ended by a click-walk away from the follower; a click on the follower during the walk swaps and cancels it.
  await step('P11 dance 3, click-walk ending, swap cancels click-walk', ['DUO-13', 'DUO-14', 'DUO-19'], async () => {
    await driver.waitFor(6, predicates.leaderDance, null, 'leader dance 3')
    await driver.waitFor(1, predicates.followerDance, null, 'follower dance 3')
    await driver.seconds(0.6)
    const { to } = awayAlongRight(1.5)
    const ground = await driver.project(to.x, to.z)
    notes.walkTarget = to
    notes.groundClick = await driver.click(ground, 'ground-click')
    await driver.seconds(0.4)
    notes.clickDuringWalk = await driver.click(driver.followerPoint(), 'follower-click')
    await driver.seconds(1.5)
  })
  // P12a swap requested during a recovery hop waits for the landing.
  await step('P12a recovery hop, swap mid-hop', ['DUO-15', 'DUO-21'], async () => {
    const { jump, mark } = await hopJump(false)
    notes.hopTeleport = { ...mark, landing: jump.landing, gap: jump.gap }
    await driver.waitFor(1.5, predicates.hop, null, `recovery hop after a legal jump (gap ${jump.gap.toFixed(2)}, landing ${JSON.stringify(jump.landing)})`)
    await driver.run(2)
    notes.swapHopping = await driver.tap('Space')
    await driver.waitFor(2, predicates.landed, null, 'hop landing')
    await driver.seconds(2)
  })
  // P12b a swap 0.3 s after a jump, then a second request: the swap resets the trail but not the recovery timer
  // (the gap is between the pair), so the new follower hops 0.5 s after the jump, inside the cooldown, and the
  // second swap waits for its landing.  The `back` plan keeps the line from the jump target to the old follower
  // clear, which is the new follower's hop line after the swap.
  await step('P12b swap cooldown overlapping a hop', ['DUO-24'], async () => {
    const { jump, mark } = await hopJump(true)
    notes.overlapTeleport = { ...mark, landing: jump.landing, gap: jump.gap }
    await driver.seconds(0.3)
    notes.overlapSwap = await driver.tap('Space')
    await driver.seconds(0.1)
    notes.overlapPending = await driver.tap('Space')
    await driver.seconds(2.5)
  })
  // P13 dance 4, ended by leader displacement alone (no input), away from the follower.
  await step('P13 dance 4, displacement ending', ['DUO-13', 'DUO-14'], async () => {
    await driver.waitFor(6, predicates.leaderDance, null, 'leader dance 4')
    await driver.waitFor(1, predicates.followerDance, null, 'follower dance 4')
    await driver.seconds(0.5)
    const { to, sign } = awayAlongRight(0.3)
    notes.danceNudge = await driver.teleport(to.x, to.z, headingOf(s().right.x * sign, s().right.z * sign))
    await driver.seconds(1)
  })
  return driver.result({ session: 'lane', plan: { seed: plan.seed, lane: plan.lane }, notes })
}

// Bridge: a stop at a narrow spot where both camera-right idle slots are blocked, then troll A leads over a
// yarn bridge whose deck has river on both sides.
export async function bridgeSession(browser, viewport, options) {
  const right = options.right ?? await readCameraRight(browser, viewport, options)
  const plan = planBridge({ right })
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'bridge' })
  const notes = { seed: plan.seed, bridge: plan.bridge, narrow: plan.narrow.spot }
  const pageRight = driver.initial.right
  assert.ok(pageRight && pageRight.x * right.x + pageRight.z * right.z > 0.999,
    `camera right on the bridge page ${JSON.stringify(pageRight)} differs from the planned ${JSON.stringify(right)}`)
  const step = (name, ids, fn) => driver.phase(name, ids, notes, fn)
  const { across, along } = plan.narrow.axes
  await step('B1 swap at start', ['DUO-17'], async () => {
    await driver.seconds(0.5)
    notes.swapStart = await driver.tap('Space')
    await driver.seconds(1)
  })
  // The follower trails on the last leg; neither slot is free, so it settles on the trail target.
  // A swap then lets the new leader walk back without passing through the follower.
  await step('B2 narrow spot, neither slot free', ['DUO-12'], async () => {
    // The start swap leaves troll B leading from 1.1 behind the origin; the planned legs start on along = 0.
    await walkAxis(driver, along, 0)
    await walkAxis(driver, across, plan.narrow.legStart[across])
    await walkAxis(driver, along, plan.narrow.spot[along])
    notes.narrowStop = driver.mark('narrow-stop')
    await driver.seconds(2.5)
    notes.narrowSwap = await driver.tap('Space')
    await driver.seconds(0.6)
    await walkAxis(driver, along, 0)
    await walkAxis(driver, across, 0)
  })
  await step('B3 yarn bridge deck, pass-through', ['DUO-09', 'DUO-10'], async () => {
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
  })
  return driver.result({
    session: 'bridge', notes,
    plan: { seed: plan.seed, bridge: plan.bridge, corner: plan.corner, entry: plan.entry, exit: plan.exit, narrow: plan.narrow.spot, right },
  })
}

// Corner: the leader jumps away from a corner so the follower's straight hop line crosses a prop.
export async function cornerSession(browser, viewport, options) {
  const plan = planBlockedHop()
  const { driver } = await openDuo(browser, viewport, { ...options, seed: plan.seed, label: 'corner' })
  const notes = { seed: plan.seed }
  await driver.phase('C1 blocked hop line', ['DUO-16'], notes, async () => {
    await driver.seconds(0.5)
    await walkAxis(driver, 'x', plan.corner.x)
    await walkAxis(driver, 'z', plan.corner.z)
    await driver.seconds(0.1)
    notes.teleport = await driver.teleport(plan.leader.x, plan.leader.z, headingOf(plan.sx, 0))
    // 4 s idle to the leader's dance plus room for the follower's 0.3125 s canon start (DUO-13).
    await driver.seconds(5)
  })
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
  const notes = {}
  await driver.phase('M1 troll B leads and dances', ['DUO-31'], notes, async () => {
    await driver.seconds(0.5)
    notes.swap = await driver.tap('Space')
    await driver.seconds(1)
    await driver.waitFor(6, predicates.leaderDance, null, 'troll B dance')
    await driver.waitFor(5, predicates.bothIdle, null, 'dance end')
  })
  return driver.result({ session: 'missing-sample', plan: { seed: plan.seed }, notes })
}

export { distance }
