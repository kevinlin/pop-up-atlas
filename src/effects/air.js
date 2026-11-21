import {
  Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry,
  ShaderMaterial, Vector2, Vector3,
} from 'three'
import { zoneBlendAt } from '../world/layout.js'
import { TILE_SIZE } from '../world/tiles.js'
import { palette } from './craft.js'
import { stage } from './flags.js'
import { airPlacements, BOKEH_COUNT, MOTE_COUNT } from './placement.js'
import { makeFronds } from './fronds.js'

const zoneColors = [
  [palette.lime, palette.butter], [palette.orange, palette.butter],
  [palette.pink, palette.lavender], [palette.mint, palette.sky],
].map((pair) => pair.map((value) => new Color(value)))

function makeAirLayer(scene, kind) {
  const bokeh = kind === 'bokeh'
  const count = bokeh ? BOKEH_COUNT : MOTE_COUNT
  const geometry = new InstancedBufferGeometry()
  const quad = new PlaneGeometry(2, 2)
  geometry.copy(quad)
  quad.dispose()
  geometry.instanceCount = count
  const layout = new InstancedBufferAttribute(new Float32Array(count * 4), 4)
  const motion = new InstancedBufferAttribute(new Float32Array(count * 4), 4)
  geometry.setAttribute('placement', layout)
  geometry.setAttribute('motion', motion)

  const material = new ShaderMaterial({
    defines: bokeh ? { BOKEH: 1 } : {},
    uniforms: {
      elapsed: { value: 0 },
      focus: { value: 10 },
      viewport: { value: new Vector2() },
      parallax: { value: new Vector2() },
      colorA: { value: new Color(bokeh ? palette.lime : palette.cream) },
      colorB: { value: new Color(bokeh ? palette.butter : palette.mint) },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 placement;
      attribute vec4 motion;
      uniform float elapsed;
      uniform float focus;
      uniform vec2 viewport;
      uniform vec2 parallax;
      varying vec2 grain;
      varying vec4 appearance;

      void main() {
        vec2 center = 2.0 * placement.xy - 1.0;
        vec2 radius;
        float depth;
        float alpha = placement.w;
        float phase = motion.z;
        #ifdef BOKEH
          center += vec2(sin(phase + 0.14 * elapsed), cos(phase + 0.18 * elapsed)) * 0.022;
          radius = placement.z * vec2(1.0, viewport.x / viewport.y);
          depth = focus / (1.0 - center.y * 0.27) - focus * 0.042;
        #else
          depth = focus * mix(0.40, 0.80, motion.x);
          float orbit = phase + elapsed * motion.y / 0.46;
          center += 0.46 * vec2(cos(orbit), sin(orbit))
            * vec2(projectionMatrix[0][0], projectionMatrix[1][1]) / depth;
          center -= parallax * vec2(projectionMatrix[0][0], projectionMatrix[1][1]) / depth;
          center = mod(center + 1.0, 2.0) - 1.0;
          radius = placement.z / viewport;
          alpha = mix(alpha, 0.20 + 0.3 * pow(0.5 + 0.5 * sin(elapsed * 5.0 + phase), 5.0), motion.w);
        #endif
        gl_Position = projectionMatrix * vec4(0.0, 0.0, -depth, 1.0);
        gl_Position.xy = (center + position.xy * radius) * gl_Position.w;
        grain = position.xy;
        appearance = vec4(alpha, motion.x, phase, motion.w);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 colorA;
      uniform vec3 colorB;
      varying vec2 grain;
      varying vec4 appearance;

      void main() {
        float radius = length(grain);
        float alpha;
        vec3 tint = mix(colorA, colorB, appearance.y);
        #ifdef BOKEH
          alpha = 1.0 - smoothstep(0.28, 1.0, radius);
        #else
          float theta = atan(grain.y, grain.x);
          float tuft = radius + 0.12 * sin(5.0 * theta + appearance.z)
            + 0.08 * cos(8.0 * theta - appearance.z);
          alpha = 1.0 - smoothstep(0.34, 0.97, tuft);
          float sparkle = 1.0 - smoothstep(0.14, 0.95, min(
            abs(grain.x) * 4.0 + abs(grain.y), abs(grain.y) * 4.0 + abs(grain.x)));
          alpha = mix(alpha, max(alpha * 0.45, sparkle), appearance.w);
        #endif
        #ifdef BOKEH
          tint *= 1.85;
        #else
          tint *= 3.0 + appearance.w * 0.45;
        #endif
        gl_FragColor = vec4(tint, alpha * appearance.x);
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = `atlas/${kind}`
  mesh.renderOrder = bokeh ? 2 : 4
  mesh.frustumCulled = false
  scene.add(mesh)
  return {
    uniforms: material.uniforms,
    reseed(seed) {
      airPlacements(kind, seed).forEach(({ x, y, size, alpha, depth, speed, phase, twinkle }, i) => {
        layout.setXYZW(i, x, y, size, alpha)
        motion.setXYZW(i, depth, speed, phase, Number(twinkle))
      })
      layout.needsUpdate = motion.needsUpdate = true
    },
  }
}

export function createAtmosphere(scene, camera, player, getSeed) {
  const layers = []
  const bokeh = stage.bokeh ? makeAirLayer(scene, 'bokeh') : null
  if (bokeh) layers.push(bokeh)
  if (stage.motes) layers.push(makeAirLayer(scene, 'motes'))
  const fronds = stage.fronds ? makeFronds(scene, camera) : null
  const focus = new Vector3()
  const weights = [0, 0, 0, 0]
  let seed
  return (_dt, elapsed) => {
    if (!layers.length && !fronds) return
    camera.updateMatrixWorld()
    focus.copy(player.position)
    focus.y += 0.38
    const depth = -focus.applyMatrix4(camera.matrixWorldInverse).z
    fronds?.(player.position)
    const nextSeed = getSeed()
    if (bokeh) {
      zoneBlendAt(nextSeed, player.position.x / TILE_SIZE, player.position.z / TILE_SIZE, weights)
      const a = bokeh.uniforms.colorA.value.setRGB(0, 0, 0)
      const b = bokeh.uniforms.colorB.value.setRGB(0, 0, 0)
      for (let i = 0; i < weights.length; i += 1) {
        a.r += zoneColors[i][0].r * weights[i]
        a.g += zoneColors[i][0].g * weights[i]
        a.b += zoneColors[i][0].b * weights[i]
        b.r += zoneColors[i][1].r * weights[i]
        b.g += zoneColors[i][1].g * weights[i]
        b.b += zoneColors[i][1].b * weights[i]
      }
    }
    for (const layer of layers) {
      if (nextSeed !== seed) layer.reseed(nextSeed)
      layer.uniforms.elapsed.value = elapsed
      layer.uniforms.focus.value = Math.max(depth, camera.near * 3)
      layer.uniforms.viewport.value.set(window.innerWidth, Math.max(1, window.innerHeight))
      layer.uniforms.parallax.value.set(player.position.x * 0.15, player.position.z * -0.11)
    }
    seed = nextSeed
  }
}
