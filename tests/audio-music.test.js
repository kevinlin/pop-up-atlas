import { describe, expect, it } from 'vitest'
import { createScheduler, harmonyMidi } from '../src/audio/music.js'
import { TILES } from '../src/world/tiles.js'

const eighth = 0.3125
const origin = 0.125
const phrase = [74, 71, 76, 78, 74, 71, 69, 74]
const fold = (t, dir = 'up', id = 'flower') => ({ dir, id, i: 2, j: -1, t })
const grid = (slot) => origin + slot * eighth
const inSlot = (slot) => fold(slot === 0 ? origin : grid(slot) - 0.01)
const chimes = (voices) => voices.filter(({ kind }) => kind === 'chime')
const pops = (voices) => voices.filter(({ kind }) => kind === 'pop')
const [flower, mushroom, cupcake, river] = ['flower', 'mushroom_house', 'cupcake_tree', 'river_straight']
  .map((id) => TILES.find((tile) => tile.id === id).id)

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

  it.each([[5.9, 71], [6, 74], [6.1, 74]])('uses the last up fold for a %s s phrase gap', (gap, midi) => {
    const next = origin + gap
    const events = [inSlot(0), fold(next - 0.2, 'down'), fold(next)]
    expect(chimes(events.flatMap(createScheduler())).map(({ t, midi }) => [t, midi])).toEqual([
      [origin, 74], [next, midi],
    ])
  })

  it('re-anchors after a 3 s gap and quantizes the following fold to the new grid', () => {
    const next = origin + 3
    const events = [inSlot(0), fold(next), fold(next + 0.1)]
    expect(chimes(events.flatMap(createScheduler())).map(({ t, midi }) => [t, midi])).toEqual([
      [origin, 74], [next, 71], [next + eighth, 76],
    ])
  })

  it('keeps the old grid at six eighths since the last up fold', () => {
    const events = [inSlot(0), fold(grid(6))]
    expect(chimes(events.flatMap(createScheduler())).map(({ t, midi }) => [t, midi])).toEqual([
      [origin, 74], [grid(7), 71],
    ])
  })

  it('counts a fold merged into an occupied slot toward the phrase hold', () => {
    const events = [inSlot(0), fold(0.2), fold(0.3), fold(6.25)]
    expect(chimes(events.flatMap(createScheduler())).map(({ midi }) => midi)).toEqual([74, 71, 76])
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
    expect(chimes(voices).filter(({ harmony }) => !harmony).map(({ t, id }) => [t, id]))
      .toEqual([[0.305, 'tile-1'], [0.305 + eighth, 'flower']])
    expect(chimes(voices).filter(({ harmony }) => harmony).map(({ t, id }) => [t, id])).toEqual([[0.305, 'tile-3']])
  })

  it('needs two distinct up tile ids in a frame with a melody note', () => {
    const events = [
      fold(0, 'up', flower), { ...fold(0, 'up', flower), i: 3 }, fold(0, 'down', mushroom),
      fold(0.1, 'up', flower), fold(0.2, 'up', mushroom), fold(0.2, 'up', cupcake),
    ]
    const notes = chimes(events.flatMap(createScheduler()))
    expect(notes.map(({ t, id, midi }) => [t, id, midi])).toEqual([[0, flower, 74], [eighth, flower, 71]])
    expect(notes.some(({ harmony }) => harmony)).toBe(false)
  })

  it('adds at most one harmony per melody note using the second distinct up tile', () => {
    const events = [
      fold(0, 'up', flower), fold(0.1, 'up', flower), fold(0.1, 'up', flower),
      fold(0.1, 'down', river), { ...fold(0.1, 'up', mushroom), i: 3, j: 4 }, fold(0.1, 'up', cupcake),
    ]
    const notes = chimes(events.flatMap(createScheduler()))
    expect(notes).toHaveLength(3)
    const [, melody, harmony] = notes
    expect(melody).toMatchObject({ id: flower, midi: 71, t: eighth })
    expect(harmony).toMatchObject({ kind: 'chime', harmony: true, id: mushroom, i: 3, j: 4, midi: 66,
      t: melody.t, end: melody.end, gain: melody.gain * 10 ** (-6 / 20) })
  })

  it('uses the upper harmony interval when two degrees below would leave D4-D6', () => {
    expect([62, 64, 66, 86].map(harmonyMidi)).toEqual([66, 69, 62, 81])
  })

  it('drops harmony before the melody or either pop at the voice cap', () => {
    const t = 0.311
    const events = [
      ...Array.from({ length: 5 }, (_, index) => fold(0.30 + index * 0.001, 'down', river)),
      fold(t, 'up', flower), fold(t, 'up', mushroom), fold(t, 'down', cupcake),
    ]
    const voices = events.flatMap(createScheduler())
    expect(chimes(voices).map(({ id, midi }) => [id, midi])).toEqual([[flower, 74]])
    expect(pops(voices).filter((voice) => voice.t === t).map(({ dir }) => dir)).toEqual(['up', 'down'])
    expect(voices.filter((voice) => voice.t <= t && t < voice.end)).toHaveLength(8)
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
