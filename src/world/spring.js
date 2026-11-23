import { stepSpring as stepDamped } from '../lib/spring.js'

export const FLAT = -Math.PI / 2
export const UPRIGHT = 0
// Round 6 stage 1: a tile near the leader stands part-way up (30 % of the travel), silently.
export const STAGE_ONE = -63 * Math.PI / 180
export const HINGE_STAGGER = 0.18

const springs = {
  up: { omega: 6, damping: 0.5, target: UPRIGHT },
  down: { omega: 7, damping: 0.85, target: FLAT },
  stage: { omega: 5, damping: 0.8, target: STAGE_ONE },
}
const scratch = { value: 0, velocity: 0 }

// Exact underdamped step; uses the current velocity so a reversal is continuous.
// `target` overrides the direction's default (a stage-2 fold-down lands on -63° or on flat).
export function stepSpring(state, direction, dt, target = springs[direction].target) {
  const { omega, damping } = springs[direction]
  scratch.value = state.angle
  scratch.velocity = state.velocity
  stepDamped(scratch, target, dt, omega, damping)
  state.angle = scratch.value
  state.velocity = scratch.velocity
}
