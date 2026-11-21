import { describe, expect, it } from 'vitest'
import { createScheduler } from '../src/audio/music.js'

const eighth = 0.3125
const origin = 0.125
const phrase = [74, 71, 76, 78, 74, 71, 69, 74]
const fold = (t, dir = 'up', id = 'flower') => ({ dir, id, i: 2, j: -1, t })
const grid = (slot) => origin + slot * eighth
const inSlot = (slot) => fold(slot === 0 ? origin : grid(slot) - 0.01)
const chimes = (voices) => voices.filter(({ kind }) => kind === 'chime')
const pops = (voices) => voices.filter(({ kind }) => kind === 'pop')

describe('fold music', () => {
  it('plays the eight-note question and answer with accents, short passing notes, and a ringing final D', () => {
    const events = Array.from({ length: 8 }, (_, index) => inSlot(index))
    const notes = chimes(events.flatMap(createScheduler()))

    expect(notes.map(({ midi }) => midi)).toEqual(phrase)
    expect(notes.map(({ gain }) => gain)).toEqual([10 ** 0.1, 1, 1, 1, 10 ** 0.1, 1, 1, 1])
    expect(notes.filter(({ passing }) => passing).map(({ midi }) => midi)).toEqual([71, 76, 78, 71, 69])
    expect(notes.filter(({ final }) => final)).toEqual([notes[7]])
    for (const index of [1, 2, 3, 5, 6]) {
      expect(notes[index].end - notes[index].t).toBeCloseTo(0.2)
    }
    expect(notes[7].end - notes[7].t).toBeGreaterThanOrEqual(1)
  })

  it('stays in D major pentatonic with at most one changed interior note per repeat', () => {
    const repeats = 1250
    const events = Array.from({ length: repeats * 9 - 1 }, (_, index) => inSlot(index))
    const pitches = chimes(events.flatMap(createScheduler())).map(({ midi }) => midi)
    const scale = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]
    expect(pitches).toHaveLength(repeats * 8)
    expect(pitches.every((midi) => scale.includes(midi))).toBe(true)
    let varied = false
    for (let offset = 8; offset < pitches.length; offset += 8) {
      const changed = phrase.flatMap((midi, index) => midi === pitches[offset + index] ? [] : [index])
      if (changed.length) varied = true
      expect(changed.length <= 1 && changed.every((index) => index > 0 && index < 7)).toBe(true)
    }
    expect(varied).toBe(true)
  })

  it('restarts after six empty slots but continues after five, even if there are fold-downs', () => {
    const restart = inSlot(13)
    const events = [inSlot(0), inSlot(6), fold(grid(7), 'down'), restart, fold(restart.t + 0.1)]
    const notes = chimes(events.flatMap(createScheduler()))

    expect(notes.map(({ t, midi }) => [t, midi])).toEqual([
      [origin, 74], [grid(6), 71], [restart.t, 74], [restart.t + eighth, 71],
    ])
  })

  it('starts the grid at the first up fold and plays that chime with its pop', () => {
    const t = 0.17
    const events = [fold(0.15, 'down'), fold(t), fold(t), fold(t + 0.1), fold(t + eighth)]
    const voices = events.flatMap(createScheduler())

    expect(chimes(voices).map(({ t, midi }) => [t, midi])).toEqual([[t, 74], [t + eighth, 71], [t + 2 * eighth, 76]])
    expect(pops(voices).map(({ t }) => t)).toEqual([0.15, t, t + 0.1, t + eighth])
  })

  it('quantizes up chimes to the next slot and advances only once per occupied slot', () => {
    const events = [0, 0, 0.1, 0.312499, 0.3125, 0.55, 0.8, 0.93]
      .map((time) => fold(time, time === 0.8 ? 'down' : 'up'))
    const voices = events.flatMap(createScheduler())

    expect(chimes(voices).map(({ t, midi }) => [t, midi])).toEqual([[0, 74], [0.3125, 71], [0.625, 76], [0.9375, 78]])
    expect(pops(voices).map(({ t, dir }) => [t, dir])).toEqual([
      [0, 'up'], [0.1, 'up'], [0.312499, 'up'], [0.3125, 'up'],
      [0.55, 'up'], [0.8, 'down'], [0.93, 'up'],
    ])
    expect(chimes([fold(0, 'down')].flatMap(createScheduler()))).toHaveLength(0)
  })

  it('leaves one empty slot after the final D and queues only one note from folds during that hold', () => {
    const questionAndAnswer = Array.from({ length: 8 }, (_, index) => inSlot(index))
    const sameFinalSlot = fold(grid(7) - 0.005)
    const held = fold(grid(7) + 0.005, 'up', 'held')
    const merged = [inSlot(8), inSlot(9)]
    const notesWithoutMoreFolds = chimes([...questionAndAnswer, sameFinalSlot].flatMap(createScheduler()))
    expect(notesWithoutMoreFolds.map(({ midi }) => midi)).toEqual(phrase)
    const heldAlone = chimes([...questionAndAnswer, held].flatMap(createScheduler())).at(-1)
    expect(heldAlone).toMatchObject({ t: grid(9), midi: 74, id: 'held' })

    const following = [sameFinalSlot, held, ...merged, inSlot(10)]
    const voices = [...questionAndAnswer, ...following].flatMap(createScheduler())
    expect(chimes(voices).slice(-3).map(({ t, midi, id }) => [t, midi, id])).toEqual([
      [grid(7), 74, 'flower'], [grid(9), 74, 'held'], [grid(10), 71, 'flower'],
    ])
    expect(pops(voices).slice(-5).map(({ t }) => t)).toEqual(following.map(({ t }) => t))
  })

  it('groups 50 same-frame folds by direction and caps the boost at 3 dB', () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ ...fold(0.305, i % 2 ? 'up' : 'down', `tile-${i}`), i }))
    events.push(fold(0.31), fold(0.32, 'down'), fold(0.32, 'down'))
    const voices = events.flatMap(createScheduler())

    expect(pops(voices).map(({ t, dir, id, gain }) => [t, dir, id, gain])).toEqual([
      [0.305, 'down', 'tile-0', 10 ** 0.15], [0.305, 'up', 'tile-1', 10 ** 0.15 / Math.sqrt(2)],
      [0.31, 'up', 'flower', 1 / Math.sqrt(3)], [0.32, 'down', 'flower', 10 ** 0.05 / Math.sqrt(4)],
    ])
    expect(chimes(voices).map(({ t, id }) => [t, id])).toEqual([[0.305, 'tile-1'], [0.305 + eighth, 'flower']])
  })

  it('enforces eight overlapping voices across distinct frames and leaves room for the next chime', () => {
    const restart = 0.311 + 7 * eighth
    const events = Array.from({ length: 50 }, (_, index) => fold(0.30 + index * 0.0002, 'down'))
    events.push(fold(0.311), fold(0.4), ...events.map(({ t }) => fold(t + 7 * eighth, 'down')), fold(restart))
    const voices = events.flatMap(createScheduler())

    expect(chimes(voices).map(({ t }) => t)).toEqual([0.311, 0.311 + eighth, restart])
    for (const { t } of voices) {
      expect(voices.filter((voice) => voice.t <= t && t < voice.end).length).toBeLessThanOrEqual(8)
    }
    expect(voices.filter(({ t, end }) => t <= 0.311 && end > 0.311)).toHaveLength(8)
    expect(voices.filter(({ t, end }) => t <= restart && end > restart)).toHaveLength(8)
    expect(pops(voices).some(({ t }) => t === 0.4)).toBe(true)
  })
})
