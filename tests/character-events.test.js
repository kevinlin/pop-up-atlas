import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createCueEvents } from '../src/audio/cue-events.js'
import { createCueDirector } from '../src/audio/cues.js'
import { createDuoDanceEvents } from '../src/character/duo-events.js'
import { createFollower } from '../src/character/follow.js'
import { createRig } from '../src/character/rig.js'
import { createBumpEvents } from '../src/controls/bump.js'
import { createPlayer } from '../src/controls/movement.js'
import { createLeadSwap } from '../src/controls/swap.js'
import { setupCharacterDebug, setupDuoDebug } from '../src/debug/index.js'
import { events } from '../src/scene/runtime.js'
import { fixtureManifest } from './fixtures/audio/manifest.js'
import { buildModel, clipSet, drive, dt, record } from './fixtures/rig.js'

const cleanup = []
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn())
  vi.unstubAllGlobals()
})

// Two rigs on one bus, stepped in lockstep like the two character updates of a frame.
function duo() {
  const bus = new EventTarget()
  const shared = createDuoDanceEvents(bus)
  const make = (who) => {
    const rig = createRig(buildModel(who), clipSet(who), { who, bus, duo: shared })
    cleanup.push(rig.dispose)
    return { rig, sim: drive(rig) }
  }
  const a = make('a')
  const b = make('b')
  const log = record(bus, 'dance-start', 'dance-end', 'duo-dance-start', 'duo-dance-end', 'contact', 'hop')
  return {
    bus, a, b, log,
    frame(aState, bState, aOptions = {}, bOptions = {}) {
      a.sim.frame(aState, { leader: true, ...aOptions })
      b.sim.frame(bState, { leader: false, ...bOptions })
      return a.sim.t
    },
    get t() { return a.sim.t },
  }
}
const dances = (log) => log.filter(({ type }) => type !== 'contact' && type !== 'hop')
  .map(({ type, who, interrupted }) => [type, who, interrupted].filter((value) => value !== undefined).join(':'))

describe('dance and duo dance events', () => {
  test('the leader starts, the follower joins by canon, both finish: one duo dance, in order', () => {
    const sim = duo()
    for (let i = 0; i < 60; i += 1) sim.frame('idle', 'idle')
    const start = sim.t + dt
    let aState = 'dance'
    let bState = 'idle'
    let bStart
    let bDone = false
    for (let i = 0; i < 700 && !bDone; i += 1) {
      if (bState === 'idle' && sim.t >= start + 0.3125 - dt && bStart === undefined) {
        bState = 'dance'
        bStart = sim.t + dt
      }
      sim.frame(aState, bState)
      if (aState === 'dance' && sim.a.rig.animation.danceFinished) aState = 'idle'
      if (bState === 'dance' && sim.b.rig.animation.danceFinished) {
        bState = 'idle'
        bDone = true
      }
    }
    sim.frame(aState, bState)
    expect(dances(sim.log)).toEqual([
      'dance-start:a', 'duo-dance-start', 'dance-start:b', 'dance-end:a:false', 'dance-end:b:false', 'duo-dance-end:false',
    ])
    const at = Object.fromEntries(sim.log.filter(({ type }) => type !== 'contact').map((event) => [`${event.type}${event.who ?? ''}`, event.t]))
    expect(at['duo-dance-start']).toBe(at['dance-starta'])
    expect(at['dance-startb'] - at['dance-starta']).toBeCloseTo(0.3125, 1)
    expect(at['duo-dance-end']).toBe(at['dance-endb'])
    expect(at['dance-endb']).toBeGreaterThan(at['dance-enda'])
    expect(at['dance-enda'] - at['dance-starta']).toBeCloseTo(3, 1)
    expect(bStart).toBeCloseTo(at['dance-startb'])
  })

  test.each([
    ['both dancing', 0.8], ['before the follower has joined', 0.2],
  ])('an interruption %s ends the duo dance at once, once', (_, after) => {
    const sim = duo()
    let bState = 'idle'
    const start = sim.t
    while (sim.t < start + after) {
      if (sim.t >= start + 0.3125) bState = 'dance'
      sim.frame('dance', bState)
    }
    const interrupted = sim.t
    sim.frame('walk', 'idle', { speed: 1.2 })
    for (let i = 0; i < 20; i += 1) sim.frame('walk', 'idle', { speed: 1.2 })
    const ends = sim.log.filter(({ type }) => type === 'duo-dance-end')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ interrupted: true })
    expect(ends[0].t).toBeCloseTo(interrupted + dt)
    expect(sim.log.filter(({ type }) => type === 'dance-end').every(({ interrupted: cut }) => cut)).toBe(true)
    expect(sim.log.filter(({ type }) => type === 'duo-dance-start')).toHaveLength(1)
  })

  test('the follower being interrupted after the leader finished still ends it, as interrupted', () => {
    const sim = duo()
    let aState = 'dance'
    let bState = 'idle'
    const start = sim.t
    while (!(aState === 'idle')) {
      if (bState === 'idle' && sim.t >= start + 0.3125) bState = 'dance'
      sim.frame(aState, bState)
      if (sim.a.rig.animation.danceFinished) aState = 'idle'
    }
    sim.frame('idle', 'dance')
    expect(sim.log.some(({ type }) => type === 'duo-dance-end')).toBe(false)
    sim.frame('idle', 'idle')
    expect(sim.log.filter(({ type }) => type === 'duo-dance-end')).toMatchObject([{ interrupted: true }])
  })

  test('a swap while dancing interrupts both through their own dance-end events', () => {
    const sim = duo()
    for (let i = 0; i < 60; i += 1) sim.frame('dance', 'dance')
    sim.frame('idle', 'idle')
    expect(dances(sim.log)).toEqual([
      'dance-start:a', 'duo-dance-start', 'dance-start:b', 'dance-end:a:true', 'duo-dance-end:true', 'dance-end:b:true',
    ])
  })
})

