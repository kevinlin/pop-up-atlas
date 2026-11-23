import { stepSpring } from '../lib/spring.js'

export const UMBRELLA_OPEN_FOR = 1.2
export const UMBRELLA_GAP = 3

// B's umbrella: `umbrella_closed` and `umbrella_open` under `hand_r`; the open one is authored at
// scale 0 and springs to 1 (ω 14, ζ 0.45). Clips never animate either node. A no-op without them.
export function createUmbrella(model) {
  const closed = model.getObjectByName('umbrella_closed')
  const open = model.getObjectByName('umbrella_open')
  const spring = { value: 0, velocity: 0 }
  let isOpen = false
  let openedAt = null
  let lastCollision = -Infinity
  let closeAt = Infinity

  function pop(t) {
    isOpen = true
    openedAt = t
    closeAt = t + UMBRELLA_OPEN_FOR
  }

  return {
    get open() { return isOpen },
    get t() { return openedAt },
    get scale() { return spring.value },
    // The collision itself opens it, at most once per 3 s; the voice line is not involved.
    collide(t) {
      if (t - lastCollision < UMBRELLA_GAP - 1e-9) return false
      lastCollision = t
      pop(t)
      return true
    },
    bow(t) { pop(t) },
    close() {
      isOpen = false
      closeAt = Infinity
    },
    update(dt, t) {
      if (isOpen && t >= closeAt) this.close()
      if (dt > 0) stepSpring(spring, isOpen ? 1 : 0, dt, 14, 0.45)
      if (!open) return
      const scale = Math.max(0, spring.value)
      open.scale.setScalar(scale)
      open.visible = scale > 1e-3
      if (closed) closed.visible = !isOpen && scale < 0.2
    },
  }
}
