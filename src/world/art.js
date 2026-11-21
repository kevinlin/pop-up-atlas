import {
  Box3, BoxGeometry, Color, CylinderGeometry, Float32BufferAttribute, InstancedMesh,
  Matrix4, MeshLambertMaterial, StaticDrawUsage, DynamicDrawUsage, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { applyCraftMaterial } from '../materials/index.js'
import { hash } from './hash.js'
import { BRIDGE_HALF_WIDTH, GUTTER_INTERVAL, RIVER_HALF_WIDTH, TILES, TILE_SIZE } from './tiles.js'
import { FLAT } from './spring.js'

const mat = new MeshLambertMaterial({ vertexColors: true })

function piece(geometry, color, x, y, z) {
  const rgb = new Color(color)
  const colors = new Float32Array(geometry.attributes.position.count * 3)
  for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i)
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry.translate(x, y, z)
}

function box(color, x, y, z, width, height, depth, angle = 0) {
  return piece(new BoxGeometry(width, height, depth).rotateZ(angle), color, x, y, z)
}

function disc(color, x, y, z, radius, scaleY = 1, sides = 16) {
  const geometry = new CylinderGeometry(radius, radius, 0.008, sides)
  geometry.rotateX(Math.PI / 2).scale(1, scaleY, 1)
  return piece(geometry, color, x, y, z)
}

function strip(color, x, z, width, depth, y = 0.002) {
  return box(color, x, y, z, width, 0.003, depth)
}

function corner(color, halfWidth) {
  const length = 1 + halfWidth
  const center = (1 - halfWidth) / 2
  return [
    strip(color, 0, -center, 2 * halfWidth, length),
    strip(color, center, 0, length, 2 * halfWidth, 0.003),
  ]
}

function placeholderParts() {
  const pink = 0xe8478f
  const lavender = 0xb79ae0
  const mint = 0x9ee0b8
  const leaf = 0x78ad54
  const butter = 0xf7dc6f
  const sky = 0x7ec8e8
  const path = 0xf2c181
  const petal = Array.from({ length: 7 }, (_, index) => {
    const angle = index * 2 * Math.PI / 7
    return disc(pink, 0.36 * Math.cos(angle), 1.05 + 0.36 * Math.sin(angle), 0, 0.23)
  })
  const cap = disc(0xd9453b, 0, 0.86, 0, 0.66, 0.57)
  return {
    meadow: { hinges: [[
      box(leaf, -0.12, 0.12, 0, 0.062, 0.25, 0.009, 0.35),
      box(mint, 0, 0.16, 0, 0.055, 0.32, 0.009, -0.13),
      box(leaf, 0.12, 0.1, 0, 0.06, 0.22, 0.009, -0.45),
    ]] },
    flower: { hinges: [[
      box(leaf, 0, 0.49, 0, 0.1, 0.98, 0.009),
      disc(leaf, 0.21, 0.41, 0, 0.22, 0.35),
      disc(mint, -0.18, 0.59, 0, 0.23, 0.42),
    ], [
      ...petal,
      disc(butter, 0, 1.05, 0.0015, 0.25),
      disc(0xf59a3c, 0, 1.05, 0.003, 0.1),
    ]] },
    mushroom_house: { hinges: [[
      box(0xf5c68f, 0, 0.37, 0, 0.62, 0.74, 0.009),
      disc(0x975263, 0, 0.18, 0.003, 0.16, 1.2),
      disc(lavender, 0.16, 0.51, 0.003, 0.085),
    ], [
      cap,
      disc(0xfff8ec, -0.32, 0.92, 0.003, 0.11),
      disc(0xfff8ec, 0.04, 1.07, 0.003, 0.115),
      disc(0xfff8ec, 0.36, 0.86, 0.003, 0.083),
    ]] },
    cupcake_tree: { hinges: [[
      box(0x8a5a3b, 0, 0.41, 0, 0.12, 0.82, 0.009),
      box(0xebac61, 0, 0.76, 0, 0.76, 0.36, 0.009),
      ...[-0.24, -0.08, 0.08, 0.24].map((x) =>
        box(butter, x, 0.76, 0.003, 0.035, 0.35, 0.008)),
    ], [
      disc(lavender, 0, 1.04, 0, 0.52, 0.48),
      disc(0xf4a6c8, 0, 1.2, 0.002, 0.37, 0.6),
      disc(0xd9453b, 0.03, 1.46, 0.003, 0.12),
    ]] },
    path_straight: { base: [strip(path, 0, 0, 0.47, 2)] },
    path_corner: { base: corner(path, 0.235) },
    river_straight: { base: [strip(sky, 0, 0, 2 * RIVER_HALF_WIDTH, 2)] },
    river_corner: { base: corner(sky, RIVER_HALF_WIDTH) },
    yarn_bridge: {
      base: [
        strip(sky, 0, 0, 2 * RIVER_HALF_WIDTH, 2),
        strip(path, 0, 0, 2, 2 * BRIDGE_HALF_WIDTH, 0.009),
        ...[-0.4, -0.24, -0.08, 0.08, 0.24, 0.4].map((x) =>
          strip(0x9b654d, x, 0, 0.023, 2 * BRIDGE_HALF_WIDTH, 0.012)),
      ],
      hingeZ: [-BRIDGE_HALF_WIDTH, BRIDGE_HALF_WIDTH],
      hinges: Array.from({ length: 2 }, () => [
        box(0x7a52c7, 0, 0.18, 0, 1, 0.045, 0.009),
        ...[-0.46, 0.46].map((x) => box(0xe8478f, x, 0.12, 0, 0.05, 0.24, 0.01)),
      ]),
    },
  }
}

