import { MathUtils } from 'three'
import { stepSpring } from '../lib/spring.js'

const settleTime = 0.4
const fadeStart = 0.3
const turnDelay = 0.1
const travelThresholdSquared = 0.01 ** 2

export function createHairMotion() {
  const pitch = { value: 0, velocity: 0 }
  const roll = { value: 0, velocity: 0 }
  const pose = { pitch: 0, roll: 0, yaw: 0 }
  const headings = []
  let time = 0
  let previousHeading = 0
  let previousX = 0
  let previousZ = 0
  let previousBob = 0
  let accelerationX = 0
  let accelerationZ = 0
  let bobRate = 0
  let wasWalking = false
  let age = settleTime

  const update = (dt, { x, z }, heading, bob, dancing) => {
    if (dt <= 0) return pose
    const walking = x * x + z * z > travelThresholdSquared
    const dx = x - previousX
    const dz = z - previousZ
    const dy = bob - previousBob
    const lastHeading = previousHeading
    previousX = x
    previousZ = z
    previousBob = bob
    previousHeading = heading.value
    time += dt

    age = walking ? 0 : age + dt
    if (dancing || age >= settleTime - 1e-9) {
      pitch.value = pitch.velocity = pose.pitch = 0
      roll.value = roll.velocity = pose.roll = 0
      headings.length = 0
      pose.yaw = 0
      accelerationX = accelerationZ = bobRate = 0
      wasWalking = false
      return pose
    }

    const sin = Math.sin(heading.value)
    const cos = Math.cos(heading.value)
    if (walking !== wasWalking) {
      const forwardKick = -(dx * sin + dz * cos)
      const sideKick = dx * cos - dz * sin
      if (walking) {
        pitch.velocity += 2.6 * forwardKick
        roll.velocity += 2.6 * sideKick
      } else {
        // Compensate for the current gait bend so the stop reads at either foot plant.
        pitch.velocity = 5.75 * forwardKick - 12 * pitch.value
        roll.velocity = 5.75 * sideKick - 12 * roll.value
      }
    }
    wasWalking = walking

    // Filter velocity differences before driving the upper locks from the baked bob.
    const decay = Math.exp(-dt / 0.045)
    const gain = (1 - decay) / dt
    accelerationX = decay * accelerationX + gain * dx
    accelerationZ = decay * accelerationZ + gain * dz
    bobRate = decay * bobRate + gain * dy
    const forward = accelerationX * sin + accelerationZ * cos
    const sideways = accelerationX * cos - accelerationZ * sin
    const pitchTarget = walking ? MathUtils.clamp(-0.012 * forward - 0.24 * bobRate, -0.2, 0.2) : 0
    const rollTarget = walking ? MathUtils.clamp(0.016 * sideways + 0.01 * heading.velocity, -0.2, 0.2) : 0
    stepSpring(pitch, pitchTarget, dt, 15.5, 0.42)
    stepSpring(roll, rollTarget, dt, 15.5, 0.42)
    if (!headings.length) headings.push({ time: time - dt, angle: lastHeading })
    headings.push({ time, angle: heading.value })
    const tipTime = time - turnDelay
    while (headings[1].time <= tipTime) headings.shift()
    const [before, after] = headings
    const blend = Math.max(0, (tipTime - before.time) / (after.time - before.time))
    const tipHeading = MathUtils.lerp(before.angle, after.angle, blend)

    const weight = 1 - MathUtils.smoothstep(age, fadeStart, settleTime)
    const bend = Math.hypot(pitch.value, roll.value)
    const cap = bend > 0.35 ? 0.35 / bend : 1
    pose.pitch = pitch.value * weight * cap
    pose.roll = roll.value * weight * cap
    pose.yaw = (tipHeading - heading.value) * weight
    return pose
  }
  // A foot contact nudges the pitch spring (rad/s); the gait loop above carries it from there.
  update.kick = (velocity) => { pitch.velocity += velocity }
  return update
}
