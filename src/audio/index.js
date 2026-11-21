import { createScheduler } from './music.js'
import { createSoundBank } from './sounds.js'

const LEAD_TIME = 0.025
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const UNLOCK_INPUTS = ['pointerdown', 'pointerup', 'keydown']
let listening = false
let live

export function initAudio() {
  if (listening || typeof window === 'undefined' || !window.AudioContext) return
  listening = true
  // Create it suspended during load: opening the audio device costs ~120 ms, which stalled the first input frame.
  const context = new window.AudioContext()
  live = { context, schedule: createScheduler(), sound: createSoundBank(context), origin: undefined }

  const unlock = async () => {
    try {
      await live.context.resume()
    } catch {
      return // A later gesture can retry a resume rejected by the browser.
    }
    for (const input of UNLOCK_INPUTS) window.removeEventListener(input, unlock, true)
  }

  for (const input of UNLOCK_INPUTS) window.addEventListener(input, unlock, true)
}

function playVoice(sound, voice, offset) {
  sound(voice, offset)
  const atlas = globalThis.window?.__atlas
  if (voice.kind === 'chime' && atlas) {
    const { t, id, i, j, midi } = voice
    const note = `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
    const log = (atlas.audioLog ??= [])
    log.push({ t, id, i, j, midi, note })
  }
}

export function playFold(event) {
  if (live?.context.state !== 'running') return
  live.origin ??= live.context.currentTime + LEAD_TIME - event.t
  for (const voice of live.schedule(event)) playVoice(live.sound, voice, live.origin)
}

export async function renderOffline(events, durationSec, sampleRate = 48_000) {
  const context = new OfflineAudioContext(2, Math.round(durationSec * sampleRate), sampleRate)
  const schedule = createScheduler()
  const sound = createSoundBank(context)
  for (const event of events.toSorted((a, b) => a.t - b.t)) {
    if (event.t >= durationSec) break
    for (const voice of schedule(event)) {
      if (voice.t < durationSec) playVoice(sound, voice, 0)
    }
  }
  return context.startRendering()
}

export function encodeWav(audioBuffer) {
  const { numberOfChannels, sampleRate, length } = audioBuffer
  const frameSize = numberOfChannels * 2
  const dataSize = length * frameSize
  const wav = new ArrayBuffer(44 + dataSize)
  const view = new DataView(wav)

  view.setUint32(0, 0x52494646) // RIFF
  view.setUint32(4, 36 + dataSize, true)
  view.setUint32(8, 0x57415645) // WAVE
  view.setUint32(12, 0x666d7420) // fmt
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * frameSize, true)
  view.setUint16(32, frameSize, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x64617461) // data
  view.setUint32(40, dataSize, true)

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const samples = audioBuffer.getChannelData(channel)
    for (let frame = 0; frame < length; frame++) {
      const sample = Math.max(-1, Math.min(1, samples[frame]))
      const pcm = Math.round(sample * (sample < 0 ? 32768 : 32767))
      view.setInt16(44 + frame * frameSize + channel * 2, pcm, true)
    }
  }
  return wav
}
