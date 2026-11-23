import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO, Primitive } from '@gltf-transform/core'
import { Box3, Matrix4, Vector3 } from 'three'
import { hash } from '../src/world/hash.js'
import { createLayout } from '../src/world/layout.js'

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

// Round 6 (TIL6), contract "Round 6" → Light, ground and props.
const meadows = ['meadow', 'meadow_a', 'meadow_b', 'meadow_c']
const MEADOW_MODELS = ['meadow_a', 'meadow_b', 'meadow_c']
// The mean appliqué/decoration piece area of the fa6d96b GLBs, measured by `pieceStats` below
// (`--measure public/models/tiles` at that commit; the numbers are in .handoff/evidence/TIL6/baseline.json).
// `--baseline FILE` replaces them with another measurement file.
export const BASELINE = { commit: 'fa6d96b', meadow: 0.7856301586031182, pageDeco: 0.08143231966757931 }
export const AREA_RATIO = 1.5
// A piece is a welded island of felt or card under `base` of at least this projected area, which leaves out
// the glue tabs (about 0.02) and the ground sprigs (under 0.01).
export const PIECE_MIN_AREA = 0.03
export const LAYER_SIDE = 64
export const LAYER_OVERLAP = 0.4
export const MOTIF_SHARE_LIMIT = 0.4
export const MOTIF_MIN = 4
export const MOTIF_SEEDS = 20
export const MOTIF_SIDE = 64
export const DOME_SPAN_DEGREES = 60
export const DOME_DEPTH_RATIO = 0.4
const DOME_FLAT_LIMIT = 0.08
const THIN_FLAT_LIMIT = 0.03
const pieceMaterial = /^(felt|card)_/
const notPiece = /^(felt_fringe_|card_page)/
const domeName = /^dome_\d+$/
const secName = /^sec_\d+$/
const applName = /^appl_\d+$/
const decoName = /^deco_([a-z]+)_\d+$/

export function collectTriangles(node, accept = () => true) {
  const result = []
  const matrix = new Matrix4()
  node.traverse((child) => {
    const mesh = child.getMesh()
    if (!mesh) return
    matrix.fromArray(child.getWorldMatrix())
    for (const primitive of mesh.listPrimitives()) {
      const name = primitive.getMaterial()?.getName() ?? ''
      const positions = primitive.getAttribute('POSITION')
      if (!positions || primitive.getMode() !== Primitive.Mode.TRIANGLES || !accept(name)) continue
      const raw = positions.getArray()
      const indices = primitive.getIndices()?.getArray()
      const vertex = (k) => new Vector3().fromArray(raw, k * 3).applyMatrix4(matrix)
      const count = indices?.length ?? positions.getCount()
      for (let i = 0; i + 2 < count; i += 3) {
        result.push({
          name,
          a: vertex(indices?.[i] ?? i),
          b: vertex(indices?.[i + 1] ?? i + 1),
          c: vertex(indices?.[i + 2] ?? i + 2),
        })
      }
    }
  })
  return result
}

const triangleNormal = (t) => new Vector3().subVectors(t.b, t.a).cross(new Vector3().subVectors(t.c, t.a))

// Projected (XZ) area of every welded island of felt or card under `base`; only up-facing faces count, so
// each piece is measured once. Blender splits vertices at hard edges, so the weld goes by position.
export function pieceStats(root, minArea = PIECE_MIN_AREA) {
  const base = root.listChildren().find((node) => node.getName() === 'base')
  const triangles = base
    ? collectTriangles(base, (name) => pieceMaterial.test(name) && !notPiece.test(name))
    : []
  const parent = new Map()
  const find = (key) => {
    let k = key
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)))
      k = parent.get(k)
    }
    return k
  }
  const key = (v) => `${Math.round(v.x * 2e4)},${Math.round(v.y * 2e4)},${Math.round(v.z * 2e4)}`
  const keys = triangles.map((t) => [key(t.a), key(t.b), key(t.c)])
  for (const ring of keys) for (const k of ring) if (!parent.has(k)) parent.set(k, k)
  for (const [a, b, c] of keys) {
    parent.set(find(b), find(a))
    parent.set(find(c), find(a))
  }
  const area = new Map()
  triangles.forEach((t, i) => {
    const n = triangleNormal(t)
    if (n.y <= 0) return
    const island = find(keys[i][0])
    area.set(island, (area.get(island) ?? 0) + n.y / 2)
  })
  const areas = [...area.values()].filter((a) => a >= minArea).sort((p, q) => q - p)
  return { areas, count: areas.length, mean: areas.length ? areas.reduce((s, a) => s + a, 0) / areas.length : 0 }
}

