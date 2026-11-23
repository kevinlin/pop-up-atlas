import { Vector3 } from 'three'
import { events } from '../scene/runtime.js'

export function createLeadSwap(player, follower, apply) {
  const position = new Vector3()
  const velocity = new Vector3()
  let leader = 'a'
  let swaps = 0
  let lastSwap = -Infinity
  let pendingSwap = false

  return {
    get leader() { return leader },
    get swaps() { return swaps },
    get pendingSwap() { return pendingSwap },
    request() { pendingSwap = !pendingSwap },
    update(t, landing) {
      if (!pendingSwap || t < Math.max(lastSwap + 0.5, landing)) return false
      position.copy(player.position)
      velocity.copy(player.velocity)
      const { state, heading } = player
      player.position.copy(follower.position)
      player.velocity.copy(follower.velocity)
      player.heading = follower.heading
      player.state = follower.state
      follower.position.copy(position)
      follower.velocity.copy(velocity)
      follower.heading = heading
      follower.state = state
      player.blockedBy = follower.blockedBy = null

      leader = leader === 'a' ? 'b' : 'a'
      swaps += 1
      lastSwap = t
      pendingSwap = false
      apply(leader)
      events.dispatchEvent(new CustomEvent('swap', { detail: { leader, t } }))
      return true
    },
  }
}
