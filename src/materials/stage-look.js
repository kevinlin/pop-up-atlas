import { Color, Vector3 } from 'three'
import { stage as effects } from '../effects/flags.js'
import { zoneBlendAt, zoneSeedFor } from '../world/layout.js'
import { hash } from '../world/hash.js'
import { TILE_SIZE } from '../world/tiles.js'
import { isBlocked } from '../scene/runtime.js'

const query = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
// Shipped look (owner decision 2026-11-22): round-3 light and grade plus emissive-only bloom for the accents. The
// other layers made the book mushy; ?lookOff= (empty) turns the full round-4 stage back on.
export const DEFAULT_LOOK_OFF = 'grade,backlight,bounce,zones,haze,backdrop,dapple'

export function lookFlags(search = '') {
  const disabled = new Set((new URLSearchParams(search).get('lookOff') ?? DEFAULT_LOOK_OFF).split(','))
  return Object.freeze(Object.fromEntries(
    ['grade', 'backlight', 'bounce', 'zones', 'haze', 'backdrop', 'dapple', 'bloom'].map((name) => [name, !disabled.has(name)]),
  ))
}
export const look = lookFlags(query.toString())
export const referenceExposure = 1.35
export const stageExposure = look.grade ? 0.76 : referenceExposure
export const trollSurfaces = { hair: 0.1, body: 0.3 }
export const surfaceBuffer = look.bloom || look.bounce || look.backlight || look.grade || look.zones || look.haze
  || effects.fronds || effects.response
  || effects.lanterns || query.has('look-probe')

// Prop pigments come from the craft palette. Haze and light are measured grade targets.
const propPigments = [0xa7d84a, 0xf59a3c, 0xf4a6c8, 0x9ee0b8].map((hex) => new Color(hex))
const zoneGrades = [
  [1.02, 1.05, 0.83],
  [1.16, 1.00, 0.82],
  [1.10, 0.90, 1.12],
  [0.83, 1.07, 1.08],
].map((rgb) => new Vector3(...rgb))
const hazeColors = [0xe9f0c0, 0xf6de9a, 0xf2d0da, 0xe9f0c0].map((hex) => new Color(hex))
const weights = [0, 0, 0, 0]
export const stage = {
  seed: { value: 0 },
  warp: { value: new Vector3() },
  propPigments: { value: propPigments },
  gain: { value: new Vector3(1, 1, 1) },
  haze: { value: new Color() },
  mossFill: { value: 0.20 },
}

let previousSeed
export function updateStage(position) {
  const seed = zoneSeedFor(isBlocked)
  if (seed !== previousSeed) {
    stage.seed.value = seed
    stage.warp.value.set(hash(seed, 0, 0, 13) % 8, hash(seed, 0, 0, 14) % 8, hash(seed, 0, 0, 15) & 1)
    previousSeed = seed
  }

  zoneBlendAt(seed, position.x / TILE_SIZE, position.z / TILE_SIZE, weights)
  stage.mossFill.value = 0.207 - (look.zones ? 0.039 * weights[1] : 0)
  if (look.zones) {
    stage.gain.value.set(0, 0, 0)
    for (const [index, weight] of weights.entries()) stage.gain.value.addScaledVector(zoneGrades[index], weight)
  }
  stage.haze.value.setRGB(0, 0, 0)
  for (const [index, weight] of weights.entries()) {
    const color = hazeColors[index]
    stage.haze.value.r += color.r * weight
    stage.haze.value.g += color.g * weight
    stage.haze.value.b += color.b * weight
  }
  return weights[2]
}
