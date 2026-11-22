import { AnimationClip, Group, NumberKeyframeTrack, PerspectiveCamera, Vector3 } from 'three'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAnimation } from '../src/character/animation.js'
import { createDuoDance, createFollower, createTrail, distance, startFollower, walkTimeScale } from '../src/character/follow.js'
import { bindControls } from '../src/controls/index.js'
import { createMovement, createPlayer } from '../src/controls/movement.js'
import { createLeadSwap } from '../src/controls/swap.js'
import { createCameraRig } from '../src/scene/camera-rig.js'

const open = () => false
const point = (x, z) => ({ x, z })
const dt = 1 / 60

function route(initial = point(0, -1.1), cameraRight = point(1, 0)) {
  const leader = createPlayer()
  const follower = { position: initial, heading: 0, state: 'idle' }
  const follow = createFollower(leader, initial)
  let time = 0
  follow.observe(leader.position, time)
  function step(x, z, blocked = open, stepTime = dt) {
    time += stepTime
    leader.velocity.set((x - leader.position.x) / stepTime, 0, (z - leader.position.z) / stepTime)
    if (leader.velocity.lengthSq()) leader.heading = Math.atan2(leader.velocity.x, leader.velocity.z)
    leader.position.set(x, 0, z)
    follow.observe(leader.position, time)
    Object.assign(follower, follow.update(leader, follower, stepTime, time, blocked, false, cameraRight))
    return follower.position
  }
  return { leader, follower, follow, step, get time() { return time } }
}

afterEach(() => vi.unstubAllGlobals())

describe('trail and follow', () => {
  test('spawns behind the heading, or on the clear side when the back is blocked', () => {
    const leader = createPlayer()
    leader.heading = Math.PI / 2
    expect(startFollower(leader, open).x).toBeCloseTo(-1.1)
    const beside = startFollower(leader, (x, z) => x < -0.1 || z > 0.1)
    expect(beside.x).toBeCloseTo(0)
    expect(beside.z).toBeCloseTo(-1.1)
  })

  test('samples the reset segment and turns, with at most 8 units of path retained', () => {
    const trail = createTrail()
    trail.reset(point(0, -1.1), point(0, 0))
    expect(trail.end() - trail.start()).toBeCloseTo(1.1)
    trail.append(point(0, 4))
    trail.append(point(5, 4))
    expect(trail.end() - trail.start()).toBeCloseTo(8)
    expect(trail.samples[0].z).toBeCloseTo(1)
    const target = trail.pointAt(trail.end() - 1.1)
    expect(target.x).toBeCloseTo(3.9)
    expect(target.z).toBe(4)
    expect(trail.samples.some((sample) => sample.x === 0 && sample.z === 4)).toBe(true)
    for (let i = 1; i < trail.samples.length; i += 1) {
      expect(distance(trail.samples[i - 1], trail.samples[i])).toBeLessThanOrEqual(0.05 + 1e-9)
    }
    trail.reset(point(2, 3), point(1, 3))
    expect(trail.end()).toBe(1)
    expect(trail.samples[0]).toMatchObject(point(2, 3))
  })

  test('walks straight within the distance budget and catches up at 1.6 units/s', () => {
    const sim = route()
    const gaps = []
    for (let i = 1; i <= 150; i += 1) {
      const pos = sim.step(0, i * dt * 1.2)
      gaps.push(distance(pos, sim.leader.position))
      expect(sim.follower.velocity.z).toBeLessThanOrEqual(1.6 + 1e-9)
    }
    const median = gaps.toSorted((a, b) => a - b)[75]
    expect(median).toBeGreaterThanOrEqual(0.9)
    expect(median).toBeLessThanOrEqual(1.4)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2.2)

    const catchingUp = route()
    catchingUp.step(0, 1)
    expect(catchingUp.follower.velocity.z).toBeCloseTo(1.6)
  })

  test('eases into the last 0.3 units and never overshoots the trail point', () => {
    const sim = route()
    sim.step(0, 0.15)
    const speed = sim.follower.velocity.z
    expect(speed).toBeCloseTo(0.8)
    sim.step(0, 0.15)
    expect(sim.follower.velocity.z).toBeLessThan(speed)
    for (let i = 0; i < 120; i += 1) sim.step(0, 0.15, (x) => Math.abs(x) > 0.01)
    expect(sim.follower.position.z).toBeCloseTo(0.15 - 1.1)
    expect(sim.follower.velocity.z).toBeCloseTo(0)
  })

  test('holds while the trail is shorter than 1.1 and idle takeover is ineligible', () => {
    const sim = route(point(0, -0.65))
    const pos = sim.step(0, 0.3)
    expect(pos).toMatchObject(point(0, -0.65))
    expect(sim.follower.state).toBe('idle')
  })

  test('follows both legs of a corner without cutting through a blocked cell', () => {
    const sim = route()
    const blocked = (x, z) => x > 0.001 && z < 1.999
    for (let i = 1; i <= 100; i += 1) sim.step(0, i * 0.02, blocked)
    for (let i = 1; i <= 100; i += 1) {
      const pos = sim.step(i * 0.02, 2, blocked)
      expect(blocked(pos.x, pos.z)).toBe(false)
      if (pos.x > 0.001) expect(pos.z).toBeCloseTo(2)
    }
    expect(sim.follower.position.x).toBeGreaterThan(0.6)
  })

  test('stops rather than entering a blocked trail cell', () => {
    const sim = route()
    const blocked = (x, z) => z > -0.9 && z < -0.5
    for (let i = 1; i <= 90; i += 1) sim.step(0, 0.02 * i, blocked)
    expect(sim.follower.position.z).toBeLessThanOrEqual(-0.9)
    expect(sim.follower.state).toBe('idle')
  })

  test('scales the walk clip by speed / 1.2 with both clamps and silent follower contacts', () => {
    expect([walkTimeScale(0), walkTimeScale(1.2), walkTimeScale(2)])
      .toEqual([0.6, 1, 1.4])
    const model = new Group()
    const clips = ['idle', 'walk', 'dance'].map((name) => new AnimationClip(name, 1, [
      new NumberKeyframeTrack('.position[x]', [0, 1], name === 'walk' ? [0, 1] : [0, 0]),
    ]))
    const animation = createAnimation(model, clips)
    animation.update('walk', 0.1, 0.25, 0.25, undefined, true)
    expect(model.position.x).toBeCloseTo(0.6 * 0.25)
    const step = vi.fn()
    animation.update('walk', 1.2, 0.45, 0.7, step)
    expect(step).toHaveBeenCalledOnce()
  })
})

