import { hash } from '../world/hash.js'
import { FIRST_PAGE_ROW, LAST_PAGE_ROW, TILE_SIZE } from '../world/tiles.js'

export const MOTE_COUNT = 125
const supports = [[1, 0], [1, -1], [0, -1], [2, 0], [2, -1], [1, 1]]
export const unit = (seed, x, z, salt) => hash(seed, x, z, salt) / 0x100000000

export function motePlacements(seed) {
  return Array.from({ length: MOTE_COUNT }, (_, i) => {
    const sample = (salt) => unit(seed, i, 10, salt)
    const x = (i % 25 + sample(1)) / 25
    const y = (Math.floor(i / 25) + sample(2)) / 5
    return {
      x,
      y: i % 4 === 3 ? y : 0.31 + 0.38 * y,
      size: 2.5 + 2.5 * sample(3),
      alpha: 0.20 + 0.30 * sample(4),
      depth: sample(5),
      speed: 0.05 + 0.15 * sample(6),
      twinkle: i % 5 === seed % 5,
      phase: 2 * Math.PI * sample(7),
    }
  })
}

export function placeLantern(layout, i, j) {
  if (j === LAST_PAGE_ROW) {
    // Short spans along the near lip keep the stalks away from the bridge entrances.
    if (i % 2 === 0 || ![-1, 0, 1].some((di) => layout.getCell(i + di, j).zone === 'grove')) return
    const salt = Math.floor(layout.getCell(i, j).scale * 0x100000)
    const x = i * TILE_SIZE
    const z = j * TILE_SIZE + 0.55
    return {
      endI: i + 1, endJ: j, x: x - 0.90, z, endX: x + 0.90, endZ: z,
      height: 1.10 + 0.20 * unit(salt, i, j, 31), color: hash(salt, i, j, 32) % 4,
      yaw: (unit(salt, i, j, 33) - 0.5) * 1.4, double: true,
    }
  }
  if ((i + 2 * j) % 3 !== 0) return
  const from = layout.getCell(i, j)
  if (from.zone !== 'grove' || !from.blockedRadius) return
  const signature = Math.floor(from.scale * 0x100000)
  const x = i * TILE_SIZE + (from.offsetX ?? 0)
  const z = j * TILE_SIZE + (from.offsetZ ?? 0)
  for (const [di, dj] of supports) {
    const endI = i + di
    const endJ = j + dj
    if (endJ <= FIRST_PAGE_ROW || endJ >= LAST_PAGE_ROW) continue
    const to = layout.getCell(endI, endJ)
    if (to.zone !== 'grove' || !to.blockedRadius) continue
    return {
      endI, endJ, x, z,
      endX: endI * TILE_SIZE + (to.offsetX ?? 0),
      endZ: endJ * TILE_SIZE + (to.offsetZ ?? 0),
      height: 1.2 + 0.47 * unit(signature, i, j, 31),
      color: hash(signature, i, j, 32) % 4,
      yaw: (unit(signature, i, j, 33) - 0.5) * 1.4,
    }
  }
}
