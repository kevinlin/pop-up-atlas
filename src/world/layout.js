import {
  blocksPoint, cellAt, cellKey, DIRECTIONS, FIRST_PAGE_ROW, HERO_SCALE, HERO_SHIFT,
  LAST_PAGE_ROW, PAGE_MAX_Z, PAGE_MIN_Z, TILES, TILE_SIZE, VARIANTS,
} from './tiles.js'

import { hash } from './hash.js'

export const CHUNK_SIZE = 8

const CELL_COUNT = CHUNK_SIZE ** 2
const opposite = (edge) => (edge + 2) % 4
const bitIndex = (bit) => 31 - Math.clz32(bit)
const maskFor = (matches) => VARIANTS.reduce((mask, tile, index) =>
  matches(tile) ? mask | (1 << index) : mask, 0)
const tileBit = (id, rotation = 0) => maskFor((tile) => tile.id === id && tile.rotation === rotation)

const sockets = DIRECTIONS.map((_, edge) => ({
  g: maskFor((tile) => tile.sockets[edge] === 'g'),
  p: maskFor((tile) => tile.sockets[edge] === 'p'),
  r: maskFor((tile) => tile.sockets[edge] === 'r'),
}))
const meadow = tileBit('meadow')
const grass = maskFor((tile) => tile.sockets === 'gggg')
const bridge = tileBit('yarn_bridge')
const dry = maskFor((tile) => !tile.sockets.includes('r'))
const tileMasks = new Map(VARIANTS.map(({ sockets }) => [
  sockets, maskFor((tile) => tile.sockets === sockets),
]))

const ZONE_SIZE = 8
export const ZONE_KEYS = Object.freeze(['green-gold', 'amber', 'pink-lavender', 'teal'])
const zoneSeeds = new WeakMap()
const riverCornerWeight = TILES.find(({ id }) => id === 'river_corner').weight
const riverStraightWeight = TILES.find(({ id }) => id === 'river_straight').weight
const meanderChance = riverCornerWeight / (riverCornerWeight + riverStraightWeight)
const maxPropReach = Math.max(...TILES.map(({ blockedRadius }) => blockedRadius ?? 0)) * HERO_SCALE[1] + HERO_SHIFT
const meadowWeight = VARIANTS[bitIndex(meadow)].weight
const grassWeight = VARIANTS.filter((tile) => tile.sockets === 'gggg').reduce((sum, tile) => sum + tile.weight, 0)
const [clearingWeights, groveWeights, trailWeights] = [0.12, 0.76, 0.97].map((propShare) => VARIANTS.map((tile) => {
  // Keep total grass weight constant so the path and river mix stays within its existing bounds.
  if (tile.id === 'meadow') return grassWeight * (1 - propShare)
  if (tile.blockedRadius) return grassWeight * propShare * tile.weight / (grassWeight - meadowWeight)
  return tile.weight
}))

const zoneU = (seed, i, j) => (i + (hash(seed, 0, 0, 13) % ZONE_SIZE) + 1.6 * Math.sin(j / 2.9)) / ZONE_SIZE
const zoneV = (seed, i, j) => (j + (hash(seed, 0, 0, 14) % ZONE_SIZE) + 1.6 * Math.sin(i / 3.1)) / ZONE_SIZE

function zoneAt(seed, i, j) {
  return (Math.floor(zoneU(seed, i, j)) + Math.floor(zoneV(seed, i, j)) + hash(seed, 0, 0, 15)) & 1
}

function keyIndex(seed, u, v) {
  const roll = hash(seed, u, v, 22) % 12
  return roll < 6 ? 0 : 1 + (roll - 6) % 3
}

export function zoneKeyAt(seed, i, j) {
  return ZONE_KEYS[keyIndex(seed, Math.floor(zoneU(seed, i, j)), Math.floor(zoneV(seed, i, j)))]
}

const seamWeight = (coordinate, seam) => {
  const t = Math.min(1, Math.max(0, (coordinate - seam) * ZONE_SIZE / 2 + 0.5))
  return t * t * (3 - 2 * t)
}

// Coordinates are in cell units. Blend the four neighbors at a warped zone corner.
export function zoneBlendAt(seed, i, j, weights) {
  const u = zoneU(seed, i, j), v = zoneV(seed, i, j)
  const a = Math.round(u), b = Math.round(v)
  const x = seamWeight(u, a), y = seamWeight(v, b)
  weights.fill(0)
  weights[keyIndex(seed, a - 1, b - 1)] += (1 - x) * (1 - y)
  weights[keyIndex(seed, a, b - 1)] += x * (1 - y)
  weights[keyIndex(seed, a - 1, b)] += (1 - x) * y
  weights[keyIndex(seed, a, b)] += x * y
  return weights
}

