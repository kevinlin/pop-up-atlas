import { Scene } from 'three'
import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE, createLayout } from '../src/world/layout.js'
import { createTileStream } from '../src/world/stream.js'
import { blocksPoint, cellKey, DIRECTIONS, VARIANTS } from '../src/world/tiles.js'

const seeds = Array.from({ length: 20 }, (_, seed) => seed)
const chunks = Array.from({ length: 36 }, (_, i) => [i % 6 - 3, Math.floor(i / 6) - 3])
const lowestCell = -3 * CHUNK_SIZE
const highestCell = 3 * CHUNK_SIZE - 1

function shuffled(seed) {
  const order = chunks.slice()
  let state = seed + 1
  for (let i = order.length - 1; i > 0; i -= 1) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    const j = state % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

function snapshot(layout, min, max, checkSeams = false) {
  const result = []
  for (let j = min; j <= max; j += 1) {
    for (let i = min; i <= max; i += 1) {
      const tile = layout.getCell(i, j)
      result.push(`${tile.id}:${tile.rotation}`)
      if (!checkSeams) continue
      if (i < max) expect(tile.sockets[1]).toBe(layout.getCell(i + 1, j).sockets[3])
      if (j < max) expect(tile.sockets[2]).toBe(layout.getCell(i, j + 1).sockets[0])
    }
  }
  return result
}

function walkableArea(layout, limit) {
  const queue = [[0, 0]]
  const visited = new Set([cellKey(0, 0)])

  for (let i = 0; i < queue.length; i += 1) {
    const [x, z] = queue[i]
    const here = layout.getCell(x, z)
    for (const [edge, [dx, dz]] of DIRECTIONS.entries()) {
      const xd = x + dx
      const zd = z + dz
      const key = cellKey(xd, zd)
      if (Math.max(Math.abs(xd), Math.abs(zd)) > limit) continue
      if (here.sockets[edge] === 'r' || visited.has(key) || !layout.getCell(xd, zd).walkable) continue
      visited.add(key)
      queue.push([xd, zd])
    }
  }
  return { queue, visited }
}

function checkRiverCrossings(layout, { queue, visited }, limit) {
  const checked = new Set()
  for (const [x, z] of queue) {
    for (const [dx, dz] of DIRECTIONS) {
      const i = x + dx
      const j = z + dz
      if (Math.max(Math.abs(i), Math.abs(j)) > limit || checked.has(cellKey(i, j))) continue
      if (!layout.getCell(i, j).sockets.includes('r')) continue
      const river = [[i, j]]
      checked.add(cellKey(i, j))
      let reachableBridge = false

      for (const [u, v] of river) {
        const tile = layout.getCell(u, v)
        if (tile.id === 'yarn_bridge' && visited.has(cellKey(u, v))) {
          const [dx, dz] = DIRECTIONS[tile.sockets.indexOf('p')]
          expect(visited.has(cellKey(u + dx, v + dz))).toBe(true)
          expect(visited.has(cellKey(u - dx, v - dz))).toBe(true)
          for (let step = -1; step <= 1; step += 0.125) {
            expect(layout.isBlocked(2 * u + step * dx, 2 * v + step * dz)).toBe(false)
          }
          reachableBridge = true
        }
        for (const [edge, [dx, dz]] of DIRECTIONS.entries()) {
          if (tile.sockets[edge] !== 'r') continue
          const [nextI, nextJ] = [u + dx, v + dz]
          const key = cellKey(nextI, nextJ)
          if (Math.max(Math.abs(nextI), Math.abs(nextJ)) > limit || checked.has(key)) continue
          checked.add(key)
          river.push([nextI, nextJ])
        }
      }

      expect(reachableBridge).toBe(true)
    }
  }
}

describe('atlas layout', () => {
  it.each(seeds)('matches every adjacent socket across three shuffled chunk orders for seed %i', (seed) => {
    const results = [0, 1, 2].map((order) => {
      const layout = createLayout(seed)
      for (const [i, j] of shuffled(seed * 3 + order)) layout.generateChunk(i, j)
      return snapshot(layout, lowestCell, highestCell, true)
    })
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    expect(new Set(results[0].map((tile) => tile.split(':')[0])).size).toBe(9)
  })

  it('keeps generated tiles when render state is dropped and rebuilt', () => {
    const layout = createLayout(42)
    const stream = createTileStream(new Scene(), layout, () => {})
    const origin = { x: 0, z: 0 }
    stream.update(0, 0, origin, 16 / 9)
    const tile = layout.getCell(0, 1)
    expect(stream.hingeTrace('0,1', origin)).toHaveLength(1)
    const first = snapshot(layout, -6, 6)
    stream.dropRender()
    expect(stream.hingeTrace('0,1', origin)).toEqual([])
    stream.update(0.016, 0.016, { x: -120, z: 74 }, 16 / 9)
    stream.update(0.016, 0.032, origin, 16 / 9)
    expect(layout.getCell(0, 1)).toBe(tile)
    expect(stream.hingeTrace('0,1', origin)).toHaveLength(1)
    expect(snapshot(layout, -6, 6)).toEqual(first)
  })

  it('resets the layout from the requested seed', () => {
    const layout = createLayout(0)
    const first = snapshot(layout, -8, 8)
    layout.setSeed(1)
    expect(snapshot(layout, -8, 8)).not.toEqual(first)
    layout.setSeed(0)
    expect(snapshot(layout, -8, 8)).toEqual(first)
  })

  it.each(seeds)('can walk from origin to Chebyshev radius 40 for seed %i', (seed) => {
    const layout = createLayout(seed)
    expect(layout.isBlocked(0, 0)).toBe(false)
    expect(layout.getCell(0, 0).walkable).toBe(true)
    const area = walkableArea(layout, 40)
    expect(area.queue.some(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) === 40)).toBe(true)
    checkRiverCrossings(layout, area, 40)
  })

  it.each(seeds)('keeps features sparse in a 64×64 area for seed %i', (seed) => {
    const layout = createLayout(seed)
    const riverColumns = new Set()
    const counts = { grass: 0, path: 0, river: 0, bridge: 0 }
    for (let j = -32; j < 32; j += 1) {
      for (let i = -32; i < 32; i += 1) {
        const { id, sockets } = layout.getCell(i, j)
        if (sockets === 'gggg') counts.grass += 1
        else if (id === 'yarn_bridge') counts.bridge += 1
        else if (id.startsWith('river_')) counts.river += 1
        else if (id.startsWith('path_')) counts.path += 1
        if (j % CHUNK_SIZE === 0 && sockets[0] === 'r') riverColumns.add(Math.floor(i / CHUNK_SIZE))
      }
    }
    const size = 64 ** 2
    expect(counts.grass / size).toBeGreaterThanOrEqual(0.70)
    expect(counts.path / size).toBeLessThanOrEqual(0.15)
    expect((counts.river + counts.bridge) / size).toBeLessThanOrEqual(0.10)
    expect(riverColumns.size / (64 / CHUNK_SIZE)).toBeLessThanOrEqual(1 / 3)
    expect(counts.bridge / (counts.river + counts.bridge)).toBeGreaterThanOrEqual(2 / 8)
  })

  it('blocks river bands and prop centres, with a clear bridge deck in both rotations', () => {
    const tile = (id, rotation = 0) => VARIANTS.find((v) => v.id === id && v.rotation === rotation)

    for (const { id, blockedRadius } of VARIANTS.filter((v) => v.blockedRadius && v.rotation === 0)) {
      expect(blocksPoint(tile(id), 0, 0)).toBe(true)
      expect(blocksPoint(tile(id), blockedRadius + 0.01, 0)).toBe(false)
    }

    expect(blocksPoint(tile('river_straight'), 0.2, 0.9)).toBe(true)
    expect(blocksPoint(tile('river_straight'), 0.7, 0)).toBe(false)
    expect(blocksPoint(tile('river_straight', 1), 0.9, -0.2)).toBe(true)
    expect(blocksPoint(tile('river_corner', 3), 0.9, 0)).toBe(true)
    expect(blocksPoint(tile('river_corner', 3), 0, 0.9)).toBe(true)
    expect(blocksPoint(tile('river_corner', 3), -0.9, 0)).toBe(false)
    expect(blocksPoint(tile('river_corner'), -0.30, 0.30)).toBe(false)
    expect(blocksPoint(tile('yarn_bridge'), 0.2, 0.2)).toBe(false)
    expect(blocksPoint(tile('yarn_bridge'), 0.2, 0.8)).toBe(true)
    expect(blocksPoint(tile('yarn_bridge', 1), 0.2, -0.2)).toBe(false)
    expect(blocksPoint(tile('yarn_bridge', 1), 0.8, -0.2)).toBe(true)
  })
})
