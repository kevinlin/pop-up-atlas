import { Material, MeshLambertMaterial } from 'three'
import { TILE_SIZE } from '../world/tiles.js'
import { cellJitterGLSL } from './cell-jitter.js'
import { glitterGLSL, glitterLights } from './glitter.js'
import { stitchGLSL } from './stitch.js'

const query = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
const plain = query.has('plain')
if (query.has('look-shots')) void import('./look-preview.js')
const flatMaterials = new WeakMap()
const hingeMaterials = new WeakMap()

function extendShader(shader, { fibre, glitter, largeFlakes, contact, stitch }) {
  let vertexHeader = ''
  let vertex = ''
  let fragmentHeader = ''
  let albedo = ''
  let bump = ''
  let lighting = ''
  if (fibre) {
    const varying = 'flat varying vec2 craftJitter;'
    vertexHeader += `
#ifdef USE_INSTANCING
${varying}
${cellJitterGLSL}
#endif
`
    vertex += `
#ifdef USE_INSTANCING
  ivec2 craftCell = ivec2(round((modelMatrix * instanceMatrix[3]).xz / ${TILE_SIZE}.0));
  craftJitter = craftCellJitter(craftCell);
#endif
`
    fragmentHeader += `
#ifdef USE_INSTANCING
${varying}
#endif
`
    albedo += `
#ifdef USE_INSTANCING
#ifdef USE_MAP
  diffuseColor.rgb *= mix(0.76, 1.08, saturate((sampledDiffuseColor.r - 0.52) * 2.65));
#endif
  vec3 hueShift = cross(vec3(0.57735027), diffuseColor.rgb);
  diffuseColor.rgb = clamp((diffuseColor.rgb + hueShift * craftJitter.x) * craftJitter.y, 0.0, 1.0);
#endif
`
    lighting += `
  float grazing = 1.0 - saturate(dot(nonPerturbedNormal, normalize(vViewPosition)));
  // A soft fibre halo with a hint of the cool side light.
  outgoingLight += pow2(grazing) * (diffuseColor.rgb * vec3(0.23, 0.19, 0.30) + vec3(0.010, 0.008, 0.015));
`
  }
  if (stitch) {
    fragmentHeader += stitchGLSL
    albedo += `
  float stitchFootprint = fwidth(vMapUv.x);
  float stitchFilter = min(0.35, stitchFootprint * 8.0);
  float ridge = craftStitch(vMapUv, stitchFilter);
  float detail = 1.0 - smoothstep(0.055, 0.145, stitchFootprint);
  float stitchRidge = ridge * detail;
  float stitchShadow = craftStitch(vMapUv + vec2(-0.018, 0.075), stitchFilter) * (1.0 - ridge) * detail;
  vec2 stitchGradient = vec2(dFdx(stitchRidge), dFdy(stitchRidge)) * 0.0045;
  diffuseColor.rgb *= mix(1.0, 0.67, stitchShadow);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.81, 0.64), 0.55 * stitchRidge);
`
    bump += 'normal = craftRaisedStitch(-vViewPosition, normal, stitchGradient);'
  }
  if (contact) {
    const varying = 'varying float craftHingeHeight;'
    vertexHeader += varying
    fragmentHeader += varying
    vertex += 'craftHingeHeight = abs(transformed.y);'
    lighting += 'outgoingLight *= mix(0.55, 1.0, smoothstep(0.0, 0.105, craftHingeHeight));'
  }
  if (glitter) {
    vertexHeader += 'flat varying vec2 craftFlakeOffset;'
    fragmentHeader += glitterGLSL
    vertex += `
  craftFlakeOffset = vec2(0.0);
#ifdef USE_INSTANCING
  craftFlakeOffset = round((modelMatrix * instanceMatrix[3]).xz / ${TILE_SIZE}.0) * vec2(27.0, 41.0);
#endif
`
    lighting += `
#if NUM_DIR_LIGHTS > 0
  float glint = craftGlint(vMapUv * ${glitter === 'thread' ? 'vec2(0.16, 0.015)' : '1.0'}, ${largeFlakes},
    normal, normalize(vViewPosition), directionalLights[0].direction);
  outgoingLight += glint * craftSunlight * 1.85;
#endif
`
  }

  shader.vertexShader = `${vertexHeader}\n${shader.vertexShader}`.replace(
    '#include <project_vertex>', `#include <project_vertex>\n${vertex}`,
  )
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${fragmentHeader}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${albedo}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${bump}`)
    .replace('#include <opaque_fragment>', `${lighting}\n#include <opaque_fragment>`)
  if (glitter) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>', `vec3 craftSunlight = vec3(0.0);\n${glitterLights}`,
    )
  }
}

