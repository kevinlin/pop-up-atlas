// Static DUO-* evidence read from the shipped files: both rigs' GLBs (round 6: per-rig bones, clips, face and umbrella nodes, dance
// markers, sizes), the cue manifest and sheet, and B's voice pitch.
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { decode } from '../audio/media.js'
import { detectPitch } from '../audio/pitch.js'

const root = new URL('../', import.meta.url)
const path = (relative) => fileURLToPath(new URL(relative, root))
export const trollA = path('public/models/troll.glb')
export const trollB = path('public/models/troll_b.glb')
export const manifestPath = path('public/audio/manifest.json')
export const cueSheetPath = path('audio/cues.json')
const materialPrefix = /^(felt|card|glitter|yarn)_.+$/

export async function readGlb(file) {
  const binary = await readFile(file)
  if (binary.readUInt32LE(0) !== 0x46546c67 || binary.readUInt32LE(4) !== 2) throw new Error(`${file} is not glTF 2.0 binary`)
  const jsonLength = binary.readUInt32LE(12)
  const json = JSON.parse(binary.toString('utf8', 20, 20 + jsonLength))
  const binStart = 20 + jsonLength + 8
  const bin = binary.length > binStart ? binary.subarray(binStart, binStart + binary.readUInt32LE(20 + jsonLength)) : null
  return { json, bin }
}

function imageSize(bytes) {
  if (bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.readUInt16BE(0) === 0xffd8) {
    for (let at = 2; at + 9 < bytes.length;) {
      const marker = bytes.readUInt16BE(at)
      const length = bytes.readUInt16BE(at + 2)
      if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) }
      }
      at += 2 + length
    }
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
    }
    if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
  return null
}

const multiply = (a, b) => {
  const out = new Array(16).fill(0)
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k]
  }
  return out
}

function localMatrix({ matrix, translation = [0, 0, 0], rotation = [0, 0, 0, 1], scale = [1, 1, 1] }) {
  if (matrix) return matrix
  const [x, y, z, w] = rotation
  const [sx, sy, sz] = scale
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    ...translation, 1,
  ]
}

// ---------------------------------------------------------------------------------------------------------------------
// Animation sampling (pose curves): enough forward kinematics to read marker times and the wrist path off a clip.
// ---------------------------------------------------------------------------------------------------------------------
const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }

function readAccessor(json, bin, index) {
  const accessor = json.accessors[index]
  if (accessor.componentType !== 5126) throw new Error(`accessor ${index} is not FLOAT`)
  const view = json.bufferViews[accessor.bufferView]
  const size = components[accessor.type]
  const stride = view.byteStride ?? size * 4
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const values = new Float64Array(accessor.count * size)
  for (let i = 0; i < accessor.count; i++) for (let k = 0; k < size; k++) values[i * size + k] = bin.readFloatLE(base + i * stride + k * 4)
  return { values, size, count: accessor.count }
}

function slerp(a, b, u) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const to = dot < 0 ? b.map((v) => -v) : b
  dot = Math.abs(dot)
  if (dot > 0.9995) {
    const mixed = a.map((v, i) => v + (to[i] - v) * u)
    const length = Math.hypot(...mixed)
    return mixed.map((v) => v / length)
  }
  const theta = Math.acos(dot)
  const sin = Math.sin(theta)
  const wa = Math.sin((1 - u) * theta) / sin
  const wb = Math.sin(u * theta) / sin
  return a.map((v, i) => v * wa + to[i] * wb)
}

// Value of a sampler at time t (LINEAR, STEP and CUBICSPLINE, whose tangents are ignored).
function sampleTrack({ times, values, size, interpolation }, t, rotation) {
  const stride = interpolation === 'CUBICSPLINE' ? 3 : 1
  const at = (i) => Array.from(values.subarray(i * stride * size + (stride === 3 ? size : 0), i * stride * size + (stride === 3 ? 2 * size : size)))
  if (t <= times[0]) return at(0)
  if (t >= times.at(-1)) return at(times.length - 1)
  let hi = 1
  while (times[hi] < t) hi++
  const lo = hi - 1
  if (interpolation === 'STEP') return at(lo)
  const u = (t - times[lo]) / (times[hi] - times[lo])
  const a = at(lo)
  const b = at(hi)
  return rotation ? slerp(a, b, u) : a.map((v, i) => v + (b[i] - v) * u)
}

