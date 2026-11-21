import { hash } from '../world/hash.js'

const HUE_MIX = 0.12
const VALUE_MIX = 0.11
const LANE_MAX = 65535
const SALT = 11

export function cellJitter(i, j) {
  const bits = hash(0, i + 137, j - 211, SALT)
  return {
    hue: (2 * (bits & LANE_MAX) / LANE_MAX - 1) * HUE_MIX,
    value: 1 + (2 * (bits >>> 16) / LANE_MAX - 1) * VALUE_MIX,
  }
}

// The tile batches already carry their cell origin in instanceMatrix.
// Mirror world/hash.js so the CPU and shader use the same cell address and lanes.
export const cellJitterGLSL = /* glsl */ `
vec2 craftCellJitter(ivec2 cell) {
  cell += ivec2(137, -211);
  uint h = uint(cell.x) * 0x9e3779b1u ^ uint(cell.y) * 0x85ebca77u ^ ${SALT}u * 0xc2b2ae3du;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  h ^= h >> 16u;
  vec2 lanes = vec2(float(h & ${LANE_MAX}u), float(h >> 16u)) * (2.0 / ${LANE_MAX}.0) - 1.0;
  return vec2(lanes.x * ${HUE_MIX}, 1.0 + lanes.y * ${VALUE_MIX});
}
`