describe('separation, idle and recovery', () => {
  test('yields sideways before the leader passes, choosing the clear side', () => {
    const sim = route()
    for (let i = 1; i <= 110; i += 1) {
      const before = sim.follower.position
      const pos = sim.step(0, -1.2 * i * dt, (x) => x > 0.001)
      expect(pos.x).toBeLessThanOrEqual(0.001)
      expect(distance(pos, sim.leader.position)).toBeGreaterThanOrEqual(0.45 - 1e-8)
      expect(distance(pos, before)).toBeLessThanOrEqual(1.6 * dt + 1e-9)
    }
    expect(sim.follower.position.z).toBeGreaterThan(sim.leader.position.z)
  })

  test('holds when both sides are blocked and the leader can pass through', () => {
    const sim = route()
    const wall = (x) => Math.abs(x) > 0.001
    const min = []
    for (let i = 1; i <= 75; i += 1) {
      const pose = sim.step(0, -1.2 * i * dt, wall)
      expect(pose.x).toBeCloseTo(0)
      min.push(distance(pose, sim.leader.position))
    }
    expect(Math.min(...min)).toBeLessThan(0.02)
    expect(sim.leader.position.z).toBe(-1.5)
  })

  test('waits for a stationary half-second, then takes a clear side slot and aligns', () => {
    const sim = route(point(0.3, -1.1))
    for (let i = 1; i < 30; i += 1) {
      const x = sim.step(0, 0).x
      expect(x).toBeLessThanOrEqual(0.3)
    }
    const old = sim.follower.position
    expect(sim.step(0, 0).x).toBeGreaterThan(old.x)
    for (let i = 0; i < 120; i += 1) sim.step(0, 0)
    expect(sim.follower.position.x).toBeCloseTo(0.75)
    expect(sim.follower.position.z).toBeCloseTo(0)
    expect(sim.follower.heading).toBeCloseTo(sim.leader.heading)
    expect(sim.follower.state).toBe('idle')
  })

  test.each([
    ['east', 1, 0],
    ['west', -1, 0],
    ['north', 0, -1],
    ['south', 0, 1],
  ])('takes a screen-side idle slot after walking %s', (_, x, z) => {
    const sim = route(point(-1.1 * x, -1.1 * z))
    for (let i = 1; i <= 150; i += 1) sim.step(x * i * 0.02, z * i * 0.02)
    for (let i = 0; i < 120; i += 1) sim.step(3 * x, 3 * z)

    expect(Math.abs(sim.follower.position.x - sim.leader.position.x)).toBeCloseTo(0.75)
    expect(sim.follower.position.z).toBeCloseTo(sim.leader.position.z)
    expect(sim.follower.heading).toBeCloseTo(sim.leader.heading)
    expect(sim.follower.state).toBe('idle')
  })

  test('uses the supplied camera right on a rotated page view', () => {
    const cameraRight = point(Math.SQRT1_2, Math.SQRT1_2)
    const sim = route(point(0, -1.1), cameraRight)
    for (let i = 0; i < 120; i += 1) sim.step(0, 0)
    expect(sim.follower.position.x).toBeCloseTo(-0.75 * cameraRight.x)
    expect(sim.follower.position.z).toBeCloseTo(-0.75 * cameraRight.z)
  })

  test('tries the farther idle slot when the near path is blocked and retains trail if both are blocked', () => {
    const nearWall = (x, z) => x > 0.48 && x < 0.64 && z > -0.65 && z < -0.1
    const alternative = route(point(0.3, -1.1))
    for (let i = 0; i <= 120; i += 1) alternative.step(0, 0, nearWall)
    expect(alternative.follower.position.x).toBeCloseTo(-0.75)

    const neither = route()
    const walls = (x, z) => Math.abs(x) > 0.05 && z > -0.9
    for (let i = 1; i <= 60; i += 1) neither.step(0, 1.2 * i * dt, walls)
    for (let i = 0; i <= 120; i += 1) neither.step(0, 1.2, walls)
    expect(neither.follower.position.x).toBeCloseTo(0)
    expect(neither.follower.position.z).toBeCloseTo(0.1)
  })

  test('checks the entire hop, including landing, before takeoff', () => {
    for (const blockedZ of [-2.35, -1.1]) {
      const sim = route(point(0, -4))
      const checked = []
      const walls = (x, z) => {
        checked.push(z)
        return Math.abs(z - blockedZ) < 0.026 || (Math.abs(x) > 0.01 && z > -2.5)
      }
      for (let i = 0; i <= 32; i += 1) sim.step(0, 0, walls)
      expect(checked.some((z) => Math.abs(z - blockedZ) < 0.026)).toBe(true)
      expect(sim.follow.landing).toBe(-Infinity)
      expect(sim.follower.position.y).toBe(0)
      expect(sim.follower.state).toBe('walk')
    }
  })

  test('hops only after staying beyond 2.6 for half a second, reaches 0.25, and lands on time', () => {
    const sim = route(point(0, -5))
    const advance = (seconds, isBlocked = open) => sim.step(0, 0, isBlocked, seconds)
    advance(0.01)
    advance(0.49)
    expect(sim.follow.landing).toBe(-Infinity)
    const from = sim.follower.position
    advance(0.01)
    const duration = 0.35 + 0.1 * (distance(from, point(0, -1.1)) - 1.5)
    expect(sim.follower.state).toBe('hop')
    expect(sim.follow.landing - sim.time).toBeCloseTo(duration)
    const checkedBeforeTakeoff = vi.fn(() => true)
    expect(advance(duration / 2, checkedBeforeTakeoff).y).toBeCloseTo(0.25)
    expect(advance(duration / 2 + 1e-9, checkedBeforeTakeoff)).toMatchObject({ x: 0, y: 0 })
    expect(sim.follower.position.z).toBeCloseTo(-1.1)
    expect(sim.follow.landing).toBe(-Infinity)
    expect(checkedBeforeTakeoff).not.toHaveBeenCalled()
  })

  test('clears the recovery timer when the gap closes inside the threshold', () => {
    const sim = route(point(0, -3))
    for (let i = 0; i < 90; i += 1) sim.step(0, 0)
    expect(sim.follow.landing).toBe(-Infinity)
    expect(sim.follower.state).not.toBe('hop')
  })
})

