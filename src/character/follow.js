import { createCharacterState } from './state.js'

const sampleSpacing = 0.05
const trailLimit = 8
const followDistance = 1.1
const maxSpeed = 1.6
const separation = 0.45
const canonDelay = 0.3125
const epsilon = 1e-8
// B's look before setting off: after this long standing, the follower holds still for the clip's length.
const lookStanding = 2
const catchUpGap = 1.4

export const walkTimeScale = (speed) => Math.min(1.4, Math.max(0.6, speed / 1.2))
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const between = (a, b, fraction) => ({
  x: a.x + (b.x - a.x) * fraction,
  z: a.z + (b.z - a.z) * fraction,
})
const offset = (point, x, z) => ({ x: point.x + x, z: point.z + z })

function clearPath(from, to, isBlocked) {
  const count = Math.max(1, Math.ceil(distance(from, to) / sampleSpacing))
  for (let i = 1; i <= count; i += 1) {
    const { x, z } = between(from, to, i / count)
    if (isBlocked(x, z)) return false
  }
  return true
}

export function startFollower(leader, isBlocked) {
  const x = Math.sin(leader.heading) * followDistance
  const z = Math.cos(leader.heading) * followDistance
  const from = leader.position
  const behind = offset(from, -x, -z)
  if (clearPath(from, behind, isBlocked)) return behind
  for (let width = followDistance; width >= separation - epsilon; width -= sampleSpacing) {
    for (const side of [-1, 1]) {
      const beside = offset(from, side * z * width / followDistance, -side * x * width / followDistance)
      if (clearPath(from, beside, isBlocked)) return beside
    }
  }
  return from
}

export function createTrail() {
  const samples = []
  const start = () => samples[0].s
  const end = () => samples.at(-1).s

  function indexAt(s) {
    let lo = 1
    let hi = samples.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (samples[mid].s < s) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  function pointAt(s) {
    if (s <= start()) return samples[0]
    if (s >= end()) return samples.at(-1)
    const i = indexAt(s)
    const a = samples[i - 1]
    const b = samples[i]
    return between(a, b, (s - a.s) / (b.s - a.s))
  }

  function append(to) {
    const from = samples.at(-1)
    const length = distance(from, to)
    if (length < epsilon) return
    const count = Math.ceil(length / sampleSpacing)
    for (let i = 1; i <= count; i += 1) {
      const fraction = i / count
      samples.push({ ...between(from, to, fraction), s: from.s + fraction * length })
    }
    const oldest = end() - trailLimit
    if (oldest <= start()) return
    const point = pointAt(oldest)
    samples.splice(0, indexAt(oldest), { ...point, s: oldest })
    if (samples[1].s === oldest) samples.shift()
  }

  function nearest(point, limit) {
    let best = limit
    let gap = Infinity
    for (let i = indexAt(limit); i > 0; i -= 1) {
      const a = samples[i - 1]
      const s = Math.min(limit, samples[i].s)
      const b = pointAt(s)
      const length = s - a.s
      if (length <= epsilon) continue
      const dx = b.x - a.x
      const dz = b.z - a.z
      const fraction = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length ** 2))
      const candidate = distance(point, between(a, b, fraction))
      if (candidate < gap) {
        gap = candidate
        best = a.s + fraction * length
      }
    }
    return best
  }

  return {
    samples, start, end, pointAt, append, nearest,
    next(s) { return samples[indexAt(s + epsilon)].s },
    reset(from, to) {
      samples.splice(0, samples.length, { x: from.x, z: from.z, s: 0 })
      append(to)
    },
  }
}

function createLeaderHistory() {
  const samples = []
  return {
    reset() { samples.length = 0 },
    record(point, t) {
      samples.push({ x: point.x, z: point.z, t })
      while (samples.length > 2 && samples[1].t <= t - 0.5) samples.shift()
    },
    displacement(window) {
      const last = samples.at(-1)
      if (!last) return null
      const t = last.t - window
      if (samples[0].t > t + epsilon) return null
      const i = samples.findIndex((sample) => sample.t > t)
      const a = samples[i - 1] ?? samples[0]
      const b = samples[i]
      return distance(last, between(a, b, Math.max(0, (t - a.t) / (b.t - a.t))))
    },
  }
}

