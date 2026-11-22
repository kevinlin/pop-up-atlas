export const VOICE_FADE = 0.02

const KIND_GAINS = { voice: 1, chorus: 0.6, sfx: 0.55, step: 0.4 }
const FOLD_ATTACK = 0.03
const FOLD_RECOVERY = 0.03
const FOLD_SHELF_DB = -11
const requested = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Audio asset unavailable')
  return response
}

export async function loadSamples(context, manifestURL, files) {
  const buffers = new Map()
  if (!manifestURL) return { cues: {}, buffers }
  try {
    const url = new URL(manifestURL, globalThis.location?.href)
    const manifest = await (await requested(url)).json()
    if (manifest.version !== 1 || !manifest.cues || typeof manifest.cues !== 'object') return { cues: {}, buffers }
    const loads = new Map()
    for (const [cue, entry] of Object.entries(manifest.cues)) {
      if (!Object.hasOwn(KIND_GAINS, entry.kind) || !Number.isFinite(entry.gain) || !Array.isArray(entry.files)) {
        return { cues: {}, buffers }
      }
      for (const file of entry.files) {
        if (typeof file.src !== 'string' || !Number.isFinite(file.duration) || file.duration <= 0) {
          return { cues: {}, buffers }
        }
        if (!files || files.has(file.src)) loads.set(file.src, { ...file, optional: cue.startsWith('b_') })
      }
    }
    await Promise.all(Array.from(loads.values(), async ({ src, duration, optional }) => {
      try {
        // Generated /audio paths are relative to the game's deployment base.
        const path = new URL(src.replace(/^\/audio\//, ''), url)
        const bytes = await (await requested(path)).arrayBuffer()
        const buffer = await context.decodeAudioData(bytes)
        buffers.set(src, { buffer, duration })
      } catch (error) {
        if (!optional) throw error
      }
    }))
    for (const [cue, entry] of Object.entries(manifest.cues)) {
      if (cue.startsWith('b_')) entry.files = entry.files.filter(({ src }) => buffers.has(src))
    }
    return { cues: manifest.cues, buffers }
  } catch {
    return { cues: {}, buffers: new Map() }
  }
}

export function createSamplePlayback(context, sound, buffers) {
  const buses = Object.fromEntries(Object.entries(KIND_GAINS).map(([kind, gain]) => {
    const bus = context.createGain()
    bus.gain.value = gain
    bus.connect(sound.output)
    return [kind, bus]
  }))
  const playing = new WeakMap()

  function cut(play, offset) {
    const node = playing.get(play)
    if (!node) return
    const end = play.end + offset
    const fade = Math.max(node.start, end - VOICE_FADE)
    node.trim.gain.setValueAtTime(play.gain, fade)
    node.trim.gain.linearRampToValueAtTime(0, end)
    node.source.stop(end)
  }

  return {
    cut,
    play(play, offset) {
      const { t, end, file, kind, cause, gain, pan, rate } = play
      if (file === null) {
        if (t + offset < 0 || end <= t) return
        sound({ kind: 'pluck', midi: play.midi, t, end, gain: gain * KIND_GAINS.step, pan }, offset)
        return
      }
      const take = buffers.get(file)
      if (!take || end <= t || end + offset <= 0) return
      const scheduled = t + offset
      const start = Math.max(0, scheduled)
      const source = context.createBufferSource()
      source.buffer = take.buffer
      source.playbackRate.value = rate
      const trim = context.createGain()
      trim.gain.value = gain
      const panner = context.createStereoPanner()
      panner.pan.value = pan
      const attackEnd = scheduled + FOLD_ATTACK
      const recoveryEnd = attackEnd + FOLD_RECOVERY
      if (kind === 'sfx' && cause === 'fold' && start < recoveryEnd) {
        const shelf = context.createBiquadFilter()
        shelf.type = 'highshelf'
        shelf.frequency.value = 2350
        shelf.gain.value = FOLD_SHELF_DB * Math.min(1, (recoveryEnd - start) / FOLD_RECOVERY)
        shelf.gain.setValueAtTime(shelf.gain.value, Math.max(start, attackEnd))
        shelf.gain.linearRampToValueAtTime(0, recoveryEnd)
        source.connect(shelf).connect(trim)
      } else {
        source.connect(trim)
      }
      trim.connect(panner).connect(buses[kind])
      source.start(start, Math.max(0, -scheduled) * rate)
      source.stop(end + offset)
      source.onended = () => {
        panner.disconnect()
        playing.delete(play)
      }

      if (kind === 'voice') {
        playing.set(play, { source, trim, start })
        if (end < t + take.duration / rate - 1e-9) cut(play, offset)
      }
    },
  }
}
