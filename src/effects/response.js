import { UPRIGHT } from '../world/spring.js'
import { unit } from './placement.js'

export const FOLD_GLOW = 0.4
export const BURST_SIZE = 36
export const BURST_LIFE = 0.68
const FLASH_TIME = 0.24
const FADE_TIME = 0.6

export function createResponse() {
  return { up: false, uprightAt: -1, downAt: 0, fadingFrom: 0, glow: 0 }
}

export function setFold(state, up, t) {
  state.up = up
  if (up) {
    state.uprightAt = -1
  } else {
    state.downAt = t
    state.fadingFrom = state.glow
  }
}

export function updateResponse(state, t, angle, distanceSquared) {
  if (!state.up) {
    state.glow = state.fadingFrom * Math.max(0, 1 - (t - state.downAt) / FADE_TIME)
    return false
  }

  const firstUpright = state.uprightAt < 0 && angle >= UPRIGHT
  if (firstUpright) state.uprightAt = t
  state.glow = state.uprightAt >= 0 && distanceSquared <= 9
    ? FOLD_GLOW * (1 + 0.5 * Math.max(0, 1 - (t - state.uprightAt) / FLASH_TIME))
    : 0
  return firstUpright
}

export function createBurstPool() {
  const slots = [{ end: -Infinity }, { end: -Infinity }]
  const particles = new Float32Array(slots.length * BURST_SIZE * 8)
  function fire(t, x, y, z, seed) {
    let slot = 0
    while (slot < slots.length && slots[slot].end > t) slot += 1
    if (slot === slots.length) return false
    slots[slot].end = t + BURST_LIFE
    for (let i = 0; i < BURST_SIZE; i += 1) {
      const offset = (slot * BURST_SIZE + i) * 8
      const turn = i * 2.399963 + unit(seed, i, 0, 1) * 0.45
      const speed = 0.70 + unit(seed, i, 0, 2) * 2.12
      particles[offset] = x
      particles[offset + 1] = y
      particles[offset + 2] = z
      particles[offset + 3] = t
      particles[offset + 4] = speed * Math.cos(turn)
      particles[offset + 5] = 0.65 + unit(seed, i, 0, 3) * 2
      particles[offset + 6] = speed * Math.sin(turn)
      particles[offset + 7] = unit(seed, i, 0, 4)
    }
    return true
  }

  function reset() {
    for (const slot of slots) slot.end = -Infinity
    for (let i = 3; i < particles.length; i += 8) particles[i] = -10
  }

  reset()
  return { slots, particles, fire, reset }
}
