import { createRandom } from './music.js'

const BELL = [
  { ratio: 1, gain: 0.18, attack: 0.009 },
  { ratio: 2.01, gain: 0.045, attack: 0.006, lengthRatio: 0.6 },
  { ratio: 2.76, gain: 0.022, attack: 0.004, maxLength: 0.25, treble: true, finalGain: 10 ** (-3 / 20) },
  { ratio: 4.05, gain: 0.009, attack: 0.003, maxLength: 0.15, treble: true },
]
const MARIMBA = [
  { ratio: 1, gain: 0.29, attack: 0.004, lengthRatio: 0.7 },
  { ratio: 4, gain: 0.088, attack: 0.002, maxLength: 0.09 },
  { ratio: 9.7, gain: 0.017, attack: 0.002, maxLength: 0.046, treble: true },
]
const MUSIC_BOX = [
  { ratio: 1, gain: 0.19, attack: 0.004 },
  { ratio: 2, gain: 0.094, attack: 0.003, lengthRatio: 0.65 },
  { ratio: 3, gain: 0.048, attack: 0.002, maxLength: 0.19 },
  { ratio: 6.25, gain: 0.023, attack: 0.002, maxLength: 0.1, treble: true },
]
const GLOCKENSPIEL = [
  { ratio: 1, gain: 0.152, attack: 0.005 },
  { ratio: 2.76, gain: 0.075, attack: 0.003, lengthRatio: 0.85 },
  { ratio: 5.4, gain: 0.033, attack: 0.002, maxLength: 0.22, treble: true },
  { ratio: 8.9, gain: 0.012, attack: 0.002, maxLength: 0.12, treble: true },
]
// Level trims (dB) that keep each timbre's peak within ±1.5 dB of the bell at the same note (docs/contracts.md, chime
// timbre by tile): centred on the measured chime-only spread over six melody notes and both note lengths.
const TIMBRE_TRIM = new Map([[MARIMBA, -2.74], [MUSIC_BOX, -1.71], [GLOCKENSPIEL, -1.04]].map(([partials, db]) => [partials, 10 ** (db / 20)]))
const YARN_CHIME_TRIM = 10 ** (-1.96 / 20)
const TILE_PARTIALS = new Map([
  ['mushroom_house', MARIMBA],
  ['cupcake_tree', MUSIC_BOX],
  ['river_straight', GLOCKENSPIEL],
  ['river_corner', GLOCKENSPIEL],
])
const PUFF_ATTACK = Float32Array.from({ length: 17 }, (_, index) => {
  const t = index / 16
  return t * t * (3 - 2 * t)
})
const frequencyForMidi = (midi) => 440 * 2 ** ((midi - 69) / 12)

function yarnString(context) {
  const { sampleRate } = context
  const delay = Math.round(sampleRate / frequencyForMidi(62) - 0.5)
  // Leave enough source audio for the cadence length with two octaves of retuning.
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * 4.4), sampleRate)
  const samples = buffer.getChannelData(0)
  const random = createRandom(491)
  // Band-limit the noise excitation so the pluck stays soft when pitched up two octaves.
  for (let mode = 1; mode <= 6; mode++) {
    const phase = 2 * Math.PI * random()
    const level = (0.7 + 0.3 * random()) / mode ** 1.4
    for (let i = 0; i < delay; i++) samples[i] += level * Math.sin(2 * Math.PI * mode * i / delay + phase)
  }
  samples[delay] = 0.498 * (samples[0] + samples[delay - 1])
  for (let i = delay + 1; i < samples.length; i++) {
    samples[i] = 0.498 * (samples[i - delay] + samples[i - delay - 1])
  }
  const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
  for (let i = 0; i < samples.length; i++) samples[i] /= peak
  // The averaging filter contributes half a sample of delay per round trip.
  return { buffer, frequency: sampleRate / (delay + 0.5) }
}

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

export function envelope(context, output, start, end, attack, peak, passing = false) {
  const shape = context.createGain()
  // A gain node is 1 until its first event; a start time with float noise can let one raw sample through.
  shape.gain.value = 0
  shape.gain.setValueAtTime(0, start)
  shape.gain.linearRampToValueAtTime(peak, start + attack)
  if (passing) shape.gain.exponentialRampToValueAtTime(peak * 10 ** (-12 / 20), start + 0.065)
  shape.gain.exponentialRampToValueAtTime(0.00005, end - Math.min(0.006, (end - start) / 3))
  shape.gain.linearRampToValueAtTime(0, end)
  shape.connect(output)
  return shape
}

