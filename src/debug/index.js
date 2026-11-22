export function setupDebug(player) {
  window.__atlas = {
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

export function setupDuoDebug(follower, swap) {
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
  }
}
