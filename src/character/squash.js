import { stepSpring } from '../lib/spring.js'

export const SQUASH_CONTACT = 0.95
export const SQUASH_LANDING = 0.88
export const STRETCH_TAKEOFF = 1.10
// Round 6 C6 (motion critic): a 4 % stretch 0.1 s before the dance landing, and a slower return (was ω 18, ζ 0.5), so the
// squash reads at film speed instead of snapping back within a frame or two.
export const STRETCH_ANTICIPATION = 1.04
export const ANTICIPATION_LEAD = 0.1
const OMEGA = 11
const ZETA = 0.6

// Volume-preserving squash and stretch on the `root` bone: sy springs back to 1 (ω 11, ζ 0.6)
// and sx = sz = 1 / sqrt(sy). When several triggers fall in one frame the larger deformation wins.
export function createSquash(root) {
  const spring = { value: 1, velocity: 0 }
  const base = root ? root.scale.clone() : undefined
  let pending = 1

  return {
    get value() { return spring.value },
    trigger(value) {
      if (Math.abs(value - 1) > Math.abs(pending - 1)) pending = value
    },
    update(dt) {
      if (pending !== 1) {
        spring.value = pending
        spring.velocity = 0
        pending = 1
      }
      if (dt > 0) stepSpring(spring, 1, dt, OMEGA, ZETA)
      if (!root) return
      const side = 1 / Math.sqrt(spring.value)
      root.scale.set(base.x * side, base.y * spring.value, base.z * side)
    },
  }
}
