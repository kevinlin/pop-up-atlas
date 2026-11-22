import { Vector3 } from 'three'

const WALK_SPEED = 1.2

export function createPlayer() {
  return {
    position: new Vector3(),
    heading: 0,
    velocity: new Vector3(),
    state: 'idle',
    blockedBy: null,
  }
}

export function createMovement(player, camera) {
  const direction = new Vector3()
  const right = new Vector3()
  const clickPoint = new Vector3()
  let destination = null

  function update(dt, strafe, forward, isBlocked) {
    const { position, velocity } = player
    let step = WALK_SPEED * dt
    let arrives = false

    if (strafe || forward) {
      destination = null
      camera.getWorldDirection(direction)
      direction.y = 0
      direction.normalize()
      right.crossVectors(direction, camera.up)
      direction.multiplyScalar(forward).addScaledVector(right, strafe).normalize()
    } else if (destination) {
      direction.subVectors(destination, position)
      direction.y = 0
      const distance = direction.length()
      arrives = distance <= step
      step = Math.min(step, distance)
      direction.normalize()
    } else {
      direction.set(0, 0, 0)
    }

    const x = arrives ? destination.x : position.x + direction.x * step
    const z = arrives ? destination.z : position.z + direction.z * step
    const moved = x !== position.x || z !== position.z
    const blocked = moved && isBlocked(x, z)
    player.blockedBy = typeof blocked === 'string' ? blocked : null
    if (moved && !blocked) {
      position.x = x
      position.z = z
      player.heading = Math.atan2(direction.x, direction.z)
    }

    if (arrives || blocked) destination = null
    player.state = moved && !blocked && !arrives ? 'walk' : 'idle'
    velocity.copy(direction).multiplyScalar(player.state === 'walk' ? WALK_SPEED : 0)
  }

  return {
    update,
    get hasDestination() { return destination !== null },
    walkTo(point) { destination = clickPoint.copy(point) },
    cancelWalk() { destination = null },
  }
}
