import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { createMovement } from './movement.js'

const movementKeys = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
])

export function bindControls(canvas, camera, player, { requestSwap, hitsFollower }) {
  const movement = createMovement(player, camera)
  const keys = new Set()
  const raycaster = new Raycaster()
  const pagePlane = new Plane(new Vector3(0, 1, 0), 0)
  const pointer = new Vector2()
  const hit = new Vector3()
  let pressedMovement = false

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault()
      if (!event.repeat) requestSwap()
      return
    }
    movement.cancelWalk()
    if (movementKeys.has(event.code)) {
      event.preventDefault()
      keys.add(event.code)
      pressedMovement = true
    }
  })
  window.addEventListener('keyup', (event) => keys.delete(event.code))
  window.addEventListener('blur', () => {
    keys.clear()
    movement.cancelWalk()
  })

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return
    const bounds = canvas.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    if (hitsFollower(x, y, bounds)) {
      requestSwap()
      return
    }
    pointer.set(x / bounds.width * 2 - 1, 1 - y / bounds.height * 2)
    raycaster.setFromCamera(pointer, camera)
    if (raycaster.ray.intersectPlane(pagePlane, hit)) movement.walkTo(hit)
  })

  const pressed = (letter, arrow) => Number(keys.has(letter) || keys.has(arrow))
  return {
    cancelWalk: movement.cancelWalk,
    update(dt, isBlocked) {
      const strafe = pressed('KeyD', 'ArrowRight') - pressed('KeyA', 'ArrowLeft')
      const forward = pressed('KeyW', 'ArrowUp') - pressed('KeyS', 'ArrowDown')
      const input = pressedMovement || keys.size > 0 || movement.hasDestination
      pressedMovement = false
      movement.update(dt, strafe, forward, isBlocked)
      return input
    },
  }
}
