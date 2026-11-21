import { ShaderChunk } from 'three'
import { TILE_SIZE } from '../world/tiles.js'
import { cellZoneGLSL } from './cell-jitter.js'
import { look, stage, surfaceBuffer, trollSurfaces } from './stage-look.js'

const keyShadow = /(getDirectionalLightInfo\( directionalLight, directLight \);[\s\S]*?#endif)/
const dappleFragment = /* glsl */ `
  varying vec2 craftCanopyXZ;
  flat varying float craftCanopyGrove;

  float canopyHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float canopyLight() {
    vec2 p = craftCanopyXZ * vec2(1.22, 0.96);
    vec2 cell = floor(p);
    vec2 blend = smoothstep(0.0, 1.0, fract(p));
    float noise = mix(mix(canopyHash(cell), canopyHash(cell + vec2(1, 0)), blend.x),
      mix(canopyHash(cell + vec2(0, 1)), canopyHash(cell + 1.0), blend.x), blend.y);
    return mix(0.60, 1.0, smoothstep(0.27, 0.67, noise));
  }
`

function addDapple(shader) {
  shader.uniforms.craftZoneSeed = stage.seed
  shader.uniforms.craftZoneWarp = stage.warp
  const zoneCode = shader.vertexShader.includes('ivec2 craftZone(') ? '' : cellZoneGLSL
  shader.vertexShader = `
    ${zoneCode}
    varying vec2 craftCanopyXZ;
    flat varying float craftCanopyGrove;
    ${shader.vertexShader}
  `.replace('#include <project_vertex>', `#include <project_vertex>
    vec4 canopyPoint = vec4(transformed, 1.0);
    vec4 canopyOrigin = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    canopyPoint = instanceMatrix * canopyPoint;
    canopyOrigin = instanceMatrix[3];
  #endif
    craftCanopyXZ = (modelMatrix * canopyPoint).xz;
    ivec2 canopyZone = craftZone(round((modelMatrix * canopyOrigin).xz / ${TILE_SIZE}.0));
    craftCanopyGrove = float((canopyZone.x + canopyZone.y + int(craftZoneWarp.z)) & 1);
  `)
  shader.fragmentShader = `${dappleFragment}\n${shader.fragmentShader}`
}

function lightSurfaces(shader, dapple, moss) {
  if (dapple) addDapple(shader)
  if (moss) {
    shader.uniforms.craftMossFill = stage.mossFill
    shader.fragmentShader = `uniform float craftMossFill;\n${shader.fragmentShader}`
  }
  const lighting = ShaderChunk.lights_fragment_begin.replace(keyShadow, `$1
      #if UNROLLED_LOOP_INDEX == 0
        ${dapple ? 'if (craftCanopyGrove > 0.5) directLight.color *= canopyLight();' : ''}
        ${moss ? 'directLight.color *= 3.35;' : ''}
      #else
        ${moss ? 'directLight.color *= craftMossFill;' : ''}
      #endif`)
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lighting)
  if (moss) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
    'irradiance *= 0.42;\n#include <lights_fragment_end>')
}

// Alpha tags the visible opaque surface. RGB carries only material emission.
function addEmission(shader, material, tag, emits) {
  const output = 'layout(location = 1) out highp vec4 atlasEmission;'
  const fragment = shader.fragmentShader
  if (fragment.includes('#include <opaque_fragment>')) {
    const emission = emits ? '0.5 * totalEmissiveRadiance' : 'vec3(0.0)'
    const coverage = material.transparent
      ? (emits ? '0.35 * gl_FragColor.a' : '0.0')
      : 'atlasSurface'
    const premultiply = material.transparent && material.premultipliedAlpha ? ' * gl_FragColor.a' : ''
    shader.uniforms.atlasSurface = { value: tag }
    shader.fragmentShader = `${output}\nuniform float atlasSurface;\n${fragment}`.replace('#include <opaque_fragment>',
      `#include <opaque_fragment>\n atlasEmission = vec4(${emission}${premultiply}, ${coverage});`)
  } else {
    // Custom unlit effects provide their own color but have no material emissive channel.
    shader.fragmentShader = `${output}\n${fragment.replace(/void\s+main\s*\(\s*(?:void)?\s*\)/, 'void atlasMaterialMain()')}
      void main() {
        atlasMaterialMain();
        atlasEmission = vec4(0.0);
      }
    `
  }
}

export function trackStageMaterials(scene) {
  if (!surfaceBuffer && !look.dapple && !look.backlight) return
  const patched = new WeakSet()
  const added = ({ child }) => child.traverse(track)
  function track(object) {
    object.addEventListener('childadded', added)
    if (!object.material) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (patched.has(material)) continue
      patched.add(material)
      const prop = /^atlas\/(flower|mushroom_house|cupcake_tree)\//.test(object.name)
      const applique = /^atlas\/meadow(?:_[abc])?\//.test(object.name)
      const page = /^card_(page|core|cream)$/.test(material.name) && /^atlas\/(page_[ab]|gutter)\//.test(object.name)
      const moss = object.name.startsWith('atlas/moss/')
      const table = object.name === 'atlas/table'
      const dapple = look.dapple && (prop || page || moss)
      const mossLighting = moss && look.backlight
      if (!surfaceBuffer && !dapple && !mossLighting) continue
      const frond = object.parent?.name === 'atlas/foreground-fronds'
      const yarnRail = object.name.startsWith('atlas/yarn_bridge/') && material.name.startsWith('yarn_')
      const core = object.name === 'atlas/fold-core'
      const character = object.userData.craftCharacter
      const hair = /^yarn_sunset(_fibres)?$/.test(material.name)
      const tag = character ? trollSurfaces[hair ? 'hair' : 'body']
        : page ? 0.2 : prop || yarnRail ? 0.4 : moss ? 0.5 : table ? 0.6 : applique ? 0.7 : frond ? 0.8 : core ? 0.9 : 1
      const pigment = material.emissive
      const emits = look.bloom && Boolean(pigment && (pigment.r || pigment.g || pigment.b))
      const beforeCompile = material.onBeforeCompile
      const programKey = material.customProgramCacheKey()
      material.onBeforeCompile = function (shader, renderer) {
        beforeCompile.call(this, shader, renderer)
        if ((dapple || mossLighting) && (this.isMeshLambertMaterial || this.isMeshStandardMaterial)) {
          lightSurfaces(shader, dapple, mossLighting)
        }
        if (surfaceBuffer) addEmission(shader, this, tag, emits)
      }
      material.customProgramCacheKey = () => `${programKey}/stage/${dapple}/${mossLighting}/${surfaceBuffer}/${emits}`
      material.needsUpdate = true
    }
  }
  scene.traverse(track)
}