export function createSoundBank(context) {
  const popBus = context.createGain()
  const chimeBus = context.createGain()
  popBus.gain.value = 0.9
  chimeBus.gain.value = 1
  const master = context.createGain()
  master.gain.value = 0.5
  popBus.connect(master)
  chimeBus.connect(master)

  const room = context.createConvolver()
  room.normalize = false
  room.buffer = roomImpulse(context)
  const popSend = context.createGain()
  popSend.gain.value = 10 ** (-6 / 20)
  popBus.connect(popSend).connect(room)
  chimeBus.connect(room)
  const wet = context.createGain()
  wet.gain.value = 0.24
  room.connect(wet).connect(master)

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -15
  compressor.knee.value = 10
  compressor.ratio.value = 4
  compressor.attack.value = 0.003
  compressor.release.value = 0.12
  master.connect(compressor).connect(context.destination)

  const noise = noiseBuffer(context)
  const yarn = yarnString(context)
  // `output` lets sample playback share the master bus and compressor.
  return Object.assign((voice, offset = 0) => {
    const start = voice.t + offset
    const end = voice.end + offset

    if (voice.kind === 'pluck' || (voice.kind === 'chime' && voice.id === 'yarn_bridge')) {
      const source = context.createBufferSource()
      source.buffer = yarn.buffer
      source.playbackRate.value = frequencyForMidi(voice.midi) / yarn.frequency
      // The bridge footstep pluck keeps its level (contract: -6 dB under step_felt); only the yarn chime is trimmed.
      const peak = (voice.passing ? 0.267 : 0.31) * voice.gain * (voice.final ? 0.96 : 1) * (voice.kind === 'chime' ? YARN_CHIME_TRIM : 1)
      const shape = envelope(context, chimeBus, start, end, Math.min(0.004, (end - start) / 3), peak, voice.passing)
      if (voice.kind === 'pluck') {
        const panner = context.createStereoPanner()
        panner.pan.value = voice.pan
        source.connect(panner).connect(shape)
      } else {
        source.connect(shape)
      }
      source.start(start)
      source.stop(end)
      return
    }

    if (voice.kind === 'chime') {
      const fundamental = frequencyForMidi(voice.midi)
      const highRegister = Math.max(0, Math.min(1, (voice.midi - 81) / (86 - 81))) // A5 to D6
      const trebleGain = 10 ** (-4 * highRegister / 20)
      const partials = TILE_PARTIALS.get(voice.id) ?? BELL
      const noteGain = voice.gain * (voice.passing && partials === MARIMBA ? 0.81 : 1) * (TIMBRE_TRIM.get(partials) ?? 1)
      for (const { ratio, gain, attack, maxLength = Infinity, lengthRatio = 1, treble, finalGain = 1 } of partials) {
        const frequency = fundamental * ratio
        // Taper upper partials before 8 kHz to leave room for their attack transients.
        const bandwidthGain = Math.min(1, (7800 - frequency) / 1800)
        if (bandwidthGain <= 0) continue
        const partialEnd = start + Math.min((end - start) * lengthRatio, maxLength)
        const peak = gain * noteGain * (treble ? trebleGain : 1) * (voice.final ? finalGain : 1) * bandwidthGain
        const oscillator = context.createOscillator()
        oscillator.frequency.value = frequency
        const passing = ratio === 1 && voice.passing
        oscillator.connect(envelope(context, chimeBus, start, partialEnd, attack, peak, passing))
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
    const down = voice.dir === 'down'
    const level = voice.gain * (down ? 0.48 : 1) * (0.9 + 0.2 * random())
    const color = random()
    const puff = context.createBufferSource()
    puff.buffer = noise
    const felt = context.createBiquadFilter()
    felt.type = 'lowpass'
    felt.frequency.setValueAtTime(down ? 650 + 250 * color : 900 + 650 * color, start)
    if (!down) felt.frequency.exponentialRampToValueAtTime(800, start + 0.035)
    felt.Q.value = 0.25
    const puffShape = context.createGain()
    const puffPeak = 0.32 * level
    puffShape.gain.setValueCurveAtTime(Float32Array.from(PUFF_ATTACK, (gain) => gain * puffPeak), start, 0.007)
    puffShape.gain.linearRampToValueAtTime(0.9 * puffPeak, start + 0.015)
    puffShape.gain.linearRampToValueAtTime(0, end)
    puff.connect(felt).connect(puffShape).connect(popBus)
    puff.start(start, 0.07 * random())
    puff.stop(end)

    const thump = context.createOscillator()
    const pitch = 112 + 26 * random()
    thump.frequency.setValueAtTime(pitch, start)
    thump.frequency.exponentialRampToValueAtTime(0.8 * pitch, end)
    thump.connect(envelope(context, popBus, start, end, 0.007, (down ? 0.07 : 0.12) * level))
    thump.start(start)
    thump.stop(end)
  }, { output: master })
}
