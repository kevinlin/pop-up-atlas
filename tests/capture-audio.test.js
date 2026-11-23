import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { blindPairs, cuesInSegment, pickVoiceSegments, remapCue, writeVoiceBankPairs } from '../scripts/capture-audio.mjs'

test('blindPairs: same seed, same pairs; every item once; the key holds the answers', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ name: `item-${i}`, first: `x${i}`, second: `y${i}` }))
  const run = blindPairs(items, { seed: 7 })
  expect(blindPairs(items, { seed: 7 })).toEqual(run)
  expect(run.pairs.map(({ pair }) => pair)).toEqual(items.map((_, i) => `pair-${i + 1}`))
  expect(Object.values(run.key.pairs).map(({ name }) => name).sort()).toEqual(items.map(({ name }) => name).sort())
  for (const { pair, a, b } of run.pairs) {
    const { name, a: keyA, b: keyB } = run.key.pairs[pair]
    const index = Number(name.replace('item-', ''))
    expect([a, b].sort()).toEqual([`x${index}`, `y${index}`])
    expect([keyA, keyB]).toEqual([a, b])
    // What the judge sees names neither the item nor which side is which.
    expect(Object.keys({ ...run.pairs.find((p) => p.pair === pair) }).sort()).toEqual(['a', 'b', 'pair'])
  }
  expect(run.key.seed).toBe(7)
})

test('blindPairs: different seeds shuffle the order and both sides get used', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ name: `item-${i}`, first: `old${i}`, second: `new${i}` }))
  const orders = new Set()
  const firstSides = new Set()
  for (let seed = 0; seed < 40; seed++) {
    const { pairs, key } = blindPairs(items, { seed })
    orders.add(Object.values(key.pairs).map(({ name }) => name).join())
    firstSides.add(pairs[0].a.startsWith('old'))
  }
  expect(orders.size).toBeGreaterThan(10)
  expect(firstSides).toEqual(new Set([true, false]))
})

const oldBank = {
  version: 1,
  cues: {
    voice_ooh: { kind: 'voice', gain: 0.8, files: [{ src: 'voice_ooh-1.mp3', duration: 1 }, { src: 'voice_ooh-2.mp3', duration: 1.5 }] },
    voice_hm: { kind: 'voice', gain: 0.6, files: [{ src: 'voice_hm-1.mp3', duration: 0.5 }] },
  },
}
const newBank = {
  version: 1,
  cues: {
    voice_ooh: { kind: 'voice', gain: 0.4, files: [{ src: 'voice_ooh-1.mp3', duration: 2 }, { src: 'voice_ooh-2.mp3', duration: 3 }, { src: 'voice_ooh-3.mp3', duration: 1 }] },
  },
}

test('remapCue replays a cue from the other bank: same take index, that bank gain and length, a cut stays cut', () => {
  const cue = { cue: 'voice_ooh', kind: 'voice', file: 'voice_ooh-2.mp3', t: 10, end: 11.5, gain: 0.8, rate: 1, pan: 0 }
  const { cue: moved } = remapCue(cue, oldBank, newBank)
  expect(moved).toMatchObject({ file: 'voice_ooh-2.mp3', gain: 0.4, t: 10, end: 13 })
  // A cue cut short by the log (swap fade, next voice) keeps its cut, within the new take's length.
  const cut = remapCue({ ...cue, end: 10.8 }, oldBank, newBank).cue
  expect(cut.end).toBeCloseTo(10.8)
  expect(remapCue({ ...cue, end: 10.8 }, oldBank, newBank).cue.end).toBeLessThan(13)
  // A shorter take in the other bank ends the cue earlier; the take index wraps around the other bank's take count.
  const wrapped = remapCue({ ...cue, file: 'voice_ooh-2.mp3', end: 11.5 }, newBank, oldBank).cue
  expect(wrapped.file).toBe('voice_ooh-2.mp3')
  const third = remapCue({ ...cue, file: 'voice_ooh-3.mp3', end: 11 }, newBank, oldBank).cue
  // Take 3 of 3 in the new bank is index 2: modulo the old bank's two takes, that is take 1.
  expect(third.file).toBe('voice_ooh-1.mp3')
  expect(third.gain).toBeCloseTo(0.8 * (0.8 / 0.4))
  // Playback rate scales the take's length.
  expect(remapCue({ ...cue, rate: 2, end: 10.75 }, oldBank, newBank).cue.end).toBeCloseTo(10 + 3 / 2)
})

test('remapCue drops a cue the other bank lacks and passes step plucks (no file) through', () => {
  expect(remapCue({ cue: 'voice_hm', kind: 'voice', file: 'voice_hm-1.mp3', t: 1, end: 1.5, gain: 0.6, rate: 1 }, oldBank, newBank))
    .toEqual({ dropped: 'voice_hm' })
  const pluck = { cue: 'step_pluck', kind: 'step', file: null, midi: 74, t: 1, end: 1.2, gain: 1, rate: 1 }
  expect(remapCue(pluck, oldBank, newBank)).toEqual({ cue: pluck })
})

const voiceCue = (cue, t, kind = 'voice') => ({ cue, kind, file: `${cue}-1.mp3`, t, end: t + 1, gain: 1, rate: 1 })

