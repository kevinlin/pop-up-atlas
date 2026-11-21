import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../audio/generate.mjs'
import { decodeArgs, encodeArgs, inspect, processTake, retunedPitch } from '../audio/media.js'
import { detectPitch, selectSungWindow } from '../audio/pitch.js'
import { buildManifest, cacheKey, coverageResult, coverageTargets, DESIGN, estimateCredits, planTakes,
  rawName, SFX, summarizeCalls, sungValid, takeRequest, TTS } from '../audio/plan.js'
import { elevenLabs, readSpend, spendGuard } from '../audio/spend.js'

const temp = []
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-audio-test-'))
  temp.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const directory of temp.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const sampleRate = 44100
const signal = (duration, makeSample) =>
  Float32Array.from({ length: duration * sampleRate }, (_, index) => makeSample(index / sampleRate))
const sine = (hz, seconds) => Math.sin(2 * Math.PI * hz * seconds)
const pitch = (baseMidi, stability = 0, voicedRatio = 1) => ({ baseMidi, stability, voicedRatio })

function writeTone(directory) {
  const samples = signal(0.5, t => t < 0.075 ? 0 : 0.08 * sine(440, t))
  const wav = Buffer.alloc(44 + samples.length * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((sample, index) => wav.writeInt16LE(Math.round(sample * 32767), 44 + index * 2))
  const raw = join(directory, 'raw.wav')
  writeFileSync(raw, wav)
  return raw
}

const sheet = {
  defaults: { sfxModel: 'sfx-model', promptInfluence: 0.55, outputFormat: 'mp3_44100_128' },
  voice: { ttsModel: 'tts-model', previewText: 'Example text', briefs: ['A concept'] },
  cues: [
    { cue: 'fold', kind: 'sfx', source: 'sfx', prompt: 'paper flip', duration: 0.5, takes: 2, keep: 1, gain: 0.55 },
    { cue: 'sing_ta', kind: 'voice', source: 'tts', sung: true, texts: ['[sings] Ta!', '[sings] Taaa!'],
      takes: 3, keep: 2, gain: 0.8 },
  ],
}

describe('pitch and sung coverage', () => {
  it('measures A4 to within five cents', () => {
    const result = detectPitch(signal(0.5, t => 0.5 * sine(440, t)))
    expect(Math.abs(result.baseMidi - 69)).toBeLessThanOrEqual(0.05)
    expect(result.voicedRatio).toBe(1)
  })

  it('finds B3 when the harmonics are stronger than the fundamental', () => {
    const result = detectPitch(signal(0.5, t =>
      0.18 * sine(246.94, t) + 0.42 * sine(493.88, t) + 0.35 * sine(740.82, t)))
    expect(Math.abs(result.baseMidi - 59)).toBeLessThanOrEqual(0.05)
  })

  it('rejects noise and silence as unvoiced', () => {
    let random = 1
    const noise = signal(0.5, () => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      return random / 2 ** 31 - 0.5
    })
    expect(detectPitch(noise)).toMatchObject({ baseMidi: null, voicedRatio: 0 })
    expect(detectPitch(signal(0.5, () => 0))).toMatchObject({ baseMidi: null, voicedRatio: 0 })
  })

  it('selects a stable sung window after a glide', () => {
    const glide = 0.45
    const duration = 0.35
    const samples = signal(1.1, t => {
      const elapsed = Math.min(t, glide)
      const cycles = 220 * elapsed + 110 * elapsed ** 2 / glide + 440 * Math.max(0, t - glide)
      return 0.5 * Math.sin(2 * Math.PI * cycles)
    })
    expect(detectPitch(samples).stability).toBeGreaterThan(50)
    const { start, end } = selectSungWindow(samples, sampleRate, duration)
    expect(start / sampleRate).toBeGreaterThanOrEqual(glide - 0.01)
    expect(end - start).toBe(Math.round(duration * sampleRate))
    const measured = detectPitch(samples.subarray(start, end))
    expect(Math.abs(measured.baseMidi - 69)).toBeLessThanOrEqual(0.05)
    expect(measured.stability).toBeLessThan(5)
    expect(measured.voicedRatio).toBe(1)
  })

  it('keeps the boundary values and drops unstable or mostly unvoiced takes', () => {
    expect(sungValid(pitch(69, 50, 0.5))).toBe(true)
    expect(sungValid(pitch(69, 50.01, 1))).toBe(false)
    expect(sungValid(pitch(69, 0, 0.49))).toBe(false)
    expect(sungValid(pitch(null))).toBe(false)
    expect(coverageTargets('sing_ta')).toEqual([69])
    expect(coverageTargets('sing_da')).toEqual([74])
    expect(coverageTargets('sing_hum')).toEqual([69, 71, 74, 76, 78, 81])
  })

  it('checks the rendered pitch at no more than four semitones of shift', () => {
    const measure = vi.fn(() => pitch(69.25))
    expect(coverageResult(65, 69, measure)).toMatchObject({ pass: true, cents: 25, shift: 4 })
    expect(measure).toHaveBeenCalledWith(2 ** (4 / 12))
    expect(coverageResult(64.99, 69, measure).pass).toBe(false)
    expect(measure).toHaveBeenCalledTimes(1)
    expect(coverageResult(69, 69, () => pitch(68.749)).pass).toBe(false)
    expect(coverageResult(69, 69, () => pitch(69, 51)).pass).toBe(false)
  })
})

