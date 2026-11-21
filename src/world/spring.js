import { stepSpring as stepDamped } from '../lib/spring.js'

export const FLAT = -Math.PI / 2
export const UPRIGHT = 0
export const HINGE_STAGGER = 0.05

const springs = {
  up: { omega: 14, damping: 0.45, target: UPRIGHT },
  down: { omega: 12, damping: 0.85, target: FLAT },
}
const scratch = { value: 0, velocity: 0 }

// Exact underdamped step; uses the current velocity so a reversal is continuous.
export function stepSpring(state, direction, dt) {
  const { omega, damping, target } = springs[direction]
  scratch.value = state.angle
  scratch.velocity = state.velocity
  stepDamped(scratch, target, dt, omega, damping)
  state.angle = scratch.value
  state.velocity = scratch.velocity
}
