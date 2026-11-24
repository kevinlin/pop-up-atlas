import { events } from '../scene/runtime.js'

const GAP = 3

// `bump` {who, reason, t} for the leader's collision: reason is what `blockedBy` reports ('prop', 'edge',
// 'river'). At most one per reason every 3 s, however long a key stays held against the obstacle.
// Independent of audio: the umbrella and other gameplay readers use it with sound locked.
export function createBumpEvents(bus = events) {
  const last = new Map()
  return (t, who, reason) => {
    if (typeof reason !== 'string' || t - (last.get(reason) ?? -Infinity) < GAP) return false
    last.set(reason, t)
    bus.dispatchEvent(new CustomEvent('bump', { detail: { who, reason, t } }))
    return true
  }
}
