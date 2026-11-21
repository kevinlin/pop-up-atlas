export const TILE_SIZE = 2
export const FIRST_PAGE_ROW = -5
export const LAST_PAGE_ROW = 4
export const PAGE_MIN_Z = (FIRST_PAGE_ROW - 0.5) * TILE_SIZE
export const PAGE_MAX_Z = (LAST_PAGE_ROW + 0.5) * TILE_SIZE
export const GUTTER_INTERVAL = 8
export const RIVER_HALF_WIDTH = 0.36
export const BRIDGE_HALF_WIDTH = 0.32
const RIVER_BEND_RADIUS = 0.43

export const TILES = [
  { id: 'meadow', sockets: 'gggg', walkable: true, rotations: 1, weight: 9 },
  { id: 'flower', sockets: 'gggg', walkable: true, rotations: 4, weight: 3, blockedRadius: 0.8 },
  { id: 'mushroom_house', sockets: 'gggg', walkable: true, rotations: 4, weight: 2, blockedRadius: 0.9 },
  { id: 'cupcake_tree', sockets: 'gggg', walkable: true, rotations: 4, weight: 3, blockedRadius: 0.7 },
  { id: 'path_straight', sockets: 'pgpg', walkable: true, rotations: 2, weight: 0.5 },
  { id: 'path_corner', sockets: 'ppgg', walkable: true, rotations: 4, weight: 0.25 },
  { id: 'river_straight', sockets: 'rgrg', walkable: false, rotations: 2, weight: 0.4 },
  { id: 'river_corner', sockets: 'rrgg', walkable: false, rotations: 4, weight: 0.25 },
  { id: 'yarn_bridge', sockets: 'rprp', walkable: true, rotations: 2, weight: 0.3 },
]

export const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]

export const VARIANTS = TILES.flatMap((tile) => {
  const rotations = tile.sockets === 'gggg' ? 1 : tile.rotations
  return Array.from({ length: rotations }, (_, rotation) => ({
    ...tile,
    rotation,
    sockets: DIRECTIONS.map((_, edge) => tile.sockets[(edge + rotation) % 4]).join(''),
    weight: tile.weight / rotations,
  }))
})

export const cellAt = (position) => Math.floor(position / TILE_SIZE + 0.5)
export const cellKey = (i, j) => `${i},${j}`

export function blocksPoint(tile, x, z) {
  if (tile.blockedRadius) {
    return (x - (tile.offsetX ?? 0)) ** 2 + (z - (tile.offsetZ ?? 0)) ** 2 <= tile.blockedRadius ** 2
  }

  const localX = tile.rotation === 1 ? -z : x
  const localZ = tile.rotation === 1 ? x : z
  switch (tile.id) {
    case 'river_straight':
      return Math.abs(localX) <= RIVER_HALF_WIDTH
    case 'yarn_bridge':
      return Math.abs(localX) <= RIVER_HALF_WIDTH && Math.abs(localZ) > BRIDGE_HALF_WIDTH
    case 'river_corner': {
      const [u, v] = [[x, z], [-z, x], [-x, -z], [z, -x]][tile.rotation]
      if (v <= -RIVER_BEND_RADIUS) return Math.abs(u) <= RIVER_HALF_WIDTH
      if (u >= RIVER_BEND_RADIUS) return Math.abs(v) <= RIVER_HALF_WIDTH
      const radius = Math.hypot(u - RIVER_BEND_RADIUS, v + RIVER_BEND_RADIUS)
      return Math.abs(radius - RIVER_BEND_RADIUS) <= RIVER_HALF_WIDTH
    }
    default:
      return false
  }
}
