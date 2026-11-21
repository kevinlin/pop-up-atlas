import { Color, MeshLambertMaterial, SRGBColorSpace, TextureLoader } from 'three'
import { applyCraftMaterial } from '../materials/index.js'

export const palette = {
  pink: 0xf4a6c8, hotPink: 0xe8478f, lavender: 0xb79ae0, sky: 0x7ec8e8,
  mint: 0x9ee0b8, lime: 0xa7d84a, butter: 0xf7dc6f, orange: 0xf59a3c, cream: 0xfff8ec,
}

const paper = new Color(palette.cream)
const palePink = new Color(palette.pink)
export const emitterColors = [palette.butter, palette.mint, palette.hotPink, palette.sky].map((hex) => {
  const color = new Color(hex)
  if (hex === palette.hotPink) {
    color.lerp(palePink, 0.72).lerp(paper, 0.53)
    color.b *= 1.25
    return color
  }
  if (hex === palette.sky) return color.lerp(paper, 0.24)
  if (hex === palette.mint) return color.lerp(paper, 0.12)
  return color
})

const maps = new Map()
export function craft(name, options, patch) {
  const source = new MeshLambertMaterial(options)
  source.name = name
  if (patch) source.onBeforeCompile = patch
  const material = applyCraftMaterial(source)
  if (patch) {
    const baseKey = material.customProgramCacheKey()
    material.customProgramCacheKey = () => `${baseKey}/stage/${name}`
  }
  return material
}

export function craftMap(file) {
  if (typeof document === 'undefined') return null
  if (!maps.has(file)) {
    const url = new URL(`models/tiles/textures/${file}`, document.baseURI).href
    let texture
    const ready = new Promise((resolve) => {
      texture = new TextureLoader().load(url, resolve, undefined, () => resolve(null))
    })
    texture.colorSpace = SRGBColorSpace
    maps.set(file, { texture, ready })
  }
  return maps.get(file).texture
}

export async function warmCraftMaps(renderer) {
  for (const { ready } of maps.values()) {
    const texture = await ready
    if (texture) renderer.initTexture(texture)
  }
}
