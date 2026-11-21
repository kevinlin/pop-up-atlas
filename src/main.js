import { Color } from 'three'
import { flushAudioFolds, initAudio, playFold } from './audio/live.js'
import { createCharacter } from './character/index.js'
import { bindControls } from './controls/index.js'
import { setupDebug } from './debug/index.js'
import { createCameraRig } from './scene/camera-rig.js'
import { createLights } from './scene/lights.js'
import { addPlaceholders } from './scene/placeholders.js'
import { createRenderer } from './scene/renderer.js'
import { blockedBy, camera, player, scene, updates } from './scene/runtime.js'
import { initWorld, onFold } from './world/index.js'

export { camera, isBlocked, player, registerUpdate, scene, setIsBlocked } from './scene/runtime.js'

scene.background = new Color(0xb07a52)
const { canvas, render, compile } = createRenderer(scene, camera)
const capsule = addPlaceholders(scene)
const updateControls = bindControls(canvas, camera, player)
const followPlayer = createCameraRig(camera, player.position)
const followLight = createLights(scene)
const updateDebug = setupDebug(player)
const character = createCharacter(scene, capsule, player, canvas, window.__atlas)
Object.defineProperty(window.__atlas.player, 'state', { get: () => character.state })
const world = initWorld(window.__atlas)
initAudio(`${import.meta.env.BASE_URL}audio/manifest.json`, world, player, window.__atlas)
onFold(playFold)

const loadStart = performance.now()
Promise.all([window.__atlas.worldReady, character.ready])
  .then(() => new Promise(requestAnimationFrame)) // let the stream build its batches first
  .then(compile)
  .then(() => {
    window.__atlas.loadMs = Math.round(performance.now() - loadStart)
    window.__atlas.ready = true
  })

let start
let previous

function frame(now) {
  start ??= now
  const elapsed = (now - start) / 1000
  const frameTime = (now - (previous ?? now)) / 1000
  const dt = Math.min(frameTime, 0.05)
  previous = now

  updateControls(dt, blockedBy)
  followPlayer(dt)
  followLight(player.position)
  character.update(dt, frameTime, elapsed)
  for (const update of updates) update(dt, elapsed)
  flushAudioFolds()
  updateDebug(frameTime)
  render(dt, player.position)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