function insideTriangle(t, x, z) {
  const edge = (p, q) => (q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x)
  const e = [edge(t.a, t.b), edge(t.b, t.c), edge(t.c, t.a)]
  return e.every((v) => v >= -1e-9) || e.every((v) => v <= 1e-9)
}

// Which `appl_<k>` pieces cover which of the side x side sample points, and how many distinct `extras.layer`
// values cover each point (never faces).
export function layerCoverage(root, side = LAYER_SIDE) {
  const pieces = []
  root.traverse((node) => {
    if (!applName.test(node.getName())) return
    const layer = node.getExtras()?.layer
    const mask = new Uint8Array(side * side)
    const step = 2 / side
    for (const t of collectTriangles(node, (name) => !notPiece.test(name))) {
      if (triangleNormal(t).y <= 0) continue
      const minX = Math.min(t.a.x, t.b.x, t.c.x), maxX = Math.max(t.a.x, t.b.x, t.c.x)
      const minZ = Math.min(t.a.z, t.b.z, t.c.z), maxZ = Math.max(t.a.z, t.b.z, t.c.z)
      const col0 = Math.max(0, Math.floor((minX + 1) / step - 0.5))
      const col1 = Math.min(side - 1, Math.ceil((maxX + 1) / step - 0.5))
      const row0 = Math.max(0, Math.floor((minZ + 1) / step - 0.5))
      const row1 = Math.min(side - 1, Math.ceil((maxZ + 1) / step - 0.5))
      for (let row = row0; row <= row1; row++) {
        for (let col = col0; col <= col1; col++) {
          if (insideTriangle(t, -1 + (col + 0.5) * step, -1 + (row + 0.5) * step)) mask[row * side + col] = 1
        }
      }
    }
    pieces.push({ name: node.getName(), layer, mask })
  })
  const layersAt = Array.from({ length: side * side }, () => new Set())
  for (const piece of pieces) piece.mask.forEach((on, i) => { if (on) layersAt[i].add(piece.layer) })
  for (const piece of pieces) {
    piece.footprint = piece.mask.reduce((s, on) => s + on, 0)
    piece.layered = piece.mask.reduce((s, on, i) => s + (on && layersAt[i].size >= 2 ? 1 : 0), 0)
    piece.share = piece.footprint ? piece.layered / piece.footprint : 0
  }
  return { pieces, layers: new Set(pieces.map((p) => p.layer)) }
}

// Outward azimuth (degrees around the vertical, 0 = the +Z front) of every `dome_<k>` card, from the
// area-weighted normal of its felt faces, flipped to the front half.
export function domeCards(root) {
  const cards = []
  root.traverse((node) => {
    if (!domeName.test(node.getName())) return
    const triangles = collectTriangles(node, (name) => /^felt_/.test(name) && !notPiece.test(name))
    const sum = new Vector3()
    const bounds = new Box3()
    for (const t of triangles) {
      const n = triangleNormal(t)
      sum.addScaledVector(n, n.z < 0 ? -1 : 1)
      bounds.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c)
    }
    // The card's whole geometry (rim glitter, stalk, stitches) decides how high the dome reaches.
    const reach = new Box3()
    for (const t of collectTriangles(node)) reach.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c)
    cards.push({
      name: node.getName(),
      triangles: triangles.length,
      azimuth: Math.atan2(sum.x, sum.z) * 180 / Math.PI,
      upright: sum.lengthSq() ? Math.abs(sum.clone().normalize().y) : 1,
      width: bounds.isEmpty() ? 0 : bounds.max.x - bounds.min.x,
      depth: bounds.isEmpty() ? 0 : bounds.max.z - bounds.min.z,
      top: reach.isEmpty() ? -Infinity : reach.max.y,
    })
  })
  return cards
}

