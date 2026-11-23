import { MathUtils, Quaternion, Vector3 } from 'three'
import { events } from '../scene/runtime.js'
import { TILE_SIZE } from '../world/tiles.js'
import { createAnimation } from './animation.js'
import { createCueTracker } from './cue-tracker.js'
import { createFace } from './face.js'
import { createHairEmotion, emotionWeights, HERO_HOLD, isEmotionCue } from './hair-emotion.js'
import { createHairMotion } from './hair-motion.js'
import { createSquash, SQUASH_CONTACT, SQUASH_LANDING, STRETCH_TAKEOFF } from './squash.js'
import { createUmbrella } from './umbrella.js'

const localX = new Vector3(1, 0, 0)
const localZ = new Vector3(0, 0, 1)
const hairWeights = [0, 0.2, 0.7, 1]
const HERO_IDS = new Set(['mushroom_house', 'cupcake_tree', 'yarn_bridge'])
const HERO_RADIUS = 2.5
// Pitch-spring velocity (rad/s) that one of B's own foot contacts adds to its hair.
export const HAIR_KICK = 4.5

// Everything that makes one loaded model act: mixer, contacts, face, hair spring and emotion, squash,
// umbrella, and the character events it produces. `who` is the rig ('a' or 'b'), not the role.
// `duo` (createDuoDanceEvents) is shared by both rigs and turns their dance events into the duo ones.
export function createRig(model, clips, { who, bus = events, seed = () => 0, duo } = {}) {
  const joints = Array.from({ length: 4 }, (_, index) => {
    const bone = model.getObjectByName(`hair_${index}`)
    if (!bone?.isBone) throw new Error(`Troll model is missing hair_${index}`)
    return { bone, baked: bone.quaternion.clone(), position: new Vector3() }
  })
  const hips = model.getObjectByName('root')
  const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }))

  const updateHairMotion = createHairMotion()
  const squash = createSquash(hips)
  const emotion = createHairEmotion()
  const umbrella = createUmbrella(model)
  const tracker = createCueTracker(bus, who)
  const face = createFace(model, { who, tracker, seed })
  const animation = createAnimation(model, clips, {
    seed,
    contact(foot, t) {
      emit('contact', { who, foot, t })
      squash.trigger(SQUASH_CONTACT)
      if (who === 'b') updateHairMotion.kick(HAIR_KICK)
    },
    danceStart(t) {
      emit('dance-start', { who, t })
      duo?.start({ who, t })
    },
    danceEnd(t, interrupted) {
      emit('dance-end', { who, t, interrupted })
      duo?.end({ who, t, interrupted })
      umbrella.close()
    },
    marker(name, t) {
      if (name === 'landing') squash.trigger(SQUASH_LANDING)
      else umbrella.bow(t)
    },
  })
  const onBump = ({ detail }) => {
    if (detail.who === who && detail.reason === 'river') umbrella.collide(detail.t)
  }
  bus.addEventListener('bump', onBump)

  const pitch = new Quaternion()
  const roll = new Quaternion()
  const parentRotation = new Quaternion()
  const turnAxis = new Vector3()
  const twist = new Quaternion()
  let hopping = false

  return {
    hair: joints,
    animation,
    face: face.state,
    umbrella,
    squash,
    emotion,
    get lookDuration() { return animation.lookDuration },
    // A hero fold-up near the leader makes the hair stand (gameplay signal, works with audio locked).
    fold({ dir, id, i, j, t }, position, leader) {
      if (!leader || dir !== 'up' || !HERO_IDS.has(id)) return
      if (Math.hypot(i * TILE_SIZE - position.x, j * TILE_SIZE - position.z) <= HERO_RADIUS) {
        emotion.hero(t + HERO_HOLD)
      }
    },
    dispose() {
      tracker.dispose()
      bus.removeEventListener('bump', onBump)
    },
    // `state` is the controller state (idle, walk, dance or the follower's hop); `heading` is the
    // heading spring {value, velocity}; `leader` and `looking` come from the duo logic.
    update(dt, t, state, velocity, heading, { leader = true, looking = false, footstep } = {}) {
      if ((state === 'hop') !== hopping) {
        hopping = state === 'hop'
        emit('hop', { who, phase: hopping ? 'takeoff' : 'land', t })
        squash.trigger(hopping ? STRETCH_TAKEOFF : SQUASH_LANDING)
      }

      // The mixer can skip writing an unchanged pose, so restore it before mixing.
      for (const { bone, baked } of joints) bone.quaternion.copy(baked)
      animation.update(hopping ? 'idle' : state, velocity.length(), dt, t,
        leader ? footstep : undefined, !leader, { looking: looking && !hopping })
      face.update(dt, t, leader)
      umbrella.update(dt, t)

      const bend = updateHairMotion(dt, velocity, heading, hips?.position.y ?? 0, state === 'dance')
      const lift = emotion.update(dt, t, leader ? tracker.latest(t, 0, isEmotionCue) : undefined)
      for (const [index, { bone, baked }] of joints.entries()) {
        baked.copy(bone.quaternion)
        if (!hairWeights[index]) continue
        if (index === 1 && bend.yaw) {
          // Twist above the crown. The lower section already turns with the head.
          bone.parent.getWorldQuaternion(parentRotation).invert()
          turnAxis.set(0, 1, 0).applyQuaternion(parentRotation)
          const upperTwist = MathUtils.clamp(1.14 * bend.yaw, -1.4, 1.4)
          bone.quaternion.premultiply(twist.setFromAxisAngle(turnAxis, upperTwist))
        }
        const bendPitch = bend.pitch * hairWeights[index] + lift * emotionWeights[index]
        if (!bendPitch && !bend.roll) continue
        pitch.setFromAxisAngle(localX, bendPitch)
        roll.setFromAxisAngle(localZ, bend.roll * hairWeights[index])
        bone.quaternion.multiply(pitch).multiply(roll)
      }
      squash.update(dt)
      for (const { bone, position } of joints) bone.getWorldPosition(position)
    },
  }
}
