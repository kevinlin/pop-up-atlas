import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh,
  Object3D, PlaneGeometry, SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FIRST_PAGE_ROW, GUTTER_INTERVAL, LAST_PAGE_ROW } from '../world/tiles.js'
import { look } from '../materials/stage-look.js'
import { craft, craftMap, palette } from './craft.js'
import { unit } from './placement.js'

const mossColors = [new Color(palette.lime), new Color(palette.mint)]
const zoneFelt = {
  amber: new Color(palette.orange), 'pink-lavender': new Color(palette.lavender), teal: new Color(palette.mint),
}
const GUTTER_EDGE = 0.26

function carpetPatch(shader) {
  shader.uniforms.flecks = { value: [new Color(palette.pink), new Color(palette.sky), new Color(palette.butter)] }
  shader.vertexShader = `
    attribute vec4 edgeFuzz;
    varying vec2 mossUV;
    varying vec2 mossXZ;
    flat varying vec4 mossEdge;
    ${shader.vertexShader}
  `.replace('#include <project_vertex>', `#include <project_vertex>
    mossUV = uv;
    mossXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
    mossEdge = edgeFuzz;
  `)
  shader.fragmentShader = `
    varying vec2 mossUV;
    varying vec2 mossXZ;
    flat varying vec4 mossEdge;
    uniform vec3 flecks[3];

    float woolHash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }

    float woolPatch(vec2 p) {
      vec2 f = smoothstep(0.0, 1.0, fract(p));
      vec2 i = floor(p);
      return mix(mix(woolHash(i), woolHash(i + vec2(1, 0)), f.x),
         mix(woolHash(i + vec2(0, 1)), woolHash(i + 1.0), f.x), f.y);
    }

    ${shader.fragmentShader}
  `.replace('#include <color_fragment>', `#include <color_fragment>
    float grain = woolHash(floor(mossXZ * 180.0));
    vec4 edge = vec4(mossUV.x, 1.0 - mossUV.x, mossUV.y, 1.0 - mossUV.y);
    float cut = 0.35 + 0.65 * grain;
    if (mossEdge.x < 0.0) {
      vec2 outline = abs(2.0 * mossUV - 1.0);
      if (dot(outline * outline, outline * outline) > 1.0 - 0.20 * cut) discard;
    } else if (any(lessThan(edge, mossEdge * cut))) discard;

    float pile = woolPatch(mossXZ * 2.4);
    diffuseColor.rgb *= (0.38 + 0.56 * pile) * (0.87 + 0.20 * grain);

    vec2 fleck = mossXZ * 14.0;
    float seed = woolHash(floor(fleck));
    vec2 fibre = (fract(fleck) - vec2(0.26 + 0.47 * seed, 0.69 - 0.35 * seed));
    float fibreShape = length(fibre * vec2(1.0, 1.7));
    float fleckAlpha = step(0.89, seed) * (1.0 - smoothstep(0.10, 0.21, fibreShape));
    vec3 accent = seed > 0.964 ? flecks[0] : seed > 0.929 ? flecks[1] : flecks[2];
    diffuseColor.rgb = mix(diffuseColor.rgb, accent * 0.81, fleckAlpha * 0.86);
  `)
}

function woolBump() {
  const bump = new SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.27, 0.79)
  const positions = []
  const uvs = []
  for (let i = 0; i < 78; i += 1) {
    const angle = i * 2.399963
    const radius = 0.96 * Math.sqrt((i + 0.5) / 78)
    const x = radius * Math.cos(angle)
    const z = radius * Math.sin(angle) * 0.79
    const y = 0.26 * Math.sqrt(1 - radius * radius)
    const tip = 0.09 + unit(5, i, 0, 1) * 0.22
    const dx = 0.018 * Math.cos(angle)
    const dz = 0.018 * Math.sin(angle)
    positions.push(x - dz, y, z + dx, x + dz, y, z - dx,
      x + tip * Math.cos(angle), y + tip, z + tip * Math.sin(angle))
    uvs.push(0.4, 0.3, 0.5, 0.3, 0.45, 0.8)
  }
  const tufts = new BufferGeometry()
  tufts.setAttribute('position', new Float32BufferAttribute(positions, 3))
  tufts.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  tufts.computeVertexNormals()
  const surface = bump.toNonIndexed()
  const clump = mergeGeometries([surface, tufts])
  surface.dispose()
  bump.dispose()
  tufts.dispose()
  return clump
}

