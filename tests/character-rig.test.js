import { Vector3 } from 'three'
import { afterEach, describe, expect, test } from 'vitest'
import { createAnimation, skipsOnStart } from '../src/character/animation.js'
import { createRig, HAIR_KICK } from '../src/character/rig.js'
import { HAIR_DROOP, HAIR_STAND, HERO_HOLD } from '../src/character/hair-emotion.js'
import { createSquash } from '../src/character/squash.js'
import { buildModel, clipSet, drive, dt, record } from './fixtures/rig.js'

const rigs = []
function setup(who, { seed = 0, bus = new EventTarget(), ...model } = {}) {
  const root = buildModel(who, model)
  const rig = createRig(root, clipSet(who), { who, bus, seed: () => seed })
  rigs.push(rig)
  return { rig, root, bus, sim: drive(rig) }
}
afterEach(() => rigs.splice(0).forEach((rig) => rig.dispose()))

const cue = (bus, detail) => bus.dispatchEvent(new CustomEvent('cue', { detail }))
const near = (a, b, tolerance = 2 * dt) => Math.abs(a - b) <= tolerance
// Sum of the hair chain's rotation about local X: the offset that hair emotion adds, in radians.
const chainLift = (root) => ['hair_0', 'hair_1', 'hair_2', 'hair_3']
  .reduce((sum, name) => sum + 2 * Math.atan2(root.getObjectByName(name).quaternion.x,
    root.getObjectByName(name).quaternion.w), 0)

describe('contacts and footsteps', () => {
  test.each([
    ['a', 1.2, [0, 0.5, 1, 1.5]],
    ['b', 1.2, [0, 0.4, 0.8, 1.2]],
    ['a', 2.4, [0, 0.25, 0.5, 0.75]],
    ['b', 0.6, [0, 0.4 / 0.6, 0.8 / 0.6, 1.2 / 0.6]],
  ])('rig %s at %f units/s has contacts at clip time 0 and half the clip, scaled by the time scale',
    (who, speed, expected) => {
      const { bus, sim } = setup(who)
      const contacts = record(bus, 'contact')
      const steps = []
      // The leader plays footsteps; B walking as the follower does not, but still has contacts.
      const options = who === 'a' ? { leader: true, footstep: (t) => steps.push(t) } : { leader: false }
      sim.frame('walk', { speed, ...options })
      const start = contacts[0].t
      sim.run(expected.at(-1) + 0.1, 'walk', { speed, ...options })
      expect(contacts.slice(0, 4).map(({ who: id }) => id)).toEqual([who, who, who, who])
      expect(contacts.slice(0, 4).map(({ foot }) => foot)).toEqual(['l', 'r', 'l', 'r'])
      contacts.slice(0, 4).forEach(({ t }, index) => expect(near(t - start, expected[index], 3 * dt)).toBe(true))
      if (who === 'a') expect(steps.slice(0, 4)).toEqual(contacts.slice(0, 4).map(({ t }) => t))
      else expect(steps).toHaveLength(0)
    })

  test('no contacts while standing, and none after the walk ends', () => {
    const { bus, sim } = setup('a')
    const contacts = record(bus, 'contact')
    sim.run(2, 'idle')
    expect(contacts).toHaveLength(0)
    sim.run(1.2, 'walk', { speed: 1.2 })
    const count = contacts.length
    sim.run(1.2, 'idle')
    expect(contacts).toHaveLength(count)
  })
})

