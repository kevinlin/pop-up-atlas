import { MathUtils } from 'three'
import { afterEach, describe, expect, test } from 'vitest'
import { createCueTracker } from '../src/character/cue-tracker.js'
import { createFace, MOUTH_CELLS, mouthCell } from '../src/character/face.js'
import { buildModel, dt, LID_OPEN } from './fixtures/rig.js'

const cleanup = []
afterEach(() => cleanup.splice(0).forEach((fn) => fn()))

function setup(who, model) {
  const bus = new EventTarget()
  const root = buildModel(who, model)
  const tracker = createCueTracker(bus, who)
  cleanup.push(tracker.dispose)
  const face = createFace(root, { who, tracker })
  const mouth = root.getObjectByName('mouth')
  return {
    bus, root, face, mouth, offset: mouth.material.map.offset,
    cue: (detail) => bus.dispatchEvent(new CustomEvent('cue', { detail })),
    cut: (detail) => bus.dispatchEvent(new CustomEvent('cue-end', { detail })),
  }
}
const cellOf = (name) => MOUTH_CELLS.indexOf(name)

describe('mouth atlas', () => {
  test('rest shape is a smile for A and flat for B, picked by texture offset (4 x 2, row-major from the top left)', () => {
    const a = setup('a')
    a.face.update(dt, 0, true)
    expect(a.face.state.cell).toBe(cellOf('smile'))
    expect(a.offset.toArray()).toEqual([0, 0])
    expect(a.mouth.material.map.repeat.toArray()).toEqual([0.25, 0.5])

    const b = setup('b')
    b.face.update(dt, 0, true)
    expect(b.face.state.cell).toBe(cellOf('flat'))
    expect(b.offset.x).toBeCloseTo(0.75)
    expect(b.offset.y).toBe(0)

    b.cue({ who: 'b', cue: 'b_voice_hmph', t: 1, end: 2 })
    b.face.update(dt, 1.5, true)
    expect(b.face.state.cell).toBe(cellOf('frown'))
    expect(b.offset.toArray()).toEqual([0, 0.5])
  })

  test('a mesh whose UVs already cover one cell only gets the offset', () => {
    const { face, mouth } = setup('a', { mouthUv: 'cell' })
    face.update(dt, 0, true)
    expect(mouth.material.map.repeat.toArray()).toEqual([1, 1])
  })

  test('a flipped texture counts rows from the bottom', () => {
    const { face, mouth, cue } = setup('a')
    mouth.material.map.flipY = true
    cue({ who: 'a', cue: 'voice_hmph', t: 0, end: 1 })
    face.update(dt, 0.5, true)
    expect(mouth.material.map.offset.y).toBeCloseTo(0.5 - 0.5)
    expect(mouth.material.map.offset.x).toBe(0)
  })

  test.each([
    ['voice_ooh', 'o'], ['voice_eep', 'o'], ['voice_hmph', 'frown'], ['voice_hm', 'flat'],
    ['voice_hup', 'ee'], ['voice_whee', 'open_smile'], ['voice_lead', 'open_smile'],
    ['sing_ta', 'sing'], ['sing_da', 'sing'], ['sing_hum', 'sing'],
  ])('%s shows %s in both banks', (name, shape) => {
    for (const who of ['a', 'b']) {
      const { face, cue } = setup(who)
      const played = who === 'b' ? `b_${name}` : name
      cue({ who, cue: played, t: 1, end: 1.8 })
      face.update(dt, 0.5, true)
      expect(face.state.cell).toBe(cellOf(who === 'a' ? 'smile' : 'flat'))
      face.update(dt, 1.4, true)
      expect(face.state.cell).toBe(cellOf(shape))
    }
  })

  test('giggle alternates open smile and grin at 8 Hz', () => {
    const { face, cue } = setup('a')
    cue({ who: 'a', cue: 'voice_giggle', t: 1, end: 2 })
    const seen = []
    for (let step = 0; step < 16; step += 1) {
      face.update(dt, 1 + 0.01 + step / 16, true)
      seen.push(face.state.cell)
    }
    expect(seen).toEqual(Array.from({ length: 16 }, (_, step) => cellOf(step % 2 === 0 ? 'open_smile' : 'grin')))
    expect(mouthCell('b_voice_giggle', 0)).toBe(cellOf('open_smile'))
  })

  test('holds to the effective end after a cut and returns to rest 0.1 s later', () => {
    for (const who of ['a', 'b']) {
      const { face, cue, cut } = setup(who)
      const name = who === 'a' ? 'voice_ooh' : 'b_voice_ooh'
      cue({ who, cue: name, t: 1, end: 2 })
      cut({ who, cue: name, end: 1.3 })
      face.update(dt, 1.29, true)
      expect(face.state.cell).toBe(cellOf('o'))
      face.update(dt, 1.39, true)
      expect(face.state.cell).toBe(cellOf('o'))
      face.update(dt, 1.41, true)
      expect(face.state.cell).toBe(cellOf(who === 'a' ? 'smile' : 'flat'))
    }
  })

  test('without a cut the shape lasts to the end plus 0.1 s', () => {
    const { face, cue } = setup('a')
    cue({ who: 'a', cue: 'voice_hup', t: 1, end: 2 })
    face.update(dt, 2.09, true)
    expect(face.state.cell).toBe(cellOf('ee'))
    face.update(dt, 2.11, true)
    expect(face.state.cell).toBe(cellOf('smile'))
  })

  test('a newer cue takes over, and cues of the other character, sounds without a mouth and the follower do nothing', () => {
    const { face, cue } = setup('a')
    cue({ who: 'a', cue: 'voice_hm', t: 1, end: 3 })
    cue({ who: 'a', cue: 'voice_whee', t: 2, end: 2.5 })
    face.update(dt, 2.2, true)
    expect(face.state.cell).toBe(cellOf('open_smile'))
    cue({ who: 'b', cue: 'b_voice_eep', t: 2.6, end: 3 })
    cue({ who: 'a', cue: 'sfx_clap', t: 2.7, end: 2.9 })
    face.update(dt, 2.8, true)
    expect(face.state.cell).toBe(cellOf('flat'))
    face.update(dt, 2.8, false)
    expect(face.state.cell).toBe(cellOf('smile'))
  })
})

