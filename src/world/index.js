import { camera, player, registerUpdate, scene, setIsBlocked } from '../scene/runtime.js'
import { createLayout } from './layout.js'
import { createTileStream } from './stream.js'

const foldListeners = new Set()

export function onFold(fn) {
  foldListeners.add(fn)
  return () => foldListeners.delete(fn)
}

export function initWorld(debug) {
  const layout = createLayout()
  const stream = createTileStream(scene, layout, (event) => {
    debug.foldLog.push(event)
    for (const listener of foldListeners) listener(event)
  }, camera)
  setIsBlocked(layout.isBlocked)
  registerUpdate((dt, t) => stream.update(dt, t, player.position, camera.aspect))

  debug.worldReady = stream.ready
  debug.hingeTrace = (id) => stream.hingeTrace(id, player.position)
  debug.setSeed = (seed) => {
    layout.setSeed(seed)
    stream.dropRender()
    debug.foldLog.length = 0
  }
}