export const zoneSeedFor = (isBlocked) => zoneSeeds.get(isBlocked)?.() ?? 0

const cells = Array.from({ length: CELL_COUNT }, (_, index) => {
  const x = index % CHUNK_SIZE
  const z = Math.floor(index / CHUNK_SIZE)
  const neighbors = DIRECTIONS.map(([di, dj]) => {
    const u = x + di
    const v = z + dj
    return u >= 0 && u < CHUNK_SIZE && v >= 0 && v < CHUNK_SIZE ? u + v * CHUNK_SIZE : -1
  })
  return { x, z, neighbors }
})

function hasRiver(seed, cx) {
  // Use the middle of each five-column group to leave at least three dry columns between rivers.
  const group = Math.floor(cx / 5)
  return cx === group * 5 + 1 + hash(seed, group, 0, 1) % 2
}

function riverSeam(seed, cx, cz) {
  const flip = hash(seed, cx, Math.floor(cz / 2), 2) & 1
  return 3 + (flip ^ (cz & 1))
}

function riverPlan(seed, cx, cz) {
  const north = riverSeam(seed, cx, cz)
  const south = riverSeam(seed, cx, cz + 1)
  const shape = hash(seed, cx, cz, 3)
  const rows = [1 + (shape & 1), 5 + ((shape >>> 1) & 1)]
  if (north !== south) rows.splice(1, 1, 4, 6)
  const meander = hash(seed, cx, cz, 19) / 0x100000000 < meanderChance
  // Turn between the crossings so each bridge still lands on a straight reach.
  const bends = north === south
    ? (meander ? [rows[0] + 1, rows[1] - 1] : [])
    : (meander ? [3, 5, 7] : [3])
  return { north, south, rows, bends, excursion: shape % 5 < 2, depth: 1 + ((shape >>> 2) & 1) }
}

function featureSockets(seed, cx, cz) {
  const features = cells.map(() => ['g', 'g', 'g', 'g'])
  const inside = (x, z) => x >= 0 && z >= 0 && x < CHUNK_SIZE && z < CHUNK_SIZE

  function trace(socket, points) {
    let [x, z] = points[0]
    for (const [endX, endZ] of points.slice(1)) {
      const dx = Math.sign(endX - x)
      const dz = Math.sign(endZ - z)
      const side = dx > 0 ? 1 : dx < 0 ? 3 : dz > 0 ? 2 : 0
      while (x !== endX || z !== endZ) {
        if (inside(x, z)) features[z * CHUNK_SIZE + x][side] = socket
        x += dx
        z += dz
        if (inside(x, z)) features[z * CHUNK_SIZE + x][opposite(side)] = socket
      }
    }
  }

  const bank = (seam) => seam === 3 ? 1 : 6
  if (hasRiver(seed, cx)) {
    const { north, south, rows, bends, excursion } = riverPlan(seed, cx, cz)
    const river = [[north, -1]]
    let channel = north
    for (const row of bends) {
      river.push([channel, row], [CHUNK_SIZE - 1 - channel, row])
      channel = CHUNK_SIZE - 1 - channel
    }
    river.push([south, CHUNK_SIZE])
    trace('r', river)

    // The bank trail crosses twice on straight runs and three times when it changes banks.
    let from = bank(north)
    const trail = [[from, -1]]
    for (const [index, row] of rows.entries()) {
      const to = CHUNK_SIZE - 1 - from
      trail.push([from, row], [to, row])
      if (index === 0 && excursion) {
        const outer = to === 1 ? -1 : CHUNK_SIZE
        trail.push([outer, row], [outer, rows[1]], [to, rows[1]])
      }
      from = to
    }
    trail.push([from, CHUNK_SIZE])
    trace('p', trail)
  } else {
    // A neighboring bank trail can leave and reenter its river chunk through two shared ports.
    for (const side of [-1, 1]) {
      const neighbor = cx + side
      if (!hasRiver(seed, neighbor)) continue
      const { north, rows: [first, second], excursion, depth } = riverPlan(seed, neighbor, cz)
      if (!excursion || (north === 3 ? -1 : 1) !== side) continue
      const outer = side === -1 ? -1 : CHUNK_SIZE
      const turn = outer - side * (depth + 1)
      trace('p', [[outer, first], [turn, first], [turn, second], [outer, second]])
    }
  }
  return features
}

