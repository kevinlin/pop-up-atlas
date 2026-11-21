import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NodeIO, Primitive } from '@gltf-transform/core'
import { Box3, Matrix4, Vector3 } from 'three'

const terrain = [
  'meadow', 'meadow_a', 'meadow_b', 'meadow_c', 'flower', 'mushroom_house', 'cupcake_tree', 'path_straight',
  'path_corner', 'river_straight', 'river_corner', 'yarn_bridge',
]
const heroes = ['flower', 'mushroom_house', 'cupcake_tree']
const pages = ['page_a', 'page_b']
const decorations = ['page_deco_a', 'page_deco_b', 'page_deco_c']
const required = [...terrain, ...pages, ...decorations, 'gutter']
const epsilon = 0.0001
const identity = [0, 0, 0, 1]
const one = [1, 1, 1]
const near = (values, reference) => values.every((v, i) => Math.abs(v - reference[i]) <= epsilon)
const fmt = (n) => n.toFixed(4)

function inspectContainer(binary, check) {
  if (binary.length < 20 || binary.readUInt32LE(0) !== 0x46546c67 ||
      binary.readUInt32LE(4) !== 2 || binary.readUInt32LE(8) !== binary.length ||
      binary.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error('expected a glTF 2.0 binary with a JSON chunk')
  }
  const json = JSON.parse(binary.toString('utf8', 20, 20 + binary.readUInt32LE(12)))
  for (const [index, source] of (json.images ?? []).entries()) {
    if (source.bufferView !== undefined || !/^textures\/[a-z0-9_-]+\.(png|webp)$/.test(source.uri)) {
      throw new Error(`image ${index} must use a relative textures/ PNG or WebP URI`)
    }
  }
  for (const source of json.buffers ?? []) {
    check(source.uri === undefined, 'buffer is not embedded')
  }
  check(!(json.animations?.length), 'contains baked animation clips')
  return new Set((json.images ?? []).map(({ uri }) => uri))
}

function geometryUnder(parent, inspectMesh) {
  const bounds = new Box3()
  const position = new Vector3()
  const matrix = new Matrix4()
  parent.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    matrix.fromArray(node.getWorldMatrix())
    for (const primitive of mesh.listPrimitives()) {
      const vertices = primitive.getAttribute('POSITION')
      inspectMesh?.(primitive, vertices)
      if (!vertices) continue
      const positions = vertices.getArray()
      for (let i = 0; i < positions.length; i += 3) {
        position.fromArray(positions, i).applyMatrix4(matrix)
        if (!Number.isFinite(position.lengthSq())) throw new Error('non-finite world position')
        bounds.expandByPoint(position)
      }
    }
  })
  return bounds
}

function footprint(bounds, limit) {
  const { min, max } = bounds
  return min.x >= -limit - epsilon && min.z >= -limit - epsilon &&
    max.x <= limit + epsilon && max.z <= limit + epsilon
}

function pageHasNoBorder(root) {
  const primitives = []
  root.traverse((node) => {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) primitives.push(primitive)
  })
  if (primitives.length !== 1) return false
  const primitive = primitives[0]
  const positions = primitive.getAttribute('POSITION')
  const uv = primitive.getAttribute('TEXCOORD_0')
  if (!positions || !uv || positions.getCount() !== 4 || uv.getCount() !== 4) return false
  const corners = []
  for (let i = 0; i < 4; i++) {
    const [x, y, z] = positions.getElement(i, [])
    const [s, t] = uv.getElement(i, [])
    if (!near([Math.abs(x), y, Math.abs(z)], [1, 0, 1]) ||
        !near([Math.abs(s - .5), Math.abs(t - .5)], [.5, .5])) return false
    corners.push({ x, z, s, t })
  }
  return corners.every((a) => corners.filter((b) =>
    near([Math.hypot(a.x - b.x, a.z - b.z), Math.hypot(a.s - b.s, a.t - b.t)], [2, 1])).length === 2)
}

