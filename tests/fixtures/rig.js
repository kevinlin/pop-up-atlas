import {
  AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  NumberKeyframeTrack, Object3D, PlaneGeometry, Texture, Vector3,
} from 'three'

export const LID_OPEN = 0.2
export const dt = 1 / 120

const clip = (name, seconds) => new AnimationClip(name, seconds, [
  new NumberKeyframeTrack('.position[x]', [0, seconds], [0, 0.01]),
])

// Clip sets per rig (docs/contracts.md "Round 6" → Characters): A skips, B looks, walks differ in length.
export const clipSet = (who) => (who === 'a'
  ? [clip('walk', 1), clip('idle', 2), clip('dance', 3), clip('skip', 1)]
  : [clip('walk', 0.8), clip('idle', 2), clip('dance', 3), clip('look', 0.6)])

function bone(name, y = 0) {
  const node = new Bone()
  node.name = name
  node.position.set(0, y, 0)
  return node
}

// A fixture rig: root > head > hair_0..3 (0.15 apart), hand_r, face nodes and, for B, umbrella nodes.
export function buildModel(who, { face = true, umbrella = who === 'b', mouthUv = 'full' } = {}) {
  const model = new Group()
  const root = bone('root', 0.3)
  const head = bone('head', 0.2)
  const handR = bone('hand_r', 0.1)
  model.add(root)
  root.add(head, handR)
  let parent = head
  for (let index = 0; index < 4; index += 1) {
    const hair = bone(`hair_${index}`, index ? 0.15 : 0.1)
    parent.add(hair)
    parent = hair
  }
  if (face) {
    for (const name of ['eye_l', 'eye_r']) head.add(Object.assign(new Object3D(), { name }))
    for (const name of ['lid_l', 'lid_r']) {
      const lid = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
      lid.name = name
      lid.scale.y = LID_OPEN
      lid.userData.lidOpen = LID_OPEN
      head.add(lid)
    }
    const geometry = new PlaneGeometry(0.1, 0.05)
    if (mouthUv === 'cell') {
      geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 0.25, 0, 0, 0.5, 0.25, 0.5], 2))
    }
    const texture = new Texture()
    texture.flipY = false
    const material = new MeshBasicMaterial({ map: texture })
    material.name = 'felt_mouth'
    const mouth = new Mesh(geometry, material)
    mouth.name = 'mouth'
    head.add(mouth)
  }
  if (umbrella) {
    const closed = new Object3D()
    closed.name = 'umbrella_closed'
    const open = new Object3D()
    open.name = 'umbrella_open'
    open.scale.setScalar(0)
    handR.add(closed, open)
  }
  return model
}

// Drives one rig the way a character frame does.
export function drive(rig, { velocity = new Vector3(), heading = { value: 0, velocity: 0 } } = {}) {
  let t = 0
  return {
    get t() { return t },
    frame(state, { speed = 0, step = dt, ...options } = {}) {
      t += step
      velocity.set(0, 0, speed)
      rig.update(step, t, state, velocity, heading, options)
      return t
    },
    run(seconds, state, options) {
      const end = t + seconds - 1e-9
      while (t < end) this.frame(state, options)
    },
  }
}

export function record(bus, ...types) {
  const log = []
  for (const type of types) bus.addEventListener(type, ({ detail }) => log.push({ type, ...detail }))
  return log
}
