import { AnimationMixer, LoopOnce, MathUtils } from 'three'

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
    update(next, speed, dt) {
      if (next !== state) {
        duration = state === 'dance' && dance.time < danceDuration ? 0.1 : 0.18
        elapsed = 0
        // Keep the current mix when a transition interrupts another one.
        startWeights = names.map((name) => actions[name].getEffectiveWeight())
        const incoming = actions[next]
        if (incoming.getEffectiveWeight() === 0) incoming.reset().play()
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

      walk.setEffectiveTimeScale(speed / 1.2)
      mixer.update(dt)
    },
  }
}