test('pickVoiceSegments takes six non-overlapping 3 s windows, one cue name each first, sorted by time', () => {
  const names = ['voice_lead', 'voice_ooh', 'voice_hm', 'voice_hup', 'voice_whee', 'voice_giggle', 'voice_eep', 'voice_hmph']
  const cues = names.flatMap((name, i) => [voiceCue(name, 2 + i * 3.4), voiceCue(name, 2.2 + i * 3.4 + 0.1)])
  cues.push({ cue: 'step_felt', kind: 'step', file: 'step_felt-1.mp3', t: 5, end: 5.2, gain: 1, rate: 1 })
  const segments = pickVoiceSegments(cues, { duration: 30 })
  expect(segments).toHaveLength(6)
  for (const [index, segment] of segments.entries()) {
    expect(segment.end - segment.start).toBeLessThanOrEqual(3 + 1e-9)
    expect(segment.start).toBeGreaterThanOrEqual(0)
    expect(segment.end).toBeLessThanOrEqual(30)
    if (index) expect(segment.start).toBeGreaterThanOrEqual(segments[index - 1].end)
    expect(segment.names.length).toBeGreaterThan(0)
  }
  expect(new Set(segments.flatMap(({ names }) => names).filter((n) => n.startsWith('voice_'))).size).toBeGreaterThanOrEqual(6)
  expect(segments.map(({ start }) => start)).toEqual([...segments.map(({ start }) => start)].sort((a, b) => a - b))
  // Deterministic.
  expect(pickVoiceSegments(cues, { duration: 30 })).toEqual(segments)
})

test('pickVoiceSegments fills with chorus cues when the log has few voices, and stays inside the clip at the end', () => {
  const cues = [voiceCue('voice_ooh', 29.9), voiceCue('chorus_yay', 4, 'chorus'), voiceCue('chorus_ooh', 8, 'chorus'), voiceCue('chorus_yay', 12, 'chorus')]
  const segments = pickVoiceSegments(cues, { duration: 30 })
  expect(segments.length).toBeGreaterThanOrEqual(3)
  expect(Math.max(...segments.map(({ end }) => end))).toBeLessThanOrEqual(30)
  expect(segments.at(-1).start).toBe(27)
  expect(pickVoiceSegments([], { duration: 30 })).toEqual([])
})

test('cuesInSegment keeps the cues that overlap the window', () => {
  const cues = [voiceCue('a', 0), voiceCue('b', 3.5), voiceCue('c', 5), voiceCue('d', 7.9)]
  expect(cuesInSegment(cues, { start: 3, end: 6 }).map(({ cue }) => cue)).toEqual(['b', 'c'])
  // A cue that started earlier but is still playing counts.
  expect(cuesInSegment([{ ...voiceCue('long', 1), end: 4 }], { start: 3, end: 6 })).toHaveLength(1)
})

test('writeVoiceBankPairs writes blind pairs for the judge and keeps the key apart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-voicebank-'))
  try {
    const staged = join(root, 'staged')
    const round = join(root, 'deliverables', 'round-6')
    const bank = join(staged, 'audio', 'voice-bank')
    await mkdir(bank, { recursive: true })
    const segments = Array.from({ length: 6 }, (_, i) => ({ index: i + 1, start: i * 4, end: i * 4 + 3, names: [`voice_${i}`] }))
    for (const { index } of segments) {
      for (const which of ['old', 'new']) await writeFile(join(bank, `segment-${index}-${which}.wav`), `${which}-${index}`)
    }
    const { pairs, key } = await writeVoiceBankPairs(staged, round, segments, { seed: 99 })
    const judgeDir = join(staged, 'critic-inputs', 'voice-bank')
    const files = (await readdir(judgeDir)).sort()
    expect(files).toEqual(['pair-1-a.wav', 'pair-1-b.wav', 'pair-2-a.wav', 'pair-2-b.wav', 'pair-3-a.wav', 'pair-3-b.wav',
      'pair-4-a.wav', 'pair-4-b.wav', 'pair-5-a.wav', 'pair-5-b.wav', 'pair-6-a.wav', 'pair-6-b.wav', 'pairs.json'])
    // Nothing the judge can read says old or new: the key lives in another folder.
    expect(files.join()).not.toMatch(/old|new|key/)
    expect(JSON.parse(await readFile(join(judgeDir, 'pairs.json'), 'utf8')).flatMap(({ a, b }) => [a, b]).map((path) => path.split('/').at(-1)).join())
      .not.toMatch(/old|new|key/)
    const written = JSON.parse(await readFile(join(staged, 'key', 'voice-bank-key.json'), 'utf8'))
    expect(written.seed).toBe(99)
    expect(Object.keys(written.pairs)).toHaveLength(6)
    for (const { pair } of pairs) {
      const entry = key.pairs[pair]
      const side = entry.old
      expect(['a', 'b']).toContain(side)
      expect(await readFile(join(judgeDir, `${pair}-${side}.wav`), 'utf8')).toMatch(/^old-/)
      expect(await readFile(join(judgeDir, `${pair}-${side === 'a' ? 'b' : 'a'}.wav`), 'utf8')).toMatch(/^new-/)
      expect(entry.cues).toHaveLength(1)
    }
    // The same seed gives the same shuffle.
    const again = await writeVoiceBankPairs(staged, round, segments, { seed: 99 })
    expect(again.key).toEqual(key)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