function horizontalCoverage(root) {
  const covered = new Set()
  let largest = 0
  const side = 13
  const matrix = new Matrix4()
  const sample = Array.from({ length: side }, (_, i) => -.9 + i * 1.8 / (side - 1))
  const cross = (a, b, x, z) => (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)
  root.traverse((node) => {
    matrix.fromArray(node.getWorldMatrix())
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const positions = primitive.getAttribute('POSITION')
      if (!positions || primitive.getMode() !== Primitive.Mode.TRIANGLES) continue
      const raw = positions.getArray()
      const indices = primitive.getIndices()?.getArray()
      const vertices = Array.from({ length: positions.getCount() },
        (_, i) => new Vector3().fromArray(raw, i * 3).applyMatrix4(matrix))
      const count = indices?.length ?? vertices.length
      const patch = new Set()
      for (let i = 0; i + 2 < count; i += 3) {
        const a = vertices[indices?.[i] ?? i]
        const b = vertices[indices?.[i + 1] ?? i + 1]
        const c = vertices[indices?.[i + 2] ?? i + 2]
        if (!a || !b || !c || Math.max(Math.abs(a.y), Math.abs(b.y), Math.abs(c.y)) > .04) continue
        const area = cross(a, b, c.x, c.z)
        if (Math.abs(area) < 1e-8) continue
        const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x)
        const minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z)
        const sign = Math.sign(area)
        for (let row = 0; row < side; row++) {
          const z = sample[row]
          if (z < minZ - epsilon || z > maxZ + epsilon) continue
          for (let col = 0; col < side; col++) {
            const x = sample[col]
            if (x < minX - epsilon || x > maxX + epsilon) continue
            if ([cross(a, b, x, z), cross(b, c, x, z), cross(c, a, x, z)]
              .every((edge) => edge * sign >= -1e-8)) patch.add(row * side + col)
          }
        }
      }
      largest = Math.max(largest, patch.size)
      for (const pixel of patch) covered.add(pixel)
    }
  })
  return { total: covered.size / side ** 2, largest: largest / side ** 2 }
}

