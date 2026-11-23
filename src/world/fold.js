import { createHistory, createSecondary, pushHistory, stepSecondary } from './follow.js'
import { FLAT, HINGE_STAGGER, stepSpring } from './spring.js'

// Hinge motion for the two-stage fold (docs/contracts.md "Round 6" → Folds). A hinge is a plain
// record that `art.js` creates per tile instance; everything here mutates it in place and allocates
// nothing, so the per-frame fold update stays allocation free.

const DEG = Math.PI / 180
export const DIP_ANGLE = 4 * DEG
export const DIP_TIME = 0.08
// A hinge this close to flat has no room to dip, so it holds for the dip time instead.
const FLAT_HOLD = 1 * DEG
export const BEND_PER_SPEED = 0.04
export const BEND_LIMIT = 8 * DEG
const SETTLE_ANGLE = 0.0001
const SETTLE_SPEED = 0.002

// bend = clamp(−0.04 s · θ′, ±8°); `+ 0` turns -0 into 0 so a settled instance reads exactly 0.
export function bendOf(speed) {
  return Math.max(-BEND_LIMIT, Math.min(BEND_LIMIT, -BEND_PER_SPEED * speed)) + 0
}

// Per-instance state on a hinge copy (the shared template only carries geometry and pivots).
export function initHinge(hinge) {
  hinge.angle = FLAT
  hinge.velocity = 0
  hinge.moving = false
  hinge.startAt = 0
  hinge.dipStart = 0
  hinge.kind = 'stage'
  hinge.target = FLAT
  hinge.dipping = false
  hinge.dipFrom = FLAT
  hinge.dipTo = FLAT
  hinge.bend = 0
  hinge.live = false
  hinge.history = createHistory()
  hinge.secs = (hinge.secs ?? []).map((sec) => ({ ...createSecondary(sec.index), ...sec, value: 0, velocity: 0, phi: 0, bend: 0 }))
  return hinge
}

// Carry the motion across a model swap (placeholder to GLB) so a tile never jumps.
export function copyHingeState(from, to) {
  to.angle = from.angle
  to.velocity = from.velocity
  to.moving = from.moving
  to.startAt = from.startAt
  to.dipStart = from.dipStart
  to.kind = from.kind
  to.target = from.target
  to.dipping = from.dipping
  to.dipFrom = from.dipFrom
  to.dipTo = from.dipTo
}

// Begin moving toward `target`. A hinge already in motion carries on from where it is (no new
// stagger); a resting or still-waiting hinge starts `order` staggers after t.
export function startHinge(hinge, kind, target, t, order) {
  if (!hinge.moving || hinge.startAt > t) hinge.startAt = t + order * HINGE_STAGGER
  hinge.moving = true
  hinge.kind = kind
  hinge.target = target
  hinge.dipping = kind === 'up'
  if (hinge.dipping) {
    // The dip clock starts at the stagger for a resting hinge, and right now for one already moving.
    hinge.dipStart = Math.max(hinge.startAt, t)
    hinge.dipFrom = hinge.angle
    hinge.dipTo = hinge.angle <= FLAT + FLAT_HOLD ? hinge.angle : Math.max(hinge.angle - DIP_ANGLE, FLAT)
  }
}

function advance(hinge, t, dt) {
  const elapsed = t - hinge.startAt
  if (elapsed <= 0) return
  let step = Math.min(dt, elapsed)
  if (hinge.dipping) {
    const dipElapsed = t - hinge.dipStart
    if (dipElapsed <= 0) return
    if (dipElapsed < DIP_TIME) {
      const s = dipElapsed / DIP_TIME
      const travel = hinge.dipTo - hinge.dipFrom
      hinge.angle = hinge.dipFrom + travel * s * s * (3 - 2 * s)
      hinge.velocity = travel * 6 * s * (1 - s) / DIP_TIME
      return
    }
    // Release: the up spring starts here, from rest, at the end of the dip.
    hinge.dipping = false
    hinge.angle = hinge.dipTo
    hinge.velocity = 0
    step = Math.min(dt, dipElapsed - DIP_TIME)
  }
  if (step > 0) stepSpring(hinge, hinge.kind, step, hinge.target)
  if (Math.abs(hinge.angle - hinge.target) < SETTLE_ANGLE && Math.abs(hinge.velocity) < SETTLE_SPEED) {
    hinge.angle = hinge.target
    hinge.velocity = 0
    hinge.moving = false
  }
}

// True when the hinge has nothing to do this frame (not moving or still waiting out its stagger).
export function isIdle(hinge, t) {
  return hinge.live ? false : !hinge.moving || t <= hinge.startAt
}

// Advance the hinge, its bend and its sec_<k> follow-through by dt to time t.
export function updateHinge(hinge, t, dt) {
  const { secs, history } = hinge
  if (!hinge.live) {
    hinge.live = true
    history.count = 0
    for (let k = 0; k < secs.length; k += 1) {
      secs[k].value = hinge.angle
      secs[k].velocity = 0
      secs[k].phi = 0
    }
  }
  if (hinge.moving) advance(hinge, t, dt)
  const started = hinge.moving && t > hinge.startAt
  hinge.bend = started ? bendOf(hinge.velocity) : 0
  pushHistory(history, t, hinge.angle)
  let settled = !hinge.moving
  for (let k = 0; k < secs.length; k += 1) {
    const sec = secs[k]
    const done = stepSecondary(sec, history, t, dt, hinge.angle, !hinge.moving)
    // The follower's own absolute angular speed is its parent's plus φ′, which is the spring velocity.
    sec.bend = done ? 0 : bendOf(sec.velocity)
    if (!done) settled = false
  }
  if (settled) hinge.live = false
}
