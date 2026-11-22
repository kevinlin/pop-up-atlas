import {
  AdditiveBlending, Box2, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide, InstancedMesh, LatheGeometry,
  Matrix4, Object3D, PlaneGeometry, ShaderMaterial, SphereGeometry, TubeGeometry, Vector2, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { look } from '../materials/stage-look.js'
import { camera, follower, player, registerUpdate } from '../scene/runtime.js'
import { cellAt, GUTTER_INTERVAL } from '../world/tiles.js'
import { craft, craftMap, emitterColors, palette } from './craft.js'
import { placeLantern } from './placement.js'

// Core brightness (outgoing light) and halo gain (emission buffer, near to far). Contract #11: luma 200-235, halo
// 1.5-3 % of frame width. Tuned for core luma ~205-215 on the default camera. Neutral tone mapping flattens the top
// end, so the values sit well under 1. Gains below ~0.25 starve the bloom threshold in tilt-shift.js (halo drops to 0);
// above ~0.3 the halo radius barely moves, because the measured edge is set by the cream page, which takes no halo.
const CORE_LIGHT = '0.50'
const CORE_DISTANT = '0.15'
const HALO_NEAR = '0.35'
const HALO_FAR = '1.20'

const glowColors = [palette.butter, palette.mint, palette.hotPink, palette.sky].map((color) => new Color(color))
export const glowPlane = () => new PlaneGeometry(2, 2).rotateX(-Math.PI / 2)

export function groundGlow() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { glow: { value: new Color(palette.butter) }, strength: { value: 0.31 } },
    vertexShader: /* glsl */ `
      varying vec2 haloUV;
      varying vec3 tint;
      uniform vec3 glow;
      void main() {
        vec4 p = vec4(position, 1.0);
        tint = glow;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        #ifdef USE_INSTANCING_COLOR
          tint = instanceColor;
        #endif
        haloUV = 2.0 * uv - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 haloUV;
      varying vec3 tint;
      uniform float strength;
      void main() {
        float falloff = max(0.0, 1.0 - dot(haloUV, haloUV));
        gl_FragColor = vec4(tint, strength * falloff * falloff * falloff);
        #include <colorspace_fragment>
      }
    `,
  })
}

function mergeParts(parts) {
  const geometry = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  return geometry
}

function spanGeometry() {
  const cord = new TubeGeometry(new CatmullRomCurve3([
    new Vector3(-0.5, 0, 0), new Vector3(-0.26, -0.082, 0.012),
    new Vector3(0, -0.12, 0), new Vector3(0.27, -0.07, -0.012), new Vector3(0.5, 0, 0),
  ]), 14, 0.010, 5, false)
  return cord
}

function stemGeometry() {
  const stalk = new CylinderGeometry(0.016, 0.034, 1, 7, 5)
  const points = stalk.attributes.position
  for (let i = 0; i < points.count; i += 1) {
    points.setX(i, points.getX(i) + 0.11 * Math.sin(Math.PI * (points.getY(i) + 0.5)))
  }
  stalk.computeVertexNormals()
  const lower = new SphereGeometry(1, 8, 4).scale(0.125, 0.021, 0.048).rotateZ(-0.47).translate(0.013, 0.01, 0)
  const upper = new SphereGeometry(1, 8, 4).scale(0.11, 0.021, 0.038).rotateZ(0.53).translate(0.18, 0.24, 0.003)
  return mergeParts([stalk, lower, upper])
}

function shellGeometry() {
  const profile = [[0.02, -0.18], [0.071, -0.11], [0.112, 0.005],
    [0.096, 0.096], [0.044, 0.166], [0.022, 0.19]].map(([r, y]) => new Vector2(r, y))
  const parts = Array.from({ length: 6 }, (_, rib) =>
    new LatheGeometry(profile, 3, rib * Math.PI / 3, Math.PI * (rib % 2 ? 0.17 : 0.13)))
  parts.push(new CylinderGeometry(0.038, 0.055, 0.035, 6).translate(0, 0.173, 0))
  parts.push(new CylinderGeometry(0.023, 0.011, 0.024, 6).translate(0, -0.168, 0))
  return mergeParts(parts)
}

function boxCorners(min, max) {
  return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) =>
    [min.z, max.z].map((z) => new Vector3(x, y, z))))
}

