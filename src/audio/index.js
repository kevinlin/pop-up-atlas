import { createScheduler } from './music.js'
import { createSoundBank } from './sounds.js'
import { createSamplePlayback, loadSamples } from './samples.js'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function playVoice(sound, voice, offset) {
  sound(voice, offset)
  const atlas = globalThis.window?.__atlas
  if (voice.kind === 'chime' && atlas) {
    const { t, id, i, j, midi } = voice
    const note = `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
    const log = (atlas.audioLog ??= [])
    log.push({ t, id, i, j, midi, note, ...(voice.harmony !== undefined && { harmony: voice.harmony }) })
  }
}

export async function renderOffline(events, durationSec, { cues = [], sampleRate = 48_000, manifestURL } = {}) {
  const context = new OfflineAudioContext(2, Math.round(durationSec * sampleRate), sampleRate)
  const sound = createSoundBank(context)
  const ordered = events.filter(({ t }) => t < durationSec).sort((a, b) => a.t - b.t)
  const plays = cues.filter(({ t, end }) => t < durationSec && end > 0)
  if (plays.length) {
    const files = new Set(plays.map(({ file }) => file).filter(Boolean))
    const { buffers } = await loadSamples(context, files.size ? manifestURL : undefined, files)
    const playback = createSamplePlayback(context, sound, buffers)
    for (const play of plays) playback.play(play, 0)
  }
  for (const voice of ordered.flatMap(createScheduler())) {
    if (voice.t < durationSec) playVoice(sound, voice, 0)
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