function clipTracks(json, bin, clip) {
  const tracks = new Map()
  for (const { sampler, target } of clip.channels) {
    if (target.node === undefined || !['translation', 'rotation', 'scale'].includes(target.path)) continue
    const { input, output, interpolation = 'LINEAR' } = clip.samplers[sampler]
    const times = readAccessor(json, bin, input).values
    const { values, size } = readAccessor(json, bin, output)
    const entry = tracks.get(target.node) ?? {}
    entry[target.path] = { times, values, size, interpolation }
    tracks.set(target.node, entry)
  }
  return tracks
}

const clipDuration = (json, bin, clip) => Math.max(...clip.samplers.map(({ input }) => json.accessors[input].max?.[0] ?? readAccessor(json, bin, input).values.at(-1)))

// World matrices of every node of `json` with the clip's tracks applied at time t.
function worldPose(json, tracks, t, parents) {
  const nodes = json.nodes
  const worlds = new Array(nodes.length)
  const world = (index) => {
    if (worlds[index]) return worlds[index]
    const node = nodes[index]
    const track = tracks.get(index)
    const local = node.matrix ? node.matrix : localMatrix({
      translation: track?.translation ? sampleTrack(track.translation, t) : node.translation,
      rotation: track?.rotation ? sampleTrack(track.rotation, t, true) : node.rotation,
      scale: track?.scale ? sampleTrack(track.scale, t) : node.scale,
    })
    const parent = parents.get(index)
    worlds[index] = parent === undefined ? local : multiply(world(parent), local)
    return worlds[index]
  }
  nodes.forEach((_, index) => world(index))
  return worlds
}

// Dance metrics from the pose curves (60 Hz): the wrist's vertical path, and the marker times of the shared beat. The
// markers are read from `extras.markers` of the clip when the export carries them; otherwise estimated from the head:
//   landing  the lowest head height in 1.2-2.0 s;
//   turn     the head's heading yaw: the turn starts where its rate leaves 5 % of the peak rate, searching back from the peak;
//   bow      the start of the longest held stretch after the landing, `hold` its length: every non-hair joint's world
//            matrix changes by less than STILL per frame (the definition of blender/duo/inspect_duo.py; a head-speed
//            threshold merged the slow rise into the bow with the head while the body still moved).
const STILL = 1e-4
export function danceMetrics(json, bin, parents, clip) {
  const nodes = json.nodes
  const index = (name) => nodes.findIndex((node) => node.name === name)
  const [head, handR, handL] = ['head', 'hand_r', 'hand_l'].map(index)
  const body = [...new Set((json.skins ?? []).flatMap(({ joints }) => joints))].filter((joint) => !/^hair_/.test(nodes[joint].name ?? ''))
  const tracks = clipTracks(json, bin, clip)
  const duration = clipDuration(json, bin, clip)
  const rate = 60
  const samples = []
  let previous = null
  for (let t = 0; t <= duration + 1e-9; t += 1 / rate) {
    const worlds = worldPose(json, tracks, t, parents)
    const still = previous !== null && body.every((joint) => worlds[joint].every((value, k) => Math.abs(value - previous[joint][k]) < STILL))
    previous = worlds
    samples.push({
      t,
      still,
      head: head >= 0 ? { x: worlds[head][12], y: worlds[head][13], z: worlds[head][14], yaw: Math.atan2(worlds[head][8], worlds[head][10]) } : null,
      wrists: [handR, handL].filter((i) => i >= 0).map((i) => worlds[i][13]),
    })
  }
  const wristSpans = [0, 1].map((k) => {
    const ys = samples.map(({ wrists }) => wrists[k]).filter(Number.isFinite)
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0
  })
  const result = { duration, wristSpan: Math.max(...wristSpans), source: 'none', markers: null }
  if (clip.extras?.markers) {
    const { turnStart, landing, bow, bowHold } = clip.extras.markers
    return { ...result, source: 'extras', markers: { turnStart, landing, bow, bowHold } }
  }
  if (!samples[0].head) return result
  const between = (from, to) => samples.filter(({ t }) => t >= from && t <= to)
  const landing = between(1.2, 2.0).reduce((best, sample) => (sample.head.y < best.head.y ? sample : best)).t
  // Unwrapped yaw rate.
  const rates = samples.slice(1).map((sample, i) => {
    let delta = sample.head.yaw - samples[i].head.yaw
    while (delta > Math.PI) delta -= 2 * Math.PI
    while (delta < -Math.PI) delta += 2 * Math.PI
    return { t: sample.t, rate: Math.abs(delta) * rate }
  })
  const peak = rates.reduce((best, entry) => (entry.rate > best.rate ? entry : best))
  let turnStart = peak.t
  for (let i = rates.findIndex(({ t }) => t === peak.t); i >= 0 && rates[i].rate > 0.05 * peak.rate; i--) turnStart = rates[i].t
  // The held stretch.
  let best = { start: null, length: 0 }
  let run = null
  for (let i = 1; i < samples.length; i++) {
    const { t, still } = samples[i]
    if (t > landing + 0.1 && still) {
      run ??= { start: samples[i - 1].t, length: 0 }
      run.length = t - run.start
      if (run.length > best.length) best = { ...run }
    } else run = null
  }
  return { ...result, source: 'pose curves', markers: { turnStart, landing, bow: best.start, bowHold: best.length } }
}

