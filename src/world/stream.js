import { Frustum, Matrix4, Sphere, Vector3 } from 'three'
import { createArt } from './art.js'
import { createBook } from './book.js'
import { FLAT, HINGE_STAGGER, stepSpring, UPRIGHT } from './spring.js'
import { cellAt, cellKey, FIRST_PAGE_ROW, LAST_PAGE_ROW, TILE_SIZE } from './tiles.js'

// Inside the camera view so folds are seen happening (camera distance 10).
const FOLD_UP_DISTANCE_SQUARED = 3 ** 2
const FOLD_DOWN_DISTANCE_SQUARED = 4.5 ** 2
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

export function createTileStream(scene, layout, emitFold, camera) {
  const art = createArt(scene)
  const placeBook = createBook(scene)
  const visible = new Map()
  const frustum = new Frustum()
  const projection = new Matrix4()
  // Include upright artwork and the camera's travel before the next cell refresh.
  const tileBounds = new Sphere(new Vector3(), 4.25)
  let lastArea
  let lastRevision = -1

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
    art.begin((2 * radiusX + 1) * (LAST_PAGE_ROW - FIRST_PAGE_ROW + 1))
    for (let j = FIRST_PAGE_ROW; j <= LAST_PAGE_ROW; j += 1) {
      for (let i = centerI - radiusX; i <= centerI + radiusX; i += 1) {
        const key = cellKey(i, j)
        let cell = visible.get(key)
        if (!cell) {
          cell = { i, j, x: i * TILE_SIZE, z: j * TILE_SIZE, tile: layout.getCell(i, j), up: false }
          visible.set(key, cell)
        }
        const model = art.modelAt(cell)
        if (!cell.art || cell.art.model !== model) {
          const previous = cell.art
          cell.art = art.create(cell, model)
          for (const [order, hinge] of cell.art.hinges.entries()) {
            const oldHinge = previous?.hinges.find(({ index }) => index === hinge.index)
            hinge.angle = oldHinge?.angle ?? FLAT
            hinge.velocity = oldHinge?.velocity ?? 0
            if (!oldHinge && cell.foldStarted !== undefined) {
              hinge.angle = cell.up ? FLAT : UPRIGHT
              const elapsed = t - cell.foldStarted - order * HINGE_STAGGER
              if (elapsed > 0) stepSpring(hinge, cell.up ? 'up' : 'down', elapsed)
            }
          }
        }
        tileBounds.center.set(cell.x, 0.4, cell.z)
        cell.drawn = !camera || frustum.intersectsSphere(tileBounds)
        if (cell.drawn) art.placeTile(cell)
      }
    }
    art.end()
  }

  function distanceSquared(cell, position) {
    return (cell.x - position.x) ** 2 + (cell.z - position.z) ** 2
  }

  return {
    ready: art.ready,
    update(dt, t, position, aspect) {
      const distance = camera ? Math.hypot(camera.position.y, camera.position.z - position.z) : 10
      const framing = camera ? Math.min(distance, camera.far) / (10 * camera.zoom) : 1
      sync(cellAt(position.x), Math.max(6, Math.ceil(3.25 * aspect * framing)), t - dt)
      for (const cell of visible.values()) {
        if (!cell.art.hinges.length) continue
        const distance = distanceSquared(cell, position)
        const up = cell.up ? distance <= FOLD_DOWN_DISTANCE_SQUARED : distance <= FOLD_UP_DISTANCE_SQUARED
        if (up !== cell.up) {
          cell.up = up
          cell.foldStarted = t
          emitFold({ dir: up ? 'up' : 'down', id: cell.tile.id, i: cell.i, j: cell.j, t })
        }

        const target = up ? UPRIGHT : FLAT
        for (const [order, hinge] of cell.art.hinges.entries()) {
          if (hinge.angle === target && hinge.velocity === 0) continue
          const elapsed = t - cell.foldStarted - order * HINGE_STAGGER
          if (elapsed <= 0) continue
          stepSpring(hinge, up ? 'up' : 'down', Math.min(dt, elapsed))
          if (Math.abs(hinge.angle - target) < 0.0001 && Math.abs(hinge.velocity) < 0.002) {
            hinge.angle = target
            hinge.velocity = 0
          }
          if (cell.drawn) art.poseHinge(cell.art, hinge)
        }
        recordTrace(cell, t, cell.art.hinges[0].angle)
      }
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
    dropRender() {
      if (lastArea === undefined) return
      visible.clear()
      art.begin(0)
      art.end()
      lastArea = undefined
    },
  }
}