describe('blinks', () => {
  function blinkStarts(who, seconds) {
    const { face, root } = setup(who)
    const lid = root.getObjectByName('lid_l')
    const starts = []
    const lids = []
    let closed = false
    for (let t = 0; t < seconds; t += 1 / 60) {
      face.update(1 / 60, t, true)
      lids.push(face.state.lid)
      if (face.state.lid > 0.7 && !closed) starts.push(t)
      closed = face.state.lid > 0.7
      expect(lid.scale.y).toBeCloseTo(MathUtils.lerp(LID_OPEN, 1, face.state.lid))
    }
    return { starts, lids, root }
  }

  test.each(['a', 'b'])('%s blinks every 2.5-5.5 s, one in five doubled, over 600 s', (who) => {
    const { starts } = blinkStarts(who, 600)
    // Merge a doubled blink (two closings 0.25 s apart) into one group.
    const groups = []
    let doubled = 0
    for (const start of starts) {
      if (groups.length && start - groups.at(-1) < 0.5) doubled += 1
      else groups.push(start)
    }
    const intervals = groups.slice(1).map((start, index) => start - groups[index])
    expect(groups.length).toBeGreaterThan(120)
    expect(Math.min(...intervals)).toBeGreaterThanOrEqual(2.5 - 1 / 30)
    expect(Math.max(...intervals)).toBeLessThanOrEqual(5.5 + 1 / 30)
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    expect(mean).toBeGreaterThan(3.7)
    expect(mean).toBeLessThan(4.3)
    expect(doubled / groups.length).toBeGreaterThan(0.1)
    expect(doubled / groups.length).toBeLessThan(0.32)
  })

  test('each blink lasts 0.15 s, A rests open (0) and B rests half shut (0.35)', () => {
    for (const [who, rest] of [['a', 0], ['b', 0.35]]) {
      const { lids } = blinkStarts(who, 20)
      expect(Math.min(...lids)).toBeCloseTo(rest)
      expect(Math.max(...lids)).toBeCloseTo(1, 1)
      const first = lids.findIndex((value) => value > rest + 0.01)
      let last = first
      while (lids[last + 1] > rest + 0.01) last += 1
      expect((last - first + 1) / 60).toBeGreaterThan(0.12)
      expect((last - first + 1) / 60).toBeLessThan(0.18)
    }
  })

  test('the two characters blink on different schedules', () => {
    expect(blinkStarts('a', 30).starts).not.toEqual(blinkStarts('b', 30).starts)
  })

  test('the lids go from the authored open scale (extras.lidOpen) to 1', () => {
    const { face, root } = setup('a')
    face.update(dt, 0, true)
    expect(root.getObjectByName('lid_r').scale.y).toBeCloseTo(LID_OPEN)
    expect(root.getObjectByName('lid_l').scale.y).toBeCloseTo(LID_OPEN)
  })

  test('the follower shows the rest shape and blinks', () => {
    const { face, cue } = setup('b')
    cue({ who: 'b', cue: 'b_voice_ooh', t: 0, end: 100 })
    let blinked = false
    for (let t = 0; t < 12; t += 1 / 60) {
      face.update(1 / 60, t, false)
      expect(face.state.cell).toBe(cellOf('flat'))
      blinked ||= face.state.lid > 0.9
    }
    expect(blinked).toBe(true)
  })
})

describe('no-op without face nodes', () => {
  test('missing lids and mouth are skipped and the logical state is still reported', () => {
    const bus = new EventTarget()
    const tracker = createCueTracker(bus, 'b')
    cleanup.push(tracker.dispose)
    const face = createFace(buildModel('b', { face: false }), { who: 'b', tracker })
    bus.dispatchEvent(new CustomEvent('cue', { detail: { who: 'b', cue: 'b_voice_ooh', t: 0, end: 5 } }))
    expect(() => {
      for (let t = 0; t < 10; t += 0.05) face.update(0.05, t, true)
    }).not.toThrow()
    expect(face.state.cell).toBe(cellOf('flat'))
  })

  test('a mouth mesh without an atlas map is left alone', () => {
    const model = buildModel('a')
    model.getObjectByName('mouth').material.map = null
    const face = createFace(model, { who: 'a' })
    expect(() => face.update(dt, 0, true)).not.toThrow()
    expect(face.state.cell).toBe(0)
  })
})