export function domeProblems(root, topY) {
  const cards = domeCards(root)
  if (!cards.length) return ['upright cap/crown has no dome_<k> cards']
  const problems = []
  if (cards.some((card) => !card.triangles)) problems.push('dome card without felt faces')
  if (Math.max(...cards.map((card) => card.top)) < topY - epsilon) {
    problems.push('the tallest geometry is not part of a dome')
  }
  const azimuths = cards.map((card) => card.azimuth)
  const span = Math.max(...azimuths) - Math.min(...azimuths)
  const planes = cards.length >= 3 && span >= DOME_SPAN_DEGREES && cards.every((card) => card.upright < 0.5)
  const stuffed = cards.length === 1 && cards[0].width > 0 && cards[0].depth >= DOME_DEPTH_RATIO * cards[0].width
  if (!planes && !stuffed) {
    problems.push(`dome needs >= 3 cards spanning >= ${DOME_SPAN_DEGREES}° (${cards.length} cards, ` +
      `${span.toFixed(1)}°) or one stuffed mesh with depth >= ${DOME_DEPTH_RATIO * 100}% of its width`)
  }
  return problems
}

export const SEC_REQUIRED = { mushroom_house: 1, flower: 3 }

export function secProblems(id, root) {
  const secs = []
  root.traverse((node) => { if (secName.test(node.getName())) secs.push(node) })
  const problems = []
  const names = new Set()
  for (const sec of secs) {
    const label = sec.getName()
    const parent = sec.getParentNode()
    if (names.has(label)) problems.push(`${label} is not unique`)
    names.add(label)
    if (!/^hinge_\d+$/.test(parent?.getName() ?? '')) problems.push(`${label} must be nested directly in a hinge_<n>`)
    if (!(near(sec.getRotation(), identity) && near(sec.getScale(), one))) {
      problems.push(`${label} must be authored at rest (identity rotation and scale, local X = the fold axis)`)
    }
    if (sec.getMesh() || !sec.listChildren().length) problems.push(`${label} must be an empty pivot with parts under it`)
    let geometry = false
    sec.traverse((node) => { if (node !== sec && node.getMesh()) geometry = true })
    if (!geometry) problems.push(`${label} carries no geometry`)
    let nested = false
    sec.traverse((node) => { if (node !== sec && /^(hinge|sec)_\d+$/.test(node.getName())) nested = true })
    if (nested) problems.push(`${label} must not contain a hinge or another sec`)
  }
  const need = SEC_REQUIRED[id] ?? 0
  if (secs.length < need) problems.push(`expected >= ${need} sec_<k> pivots, found ${secs.length}`)
  return { secs: secs.length, problems }
}

export function namingProblems(root) {
  const problems = []
  const seen = new Set()
  root.traverse((node) => {
    const name = node.getName()
    if (/^appl_/.test(name)) {
      const layer = node.getExtras()?.layer
      if (!applName.test(name)) problems.push(`"${name}" must be appl_<k>`)
      if (!node.getMesh()) problems.push(`${name} must be a mesh node`)
      if (!Number.isInteger(layer) || layer < 1 || layer > 3) problems.push(`${name} needs extras.layer 1-3 (got ${layer})`)
    } else if (/^deco_/.test(name)) {
      let geometry = false
      node.traverse((n) => { if (n.getMesh()) geometry = true })
      if (!decoName.test(name)) problems.push(`"${name}" must be deco_<motif>_<k>`)
      if (!geometry) problems.push(`${name} carries no geometry`)
    } else if (/^dome_/.test(name) && !domeName.test(name)) {
      problems.push(`"${name}" must be dome_<k>`)
    }
    if (/^(appl|deco|dome|sec)_/.test(name)) {
      if (seen.has(name)) problems.push(`${name} is not unique`)
      seen.add(name)
    }
  })
  return problems
}

