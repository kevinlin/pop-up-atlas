import {
  AdditiveBlending, BufferGeometry, Color, DynamicDrawUsage, InterleavedBuffer,
  InterleavedBufferAttribute, Matrix4, Mesh, Points, ShaderMaterial, SphereGeometry, Vector3,
} from 'three'
import { look } from '../materials/stage-look.js'
import { UPRIGHT } from '../world/spring.js'
import { GUTTER_INTERVAL } from '../world/tiles.js'
import { craft, emitterColors, palette } from './craft.js'
import { stage } from './flags.js'
import { glowPlane, groundGlow } from './lanterns.js'
import { createBurstPool, createResponse, BURST_LIFE, FOLD_GLOW, setFold, updateResponse } from './response.js'

const inserts = {
  flower: { part: 'felt_butter', pigment: 0, width: 0.112, height: 0.081 },
  mushroom_house: { part: 'card_butter', pigment: 0, width: 0.058, height: 0.077 },
  cupcake_tree: { part: 'felt_butter', pigment: 2, width: 0.084, height: 0.072 },
}
const sprig = { pigment: 1, width: 0.048, height: 0.052 }

function shadeInsert(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
    outgoingLight = diffuseColor.rgb * 0.63 + totalEmissiveRadiance * ${look.grade ? '2.35' : '1.95'};
    #include <opaque_fragment>
  `)
}

function makeBursts(scene) {
  const pool = createBurstPool()
  const buffer = new InterleavedBuffer(pool.particles, 8).setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0))
  geometry.setAttribute('born', new InterleavedBufferAttribute(buffer, 1, 3))
  geometry.setAttribute('scatter', new InterleavedBufferAttribute(buffer, 4, 4))
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: {
      elapsed: { value: 0 }, pixelRatio: { value: 1 },
      butter: { value: new Color(palette.butter) }, pink: { value: new Color(palette.hotPink) },
      sky: { value: new Color(palette.sky) },
    },
    vertexShader: /* glsl */ `
      attribute float born;
      attribute vec4 scatter;
      uniform float elapsed;
      uniform float pixelRatio;
      varying float alpha;
      varying float pigment;
      varying float turn;
      void main() {
        float age = elapsed - born;
        float life = age / ${BURST_LIFE};
        if (life < 0.0 || life >= 1.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 1.0;
          return;
        }
        vec3 drift = scatter.xyz * age - vec3(0.0, 2.55 * age * age, 0.0);
        vec4 p = modelViewMatrix * vec4(position + drift, 1.0);
        gl_Position = projectionMatrix * p;
        gl_PointSize = mix(3.4, 7.1, scatter.w) * pixelRatio * (1.0 - 0.50 * life);
        turn = 6.283185 * scatter.w + life * 10.0;
        alpha = smoothstep(0.0, 0.045, age + 0.002)
          * (1.0 - life) * mix(0.56, 1.0, pow(abs(sin(turn)), 4.0));
        pigment = scatter.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 butter;
      uniform vec3 pink;
      uniform vec3 sky;
      varying float alpha;
      varying float pigment;
      varying float turn;
      void main() {
        vec2 p = 2.0 * gl_PointCoord - 1.0;
        float s = sin(turn);
        float c = cos(turn);
        p = abs(mat2(c, -s, s, c) * p);
        float flake = min(p.x * 1.15 + p.y * 2.6, p.y * 1.15 + p.x * 2.6);
        vec3 tint = pigment < 0.42 ? butter : pigment < 0.70 ? sky : pink;
        gl_FragColor = vec4(tint * 1.7, alpha * (1.0 - smoothstep(0.47, 1.0, flake)));
        #include <colorspace_fragment>
      }
    `,
  })
  const points = new Points(geometry, material)
  points.name = 'atlas/fold-glitter'
  points.renderOrder = 5
  points.frustumCulled = false
  points.visible = false
  scene.add(points)
  return {
    fire(t, point, seed) {
      if (!pool.fire(t, point.x, point.y, point.z, seed)) return
      buffer.needsUpdate = true
    },
    update(t) {
      points.visible = pool.slots[0].end > t || pool.slots[1].end > t
      if (!points.visible) return
      material.uniforms.elapsed.value = t
      if (typeof window !== 'undefined') material.uniforms.pixelRatio.value = window.devicePixelRatio
    },
    reset() {
      pool.reset()
      buffer.needsUpdate = true
      points.visible = false
    },
  }
}

export function createFoldLight(scene, camera) {
  const shape = new SphereGeometry(1, 10, 6)
  const groundShape = stage.lanterns ? glowPlane() : null
  const slots = Array.from({ length: 12 }, () => {
    const material = craft('card_fold_core', { color: palette.butter, emissive: palette.butter, emissiveIntensity: 0 }, shadeInsert)
    const core = new Mesh(shape, material)
    core.name = 'atlas/fold-core'
    core.visible = false
    scene.add(core)
    const decal = groundShape ? new Mesh(groundShape, groundGlow()) : null
    if (decal) {
      decal.name = 'atlas/fold-ground-glow'
      decal.visible = false
      scene.add(decal)
    }
    return { core, decal }
  })
  const bursts = stage.response ? makeBursts(scene) : null
  const transform = new Matrix4()
  const rotation = new Matrix4()
  const position = new Vector3()
  const origin = new Vector3()
  let used = 0

  function prepare(cell) {
    const insert = inserts[cell.tile.id]
    if (!stage.response && (!insert || cell.tile.id === 'cupcake_tree')) return
    const { hinges } = cell.art
    if (!hinges.length) return
    let hinge = hinges[0]
    const local = new Vector3(0, hinge.height * 0.71, 0.032)
    if (insert) {
      const name = `atlas/${cell.tile.id}/${insert.part}`
      for (const candidate of hinges) {
        const part = candidate.batches.find((batch) => batch.name === name)
        if (!part) continue
        const bounds = part.geometry.boundingBox
        bounds.getCenter(local)
        local.z = bounds.max.z + 0.005
        hinge = candidate
        break
      }
    }
    const state = cell.light?.state ?? createResponse()
    if (!cell.light && cell.up) {
      state.up = true
      if (hinge.angle >= UPRIGHT) state.uprightAt = 0
    }
    cell.light = { state, hinge, local, insert: insert ?? sprig }
  }

  function fold(cell, t) {
    if (cell.light) setFold(cell.light.state, cell.up, t)
  }

  function update(cell, t, distanceSquared) {
    if (!cell.light) return
    const { state, hinge, local, insert } = cell.light
    if (!state.up && state.glow === 0) return
    const burst = updateResponse(state, t, hinge.angle, distanceSquared)
    if (!cell.drawn || state.glow <= 0) return
    const angle = hinge.angle * (hinge.sign ?? 1)
    transform.multiplyMatrices(cell.art.tileMatrix, hinge.pivot).multiply(rotation.makeRotationX(angle))
    if (hinge.lift && angle > 0) transform.elements[13] += hinge.lift * Math.sin(angle)
    position.copy(local).applyMatrix4(transform)
    if (burst && bursts) {
      // Raise the glitter clear of the cutout's front fibres before spreading it.
      if (camera) origin.copy(camera.position).sub(position).normalize().multiplyScalar(0.13).add(position)
      else origin.copy(position)
      bursts.fire(t, origin, cell.i * 8191 + cell.j)
    }
    if (used === slots.length) return
    const { core, decal } = slots[used++]
    core.position.copy(position)
    core.quaternion.setFromRotationMatrix(rotation.extractRotation(transform))
    const scale = cell.tile.scale ?? 1
    core.scale.set(insert.width * scale, insert.height * scale, 0.027 * scale)
    const pigment = emitterColors[insert.pigment]
    core.material.color.copy(pigment)
    core.material.emissive.copy(pigment)
    core.material.emissiveIntensity = stage.response ? state.glow : Math.min(state.glow, FOLD_GLOW)
    core.visible = true
    if (decal && cell.tile.zone === 'grove' && cell.tile.sockets === 'gggg' && cell.i % GUTTER_INTERVAL !== 0) {
      decal.position.set(cell.x + (cell.tile.offsetX ?? 0), 0.014, cell.z + (cell.tile.offsetZ ?? 0))
      decal.scale.set(0.48, 1, 0.43)
      decal.material.uniforms.glow.value.copy(core.material.emissive)
      decal.material.uniforms.strength.value = core.material.emissiveIntensity * 0.42
      decal.visible = true
    }
  }

  function begin() {
    for (let i = 0; i < used; i += 1) {
      slots[i].core.visible = false
      if (slots[i].decal) slots[i].decal.visible = false
    }
    used = 0
  }

  return {
    prepare, fold, update, begin,
    end(t) { bursts?.update(t) },
    reset() {
      begin()
      bursts?.reset()
    },
  }
}