export function createDuoDance() {
  const leaderState = createCharacterState()
  let leaderWasDancing = false
  let followerAt = Infinity

  return ({ dt, t, moving, input, displacement, leaderFinished, followerFinished, swapped }) => {
    const displaced = displacement > 0.02
    const interrupted = swapped || input || (leaderWasDancing && displaced)
    const leader = leaderState(dt, moving, interrupted, leaderFinished)
    const starting = leader === 'dance' && !leaderWasDancing
    if (interrupted || moving || (t >= followerAt && displaced)) followerAt = Infinity
    else if (starting) followerAt = t + canonDelay
    else if (followerFinished && t >= followerAt) followerAt = Infinity
    leaderWasDancing = leader === 'dance'
    return { leader, followerDancing: t >= followerAt }
  }
}

function idleSlot(position, from, isBlocked, cameraRight) {
  const x = 0.75 * cameraRight.x
  const z = 0.75 * cameraRight.z
  return [offset(position, -x, -z), offset(position, x, z)]
    .sort((a, b) => distance(from, a) - distance(from, b))
    .find((point) => leavesClearance(from, point, position) && clearPath(from, point, isBlocked))
}

function closestFraction(point, from, dx, dz) {
  const lengthSquared = dx * dx + dz * dz
  if (!lengthSquared) return 0
  return Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared))
}

function yieldSide(leader, from, dt, isBlocked) {
  const { position, velocity, heading } = leader
  // Begin the sidestep before the leader reaches the clearance circle.
  const dx = velocity.x * 0.35
  const dz = velocity.z * 0.35
  const closest = (point) => {
    const fraction = closestFraction(point, position, dx, dz)
    return Math.hypot(point.x - position.x - dx * fraction, point.z - position.z - dz * fraction)
  }
  const gap = closest(from)
  if (gap >= separation) return null

  const x = Math.cos(heading)
  const z = -Math.sin(heading)
  const toward = (from.x - position.x) * x + (from.z - position.z) * z
  const first = toward < 0 ? -1 : 1
  for (const side of [first, -first]) {
    const point = offset(from, side * x * maxSpeed * dt, side * z * maxSpeed * dt)
    if (closest(point) > gap && clearPath(from, point, isBlocked)) return point
  }
  return from
}

function leavesClearance(from, to, leader) {
  const closest = closestFraction(leader, from, to.x - from.x, to.z - from.z)
  return distance(leader, between(from, to, closest)) >= separation - epsilon
}

