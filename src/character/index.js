import { Group, MathUtils, Quaternion, Vector3 } from 'three'
import { playDance, updateCharacterAudio } from '../audio/live.js'
import { applyCraftMaterials } from '../materials/index.js'
import { createAnimation } from './animation.js'
import { createFootShadows } from './foot-shadows.js'
import { createHairMotion } from './hair-motion.js'
import { stepSpring } from '../lib/spring.js'
import { createCharacterState } from './state.js'

const localX = new Vector3(1, 0, 0)
const localZ = new Vector3(0, 0, 1)
const hairWeights = [0, 0.2, 0.7, 1]

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
  const updateHairMotion = createHairMotion()
  const heading = { value: player.heading, velocity: 0 }
  const pitch = new Quaternion()
  const roll = new Quaternion()
  const parentRotation = new Quaternion()
  const turnAxis = new Vector3()
  const twist = new Quaternion()
  let state = 'idle'
  let animation
  let hair
  let hips
  let updateFootShadows

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
    hips = model.getObjectByName('root')
    model.traverse((object) => { if (object.isMesh) object.castShadow = true })
    root.remove(capsule)
    root.add(model)
    updateFootShadows = createFootShadows(scene, model)
    debug.hairBones.push(...joints.map(({ position }) => position))
  }
  const ready = loadModel().catch((error) => console.warn('Using the placeholder troll', error))

  return {
    ready,
    get state() { return state },
    update(dt, frameTime, t) {
      const hasInput = heldKeys.size > 0 || receivedInput
      receivedInput = false
      const moving = player.state === 'walk'
      state = animation ? updateState(frameTime, moving, hasInput, animation.danceFinished) : player.state
      updateCharacterAudio(t, state, animation?.danceFinished)

      const turn = player.heading - heading.value
      const target = heading.value + Math.atan2(Math.sin(turn), Math.cos(turn))
      stepSpring(heading, target, dt, 32, 1)
      root.position.copy(player.position)
      root.rotation.y = heading.value
      const { velocity } = player
      if (!animation) {
        updateHairMotion(dt, velocity, heading, 0, false)
        return
      }

      // The mixer can skip writing an unchanged pose, so restore it before mixing.
      for (const { bone, baked } of hair) bone.quaternion.copy(baked)
      animation.update(state, velocity.length(), dt, t)
      if (state === 'dance') playDance(t, animation.danceTime)
      const bend = updateHairMotion(dt, velocity, heading, hips?.position.y ?? 0, state === 'dance')
      for (const [index, { bone, baked }] of hair.entries()) {
        baked.copy(bone.quaternion)
        if (!hairWeights[index]) continue
        if (index === 1 && bend.yaw) {
          // Twist above the crown. The lower section already turns with the head.
          bone.parent.getWorldQuaternion(parentRotation).invert()
          turnAxis.set(0, 1, 0).applyQuaternion(parentRotation)
          const upperTwist = MathUtils.clamp(1.14 * bend.yaw, -1.4, 1.4)
          bone.quaternion.premultiply(twist.setFromAxisAngle(turnAxis, upperTwist))
        }
        if (!bend.pitch && !bend.roll) continue
        pitch.setFromAxisAngle(localX, bend.pitch * hairWeights[index])
        roll.setFromAxisAngle(localZ, bend.roll * hairWeights[index])
        bone.quaternion.multiply(pitch).multiply(roll)
      }
      for (const { bone, position } of hair) bone.getWorldPosition(position)
      updateFootShadows()
    },
  }
}
