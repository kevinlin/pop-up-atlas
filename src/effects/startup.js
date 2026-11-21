import { Group } from 'three'
import { warmCraftMaps } from './craft.js'

const pending = new WeakMap()

export function afterWorldReady(scene, create) {
  if (!pending.has(scene)) pending.set(scene, [])
  pending.get(scene).push(create)
}

export function afterWorldDraw(scene, work) {
  return new Promise((resolve, reject) => {
    const previous = scene.onAfterRender
    scene.onAfterRender = function (renderer, ...args) {
      scene.onAfterRender = previous
      previous.call(this, renderer, ...args)
      try {
        resolve(work(renderer))
      } catch (error) {
        reject(error)
      }
    }
  })
}

export async function warmStage(scene, compile) {
  const create = pending.get(scene)
  if (!create) return
  pending.delete(scene)
  await new Promise(requestAnimationFrame)

  const stage = new Group()
  stage.name = 'atlas/stage-effects'
  stage.visible = false
  for (const build of create) build(stage)
  scene.add(stage)

  // Compile the new meshes against the current world lights and render target.
  await afterWorldDraw(scene, (renderer) => Promise.all([compile(stage), warmCraftMaps(renderer)]))
  stage.visible = true
}