describe('skip', () => {
  const seedWhere = (predicate) => Array.from({ length: 500 }, (_, seed) => seed).find(predicate)
  const skipSeed = seedWhere((seed) => skipsOnStart(seed, 0))
  const walkSeed = seedWhere((seed) => !skipsOnStart(seed, 0))

  test('replaces walk for two cycles after one second of standing, leader only, and the state stays walk', () => {
    const { rig, bus, sim } = setup('a', { seed: skipSeed })
    const contacts = record(bus, 'contact')
    sim.run(1, 'idle')
    sim.frame('walk', { speed: 1.2 })
    expect(rig.animation.locomotion).toBe('skip')
    expect(rig.animation.target).toBe('skip')
    sim.run(1.9, 'walk', { speed: 1.2 })
    expect(rig.animation.locomotion).toBe('skip')
    sim.run(0.3, 'walk', { speed: 1.2 })
    expect(rig.animation.locomotion).toBe('walk')
    expect(rig.animation.target).toBe('walk')
    // Contacts stay on a 0.5 s beat through the switch.
    const gaps = contacts.slice(1, 6).map(({ t }, index) => t - contacts[index].t)
    gaps.forEach((gap) => expect(near(gap, 0.5, 3 * dt)).toBe(true))
  })

  test.each([
    ['after less than one second of standing', { seed: skipSeed, stand: 0.9 }],
    ['when the hash does not pick it', { seed: walkSeed, stand: 2 }],
    ['for the follower', { seed: skipSeed, stand: 2, leader: false }],
  ])('does not skip %s', (_, { seed, stand, leader = true }) => {
    const { rig, sim } = setup('a', { seed })
    sim.run(stand, 'idle', { leader })
    sim.frame('walk', { speed: 1.2, leader })
    expect(rig.animation.locomotion).toBe('walk')
  })

  test('picks about one walk start in four, by hash', () => {
    const picked = Array.from({ length: 400 }, (_, start) => skipsOnStart(7, start)).filter(Boolean).length
    expect(picked / 400).toBeGreaterThan(0.18)
    expect(picked / 400).toBeLessThan(0.32)
    // The counter advances on every walk start, skipped or not.
    const { rig, sim } = setup('a', { seed: 7 })
    const seen = []
    for (let start = 0; start < 12; start += 1) {
      sim.run(1.1, 'idle')
      sim.frame('walk', { speed: 1.2 })
      seen.push(rig.animation.locomotion === 'skip')
      sim.run(0.3, 'walk', { speed: 1.2 })
    }
    expect(seen).toEqual(Array.from({ length: 12 }, (_, start) => skipsOnStart(7, start)))
  })

  test('a rig without the skip clip walks', () => {
    const { rig, sim } = setup('b', { seed: skipSeed })
    sim.run(2, 'idle')
    sim.frame('walk', { speed: 1.2 })
    expect(rig.animation.locomotion).toBe('walk')
  })
})

describe('look clip in the mixer', () => {
  test('plays for the follower while looking and stops when the flag drops, as leader never', () => {
    const { rig, sim } = setup('b')
    expect(rig.lookDuration).toBeCloseTo(0.6)
    sim.run(2, 'idle', { leader: false })
    sim.run(0.3, 'idle', { leader: false, looking: true })
    expect(rig.animation.target).toBe('look')
    sim.frame('idle', { leader: false, looking: false })
    expect(rig.animation.target).toBe('idle')

    sim.run(0.3, 'idle', { leader: true, looking: true })
    expect(rig.animation.target).toBe('idle')
  })

  test.each([
    ['walking off', 'walk'],
    ['a dance start', 'dance'],
  ])('%s interrupts it', (_, state) => {
    const { rig, sim } = setup('b')
    sim.run(0.3, 'idle', { leader: false, looking: true })
    sim.frame(state, { leader: false, speed: 1.2 })
    expect(rig.animation.target).toBe(state)
  })

  test('a rig without the clip has no look duration and never plays it', () => {
    const { rig, sim } = setup('a')
    expect(rig.lookDuration).toBe(0)
    sim.run(0.3, 'idle', { leader: false, looking: true })
    expect(rig.animation.target).toBe('idle')
  })
})

