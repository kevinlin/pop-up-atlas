import { MathUtils, Vector3 } from 'three'
import { TILE_SIZE } from '../world/tiles.js'
import { onFold as onWorldFold } from '../world/index.js'
import { events as sceneEvents, follower as sceneFollower, player as scenePlayer } from './runtime.js'

// docs/contracts.md "Round 6" → Camera. Angles are degrees here, radians inside the maths.
export const WALK_CAMERA = { distance: 7.5, pitch: 35, tau: 0.25 }
export const DANCE_BEAT = { distance: 4.5, pitch: 22, aimY: 0.25, easeIn: 0.6, easeOut: 0.8 }
export const HERO_BEAT = {
  distance: 6.0, pitch: 30, aimY: 0, easeIn: 0.5, easeOut: 0.8, duration: 1.5, minGap: 8, radius: 2.5,
  tiles: ['mushroom_house', 'cupcake_tree', 'yarn_bridge'],
}
export const FIT = { lift: 0.5, radius: 0.6, margin: 0.06, maxDistance: 10, skipAbove: 7.5 }
// A hop that never reports its landing stops blocking hero beats after this long.
const HOP_BLOCK_LIMIT = 3

const smooth = (x) => x * x * (3 - 2 * x)

// Smallest camera distance >= `from` (capped at FIT.maxDistance) at which every sphere (centre x, y, z; FIT.radius)
// sits inside the frame inset by FIT.margin on each side. The camera looks at `look` from straight behind (+Z), so
// yaw is always 0. Pure: no allocation, takes plain {x, y, z} points.
export function fitDistance(look, spheres, { pitch, fov, aspect, from }) {
  const sin = Math.sin(MathUtils.degToRad(pitch))
  const cos = Math.cos(MathUtils.degToRad(pitch))
  const inset = 1 - 2 * FIT.margin
  const tanV = Math.tan(MathUtils.degToRad(fov) / 2) * inset
  const tanH = tanV * aspect
  const normV = FIT.radius * Math.sqrt(1 + tanV * tanV)
  const normH = FIT.radius * Math.sqrt(1 + tanH * tanH)

  function fits(distance) {
    const cameraY = look.y + distance * sin
    const cameraZ = look.z + distance * cos
    for (const sphere of spheres) {
      const dx = sphere.x - look.x
      const dy = sphere.y - cameraY
      const dz = sphere.z - cameraZ
      const depth = -(dy * sin + dz * cos)
      const up = dy * cos - dz * sin
      if (depth <= FIT.radius
        || depth * tanH - Math.abs(dx) < normH
        || depth * tanV - Math.abs(up) < normV) return false
    }
    return true
  }

  const start = Math.min(from, FIT.maxDistance)
  if (fits(start)) return start
  if (!fits(FIT.maxDistance)) return FIT.maxDistance
  let low = start
  let high = FIT.maxDistance
  for (let i = 0; i < 24; i += 1) {
    const middle = (low + high) / 2
    if (fits(middle)) high = middle
    else low = middle
  }
  return high
}

