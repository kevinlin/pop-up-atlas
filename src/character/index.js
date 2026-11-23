import { Group } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { playDance, playFootstep, updateCharacterAudio } from '../audio/live.js'
import { applyCraftMaterials } from '../materials/index.js'
import { createCharacterBounds } from './bounds.js'
import { createFootShadows } from './foot-shadows.js'
import { createRig } from './rig.js'
import { stepSpring } from '../lib/spring.js'

const baseModel = `${import.meta.env.BASE_URL}models/troll.glb`
const mintMaterial = /^felt_(mint|fibre_(mint|green|light))$/
let baseAsset

// `who` is the rig ('a' = troll.glb, 'b' = troll_b.glb) and stays with the character through lead swaps.
export function createCharacter(scene, capsule, { controller, isLeader, who, seed, duo, modelURL = baseModel, fallbackTint }) {
  const root = new Group()
  root.add(capsule)
  scene.add(root)

  const bounds = createCharacterBounds()
  bounds.bind(capsule)
  const heading = { value: controller.heading, velocity: 0 }
  let rig
  let hairBones = []
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
    const next = createRig(model, asset.animations, { who, seed, duo })
    model.traverse((object) => { if (object.isMesh) object.castShadow = true })
    root.remove(capsule)
    root.add(model)
    updateFootShadows = createFootShadows(scene, model)
    rig = next
    hairBones = next.hair.map(({ position }) => position)
    bounds.bind(model)
  }
  const ready = loadModel().catch((error) => console.warn('Using the placeholder troll', error))

  return {
    ready,
    who,
    get danceFinished() { return rig?.animation.danceFinished },
    get hairBones() { return hairBones },
    // Seconds of B's `look` clip, 0 for a rig without one (or before it loads).
    get lookDuration() { return rig?.lookDuration ?? 0 },
    get face() { return rig?.face },
    get umbrella() { return rig?.umbrella },
    project: bounds.project,
    bind(next, leader) {
      controller = next
      isLeader = leader
    },
    // A fold event from `onFold`: a hero fold-up near the leader lifts its hair.
    fold(event) { rig?.fold(event, controller.position, isLeader) },
    update(dt, t, state, { looking = false } = {}) {
      if (isLeader) updateCharacterAudio(t, state, rig?.animation.danceFinished)

      const turn = controller.heading - heading.value
      const target = heading.value + Math.atan2(Math.sin(turn), Math.cos(turn))
      stepSpring(heading, target, dt, 32, 1)
      root.position.copy(controller.position)
      root.rotation.y = heading.value
      if (!rig) return

      rig.update(dt, t, state, controller.velocity, heading, { leader: isLeader, looking, footstep: playFootstep })
      if (isLeader && state === 'dance') playDance(t, rig.animation.danceTime)
      updateFootShadows()
    },
  }
}