// Motifs of one tile, split by what the runtime places with it: `base` always, hinge parts unless the
// meadow is a clearing.
export function tileMotifs(root) {
  const result = { base: new Set(), hinge: new Set() }
  root.traverse((node) => {
    const match = decoName.exec(node.getName())
    if (!match) return
    let part = 'hinge'
    for (let up = node.getParentNode(); up; up = up.getParentNode()) if (up.getName() === 'base') part = 'base'
    result[part].add(match[1])
  })
  return result
}

const PAGE_DECORATIONS = ['page_deco_a', 'page_deco_b', 'page_deco_c']

// Mirrors `placeTile`/`create` in src/world/art.js, which cannot be imported (they live inside `createArt`,
// which needs a scene, a camera and loaded GLBs): meadow variant hash(0,i,j,6) % 3, a clearing meadow keeps its
// base only when hash(0,i,j,17) % 4 === 0 and has no hinge parts, and a page decoration lands when
// hash(0,i,j,8) & 3 === 0 with variant (h >>> 4) % 3. The layout itself is the real `createLayout`.
export function motifShares(motifs, { seeds = MOTIF_SEEDS, side = MOTIF_SIDE } = {}) {
  const none = { base: new Set(), hinge: new Set() }
  const perSeed = []
  const all = new Set()
  for (let seed = 0; seed < seeds; seed++) {
    const layout = createLayout(seed)
    const cells = new Map()
    let decorated = 0
    for (let i = 0; i < side; i++) {
      for (let j = 0; j < side; j++) {
        const cell = layout.getCell(i, j)
        const id = cell.id === 'meadow' ? MEADOW_MODELS[hash(0, i, j, 6) % MEADOW_MODELS.length] : cell.id
        const clearing = cell.id === 'meadow' && cell.zone === 'clearing'
        const tile = motifs.get(id) ?? none
        const present = new Set(clearing && hash(0, i, j, 17) % 4 !== 0 ? [] : tile.base)
        if (!clearing) for (const m of tile.hinge) present.add(m)
        const placed = hash(0, i, j, 8)
        if ((placed & 3) === 0) {
          for (const m of (motifs.get(PAGE_DECORATIONS[(placed >>> 4) % PAGE_DECORATIONS.length]) ?? none).base) present.add(m)
        }
        if (!present.size) continue
        decorated++
        for (const m of present) cells.set(m, (cells.get(m) ?? 0) + 1)
      }
    }
    for (const m of cells.keys()) all.add(m)
    perSeed.push({ seed, decorated, shares: Object.fromEntries([...cells].map(([m, n]) => [m, n / decorated])) })
  }
  const worst = Math.max(0, ...perSeed.flatMap((entry) => Object.values(entry.shares)))
  return { motifs: [...all].sort(), perSeed, worst }
}