describe('walk, hop, swap and bump events', () => {
  test('walk contacts per character, a follower hop, and the leader swap', () => {
    const sim = duo()
    for (let i = 0; i < 240; i += 1) sim.frame('walk', 'walk', { speed: 1.2 }, { speed: 1.2 })
    const contacts = sim.log.filter(({ type }) => type === 'contact')
    expect(contacts.filter(({ who }) => who === 'a').length).toBeGreaterThanOrEqual(4)
    expect(contacts.filter(({ who }) => who === 'b').length).toBeGreaterThanOrEqual(5)
    expect(contacts.every(({ t }) => t <= sim.t + 1e-9)).toBe(true)

    for (let i = 0; i < 30; i += 1) sim.frame('idle', 'hop')
    sim.frame('idle', 'idle')
    expect(sim.log.filter(({ type }) => type === 'hop')).toMatchObject([
      { who: 'b', phase: 'takeoff' }, { who: 'b', phase: 'land' },
    ])
    expect(sim.log.at(-1)).toMatchObject({ type: 'hop', phase: 'land' })
  })

  test('swap {leader, t} fires after the poses are exchanged', () => {
    const seen = []
    const listener = ({ detail }) => seen.push(detail)
    events.addEventListener('swap', listener)
    cleanup.push(() => events.removeEventListener('swap', listener))
    const calls = []
    const apply = vi.fn(() => calls.push(seen.length))
    const swap = createLeadSwap(createPlayer(), createPlayer(), apply)
    swap.request()
    swap.update(2.5, -Infinity)
    swap.request()
    swap.update(4, -Infinity)
    expect(seen).toEqual([{ leader: 'b', t: 2.5 }, { leader: 'a', t: 4 }])
    expect(apply).toHaveBeenNthCalledWith(1, 'b')
    // The event follows apply: the first call saw no event yet, the second saw the first one.
    expect(calls).toEqual([0, 1])
  })

  test('bump {who, reason, t}: one per reason every 3 s however long the key is held', () => {
    const bus = new EventTarget()
    const log = record(bus, 'bump')
    const bump = createBumpEvents(bus)
    expect(bump(1, 'a', null)).toBe(false)
    expect(bump(1, 'a', 'river')).toBe(true)
    expect(bump(2, 'a', 'river')).toBe(false)
    expect(bump(2, 'a', 'prop')).toBe(true)
    expect(bump(2.5, 'b', 'edge')).toBe(true)
    expect(bump(4, 'b', 'river')).toBe(true)
    expect(log.map(({ who, reason, t }) => [who, reason, t])).toEqual([
      ['a', 'river', 1], ['a', 'prop', 2], ['b', 'edge', 2.5], ['b', 'river', 4],
    ])
  })
})