export function applyCraftMaterial(source, { moving, page = false, tile } = {}) {
  if (plain) return source
  const [kind] = source.name.split('_', 1)
  if (!['felt', 'card', 'glitter', 'yarn'].includes(kind)) return source

  const fibre = kind === 'felt' || kind === 'yarn'
  // The bridge's rails are authored as yarn. A few metallic threads catch the key.
  const metallicThread = moving && tile === 'yarn_bridge' && /^yarn_(hot_pink|orange|pink|violet)$/.test(source.name)
  const glitter = source.map && (kind === 'glitter' ? 'flake' : metallicThread ? 'thread' : null)
  const largeFlakes = /^glitter_(river|rim)$/.test(source.name)
  const contact = kind === 'card' && moving
  const stitch = Boolean(source.map) && moving && /^(flower|mushroom_house|cupcake_tree)$/.test(tile) &&
    /^felt_fringe_(hot_pink|pink|lavender|orange|butter|tomato)$/.test(source.name)
  const materials = contact ? hingeMaterials : flatMaterials
  if (materials.has(source)) return materials.get(source)

  const material = new MeshLambertMaterial()
  Material.prototype.copy.call(material, source)
  material.color.copy(source.color)
  material.map = source.map
  material.alphaMap = source.alphaMap
  material.normalMap = source.normalMap
  material.normalMapType = source.normalMapType
  material.normalScale.copy(source.normalScale).multiplyScalar(0.85)
  material.aoMap = source.aoMap
  material.aoMapIntensity = source.aoMapIntensity
  material.emissive.copy(source.emissive)
  material.emissiveMap = source.emissiveMap
  material.emissiveIntensity = source.emissiveIntensity

  // Keep warm sunlight on the cloth while using cool white stock under the cream page tint.
  if (source.name === 'card_page') material.color.setRGB(1.353, 1.670, 1.402)
  if (source.name === 'card_core') material.color.setRGB(1.44, 1.76, 1.53)
  if (source.name === 'card_cream') material.color.multiply({ r: 1.07, g: 1.14, b: 1.24 })
  if (fibre) material.color.multiplyScalar(1.16)
  if (!moving && tile?.startsWith('path_') && source.name === 'felt_butter') material.color.set(0xf7df97)
  if (glitter === 'flake') material.color.setRGB(0.94, 0.94, 1.17)

  // Page batches install their gutter mask before the material is assigned to the batch.
  const beforeCompile = source.onBeforeCompile
  material.onBeforeCompile = function (shader, renderer) {
    beforeCompile.call(this, shader, renderer)
    if (fibre || glitter || contact) {
      extendShader(shader, { fibre, glitter, largeFlakes, contact, stitch })
    }
  }
  material.customProgramCacheKey = () => `craft/${fibre}/${glitter}/${contact}/${page}/${largeFlakes}/${stitch}`
  materials.set(source, material)
  return material
}

export function applyCraftMaterials(root) {
  if (plain) return
  root.traverse((node) => {
    if (!node.isMesh) return
    node.receiveShadow = true
    node.material = Array.isArray(node.material)
      ? node.material.map((material) => applyCraftMaterial(material))
      : applyCraftMaterial(node.material)
  })
}