describe('squash and stretch', () => {
  test('the larger deformation wins within a frame and the spring returns to 1', () => {
    const root = buildModel('a').getObjectByName('root')
    const squash = createSquash(root)
    squash.trigger(0.95)
    squash.trigger(0.88)
    squash.update(0)
    expect(squash.value).toBeCloseTo(0.88)
    expect(root.scale.y).toBeCloseTo(0.88)
    expect(root.scale.x).toBeCloseTo(1 / Math.sqrt(0.88))
    expect(root.scale.z).toBeCloseTo(root.scale.x)
    expect(root.scale.x * root.scale.y * root.scale.z).toBeCloseTo(1)

    squash.trigger(0.95)
    squash.trigger(1.10)
    squash.trigger(0.95)
    squash.update(0)
    expect(squash.value).toBeCloseTo(1.10)
    // ω 18, ζ 0.5: back to rest within a second.
    for (let i = 0; i < 120; i += 1) squash.update(dt)
    expect(Math.abs(squash.value - 1)).toBeLessThan(0.002)
  })

  test('every foot contact, walk or skip, squashes to 0.95 and the dance landing marker to 0.88', () => {
    const { rig, sim } = setup('a')
    sim.run(0.5, 'idle')
    expect(rig.squash.value).toBe(1)
    let low = 1
    for (let i = 0; i < 1.2 / dt; i += 1) {
      sim.frame('walk', { speed: 1.2 })
      low = Math.min(low, rig.squash.value)
    }
    sim.run(2, 'idle')
    expect(low).toBeLessThan(0.97)
    expect(low).toBeGreaterThan(0.93)

    // The dance landing at 1.67 s of clip time.
    sim.frame('dance')
    const danceStart = sim.t
    let landing = 1
    while (sim.t < danceStart + 1.6) sim.frame('dance')
    expect(rig.squash.value).toBeGreaterThan(0.99)
    while (sim.t < danceStart + 1.75) {
      sim.frame('dance')
      landing = Math.min(landing, rig.squash.value)
    }
    expect(landing).toBeLessThan(0.9)
    expect(landing).toBeGreaterThan(0.86)
  })

  test('the follower hop stretches to 1.10 at take-off and squashes to 0.88 on landing', () => {
    const { rig, bus, sim } = setup('b')
    const hops = record(bus, 'hop')
    sim.run(0.5, 'idle', { leader: false })
    sim.frame('hop', { leader: false })
    expect(rig.squash.value).toBeGreaterThan(1.08)
    expect(rig.squash.value).toBeLessThan(1.11)
    sim.run(0.4, 'hop', { leader: false })
    sim.frame('idle', { leader: false })
    expect(rig.squash.value).toBeLessThan(0.9)
    expect(rig.squash.value).toBeGreaterThan(0.86)
    expect(hops.map(({ phase }) => phase)).toEqual(['takeoff', 'land'])
  })
})

describe('hair emotion and kick', () => {
  const settle = (sim, state = 'idle', seconds = 1.5) => sim.run(seconds, state)

  test.each([
    ['voice_ooh', HAIR_STAND], ['voice_whee', HAIR_STAND], ['b_voice_whee', HAIR_STAND],
    ['voice_hmph', HAIR_DROOP], ['voice_hm', HAIR_DROOP], ['b_voice_hmph', HAIR_DROOP],
    ['voice_hup', 0], ['sing_ta', 0],
  ])('%s moves the leader hair chain by %f rad over the cue and back after it', (name, offset) => {
    const { root, bus, sim } = setup('a')
    settle(sim)
    expect(chainLift(root)).toBeCloseTo(0, 6)
    cue(bus, { who: 'a', cue: name, t: sim.t, end: sim.t + 1.2 })
    sim.run(1.1, 'idle')
    expect(chainLift(root)).toBeCloseTo(offset, 2)
    sim.run(1.5, 'idle')
    expect(chainLift(root)).toBeCloseTo(0, 2)
  })

  test('a cut ends the offset early, and a cue of the other character or the follower does nothing', () => {
    const { root, bus, sim } = setup('a')
    cue(bus, { who: 'a', cue: 'voice_hmph', t: 0, end: 2 })
    bus.dispatchEvent(new CustomEvent('cue-end', { detail: { who: 'a', cue: 'voice_hmph', end: 0.1 } }))
    sim.run(1.5, 'idle')
    expect(chainLift(root)).toBeCloseTo(0, 2)

    cue(bus, { who: 'b', cue: 'b_voice_ooh', t: sim.t, end: sim.t + 1 })
    sim.run(0.8, 'idle')
    expect(chainLift(root)).toBeCloseTo(0, 6)
    cue(bus, { who: 'a', cue: 'voice_ooh', t: sim.t, end: sim.t + 1 })
    sim.run(0.8, 'idle', { leader: false })
    expect(chainLift(root)).toBeCloseTo(0, 6)
  })

  test('a hero fold-up within 2.5 units of the leader makes the hair stand with no audio cue', () => {
    const { rig, root, sim } = setup('a')
    const fold = (overrides, leader = true, position = new Vector3(0, 0, 0)) => rig.fold({
      dir: 'up', id: 'mushroom_house', i: 0, j: 0, t: sim.t, ...overrides,
    }, position, leader)

    fold({ id: 'flower' })
    fold({ dir: 'down' })
    fold({}, false)
    fold({ i: 2, j: 2 })
    sim.run(1, 'idle')
    expect(chainLift(root)).toBeCloseTo(0, 6)

    fold({ id: 'yarn_bridge', i: 0, j: 0 }, true, new Vector3(0, 0, 2.4 - 0))
    sim.run(1, 'idle')
    expect(chainLift(root)).toBeCloseTo(HAIR_STAND, 2)
    sim.run(HERO_HOLD + 1.5, 'idle')
    expect(chainLift(root)).toBeCloseTo(0, 2)
  })

  test("B's own foot contacts kick its hair spring by at least 0.02 units at the tip", () => {
    // The same rig and clips under both ids: only B's contacts kick the hair.
    const pair = (who) => {
      const rig = createRig(buildModel('b'), clipSet('b'), { who, bus: new EventTarget() })
      rigs.push(rig)
      return { rig, sim: drive(rig) }
    }
    const a = pair('a')
    const b = pair('b')
    const tip = (rig) => rig.hair[3].position.clone()
    let bounce = 0
    for (let i = 0; i < 120; i += 1) {
      a.sim.frame('walk', { speed: 1.2, leader: false })
      b.sim.frame('walk', { speed: 1.2, leader: false })
      bounce = Math.max(bounce, tip(a.rig).distanceTo(tip(b.rig)))
    }
    expect(HAIR_KICK).toBeGreaterThan(0)
    expect(bounce).toBeGreaterThanOrEqual(0.02)
  })
})