describe('requests, cache and manifest', () => {
  it('includes every audio-shaping input in a deterministic key', () => {
    const inputs = { source: 'sfx', voiceId: 'voice', model: 'model', prompt: 'prompt', text: 'text',
      duration: 0.5, promptInfluence: 0.55, loop: false, outputFormat: 'mp3_44100_128' }
    expect(cacheKey(inputs)).toMatch(/^[a-f0-9]{16}$/)
    expect(cacheKey(Object.fromEntries(Object.entries(inputs).reverse()))).toBe(cacheKey(inputs))
    for (const [name, value] of Object.entries(inputs)) {
      const changed = typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : value + '2'
      expect(cacheKey({ ...inputs, [name]: changed })).not.toBe(cacheKey(inputs))
    }
  })

  it('ignores obsolete cached inputs and appends retakes with cyclic texts', () => {
    const cue = sheet.cues[1]
    const old = takeRequest(sheet, cue, 1, 'old')
    const existing = [takeRequest(sheet, cue, 2, 'new'), takeRequest(sheet, cue, 6, 'old')]
    const [sfx, sung] = planTakes(sheet, {
      only: ['sing_ta'], retake: 'sing_ta', voiceId: 'new',
      cached: { sing_ta: [old, ...existing].map(rawName) },
    })
    expect(sfx.pending).toEqual([])
    expect(sung.hits.map(take => take.take)).toEqual([2])
    expect(sung.pending.map(take => take.take)).toEqual([1, 3, 7, 8, 9])
    expect(sung.pending.map(take => take.body.text)).toEqual([
      '[sings] Ta!', '[sings] Ta!', '[sings] Ta!', '[sings] Taaa!', '[sings] Ta!',
    ])
  })

  it('applies direct SFX overrides and credits', () => {
    const request = takeRequest(sheet, { ...sheet.cues[0], modelId: 'another', loop: true,
      promptInfluence: 0 }, 1)
    expect(request.body).toEqual({ text: 'paper flip', model_id: 'another', duration_seconds: 0.5,
      loop: true, prompt_influence: 0 })
    expect(estimateCredits(SFX, request.body)).toBe(50)
    expect(estimateCredits(SFX, request.body, { sfxCreditsPerSecond: 40 })).toBe(20)
    expect(estimateCredits(DESIGN, { text: 'text' })).toBe(24)
    expect(estimateCredits(DESIGN, { text: 'text' }, { designCreditsPerCall: 10 })).toBe(10)
    expect(estimateCredits(TTS + 'voice', { text: 'text' }, { ttsCreditsPerChar: 1 })).toBe(8)
  })

  it('builds the fixture dry-run plan and prints it without network or a budget', async () => {
    const requests = planTakes(sheet).flatMap(group => group.pending)
    const estimate = summarizeCalls(requests)
    expect(estimate.total).toBe(170)
    expect(estimate.calls.map(call => call.take)).toEqual([1, 2, 1, 2, 3])
    const root = scratch()
    mkdirSync(join(root, 'audio'))
    writeFileSync(join(root, 'audio/cues.json'), JSON.stringify(sheet))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    await main(['--dry-run'], root)
    expect(fetch).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith('Conservative total: 170 credits (5 paid calls)')
  })

  it('ships the first kept takes and omits pitch from non-sung assets', () => {
    const [fold, sing] = sheet.cues
    expect(buildManifest([
      { cue: fold, takes: [{ take: 1, duration: 0.3, baseMidi: 60 }, { take: 2, duration: 0.25 }] },
      { cue: sing, takes: [{ take: 1, duration: 0.2, ...pitch(69, 10, 0.3) },
        { take: 2, duration: 0.3, ...pitch(69.02) }] },
    ])).toEqual({ version: 1, cues: {
      fold: { kind: 'sfx', gain: 0.55, files: [{ src: 'fold-1.mp3', duration: 0.3 }] },
      sing_ta: { kind: 'voice', gain: 0.8, files: [{ src: 'sing_ta-2.mp3', duration: 0.3, baseMidi: 69.02 }] },
    } })
  })
})

