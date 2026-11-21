import { describe, expect, it, vi } from 'vitest'
import { createCueDirector } from '../src/audio/cues.js'
import { createSamplePlayback } from '../src/audio/samples.js'
import { hash } from '../src/world/hash.js'
import { createLayout } from '../src/world/layout.js'
import { fixtureManifest } from './fixtures/audio/manifest.js'

const boundary = 0.0001
const quiet = 10 ** (-6 / 20)
const selectedSeed = (predicate) => Array.from({ length: 1000 }, (_, seed) => seed).find(predicate)
const hupSeed = selectedSeed((seed) => [0, 1].every((n) => hash(seed, n, 0, 33) % 3 === 0))
const hmSeed = selectedSeed((seed) => [0, 1].every((n) => hash(seed, n, 0, 34) % 4 === 0))

function setup(seed = 0, configure = () => {}) {
  const { cues } = fixtureManifest()
  configure(cues)
  const plays = []
  const cuts = []
  const director = createCueDirector(cues, (play) => plays.push(play), (play) => cuts.push({ ...play }))
  director.setSeed(seed)
  return { cues, plays, cuts, director, named: (cue) => plays.filter((play) => play.cue === cue) }
}

function fold(director, t, id = 'flower', { dir = 'up', i = 0, j = 0, pop = true, x = 0, z = 0 } = {}) {
  director.fold({ t, dir, id, i, j }, pop, x, z)
}

const times = (plays) => plays.map(({ t }) => t)
const pitch = ({ file, rate, cue }, cues) =>
  cues[cue].files.find(({ src }) => src === file).baseMidi + 12 * Math.log2(rate)

describe('fold layers and footsteps', () => {
  it('maps every fold-up tile, and layers only over a played pop, once per frame and direction', () => {
    const { director, plays, cues } = setup()
    const mapping = ['flower', 'mushroom_house', 'cupcake_tree', 'yarn_bridge',
      'river_straight', 'river_corner', 'path_straight', 'path_corner', 'meadow']
    for (const [t, id] of mapping.entries()) {
      fold(director, t, 'meadow', { pop: false })
      fold(director, t, id, { x: 10 })
      fold(director, t, id, { x: 10 })
      fold(director, t, id, { dir: 'down', x: -10 })
      fold(director, t, id, { dir: 'down', x: -10 })
    }
    fold(director, 11, 'flower', { x: 1 })
    fold(director, 12, 'meadow', { dir: 'down', pop: false })
    const layers = plays.filter(({ cause }) => cause === 'fold')
    expect(layers.map(({ cue }) => cue)).toEqual(mapping.flatMap((id) => [
      `fold_${id.replace(/^(river|path)_.+/, '$1')}`, 'fold_down',
    ]).concat('fold_flower'))
    for (const play of layers.slice(0, -1)) {
      const down = play.cue === 'fold_down'
      expect(play.pan).toBe(down ? 0.6 : -0.6)
      expect(play.gain).toBeCloseTo(cues[play.cue].gain * (down ? quiet : 1), 10)
    }
    expect(layers.at(-1)).toMatchObject({ t: 11, pan: -0.25, gain: cues.fold_flower.gain })
    expect(times(layers.filter(({ cue }) => cue === 'fold_down'))).toEqual(mapping.map((_, i) => i))
  })

  it('alternates pan across surfaces, rotates takes and starts each bridge at D5', () => {
    const { director, plays, named, cues } = setup()
    const ground = ['meadow', 'flower', 'mushroom_house', 'cupcake_tree', 'path_straight', 'path_corner']
    ground.forEach((tile, i) => director.step(i / 2, tile))
    director.step(2.5, 'path_corner') // Duplicate contact at the same instant.
    director.surface(3, 'yarn_bridge')
    for (let i = 0; i < 7; i++) director.step(3 + i / 2, 'yarn_bridge')
    director.surface(7, 'path_corner')
    director.surface(7.5, 'yarn_bridge')
    director.step(7.5, 'yarn_bridge')
    const steps = plays.filter(({ kind, file }) => kind === 'step' && file !== null)
    expect(steps.slice(0, ground.length).map(({ cue }) => cue)).toEqual([
      'step_felt', 'step_felt', 'step_felt', 'step_felt', 'step_paper', 'step_paper',
    ])
    expect(steps.map(({ pan }) => pan)).toEqual(steps.map((_, i) => i % 2 ? 0.15 : -0.15))
    for (const name of ['step_felt', 'step_paper']) {
      const files = named(name).map(({ file }) => file)
      files.slice(1).forEach((file, i) => expect(file).not.toBe(files[i]))
    }
    const plucks = named('step_pluck')
    expect(plucks.map(({ midi }) => midi)).toEqual([74, 76, 78, 81, 83, 86, 86, 74])
    plucks.forEach((pluck, i) => {
      const felt = steps[ground.length + i]
      expect(felt).toMatchObject({ t: pluck.t, pan: pluck.pan, cue: 'step_felt' })
      expect(felt.gain).toBeCloseTo(cues.step_felt.gain * quiet, 10)
      expect(pluck).toMatchObject({ cause: 'step', file: null, gain: cues.step_felt.gain, rate: 1 })
    })
  })
})

