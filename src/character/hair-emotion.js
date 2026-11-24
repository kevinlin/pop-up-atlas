import { stepSpring } from '../lib/spring.js'
import { baseCue } from './cue-tracker.js'

// Rotation about the hair bones' local X, the axis of the runtime hair spring (positive bends the
// chain forward, towards the face). Stand perks the chain back and up, droop lets it fall forward.
export const HAIR_STAND = -0.25
export const HAIR_DROOP = 0.35
// Share of the offset each hair bone carries; the four shares add up to the full offset at the tip.
export const emotionWeights = [0, 0.25, 0.35, 0.4]
export const HERO_HOLD = 1.5

const STAND_CUES = new Set(['voice_ooh', 'voice_whee'])
const DROOP_CUES = new Set(['voice_hmph', 'voice_hm'])
export const isEmotionCue = (cue) => STAND_CUES.has(baseCue(cue)) || DROOP_CUES.has(baseCue(cue))

// Spring-blended offset layered on the hair spring. The caller passes the leader's active cue
// (or undefined); hero fold-ups come from `onFold`, the gameplay signal, via `hero(until)`.
export function createHairEmotion() {
  const spring = { value: 0, velocity: 0 }
  let heroUntil = -Infinity

  return {
    get value() { return spring.value },
    hero(until) { heroUntil = Math.max(heroUntil, until) },
    update(dt, t, segment) {
      const cue = segment ? baseCue(segment.cue) : undefined
      let target = 0
      if (DROOP_CUES.has(cue)) target = HAIR_DROOP
      else if (STAND_CUES.has(cue) || t < heroUntil) target = HAIR_STAND
      if (dt > 0) stepSpring(spring, target, dt, 12, 0.7)
      return spring.value
    },
  }
}
