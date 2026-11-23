import { stepSpring } from '../lib/spring.js'

// Follow-through (contract "Round 6" → Folds): each `sec_<k>` angle relative to its parent is
// φ = s − θ_parent, where s is a spring (ω 9, ζ 0.4) tracking θ_parent delayed by 80 ± 20 ms.
// At rest s = θ_parent exactly, so φ = 0 and the authored pose holds. Nothing here allocates per call.
export const FOLLOW_OMEGA = 9
export const FOLLOW_DAMPING = 0.4
const HISTORY_SIZE = 64
const SETTLE_ANGLE = 1e-4
const SETTLE_SPEED = 0.002

export function secondaryDelay(index) {
  // Deterministic spread over 60-100 ms so neighbouring petals do not move in lockstep.
  return 0.06 + 0.04 * ((index * 0.6180339887) % 1)
}

export function createHistory() {
  return { times: new Float64Array(HISTORY_SIZE), angles: new Float64Array(HISTORY_SIZE), count: 0 }
}

export function pushHistory(history, t, angle) {
  const slot = history.count % HISTORY_SIZE
  history.times[slot] = t
  history.angles[slot] = angle
  history.count += 1
}

// The parent's angle at time t, interpolated; the oldest sample when t predates the history.
export function delayedAngle(history, t) {
  const { times, angles, count } = history
  const size = Math.min(count, HISTORY_SIZE)
  let newer = (count - 1) % HISTORY_SIZE
  if (t >= times[newer]) return angles[newer]
  for (let back = 1; back < size; back += 1) {
    const older = (newer + HISTORY_SIZE - 1) % HISTORY_SIZE
    if (times[older] <= t) {
      const span = times[newer] - times[older]
      return span > 0 ? angles[older] + (angles[newer] - angles[older]) * (t - times[older]) / span : angles[newer]
    }
    newer = older
  }
  return angles[newer]
}

export function createSecondary(index) {
  return { index, delay: secondaryDelay(index), value: 0, velocity: 0, phi: 0, bend: 0 }
}

// Advances one secondary by dt. Returns true once it has settled onto its parent (φ is then exactly 0).
export function stepSecondary(sec, history, t, dt, parentAngle, parentAtRest) {
  stepSpring(sec, delayedAngle(history, t - sec.delay), dt, FOLLOW_OMEGA, FOLLOW_DAMPING)
  if (parentAtRest && Math.abs(sec.value - parentAngle) < SETTLE_ANGLE && Math.abs(sec.velocity) < SETTLE_SPEED) {
    sec.value = parentAngle
    sec.velocity = 0
    sec.phi = 0
    return true
  }
  sec.phi = sec.value - parentAngle
  return false
}
