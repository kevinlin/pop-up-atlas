import { camera, player, registerUpdate, scene, setIsBlocked } from '../scene/runtime.js'
import { createLayout } from './layout.js'
import { createTileStream } from './stream.js'
import { cellAt, LAST_PAGE_ROW } from './tiles.js'

const foldListeners = new Set()

export function onFold(fn) {
  foldListeners.add(fn)
  return () => foldListeners.delete(fn)
}

export function initWorld(debug) {
  const initialSeed = Number(new URLSearchParams(window.location.search).get('seed'))
  let seed = Number.isSafeInteger(initialSeed) ? initialSeed >>> 0 : 0
  const layout = createLayout(seed)
  let previousI
  let previousJ
  let tile
  const stream = createTileStream(scene, layout, (event) => {
    debug.foldLog.push(event)
    for (const listener of foldListeners) listener(event)
  }, camera)
  setIsBlocked(layout.isBlocked, layout.blockedBy)
  registerUpdate((dt, t) => stream.update(dt, t, player.position, camera.aspect))

  debug.worldReady = stream.ready
  debug.hingeTrace = (id) => stream.hingeTrace(id, player.position)
  debug.setSeed = (value) => {
    seed = value >>> 0
    previousI = undefined
    layout.setSeed(seed)
    stream.dropRender()
    debug.foldLog.length = 0
  }

  return {
    get seed() { return seed },
    tileAt(x, z) {
      const i = cellAt(x)
      const j = Math.min(LAST_PAGE_ROW, cellAt(z))
      if (i !== previousI || j !== previousJ) {
        tile = layout.getCell(i, j).id
        previousI = i
        previousJ = j
      }
      return tile
    },
  }
}
