// Static DUO-* evidence read from the shipped files: troll B's GLB, the cue manifest and sheet, and B's voice pitch.
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

// Rest-pose summary of a troll GLB: what the e2e gate can measure without Blender.
export async function summarizeTroll(file) {
  const { json, bin } = await readGlb(file)
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
  for (const [nodeIndex, node] of nodes.entries()) {
    if (node.mesh === undefined) continue
    const matrix = node.skin === undefined ? world(nodeIndex) : localMatrix({})
    for (const primitive of json.meshes[node.mesh].primitives) {
      const mode = primitive.mode ?? 4
      const position = json.accessors[primitive.attributes.POSITION]
      const count = primitive.indices === undefined ? position.count : json.accessors[primitive.indices].count
      if (mode === 4) triangles += count / 3
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2)
      for (const x of [position.min[0], position.max[0]]) for (const y of [position.min[1], position.max[1]]) {
        for (const z of [position.min[2], position.max[2]]) {
          top = Math.max(top, matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13])
        }
      }
    }
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
  return {
    bones: [...bones].sort(), clips: [...clips].sort(), materials, triangles, textures, top,
    feetMidpoint: feet.length === 2 ? { x: (feet[0].x + feet[1].x) / 2, z: (feet[0].z + feet[1].z) / 2 } : null,
  }
}

export function checkTrollB(a, b, contract) {
  const problems = []
  const missing = (list, from) => list.filter((name) => !from.includes(name))
  const missingBones = missing(a.bones, b.bones)
  const missingClips = missing(a.clips, b.clips)
  if (missingBones.length) problems.push(`troll_b.glb lacks bones ${missingBones.join(', ')}`)
  if (missingClips.length) problems.push(`troll_b.glb lacks clips ${missingClips.join(', ')}`)
  if (b.triangles > contract.maxTriangles) problems.push(`troll_b.glb has ${b.triangles} triangles (> ${contract.maxTriangles})`)
  for (const { name, width, height } of b.textures) {
    if (!width || !height) problems.push(`texture ${name} has an unreadable size`)
    else if (Math.max(width, height) > contract.maxTexture) problems.push(`texture ${name} is ${width}x${height} (> ${contract.maxTexture} px)`)
  }
  for (const name of b.materials) if (!materialPrefix.test(name ?? '')) problems.push(`material "${name}" has no felt_/card_/glitter_/yarn_ prefix`)
  if (!(b.top <= contract.hairTip + 1e-3)) problems.push(`rest-pose top ${b.top.toFixed(3)} exceeds the ${contract.hairTip} hair tip`)
  if (!(b.top >= contract.bodyHeight[0] - 1e-3)) problems.push(`rest-pose top ${b.top.toFixed(3)} is below the ${contract.bodyHeight[0]} body height`)
  if (!b.feetMidpoint) problems.push('foot_L / foot_R bones are missing')
  else if (Math.hypot(b.feetMidpoint.x, b.feetMidpoint.z) > 0.05) problems.push('origin is not between the feet (> 0.05 units)')
  return problems
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
