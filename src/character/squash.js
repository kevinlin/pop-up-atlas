import { stepSpring } from '../lib/spring.js'

export const SQUASH_CONTACT = 0.95
export const SQUASH_LANDING = 0.88
export const STRETCH_TAKEOFF = 1.10

// Volume-preserving squash and stretch on the `root` bone: sy springs back to 1 (ω 18, ζ 0.5)
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
      if (dt > 0) stepSpring(spring, 1, dt, 18, 0.5)
      if (!root) return
      const side = 1 / Math.sqrt(spring.value)
      root.scale.set(base.x * side, base.y * spring.value, base.z * side)
    },
  }
}