describe('dance canon', () => {
  function danceFrames() {
    const dance = createDuoDance()
    let t = 0
    return (overrides = {}, step = dt) => {
      t += step
      return { t, ...dance({ dt: step, t, moving: false, input: false, ...overrides }) }
    }
  }

  test('starts four seconds after stopping and interrupts both dancers on fresh displacement', () => {
    const sim = route()
    const frame = danceFrames()
    const advance = (z, moving = false) => {
      sim.step(0, z)
      return frame({ moving, displacement: sim.follow.displacement })
    }
    for (let i = 1; i <= 60; i += 1) advance(i * 0.02, true)
    let state = advance(1.2)
    const stoppedAt = state.t
    expect(state.leader).toBe('idle')
    expect(sim.follow.displacement).toBeGreaterThan(0.02)

    let danceAt
    for (let i = 0; i < 270; i += 1) {
      state = advance(1.2)
      if (state.leader === 'dance') danceAt ??= state.t
    }
    expect(Math.abs(danceAt - stoppedAt - 4)).toBeLessThanOrEqual(dt + 1e-9)
    expect(state).toMatchObject({ leader: 'dance', followerDancing: true })
    expect(advance(1.23)).toMatchObject({ leader: 'idle', followerDancing: false })
  })

  test('displacement during the follower’s last beat preserves the leader’s idle timer', () => {
    const frame = danceFrames()
    frame({}, 4)
    frame({}, 2.875)
    expect(frame({ leaderFinished: true })).toMatchObject({ leader: 'idle', followerDancing: true })
    expect(frame({ displacement: 0.03 }, 0.1)).toMatchObject({ leader: 'idle', followerDancing: false })
    expect(frame({}, 3.9).leader).toBe('dance')
  })

  test('starts on the eighth-note delay and lets the follower finish its own clip', () => {
    const frame = danceFrames()
    let lead
    let follow
    for (let i = 0; i <= 270; i += 1) {
      const state = frame()
      if (state.leader === 'dance') lead ??= state.t
      if (state.followerDancing) follow ??= state.t
    }
    expect(lead).toBeCloseTo(4, 1)
    expect(Math.abs(follow - lead - 0.3125)).toBeLessThan(0.05)
    expect(frame({ leaderFinished: true })).toMatchObject({ leader: 'idle', followerDancing: true })
    expect(frame({ followerFinished: true }).followerDancing).toBe(false)
  })

  test.each([
    ['movement input', { input: true }],
    ['position displacement', { displacement: 0.0201 }],
    ['swap', { swapped: true }],
  ])('%s interrupts both the running canon and its pending entry', (_, interruption) => {
    for (const delay of [0.5, 0.2]) {
      const frame = danceFrames()
      frame({}, 4)
      expect(frame({}, delay).followerDancing).toBe(delay === 0.5)
      expect(frame(interruption)).toMatchObject({ leader: 'idle', followerDancing: false })
      expect(frame({}, 0.5)).toMatchObject({ leader: 'idle', followerDancing: false })
    }
  })

  test('reads displacement across the preceding quarter-second, including a between-frame boundary', () => {
    const sim = route()
    sim.step(0, 0.1, open, 0.2)
    sim.step(0, 0.1, open, 0.1)
    expect(sim.follow.displacement).toBeCloseTo(0.075)
    sim.step(0, 0.1, open, 0.16)
    expect(sim.follow.displacement).toBe(0)
  })
})