async function inspect(io, path, id, shared) {
  const problems = []
  const check = (pass, message) => { if (!pass) problems.push(message) }
  check(required.includes(id), `unknown tile id "${id}"`)
  const bytes = await readFile(path)
  const images = inspectContainer(bytes, check)
  const doc = await io.read(path)
  const data = doc.getRoot()
  const scene = data.getDefaultScene() ?? data.listScenes()[0]
  const nodes = scene?.listChildren() ?? []
  const root = nodes[0]
  check(data.listScenes().length === 1 && nodes.length === 1 && root?.getName() === id,
    `expected a single scene root named "${id}"`)
  if (!root) return { problems }
  check(near(root.getTranslation(), [0, 0, 0]) && near(root.getRotation(), identity) &&
    near(root.getScale(), one) && !root.getMesh(), 'root must be an empty at the page origin')

  const children = root.listChildren()
  const bases = children.filter((node) => node.getName() === 'base')
  check(bases.length === 1 && !bases[0]?.getMesh(), 'expected one empty base node')
  const hinges = []
  for (const node of children) {
    if (node.getName() === 'base') continue
    const axis = /^fold_axis_(\d+)$/.exec(node.getName())
    if (axis) {
      const mounted = node.listChildren()
      const [rx, , rz] = node.getRotation()
      check(!node.getMesh() && !node.getCamera() && mounted.length === 1 &&
        mounted[0]?.getName() === `hinge_${axis[1]}` && near(node.getScale(), one) &&
        near([rx, rz], [0, 0]), `${node.getName()} must be a yaw-only mount for one hinge`)
      hinges.push(...mounted.filter((child) => /^hinge_\d+$/.test(child.getName())))
    } else if (/^hinge_\d+$/.test(node.getName())) {
      hinges.push(node)
    } else {
      check(false, `unexpected root child "${node.getName()}"`)
    }
  }
  const isTerrain = terrain.includes(id)
  check(isTerrain ? hinges.length > 0 : hinges.length === 0,
    isTerrain ? 'expected at least one hinge' : 'page pieces must remain static')
  const names = new Set(hinges.map((node) => node.getName()))
  check(hinges.every((_, index) => names.has(`hinge_${index}`)), 'hinge names must start at 0 and be contiguous')
  root.traverse((node) => {
    if (node.getName().startsWith('hinge_')) {
      check(hinges.includes(node), `${node.getName()} is nested outside a valid fold mount`)
    }
  })
  for (const hinge of hinges) {
    const label = hinge.getName()
    check(!hinge.getMesh() && !hinge.getCamera() && hinge.listChildren().length > 0, `${label} must be an empty pivot`)
    check(Math.abs(hinge.getWorldTranslation()[1]) <= epsilon && near(hinge.getRotation(), identity) &&
      near(hinge.getScale(), one), `${label} must sit on y=0 with identity rotation and scale`)
  }

  let triangles = 0
  const upright = geometryUnder(root, (primitive, vertices) => {
    check(primitive.getMode() === Primitive.Mode.TRIANGLES, 'mesh primitive must use triangles')
    check(Boolean(vertices), 'mesh primitive is missing POSITION')
    const count = primitive.getIndices()?.getCount() ?? vertices?.getCount() ?? 0
    check(count > 0 && count % 3 === 0, `invalid triangle index/vertex count ${count}`)
    triangles += count / 3
    check(Boolean(primitive.getMaterial()), 'mesh primitive is missing a material')
  })
  const uprightLimit = heroes.includes(id) ? 1.2 : 1
  check(!upright.isEmpty() && footprint(upright, uprightLimit) && upright.max.y <= 1.8 + epsilon,
    `upright bounds [${upright.min.toArray().map(fmt)}]…[${upright.max.toArray().map(fmt)}] exceed limits`)
  check(triangles <= 15_000, `triangle budget exceeded (${triangles})`)
  if (isTerrain && bases[0]) {
    const { total, largest } = horizontalCoverage(bases[0])
    check(total < .96 && largest < .78,
      `terrain base acts like a ground plane (${Math.round(largest * 100)}% in one primitive, ` +
      `${Math.round(total * 100)}% combined)`)
  }
  if (pages.includes(id)) {
    check(near(upright.min.toArray(), [-1, 0, -1]) && near(upright.max.toArray(), [1, 0, 1]) &&
      triangles === 2 && pageHasNoBorder(root), 'page must be one full 2×2 quad at y=0 with no edge features')
  }
  if (decorations.includes(id)) {
    check(footprint(upright, .96) && upright.min.y >= -epsilon && upright.max.y <= .03,
      'page decoration must stay above the page and leave the edges clear')
  }
  if (id === 'gutter') {
    check(near([upright.min.x, upright.min.z, upright.max.x, upright.max.z], [-1, -1, 1, 1]) &&
      upright.min.y < 0 && upright.min.y >= -.08 - epsilon, 'gutter must fill the cell around a valley at most 0.08 deep')
  }

  const flat = new Box3()
  // Cupped petals and the chunky twisted bridge rail stand proud of the card; all else stays thin.
  const flatLimit = { flower: .08, yarn_bridge: .08 }[id] ?? .03
  const angle = -Math.PI / 4
  for (const hinge of hinges) hinge.setRotation([Math.sin(angle), 0, 0, Math.cos(angle)])
  for (const hinge of hinges) {
    const pose = geometryUnder(hinge)
    const label = hinge.getName()
    check(!pose.isEmpty(), `${label} has no geometry`)
    check(footprint(pose, 1.2), `${label} flat X/Z bounds [${fmt(pose.min.x)}, ${fmt(pose.min.z)}]…` +
      `[${fmt(pose.max.x)}, ${fmt(pose.max.z)}] exceed ±1.2`)
    check(pose.min.y >= -epsilon && pose.max.y <= flatLimit + epsilon,
      `${label} flat y=${fmt(pose.min.y)}…${fmt(pose.max.y)}, expected 0…${flatLimit}`)
    flat.union(pose)
  }

  const materials = data.listMaterials()
  const materialNames = materials.map((material) => material.getName())
  const has = (prefix) => materialNames.some((name) => name.startsWith(prefix))
  for (const material of materials) {
    const name = material.getName()
    check(/^(felt|card|glitter|yarn)_.+$/.test(name), `invalid material prefix "${name}"`)
    check(Boolean(material.getBaseColorTexture()), `${name} needs a base-colour texture`)
    if (/^(felt|card)_/.test(name)) {
      check(material.getRoughnessFactor() >= .85 - epsilon, `${name} roughness must be at least 0.85`)
    }
    if (name.startsWith('felt_fringe_')) {
      check(material.getAlphaMode() === 'MASK', `${name} needs an alpha-tested fibre edge`)
    }
  }
  if (isTerrain) check(!has('card_page') && has('felt_fringe_'), 'terrain needs felt fringe and must omit the page')
  if (pages.includes(id)) {
    check(materialNames.length === 1 && materialNames[0] === 'card_page' && images.size === 1,
      'page needs a single paper material and texture')
    const texture = materials[0]?.getBaseColorTexture()
    const signature = JSON.stringify([texture?.getURI(), materials[0]?.getBaseColorFactor()])
    shared.pageSignature ??= signature
    check(shared.pageSignature === signature, 'page variants must share their paper texture and tint')
  }
  if (decorations.includes(id)) {
    check(has('card_washi_') && has('yarn_') && has('felt_'), 'decoration needs washi and a stitched felt patch')
  }
  if (id.startsWith('river_') || id === 'yarn_bridge') {
    check(materialNames.includes('glitter_river'), 'river must use glitter_river')
  }
  if (id === 'yarn_bridge' || id === 'gutter') check(has('yarn_'), 'bridge and spine require yarn')
  const textures = data.listTextures()
  check(images.size > 0 && images.size <= 10, `expected 1–10 shared image URIs, got ${images.size}`)
  for (const texture of textures) {
    const size = texture.getSize()
    const uri = texture.getURI()
    const data = texture.getImage()
    check(images.has(uri) && data?.byteLength > 0 && size?.every((n) => n > 0 && n <= 1024),
      `texture "${texture.getName()}" must resolve to a shared image at most 1024×1024`)
    if (data && !shared.uris.has(uri)) {
      const digest = createHash('sha256').update(data).digest('hex')
      const existing = shared.digests.get(digest)
      check(!existing || existing === uri, `texture "${uri}" duplicates "${existing}"`)
      shared.digests.set(digest, uri)
      shared.uris.set(uri, data.byteLength)
    }
  }

  return { problems, triangles, textures: images.size, hinges: hinges.length, upright, flat }
}

