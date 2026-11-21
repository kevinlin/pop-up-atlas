import { describe, expect, it } from 'vitest'
import { createScheduler } from '../src/audio/music.js'

const scale = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]
const fold = (t, dir = 'up') => ({ dir, id: 'flower', i: 2, j: -1, t })
const chimes = (voices) => voices.filter(({ kind }) => kind === 'chime')

describe('fold music', () => {
  it('walks the D major pentatonic scale in steps of one or two degrees across 10,000 events', () => {
    const schedule = createScheduler()
    let seed = 547
    let time = 0
    const degrees = []
    for (let index = 0; index < 10_000; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      time += seed / 2 ** 32 * 0.8
      for (const { midi } of chimes(schedule(fold(time)))) degrees.push(scale.indexOf(midi))
    }

    expect(degrees.length).toBeGreaterThan(5000)
    expect(degrees.every((degree) => degree >= 0)).toBe(true)
    const steps = degrees.slice(1).map((degree, index) => degree - degrees[index])
    expect(steps.every((step) => [1, 2].includes(Math.abs(step)))).toBe(true)
    expect(new Set(steps)).toEqual(new Set([-2, -1, 1, 2]))
  })

  it('plays pops at the fold and merges chimes on the next 312.5 ms slot', () => {
    const schedule = createScheduler()
    const voices = [0, 0.1, 0.312499, 0.3125, 0.55, 0.8, 0.93]
      .flatMap((time) => schedule(fold(time, time === 0.8 ? 'down' : 'up')))

    expect(chimes(voices).map(({ t }) => t)).toEqual([0.3125, 0.625, 0.9375])
    expect(voices.filter(({ kind }) => kind === 'pop').map(({ t, dir }) => [t, dir])).toEqual([
      [0, 'up'], [0.1, 'up'], [0.312499, 'up'], [0.3125, 'up'],
      [0.55, 'up'], [0.8, 'down'], [0.93, 'up'],
    ])

    const sparseSchedule = createScheduler()
    const sparseVoices = [0, 0.3125, 0.93].flatMap((t) => sparseSchedule(fold(t)))
    expect(chimes(voices)).toEqual(chimes(sparseVoices))
    expect(createScheduler()(fold(0, 'down')).map(({ kind }) => kind)).toEqual(['pop'])
  })

  it('caps 50 simultaneous folds at eight voices and recovers as sounds end', () => {
    const schedule = createScheduler()
    const voices = Array.from({ length: 50 }, (_, i) => schedule({ ...fold(0.305), i })).flat()

    expect(voices.filter(({ kind }) => kind === 'pop')).toHaveLength(7)
    expect(chimes(voices)).toHaveLength(1)
    expect(voices.filter(({ t, end }) => t <= 0.3125 && end > 0.3125)).toHaveLength(8)
    expect(schedule(fold(0.4)).map(({ kind }) => kind).sort()).toEqual(['chime', 'pop'])
  })

  it('leaves room at grid boundaries even when down folds arrive before the up fold', () => {
    const schedule = createScheduler()
    const voices = [0.1, 0.4, 0.8].flatMap((t) => schedule(fold(t)))
    voices.push(...Array.from({ length: 50 }, () => schedule(fold(1.24, 'down'))).flat())
    voices.push(...schedule(fold(1.245)))

    expect(chimes(voices).map(({ t }) => t)).toEqual([0.3125, 0.625, 0.9375, 1.25])
    for (const { t } of voices) {
      expect(voices.filter((voice) => voice.t <= t && t < voice.end).length).toBeLessThanOrEqual(8)
    }
    expect(voices.filter(({ t, end }) => t <= 1.25 && end > 1.25)).toHaveLength(8)
  })
})
