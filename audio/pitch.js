const midi = hz => 69 + 12 * Math.log2(hz / 440)

// YIN's cumulative mean normalized difference, with a sub-sample lag estimate.
function framePitch(samples, start, length, rate) {
  const minLag = Math.floor(rate / 1000)
  const maxLag = Math.ceil(rate / 75)
  const span = length - maxLag
  let energy = 0
  for (let i = 0; i < length; i++) energy += samples[start + i] ** 2
  if (energy / length < 0.003 ** 2) return null

  const difference = new Float64Array(maxLag + 1)
  let cumulative = 0
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < span; i++) {
      const delta = samples[start + i] - samples[start + i + lag]
      sum += delta * delta
    }
    cumulative += sum
    difference[lag] = cumulative ? sum * lag / cumulative : 1
  }
  for (let lag = minLag; lag < maxLag; lag++) {
    if (difference[lag] >= 0.15) continue
    while (lag < maxLag && difference[lag + 1] < difference[lag]) lag++
    if (lag === maxLag) return rate / lag
    const [left, center, right] = difference.subarray(lag - 1, lag + 2)
    const curvature = left - 2 * center + right
    const offset = curvature > 0 ? (left - right) / (2 * curvature) : 0
    return rate / (lag + offset)
  }
  return null
}

function pitchFrames(samples, sampleRate, middle = false) {
  const stride = Math.max(1, Math.floor(sampleRate / 11000))
  const rate = sampleRate / stride
  const reduced = new Float32Array(Math.floor(samples.length / stride))
  for (let i = 0; i < reduced.length; i++) {
    for (let j = 0; j < stride; j++) reduced[i] += samples[i * stride + j] / stride
  }

  const frame = Math.round(rate * 0.04)
  const hop = Math.round(rate * 0.01)
  // Limit the inset so a very short sung take can still supply a full frame.
  const inset = middle
    ? Math.max(0, Math.min(Math.floor(reduced.length * 0.15), Math.floor((reduced.length - frame) / 2)))
    : 0
  const frames = []
  for (let start = inset; start + frame <= reduced.length - inset; start += hop) {
    frames.push(framePitch(reduced, start, frame, rate))
  }
  return { frames, frameSamples: frame * stride, hopSamples: hop * stride }
}

function summarizePitch(frames) {
  const pitches = frames.filter(hz => hz !== null)
  if (!pitches.length) return { medianF0Hz: null, baseMidi: null, stability: null, voicedRatio: 0 }
  pitches.sort((a, b) => a - b)
  const half = Math.floor(pitches.length / 2)
  const medianF0Hz = pitches.length % 2 ? pitches[half] : (pitches[half - 1] + pitches[half]) / 2
  const notes = pitches.map(midi)
  const mean = notes.reduce((sum, note) => sum + note, 0) / notes.length
  const stability = 100 * Math.sqrt(notes.reduce((sum, note) => sum + (note - mean) ** 2, 0) / notes.length)
  return { medianF0Hz, baseMidi: midi(medianF0Hz), stability, voicedRatio: pitches.length / frames.length }
}

export function detectPitch(samples, sampleRate = 44100, { middle = false } = {}) {
  return summarizePitch(pitchFrames(samples, sampleRate, middle).frames)
}

export function selectSungWindow(samples, sampleRate, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('sungWindow must be a positive number of seconds')
  const length = Math.min(samples.length, Math.max(1, Math.round(seconds * sampleRate)))
  const { frames, frameSamples, hopSamples } = pitchFrames(samples, sampleRate)
  const count = 1 + Math.floor((length - frameSamples) / hopSamples)
  let start = 0
  let best
  for (let i = 0; count > 0 && i * hopSamples + length <= samples.length; i++) {
    const pitch = summarizePitch(frames.slice(i, i + count))
    if (pitch.voicedRatio < 0.5) continue
    if (!best || pitch.stability < best.stability
        || (pitch.stability === best.stability && pitch.voicedRatio > best.voicedRatio)) {
      best = pitch
      start = i * hopSamples
    }
  }
  return { start, end: start + length }
}