const GUTTER_HALF_WIDTH = 0.26
const CARD_YAW_LIMIT = Math.PI / 15
const MEADOW_MODELS = ['meadow_a', 'meadow_b', 'meadow_c']
const PAGE_DECORATIONS = ['page_deco_a', 'page_deco_b', 'page_deco_c']
const hingeIndex = (name) => /^hinge_(\d+)$/.exec(name)
const hingeOrder = (a, b) => b.height - a.height || a.index - b.index

export function createArt(scene) {
  const batches = []
  const models = new Map()
  const pageModels = new Map()
  const showGutter = { value: 0 }
  const hingeMatrix = new Matrix4()
  const angleMatrix = new Matrix4()
  const pageMatrix = new Matrix4()
  let loader
  let capacity = 0
  let revision = 0

  function clipPageAtGutter(material, gutter = false) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.atlasGutter = showGutter
      shader.uniforms.atlasGutterSide = { value: gutter ? -1 : 1 }
      shader.vertexShader = `varying float atlasPageX;
${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\natlasPageX = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).x;',
      )
      const period = GUTTER_INTERVAL * TILE_SIZE
      shader.fragmentShader = `varying float atlasPageX;
uniform float atlasGutter;
uniform float atlasGutterSide;
${shader.fragmentShader}`.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float gutterEdge = abs(mod(atlasPageX + ${period / 2}.0, ${period}.0) - ${period / 2}.0) - ${GUTTER_HALF_WIDTH};
        if (atlasGutter > 0.0 && gutterEdge * atlasGutterSide < 0.0) discard;`,
      )
    }
    return material
  }

  function addBatch(geometry, material, moving = false, name = '') {
    const result = { geometry, material, moving, count: 0, name }
    batches.push(result)
    return result
  }

  function primitiveBatch(parts, moving = false, material = mat) {
    if (!parts?.length) return []
    const geometry = mergeGeometries(parts)
    for (const part of parts) part.dispose()
    return [addBatch(geometry, material, moving)]
  }

  const page = primitiveBatch([
    strip(0xc7aa86, 0, 0, 2, 2, -0.002),
    strip(0xf6ead2, 0, 0, 1.973, 1.973, -0.0015),
  ], false, clipPageAtGutter(mat.clone()))
  const placeholders = new Map(Object.entries(placeholderParts()).map(([id, parts]) => [
    id, {
      base: primitiveBatch(parts.base),
      hinges: (parts.hinges ?? []).map((geometry, index) => {
        const batches = primitiveBatch(geometry, true)
        batches[0].geometry.computeBoundingBox()
        return { index, height: batches[0].geometry.boundingBox.max.y, batches, z: parts.hingeZ?.[index] ?? 0 }
      }).sort(hingeOrder),
    },
  ]))

  function modelBatches(root, id, moving = false, isPage = false) {
    const parts = []
    const gutter = id === 'gutter'
    const page = isPage || gutter
    const inversePivot = new Matrix4()
    if (moving) inversePivot.copy(root.matrixWorld).invert()

    root.traverse((node) => {
      if (!node.isMesh) return
      const transform = new Matrix4().multiplyMatrices(inversePivot, node.matrixWorld)
      const geometry = node.geometry.clone().applyMatrix4(transform)
      if (page) clipPageAtGutter(node.material, gutter)
      parts.push(addBatch(geometry, applyCraftMaterial(node.material, { moving, page, tile: id }), moving, `atlas/${id}/${node.name}`))
    })
    return parts
  }

  async function load(id, isPage = false) {
    const url = new URL(`models/tiles/${id}.glb`, document.baseURI)
    const response = await fetch(url)
    if (!response.ok) return
    const data = await response.arrayBuffer()
    // Preview servers may send the app HTML for a missing asset.
    if (data.byteLength < 12 || new DataView(data).getUint32(0, true) !== 0x46546c67) return
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    loader ??= new GLTFLoader()
    const { scene } = await loader.parseAsync(data, new URL('.', url).href)
    const model = scene.getObjectByName(id) ?? scene
    model.updateWorldMatrix(true, true)
    const base = model.getObjectByName('base')
    if (isPage) {
      pageModels.set(id, modelBatches(base ?? model, id, false, id !== 'gutter'))
      if (id === 'gutter') showGutter.value = 1
    } else {
      const hinges = []
      model.traverse((node) => {
        const match = hingeIndex(node.name)
        if (!match) return
        // Bake each mesh into its authored pivot space so a tile can share draw calls.
        const pivot = node.clone(false)
        node.matrixWorld.decompose(pivot.position, pivot.quaternion, pivot.scale)
        hinges.push({
          index: Number(match[1]),
          height: new Box3().setFromObject(node, true).max.y,
          node: pivot,
          batches: modelBatches(node, id, true),
        })
      })
      hinges.sort(hingeOrder)
      models.set(id, { base: base ? modelBatches(base, id) : [], hinges })
    }
    revision += 1
  }

  const loads = []
  if (typeof document !== 'undefined') {
    for (const { id } of TILES) {
      if (id !== 'meadow') loads.push(load(id).catch(() => {}))
    }
    for (const id of MEADOW_MODELS) loads.push(load(id).catch(() => {}))
    for (const id of ['page_a', 'page_b', 'gutter', ...PAGE_DECORATIONS]) {
      loads.push(load(id, true).catch(() => {}))
    }
  }
  const ready = Promise.all(loads)

  function begin(maxCells) {
    const grow = maxCells > capacity
    capacity = Math.max(capacity, maxCells)
    for (const batch of batches) {
      batch.count = 0
      if (batch.mesh && !grow) continue
      if (batch.mesh) {
        scene.remove(batch.mesh)
        batch.mesh.dispose()
      }
      const mesh = new InstancedMesh(batch.geometry, batch.material, capacity)
      mesh.name = batch.name
      mesh.instanceMatrix.setUsage(batch.moving ? DynamicDrawUsage : StaticDrawUsage)
      mesh.receiveShadow = true
      mesh.castShadow = batch.moving
      mesh.frustumCulled = false
      scene.add(mesh)
      batch.mesh = mesh
    }
  }

  // Meadow has no collision, so shift and scale it per cell to hide the tile grid.
  function meadowMatrix(yaw, i, j, x, z) {
    const unit = (salt) => 2 * hash(0, i, j, salt) / 0xffffffff - 1
    const scale = 1 + 0.12 * unit(11)
    return new Matrix4().makeRotationY(yaw).scale(new Vector3(scale, scale, scale))
      .setPosition(x + 0.25 * unit(9), 0, z + 0.25 * unit(10))
  }

  function modelAt({ tile, i, j }) {
    const id = tile.id === 'meadow' ? MEADOW_MODELS[hash(0, i, j, 6) % MEADOW_MODELS.length] : tile.id
    return models.get(id)
  }

  function create({ tile, i, j, x, z }, model) {
    const template = model ?? placeholders.get(tile.id)
    const meadow = tile.id === 'meadow'
    const clearing = meadow && tile.zone === 'clearing'
    const scale = tile.scale ?? 1
    const yaw = tile.sockets === 'gggg'
      ? (2 * hash(0, i, j, 7) / 0xffffffff - 1) * CARD_YAW_LIMIT
      : tile.rotation * Math.PI / 2
    return {
      model,
      base: clearing && hash(0, i, j, 17) % 4 !== 0 ? [] : template.base,
      hinges: clearing ? [] : template.hinges.map((hinge) => ({ ...hinge, node: hinge.node?.clone(false) })),
      tileMatrix: meadow ? meadowMatrix(yaw, i, j, x, z) : new Matrix4().makeRotationY(yaw)
        .scale(new Vector3(scale, scale, scale)).setPosition(x + (tile.offsetX ?? 0), 0, z + (tile.offsetZ ?? 0)),
    }
  }

  function place(parts, matrix) {
    for (const batch of parts) batch.mesh.setMatrixAt(batch.count++, matrix)
  }

  function placeTile(cell) {
    const { art, x, z } = cell
    const pageId = hash(0, cell.i, cell.j, 5) & 1 ? 'page_b' : 'page_a'
    const layers = pageModels.get(pageId)
    pageMatrix.makeTranslation(x, 0, z)
    place(layers?.length ? layers : page, pageMatrix)
    if (cell.i % GUTTER_INTERVAL === 0) place(pageModels.get('gutter') ?? [], pageMatrix)

    const decoration = hash(0, cell.i, cell.j, 8)
    if ((decoration & 3) === 0) {
      const id = PAGE_DECORATIONS[(decoration >>> 4) % PAGE_DECORATIONS.length]
      const rotation = ((decoration >>> 2) & 3) * Math.PI / 2
      pageMatrix.makeRotationY(rotation).setPosition(x, 0, z)
      place(pageModels.get(id) ?? [], pageMatrix)
    }

    place(art.base, art.tileMatrix)
    for (const hinge of art.hinges) {
      if (!hinge.batches.length) continue
      hinge.slot = hinge.batches[0].count
      for (const batch of hinge.batches) batch.count += 1
      poseHinge(art, hinge)
    }
  }

  function poseHinge(art, hinge) {
    const angle = hinge.angle ?? FLAT
    let transform
    if (hinge.node) {
      hinge.node.rotation.x = angle
      hinge.node.updateMatrix()
      transform = hinge.node.matrix
    } else {
      const height = 0.010 + Math.min(hinge.index, 2) * 0.003
      transform = angleMatrix.makeRotationX(angle).setPosition(0, height, hinge.z)
    }
    hingeMatrix.multiplyMatrices(art.tileMatrix, transform)
    for (const batch of hinge.batches) {
      batch.mesh.setMatrixAt(hinge.slot, hingeMatrix)
      batch.mesh.instanceMatrix.needsUpdate = true
    }
  }

  const oldPage = scene.getObjectByName('placeholder-page')
  if (oldPage) oldPage.visible = false

  function end() {
    for (const { mesh, count } of batches) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  return { begin, create, placeTile, end, poseHinge, modelAt, revision: () => revision, ready }
}