describe('umbrella', () => {
  const river = (bus, t, who = 'b') => bus.dispatchEvent(new CustomEvent('bump', { detail: { who, reason: 'river', t } }))

  test('pops open on a B-leading river collision alone, closes after 1.2 s, and stays at one per 3 s', () => {
    const { rig, root, bus, sim } = setup('b')
    const closed = root.getObjectByName('umbrella_closed')
    const open = root.getObjectByName('umbrella_open')
    sim.run(0.5, 'idle')
    expect(rig.umbrella).toMatchObject({ open: false, t: null })
    expect(open.scale.x).toBe(0)
    expect(closed.visible).toBe(true)

    river(bus, sim.t)
    const popped = sim.t
    sim.run(0.5, 'idle')
    expect(rig.umbrella).toMatchObject({ open: true, t: popped })
    expect(open.scale.x).toBeGreaterThan(0.9)
    expect(closed.visible).toBe(false)

    sim.run(0.8, 'idle')
    expect(rig.umbrella.open).toBe(false)
    sim.run(0.8, 'idle')
    expect(open.scale.x).toBeLessThan(0.05)
    expect(closed.visible).toBe(true)

    // 1.5 s after the first collision: inside the 3 s gap.
    river(bus, sim.t)
    sim.run(0.2, 'idle')
    expect(rig.umbrella.open).toBe(false)
    sim.run(1.4, 'idle')
    river(bus, sim.t)
    sim.run(0.2, 'idle')
    expect(rig.umbrella.open).toBe(true)
  })

  test('ignores prop and edge bumps and A\'s collisions', () => {
    const { rig, bus, sim } = setup('b')
    for (const reason of ['prop', 'edge']) {
      bus.dispatchEvent(new CustomEvent('bump', { detail: { who: 'b', reason, t: sim.t } }))
    }
    river(bus, sim.t, 'a')
    sim.run(0.5, 'idle')
    expect(rig.umbrella.open).toBe(false)
  })

  test('opens at the dance bow (2.19 s) and closes at the dance end', () => {
    const { rig, bus, sim } = setup('b')
    const ends = record(bus, 'dance-end')
    sim.frame('dance')
    const start = sim.t
    while (sim.t < start + 2.1) sim.frame('dance')
    expect(rig.umbrella.open).toBe(false)
    while (sim.t < start + 2.3) sim.frame('dance')
    expect(rig.umbrella.open).toBe(true)
    expect(near(rig.umbrella.t, start + 2.19, 3 * dt)).toBe(true)
    sim.frame('idle')
    expect(ends).toHaveLength(1)
    expect(rig.umbrella.open).toBe(false)
  })
})

describe('face without face nodes', () => {
  test('a rig without lids, mouth or umbrella runs and reports its rest face', () => {
    const { rig, bus, sim } = setup('b', { face: false, umbrella: false })
    cue(bus, { who: 'b', cue: 'b_voice_ooh', t: 0, end: 1 })
    bus.dispatchEvent(new CustomEvent('bump', { detail: { who: 'b', reason: 'river', t: 0 } }))
    expect(() => {
      sim.run(3, 'idle')
      sim.run(1, 'walk', { speed: 1.2 })
      sim.run(3.5, 'dance')
    }).not.toThrow()
    expect(rig.face.cell).toBeDefined()
    expect(rig.face.lid).toBeGreaterThanOrEqual(0.35 - 1e-9)
  })

  test('createAnimation still rejects a rig without its required clips', () => {
    expect(() => createAnimation(buildModel('a'), clipSet('a').filter(({ name }) => name !== 'walk')))
      .toThrow('missing the walk clip')
  })
})