describe('lead swap', () => {
  test.each(['walk', 'blocked', 'dance'])('exchanges poses by value from %s and clears both blockers', (state) => {
    const player = createPlayer()
    const follower = createPlayer()
    player.position.set(0, 0, 3)
    player.velocity.set(0, 0, state === 'walk' ? 1.2 : 0)
    player.heading = 1
    player.state = state === 'blocked' ? 'idle' : state
    player.blockedBy = state === 'blocked' ? 'river' : null
    follower.position.set(1, 0, 2)
    follower.velocity.set(0.4, 0, 0)
    follower.heading = -1
    follower.state = 'walk'
    follower.blockedBy = 'prop'
    const position = player.position
    const velocity = player.velocity
    const lead = { ...player, position: player.position.clone(), velocity: player.velocity.clone(), blockedBy: null }
    const other = { ...follower, position: follower.position.clone(), velocity: follower.velocity.clone(), blockedBy: null }
    const apply = vi.fn()
    const swaps = createLeadSwap(player, follower, apply)

    swaps.request()
    expect(swaps.update(0, -Infinity)).toBe(true)
    expect(player.position).toBe(position)
    expect(player.velocity).toBe(velocity)
    expect(player).toEqual(other)
    expect(follower).toEqual(lead)
    expect(apply).toHaveBeenCalledWith('b')
    expect(swaps).toMatchObject({ leader: 'b', swaps: 1, pendingSwap: false })
  })

  test('takes the later of cooldown and hop landing, and a second request cancels', () => {
    const swaps = createLeadSwap(createPlayer(), createPlayer(), vi.fn())
    swaps.request()
    expect(swaps.update(0, -Infinity)).toBe(true)
    swaps.request()
    expect(swaps.update(0.49, 0.25)).toBe(false)
    expect(swaps.update(0.50, 0.75)).toBe(false)
    expect(swaps.pendingSwap).toBe(true)
    swaps.request()
    expect(swaps.update(0.75, 0.75)).toBe(false)
    expect(swaps.pendingSwap).toBe(false)
    swaps.request()
    expect(swaps.update(0.75, 0.75)).toBe(true)
    expect(swaps.leader).toBe('a')
    swaps.request()
    expect(swaps.update(1.24, -Infinity)).toBe(false)
    expect(swaps.update(1.25, -Infinity)).toBe(true)
  })

  test('leaves the follower airborne until landing, then resets the trail to the exchanged ground poses', () => {
    const sim = route(point(0, -5))
    while (sim.follow.landing === -Infinity) sim.step(0, 0)
    const follower = createPlayer()
    const swap = createLeadSwap(sim.leader, follower, () => sim.follow.reset(follower.position, sim.leader.position))
    swap.request()
    const mid = (sim.follow.landing - sim.time) / 2
    const airborne = sim.step(0, 0, open, mid)
    follower.position.copy(airborne)
    expect(airborne.y).toBeCloseTo(0.25)
    expect(swap.update(sim.time, sim.follow.landing)).toBe(false)
    follower.position.copy(sim.step(0, 0, open, mid + 1e-9))
    expect(swap.update(sim.time, sim.follow.landing)).toBe(true)
    expect(sim.leader.position.y).toBe(0)
    expect(sim.leader.position.z).toBeCloseTo(-1.1)
    expect(follower.position.z).toBe(0)
  })

  test('keeps held movement directed at the new leader and cancels click-walk on apply', () => {
    const events = new EventTarget()
    vi.stubGlobal('window', events)
    const canvas = new EventTarget()
    canvas.getBoundingClientRect = () => ({ width: 1280, height: 720, left: 0, top: 0 })
    const player = createPlayer()
    const follower = createPlayer()
    follower.position.z = -1.1
    const camera = new PerspectiveCamera(30, 1280 / 720)
    camera.position.set(0, 8, 8)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const swaps = createLeadSwap(player, follower, () => controls.cancelWalk())
    const controls = bindControls(canvas, camera, player, {
      requestSwap: swaps.request, hitsFollower: (x) => x > 1000,
    })
    const key = (type, code, repeat = false) => events.dispatchEvent(Object.assign(new Event(type), { code, repeat }))
    const click = (x, y) => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), {
      isPrimary: true, button: 0, clientX: x, clientY: y,
    }))
    key('keydown', 'KeyD')
    expect(controls.update(dt, open)).toBe(true)
    key('keydown', 'Space')
    key('keydown', 'Space', true)
    expect(swaps.update(0, -Infinity)).toBe(true)
    expect(controls.update(dt, open)).toBe(true)
    expect(player.position.x).toBeCloseTo(1.2 * dt)
    expect(player.position.z).toBeCloseTo(-1.1)
    key('keyup', 'KeyD')

    click(1100, 360)
    expect(swaps.pendingSwap).toBe(true)
    expect(controls.update(dt, open)).toBe(false)
    expect(player.state).toBe('idle')

    click(800, 360)
    expect(controls.update(dt, open)).toBe(true)
    expect(player.state).toBe('walk')
    expect(swaps.update(0.5, -Infinity)).toBe(true)
    expect(controls.update(dt, open)).toBe(false)
    expect(player.state).toBe('idle')
  })

  test('the leader can walk through a stationary follower and the camera settles after a swap', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const player = createPlayer()
    const follower = createPlayer()
    follower.position.x = 0.48
    const camera = new PerspectiveCamera(30, 1280 / 720)
    const rig = createCameraRig(camera, player.position)
    rig(0)
    const movement = createMovement(player, camera)
    for (let i = 0; i < 24; i += 1) movement.update(dt, 1, 0, open)
    expect(player.position.x).toBeCloseTo(follower.position.x)
    follower.position.x += 2.2
    const swaps = createLeadSwap(player, follower, vi.fn())
    swaps.request()
    swaps.update(0, -Infinity)
    for (let i = 1; i <= 60; i += 1) rig(dt)
    const target = camera.position.clone().addScaledVector(camera.getWorldDirection(new Vector3()), 10)
    expect(target.distanceTo(player.position)).toBeLessThan(0.2)
  })
})