export function createFollower(leader, initial) {
  const trail = createTrail()
  const history = createLeaderHistory()
  let cursor
  let farSince
  let hop
  // Round 6 look: `looking` holds the follower still, `catchUp` marks the walk back to the trail after it.
  let looking = false
  let lookEnd = 0
  let catchUp = false
  let standing = 0
  let reachedGate = false

  function reset(from, to, { preserveRecovery = false } = {}) {
    trail.reset(from, to)
    history.reset()
    cursor = trail.start()
    if (!preserveRecovery) farSince = undefined
    hop = undefined
    looking = false
    catchUp = false
    standing = 0
  }
  reset(initial, leader.position)

  function observe(position, t) {
    trail.append(position)
    history.record(position, t)
  }

  function plan(leader, follower, dt, t, isBlocked, dancing, cameraRight, lookDuration) {
    const from = follower.position
    const gap = distance(from, leader.position)
    const target = trail.end() - followDistance
    if (gap <= 2.6) farSince = undefined
    else farSince ??= t

    function pose(point, heading, state) {
      const walking = state === 'walk' && dt > 0
      return {
        position: { x: point.x, y: point.y ?? 0, z: point.z },
        heading, state,
        velocity: {
          x: walking ? (point.x - from.x) / dt : 0,
          y: 0,
          z: walking ? (point.z - from.z) / dt : 0,
        },
      }
    }

    function landOrHop() {
      const progress = Math.max(0, Math.min(1, (t - hop.start) / (hop.end - hop.start)))
      const point = between(hop.from, hop.to, progress)
      point.y = progress * (1 - progress)
      if (t >= hop.end) {
        cursor = hop.target
        hop = undefined
        farSince = undefined
      }
      return pose(point, follower.heading, hop ? 'hop' : 'idle')
    }
    if (hop) return landOrHop()

    const yielding = yieldSide(leader, from, dt, isBlocked)
    if (yielding) {
      if (yielding === from) return pose(from, follower.heading, 'idle')
      cursor = undefined
      return pose(yielding, Math.atan2(yielding.x - from.x, yielding.z - from.z), 'walk')
    }
    if (dancing) return pose(from, follower.heading, 'dance')

    if (target >= trail.start() && farSince !== undefined && t - farSince >= 0.5 - epsilon) {
      const to = trail.pointAt(target)
      if (leavesClearance(from, to, leader.position) && clearPath(from, to, isBlocked)) {
        const duration = 0.35 + 0.1 * Math.max(0, distance(from, to) - 1.5)
        hop = { from: { x: from.x, z: from.z }, to, target, start: t, end: t + duration }
        return landOrHop()
      }
    }

    // Setting off (idle slot or trail) goes through the look gate.
    const setOff = (planned) => {
      reachedGate = true
      if (!lookDuration) return planned
      if (looking) {
        if (planned.state !== 'walk') {
          looking = false
          return planned
        }
        if (t < lookEnd - epsilon) return pose(from, follower.heading, 'idle')
        looking = false
        catchUp = true
        return planned
      }
      if (planned.state === 'walk' && standing >= lookStanding - epsilon) {
        looking = true
        lookEnd = t + lookDuration
        return pose(from, follower.heading, 'idle')
      }
      return planned
    }

    const idleDisplacement = history.displacement(0.5)
    if (idleDisplacement !== null && idleDisplacement < 0.02) {
      const slot = idleSlot(leader.position, from, isBlocked, cameraRight)
      if (slot) {
        const left = distance(from, slot)
        const step = Math.min(left, maxSpeed * dt)
        const point = left > epsilon ? between(from, slot, step / left) : from
        if (step > epsilon) cursor = undefined
        const heading = left - step <= epsilon ? leader.heading
          : Math.atan2(slot.x - from.x, slot.z - from.z)
        return setOff(pose(point, heading, step > epsilon ? 'walk' : 'idle'))
      }
    }

    if (target <= trail.start() + epsilon) return setOff(pose(from, follower.heading, 'idle'))
    cursor = Math.max(trail.start(), cursor ?? trail.nearest(from, target))
    if (cursor > target) return pose(from, follower.heading, 'idle')
    let point = from
    let waypoint = trail.pointAt(cursor)
    let toTrail = distance(point, waypoint)
    const remaining = toTrail + target - cursor
    let step = Math.min(remaining, maxSpeed * Math.min(1, remaining / 0.3) * dt)
    while (step > epsilon) {
      if (toTrail <= epsilon) {
        const next = Math.min(target, trail.next(cursor))
        waypoint = trail.pointAt(next)
        toTrail = distance(point, waypoint)
        if (toTrail <= epsilon) break
      }
      const travel = Math.min(step, toTrail)
      const nextPoint = between(point, waypoint, travel / toTrail)
      if (!clearPath(point, nextPoint, isBlocked) || !leavesClearance(point, nextPoint, leader.position)) break
      if (distance(point, trail.pointAt(cursor)) <= epsilon) cursor += travel
      point = nextPoint
      toTrail -= travel
      step -= travel
    }

    const moved = point !== from
    return setOff(pose(point, moved ? Math.atan2(point.x - from.x, point.z - from.z) : follower.heading,
      moved ? 'walk' : 'idle'))
  }

  // `lookDuration` is the seconds of the follower rig's `look` clip, 0 when it has none.
  function update(leader, follower, dt, t, isBlocked, dancing, cameraRight, lookDuration = 0) {
    reachedGate = false
    const result = plan(leader, follower, dt, t, isBlocked, dancing, cameraRight, lookDuration)
    // A yield, hop or dance (or nothing left to walk to) never reaches the gate: it ends a look and its catch-up.
    if (!reachedGate) {
      looking = false
      catchUp = false
    }
    if (catchUp && (result.state !== 'walk' || distance(result.position, leader.position) <= catchUpGap)) {
      catchUp = false
    }
    standing = result.state === 'idle' || result.state === 'dance' ? standing + dt : 0
    return result
  }

  return {
    reset, observe, update,
    // True while the look holds the follower still, and during the catch-up after it.
    // Follow-distance statistics exclude both.
    get looking() { return looking },
    get catchingUp() { return catchUp },
    get displacement() { return history.displacement(0.25) },
    get landing() { return hop?.end ?? -Infinity },
  }
}
