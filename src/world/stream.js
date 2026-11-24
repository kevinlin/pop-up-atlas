import { Frustum, Matrix4, Sphere, Vector3 } from 'three'
import { stage } from '../effects/flags.js'
import { createFoldLight } from '../effects/fold-light.js'
import { createLanterns } from '../effects/lanterns.js'
import { createMoss } from '../effects/moss.js'
import { afterWorldReady } from '../effects/startup.js'
import { events, follower } from '../scene/runtime.js'
import { createArt } from './art.js'
import { createBook } from './book.js'
import { copyHingeState, isIdle, startHinge, updateHinge } from './fold.js'
import { FLAT, HINGE_STAGGER, STAGE_ONE, UPRIGHT } from './spring.js'
import { cellAt, cellKey, FIRST_PAGE_ROW, LAST_PAGE_ROW, TILE_SIZE } from './tiles.js'

// Stage 2 is the fold itself (up within 2 units, down beyond 3); stage 1 is the silent lift to -63°
// (within 4.5, back down beyond 5.5). Docs/contracts.md "Round 6" → Folds.
const FOLD_UP_DISTANCE_SQUARED = 2 ** 2
const FOLD_DOWN_DISTANCE_SQUARED = 3 ** 2
const STAGE_UP_DISTANCE_SQUARED = 4.5 ** 2
const STAGE_DOWN_DISTANCE_SQUARED = 5.5 ** 2
const DANCE_STAGE_DISTANCE_SQUARED = 1.8 ** 2
const DANCE_STAGE_TILES = new Set(['flower', 'mushroom_house', 'cupcake_tree'])
const FAST_FORWARD_STEP = 1 / 60
const TRACE_SIZE = 200

function recordTrace(cell, t, angle) {
  cell.trace ??= { times: new Float64Array(TRACE_SIZE), angles: new Float64Array(TRACE_SIZE), count: 0 }
  const { times, angles, count } = cell.trace
  const index = count % TRACE_SIZE
  times[index] = t
  angles[index] = angle
  cell.trace.count += 1
}

function traceSamples(trace) {
  if (!trace) return []
  const length = Math.min(trace.count, TRACE_SIZE)
  return Array.from({ length }, (_, sample) => {
    const index = (trace.count - length + sample) % TRACE_SIZE
    return { t: trace.times[index], angle: trace.angles[index] }
  })
}

