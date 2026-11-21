import { Group, MathUtils, Quaternion, Vector3 } from 'three'
import { applyCraftMaterials } from '../materials/index.js'
import { createAnimation } from './animation.js'
import { stepSpring } from '../lib/spring.js'
import { createCharacterState } from './state.js'

const localX = new Vector3(1, 0, 0)
const localZ = new Vector3(0, 0, 1)

export function createCharacter(scene, capsule, player, canvas, debug) {
  const root = new Group()
  root.add(capsule)
  scene.add(root)

  const heldKeys = new Set()
  let receivedInput = false
  window.addEventListener('keydown', ({ code }) => {
    heldKeys.add(code)
    receivedInput = true
  })
  window.addEventListener('keyup', ({ code }) => heldKeys.delete(code))
  window.addEventListener('blur', () => heldKeys.clear())
  canvas.addEventListener('pointerdown', () => { receivedInput = true })

  const updateState = createCharacterState()
  const heading = { value: player.heading, velocity: 0 }
  const hairPitch = { value: 0, velocity: 0 }
  const hairRoll = { value: 0, velocity: 0 }
  const previousVelocity = player.velocity.clone()
  const pitch = new Quaternion()
  const roll = new Quaternion()
  let ax = 0
  let az = 0
  let state = 'idle'
  let animation
  let hair

  async function loadModel() {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const { scene: model, animations } = await new GLTFLoader().loadAsync(
      `${import.meta.env.BASE_URL}models/troll.glb`,
    )
    applyCraftMaterials(model)
    const joints = Array.from({ length: 4 }, (_, index) => {
      const bone = model.getObjectByName(`hair_${index}`)
      if (!bone?.isBone) throw new Error(`Troll model is missing hair_${index}`)
      return { bone, baked: bone.quaternion.clone(), position: new Vector3() }
    })
    animation = createAnimation(model, animations)
    hair = joints
    model.traverse((object) => { if (object.isMesh) object.castShadow = true })
    root.remove(capsule)
    root.add(model)
    debug.hairBones.push(...joints.map(({ position }) => position))
  }
  const ready = loadModel().catch((error) => console.warn('Using the placeholder troll', error))

  return {
    ready,
    get state() { return state },
    update(dt, frameTime) {
      const hasInput = heldKeys.size > 0 || receivedInput
      receivedInput = false
      const moving = player.state === 'walk'
      state = animation ? updateState(frameTime, moving, hasInput, animation.danceFinished) : player.state

      const turn = player.heading - heading.value
      const target = heading.value + Math.atan2(Math.sin(turn), Math.cos(turn))
      stepSpring(heading, target, dt, 32, 1)
      root.position.copy(player.position)
      root.rotation.y = heading.value
      if (!animation) return

      const { velocity } = player
      // Controls step the velocity instantly. Spread that impulse over a few frames.
      if (dt > 0) {
        const decay = Math.exp(-dt / 0.06)
        const gain = (1 - decay) / dt
        ax = ax * decay + (velocity.x - previousVelocity.x) * gain
        az = az * decay + (velocity.z - previousVelocity.z) * gain
      }
      previousVelocity.copy(velocity)
      const sin = Math.sin(heading.value)
      const cos = Math.cos(heading.value)
      const forward = ax * sin + az * cos
      const sideways = ax * cos - az * sin
      const pitchTarget = MathUtils.clamp(-forward * 0.045, -0.14, 0.14)
      const rollTarget = MathUtils.clamp(sideways * 0.045 + heading.velocity * 0.018, -0.14, 0.14)
      stepSpring(hairPitch, pitchTarget, dt, 14, 0.58)
      stepSpring(hairRoll, rollTarget, dt, 14, 0.58)

      // The mixer can skip writing an unchanged pose, so restore it before mixing.
      for (const { bone, baked } of hair) bone.quaternion.copy(baked)
      animation.update(state, velocity.length(), dt)
      for (const [index, { bone, baked }] of hair.entries()) {
        baked.copy(bone.quaternion)
        const weight = 0.45 + index * 0.18
        pitch.setFromAxisAngle(localX, hairPitch.value * weight)
        roll.setFromAxisAngle(localZ, hairRoll.value * weight)
        bone.quaternion.multiply(pitch).multiply(roll)
      }
      for (const { bone, position } of hair) bone.getWorldPosition(position)
    },
  }
}
