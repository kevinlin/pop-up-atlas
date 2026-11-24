import { AnimationMixer, LoopOnce, MathUtils } from 'three'
import { hash } from '../world/hash.js'
import { walkTimeScale } from './follow.js'
import { ANTICIPATION_LEAD } from './squash.js'

// Shared dance beat markers (docs/contracts.md "Round 6" → Characters), seconds of dance clip time.
export const DANCE_LANDING = 1.67
export const DANCE_BOW = 2.19

const SKIP_SALT = 35
const SKIP_CYCLES = 2
const SKIP_STANDING = 1
const BLEND = 0.18
const DANCE_CUT_BLEND = 0.1
const required = ['idle', 'walk', 'dance']
const optional = ['skip', 'look']

// One walk start in four, by hash of the world seed and the character's walk-start counter.
export const skipsOnStart = (seed, start) => hash(seed, start, 0, SKIP_SALT) % 4 === 0

// Mixer for one rig. `hooks` are all optional:
//   contact(foot, t)       'l' at clip time 0, 'r' at half the playing walk or skip clip
//   danceStart(t), danceEnd(t, interrupted), marker('landing' | 'bow', t)
//   seed()                 world seed for the skip choice
// `looking` (follower only) plays the rig's `look` clip while the state stays idle.
export function createAnimation(model, clips, hooks = {}) {
  const mixer = new AnimationMixer(model)
  const actions = {}
  for (const name of required) {
    const clip = clips.find((candidate) => candidate.name === name)
    if (!clip) throw new Error(`Troll model is missing the ${name} clip`)
    actions[name] = mixer.clipAction(clip)
  }
  // Rigs carry only their own extras (A: skip, B: look); a missing one is skipped.
  for (const name of optional) {
    const clip = clips.find((candidate) => candidate.name === name)
    if (clip) actions[name] = mixer.clipAction(clip)
  }
  const names = Object.keys(actions)
  const { idle, walk, dance, skip, look } = actions
  const danceDuration = dance.getClip().duration
  dance.setLoop(LoopOnce, 1)
  dance.clampWhenFinished = true
  if (look) {
    look.setLoop(LoopOnce, 1)
    look.clampWhenFinished = true
  }
  for (const name of names) if (name !== 'idle') actions[name].setEffectiveWeight(0)
  idle.play()

  let state = 'idle'
  let target = 'idle'
  let locomotion = 'walk'
  let skipCycles = 0
  let walkStarts = 0
  let standing = 0
  let previousDance = 0
  let duration = 0
  let elapsed = 0
  let startWeights = []

  // Blend toward `name`; true when the action was (re)started from its first frame.
  function retarget(name, seconds) {
    duration = seconds
    elapsed = 0
    // Keep the current mix when a transition interrupts another one.
    startWeights = names.map((candidate) => actions[candidate].getEffectiveWeight())
    target = name
    const incoming = actions[name]
    if (incoming.getEffectiveWeight() !== 0) return false
    incoming.reset().play()
    return true
  }

  return {
    get danceFinished() { return dance.time >= danceDuration },
    get danceTime() { return dance.time },
    get lookDuration() { return look ? look.getClip().duration : 0 },
    get locomotion() { return locomotion },
    get target() { return target },
    update(next, speed, dt, t, onStep, follower = false, { looking = false } = {}) {
      let walkStart = false
      let blend = BLEND
      let entered = false
      if (next !== state) {
        if (state === 'dance') {
          const interrupted = dance.time < danceDuration
          if (interrupted) blend = DANCE_CUT_BLEND
          hooks.danceEnd?.(t, interrupted)
        }
        if (next === 'dance') {
          hooks.danceStart?.(t)
          previousDance = 0
        }
        if (next === 'walk') {
          const start = walkStarts
          walkStarts += 1
          const skips = !follower && skip && standing >= SKIP_STANDING - 1e-9
            && skipsOnStart(hooks.seed?.() ?? 0, start)
          locomotion = skips ? 'skip' : 'walk'
          skipCycles = skips ? SKIP_CYCLES : 0
          standing = 0
          entered = true
        }
        state = next
      }

      const desired = state === 'walk' ? locomotion : state === 'dance' ? 'dance'
        : looking && follower && look ? 'look' : 'idle'
      if (desired !== target) {
        const fresh = retarget(desired, blend)
        walkStart = entered && fresh
      }

      if (elapsed < duration) {
        elapsed = Math.min(elapsed + dt, duration)
        const mix = MathUtils.smoothstep(elapsed, 0, duration)
        for (const [index, name] of names.entries()) {
          const action = actions[name]
          const weight = MathUtils.lerp(startWeights[index], Number(name === target), mix)
          if (mix === 1 && name !== target) action.stop()
          action.setEffectiveWeight(weight)
        }
      }

      const rate = Math.max(1e-6, follower ? walkTimeScale(speed) : speed / 1.2)
      walk.setEffectiveTimeScale(rate)
      skip?.setEffectiveTimeScale(rate)
      const playing = actions[locomotion]
      const previous = playing.time
      mixer.update(dt)

      if (state === 'dance') {
        const now = dance.time
        for (const [name, at] of [['anticipation', DANCE_LANDING - ANTICIPATION_LEAD], ['landing', DANCE_LANDING], ['bow', DANCE_BOW]]) {
          if (previousDance < at && now >= at) hooks.marker?.(name, t - (now - at))
        }
        previousDance = now
      }
      if (state !== 'walk') {
        standing += dt
        return
      }

      const contact = (foot, time) => {
        hooks.contact?.(foot, time)
        onStep?.(time)
      }
      const half = playing.getClip().duration / 2
      if (walkStart) contact('l', t)
      else if (playing.time < previous) {
        contact('l', t - playing.time / rate)
        skipCycles -= 1
        if (locomotion === 'skip' && skipCycles <= 0) {
          // Two skip cycles are done: carry the phase over to the walk.
          locomotion = 'walk'
          retarget('walk', BLEND)
          walk.time = playing.time
        }
      } else if (previous < half && playing.time >= half) {
        contact('r', t - (playing.time - half) / rate)
      }
    },
  }
}