describe('spend guard', () => {
  const request = takeRequest(sheet, sheet.cues[0], 1)
  const response = (credits, status = 200) => new Response('audio', { status,
    headers: { 'request-id': 'request-1', ...(credits === undefined ? {} : { 'character-cost': credits }) } })

  function setup({ row = 'G1', cap = 100, budget = 100, ...options } = {}) {
    const ledger = join(scratch(), 'spend.jsonl')
    const fetch = vi.fn(async () => response('50'))
    const send = elevenLabs('test-key', fetch)
    const guard = (overrides = {}) => spendGuard({ ledger, row, cap, budget, send, ...options, ...overrides })
    return { ledger, fetch, guard }
  }

  it('reserves before sending, records provider cost and refuses above the global cap across rows', async () => {
    const { guard, fetch, ledger } = setup({ cap: 99 })
    fetch.mockImplementationOnce(async (url, options) => {
      expect(url.origin).toBe('https://api.elevenlabs.io')
      expect(options.redirect).toBe('error')
      expect(() => readSpend(ledger)).toThrow(/unresolved/i)
      return response('50')
    })
    await guard()(request)
    await expect(guard({ row: 'G2' })(request)).rejects.toThrow('Spend cap')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(readSpend(ledger)[0]).toMatchObject({ row: 'G1', estimate: 50, credits: 50, outcome: 'ok',
      request_id: 'request-1', credits_source: 'character-cost' })
    expect(readFileSync(ledger, 'utf8')).not.toContain('test-key')
  })

  it('refuses above the row allocation, permits exact equality, and uses measured credits', async () => {
    const { guard, fetch, ledger } = setup({ cap: 200, budget: 80 })
    fetch.mockResolvedValueOnce(response('30')).mockResolvedValueOnce(response())
    await guard()(request)
    await guard()(request)
    await expect(guard()(request)).rejects.toThrow('Row G1 budget')
    expect(readSpend(ledger).map(call => call.credits)).toEqual([30, 50])
    expect(readSpend(ledger)[1].credits_source).toBe('estimate')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('requires a budget and refuses unknown rates and endpoints without fetching', async () => {
    const { guard, fetch } = setup()
    expect(() => guard({ budget: undefined })).toThrow('--budget')
    await expect(guard({ rates: { sfxCreditsPerSecond: 'unknown' } })(request)).rejects.toThrow('Unknown rate')
    await expect(guard()({ ...request, endpoint: '/v1/unknown' })).rejects.toThrow('Unknown rate')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('records an HTTP failure and refuses further calls over the row call limit', async () => {
    const { guard, fetch, ledger } = setup({ maxCalls: 1 })
    fetch.mockResolvedValueOnce(response(undefined, 429))
    await expect(guard()(request)).rejects.toThrow('HTTP 429')
    await expect(guard()(request)).rejects.toThrow('paid-call limit')
    expect(readSpend(ledger)[0]).toMatchObject({ outcome: 'http_429', credits: 50, credits_source: 'estimate' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops on an unresolved prior call and leaves transport ambiguity unresolved', async () => {
    const { guard, fetch, ledger } = setup()
    fetch.mockRejectedValueOnce(new Error('lost connection'))
    await expect(guard()(request)).rejects.toThrow('pending ledger record')
    await expect(guard({ row: 'G2' })(request)).rejects.toThrow(/unresolved/i)
    expect(readFileSync(ledger, 'utf8').trim().split('\n')).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('serializes the check and reservation for simultaneous callers', async () => {
    const { guard, fetch } = setup()
    let respond
    fetch.mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
    const inFlight = guard()(request)
    await expect(guard({ row: 'G2' })(request)).rejects.toThrow('ledger is locked')
    respond(response('50'))
    await inFlight
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('ffmpeg processing', () => {
  it('uses a 15 ms fade, mono 44.1 kHz MP3, and sample-rate retuning', () => {
    expect(encodeArgs({ start: 25, length: 22050, gain: 3, bitrate: 64, file: 'step.mp3' })).toEqual([
      '-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', '44100', '-ac', '1',
      '-i', 'pipe:0', '-af', 'atrim=start_sample=25,afade=t=out:ss=21388:ns=662,volume=3dB',
      '-c:a', 'libmp3lame', '-b:a', '64k', 'step.mp3',
    ])
    expect(decodeArgs('step.mp3', 2)).toContain('aresample=44100,asetrate=88200,aresample=44100')
    expect(decodeArgs('step.mp3')).not.toContain('-af')
  })

  it('checks the encoded MP3 onset, peak and sung pitch after actual retuning', async () => {
    const root = scratch()
    const raw = writeTone(root)
    const cue = sheet.cues[1]
    const processed = processTake(raw, cue)
    expect(processed.duration).toBeCloseTo(0.4, 2)
    expect(processed.windowStart).toBeGreaterThan(0)
    const publicAudio = join(root, 'public/audio')
    mkdirSync(publicAudio, { recursive: true })
    const shipped = join(publicAudio, 'sing_ta-1.mp3')
    writeFileSync(shipped, processed.audio)
    expect(inspect(shipped, cue)).toMatchObject({ pass: true, kbps: 96 })
    const rendered = coverageResult(processed.baseMidi, 72, rate => retunedPitch(shipped, rate))
    expect(rendered.pass).toBe(true)
    expect(Math.abs(rendered.cents)).toBeLessThan(5)

    mkdirSync(join(root, 'audio'))
    writeFileSync(join(root, 'audio/cues.json'), JSON.stringify({ ...sheet, cues: [cue] }))
    const manifestFile = join(publicAudio, 'manifest.json')
    const manifest = buildManifest([{ cue, takes: [{ take: 1, ...processed }] }])
    writeFileSync(manifestFile, JSON.stringify(manifest))
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(main(['--check'], root)).resolves.toBeUndefined()
    manifest.cues.sing_ta.files[0].src = '/audio/sing_ta-1.mp3'
    writeFileSync(manifestFile, JSON.stringify(manifest))
    await expect(main(['--check'], root)).rejects.toThrow('Audio check failed')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('auto-picks a measured preview and ships only selected requests on a cached rerun', async () => {
    const root = scratch()
    const json = file => JSON.parse(readFileSync(join(root, file), 'utf8'))
    const [fold] = sheet.cues
    const { audio } = processTake(writeTone(root), fold)
    const voice = { ...sheet.voice, name: 'Fixture', targetPitchHz: [300, 520] }
    mkdirSync(join(root, 'audio'))
    writeFileSync(join(root, 'audio/cues.json'), JSON.stringify({ ...sheet, voice }))
    const procedural = join(root, 'deliverables/round-4/procedural')
    mkdirSync(procedural, { recursive: true })
    writeFileSync(join(procedural, 'tile chime.mp3'), audio)
    const fetch = vi.fn(async url => {
      if (url.pathname === DESIGN) {
        return Response.json({ previews: [{ generated_voice_id: 'candidate', audio_base_64: audio.toString('base64') }] })
      }
      if (url.pathname === '/v1/text-to-voice') return Response.json({ voice_id: 'voice' })
      if (url.pathname === '/v1/models') return Response.json([{ model_id: voice.ttsModel }])
      if (url.pathname === SFX || url.pathname === TTS + 'voice') return new Response(audio)
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('ELEVENLABS_API_KEY', 'fixture-key')
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await main(['--design', '--budget', '300'], root)
    await main(['--only', 'fold', '--budget', '300'], root)
    await main(['--only', 'fold'], root)
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual([DESIGN, '/v1/text-to-voice', SFX, SFX])
    expect(json('audio/voice.json')).toMatchObject({ voice_id: 'voice', generated_voice_id: 'candidate',
      reason: expect.stringContaining('highest voiced ratio') })
    expect(json('audio/voice-candidates.json')[0].medianF0Hz).toBeCloseTo(440, 0)
    const manifest = json('public/audio/manifest.json')
    expect(Object.keys(manifest.cues)).toEqual(['fold'])
    expect(new URL(manifest.cues.fold.files[0].src, 'https://atlas.example/build/audio/manifest.json').pathname)
      .toBe('/build/audio/fold-1.mp3')
    await main(['--only', 'sing_ta', '--budget', '300'], root)
    expect(fetch.mock.calls.slice(4).map(([url]) => url.pathname)).toEqual([
      '/v1/models', TTS + 'voice', TTS + 'voice', TTS + 'voice',
    ])
    const { key } = takeRequest(sheet, sheet.cues[1], 1, 'voice')
    const measured = json(`.handoff/audio-raw/sing_ta/${key}-1.pitch.json`)
    expect(measured.accepted).toBe(true)
    expect(Math.abs(measured.baseMidi - 69)).toBeLessThanOrEqual(0.05)
    expect(measured.stability).toBeLessThanOrEqual(50)
    const board = readFileSync(join(root, 'deliverables/round-4/soundboard.html'), 'utf8')
    expect(board.match(/<audio controls/g)).toHaveLength(5)
    expect(board).toContain('../../public/audio/fold-1.mp3')
    expect(board).toContain('voice-candidates/candidate.mp3')
    expect(board).toContain('procedural/tile%20chime.mp3')
    expect(board).not.toContain('.handoff')
  })
})
