import { events } from '../scene/runtime.js'

export function setupDebug(player) {
  window.__atlas = {
    // The frozen character and camera event bus (docs/contracts.md "Round 6" → Events), for the gate and capture.
    events,
    player: {
      get x() { return player.position.x },
      get z() { return player.position.z },
      get state() { return player.state },
    },
    foldLog: [],
    hingeTrace: () => [],
    hairBones: [],
    audioLog: [],
    cueLog: [],
    popLog: [],
    audioReadyMs: null,
    setSeed: () => {},
  }

  if (!new URLSearchParams(window.location.search).has('debug')) return () => {}

  const readout = document.createElement('output')
  readout.setAttribute('aria-label', 'Frame time')
  document.body.append(readout)
  let elapsed = 0
  let frames = 0

  return (frameTime) => {
    elapsed += frameTime
    frames += 1
    if (elapsed >= 0.25) {
      readout.value = `${(elapsed * 1000 / frames).toFixed(1)} ms`
      elapsed = 0
      frames = 0
    }
  }
}

// `__atlas.face` = {a, b}: each {cell, lid}, the mouth atlas cell (0-7, see MOUTH_CELLS in
// character/face.js) and the lid closure (0 open, 1 closed). `__atlas.umbrella` = B's {open, t}:
// whether it is open and the `elapsed` time of its last pop (null before the first).
export function setupCharacterDebug({ a, b }) {
  const face = (character) => ({
    get cell() { return character.face?.cell ?? 0 },
    get lid() { return character.face?.lid ?? 0 },
  })
  window.__atlas.face = { a: face(a), b: face(b) }
  window.__atlas.umbrella = {
    get open() { return b.umbrella?.open ?? false },
    get t() { return b.umbrella?.t ?? null },
  }
}

export function setupDuoDebug(follower, swap, follow) {
  window.__atlas.duo = {
    get leader() { return swap.leader },
    follower: {
      get x() { return follower.position.x },
      get z() { return follower.position.z },
      get state() { return follower.state },
    },
    get swaps() { return swap.swaps },
    get pendingSwap() { return swap.pendingSwap },
    swap: swap.request,
    // B's look before setting off (follow-distance statistics exclude it and the catch-up after it).
    look: {
      get active() { return follow.looking },
      get catchUp() { return follow.catchingUp },
    },
  }
}