const directory = process.argv[2] ?? 'public/models/tiles'
const io = new NodeIO()
const shared = { digests: new Map(), uris: new Map() }
const files = (await readdir(directory)).filter((file) => file.endsWith('.glb'))
const ordered = [...required, ...files.map((file) => file.slice(0, -4)).filter((id) => !required.includes(id)).sort()]
let passed = 0
console.log(`Inspecting ${directory}`)
for (const id of ordered) {
  try {
    const result = await inspect(io, join(directory, `${id}.glb`), id, shared)
    if (result.problems.length) {
      console.error(`FAIL ${id}:\n  ${result.problems.join('\n  ')}`)
      continue
    }
    const { triangles, textures, hinges, upright, flat } = result
    const pose = hinges ? `, flat y=${fmt(flat.min.y)}…${fmt(flat.max.y)}` : ''
    console.log(`PASS ${id}: ${triangles} triangles, ${textures} shared textures, ${hinges} hinges, ` +
      `upright height ${fmt(upright.max.y)}${pose}`)
    passed += 1
  } catch (error) {
    console.error(`FAIL ${id}: ${error.code === 'ENOENT' ? 'missing GLB' : error.message}`)
  }
}
const textureBytes = [...shared.uris.values()].reduce((sum, bytes) => sum + bytes, 0)
console.log(`${passed}/${ordered.length} GLBs passed. ${shared.uris.size} unique textures, ${textureBytes.toLocaleString('en-US')} bytes.`)
process.exitCode = passed === ordered.length ? 0 : 1
