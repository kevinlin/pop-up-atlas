import { afterEach, expect, it, vi } from 'vitest'
import { createCueDirector } from '../src/audio/cues.js'
import { renderOffline } from '../src/audio/index.js'
import { initAudio, setLeader, updateCharacterAudio } from '../src/audio/live.js'
import { hash } from '../src/world/hash.js'
import { fixtureManifest } from './fixtures/audio/manifest.js'

const manifestURL = 'https://atlas.example/game/audio/manifest.json'

function duoManifest() {
  const manifest = fixtureManifest()
  const { cues } = manifest
  cues.voice_lead = { kind: 'voice', gain: 0.7, files: [{ src: '/audio/voice_lead-1.mp3', duration: 0.8 }] }
  const lowerNotes = { sing_hum: [56, 64, 70], sing_ta: [60], sing_da: [59] }
  for (const [cue, entry] of Object.entries(cues)) {
    if (!/^(voice|sing)_/.test(cue)) continue
    entry.who = 'a'
    const files = lowerNotes[cue]
      ? lowerNotes[cue].map((baseMidi, i) => ({ src: `/audio/b_${cue}-${i + 1}.mp3`, duration: 0.8, baseMidi }))
      : entry.files.map((file) => ({ ...file, src: file.src.replace('/audio/', '/audio/b_') }))
    cues[`b_${cue}`] = { ...entry, who: 'b', files }
  }
  return manifest
}

function setup() {
  const { cues } = duoManifest()
  const plays = []
  const cuts = []
  const director = createCueDirector(cues, (play) => plays.push(play), (play) => cuts.push(play))
  return { cues, director, plays, cuts }
}

function hero(director, t, i = 0) {
  director.fold({ t, dir: 'up', id: 'mushroom_house', i, j: 0 }, true, i * 2, 0)
}

const voices = (plays) => plays.filter(({ kind }) => kind === 'voice')
const pitch = ({ file, rate, cue }, cues) =>
  cues[cue].files.find(({ src }) => src === file).baseMidi + 12 * Math.log2(rate)

afterEach(() => vi.unstubAllGlobals())

it.each(['a', 'b'])('routes every voice and character effect to leader %s', (who) => {
  const { cues, director, plays } = setup()
  const seed = Array.from({ length: 100 }, (_, i) => i).find((i) =>
    hash(i, 0, 0, 33) % 3 === 0 && hash(i, 0, 0, 34) % 4 === 0)
  const cell = Array.from({ length: 40 }, (_, i) => i).find((i) => hash(seed, i, 0, 32) % 3 === 0)
  director.setSeed(seed)
  director.setLeader(who, 0)
  director.walk(2, true)
  director.step(2, 'meadow')
  director.step(3, 'path_straight')
  director.walk(5, false)
  director.bump(8, 'prop')
  director.bump(11, 'river')
  hero(director, 14, cell)
  director.surface(16, 'yarn_bridge')
  director.step(16, 'yarn_bridge')
  director.surface(17, 'meadow')
  director.walk(17.5, true)
  director.walk(18, false)
  director.note(18.25, 69)
  director.note(18.5, 74)
  director.note(18.75, 81)
  director.idle(20.125)
  director.dance(24, 0)
  director.dance(27, 3)

  const lines = ['voice_hup', 'voice_hm', 'voice_hmph', 'voice_eep', 'voice_ooh', 'voice_whee',
    'sing_hum', 'sing_hum', 'sing_hum', 'voice_giggle', 'voice_whee', 'sing_ta', 'sing_da']
  if (who === 'b') lines.unshift('voice_lead')
  const voice = voices(plays)
  expect(voice.map(({ cue }) => cue)).toEqual(lines.map((cue) => who === 'b' ? `b_${cue}` : cue))
  for (const play of voice) expect(play.file).toMatch(new RegExp(`^/audio/${play.cue}-`))
  const sung = voice.filter(({ cue }) => cue.includes('sing_'))
  const targets = who === 'b' ? [57, 62, 69, 62, 57] : [69, 74, 81, 69, 74]
  sung.forEach((play, i) => expect(pitch(play, cues)).toBeCloseTo(targets[i], 10))

  const world = plays.filter(({ cause, kind }) => cause === 'fold' || kind === 'chorus')
  expect(world.map(({ cue }) => cue)).toEqual(['fold_mushroom_house', 'chorus_ooh', 'chorus_yay'])
  for (const play of world) expect(play).not.toHaveProperty('who')
  const character = plays.filter((play) => !world.includes(play))
  for (const play of character) expect(play.who).toBe(who)
  const shared = character.filter(({ kind }) => kind !== 'voice')
  expect(shared.map(({ cue }) => cue)).toEqual([
    'sfx_hair_swish', 'step_felt', 'step_paper', 'sfx_hair_settle', 'sfx_bump', 'sfx_plip',
    'step_felt', 'step_pluck', 'sfx_hair_swish', 'sfx_clap', 'sfx_clap', 'sfx_spin',
  ])
})