export function createLanterns(scene) {
  const leaf = craft('felt_lantern_stem', {
    color: palette.lime, map: craftMap('felt-base_albedo-7ec1a3f63acb.png'),
    emissive: palette.mint, emissiveIntensity: 0.055,
  })
  const yarn = craft('yarn_lantern', {
    color: palette.lavender, map: craftMap('stitch_albedo-42d72cb4dd3f.png'),
    emissive: palette.lavender, emissiveIntensity: 0.08,
  })
  const shell = craft('card_lantern', {
    color: palette.cream, map: craftMap('cardstock_albedo-6158da4544cd.png'),
    side: DoubleSide, transparent: true, opacity: 0.30, forceSinglePass: true, depthWrite: false,
  }, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float distantGlow = smoothstep(10.6, 11.8, vViewPosition.z);
      vec3 tint = mix(vColor.rgb, diffuseColor.rgb, 0.35);
      float sky = smoothstep(0.095, 0.14, vColor.b - max(vColor.r, vColor.g));
      outgoingLight = tint * (1.12 + 0.42 * distantGlow + 0.28 * sky);
      #include <opaque_fragment>
    `)
  })
  const core = craft('card_lantern_core', { color: palette.cream, emissive: palette.cream, emissiveIntensity: 0.72 },
    (shader) => {
      // Three exposes instance tint as USE_COLOR in fragment shaders.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          #ifdef USE_COLOR
            totalEmissiveRadiance *= vColor.rgb;
          #endif
          // Halo size follows the emission, so ease it for near cores and lift it for far ones.
          totalEmissiveRadiance *= mix(${HALO_NEAR}, ${HALO_FAR}, smoothstep(10.6, 11.8, vViewPosition.z));
        `)
        .replace('#include <opaque_fragment>', `
          float distantGlow = smoothstep(10.6, 11.8, vViewPosition.z);
          float sky = smoothstep(0.095, 0.14, vColor.b - max(vColor.r, vColor.g));
          vec3 tint = vColor.rgb + vec3(0.0, 0.0, 0.08 * sky);
          outgoingLight = tint * (${look.grade ? '1.15' : CORE_LIGHT} + 0.08 * max(0.0, dot(normal, normalize(vViewPosition)))
            + ${CORE_DISTANT} * distantGlow + 0.30 * sky);
          #include <opaque_fragment>
        `)
    })
  const templates = [
    ['stem', stemGeometry(), leaf, 2],
    ['yarn', spanGeometry(), yarn, 1],
    ['seed-card', shellGeometry(), shell, 2],
    ['seed-core', new SphereGeometry(1, 10, 6).scale(0.072, 0.136, 0.072), core, 2],
    ['ground-glow', glowPlane(), groundGlow(), 1],
    ['tie', new CylinderGeometry(0.009, 0.009, 0.18, 5).translate(0, 0.09, 0), yarn, 2],
  ]
  const partCorners = templates.map(([, geometry]) => {
    geometry.computeBoundingBox()
    return boxCorners(geometry.boundingBox.min, geometry.boundingBox.max)
  })
  const parts = []
  const spans = []
  const groundPart = templates.findIndex(([name]) => name === 'ground-glow')
  const transform = new Object3D()
  const trollCorners = boxCorners(new Vector3(-0.45, -0.05, -0.45), new Vector3(0.45, 1.10, 0.45))
  const actors = [player, follower]
  const trolls = actors.map(() => new Box2())
  const projected = new Box2()
  const point = new Vector3()
  const ndc = new Vector2()
  const lastView = new Matrix4()
  const lastProjection = new Matrix4()
  const lastPositions = actors.map(() => new Vector3())
  const blurMargin = new Vector2(0.04, 0.12)
  let capacity = 0
  let dirty = true

  function begin(maxCells) {
    if (maxCells > capacity) {
      capacity = maxCells
      templates.forEach(([name, geometry, material, multiplier], i) => {
        if (parts[i]) {
          scene.remove(parts[i])
          parts[i].dispose()
        }
        const mesh = new InstancedMesh(geometry, material, capacity * multiplier)
        mesh.name = `atlas/lantern/${name}`
        mesh.receiveShadow = i < 3
        mesh.frustumCulled = false
        if (i >= 2 && i <= 4) mesh.setColorAt(0, glowColors[0])
        scene.add(mesh)
        parts[i] = mesh
      })
    }
    spans.length = 0
    dirty = true
  }

  function stamp(part, x, y, z, sx, sy, sz, angle, color) {
    transform.position.set(x, y, z)
    transform.scale.set(sx, sy, sz)
    transform.rotation.y = angle
    transform.updateMatrix()
    const matrix = transform.matrix.clone()
    const corners = partCorners[part].map((corner) => corner.clone().applyMatrix4(matrix))
    spans.at(-1).push({ part, matrix, corners, color })
  }

  function place({ i, j }, layout) {
    const span = placeLantern(layout, i, j)
    if (!span) return
    spans.push([])
    const { x, z, endX, endZ, height, yaw } = span
    const mx = (x + endX) / 2
    const mz = (z + endZ) / 2
    const color = glowColors[span.color]
    const direction = Math.atan2(z - endZ, endX - x)
    stamp(0, x, height / 2, z, 1, height, 1, direction)
    stamp(0, endX, height / 2, endZ, 1, height, 1, direction + Math.PI)
    stamp(1, mx, height, mz, Math.hypot(endX - x, endZ - z), 1, 1, direction)
    const hang = (x, z, pigment) => {
      stamp(2, x, height - 0.44, z, 1, 1, 1, yaw, emitterColors[pigment])
      stamp(3, x, height - 0.44, z, 1, 1, 1, yaw, emitterColors[pigment])
      stamp(5, x, height - 0.27, z, 1, 1, 1, yaw)
    }
    if (span.double) {
      hang(mx - 0.58, mz, span.color)
      hang(mx + 0.58, mz, (span.color + 1) % emitterColors.length)
    } else hang(mx, mz, span.color)
    const groundI = cellAt(mx)
    const ground = layout.getCell(groundI, cellAt(mz))
    if (groundI % GUTTER_INTERVAL !== 0 && ground.zone === 'grove' && ground.sockets === 'gggg') {
      stamp(groundPart, mx, 0.013, mz, 0.51, 1, 0.47, 0, color)
    }
  }

  function project(corners, bounds, offset) {
    bounds.makeEmpty()
    for (const corner of corners) {
      point.copy(corner)
      if (offset) point.add(offset)
      point.applyMatrix4(camera.matrixWorldInverse)
      if (point.z >= -camera.near) return false
      point.applyMatrix4(camera.projectionMatrix)
      bounds.expandByPoint(ndc.set(point.x, point.y))
    }
    return true
  }

  function clearOfTroll({ corners }) {
    if (!project(corners, projected)) return false
    if (projected.max.x < -1 || projected.min.x > 1 || projected.min.y > 1) return true
    return projected.min.y >= -0.5 + blurMargin.y && !trolls.some((box) => box.intersectsBox(projected))
  }

  function update() {
    camera.updateMatrixWorld()
    if (!dirty && lastView.equals(camera.matrixWorldInverse) && lastProjection.equals(camera.projectionMatrix)
      && actors.every((actor, i) => lastPositions[i].equals(actor.position))) return
    dirty = false
    lastView.copy(camera.matrixWorldInverse)
    lastProjection.copy(camera.projectionMatrix)
    actors.forEach((actor, i) => lastPositions[i].copy(actor.position))

    // Both trolls keep their buffered bounds clear; if either is behind the camera nothing is drawn.
    const trollInView = actors.map((actor, i) => {
      const inView = project(trollCorners, trolls[i], actor.position)
      trolls[i].expandByVector(blurMargin)
      return inView
    }).every(Boolean)
    for (const mesh of parts) mesh.count = 0
    if (trollInView) {
      for (const span of spans) {
        // Keep the physical rig connected. The ground decal can disappear on its own.
        if (!span.every((stamp) => stamp.part === groundPart || clearOfTroll(stamp))) continue
        for (const stamp of span) {
          const { part, matrix, color } = stamp
          if (part === groundPart && !clearOfTroll(stamp)) continue
          const mesh = parts[part]
          mesh.setMatrixAt(mesh.count, matrix)
          if (color) mesh.setColorAt(mesh.count, color)
          mesh.count++
        }
      }
    }
    for (const mesh of parts) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  registerUpdate(update)
  return { begin, place, end: update }
}
