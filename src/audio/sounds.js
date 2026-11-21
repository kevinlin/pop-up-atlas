import { createRandom } from './music.js'

const PARTIALS = [
  { ratio: 1, gain: 0.18, decay: 1 },
  { ratio: 2.01, gain: 0.045, decay: 0.84 },
  { ratio: 2.76, gain: 0.022, decay: 0.72 },
  { ratio: 4.05, gain: 0.009, decay: 0.62 },
]

function noiseBuffer(context) {
  const random = createRandom(1207)
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.12), context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = 2 * random() - 1
  return buffer
}

function roomImpulse(context) {
  const { sampleRate } = context
  const length = Math.ceil(sampleRate * 0.18)
  const buffer = context.createBuffer(2, length, sampleRate)
  const random = createRandom(2189)
  const level = 1 / Math.sqrt(sampleRate * 0.02)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    let filtered = 0
    for (let i = 0; i < length; i++) {
      filtered += 0.28 * (2 * random() - 1 - filtered)
      const fadeIn = Math.min(1, i / (sampleRate * 0.004))
      data[i] = filtered * level * fadeIn * (1 - i / length) ** 3
    }
  }
  return buffer
}

function envelope(context, output, start, end, attack, peak) {
  const shape = context.createGain()
  shape.gain.setValueAtTime(0, start)
  shape.gain.linearRampToValueAtTime(peak, start + attack)
  shape.gain.exponentialRampToValueAtTime(0.00005, end - 0.006)
  shape.gain.linearRampToValueAtTime(0, end)
  shape.connect(output)
  return shape
}

export function createSoundBank(context) {
  const bus = context.createGain()
  const master = context.createGain()
  master.gain.value = 0.5

  const room = context.createConvolver()
  room.normalize = false
  room.buffer = roomImpulse(context)
  const wet = context.createGain()
  wet.gain.value = 0.24
  bus.connect(room).connect(wet).connect(master)
  bus.connect(master)

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -15
  compressor.knee.value = 10
  compressor.ratio.value = 10
  compressor.attack.value = 0.003
  compressor.release.value = 0.12
  master.connect(compressor).connect(context.destination)

  const noise = noiseBuffer(context)
  return (voice, offset) => {
    const start = voice.t + offset
    const end = voice.end + offset

    if (voice.kind === 'chime') {
      const fundamental = 440 * 2 ** ((voice.midi - 69) / 12)
      for (const { ratio, gain, decay } of PARTIALS) {
        const partialEnd = start + (end - start) * decay
        const oscillator = context.createOscillator()
        oscillator.frequency.value = fundamental * ratio
        oscillator.connect(envelope(context, bus, start, partialEnd, 0.006, gain))
        oscillator.start(start)
        oscillator.stop(partialEnd)
      }
      return
    }

    const id = String(voice.id)
    let seed = 2166136261
    for (let i = 0; i < id.length; i++) {
      seed = Math.imul(seed ^ id.charCodeAt(i), 16777619)
    }
    const random = createRandom(seed)
    const level = (voice.dir === 'down' ? 0.48 : 1) * (0.9 + 0.2 * random())
    const puffEnd = start + 0.034
    const puff = context.createBufferSource()
    puff.buffer = noise
    const felt = context.createBiquadFilter()
    felt.type = 'lowpass'
    felt.frequency.value = 900 + 650 * random()
    felt.Q.value = 0.25
    puff.connect(felt).connect(envelope(context, bus, start, puffEnd, 0.005, 0.32 * level))
    puff.start(start, 0.07 * random())
    puff.stop(puffEnd)

    const thump = context.createOscillator()
    const pitch = 112 + 26 * random()
    thump.frequency.setValueAtTime(pitch, start)
    thump.frequency.exponentialRampToValueAtTime(0.58 * pitch, end)
    thump.connect(envelope(context, bus, start, end, 0.006, 0.18 * level))
    thump.start(start)
    thump.stop(end)
  }
}
