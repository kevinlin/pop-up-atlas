import { describe, expect, it } from 'vitest'
import { createScheduler } from '../src/audio/music.js'

const eighth = 0.3125
const phrase = [74, 71, 76, 78, 74, 71, 69, 74]
const fold = (t, dir = 'up', id = 'flower') => ({ dir, id, i: 2, j: -1, t })
const inSlot = (slot) => fold(slot * eighth - 0.01)
const chimes = (voices) => voices.filter(({ kind }) => kind === 'chime')
const pops = (voices) => voices.filter(({ kind }) => kind === 'pop')

describe('fold music', () => {
  it('plays the eight-note question and answer with accents, short passing notes, and a ringing final D', () => {
    const events = Array.from({ length: 8 }, (_, index) => inSlot(index + 1))
    const notes = chimes(events.flatMap(createScheduler()))

    expect(notes.map(({ midi }) => midi)).toEqual(phrase)
    expect(notes.map(({ gain }) => gain)).toEqual([10 ** 0.1, 1, 1, 1, 10 ** 0.1, 1, 1, 1])
    for (const index of [1, 2, 3, 5, 6]) {
      expect(notes[index].end - notes[index].t).toBeCloseTo(0.2)
    }
    expect(notes[7].end - notes[7].t).toBeGreaterThanOrEqual(1)
  })

  it('stays in D major pentatonic with at most one changed interior note per repeat', () => {
    const events = Array.from({ length: 10_000 }, (_, index) => inSlot(index + 1))
    const pitches = chimes(events.flatMap(createScheduler())).map(({ midi }) => midi)
    const scale = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]
    expect(pitches).toHaveLength(events.length)
    expect(pitches.every((midi) => scale.includes(midi))).toBe(true)
    let varied = false
    for (let offset = 8; offset < pitches.length; offset += 8) {
      const changed = phrase.flatMap((midi, index) => midi === pitches[offset + index] ? [] : [index])
      if (changed.length) varied = true
      expect(changed.length <= 1 && changed.every((index) => index > 0 && index < 7)).toBe(true)
    }
    expect(varied).toBe(true)
  })

  it('restarts after four empty slots but continues after three, even if there are fold-downs', () => {
    const events = [inSlot(1), inSlot(5), fold(6 * eighth, 'down'), inSlot(10), inSlot(11)]
    const notes = chimes(events.flatMap(createScheduler()))

    expect(notes.map(({ t, midi }) => [t, midi])).toEqual([
      [eighth, 74], [5 * eighth, 71], [10 * eighth, 74], [11 * eighth, 71],
    ])
  })

  it('quantizes up chimes to the next slot and advances only once per occupied slot', () => {
    const events = [0, 0, 0.1, 0.312499, 0.3125, 0.55, 0.8, 0.93]
      .map((time) => fold(time, time === 0.8 ? 'down' : 'up'))
    const voices = events.flatMap(createScheduler())

    expect(chimes(voices).map(({ t, midi }) => [t, midi])).toEqual([[0.3125, 74], [0.625, 71], [0.9375, 76]])
    expect(pops(voices).map(({ t, dir }) => [t, dir])).toEqual([
      [0, 'up'], [0.1, 'up'], [0.312499, 'up'], [0.3125, 'up'],
      [0.55, 'up'], [0.8, 'down'], [0.93, 'up'],
    ])
    expect(chimes([fold(0, 'down')].flatMap(createScheduler()))).toHaveLength(0)
  })

  it('groups 50 same-frame folds by direction and caps the boost at 3 dB', () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ ...fold(0.305, i % 2 ? 'up' : 'down', `tile-${i}`), i }))
    events.push(fold(0.31), fold(0.32, 'down'), fold(0.32, 'down'))
    const voices = events.flatMap(createScheduler())

    expect(pops(voices).map(({ t, dir, id, gain }) => [t, dir, id, gain])).toEqual([
      [0.305, 'down', 'tile-0', 10 ** 0.15], [0.305, 'up', 'tile-1', 10 ** 0.15],
      [0.31, 'up', 'flower', 1], [0.32, 'down', 'flower', 10 ** 0.05],
    ])
    expect(chimes(voices).map(({ t, id }) => [t, id])).toEqual([[0.3125, 'tile-1']])
  })

  it('enforces eight overlapping voices across distinct frames and leaves room for the next chime', () => {
    const events = Array.from({ length: 50 }, (_, index) => fold(0.30 + index * 0.0002, 'down'))
    events.push(fold(0.311), fold(0.4))
    const voices = events.flatMap(createScheduler())

    expect(chimes(voices).map(({ t }) => t)).toEqual([0.3125, 0.625])
    for (const { t } of voices) {
      expect(voices.filter((voice) => voice.t <= t && t < voice.end).length).toBeLessThanOrEqual(8)
    }
    expect(voices.filter(({ t, end }) => t <= 0.3125 && end > 0.3125)).toHaveLength(8)
    expect(pops(voices).at(-1).t).toBe(0.4)
  })
})
