import { AnimationMixer, LoopOnce, MathUtils } from 'three'
import { playFootstep } from '../audio/live.js'

const names = ['idle', 'walk', 'dance']

export function createAnimation(model, clips) {
  const mixer = new AnimationMixer(model)
  const actions = Object.fromEntries(names.map((name) => {
    const clip = clips.find((candidate) => candidate.name === name)
    if (!clip) throw new Error(`Troll model is missing the ${name} clip`)
    return [name, mixer.clipAction(clip)]
  }))
  const { idle, walk, dance } = actions
  const danceDuration = dance.getClip().duration
  dance.setLoop(LoopOnce, 1)
  dance.clampWhenFinished = true
  walk.setEffectiveWeight(0)
  dance.setEffectiveWeight(0)
  idle.play()

  let state = 'idle'
  let duration = 0
  let elapsed = 0
  let startWeights

  return {
    get danceFinished() { return dance.time >= danceDuration },
    get danceTime() { return dance.time },
    update(next, speed, dt, t) {
      let walkStart = false
      if (next !== state) {
        duration = state === 'dance' && dance.time < danceDuration ? 0.1 : 0.18
        elapsed = 0
        // Keep the current mix when a transition interrupts another one.
        startWeights = names.map((name) => actions[name].getEffectiveWeight())
        const incoming = actions[next]
        if (incoming.getEffectiveWeight() === 0) {
          incoming.reset().play()
          walkStart = incoming === walk
        }
        state = next
      }

      if (elapsed < duration) {
        elapsed = Math.min(elapsed + dt, duration)
        const blend = MathUtils.smoothstep(elapsed, 0, duration)
        for (const [index, name] of names.entries()) {
          const action = actions[name]
          const weight = MathUtils.lerp(startWeights[index], Number(name === state), blend)
          if (blend === 1 && name !== state) action.stop()
          action.setEffectiveWeight(weight)
        }
      }

      const walkRate = speed / 1.2
      walk.setEffectiveTimeScale(walkRate)
      const previousWalkTime = walk.time
      mixer.update(dt)
      if (state !== 'walk') return
      if (walkStart) playFootstep(t)
      else if (walk.time < previousWalkTime) playFootstep(t - walk.time / walkRate)
      else if (previousWalkTime < 0.5 && walk.time >= 0.5) playFootstep(t - (walk.time - 0.5) / walkRate)
    },
  }
}