describe('walking and reaction limits', () => {
  it.each([[-boundary, false], [0, true], [boundary, true]])('uses the walking thresholds at offset %s', (delta, plays) => {
    const { director, named } = setup(hupSeed)
    director.walk(0.5 + delta, true)
    director.walk(1.5 + 2 * delta, false)
    expect(named('sfx_hair_swish')).toHaveLength(Number(plays))
    expect(named('sfx_hair_settle')).toHaveLength(Number(plays))
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('limits hair starts at 1.5 s plus %s', (delta, plays) => {
    const { director, named } = setup()
    director.walk(0.5, true)
    director.walk(1, false)
    director.walk(2 + delta, true)
    expect(named('sfx_hair_swish')).toHaveLength(1 + Number(plays))
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('requires 2 seconds standing for hup at offset %s', (delta, plays) => {
    const { director, named } = setup(hupSeed)
    director.walk(2 + delta, true)
    expect(named('voice_hup')).toHaveLength(Number(plays))
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('limits hup at 8 s plus %s and hm at 10 s plus %s', (delta, plays) => {
    const start = setup(hupSeed)
    start.director.walk(2, true)
    start.director.walk(2.5, false)
    start.director.walk(10 + delta, true)
    expect(start.named('voice_hup')).toHaveLength(1 + Number(plays))

    const stop = setup(hmSeed)
    stop.director.walk(0, true)
    stop.director.walk(1, false)
    stop.director.walk(2, true)
    stop.director.walk(11 + delta, false)
    expect(stop.named('voice_hm')).toHaveLength(1 + Number(plays))
  })

  it('selects hup and hm only on favorable hashes', () => {
    for (let seed = 0; seed < 20; seed++) {
      const start = setup(seed)
      start.director.walk(2, true)
      expect(start.named('voice_hup')).toHaveLength(Number(hash(seed, 0, 0, 33) % 3 === 0))
      const stop = setup(seed)
      stop.director.walk(0, true)
      stop.director.walk(1, false)
      expect(stop.named('voice_hm')).toHaveLength(Number(hash(seed, 0, 0, 34) % 4 === 0))
    }
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('limits bumps at 3 s plus %s', (delta, plays) => {
    const { director, named } = setup()
    director.bump(1, 'prop')
    director.bump(4 + delta, 'river')
    director.bump(8, 'edge')
    expect(times(named('sfx_bump'))).toEqual([1, 8])
    expect(times(named('voice_hmph'))).toEqual([1, 8])
    expect(named('sfx_plip')).toHaveLength(Number(plays))
    expect(named('voice_eep')).toHaveLength(Number(plays))
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('limits different reaction lines at 2.5 s plus %s', (delta, plays) => {
    const { director, named } = setup()
    director.bump(1, 'prop')
    fold(director, 3.5 + delta, 'yarn_bridge', { pop: false })
    director.idle(5)
    expect(named('voice_ooh')).toHaveLength(Number(plays))
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('drops a reaction while a voice is active at end plus %s', (delta, plays) => {
    const { director, named, cuts } = setup(0, (cues) => {
      for (const file of cues.voice_hmph.files) file.duration = 4
    })
    director.bump(1, 'edge')
    fold(director, 5 + delta, 'yarn_bridge')
    director.idle(9)
    expect(named('voice_ooh')).toHaveLength(Number(plays))
    expect(cuts).toEqual([])
    if (!plays) {
      fold(director, 10, 'cupcake_tree')
      expect(times(named('voice_ooh'))).toEqual([10])
    }
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('limits hero ooh at 10 s plus %s and bridge whee at 15 s plus %s', (delta, plays) => {
    const hero = setup()
    fold(hero.director, 1, 'mushroom_house', { x: 2.5, pop: false })
    fold(hero.director, 11 + delta, 'cupcake_tree')
    expect(hero.named('voice_ooh')).toHaveLength(1 + Number(plays))
    const bridge = setup()
    bridge.director.surface(0, 'yarn_bridge')
    bridge.director.surface(1, 'meadow')
    bridge.director.surface(2, 'meadow')
    bridge.director.surface(3, 'yarn_bridge')
    bridge.director.surface(16 + delta, 'meadow')
    expect(bridge.named('voice_whee')).toHaveLength(1 + Number(plays))
  })

  it('reacts only to up-folds of the three hero tile types within range', () => {
    const { director, named } = setup()
    fold(director, 2, 'mushroom_house', { x: 2.5001 })
    fold(director, 3, 'mushroom_house', { dir: 'down' })
    fold(director, 4, 'flower')
    fold(director, 5, 'yarn_bridge', { x: 1.5, z: 2 })
    fold(director, 15, 'cupcake_tree')
    expect(times(named('voice_ooh'))).toEqual([5, 15])
  })

  it('reports the existing layout geometry as prop, river or page edge', () => {
    const layout = createLayout(112)
    expect(layout.blockedBy(0, 0)).toBeNull()
    expect(layout.blockedBy(0, 9.001)).toBe('edge')
    const reasons = new Set()
    for (let i = 1; i < 24; i++) {
      for (let j = -5; j <= 4; j++) {
        const tile = layout.getCell(i, j)
        const reason = layout.blockedBy(i * 2 + (tile.offsetX ?? 0), j * 2 + (tile.offsetZ ?? 0))
        if (tile.blockedRadius) {
          expect(reason).toBe('prop')
          reasons.add(reason)
        }
        if (tile.id === 'river_straight') {
          expect(reason).toBe('river')
          reasons.add(reason)
        }
      }
    }
    expect(reasons).toEqual(new Set(['prop', 'river']))
  })
})

describe('chorus, hum and dance', () => {
  const seededCells = Array.from({ length: 40 }, (_, i) => i + 5)
  const selected = seededCells.find((i) => hash(0, i, 0, 32) % 3 === 0)
  const rejected = seededCells.find((i) => hash(0, i, 0, 32) % 3 !== 0)

  it.each([[-boundary, false], [0, true], [boundary, true]])('uses cell hash and the 8-second chorus cooldown at offset %s', (delta, plays) => {
    const { director, named } = setup()
    fold(director, 1, 'mushroom_house', { i: rejected })
    fold(director, 2, 'mushroom_house', { i: selected, dir: 'down' })
    fold(director, 3, 'mushroom_house', { i: selected })
    fold(director, 11 + delta, 'mushroom_house', { i: selected })
    expect(times(named('chorus_ooh'))).toEqual(plays ? [3, 11 + delta] : [3])
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('allows one chorus at a time at the prior chorus end plus %s', (delta, plays) => {
    const { director, named } = setup(0, (cues) => {
      for (const file of cues.chorus_ooh.files) file.duration = 10
    })
    fold(director, 1, 'mushroom_house', { i: selected })
    director.dance(8.35 + delta, 0)
    director.dance(11 + delta, 2.65)
    director.dance(12, 3)
    expect(named('chorus_yay')).toHaveLength(Number(plays))
  })

  it.each([[-boundary, false], [0, true], [boundary, true]])('hums only if a note was heard within 10 seconds, with offset %s', (delta, plays) => {
    const { director, named } = setup()
    director.walk(0, true)
    director.note(1.5 + delta, 69)
    director.walk(10, false)
    director.idle(11.5 - boundary)
    expect(named('sing_hum')).toHaveLength(0)
    director.idle(11.5)
    expect(named('sing_hum')).toHaveLength(Number(plays))
  })

  it('hums the last three sounded melody notes at eighths and honors the 20 ms cuts', () => {
    const { director, named, cuts, cues } = setup()
    director.walk(0, true)
    const melody = [69, 74, 76, 81, 71]
    melody.forEach((midi, i) => director.note(i + 1, midi))
    director.walk(2.75, false)
    director.idle(5.1)
    const hum = named('sing_hum')
    expect(times(hum)).toEqual([4.25, 4.5625, 4.875])
    expect(hum.map((play) => pitch(play, cues))).toEqual([74, 76, 81])
    expect(times(cuts)).toEqual([4.25, 4.5625])
    expect(hum[0].end).toBe(hum[1].t)
    expect(hum[1].end).toBe(hum[2].t)
  })

  it('fades a hum tail that would overlap the next note by just 2.5 ms', () => {
    const { director, named, cuts } = setup(0, (cues) => {
      for (const file of cues.sing_hum.files) file.duration = 0.315
    })
    director.note(0.25, 69)
    director.note(0.5, 69)
    director.idle(1.5)
    director.idle(1.8125)

    const [previous, next] = named('sing_hum')
    expect(previous.end).toBe(next.t)
    expect(cuts).toEqual([previous])
  })

  it('ramps a replaced voice to zero during the 20 ms before the next voice on the audio clock', () => {
    const { cues } = fixtureManifest()
    const files = cues.sing_hum.files
    const buffers = new Map(files.map(({ src, duration }) => [src, { buffer: {}, duration }]))
    const gain = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }
    const source = { playbackRate: {}, start: vi.fn(), stop: vi.fn() }
    const connect = (node) => node
    const playback = createSamplePlayback({
      createGain: () => ({ gain, connect }),
      createStereoPanner: () => ({ pan: {}, connect }),
      createBufferSource: () => ({ ...source, connect }),
    }, {}, buffers)
    const offset = 3
    const director = createCueDirector(cues,
      (play) => playback.play(play, offset), (play) => playback.cut(play, offset))
    director.note(0.25, 69)
    director.note(0.5, 69)
    director.idle(1.5)
    director.idle(1.8125)

    const handoff = offset + 1.8125
    expect(gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(cues.sing_hum.gain, handoff - 0.02)
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(0, handoff)
    expect(source.stop).toHaveBeenNthCalledWith(2, handoff)
    expect(source.start).toHaveBeenNthCalledWith(2, handoff, 0)
  })

  it('cuts the current hum on movement, cancels pending notes, and can hum again', () => {
    const { director, named, cuts } = setup()
    director.note(0.25, 69)
    director.note(0.5, 74)
    director.note(0.75, 76)
    director.idle(1.5)
    director.idle(1.8125)
    director.walk(1.9, true)
    director.idle(2)
    expect(times(named('sing_hum'))).toEqual([1.5, 1.8125])
    expect(cuts.at(-1).end).toBeCloseTo(1.92, 10)
    director.walk(3, false)
    director.idle(5.2)
    expect(times(named('sing_hum'))).toEqual([1.5, 1.8125, 4.5, 4.8125, 5.125])
  })

  it('ignores scheduled but unheard notes and stops hum when movement resumes', () => {
    const { director, named, cuts } = setup()
    director.note(1.51, 69)
    director.idle(1.51)
    expect(named('sing_hum')).toHaveLength(0)
    director.walk(2, true)
    director.note(3, 74)
    director.walk(4, false)
    director.idle(5.5)
    director.walk(5.6, true)
    director.idle(7)
    expect(times(named('sing_hum'))).toEqual([5.5])
    expect(cuts[0].end).toBeCloseTo(5.62, 10)
  })

  it('plays a complete dance at the clip markers, ignores reaction gaps, and retunes both syllables', () => {
    const { director, plays, cuts, cues, named } = setup()
    director.bump(0.9, 'prop')
    director.dance(1, 0)
    director.dance(1.46, 0.46)
    fold(director, 1.6, 'cupcake_tree')
    director.dance(2, 1)
    director.dance(3.75, 2.75)
    director.dance(4, undefined, false)
    const dance = plays.filter(({ cause }) => cause === 'dance')
    expect(dance.map(({ cue }) => cue)).toEqual([
      'sfx_clap', 'sfx_clap', 'voice_giggle', 'sfx_spin', 'voice_whee', 'sing_ta', 'sing_da', 'chorus_yay',
    ])
    const markers = [0, 0.3125, 0.45, 0.92, 0.92, 2.19, 2.50, 2.65]
    dance.forEach((play, i) => expect(play.t).toBeCloseTo(1 + markers[i], 10))
    expect(dance[0].file).not.toBe(dance[1].file)
    expect(named('voice_ooh')).toHaveLength(0)
    expect(cuts.map(({ cue }) => cue)).toEqual(['voice_hmph', 'voice_giggle', 'sing_ta'])
    expect(named('sing_ta')[0]).toMatchObject({ file: '/audio/sing_ta-2.mp3', rate: 2 ** (2 / 12), end: 3.5 })
    for (const [cue, target] of [['sing_ta', 69], ['sing_da', 74]]) {
      expect(Math.abs(pitch(named(cue)[0], cues) - target)).toBeLessThanOrEqual(0.25)
    }
    expect(named('sing_da')[0].end).toBeGreaterThan(4)
    director.surface(6, 'yarn_bridge')
    director.surface(7, 'meadow')
    expect(named('voice_whee').map(({ cause }) => cause)).toEqual(['dance', 'bridge-exit'])
  })

  it('ends each overlapping dance voice at the next voice marker', () => {
    const { director, plays } = setup(0, (cues) => {
      for (const file of cues.voice_whee.files) file.duration = 1.5
    })
    director.dance(1, 0)
    director.dance(1.46, 0.46)
    director.dance(2, 1)
    director.dance(3.2, 2.2)
    director.dance(3.51, 2.51)

    const voices = plays.filter(({ kind }) => kind === 'voice')
    expect(voices.map(({ cue }) => cue)).toEqual(['voice_giggle', 'voice_whee', 'sing_ta', 'sing_da'])
    expect(voices.slice(0, -1).map(({ end }) => end)).toEqual(times(voices.slice(1)))
  })

  it('drops otherwise eligible reactions during a dance and allows new ones after it', () => {
    const { director, named } = setup()
    director.dance(5, 0)
    fold(director, 5.1, 'cupcake_tree')
    director.dance(8, undefined, false)
    director.idle(8.1)
    expect(named('voice_ooh')).toHaveLength(0)
    fold(director, 8.2, 'cupcake_tree')
    expect(times(named('voice_ooh'))).toEqual([8.2])
  })

  it('interrupts a dance and skips any remaining cues', () => {
    const { director, named, cuts, plays } = setup()
    director.dance(7, 0)
    director.dance(7.5, 0.5)
    director.dance(7.6)
    director.idle(10)
    expect(plays.map(({ cue }) => cue)).toEqual(['sfx_clap', 'sfx_clap', 'voice_giggle'])
    expect(named('voice_giggle')[0].end).toBeCloseTo(7.62, 10)
    expect(cuts).toHaveLength(1)
  })

  it.each([[-boundary, true], [0, true], [boundary, false]])('accepts retune distance 4 semitones plus %s', (delta, plays) => {
    const { director, named } = setup(0, (cues) => {
      cues.sing_ta.files = [{ ...cues.sing_ta.files[0], baseMidi: 65 - delta }]
    })
    director.dance(3, 3)
    expect(named('sing_ta')).toHaveLength(Number(plays))
    expect(named('sing_da')).toHaveLength(1)
  })

  it('deterministically produces the same cues, gains, pans, file choices and cuts', () => {
    const run = () => {
      const { director, plays, cuts } = setup(hupSeed)
      director.walk(2, true)
      director.step(2, 'meadow')
      fold(director, 2.25, 'flower', { x: 1 })
      director.surface(2.5, 'yarn_bridge')
      director.step(2.5, 'yarn_bridge')
      director.note(2.5, 74)
      director.walk(3.5, false)
      director.idle(5)
      director.dance(7.5, 0)
      director.dance(10.5, 3)
      return { plays, cuts }
    }
    expect(run()).toEqual(run())
  })
})
