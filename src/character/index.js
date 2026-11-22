import { Group, MathUtils, Quaternion, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { playDance, playFootstep, updateCharacterAudio } from '../audio/live.js'
import { applyCraftMaterials } from '../materials/index.js'
import { createAnimation } from './animation.js'
import { createCharacterBounds } from './bounds.js'
import { createFootShadows } from './foot-shadows.js'
import { createHairMotion } from './hair-motion.js'
import { stepSpring } from '../lib/spring.js'

const localX = new Vector3(1, 0, 0)
const localZ = new Vector3(0, 0, 1)
const hairWeights = [0, 0.2, 0.7, 1]

const baseModel = `${import.meta.env.BASE_URL}models/troll.glb`
const mintMaterial = /^felt_(mint|fibre_(mint|green|light))$/
let baseAsset

export function createCharacter(scene, capsule, { controller, isLeader, modelURL = baseModel, fallbackTint }) {
  const root = new Group()
  root.add(capsule)
  scene.add(root)

  const bounds = createCharacterBounds()
  bounds.bind(capsule)
  const updateHairMotion = createHairMotion()
  const heading = { value: controller.heading, velocity: 0 }
  const pitch = new Quaternion()
  const roll = new Quaternion()
  const parentRotation = new Quaternion()
  const turnAxis = new Vector3()
  const twist = new Quaternion()
  let animation
  let hair
  let hairBones = []
  let hips
  let updateFootShadows

  async function loadModel() {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    let gltf
    if (modelURL !== baseModel) {
      const url = new URL(modelURL, document.baseURI)
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.arrayBuffer()
        // Vite can return the app HTML for a missing GLB.
        if (data.byteLength >= 12 && new DataView(data).getUint32(0, true) === 0x46546c67) {
          gltf = await loader.parseAsync(data, new URL('.', url).href)
        }
      }
    }
    const asset = gltf ?? await (baseAsset ??= loader.loadAsync(baseModel)
      .then(({ scene, animations }) => ({ scene, animations })))
    const model = gltf ? asset.scene : clone(asset.scene)
    if (!gltf && fallbackTint) {
      const tinted = new Map()
      function tint(material) {
        if (!mintMaterial.test(material.name)) return material
        if (!tinted.has(material)) {
          const butter = material.clone()
          butter.name = 'felt_butter'
          butter.color.set(fallbackTint)
          butter.map = null
          tinted.set(material, butter)
        }
        return tinted.get(material)
      }
      model.traverse((mesh) => {
        if (!mesh.isMesh) return
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material)
      })
    }
    applyCraftMaterials(model)
    const joints = Array.from({ length: 4 }, (_, index) => {
      const bone = model.getObjectByName(`hair_${index}`)
      if (!bone?.isBone) throw new Error(`Troll model is missing hair_${index}`)
      return { bone, baked: bone.quaternion.clone(), position: new Vector3() }
    })
    animation = createAnimation(model, asset.animations)
    hair = joints
    hips = model.getObjectByName('root')
    model.traverse((object) => { if (object.isMesh) object.castShadow = true })
    root.remove(capsule)
    root.add(model)
    updateFootShadows = createFootShadows(scene, model)
    hairBones = joints.map(({ position }) => position)
    bounds.bind(model)
  }
  const ready = loadModel().catch((error) => console.warn('Using the placeholder troll', error))

  return {
    ready,
    get danceFinished() { return animation?.danceFinished },
    get hairBones() { return hairBones },
    project: bounds.project,
    bind(next, leader) {
      controller = next
      isLeader = leader
    },
    update(dt, t, state) {
      if (isLeader) updateCharacterAudio(t, state, animation?.danceFinished)

      const turn = controller.heading - heading.value
      const target = heading.value + Math.atan2(Math.sin(turn), Math.cos(turn))
      stepSpring(heading, target, dt, 32, 1)
      root.position.copy(controller.position)
      root.rotation.y = heading.value
      const { velocity } = controller
      if (!animation) {
        updateHairMotion(dt, velocity, heading, 0, false)
        return
      }

      // The mixer can skip writing an unchanged pose, so restore it before mixing.
      for (const { bone, baked } of hair) bone.quaternion.copy(baked)
      animation.update(state === 'hop' ? 'idle' : state, velocity.length(), dt, t,
        isLeader ? playFootstep : undefined, !isLeader)
      if (isLeader && state === 'dance') playDance(t, animation.danceTime)
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
