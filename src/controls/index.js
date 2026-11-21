import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { createMovement } from './movement.js'

const movementKeys = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
])

export function bindControls(canvas, camera, player) {
  const movement = createMovement(player, camera)
  const keys = new Set()
  const raycaster = new Raycaster()
  const pagePlane = new Plane(new Vector3(0, 1, 0), 0)
  const pointer = new Vector2()
  const hit = new Vector3()

  window.addEventListener('keydown', (event) => {
    movement.cancelWalk()
    if (movementKeys.has(event.code)) {
      event.preventDefault()
      keys.add(event.code)
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
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    )
    raycaster.setFromCamera(pointer, camera)
    if (raycaster.ray.intersectPlane(pagePlane, hit)) movement.walkTo(hit)
  })

  const pressed = (letter, arrow) => Number(keys.has(letter) || keys.has(arrow))
  return (dt, isBlocked) => {
    const strafe = pressed('KeyD', 'ArrowRight') - pressed('KeyA', 'ArrowLeft')
    const forward = pressed('KeyW', 'ArrowUp') - pressed('KeyS', 'ArrowDown')
    movement.update(dt, strafe, forward, isBlocked)
  }
}