function randomFrom(seed) {
  let state = seed
  return () => {
    state = (state + 0x9e3779b9) >>> 0
    return hash(state, 0, 0) / 0x100000000
  }
}

function propagate(domains, queue) {
  while (queue.length) {
    const index = queue.pop()
    const domain = domains[index]
    const { neighbors } = cells[index]
    for (let edge = 0; edge < 4; edge += 1) {
      const neighbor = neighbors[edge]
      if (neighbor < 0) continue
      const here = sockets[edge]
      const there = sockets[opposite(edge)]
      const allowed = ((domain & here.g) ? there.g : 0)
        | ((domain & here.p) ? there.p : 0)
        | ((domain & here.r) ? there.r : 0)
      const next = domains[neighbor] & allowed
      if (next === 0) return false
      if (next !== domains[neighbor]) {
        domains[neighbor] = next
        queue.push(neighbor)
      }
    }
  }
  return true
}

function weightedBit(mask, random, weights) {
  let total = 0
  for (let bits = mask; bits; bits &= bits - 1) total += weights[bitIndex(bits & -bits)]
  let draw = random() * total
  for (let bits = mask; bits; bits &= bits - 1) {
    const bit = bits & -bits
    draw -= weights[bitIndex(bit)]
    if (draw < 0) return bit
  }
  return mask & -mask
}

function collapse(initial, random, zones) {
  const offset = Math.floor(random() * CELL_COUNT)
  let remainingBacktracks = 48

  function search(domains) {
    let best = -1
    let smallest = VARIANTS.length + 1
    for (let step = 0; step < CELL_COUNT; step += 1) {
      const index = (offset + step) % CELL_COUNT
      let count = 0
      for (let bits = domains[index]; bits; bits &= bits - 1) count += 1
      if (count > 1 && count < smallest) {
        smallest = count
        best = index
        if (count === 2) break
      }
    }
    if (best === -1) return domains

    let options = domains[best]
    while (options && remainingBacktracks > 0) {
      const bit = weightedBit(options, random, zones[best] ? groveWeights : clearingWeights)
      const branch = domains.slice()
      branch[best] = bit
      const solved = propagate(branch, [best]) && search(branch)
      if (solved) return solved
      remainingBacktracks -= 1
      options ^= bit
    }
    return null
  }

  return search(initial)
}

