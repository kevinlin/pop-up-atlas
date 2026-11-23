import { MathUtils } from 'three'
import { hash } from '../world/hash.js'
import { baseCue } from './cue-tracker.js'

// Atlas cell order (row-major from the top left): docs/contracts.md "Round 6" → Characters.
export const MOUTH_CELLS = ['smile', 'open_smile', 'o', 'flat', 'frown', 'sing', 'ee', 'grin']
const cell = Object.fromEntries(MOUTH_CELLS.map((name, index) => [name, index]))

export const BLINK_TIME = 0.15
export const BLINK_GAP = 0.1
export const REST_CLOSURE = { a: 0, b: 0.35 }
export const REST_MOUTH = { a: cell.smile, b: cell.flat }
const MOUTH_HOLD = 0.1
const GIGGLE_HZ = 8
const COLUMNS = 4
const ROWS = 2
const BLINK_SALT = 36
const DOUBLE_SALT = 37

const SHAPES = {
  voice_ooh: cell.o,
  voice_eep: cell.o,
  voice_hmph: cell.frown,
  voice_hm: cell.flat,
  voice_hup: cell.ee,
  voice_whee: cell.open_smile,
  voice_lead: cell.open_smile,
}

// Mouth cell for a cue `since` seconds after it started, or undefined when the cue has no mouth.
export function mouthCell(cue, since) {
  const name = baseCue(cue)
  if (name === 'voice_giggle') return Math.floor(since * GIGGLE_HZ * 2) % 2 === 0 ? cell.open_smile : cell.grin
  if (name.startsWith('sing_')) return cell.sing
  return SHAPES[name]
}
export const isMouthCue = (cue) => mouthCell(cue, 0) !== undefined

function mouthMaterial(model) {
  let found
  model.traverse((object) => {
    if (found || !object.isMesh) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    const material = materials.find((candidate) => candidate?.name === 'felt_mouth')
    if (material) found = { mesh: object, material }
  })
  return found
}

// Blinks and the mouth atlas of one character. Lids are `lid_l` / `lid_r` (scale.y from the open value
// in userData.lidOpen to 1), the mouth is the mesh on material `felt_mouth` (4x2 atlas, texture offset).
// Anything missing is skipped; `state` still reports the logical cell and closure.
export function createFace(model, { who, tracker, seed = () => 0 }) {
  const lids = ['lid_l', 'lid_r'].map((name) => model.getObjectByName(name)).filter(Boolean)
  const lidOpen = lids.map((lid) => lid.userData?.lidOpen ?? lid.scale.y)
  const found = mouthMaterial(model)
  const map = found?.material.map
  const rest = REST_CLOSURE[who] ?? 0
  const restMouth = REST_MOUTH[who] ?? cell.smile
  const state = { cell: restMouth, lid: rest }

  if (map) {
    // A mesh that already covers one atlas cell only needs the offset; a full 0..1 quad needs the repeat too.
    const uv = found.mesh.geometry?.attributes?.uv
    let spanU = 1
    if (uv) {
      let low = Infinity
      let high = -Infinity
      for (let i = 0; i < uv.count; i += 1) {
        low = Math.min(low, uv.getX(i))
        high = Math.max(high, uv.getX(i))
      }
      spanU = high - low
    }
    if (spanU > 1 / ROWS) map.repeat.set(1 / COLUMNS, 1 / ROWS)
  }

  function showCell(index) {
    state.cell = index
    if (!map) return
    const column = index % COLUMNS
    const row = Math.floor(index / COLUMNS)
    // glTF textures are not flipped: v = 0 is the top row of the image.
    map.offset.set(column / COLUMNS, map.flipY ? 1 - (row + 1) / ROWS : row / ROWS)
  }
  showCell(restMouth)

  const charSeed = (who === 'b' ? 0xb : 0xa) * 0x1000193
  const unit = (n, salt) => hash(seed() ^ charSeed, n, 0, salt) / 0x100000000
  let blinkIndex = 0
  let nextBlink
  const blinks = []

  function scheduleBlink(from) {
    const start = from + 2.5 + 3 * unit(blinkIndex, BLINK_SALT)
    blinks.push(start)
    if (hash(seed() ^ charSeed, blinkIndex, 0, DOUBLE_SALT) % 5 === 0) blinks.push(start + BLINK_TIME + BLINK_GAP)
    blinkIndex += 1
    nextBlink = start
  }

  return {
    state,
    update(dt, t, leader) {
      nextBlink ??= (scheduleBlink(t), nextBlink)
      while (t >= nextBlink) scheduleBlink(nextBlink)

      let blink = 0
      for (let i = blinks.length - 1; i >= 0; i -= 1) {
        const progress = (t - blinks[i]) / BLINK_TIME
        if (progress >= 1) blinks.splice(i, 1)
        else if (progress >= 0) blink = Math.max(blink, Math.sin(Math.PI * progress))
      }
      state.lid = rest + (1 - rest) * blink
      lids.forEach((lid, index) => { lid.scale.y = MathUtils.lerp(lidOpen[index], 1, state.lid) })

      const segment = leader ? tracker?.latest(t, MOUTH_HOLD, isMouthCue) : undefined
      showCell(segment ? mouthCell(segment.cue, t - segment.t) : restMouth)
    },
  }
}
