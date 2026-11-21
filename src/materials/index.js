import { Material, MeshLambertMaterial } from 'three'
import { TILE_SIZE } from '../world/tiles.js'
import { cellJitterGLSL, cellZoneGLSL } from './cell-jitter.js'
import { glitterGLSL, glitterLights, riverGlintBoost } from './glitter.js'
import { stitchGLSL } from './stitch.js'
import { look, stage } from './stage-look.js'

const query = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
const plain = query.has('plain')
if (query.has('look-shots')) void import('./look-preview.js')
const flatMaterials = new WeakMap()
const hingeMaterials = new WeakMap()

function extendShader(shader, { fibre, glitter, largeFlakes, river, contact, stitch, mint, goldenRim, prop }) {
  let vertexHeader = ''
  let vertex = ''
  let fragmentHeader = ''
  let albedo = ''
  let bump = ''
  let lighting = ''
  let grade = ''
  if (prop && look.zones) {
    shader.uniforms.craftZoneSeed = stage.seed
    shader.uniforms.craftZoneWarp = stage.warp
    shader.uniforms.craftPigments = stage.propPigments
    vertexHeader += `
#ifdef USE_INSTANCING
${cellZoneGLSL}
uniform vec3 craftPigments[4];
flat varying vec4 craftZoneTint;
#endif
`
    vertex += `
#ifdef USE_INSTANCING
  vec2 propCell = round((modelMatrix * instanceMatrix[3]).xz / ${TILE_SIZE}.0);
  float family = craftZoneHash(ivec2(propCell), 23u) % 3u == 0u ? 0.33 : 0.78;
  craftZoneTint = vec4(craftCellPigment(propCell, craftPigments), family);
#endif
`
    fragmentHeader += `
#ifdef USE_INSTANCING
flat varying vec4 craftZoneTint;
#endif
`
    albedo += `
#ifdef USE_INSTANCING
  float paperValue = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
  float pigmentValue = max(craftZoneTint.r, max(craftZoneTint.g, craftZoneTint.b));
  diffuseColor.rgb = mix(diffuseColor.rgb, craftZoneTint.rgb * (paperValue / pigmentValue), craftZoneTint.a);
#endif
`
  }
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
    if (look.bounce) lighting += `
  // Felt scatters bounced light across the face in the pigment's own color.
  outgoingLight += diffuseColor.rgb * mix(0.13, 0.28, saturate(nonPerturbedNormal.z));
`
    if (prop && look.backlight) lighting += `
#if NUM_DIR_LIGHTS > 0
  float rim = smoothstep(0.35, 0.95, grazing)
    * smoothstep(-0.35, 0.55, dot(nonPerturbedNormal, directionalLights[0].direction));
  vec3 craftRimLight = 0.68 * rim * directionalLights[0].color * (0.12 + 0.88 * diffuseColor.rgb);
  outgoingLight += craftRimLight;
#endif
`
  }
  if (mint) {
    lighting += `
  // The baked green channel carries the needle-felt grain and the diffuse shading.
  float woolLight = outgoingLight.g * 2.05;
  outgoingLight = vec3(0.50, 1.0, 0.67) * woolLight;
`
    grade = 'gl_FragColor.a = 0.24 * gold;'
  }
  if (goldenRim) {
    lighting += `
  vec3 backlight = mat3(viewMatrix) * vec3(-0.80, 0.50, -0.33);
  float gold = pow2(grazing) * smoothstep(-0.15, 0.82, dot(nonPerturbedNormal, backlight));
  outgoingLight += gold * vec3(0.74, 0.38, 0.09) * ${mint ? '0.45' : '1.0'};
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
    lighting += 'outgoingLight *= mix(0.55, 1.0, smoothstep(0.0, 0.080, craftHingeHeight));'
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
  vec2 glints = craftGlint(vMapUv * ${glitter === 'thread' ? 'vec2(0.16, 0.015)' : '1.0'}, ${largeFlakes},
    normal, normalize(vViewPosition), directionalLights[0].direction);
  float glint = max(glints.x, glints.y) * 2.25;
  ${river ? riverGlintBoost : ''}
  outgoingLight += glint * craftSunlight;
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
    .replace('#include <opaque_fragment>', `${lighting}\n#include <opaque_fragment>\n${grade}`)
  if (glitter) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>', `vec3 craftSunlight = vec3(0.0);\n${glitterLights}`,
    )
  }
}

export function applyCraftMaterial(source, { moving, page = false, tile, character = false } = {}) {
  if (plain) return source
  const [kind] = source.name.split('_', 1)
  if (!['felt', 'card', 'glitter', 'yarn'].includes(kind)) return source

  const fibre = kind === 'felt' || kind === 'yarn'
  const prop = /^(flower|mushroom_house|cupcake_tree)$/.test(tile)
  // The bridge's rails are authored as yarn. A few metallic threads catch the key.
  const metallicThread = moving && tile === 'yarn_bridge' && /^yarn_(hot_pink|orange|pink|violet)$/.test(source.name)
  const glitter = source.map && (kind === 'glitter' ? 'flake' : metallicThread ? 'thread' : null)
  const river = source.name === 'glitter_river'
  const largeFlakes = river || source.name === 'glitter_rim'
  const mint = character && /^felt_(mint|fibre_(mint|green|light))$/.test(source.name)
  const goldenRim = mint || character && /^yarn_sunset(_fibres)?$/.test(source.name)
  const contact = kind === 'card' && moving
  const stitch = Boolean(source.map) && moving && prop &&
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
  if (tile === 'yarn_bridge' && !moving && kind === 'felt' && !source.name.startsWith('felt_fringe_')) {
    material.userData.craftBridgeDeck = true
  }

  // Keep warm sunlight on the cloth while using cool white stock under the cream page tint.
  if (source.name === 'card_page') material.color.setRGB(...(look.grade ? [1.11, 1.24, 1.11] : [1.40, 1.666, 1.558]))
  if (source.name === 'card_core') material.color.setRGB(...(look.grade ? [1.21, 1.34, 1.20] : [1.49, 1.76, 1.70]))
  if (source.name === 'card_cream') material.color.multiply({ r: 1.07, g: 1.14, b: 1.24 })
  if (fibre) material.color.multiplyScalar(1.16)
  if (!moving && tile?.startsWith('path_') && source.name === 'felt_butter') material.color.set(0xf7df97)
  if (glitter === 'flake') material.color.setRGB(0.94, 0.94, 1.17)

  // Page batches install their gutter mask before the material is assigned to the batch.
  const beforeCompile = source.onBeforeCompile
  material.onBeforeCompile = function (shader, renderer) {
    beforeCompile.call(this, shader, renderer)
    if (fibre || glitter || contact || prop && look.zones) {
      extendShader(shader, { fibre, glitter, largeFlakes, river, contact, stitch, mint, goldenRim, prop })
    }
  }
  material.customProgramCacheKey = () => `craft/${fibre}/${glitter}/${contact}/${page}/${largeFlakes}/${river}/${stitch}/${mint}/${goldenRim}/${prop}`
  materials.set(source, material)
  return material
}

export function applyCraftMaterials(root) {
  if (plain) return
  const convert = (material) => applyCraftMaterial(material, { character: true })
  root.traverse((node) => {
    if (!node.isMesh) return
    node.userData.craftCharacter = true
    node.receiveShadow = true
    node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material)
  })
}