// `position` is the point the camera follows (the leader's controller position). Options let tests inject the
// shared singletons: { events, player, follower, onFold }.
export function createCameraRig(camera, position, options = {}) {
  const {
    events = sceneEvents, player = scenePlayer, follower = sceneFollower, onFold = onWorldFold,
  } = options
  const framing = new URLSearchParams(window.location.search).get('cam')?.split(',')
  const [requestedDistance, requestedPitch] = framing?.map(Number) ?? []
  const diagnostic = framing?.length === 2 && framing.every((value) => value.trim())
    && Number.isFinite(requestedDistance) && requestedDistance > camera.near
    && Number.isFinite(requestedPitch) && requestedPitch > 0 && requestedPitch < 90
  const walk = diagnostic
    ? { distance: requestedDistance, pitch: requestedPitch, aimY: 0 }
    : { distance: WALK_CAMERA.distance, pitch: WALK_CAMERA.pitch, aimY: 0 }

  const target = position.clone()
  const look = new Vector3()
  const pose = { distance: walk.distance, pitch: walk.pitch, aimY: 0 }
  const from = { ...pose }
  let to = walk
  let blend = 0
  let blendDuration = 0
  let clock = 0
  let beat = null
  let heroEnd = 0
  let lastHero = -Infinity
  let hopStart = null
  let fitExtra = 0
  let started = false
  const spheres = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]

  const state = {
    distance: pose.distance,
    pitch: pose.pitch,
    target: { x: target.x, y: target.y, z: target.z },
    beat: null,
  }

  function currentPose(out) {
    const k = blendDuration > 0 ? smooth(Math.min(1, blend / blendDuration)) : 1
    out.distance = from.distance + (to.distance - from.distance) * k
    out.pitch = from.pitch + (to.pitch - from.pitch) * k
    out.aimY = from.aimY + (to.aimY - from.aimY) * k
    return out
  }

  function retarget(next, duration) {
    currentPose(from)
    to = next
    blend = 0
    blendDuration = duration
  }

  function fitFor(distance, pitch, aimY) {
    spheres[0].x = player.position.x
    spheres[0].y = player.position.y + FIT.lift
    spheres[0].z = player.position.z
    spheres[1].x = follower.position.x
    spheres[1].y = follower.position.y + FIT.lift
    spheres[1].z = follower.position.z
    look.set(target.x, target.y + aimY, target.z)
    return fitDistance(look, spheres, { pitch, fov: camera.fov, aspect: camera.aspect, from: distance })
  }

  function startBeat(name, config) {
    if (fitFor(config.distance, config.pitch, config.aimY) > FIT.skipAbove) return false
    beat = name
    retarget(config, config.easeIn)
    return true
  }

  function cancelBeat() {
    if (!beat) return
    beat = null
    retarget(walk, DANCE_BEAT.easeOut)
  }

  const listeners = []
  const listen = (type, handler) => {
    events.addEventListener(type, handler)
    listeners.push(() => events.removeEventListener(type, handler))
  }
  let unfold = () => {}
  if (!diagnostic) {
    listen('duo-dance-start', () => {
      // Dance outranks hero: it replaces a running hero beat.
      if (beat !== 'dance') startBeat('dance', DANCE_BEAT)
    })
    listen('duo-dance-end', () => {
      if (beat === 'dance') {
        beat = null
        retarget(walk, DANCE_BEAT.easeOut)
      }
    })
    listen('swap', cancelBeat)
    listen('hop', (event) => {
      cancelBeat()
      hopStart = event.detail?.phase === 'land' ? null : clock
    })
    unfold = onFold((fold) => {
      if (fold.dir !== 'up' || !HERO_BEAT.tiles.includes(fold.id) || beat === 'dance' || beat === 'hero') return
      if (hopStart !== null && clock - hopStart < HOP_BLOCK_LIMIT) return
      if (clock - lastHero < HERO_BEAT.minGap) return
      const dx = (fold.x ?? fold.i * TILE_SIZE) - player.position.x
      const dz = (fold.z ?? fold.j * TILE_SIZE) - player.position.z
      if (Math.hypot(dx, dz) > HERO_BEAT.radius) return
      if (startBeat('hero', HERO_BEAT)) {
        lastHero = clock
        heroEnd = clock + HERO_BEAT.duration
      }
    }) ?? unfold
  }

  function publish() {
    const atlas = globalThis.window?.__atlas
    if (atlas && atlas.camera !== state) atlas.camera = state
  }

  function update(dt) {
    clock += dt
    blend += dt
    target.lerp(position, 1 - Math.exp(-dt / WALK_CAMERA.tau))
    if (beat === 'hero' && clock >= heroEnd) {
      beat = null
      retarget(walk, HERO_BEAT.easeOut)
    }
    currentPose(pose)
    if (!diagnostic) {
      const needed = fitFor(pose.distance, pose.pitch, pose.aimY) - pose.distance
      fitExtra = started ? fitExtra + (needed - fitExtra) * (1 - Math.exp(-dt / WALK_CAMERA.tau)) : needed
      started = true
    }
    const distance = Math.min(pose.distance + Math.max(0, fitExtra), Math.max(FIT.maxDistance, pose.distance))
    const pitch = MathUtils.degToRad(pose.pitch)
    look.set(target.x, target.y + pose.aimY, target.z)
    camera.position.set(look.x, look.y + distance * Math.sin(pitch), look.z + distance * Math.cos(pitch))
    camera.lookAt(look)
    state.distance = distance
    state.pitch = pose.pitch
    state.target.x = look.x
    state.target.y = look.y
    state.target.z = look.z
    state.beat = beat
    publish()
  }

  update.dispose = () => {
    for (const remove of listeners) remove()
    unfold()
  }
  return update
}