describe('cue and cue-end events from the director', () => {
  function setup() {
    const bus = new EventTarget()
    const log = record(bus, 'cue', 'cue-end')
    const bridge = createCueEvents(bus)
    const { cues } = fixtureManifest()
    const director = createCueDirector(cues, (play) => bridge.emit(play), (play) => bridge.cut(play))
    director.setSeed(0)
    return { director, log }
  }

  test('both banks emit with who, t and the effective end; fold layers and the chorus stay off the bus', () => {
    const { director, log } = setup()
    director.fold({ t: 0.5, dir: 'up', id: 'mushroom_house', i: 0, j: 0 }, true, 0, 0)
    director.bump(4, 'prop')
    director.setLeader('b', 9)
    director.bump(12, 'river')
    const voices = log.filter(({ cue }) => cue.includes('voice'))
    expect(voices.map(({ type, who, cue }) => [type, who, cue])).toEqual([
      ['cue', 'a', 'voice_ooh'], ['cue', 'a', 'voice_hmph'], ['cue', 'b', 'b_voice_lead'], ['cue', 'b', 'b_voice_eep'],
    ])
    expect(voices[1]).toMatchObject({ t: 4, end: 4.8 })
    expect(log.some(({ cue }) => cue.startsWith('fold_') || cue.startsWith('chorus'))).toBe(false)
    expect(log.every(({ who }) => who === 'a' || who === 'b')).toBe(true)
  })

  test('a cut sends cue-end with the earlier end', () => {
    const { director, log } = setup()
    director.bump(2, 'prop')
    director.dance(2.3, 0.45)
    const cut = log.find(({ type }) => type === 'cue-end')
    expect(cut).toEqual({ type: 'cue-end', who: 'a', cue: 'voice_hmph', end: 2.3 })
    expect(log.find(({ cue, type }) => type === 'cue' && cue === 'voice_giggle')).toMatchObject({ who: 'a', t: 2.3 })
  })

  test('a swap cut ends the old bank voice 20 ms later', () => {
    const { director, log } = setup()
    director.bump(2, 'prop')
    director.setLeader('b', 2.1)
    const cut = log.find(({ type }) => type === 'cue-end')
    expect(cut).toMatchObject({ who: 'a', cue: 'voice_hmph' })
    expect(cut.end).toBeCloseTo(2.12)
  })
})

