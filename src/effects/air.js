import {
  Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry,
  ShaderMaterial, Vector2, Vector3,
} from 'three'
import { palette } from './craft.js'
import { stage } from './flags.js'
import { motePlacements, MOTE_COUNT } from './placement.js'
import { makeFronds } from './fronds.js'

function makeMotes(scene) {
  const count = MOTE_COUNT
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
    uniforms: {
      elapsed: { value: 0 },
      focus: { value: 10 },
      viewport: { value: new Vector2() },
      parallax: { value: new Vector2() },
      colorA: { value: new Color(palette.cream) },
      colorB: { value: new Color(palette.mint) },
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
        float alpha = placement.w;
        float phase = motion.z;
        float depth = focus * mix(0.40, 0.80, motion.x);
        float orbit = phase + elapsed * motion.y / 0.46;
        center += 0.46 * vec2(cos(orbit), sin(orbit))
          * vec2(projectionMatrix[0][0], projectionMatrix[1][1]) / depth;
        center -= parallax * vec2(projectionMatrix[0][0], projectionMatrix[1][1]) / depth;
        center = mod(center + 1.0, 2.0) - 1.0;
        vec2 radius = placement.z / viewport;
        alpha = mix(alpha, 0.20 + 0.3 * pow(0.5 + 0.5 * sin(elapsed * 5.0 + phase), 5.0), motion.w);
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
        vec3 tint = mix(colorA, colorB, appearance.y);
        float theta = atan(grain.y, grain.x);
        float tuft = radius + 0.12 * sin(5.0 * theta + appearance.z)
          + 0.08 * cos(8.0 * theta - appearance.z);
        float alpha = 1.0 - smoothstep(0.34, 0.97, tuft);
        float sparkle = 1.0 - smoothstep(0.14, 0.95, min(
          abs(grain.x) * 4.0 + abs(grain.y), abs(grain.y) * 4.0 + abs(grain.x)));
        alpha = mix(alpha, max(alpha * 0.45, sparkle), appearance.w);
        tint *= 3.0 + appearance.w * 0.45;
        gl_FragColor = vec4(tint, alpha * appearance.x);
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'atlas/motes'
  mesh.renderOrder = 4
  mesh.frustumCulled = false
  scene.add(mesh)
  return {
    uniforms: material.uniforms,
    reseed(seed) {
      motePlacements(seed).forEach(({ x, y, size, alpha, depth, speed, phase, twinkle }, i) => {
        layout.setXYZW(i, x, y, size, alpha)
        motion.setXYZW(i, depth, speed, phase, Number(twinkle))
      })
      layout.needsUpdate = motion.needsUpdate = true
    },
  }
}

export function createAtmosphere(scene, camera, player, getSeed) {
  const layers = []
  if (stage.motes) layers.push(makeMotes(scene))
  const fronds = stage.fronds ? makeFronds(scene, camera) : null
  const focus = new Vector3()
  let seed
  return (_dt, elapsed) => {
    if (!layers.length && !fronds) return
    camera.updateMatrixWorld()
    focus.copy(player.position)
    focus.y += 0.38
    const depth = -focus.applyMatrix4(camera.matrixWorldInverse).z
    fronds?.(player.position)
    const nextSeed = getSeed()
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