export function motifProblems(motifs, options) {
  const result = motifShares(motifs, options)
  const problems = []
  if (result.motifs.length < MOTIF_MIN) {
    problems.push(`only ${result.motifs.length} decoration motifs placed (${result.motifs.join(', ')}), need >= ${MOTIF_MIN}`)
  }
  for (const entry of result.perSeed) {
    for (const [motif, share] of Object.entries(entry.shares)) {
      if (share > MOTIF_SHARE_LIMIT) {
        problems.push(`motif "${motif}" is on ${(share * 100).toFixed(1)}% of decorated cells on seed ${entry.seed} (limit ${MOTIF_SHARE_LIMIT * 100}%)`)
      }
    }
  }
  return { ...result, problems }
}

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

  // Round 6: appliqué layers, decoration motifs, hero domes and follow-through pivots.
  problems.push(...namingProblems(root))
  const { secs, problems: secIssues } = secProblems(id, root)
  problems.push(...secIssues)
  const baseline = shared.baseline ?? BASELINE
  const group = meadows.includes(id) ? 'meadow' : decorations.includes(id) ? 'pageDeco' : null
  const pieces = pieceStats(root)
  if (group) {
    const reference = baseline[group]
    check(Number.isFinite(reference) && reference > 0, `no ${group} baseline mean area (run --measure on the fa6d96b GLBs)`)
    check(pieces.mean >= AREA_RATIO * reference - epsilon,
      `mean piece area ${pieces.mean.toFixed(3)} (${pieces.count} pieces) is below ${AREA_RATIO}x the ` +
      `${baseline.commit} ${group} mean ${Number(reference).toFixed(3)}`)
  }
  const coverage = layerCoverage(root)
  const layered = (isTerrain && !/^(path|river|yarn)_/.test(id)) || decorations.includes(id)
  if (layered) {
    check(coverage.pieces.length >= 3 && coverage.layers.size >= 2 && coverage.layers.size <= 3,
      `expected appl_<k> pieces on 2-3 layers, found ${coverage.pieces.length} on ${coverage.layers.size}`)
  }
  for (const piece of coverage.pieces) {
    check(piece.footprint > 0 && piece.share >= LAYER_OVERLAP - epsilon,
      `${piece.name} (layer ${piece.layer}) has >= 2 layers on ${(piece.share * 100).toFixed(0)}% of its ` +
      `footprint, expected >= ${LAYER_OVERLAP * 100}%`)
  }
  const domed = id === 'mushroom_house' || id === 'cupcake_tree'
  if (domed) problems.push(...domeProblems(root, upright.max.y).map((message) => `${id}: ${message}`))

  const flat = new Box3()
  // Cupped petals and the chunky twisted bridge rail stand proud of the card; all else stays thin. The domed
  // mushroom cap and cupcake crown (round 6) may reach 0.08 too.
  const flatLimitFor = (hinge) => {
    let dome = false
    hinge.traverse((node) => { if (domeName.test(node.getName())) dome = true })
    return { flower: DOME_FLAT_LIMIT, yarn_bridge: DOME_FLAT_LIMIT }[id] ?? (dome ? DOME_FLAT_LIMIT : THIN_FLAT_LIMIT)
  }
  const angle = -Math.PI / 4
  for (const hinge of hinges) hinge.setRotation([Math.sin(angle), 0, 0, Math.cos(angle)])
  for (const hinge of hinges) {
    const pose = geometryUnder(hinge)
    const flatLimit = flatLimitFor(hinge)
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

  const detail = [`${pieces.count} pieces, mean area ${pieces.mean.toFixed(3)}`]
  if (coverage.pieces.length) {
    const lowest = Math.min(...coverage.pieces.map((piece) => piece.share))
    detail.push(`${coverage.pieces.length} appl on layers ${[...coverage.layers].sort().join('/')}, ` +
      `min overlap ${(lowest * 100).toFixed(0)}%`)
  }
  if (secs) detail.push(`${secs} sec pivots`)
  const motifs = tileMotifs(root)
  const motifList = [...new Set([...motifs.base, ...motifs.hinge])].sort()
  if (motifList.length) detail.push(`motifs ${motifList.join('+')}`)
  return {
    problems, triangles, textures: images.size, hinges: hinges.length, upright, flat, pieces, motifs,
    detail: detail.join('; '),
  }
}

