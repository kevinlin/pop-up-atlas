import { stepSpring } from '../lib/spring.js'

const settleTime = 0.3
const fadeStart = 0.22
const travelThresholdSquared = 0.01 ** 2

export function createHairMotion() {
  const pitch = { value: 0, velocity: 0 }
  const roll = { value: 0, velocity: 0 }
  const pose = { pitch: 0, roll: 0 }
  let previousX = 0
  let previousZ = 0
  let age = settleTime

  return (dt, { x, z }, heading, dancing) => {
    const dx = x - previousX
    const dz = z - previousZ
    previousX = x
    previousZ = z

    if (dancing) {
      age = settleTime
    } else if (dx * dx + dz * dz > travelThresholdSquared) {
      const sin = Math.sin(heading)
      const cos = Math.cos(heading)
      // The stop blends into a straighter head pose, where the same kick reads larger.
      const gain = x * x + z * z <= travelThresholdSquared ? 3 : 4.7
      // A change in world velocity kicks the spring once, even on a sharp turn.
      pitch.velocity -= gain * (dx * sin + dz * cos)
      roll.velocity += gain * (dx * cos - dz * sin)
      const cap = Math.min(1, 6.5 / Math.hypot(pitch.velocity, roll.velocity))
      pitch.velocity *= cap
      roll.velocity *= cap
      age = 0
    }

    age += dt
    if (age >= settleTime - 1e-9) {
      pitch.value = pitch.velocity = pose.pitch = 0
      roll.value = roll.velocity = pose.roll = 0
    } else {
      stepSpring(pitch, 0, dt, 16, 0.36)
      stepSpring(roll, 0, dt, 16, 0.36)
      // Let the first recoil show before easing its tail all the way to rest.
      const tail = Math.max(0, (age - fadeStart) / (settleTime - fadeStart))
      const weight = 1 - tail * tail * (3 - 2 * tail)
      pose.pitch = pitch.value * weight
      pose.roll = roll.value * weight
    }
    return pose
  }
}