export function createLayout(initialSeed = 0) {
  const generated = new Map()
  const chunks = new Map()
  const solutions = new Map()
  let seed = initialSeed >>> 0

  function solveChunk(cx, cz) {
    const chunkKey = cellKey(cx, cz)
    if (solutions.has(chunkKey)) return solutions.get(chunkKey)
    const startI = cx * CHUNK_SIZE
    const startJ = cz * CHUNK_SIZE
    const zones = cells.map(({ x, z }) => zoneAt(seed, startI + x, startJ + z))
    const features = featureSockets(seed, cx, cz)
    const riverChunk = hasRiver(seed, cx)
    const localPaths = !riverChunk && hash(seed, cx, cz, 4) % 5 === 0
    const extraCrossings = riverChunk && hash(seed, cx, cz, 5) % 4 === 0
    const domains = new Int32Array(CELL_COUNT)
    const fallback = new Int32Array(CELL_COUNT)
    for (const { x, z, neighbors } of cells) {
      const index = x + z * CHUNK_SIZE
      const edges = features[index]
      const signature = edges.join('')
      const fixed = tileMasks.get(signature)
      fallback[index] = fixed & -fixed
      let domain = fixed
      const nearRiver = extraCrossings && neighbors.some((neighbor) => features[neighbor]?.includes('r'))
      if (signature === 'gggg' && (localPaths || nearRiver)) {
        domain = dry
      }
      if (signature === 'rgrg' && extraCrossings) domain |= bridge
      if (cx === 0 && x === 0) domain &= meadow
      for (let edge = 0; edge < neighbors.length; edge += 1) {
        if (neighbors[edge] >= 0) continue
        domain &= sockets[edge][edges[edge]]
      }
      domains[index] = domain
    }

    let solved
    if (propagate(domains, cells.map((_, index) => index))) {
      for (let attempt = 0; attempt < 3 && !solved; attempt += 1) {
        solved = collapse(domains, randomFrom(hash(seed, cx, cz, attempt)), zones)
      }
    }

    // This layout satisfies the same seams if the search budget runs out.
    const result = { bits: solved ?? fallback, zones }
    solutions.set(chunkKey, result)
    return result
  }

  function trailSide(i, j) {
    return DIRECTIONS.find(([di, dj]) => {
      const x = i + di
      const z = j + dj
      if (z < FIRST_PAGE_ROW || z > LAST_PAGE_ROW) return false
      const cx = Math.floor(x / CHUNK_SIZE)
      const cz = Math.floor(z / CHUNK_SIZE)
      const { bits } = solveChunk(cx, cz)
      const index = x - cx * CHUNK_SIZE + (z - cz * CHUNK_SIZE) * CHUNK_SIZE
      return VARIANTS[bitIndex(bits[index])].sockets.includes('p')
    })
  }

  function generateChunk(cx, cz) {
    const chunkKey = cellKey(cx, cz)
    if (chunks.has(chunkKey)) return chunks.get(chunkKey)
    const { bits, zones } = solveChunk(cx, cz)
    const chunk = Array.from(bits, (bit, index) => {
      const { x, z } = cells[index]
      const i = cx * CHUNK_SIZE + x
      const j = cz * CHUNK_SIZE + z
      const grove = zones[index] === 1
      // Bias the interchangeable grass tiles after solving so paths across chunk seams count too.
      const trail = grove && (bit & grass) && i !== 0 && j >= FIRST_PAGE_ROW && j <= LAST_PAGE_ROW && trailSide(i, j)
      if (trail) bit = weightedBit(grass, () => hash(seed, i, j, 20) / 0x100000000, trailWeights)
      const variant = VARIANTS[bitIndex(bit)]
      const unit = hash(seed, i, j, 16) / 0xffffffff
      const hero = Boolean(trail && variant.blockedRadius)
      const tile = { ...variant, zone: grove ? 'grove' : 'clearing', scale: 1, hero }
      if (tile.id === 'river_straight') tile.wideRiver = hash(seed, i, j, 21) % 4 === 0
      if (tile.blockedRadius) {
        tile.scale = hero ? HERO_SCALE[0] + (HERO_SCALE[1] - HERO_SCALE[0]) * unit
          : 0.36 + (grove ? 0.72 : 0.22) * unit
        tile.blockedRadius *= tile.scale
      }
      if (hero) {
        tile.offsetX = -trail[0] * HERO_SHIFT
        tile.offsetZ = -trail[1] * HERO_SHIFT
      } else if (grove && tile.blockedRadius) {
        // The whole collision disc stays inside its own cell so the edge corridors stay clear.
        const inset = Math.min(0.28, TILE_SIZE / 2 - tile.blockedRadius - 0.025)
        tile.offsetX = inset * (2 * hash(seed, i, j, 17) / 0xffffffff - 1)
        tile.offsetZ = inset * (2 * hash(seed, i, j, 18) / 0xffffffff - 1)
      }
      generated.set(cellKey(i, j), tile)
      return tile
    })
    chunks.set(chunkKey, chunk)
    return chunk
  }

  function getCell(i, j) {
    const key = cellKey(i, j)
    if (!generated.has(key)) generateChunk(Math.floor(i / CHUNK_SIZE), Math.floor(j / CHUNK_SIZE))
    return generated.get(key)
  }

  function blockedBy(x, z) {
    if (z < PAGE_MIN_Z || z > PAGE_MAX_Z) return 'edge'
    const i = cellAt(x)
    const j = Math.min(LAST_PAGE_ROW, cellAt(z))
    const cell = getCell(i, j)
    if (blocksPoint(cell, x - TILE_SIZE * i, z - TILE_SIZE * j)) return cell.blockedRadius ? 'prop' : 'river'

    // Hero cutouts can extend into another cell. Ordinary props stay inside their own cell.
    for (let row = Math.max(FIRST_PAGE_ROW, j - 1); row <= Math.min(LAST_PAGE_ROW, j + 1); row += 1) {
      const dz = z - TILE_SIZE * row
      if (Math.abs(dz) > maxPropReach) continue
      for (let column = i - 1; column <= i + 1; column += 1) {
        const dx = x - TILE_SIZE * column
        if ((column === i && row === j) || Math.abs(dx) > maxPropReach) continue
        const tile = getCell(column, row)
        if (tile.hero && blocksPoint(tile, dx, dz)) return 'prop'
      }
    }
    return null
  }

  const isBlocked = (x, z) => Boolean(blockedBy(x, z))
  // The renderer can read the active layout's seed through the existing world binding.
  zoneSeeds.set(isBlocked, () => seed)
  return {
    generateChunk,
    getCell,
    blockedBy,
    isBlocked,
    zoneKeyAt: (i, j) => zoneKeyAt(seed, i, j),
    setSeed(value) {
      seed = value >>> 0
      generated.clear()
      chunks.clear()
      solutions.clear()
    },
  }
}