// Rest-pose and clip summary of a rig GLB: what the e2e gate can measure without Blender.
export async function summarizeTroll(file) {
  return summarizeGlb(await readGlb(file), file)
}

export async function summarizeGlb({ json, bin }, file = 'rig.glb') {
  const nodes = json.nodes ?? []
  const parents = new Map()
  nodes.forEach((node, index) => (node.children ?? []).forEach((child) => parents.set(child, index)))
  const world = (index) => {
    let matrix = localMatrix(nodes[index])
    for (let parent = parents.get(index); parent !== undefined; parent = parents.get(parent)) {
      matrix = multiply(localMatrix(nodes[parent]), matrix)
    }
    return matrix
  }
  const bones = new Set((json.skins ?? []).flatMap(({ joints }) => joints.map((joint) => nodes[joint].name)))
  const clips = new Set((json.animations ?? []).map(({ name }) => name))
  const materials = (json.materials ?? []).map(({ name }) => name)
  let triangles = 0
  let top = -Infinity
  let largest = { triangles: -1 }
  for (const [nodeIndex, node] of nodes.entries()) {
    if (node.mesh === undefined) continue
    const matrix = node.skin === undefined ? world(nodeIndex) : localMatrix({})
    let own = 0
    for (const primitive of json.meshes[node.mesh].primitives) {
      const mode = primitive.mode ?? 4
      const position = json.accessors[primitive.attributes.POSITION]
      const count = primitive.indices === undefined ? position.count : json.accessors[primitive.indices].count
      if (mode === 4) own += count / 3
      else if (mode === 5 || mode === 6) own += Math.max(0, count - 2)
      for (const x of [position.min[0], position.max[0]]) for (const y of [position.min[1], position.max[1]]) {
        for (const z of [position.min[2], position.max[2]]) {
          top = Math.max(top, matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13])
        }
      }
    }
    triangles += own
    if (own > largest.triangles) largest = { triangles: own, node, matrix }
  }
  // Origin: the centre of the sole vertices (within 0.018 of the lowest) of the largest mesh, as blender/duo/inspect_duo.py
  // measures it. The foot bones sit at the ankles, behind the sole centre, on a rig built for its own mesh.
  let soles = null
  if (largest.node && bin) {
    const points = []
    for (const primitive of json.meshes[largest.node.mesh].primitives) {
      const { values } = readAccessor(json, bin, primitive.attributes.POSITION)
      const m = largest.matrix
      for (let i = 0; i < values.length; i += 3) {
        const [x, y, z] = [values[i], values[i + 1], values[i + 2]]
        points.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]])
      }
    }
    const low = Math.min(...points.map(([, y]) => y))
    const sole = points.filter(([, y]) => y < low + 0.018)
    const centre = (k) => (Math.min(...sole.map((p) => p[k])) + Math.max(...sole.map((p) => p[k]))) / 2
    soles = { x: centre(0), y: low, z: centre(2) }
  }
  const textures = []
  for (const [index, image] of (json.images ?? []).entries()) {
    let bytes
    if (image.bufferView !== undefined && bin) {
      const view = json.bufferViews[image.bufferView]
      bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    } else if (image.uri?.startsWith('data:')) bytes = Buffer.from(image.uri.split(',')[1], 'base64')
    else if (image.uri) bytes = await readFile(new URL(image.uri, `file://${file}`))
    textures.push({ index, name: image.name ?? image.uri ?? `image ${index}`, ...(bytes && imageSize(bytes)) })
  }
  const nodeByName = (name) => nodes.findIndex((node) => node.name === name)
  const feet = ['foot_L', 'foot_R'].map(nodeByName).filter((index) => index >= 0).map((index) => {
    const matrix = world(index)
    return { x: matrix[12], y: matrix[13], z: matrix[14] }
  })
  // Node facts the per-rig checks read: parent name, scale, extras and the material of an attached mesh.
  const named = {}
  for (const [index, node] of nodes.entries()) {
    if (!node.name) continue
    const material = node.mesh === undefined ? undefined
      : json.materials?.[json.meshes[node.mesh].primitives[0]?.material]?.name
    named[node.name] = { parent: parents.has(index) ? nodes[parents.get(index)].name : null, scale: node.scale ?? [1, 1, 1],
      extras: node.extras ?? null, mesh: node.mesh !== undefined, material }
  }
  const clipInfo = {}
  for (const clip of json.animations ?? []) {
    const duration = clipDuration(json, bin, clip)
    clipInfo[clip.name] = { duration }
    if (clip.name === 'dance' && bin) clipInfo.dance = { duration, ...danceMetrics(json, bin, parents, clip) }
  }
  return {
    bones: [...bones].sort(), clips: [...clips].sort(), materials, triangles, textures, top, nodes: named, clipInfo,
    feetMidpoint: feet.length === 2 ? { x: (feet[0].x + feet[1].x) / 2, z: (feet[0].z + feet[1].z) / 2 } : null,
    soles,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Round 6 per-rig static checks (docs/contracts.md "Round 6" → Characters).
// ---------------------------------------------------------------------------------------------------------------------
export const rigContract = {
  hairTip: 1.05,
  bodyHeight: [0.5, 0.6],
  maxTriangles: 20_000,
  maxTexture: 1024,
  originTolerance: 0.02,
  // Shared bones; every rig also keeps the feet the origin check reads.
  sharedBones: ['root', 'head', 'hand_r', 'hair_0', 'hair_1', 'hair_2', 'hair_3', 'foot_L', 'foot_R'],
  // Clips per rig: A has skip, B has look; neither is required to carry the other's extra.
  clips: { a: ['walk', 'idle', 'dance', 'skip'], b: ['walk', 'idle', 'dance', 'look'] },
  clipSeconds: { a: { walk: 1.0, skip: 1.0 }, b: { walk: 0.8, look: 0.6 } },
  clipTolerance: 0.02,
  faceNodes: ['eye_l', 'eye_r', 'lid_l', 'lid_r', 'mouth'],
  umbrellaNodes: ['umbrella_closed', 'umbrella_open'],
  mouthMaterial: 'felt_mouth',
  dance: {
    seconds: 3.0, tolerance: 0.05,
    markers: { turnStart: 0.92, landing: 1.67, bow: 2.19, bowHold: 0.35 }, markerTolerance: 0.03, holdTolerance: 0.05,
    wristSpan: 0.35,
  },
}

export function checkRig(rig, summary, contract = rigContract) {
  const label = rig === 'a' ? 'troll.glb' : 'troll_b.glb'
  const problems = []
  const add = (message) => problems.push(`${label} ${message}`)
  const missing = (list, from) => list.filter((name) => !from.includes(name))

  const bones = missing(contract.sharedBones, summary.bones)
  if (bones.length) add(`lacks bones ${bones.join(', ')}`)
  const clips = missing(contract.clips[rig], summary.clips)
  if (clips.length) add(`lacks clips ${clips.join(', ')}`)
  for (const [clip, seconds] of Object.entries(contract.clipSeconds[rig])) {
    const found = summary.clipInfo?.[clip]?.duration
    if (found !== undefined && Math.abs(found - seconds) > contract.clipTolerance) add(`${clip} lasts ${found.toFixed(3)} s (need ${seconds} ± ${contract.clipTolerance})`)
  }

  // Face nodes: eyes, lids under head with `extras.lidOpen`, and the mouth atlas mesh.
  const nodes = summary.nodes ?? {}
  const faceMissing = missing(contract.faceNodes, Object.keys(nodes))
  if (faceMissing.length) add(`lacks face nodes ${faceMissing.join(', ')}`)
  for (const lid of ['lid_l', 'lid_r']) {
    if (!nodes[lid]) continue
    if (nodes[lid].parent !== 'head') add(`${lid} is under ${nodes[lid].parent ?? 'the scene root'}, not head`)
    const open = nodes[lid].extras?.lidOpen
    if (!(Number.isFinite(open) && open > 0 && open <= 1)) add(`${lid} has no extras.lidOpen in (0, 1]`)
  }
  if (nodes.mouth && !(nodes.mouth.mesh && nodes.mouth.material === contract.mouthMaterial)) {
    add(`mouth must be a mesh with material ${contract.mouthMaterial}, found ${nodes.mouth.material ?? 'none'}`)
  }

  // B's umbrella: both nodes under hand_r, the open one authored at scale 0.
  if (rig === 'b') {
    const umbrella = missing(contract.umbrellaNodes, Object.keys(nodes))
    if (umbrella.length) add(`lacks umbrella nodes ${umbrella.join(', ')}`)
    for (const name of contract.umbrellaNodes) {
      if (nodes[name] && nodes[name].parent !== 'hand_r') add(`${name} is under ${nodes[name].parent ?? 'the scene root'}, not hand_r`)
    }
    if (nodes.umbrella_open && !nodes.umbrella_open.scale.every((value) => Math.abs(value) < 1e-6)) {
      add(`umbrella_open is authored at scale [${nodes.umbrella_open.scale.join(', ')}] (need 0)`)
    }
    if (nodes.umbrella_closed && nodes.umbrella_closed.scale.every((value) => Math.abs(value) < 1e-6)) add('umbrella_closed is authored at scale 0')
  }

  // Dance: length, wrist path and the shared markers.
  const dance = summary.clipInfo?.dance
  if (dance) {
    const { seconds, tolerance, markers, markerTolerance, holdTolerance, wristSpan } = contract.dance
    if (Math.abs(dance.duration - seconds) > tolerance + 1e-9) add(`dance lasts ${dance.duration.toFixed(3)} s (need ${seconds} ± ${tolerance})`)
    if (dance.wristSpan !== undefined && dance.wristSpan < wristSpan) add(`dance wrist path spans ${dance.wristSpan.toFixed(3)} units vertically (need >= ${wristSpan})`)
    if (!dance.markers) add('dance markers could not be read from the pose curves')
    else {
      for (const [name, expected] of Object.entries(markers)) {
        const found = dance.markers[name]
        const limit = name === 'bowHold' ? holdTolerance : markerTolerance
        if (!Number.isFinite(found)) add(`dance marker ${name} is missing (${dance.source})`)
        else if (Math.abs(found - expected) > limit + 1e-9) add(`dance marker ${name} is at ${found.toFixed(3)} s (need ${expected} ± ${limit}, ${dance.source})`)
      }
    }
  }

  // Sizes, materials, hair tip, origin.
  if (summary.triangles > contract.maxTriangles) add(`has ${summary.triangles} triangles (> ${contract.maxTriangles})`)
  for (const { name, width, height } of summary.textures) {
    if (!width || !height) problems.push(`texture ${name} has an unreadable size`)
    else if (Math.max(width, height) > contract.maxTexture) problems.push(`texture ${name} is ${width}x${height} (> ${contract.maxTexture} px)`)
  }
  const other = new RegExp(`^(felt|yarn)_${rig === 'a' ? 'b' : 'a'}_`)
  for (const name of summary.materials) {
    if (!materialPrefix.test(name ?? '')) problems.push(`material "${name}" has no felt_/card_/glitter_/yarn_ prefix`)
    else if (other.test(name)) add(`has material ${name} of the other rig`)
  }
  for (const family of ['felt', 'yarn']) {
    if (!summary.materials.some((name) => name?.startsWith(`${family}_${rig}_`))) add(`has no ${family}_${rig}_* material`)
  }
  if (!summary.materials.includes(contract.mouthMaterial)) add(`has no ${contract.mouthMaterial} material`)
  if (!(summary.top <= contract.hairTip + 1e-3)) add(`rest-pose top ${summary.top.toFixed(3)} exceeds the ${contract.hairTip} hair tip`)
  if (!(summary.top >= contract.bodyHeight[0] - 1e-3)) add(`rest-pose top ${summary.top.toFixed(3)} is below the ${contract.bodyHeight[0]} body height`)
  if (!summary.feetMidpoint) add('foot_L / foot_R bones are missing')
  if (!summary.soles) add('has no mesh soles to measure the origin against')
  else if (Math.hypot(summary.soles.x, summary.soles.z) > contract.originTolerance + 1e-9 || Math.abs(summary.soles.y) > contract.originTolerance + 1e-9) {
    const { x, y, z } = summary.soles
    add(`origin is not between the feet (> ${contract.originTolerance} units: soles centre x ${x.toFixed(3)} z ${z.toFixed(3)}, soles y ${y.toFixed(3)})`)
  }
  return problems
}

// Kept for the e2e gate's call `checkTrollB(a, b, duoContract)`: since round 6 troll B is checked against its own rig
// contract (`rigContract`; A and B no longer share a clip set or a hair tip of 0.95), so `a` and `contract` are not used.
export function checkTrollB(_a, b) {
  return checkRig('b', b)
}

const words = (text) => text.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean)
export const isBankB = (cue) => /^b_(voice|sing)_/.test(cue)
export const leaderBank = (cue) => /^(voice|sing)_/.test(cue) ? 'a' : isBankB(cue) ? 'b' : null