describe('B look before setting off', () => {
  const open = () => false
  const right = { x: 1, z: 0 }
  const step = 1 / 60

  function harness(lookDuration = 0.6, isBlocked = open, start = { x: 0, z: -1.1 }) {
    const leader = createPlayer()
    const follower = { position: { ...start }, heading: 0, state: 'idle' }
    const follow = createFollower(leader, follower.position)
    let time = 0
    let x = 0
    let z = 0
    follow.observe(leader.position, 0)
    const frame = (nextX = x, nextZ = z, { dancing = false, look = lookDuration } = {}) => {
      time += step
      leader.velocity.set((nextX - x) / step, 0, (nextZ - z) / step)
      if (leader.velocity.lengthSq()) leader.heading = Math.atan2(leader.velocity.x, leader.velocity.z)
      x = nextX
      z = nextZ
      leader.position.set(x, 0, z)
      follow.observe(leader.position, time)
      Object.assign(follower, follow.update(leader, follower, step, time, isBlocked, dancing, right, look))
    }
    const stand = (seconds) => { for (let i = 0; i < Math.round(seconds / step); i += 1) frame() }
    const walk = (seconds) => { for (let i = 0; i < Math.round(seconds / step); i += 1) frame(x, z + 1.2 * step) }
    const gap = () => Math.hypot(follower.position.x - x, follower.position.z - z)
    return { frame, stand, walk, gap, follow, follower, leader, get time() { return time }, get at() { return { x, z } } }
  }

  // Stand long enough, then walk until the look starts.
  function lookStarted(sim) {
    sim.stand(4)
    expect(sim.follow.looking).toBe(false)
    for (let i = 0; i < 30 && !sim.follow.looking; i += 1) sim.walk(step)
    expect(sim.follow.looking).toBe(true)
  }

  test('after 2 s of standing the follower holds for the clip length and is excluded while it does', () => {
    const sim = harness()
    sim.stand(4)
    const held = { ...sim.follower.position }
    let looked = 0
    for (let i = 0; i < 3 * 60; i += 1) {
      sim.walk(step)
      if (!sim.follow.looking) continue
      looked += 1
      expect(sim.follower.state).toBe('idle')
      expect(sim.follower.position).toEqual(held)
    }
    expect(looked * step).toBeGreaterThan(0.55)
    expect(looked * step).toBeLessThan(0.65)
    expect(sim.follow.catchingUp).toBe(false)
  })

  test('one unbroken look per set-off, from the start slot and its short trail (e2e R6-CHR-07)', () => {
    // B starts in its idle slot (round 6), so the trail is only 0.75 long. The leader's first walking frames still count
    // as standing (< 0.02 in 0.5 s): the slot shifts and the follower plans a micro step, then for about 0.3 s the trail
    // is too short to follow. A swap with both standing resets the trail the same way.
    const sim = harness(0.6, open, { x: -0.75, z: 0 })
    sim.stand(4)
    const runs = []
    let last = false
    for (let i = 0; i < 3 * 60; i += 1) {
      // The game's leader accelerates from rest: its first frames move less than a full-speed step.
      if (i < 6) sim.frame(sim.at.x, sim.at.z + 1.2 * step * (i + 1) / 7)
      else sim.walk(step)
      const looking = sim.follow.looking
      if (looking && !last) runs.push({ start: i, frames: 0, setOff: false })
      if (looking) runs.at(-1).frames += 1
      if (!looking && last) runs.at(-1).setOff = sim.follower.state === 'walk'
      last = looking
    }
    expect(runs).toHaveLength(1)
    expect(runs[0].frames * step).toBeGreaterThan(0.55)
    expect(runs[0].frames * step).toBeLessThan(0.65)
    expect(runs[0].setOff).toBe(true)
  })

  test('the catch-up after a look is excluded until the gap is back to 1.4 or less', () => {
    // Side slots blocked: the follower waits on the trail, 1.1 behind, and falls to about 1.8 during the look.
    const sim = harness(0.6, (x) => Math.abs(x) > 0.3)
    sim.stand(4)
    let looking = 0
    let catching = 0
    const walking = []
    for (let i = 0; i < 6 * 60; i += 1) {
      sim.walk(step)
      if (sim.follow.looking) looking += 1
      else if (sim.follow.catchingUp) {
        catching += 1
        expect(sim.follower.state).toBe('walk')
        expect(sim.gap()).toBeGreaterThan(1.4 - 0.03)
      } else if (looking) walking.push(sim.gap())
    }
    expect(looking).toBeGreaterThan(30)
    expect(catching).toBeGreaterThan(30)
    // Once the catch-up ends the follower is within the ordinary following band.
    expect(Math.max(...walking)).toBeLessThanOrEqual(1.4 + 0.03)
    expect(Math.min(...walking)).toBeGreaterThanOrEqual(0.9)
  })

  test('without the clip, or after under 2 s of standing, the follower sets off at once', () => {
    const noClip = harness(0)
    noClip.stand(4)
    for (let i = 0; i < 120; i += 1) {
      noClip.walk(step)
      expect(noClip.follow.looking).toBe(false)
    }

    const sim = harness()
    sim.stand(0.5)
    for (let i = 0; i < 90; i += 1) {
      sim.walk(step)
      expect(sim.follow.looking).toBe(false)
    }
    sim.stand(1.2)
    for (let i = 0; i < 60; i += 1) {
      sim.walk(step)
      expect(sim.follow.looking).toBe(false)
    }
  })

  test('separation interrupts it: the follower yields and walks', () => {
    const sim = harness()
    lookStarted(sim)
    const { x, z } = sim.at
    // Walk the leader at the follower, which stands on one side of it.
    const toward = Math.sign(sim.follower.position.x - x)
    let frames = 0
    while (sim.follow.looking && frames < 60) sim.frame(x + toward * 0.02 * (frames += 1), z)
    expect(sim.follow.looking).toBe(false)
    // Well before the clip would have run out (0.6 s = 36 frames).
    expect(frames).toBeLessThan(30)
    expect(sim.follow.catchingUp).toBe(false)
    expect(sim.follower.state).toBe('walk')
  })

  test('recovery interrupts it: the follower hops', () => {
    const sim = harness()
    lookStarted(sim)
    const { x, z } = sim.at
    let hopped = false
    let heldUntilHop = true
    for (let i = 0; i < 60 && !hopped; i += 1) {
      sim.frame(x, z + 4)
      hopped = sim.follower.state === 'hop'
      if (!hopped) heldUntilHop &&= sim.follow.looking
    }
    expect(hopped).toBe(true)
    expect(heldUntilHop).toBe(true)
    expect(sim.follow.looking).toBe(false)
    expect(sim.follow.catchingUp).toBe(false)
  })

  test('a dance start interrupts it', () => {
    const sim = harness()
    lookStarted(sim)
    sim.frame(sim.at.x, sim.at.z, { dancing: true })
    expect(sim.follow.looking).toBe(false)
    expect(sim.follower.state).toBe('dance')
  })

  test('a swap (trail reset) interrupts it and a fresh two seconds of standing are needed', () => {
    const sim = harness()
    lookStarted(sim)
    sim.follow.reset(sim.follower.position, sim.leader.position, { preserveRecovery: true })
    expect(sim.follow.looking).toBe(false)
    expect(sim.follow.catchingUp).toBe(false)
    for (let i = 0; i < 30; i += 1) {
      sim.walk(step)
      expect(sim.follow.looking).toBe(false)
    }
  })

  test('the debug readout mirrors the follower flags', () => {
    vi.stubGlobal('window', { __atlas: {} })
    const sim = harness()
    setupDuoDebug(sim.leader, { leader: 'a', swaps: 0, pendingSwap: false, request() {} }, sim.follow)
    expect(window.__atlas.duo.look).toEqual({ active: false, catchUp: false })
    lookStarted(sim)
    expect(window.__atlas.duo.look.active).toBe(true)
  })
})