// `options.art` lets a caller supply the art (tests register fixture tile objects on it).
export function createTileStream(scene, layout, emitFold, camera, options = {}) {
  const art = options.art ?? createArt(scene, camera, layout)
  const placeBook = createBook(scene)
  let moss
  let lanterns
  let foldLight
  let capacity = 0
  const visible = new Map()
  // The same cells as an array, rebuilt when the set changes, so the per-frame loop allocates nothing.
  const cells = []
  let leaderX = 0
  let leaderZ = 0
  let lastT = 0
  const frustum = new Frustum()
  const projection = new Matrix4()
  // Include upright artwork and the camera's travel before the next cell refresh.
  const tileBounds = new Sphere(new Vector3(), 4.25)
  let lastArea
  let lastRevision = -1

  if (stage.moss || stage.lanterns || stage.response) {
    afterWorldReady(scene, (root) => {
      moss = stage.moss ? createMoss(root) : null
      lanterns = stage.lanterns ? createLanterns(root) : null
      foldLight = stage.lanterns || stage.response ? createFoldLight(root, camera) : null
      moss?.begin(capacity)
      lanterns?.begin(capacity)
      for (const cell of visible.values()) {
        foldLight?.prepare(cell)
        if (!cell.drawn) continue
        moss?.place(cell, layout)
        lanterns?.place(cell, layout)
      }
      moss?.end()
      lanterns?.end()
    })
  }

  function sync(centerI, radiusX, t) {
    const cameraArea = camera ? cellKey(cellAt(camera.position.x), cellAt(camera.position.z)) : ''
    const area = `${centerI},${radiusX},${cameraArea}`
    const revision = art.revision()
    if (area === lastArea && revision === lastRevision) return
    lastArea = area
    lastRevision = revision
    if (camera) {
      camera.updateMatrixWorld()
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    }

    for (const [key, cell] of visible) {
      if (Math.abs(centerI - cell.i) <= radiusX) continue
      visible.delete(key)
    }

    placeBook(centerI - radiusX, centerI + radiusX)
    capacity = (2 * radiusX + 1) * (LAST_PAGE_ROW - FIRST_PAGE_ROW + 1)
    art.begin(capacity)
    moss?.begin(capacity)
    lanterns?.begin(capacity)
    for (let j = FIRST_PAGE_ROW; j <= LAST_PAGE_ROW; j += 1) {
      for (let i = centerI - radiusX; i <= centerI + radiusX; i += 1) {
        const key = cellKey(i, j)
        let cell = visible.get(key)
        if (!cell) {
          cell = { i, j, x: i * TILE_SIZE, z: j * TILE_SIZE, tile: layout.getCell(i, j), up: false, lifted: false, staged: false }
          visible.set(key, cell)
        }
        const model = art.modelAt(cell)
        if (!cell.art || cell.art.model !== model) {
          const previous = cell.art
          cell.art = art.create(cell, model)
          for (const [order, hinge] of cell.art.hinges.entries()) {
            const oldHinge = previous?.hinges[order]
            if (oldHinge) {
              copyHingeState(oldHinge, hinge)
            } else if (cell.foldStarted !== undefined) {
              // A hinge the old model did not have: replay the cell's last move from where it began.
              hinge.angle = cell.foldFrom
              startHinge(hinge, cell.foldKind, cell.foldTarget, cell.foldStarted, order)
              for (let at = hinge.startAt; hinge.moving && at < t; at += FAST_FORWARD_STEP) {
                updateHinge(hinge, Math.min(t, at + FAST_FORWARD_STEP), FAST_FORWARD_STEP)
              }
            }
          }
          foldLight?.prepare(cell)
        }
        tileBounds.center.set(cell.x, 0.4, cell.z)
        cell.drawn = !camera || frustum.intersectsSphere(tileBounds)
        if (cell.drawn) {
          art.placeTile(cell)
          moss?.place(cell, layout)
          lanterns?.place(cell, layout)
        }
      }
    }
    art.end()
    moss?.end()
    lanterns?.end()
    cells.length = 0
    for (const cell of visible.values()) cells.push(cell)
  }

  function distanceSquared(cell, position) {
    return (cell.x - position.x) ** 2 + (cell.z - position.z) ** 2
  }

  // Start every hinge of the cell moving. `kind` picks the spring: 'up' (with the dip), 'down', 'stage'.
  function moveCell(cell, kind, target, t) {
    const { hinges } = cell.art
    cell.foldStarted = t
    cell.foldKind = kind
    cell.foldTarget = target
    cell.foldFrom = hinges[0].angle
    for (let order = 0; order < hinges.length; order += 1) startHinge(hinges[order], kind, target, t, order)
  }

  // Dance stage (contract "Round 6" → Folds): prop tiles within 1.8 units of either character go flat
  // and stay flat until the dance ends. A stage-2 tile folds down with `cause: 'stage'`, a stage-1 tile
  // drops silently, a flat tile stays flat.
  function stageProps(t) {
    const now = Math.max(t, lastT)
    for (const cell of visible.values()) {
      if (!DANCE_STAGE_TILES.has(cell.tile.id) || !cell.art.hinges.length) continue
      const nearLeader = distanceSquared(cell, { x: leaderX, z: leaderZ }) <= DANCE_STAGE_DISTANCE_SQUARED
      if (!nearLeader && distanceSquared(cell, follower.position) > DANCE_STAGE_DISTANCE_SQUARED) continue
      cell.staged = true
      if (cell.up) {
        cell.up = false
        cell.lifted = false
        moveCell(cell, 'down', FLAT, now)
        emitFold({ dir: 'down', id: cell.tile.id, i: cell.i, j: cell.j, t: now, cause: 'stage' })
        foldLight?.fold(cell, now)
      } else if (cell.lifted) {
        cell.lifted = false
        moveCell(cell, 'stage', FLAT, now)
      }
    }
  }

  function endDance() {
    for (const cell of visible.values()) cell.staged = false
  }
  const onDanceStart = (event) => stageProps(Number.isFinite(event.detail?.t) ? event.detail.t : lastT)
  events.addEventListener('duo-dance-start', onDanceStart)
  events.addEventListener('duo-dance-end', endDance)

  return {
    ready: art.ready,
    update(dt, t, position, aspect) {
      leaderX = position.x
      leaderZ = position.z
      lastT = t
      const distance = camera ? Math.hypot(camera.position.y, camera.position.z - position.z) : 10
      const framing = camera ? Math.min(distance, camera.far) / (10 * camera.zoom) : 1
      sync(cellAt(position.x), Math.max(6, Math.ceil(3.25 * aspect * framing)), t - dt)
      foldLight?.begin()
      for (let c = 0; c < cells.length; c += 1) {
        const cell = cells[c]
        const { hinges } = cell.art
        if (!hinges.length) continue
        const distance = distanceSquared(cell, position)
        const free = !cell.staged
        const up = free && (cell.up ? distance <= FOLD_DOWN_DISTANCE_SQUARED : distance <= FOLD_UP_DISTANCE_SQUARED)
        const lifted = free && (cell.lifted ? distance <= STAGE_DOWN_DISTANCE_SQUARED : distance <= STAGE_UP_DISTANCE_SQUARED)
        if (up !== cell.up) {
          cell.up = up
          cell.lifted = lifted
          moveCell(cell, up ? 'up' : 'down', up ? UPRIGHT : lifted ? STAGE_ONE : FLAT, t)
          emitFold({ dir: up ? 'up' : 'down', id: cell.tile.id, i: cell.i, j: cell.j, t })
          foldLight?.fold(cell, t)
        } else if (lifted !== cell.lifted) {
          // Stage 1: silent, no fold event, pop, chime or cue.
          cell.lifted = lifted
          moveCell(cell, 'stage', lifted ? STAGE_ONE : FLAT, t)
        }

        for (let h = 0; h < hinges.length; h += 1) {
          const hinge = hinges[h]
          if (isIdle(hinge, t)) continue
          updateHinge(hinge, t, dt)
          if (cell.drawn) art.poseHinge(cell.art, hinge)
        }
        recordTrace(cell, t, hinges[0].angle)
        foldLight?.update(cell, t, distance)
      }
      foldLight?.end(t)
    },
    hingeTrace(id, position) {
      const byCell = visible.get(id)
      if (byCell) return traceSamples(byCell.trace)
      let nearest
      let nearestDistance = Infinity
      for (const cell of visible.values()) {
        if (cell.tile.id !== id || !cell.trace) continue
        const distance = distanceSquared(cell, position)
        if (distance >= nearestDistance) continue
        nearest = cell
        nearestDistance = distance
      }
      return traceSamples(nearest?.trace)
    },
    dispose() {
      events.removeEventListener('duo-dance-start', onDanceStart)
      events.removeEventListener('duo-dance-end', endDance)
    },
    dropRender() {
      if (lastArea === undefined) return
      visible.clear()
      cells.length = 0
      art.begin(0)
      art.end()
      moss?.begin(0)
      moss?.end()
      lanterns?.begin(0)
      lanterns?.end()
      foldLight?.reset()
      lastArea = undefined
    },
  }
}