async function main(argv) {
  const flags = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--measure') flags.set('measure', true)
    else if (argv[i] === '--baseline') flags.set('baseline', argv[++i])
    else positional.push(argv[i])
  }
  const directory = positional[0] ?? 'public/models/tiles'
  const io = new NodeIO()
  const shared = { digests: new Map(), uris: new Map() }
  if (flags.has('baseline')) {
    const file = JSON.parse(await readFile(flags.get('baseline'), 'utf8'))
    shared.baseline = { commit: file.commit, meadow: file.groups.meadow.mean, pageDeco: file.groups.pageDeco.mean }
  }
  const files = (await readdir(directory)).filter((file) => file.endsWith('.glb'))
  if (flags.has('measure')) {
    // Baseline mode: no checks, just the piece areas of the GLBs in `directory`.
    const tiles = {}
    for (const id of [...meadows, ...decorations]) {
      const document = await io.read(join(directory, `${id}.glb`))
      const stats = pieceStats(document.getRoot().listScenes()[0].listChildren()[0])
      tiles[id] = { count: stats.count, mean: stats.mean, areas: stats.areas }
    }
    const pool = (ids) => {
      const areas = ids.flatMap((id) => tiles[id].areas)
      return { tiles: ids, count: areas.length, mean: areas.reduce((s, a) => s + a, 0) / areas.length }
    }
    const result = {
      commit: BASELINE.commit,
      directory,
      pieceMinArea: PIECE_MIN_AREA,
      definition: 'welded island of felt_ or card_ (not felt_fringe_, card_page) under base; area = projected ' +
        'up-facing XZ area; pieces under pieceMinArea (glue tabs, sprigs) are left out',
      groups: { meadow: pool(meadows), pageDeco: pool(decorations) },
      pooled: pool([...meadows, ...decorations]),
      tiles,
    }
    console.log(JSON.stringify(result, null, 2))
    return 0
  }
  const ordered = [...required, ...files.map((file) => file.slice(0, -4)).filter((id) => !required.includes(id)).sort()]
  let passed = 0
  const motifs = new Map()
  console.log(`Inspecting ${directory}`)
  for (const id of ordered) {
    try {
      const result = await inspect(io, join(directory, `${id}.glb`), id, shared)
      if (result.motifs) motifs.set(id, result.motifs)
      if (result.problems.length) {
        console.error(`FAIL ${id}:\n  ${result.problems.join('\n  ')}`)
        continue
      }
      const { triangles, textures, hinges, upright, flat } = result
      const pose = hinges ? `, flat y=${fmt(flat.min.y)}…${fmt(flat.max.y)}` : ''
      console.log(`PASS ${id}: ${triangles} triangles, ${textures} shared textures, ${hinges} hinges, ` +
        `upright height ${fmt(upright.max.y)}${pose}; ${result.detail}`)
      passed += 1
    } catch (error) {
      console.error(`FAIL ${id}: ${error.code === 'ENOENT' ? 'missing GLB' : error.message}`)
    }
  }
  let checks = ordered.length
  if (required.every((id) => motifs.has(id))) {
    checks += 1
    const share = motifProblems(motifs)
    if (share.problems.length) {
      console.error(`FAIL decoration motifs:\n  ${share.problems.join('\n  ')}`)
    } else {
      passed += 1
      console.log(`PASS decoration motifs: ${share.motifs.length} (${share.motifs.join(', ')}) over ` +
        `${MOTIF_SIDE}x${MOTIF_SIDE} cells on ${MOTIF_SEEDS} seeds, highest share on any seed ` +
        `${(share.worst * 100).toFixed(1)}% (limit ${MOTIF_SHARE_LIMIT * 100}%)`)
    }
  } else {
    console.error('FAIL decoration motifs: the directory does not hold every tile')
  }
  const textureBytes = [...shared.uris.values()].reduce((sum, bytes) => sum + bytes, 0)
  console.log(`${passed}/${checks} checks passed (${ordered.length} GLBs + motif share). ` +
    `${shared.uris.size} unique textures, ${textureBytes.toLocaleString('en-US')} bytes.`)
  return passed === checks ? 0 : 1
}

export { inspect, main }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2))
}
