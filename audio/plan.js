import { createHash } from 'node:crypto'

export const SFX = '/v1/sound-generation'
export const DESIGN = '/v1/text-to-voice/design'
export const CREATE_VOICE = '/v1/text-to-voice'
export const TTS = '/v1/text-to-speech/'

export function cacheKey(inputs) {
  const canonical = JSON.stringify(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

export function estimateCredits(endpoint, body, rates = {}) {
  const count = text => typeof text === 'string' && text.length ? text.length : NaN
  const rate = (value, fallback) => value === null || value === undefined ? fallback
    : Number.isFinite(value) && value > 0 ? value : NaN
  let estimate
  if (endpoint === SFX && Number.isFinite(body.duration_seconds)
      && body.duration_seconds >= 0.5 && body.duration_seconds <= 30) {
    estimate = body.duration_seconds * rate(rates.sfxCreditsPerSecond, 100)
  }
  if (endpoint.startsWith(TTS)) estimate = count(body.text) * Math.max(2, rate(rates.ttsCreditsPerChar, 2))
  // Voice Design bills the preview text once, even when it returns three candidates.
  if (endpoint === DESIGN) estimate = rate(rates.designCreditsPerCall, 2 * count(body.text))
  // ElevenLabs bills preview generation. Saving a generated preview uses a voice slot.
  if (endpoint === CREATE_VOICE) estimate = 0
  if (!Number.isSafeInteger(Math.ceil(estimate)) || estimate < 0) throw new Error(`Unknown rate for ${endpoint}`)
  return Math.ceil(estimate)
}

export function takeInputs(sheet, cue, take, voiceId) {
  const { defaults } = sheet
  const outputFormat = cue.outputFormat ?? defaults.outputFormat
  if (!/^mp3_\d+_\d+$/.test(outputFormat)) throw new Error(`Invalid MP3 output format for ${cue.cue}`)
  if (cue.source === 'tts') {
    const text = cue.texts?.[(take - 1) % cue.texts.length]
    const voice = sheet.voices?.[cue.voice]
    if (!text || !voice?.ttsModel) throw new Error(`Missing TTS text or model for ${cue.cue}`)
    return { source: cue.source, voiceId, model: voice.ttsModel, outputFormat, text }
  }
  if (cue.source !== 'sfx') throw new Error(`Unknown audio source for ${cue.cue}`)
  const { duration, prompt } = cue
  const model = cue.modelId ?? cue.model_id ?? cue.sfxModel ?? defaults.modelId ?? defaults.model_id ?? defaults.sfxModel
  const promptInfluence = cue.promptInfluence ?? cue.prompt_influence ?? defaults.promptInfluence ?? defaults.prompt_influence ?? 0.3
  const loop = cue.loop ?? defaults.loop ?? false
  if (!Number.isFinite(duration) || duration < 0.5 || duration > 30 || !prompt || !model
      || !Number.isFinite(promptInfluence) || promptInfluence < 0 || promptInfluence > 1
      || typeof loop !== 'boolean') {
    throw new Error(`Invalid sound effect inputs for ${cue.cue}`)
  }
  return { source: cue.source, model, outputFormat, prompt, duration, promptInfluence, loop }
}

export function takeRequest(sheet, cue, take, voiceId) {
  const inputs = takeInputs(sheet, cue, take, voiceId)
  const sfx = inputs.source === 'sfx'
  const endpoint = sfx ? SFX : TTS + (voiceId?.startsWith('<') ? ':voice_id' : encodeURIComponent(voiceId))
  const body = sfx
    ? { text: inputs.prompt, model_id: inputs.model, duration_seconds: inputs.duration,
        prompt_influence: inputs.promptInfluence, loop: inputs.loop }
    : { text: inputs.text, model_id: inputs.model }
  return {
    endpoint, body, outputFormat: inputs.outputFormat, cue: cue.cue, take, key: cacheKey(inputs),
    purpose: sfx ? 'sound effect' : 'voice line',
  }
}

export const rawName = ({ key, take }) => `${key}-${take}.mp3`

export function planTakes(sheet, { only, retake, voiceIds = {}, cached = {} } = {}) {
  const selected = only ? new Set(only) : new Set(sheet.cues.map(cue => cue.cue))
  for (const name of [...selected, ...(retake ? [retake] : [])]) {
    if (!sheet.cues.some(cue => cue.cue === name)) throw new Error(`Unknown cue ${name}`)
  }
  if (retake && !selected.has(retake)) throw new Error('--retake cue must be included in --only')
  return sheet.cues.map(cue => {
    const voiceId = voiceIds[cue.voice] ?? `<voice_${cue.voice}_id>`
    const existing = new Set(cached[cue.cue] ?? [])
    const numbers = new Set(Array.from({ length: cue.takes }, (_, i) => i + 1))
    let highest = cue.takes
    for (const name of existing) {
      const take = Number(/^[a-f0-9]{16}-(\d+)\.mp3$/.exec(name)?.[1])
      if (Number.isSafeInteger(take) && take > 0) {
        numbers.add(take)
        highest = Math.max(highest, take)
      }
    }
    const firstRetake = highest + 1
    if (retake === cue.cue) {
      for (let i = 0; i < cue.takes; i++) numbers.add(firstRetake + i)
    }
    const requests = [...numbers].sort((a, b) => a - b).map(take => takeRequest(sheet, cue, take, voiceId))
    const hits = requests.filter(request => existing.has(rawName(request)))
    const pending = selected.has(cue.cue)
      ? requests.filter(request => !existing.has(rawName(request))
        && (request.take <= cue.takes || request.take >= firstRetake))
      : []
    return { cue, hits, pending, selected: selected.has(cue.cue) }
  })
}

export function designRequests(sheet) {
  const voice = sheet.voices.b
  // The design API requires at least 100 characters. Keep the cue sheet preview verbatim.
  const text = voice.previewText.length < 100
    ? voice.previewText + ' Hm.'.repeat(Math.ceil((100 - voice.previewText.length) / 4))
    : voice.previewText
  return voice.briefs.map((brief, index) => {
    const outputFormat = sheet.defaults.outputFormat
    const body = { voice_description: brief, text }
    return { endpoint: DESIGN, outputFormat, body, cue: 'b_voice_design', take: index + 1,
      key: cacheKey({ ...body, outputFormat }), purpose: 'voice previews' }
  })
}

export function saveVoiceRequest(voice, candidate) {
  const body = { voice_name: voice.name, voice_description: candidate.brief, generated_voice_id: candidate.id }
  return { endpoint: CREATE_VOICE, body, cue: 'b_voice_design', take: null, key: cacheKey(body),
    purpose: 'save selected voice' }
}

export function summarizeCalls(requests, rates) {
  const totals = {}
  const calls = requests.map(request => {
    const { endpoint, cue, take, body } = request
    const estimate = estimateCredits(endpoint, body, rates)
    const group = endpoint.startsWith(TTS) ? TTS + ':voice_id' : endpoint
    totals[group] = (totals[group] ?? 0) + estimate
    return { endpoint: group, cue, take, estimate }
  })
  return { calls, totals, total: Object.values(totals).reduce((sum, cost) => sum + cost, 0) }
}

export function sungValid({ baseMidi, voicedRatio, stability }) {
  return Number.isFinite(baseMidi) && voicedRatio >= 0.5 && Number.isFinite(stability) && stability <= 50
}

export function coverageTargets(name) {
  name = name.replace(/^b_/, '')
  if (name === 'sing_ta') return [69]
  if (name === 'sing_da') return [74]
  if (name === 'sing_hum') {
    const dMajorPentatonic = new Set([2, 4, 6, 9, 11])
    return Array.from({ length: 13 }, (_, index) => 69 + index)
      .filter(note => dMajorPentatonic.has(note % 12))
  }
  return []
}

export function coverageResult(baseMidi, target, measure) {
  const shift = target - baseMidi
  if (!Number.isFinite(baseMidi) || Math.abs(shift) > 4) return { shift, cents: null, pass: false }
  const pitch = measure(2 ** (shift / 12))
  const cents = Number.isFinite(pitch.baseMidi) ? 100 * (pitch.baseMidi - target) : null
  return { shift, cents, pass: sungValid(pitch) && Math.abs(cents) <= 25 + 1e-9 }
}

export function buildManifest(results) {
  const cues = {}
  for (const { cue, takes } of results) {
    const files = takes.filter(take => !cue.sung || sungValid(take)).slice(0, cue.keep)
      .map(({ take, duration, baseMidi }) => ({
        src: `${cue.cue}-${take}.mp3`, duration, ...(cue.sung ? { baseMidi } : {}),
      }))
    if (files.length) cues[cue.cue] = { kind: cue.kind, gain: cue.gain, ...(cue.voice ? { who: cue.voice } : {}), files }
  }
  return { version: 1, cues }
}