describe('debug and frame order', () => {
  test('__atlas.face and __atlas.umbrella read the characters without touching other fields', () => {
    vi.stubGlobal('window', { __atlas: { player: 'kept', cueLog: [] } })
    const state = { cell: 0, lid: 0 }
    const umbrella = { open: false, t: null }
    const a = { get face() { return state }, umbrella: undefined }
    const b = { face: { cell: 3, lid: 0.35 }, umbrella }
    setupCharacterDebug({ a, b })
    expect(window.__atlas.player).toBe('kept')
    expect(window.__atlas.face.a).toEqual({ cell: 0, lid: 0 })
    state.cell = 5
    state.lid = 1
    expect(window.__atlas.face.a).toEqual({ cell: 5, lid: 1 })
    expect(window.__atlas.face.b).toEqual({ cell: 3, lid: 0.35 })
    expect(window.__atlas.umbrella).toEqual({ open: false, t: null })
    umbrella.open = true
    umbrella.t = 12.5
    expect(window.__atlas.umbrella).toEqual({ open: true, t: 12.5 })
  })

  test('the camera rig updates after both controllers and both character pose updates', () => {
    const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
    const order = [
      'swap.update(', 'controls.update(', 'dance({', 'setFollowerPose(follow.update(player, follower, dt, elapsed, isBlocked, dancing',
      'followLight(player.position)', 'leaderCharacter.update(', 'followerCharacter.update(', 'followPlayer(frameTime)',
      'for (const update of updates)', 'flushAudioFolds()', 'render(dt',
    ].map((marker) => source.indexOf(marker))
    expect(order.every((index) => index > 0)).toBe(true)
    expect(order).toEqual(order.toSorted((x, y) => x - y))
    expect(source.match(/followPlayer\(/g)).toHaveLength(1)
  })
})
