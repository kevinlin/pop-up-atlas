import { Color, Raycaster, Vector3 } from 'three'
import { flushAudioFolds, initAudio, playFold, setLeader } from './audio/live.js'
import { createDuoDance, createFollower, startFollower } from './character/follow.js'
import { createCharacter } from './character/index.js'
import { bindControls } from './controls/index.js'
import { createPlayer } from './controls/movement.js'
import { createLeadSwap } from './controls/swap.js'
import { setupDebug, setupDuoDebug } from './debug/index.js'
import { createAtmosphere } from './effects/air.js'
import { stage } from './effects/flags.js'
import { afterWorldDraw, afterWorldReady, warmStage } from './effects/startup.js'
import { createCameraRig } from './scene/camera-rig.js'
import { createLights } from './scene/lights.js'
import { addPlaceholders } from './scene/placeholders.js'
import { createRenderer } from './scene/renderer.js'
import { blockedBy, camera, isBlocked, player, registerUpdate, scene, updates } from './scene/runtime.js'
import { initWorld, onFold } from './world/index.js'

export { camera, isBlocked, player, registerUpdate, scene, setIsBlocked } from './scene/runtime.js'

scene.background = new Color(0xb07a52)
const { canvas, render, compile } = createRenderer(scene, camera)
const capsule = addPlaceholders(scene)
const followPlayer = createCameraRig(camera, player.position)
const followLight = createLights(scene)
const updateDebug = setupDebug(player)
const world = initWorld(window.__atlas)
const follower = createPlayer()
function placeFollower() {
  const spawn = startFollower(player, isBlocked)
  follower.position.set(spawn.x, 0, spawn.z)
  follower.heading = player.heading
  follower.velocity.set(0, 0, 0)
  follower.state = 'idle'
}
placeFollower()
const follow = createFollower(player, follower.position)
const previousLeaderPosition = player.position.clone()
const dance = createDuoDance()
const focus = new Vector3()
const butter = 0xf2ce78
const secondCapsule = capsule.clone()
secondCapsule.material = capsule.material.clone()
secondCapsule.material.color.set(butter)
let leaderCharacter = createCharacter(scene, capsule, { controller: player, isLeader: true })
let followerCharacter = createCharacter(scene, secondCapsule, {
  controller: follower, isLeader: false, modelURL: `${import.meta.env.BASE_URL}models/troll_b.glb`, fallbackTint: butter,
})
const debug = window.__atlas

function showLeaderHair() {
  debug.hairBones.splice(0, debug.hairBones.length, ...leaderCharacter.hairBones)
}

const swap = createLeadSwap(player, follower, () => {
  setLeader(swap.leader)
  const previousLeader = leaderCharacter
  leaderCharacter = followerCharacter
  followerCharacter = previousLeader
  leaderCharacter.bind(player, true)
  followerCharacter.bind(follower, false)
  showLeaderHair()
  follow.reset(follower.position, player.position)
  controls.cancelWalk()
})
const controls = bindControls(canvas, camera, player, {
  requestSwap: swap.request,
  hitsFollower(x, y, canvasBounds) {
    const box = followerCharacter.project(camera, canvasBounds)
    const pad = 8
    return x >= box.left - pad && x <= box.right + pad && y >= box.top - pad && y <= box.bottom + pad
  },
})
setupDuoDebug(follower, swap)

const duoProbe = new URLSearchParams(window.location.search).has('duo-probe')
  ? { scene, camera, raycaster: new Raycaster() } : null
if (duoProbe) window.__atlasDuoProbe = duoProbe

function setFollowerPose({ position, velocity, heading, state }) {
  follower.position.set(position.x, position.y, position.z)
  follower.velocity.set(velocity.x, velocity.y, velocity.z)
  follower.heading = heading
  follower.state = state
}

if (stage.fronds || stage.motes) {
  afterWorldReady(scene, (root) => registerUpdate(createAtmosphere(root, camera, player, () => world.seed)))
}
initAudio(`${import.meta.env.BASE_URL}audio/manifest.json`, world, player, window.__atlas)
onFold(playFold)

const loadStart = performance.now()
let assetsReady = false
let hasDrawn = false
Promise.all([debug.worldReady, leaderCharacter.ready, followerCharacter.ready])
  .then(() => {
    showLeaderHair()
    assetsReady = true
    return afterWorldDraw(scene, () => compile())
  })
  .then(() => {
    window.__atlas.loadMs = Math.round(performance.now() - loadStart)
    window.__atlas.ready = true
    return warmStage(scene, compile)
  })

let start
let previous

function frame(now) {
  start ??= now
  const elapsed = (now - start) / 1000
  const frameTime = (now - (previous ?? now)) / 1000
  const dt = Math.min(frameTime, 0.05)
  previous = now

  // Look-shot tools can relocate the leader beyond the retained trail.
  const relocated = previousLeaderPosition.distanceToSquared(player.position) > 8 ** 2
  if (relocated) {
    placeFollower()
    follow.reset(follower.position, player.position)
  }
  const hopping = Number.isFinite(follow.landing)
  if (hopping) setFollowerPose(follow.update(player, follower, dt, elapsed, isBlocked, false))
  const swapped = swap.update(elapsed, follow.landing)
  const input = controls.update(dt, blockedBy)
  previousLeaderPosition.copy(player.position)
  if (debug.ready || input) follow.observe(player.position, elapsed)
  const dancing = dance({
    dt: debug.ready ? frameTime : 0, t: elapsed, moving: player.state === 'walk', input: input || relocated,
    displacement: follow.displacement, swapped,
    leaderFinished: leaderCharacter.danceFinished,
    followerFinished: follower.state === 'dance' && followerCharacter.danceFinished,
  })
  player.state = dancing.leader
  if (!hopping || swapped) {
    setFollowerPose(follow.update(player, follower, dt, elapsed, isBlocked, dancing.followerDancing))
  }
  followPlayer(frameTime)
  followLight(player.position)
  leaderCharacter.update(dt, elapsed, player.state)
  followerCharacter.update(dt, elapsed, follower.state)
  for (const update of updates) update(dt, elapsed)
  flushAudioFolds()
  updateDebug(frameTime)
  // Hold the placeholder until the complete batch can use the stage's render target.
  if (assetsReady || !hasDrawn) {
    render(dt, focus.copy(player.position).lerp(follower.position, 0.3))
    hasDrawn = true
    if (debug.ready && duoProbe?.frame) {
      const { clientWidth: width, clientHeight: height } = canvas
      duoProbe.frame(elapsed, leaderCharacter.project(camera, { width, height }),
        followerCharacter.project(camera, { width, height }),
        player.position, follower.position, leaderCharacter.hairBones[3], followerCharacter.hairBones[3])
    }
  }
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
