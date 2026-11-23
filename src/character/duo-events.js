import { events } from '../scene/runtime.js'

// Produces `duo-dance-start` / `duo-dance-end` from the per-character dance events. Each rig calls
// `start` / `end` right after it dispatched its own `dance-start` / `dance-end`, so the order on the
// bus is always the character event first, then the duo event. The first start is the leader's. The
// duo dance ends when both dances have finished (the follower's canon included) or as soon as either
// one is interrupted.
export function createDuoDanceEvents(bus = events) {
  let active = false
  const finished = new Set()
  const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }))

  return {
    start({ t }) {
      if (active) return
      active = true
      finished.clear()
      emit('duo-dance-start', { t })
    },
    end({ who, t, interrupted }) {
      if (!active) return
      finished.add(who)
      if (!interrupted && finished.size < 2) return
      active = false
      emit('duo-dance-end', { t, interrupted })
    },
  }
}