it.each([[4, true], [5, false]])('applies the four-semitone limit to B at distance %s', (distance, played) => {
  const { cues, director, plays } = setup()
  cues.b_sing_ta.files[0].baseMidi = 62 - distance
  director.setLeader('b', 0)
  director.dance(2, 0)
  director.dance(5, 3)
  const ta = plays.find(({ cue }) => cue === 'b_sing_ta')
  if (played) expect(pitch(ta, cues)).toBeCloseTo(62, 10)
  else expect(ta).toBeUndefined()
})

it('cuts the current hum and clears the rest when the leader swaps', () => {
  const { director, plays, cuts } = setup()
  director.note(0.25, 69)
  director.note(0.5, 74)
  director.note(0.75, 81)
  director.idle(1.5)
  director.setLeader('b', 1.8)
  director.idle(5)

  const [hum, line] = voices(plays)
  expect(voices(plays)).toHaveLength(2)
  expect(hum).toMatchObject({ cue: 'sing_hum', who: 'a', t: 1.5 })
  expect(hum.end).toBeCloseTo(1.82, 10)
  expect(cuts).toEqual([hum])
  expect(line).toMatchObject({ cue: 'b_voice_lead', who: 'b', cause: 'swap', t: hum.end })
})

it('clears the interrupted dance and reaction timers so the next leader can react and dance', () => {
  const { director, plays, cuts } = setup()
  hero(director, 0.5)
  director.dance(0.9, 0)
  director.dance(1.36, 0.46)
  director.setLeader('b', 1.7)
  hero(director, 2.6)
  expect(voices(plays).map(({ cue }) => cue)).toEqual([
    'voice_ooh', 'voice_giggle', 'b_voice_lead', 'b_voice_ooh',
  ])
  const [giggle] = cuts
  expect(giggle).toMatchObject({ cue: 'voice_giggle', who: 'a', end: 1.72 })
  const nextDance = plays.length
  director.dance(5, 0)
  director.dance(6, 1)
  expect(plays.slice(nextDance).map(({ cue, who }) => [cue, who])).toEqual([
    ['sfx_clap', 'b'], ['sfx_clap', 'b'], ['b_voice_giggle', 'b'], ['sfx_spin', 'b'], ['b_voice_whee', 'b'],
  ])
})

it.each([[0.2999, false], [0.3, true]])('guards the swap line after %s seconds of a still-active voice', (age, played) => {
  const { director, plays, cuts } = setup()
  director.bump(2, 'prop')
  director.setLeader('b', 2 + age)
  const [oldVoice, line] = voices(plays)
  expect(cuts).toEqual([oldVoice])
  expect(oldVoice.end).toBeCloseTo(2 + age + 0.02, 10)
  if (played) expect(line).toMatchObject({ cue: 'b_voice_lead', t: oldVoice.end })
  else expect(line).toBeUndefined()
})

it('plays either leader’s swap line at the swap when no voice is active', () => {
  const { director, plays, cuts } = setup()
  director.setLeader('b', 2)
  director.setLeader('b', 3)
  director.setLeader('a', 4)
  expect(plays.map(({ cue, t, who }) => [cue, t, who])).toEqual([
    ['b_voice_lead', 2, 'b'], ['voice_lead', 4, 'a'],
  ])
  expect(cuts).toEqual([])
})

it('skips missing B cue entries while continuing to play shared character effects', () => {
  const { cues, director, plays } = setup()
  delete cues.b_voice_lead
  delete cues.b_voice_hmph
  director.setLeader('b', 1)
  director.bump(2, 'prop')
  expect(plays.map(({ cue, who }) => [cue, who])).toEqual([['sfx_bump', 'b']])
})

