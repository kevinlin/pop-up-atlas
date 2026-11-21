import { PerspectiveCamera, Scene } from 'three'
import { createPlayer } from '../controls/movement.js'

export const scene = new Scene()
export const camera = new PerspectiveCamera(30, 1, 0.1, 160)
export const player = createPlayer()

// Heading is in radians from +Z. Position and velocity are world-space Vector3s.
export let isBlocked = () => false
export let blockedBy = isBlocked

export function setIsBlocked(check, reason = check) {
  isBlocked = check
  blockedBy = reason
}

export const updates = new Set()

// Both arguments are seconds. The returned function unregisters the callback.
export function registerUpdate(fn) {
  updates.add(fn)
  return () => updates.delete(fn)
}