// Required B cues: b_ twins of every A voice_/sing_ cue, plus both swap lines.
export async function readCueBanks() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const sheet = JSON.parse(await readFile(cueSheetPath, 'utf8'))
  const names = Object.keys(manifest.cues)
  const aVoice = names.filter((name) => /^(voice|sing)_/.test(name) && name !== 'voice_lead')
  const required = ['voice_lead', 'b_voice_lead', ...aVoice.map((name) => `b_${name}`)]
  const missing = required.filter((name) => !manifest.cues[name]?.files?.length)
  const missingFiles = []
  for (const name of required.filter((cue) => manifest.cues[cue])) {
    for (const { src } of manifest.cues[name].files) {
      try {
        await access(path(`public/audio/${src.replace(/^\/?audio\//, '')}`))
      } catch {
        missingFiles.push(src)
      }
    }
  }
  const sheetB = (sheet.cues ?? []).filter(({ cue }) => isBankB(cue))
  const wordy = sheetB.flatMap(({ cue, texts = [] }) => texts.filter((text) => words(text).length > 2).map((text) => `${cue}: ${text}`))
  return { manifest, sheet, required, missing, missingFiles, wordy, sheetB: sheetB.map(({ cue, sung }) => ({ cue, sung })) }
}

// Pooled YIN over every voiced frame of every non-sung B take (silence between takes is unvoiced).
export function voiceBPitch(manifest, sheet) {
  const sung = new Set((sheet.cues ?? []).filter(({ sung }) => sung).map(({ cue }) => cue))
  const takes = Object.entries(manifest.cues)
    .filter(([cue, { kind }]) => kind === 'voice' && /^b_voice_/.test(cue) && !sung.has(cue))
    .flatMap(([, { files }]) => files.map(({ src }) => path(`public/audio/${src.replace(/^\/?audio\//, '')}`)))
  if (!takes.length) return { takes: 0, medianF0Hz: null }
  const gap = new Float32Array(4410)
  const parts = takes.flatMap((file) => [decode(file), gap])
  const pooled = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    pooled.set(part, offset)
    offset += part.length
  }
  const { medianF0Hz, voicedRatio } = detectPitch(pooled)
  return { takes: takes.length, medianF0Hz, voicedRatio }
}