function mockAudio(manifest, missing = []) {
  const fetch = vi.fn(async ({ href, pathname }) => {
    if (href === manifestURL) return Response.json(manifest)
    if (missing.includes(`/audio/${pathname.split('/').at(-1)}`)) return new Response(null, { status: 404 })
    return new Response(pathname)
  })
  vi.stubGlobal('fetch', fetch)

  const node = () => ({ connect: (target) => target })
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() })
  const context = {
    state: 'running', currentTime: 0, sampleRate: 8000,
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createConvolver: node,
    createDynamicsCompressor: () => ({ ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }),
    createBuffer: (numberOfChannels, length) => ({ numberOfChannels, getChannelData: () => new Float32Array(length) }),
    createStereoPanner: () => ({ ...node(), pan: {} }),
    createBufferSource: vi.fn(() => ({ ...node(), playbackRate: {}, start: vi.fn(), stop: vi.fn() })),
    decodeAudioData: vi.fn(async (bytes) => new TextDecoder().decode(bytes)),
    startRendering: vi.fn(async () => ({})),
  }
  return { context, fetch }
}

it('applies the live swap at the character update time and skips missing B files without falling back', async () => {
  const manifest = duoManifest()
  const missing = [...manifest.cues.b_voice_eep.files, manifest.cues.b_voice_hmph.files[0]]
  const { context } = mockAudio(manifest, missing.map(({ src }) => src))
  vi.stubGlobal('window', { AudioContext: function () { return context }, addEventListener: vi.fn() })
  const player = { position: { x: 0, z: 0 }, blockedBy: 'prop' }
  const debug = { cueLog: [] }
  initAudio(manifestURL, { seed: 0, tileAt: () => 'meadow' }, player, debug)
  await vi.waitFor(() => expect(debug.audioReadyMs).toBeDefined())

  updateCharacterAudio(1, 'idle')
  setLeader('b')
  player.blockedBy = null
  updateCharacterAudio(1.4, 'idle')
  player.blockedBy = 'river'
  updateCharacterAudio(5, 'idle')
  player.blockedBy = 'prop'
  updateCharacterAudio(9, 'idle')

  const [first, swap, next] = voices(debug.cueLog)
  expect(first).toMatchObject({ cue: 'voice_hmph', who: 'a', end: 1.42 })
  expect(swap).toMatchObject({ cue: 'b_voice_lead', who: 'b', t: first.end })
  expect(next).toMatchObject({ cue: 'b_voice_hmph', who: 'b' })
  expect(next.file).not.toBe(missing.at(-1).src)
  expect(debug.cueLog.map(({ cue }) => cue)).toEqual([
    'sfx_bump', 'voice_hmph', 'b_voice_lead', 'sfx_plip', 'sfx_bump', 'b_voice_hmph',
  ])
  const [, oldSource, newSource] = context.createBufferSource.mock.results.map(({ value }) => value)
  const scheduledEnd = oldSource.start.mock.calls[0][0] + (first.end - first.t)
  expect(oldSource.stop.mock.lastCall[0]).toBeCloseTo(scheduledEnd, 10)
  expect(newSource.start.mock.calls[0][0]).toBeCloseTo(scheduledEnd, 10)
})

it('replays a logged B sample offline with the same cut and 20 ms fade', async () => {
  const { director, plays } = setup()
  director.setLeader('b', 1)
  director.setLeader('a', 1.5)
  const [line] = voices(plays)
  expect(line).toMatchObject({ cue: 'b_voice_lead', t: 1, end: 1.52 })
  const { context, fetch } = mockAudio(duoManifest())
  const OfflineContext = vi.fn(function () { return context })
  vi.stubGlobal('OfflineAudioContext', OfflineContext)

  const result = await renderOffline([], 3, { cues: [line], sampleRate: 8000, manifestURL })

  expect(OfflineContext).toHaveBeenCalledExactlyOnceWith(2, 24000, 8000)
  expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual([
    '/game/audio/manifest.json', '/game/audio/b_voice_lead-1.mp3',
  ])
  const [{ value: source }] = context.createBufferSource.mock.results
  expect(source.buffer).toBe('/game/audio/b_voice_lead-1.mp3')
  expect(source.start).toHaveBeenCalledExactlyOnceWith(line.t, 0)
  expect(source.stop).toHaveBeenLastCalledWith(line.end)
  const { gain } = context.createGain.mock.results.at(-1).value
  expect(gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(line.gain, line.end - 0.02)
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(0, line.end)
  expect(result).toBe(await context.startRendering.mock.results[0].value)
})