export function createMoss(scene) {
  const template = [
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.22, 0.79),
    woolBump(),
  ]
  const material = craft('felt_moss', {
    map: craftMap('felt-base_albedo-7ec1a3f63acb.png'), side: DoubleSide,
  }, carpetPatch)
  const meshes = []
  const transform = new Object3D()
  const color = new Color()
  let zoneColor
  let capacity = 0

  function begin(maxCells) {
    if (maxCells > capacity) {
      capacity = maxCells
      for (let i = 0; i < template.length; i += 1) {
        if (meshes[i]) {
          scene.remove(meshes[i])
          meshes[i].geometry.dispose()
          meshes[i].dispose()
        }
        const slots = capacity * 2
        const geometry = template[i].clone()
        geometry.setAttribute('edgeFuzz', new InstancedBufferAttribute(new Float32Array(slots * 4), 4))
        const mesh = new InstancedMesh(geometry, material, slots)
        mesh.name = `atlas/moss/${i}`
        mesh.frustumCulled = false
        mesh.receiveShadow = true
        mesh.setColorAt(0, mossColors[0])
        scene.add(mesh)
        meshes[i] = mesh
      }
    }
    for (const mesh of meshes) mesh.count = 0
  }

  function placePart(tier, x, y, z, width, height, depth, yaw, tint) {
    const mesh = meshes[tier]
    transform.position.set(x, y, z)
    transform.scale.set(width, height, depth)
    transform.rotation.y = yaw
    transform.updateMatrix()
    mesh.setMatrixAt(mesh.count, transform.matrix)
    color.copy(mossColors[0]).lerp(mossColors[1], tint)
    if (zoneColor) color.lerp(zoneColor, 0.48)
    color.multiplyScalar(tier === 0 ? 0.80 : 0.73)
    mesh.setColorAt(mesh.count, color)
    return mesh.count++
  }

  function place(cell, layout) {
    const { i, j, x, z, tile } = cell
    const grove = tile.zone === 'grove'
    const gutter = i % GUTTER_INTERVAL === 0
    const near = j === LAST_PAGE_ROW
    const far = j === FIRST_PAGE_ROW
    const zMin = far ? -0.78 : -1
    const zMax = near ? 0.78 : 1
    const shade = unit(5, i, j, 1) * 0.48
    const fuzz = meshes[0].geometry.attributes.edgeFuzz
    zoneColor = look.zones ? zoneFelt[layout.zoneKeyAt(i, j)] : undefined
    if (!grove) {
      if (gutter || tile.sockets !== 'gggg') return
      // A low scalloped mat leaves paper around its perimeter and between the meadow pieces.
      const slot = placePart(0, x, 0.0008, z + (zMin + zMax) / 2, 2, 1, zMax - zMin, 0, shade + 0.20)
      fuzz.setXYZW(slot, -1, 0, 0, 0)
      return
    }
    const leftEdge = layout.getCell(i - 1, j).zone !== 'grove'
    const rightEdge = layout.getCell(i + 1, j).zone !== 'grove'
    const farEdge = far || layout.getCell(i, j - 1).zone !== 'grove'
    const nearEdge = near || layout.getCell(i, j + 1).zone !== 'grove'
    const base = (left, right, tuckLeft, tuckRight) => {
      const slot = placePart(0, x + (left + right) / 2, 0.0008, z + (zMax + zMin) / 2,
        right - left, 1, zMax - zMin, 0, shade)
      fuzz.setXYZW(slot, tuckLeft ? 0.031 : 0, tuckRight ? 0.031 : 0, nearEdge ? 0.028 : 0, farEdge ? 0.028 : 0)
    }
    if (gutter) {
      base(-1, -GUTTER_EDGE, leftEdge, true)
      base(GUTTER_EDGE, 1, true, rightEdge)
    } else {
      base(-1, 1, leftEdge, rightEdge)
    }

    // Keep the long pile away from river, path and gutter surfaces.
    if (gutter || tile.sockets !== 'gggg') return
    for (let n = 0; n < 3; n += 1) {
      const dx = (unit(5, i, j, 10 + n) - 0.5) * 1.12
      const dz = (unit(5, i, j, 20 + n) - 0.5) * (near || far ? 0.80 : 1.32)
      const width = 0.14 + 0.12 * unit(5, i, j, 30 + n)
      placePart(n === 2 ? 2 : 1, x + dx, 0.002, z + dz, width, 0.10 + 0.034 * n, width,
        unit(5, i, j, 40 + n) * Math.PI, shade + 0.16)
    }
  }

  function end() {
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.geometry.attributes.edgeFuzz.needsUpdate = true
    }
  }

  return { begin, place, end }
}
