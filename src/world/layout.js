import { blocksPoint, cellAt, cellKey, DIRECTIONS, TILE_SIZE, VARIANTS } from './tiles.js'

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
const bridge = tileBit('yarn_bridge')
const dry = maskFor((tile) => !tile.sockets.includes('r'))
const tileMasks = new Map(VARIANTS.map(({ sockets }) => [
  sockets, maskFor((tile) => tile.sockets === sockets),
]))

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
  return { north, south, rows, excursion: shape % 5 < 2, depth: 1 + ((shape >>> 2) & 1) }
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
    const { north, south, rows, excursion } = riverPlan(seed, cx, cz)
    const bend = 3
    trace('r', [[north, -1], [north, bend], [south, bend], [south, CHUNK_SIZE]])

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

function weightedBit(mask, random) {
  let total = 0
  for (let bits = mask; bits; bits &= bits - 1) total += VARIANTS[bitIndex(bits & -bits)].weight
  let draw = random() * total
  for (let bits = mask; bits; bits &= bits - 1) {
    const bit = bits & -bits
    draw -= VARIANTS[bitIndex(bit)].weight
    if (draw < 0) return bit
  }
  return mask & -mask
}

function collapse(initial, random) {
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
      const bit = weightedBit(options, random)
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
  let seed = initialSeed >>> 0

  function generateChunk(cx, cz) {
    const chunkKey = cellKey(cx, cz)
    if (chunks.has(chunkKey)) return chunks.get(chunkKey)
    const startI = cx * CHUNK_SIZE
    const startJ = cz * CHUNK_SIZE
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
      for (const [edge, [di, dj]] of DIRECTIONS.entries()) {
        if (neighbors[edge] >= 0) continue
        const neighbor = generated.get(cellKey(startI + x + di, startJ + z + dj))
        domain &= sockets[edge][edges[edge]]
        if (neighbor) domain &= sockets[edge][neighbor.sockets[opposite(edge)]]
      }
      domains[index] = domain
    }

    let solved
    if (propagate(domains, cells.map((_, index) => index))) {
      for (let attempt = 0; attempt < 3 && !solved; attempt += 1) {
        solved = collapse(domains, randomFrom(hash(seed, cx, cz, attempt)))
      }
    }

    // This layout satisfies the same seams if the search budget runs out.
    const chunk = Array.from(solved ?? fallback, (bit, index) => {
      const { x, z } = cells[index]
      const tile = VARIANTS[bitIndex(bit)]
      generated.set(cellKey(startI + x, startJ + z), tile)
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

  return {
    generateChunk,
    getCell,
    isBlocked(x, z) {
      const i = cellAt(x)
      const j = cellAt(z)
      return blocksPoint(getCell(i, j), x - TILE_SIZE * i, z - TILE_SIZE * j)
    },
    setSeed(value) {
      seed = value >>> 0
      generated.clear()
      chunks.clear()
    },
  }
}
