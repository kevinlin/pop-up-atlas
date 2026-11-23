import { hash } from '../world/hash.js'
import { TILE_SIZE } from '../world/tiles.js'
import { VOICE_FADE } from './samples.js'

const EIGHTH = 0.3125
const QUIET = 10 ** (-6 / 20)
const EPSILON = 1e-9
const BRIDGE_NOTES = [74, 76, 78, 81, 83, 86]
export const A_HUM_TOP = 78
const HERO_IDS = new Set(['mushroom_house', 'cupcake_tree', 'yarn_bridge'])
const FOLD_CUES = {
  flower: 'fold_flower',
  mushroom_house: 'fold_mushroom_house',
  cupcake_tree: 'fold_cupcake_tree',
  yarn_bridge: 'fold_yarn_bridge',
  river_corner: 'fold_river',
  river_straight: 'fold_river',
  path_corner: 'fold_path',
  path_straight: 'fold_path',
  meadow: 'fold_meadow',
}
const DANCE = [
  [0, 'sfx_clap'],
  [EIGHTH, 'sfx_clap'],
  [0.45, 'voice_giggle'],
  [0.92, 'sfx_spin'],
  [0.92, 'voice_whee'],
  [2.19, 'sing_ta', 69],
  [2.50, 'sing_da', 74],
  [2.65, 'chorus_yay'],
]
const B_DANCE_NOTES = { sing_ta: 62, sing_da: 57 }

const elapsed = (t, since, gap) => t - since >= gap - EPSILON

export function createCueDirector(cues, emit, cut = () => {}) {
  const lastStart = new Map()
  const lastFile = new Map()
  const reactionStarts = new Map()
  const lastLayer = { up: -Infinity, down: -Infinity }
  const notes = []
  const pendingNotes = []
  const hum = []
  let leader = 'a'
  let voice
  let chorus
  let lastReaction = -Infinity
  let lastBump = -Infinity
  let seed = 0
  let plays = 0
  let steps = 0
  let lastStep = -Infinity
  let starts = 0
  let stops = 0
  let bridge = false
  let bridgeStep = 0
  let moving = false
  let since = 0
  let humAt = 1.5
  let humIndex = 0
  let dancing = false
  let danceIndex = 0

  const ready = (cue, t, gap) => elapsed(t, lastStart.get(cue) ?? -Infinity, gap)

  function fadeVoice(end) {
    if (voice?.end > end) {
      voice.end = end
      cut(voice)
    }
  }

  function sample(cue, t, cause, { pan = 0, level = 1, midi, replace = false } = {}) {
    // Voice A's hum tops out near MIDI 77, so it hums melody notes above A_HUM_TOP an octave down (round 6).
    if (leader === 'a' && cue === 'sing_hum' && midi > A_HUM_TOP) midi -= 12
    if (leader === 'b' && (cue.startsWith('voice_') || cue.startsWith('sing_'))) {
      midi = cue === 'sing_hum' ? midi - 12 : B_DANCE_NOTES[cue] ?? midi
      cue = `b_${cue}`
    }
    const entry = cues[cue]
    if (!entry || (entry.kind === 'chorus' && !elapsed(t, chorus?.end ?? -Infinity, 0))
      || (entry.kind === 'voice' && !replace && !elapsed(t, voice?.end ?? -Infinity, 0))) return false

    let files = entry.files
    if (midi !== undefined) {
      let nearest = Infinity
      for (const { baseMidi } of files) {
        if (Number.isFinite(baseMidi)) nearest = Math.min(nearest, Math.abs(midi - baseMidi))
      }
      if (nearest > 4) return false
      files = files.filter(({ baseMidi }) => Math.abs(midi - baseMidi) === nearest)
    }
    if (files.length > 1) files = files.filter(({ src }) => src !== lastFile.get(cue))
    if (!files.length) return false

    const { src, duration, baseMidi } = files[hash(seed, plays++, 0, 31) % files.length]
    const rate = midi === undefined ? 1 : 2 ** ((midi - baseMidi) / 12)
    const play = { t, end: t + duration / rate, cue, kind: entry.kind, cause, file: src,
      gain: entry.gain * level, pan, rate }
    if (cause !== 'fold' && entry.kind !== 'chorus') play.who = leader
    if (entry.kind === 'voice') {
      if (replace) fadeVoice(t)
      voice = play
    }
    if (entry.kind === 'chorus') chorus = play
    lastStart.set(cue, t)
    lastFile.set(cue, src)
    emit(play)
    return true
  }

  function react(cue, t, cause, gap = 0) {
    if (dancing || !elapsed(t, lastReaction, 2.5)
      || !elapsed(t, reactionStarts.get(cue) ?? -Infinity, gap) || !sample(cue, t, cause)) return false
    reactionStarts.set(cue, t)
    lastReaction = t
    return true
  }

  function rememberNotes(t) {
    while (pendingNotes[0]?.t <= t + EPSILON) {
      notes.push(pendingNotes.shift())
      if (notes.length > 3) notes.shift()
    }
  }

  return {
    setSeed(value) { seed = value },
    setLeader(id, t) {
      if (id === leader) return
      const active = voice?.end > t
      const end = active ? Math.min(voice.end, t + VOICE_FADE) : t
      if (active) fadeVoice(end)

      leader = id
      hum.length = 0
      humIndex = 0
      humAt = Infinity
      dancing = false
      danceIndex = 0
      reactionStarts.clear()
      lastReaction = lastBump = -Infinity
      bridge = moving = false
      since = t

      if (!active || elapsed(t, voice.t, 0.3)) sample('voice_lead', end, 'swap')
    },
    fold({ t, dir, id, i, j }, popPlayed, x, z) {
      const dx = i * TILE_SIZE - x
      if (popPlayed && lastLayer[dir] !== t) {
        const cue = dir === 'up' ? FOLD_CUES[id] : 'fold_down'
        const pan = Math.max(-0.6, Math.min(0.6, dx / 4))
        if (sample(cue, t, 'fold', { pan, level: dir === 'down' ? QUIET : 1 })) lastLayer[dir] = t
      }
      if (dir !== 'up') return
      if (HERO_IDS.has(id) && Math.hypot(dx, j * TILE_SIZE - z) <= 2.5) {
        react('voice_ooh', t, 'hero', 10)
      }
      if (id === 'mushroom_house' && ready('chorus_ooh', t, 8) && hash(seed, i, j, 32) % 3 === 0) {
        sample('chorus_ooh', t, 'chorus')
      }
    },
    surface(t, tile) {
      const onBridge = tile === 'yarn_bridge'
      if (bridge && !onBridge) react('voice_whee', t, 'bridge-exit', 15)
      if (!bridge && onBridge) bridgeStep = 0
      bridge = onBridge
    },
    step(t, tile) {
      if (lastStep === t) return
      lastStep = t
      const pan = steps++ % 2 === 0 ? -0.15 : 0.15
      if (tile === 'yarn_bridge') {
        const midi = BRIDGE_NOTES[Math.min(bridgeStep++, BRIDGE_NOTES.length - 1)]
        if (sample('step_felt', t, 'step', { pan, level: QUIET })) {
          emit({ t, end: t + 0.18, cue: 'step_pluck', kind: 'step', cause: 'step',
            file: null, gain: cues.step_felt.gain, pan, rate: 1, midi, who: leader })
        }
      } else {
        sample(tile?.startsWith('path_') ? 'step_paper' : 'step_felt', t, 'step', { pan })
      }
    },
    walk(t, walking) {
      if (moving === walking) return
      if (walking) {
        const chance = hash(seed, starts++, 0, 33) % 3 === 0
        if (voice?.cause === 'hum') fadeVoice(t + VOICE_FADE)
        hum.length = 0
        humIndex = 0
        humAt = Infinity
        if (elapsed(t, since, 0.5) && ready('sfx_hair_swish', t, 1.5)) sample('sfx_hair_swish', t, 'walk-start')
        if (elapsed(t, since, 2) && chance) react('voice_hup', t, 'walk-start', 8)
      } else {
        const chance = hash(seed, stops++, 0, 34) % 4 === 0
        if (elapsed(t, since, 1)) {
          sample('sfx_hair_settle', t, 'walk-stop')
          if (chance) react('voice_hm', t, 'walk-stop', 10)
        }
        humAt = t + 1.5
      }
      moving = walking
      since = t
    },
    bump(t, reason) {
      if (!elapsed(t, lastBump, 3)) return
      const river = reason === 'river'
      const effect = sample(river ? 'sfx_plip' : 'sfx_bump', t, 'bump')
      const reaction = react(river ? 'voice_eep' : 'voice_hmph', t, 'bump')
      if (effect || reaction) lastBump = t
    },
    note(t, midi) {
      pendingNotes.push({ t, midi })
    },
    idle(t) {
      if (!dancing && elapsed(t, humAt, 0)) {
        if (!hum.length) {
          rememberNotes(humAt)
          const last = notes.at(-1)
          if (last && elapsed(last.t, humAt - 10, 0)) {
            for (const { midi } of notes) hum.push(midi)
          }
        }
        while (humIndex < hum.length && elapsed(t, humAt, 0)) {
          sample('sing_hum', humAt, 'hum', { midi: hum[humIndex++], replace: true })
          humAt += EIGHTH
        }
        if (humIndex >= hum.length) {
          hum.length = 0
          humIndex = 0
          humAt = Infinity
        }
      }
      rememberNotes(t)
    },
    dance(t, clipTime, interrupted = true) {
      if (clipTime === undefined) {
        if (dancing && interrupted && voice?.cause === 'dance') fadeVoice(t + VOICE_FADE)
        dancing = false
        return
      }
      if (!dancing) {
        dancing = true
        danceIndex = 0
        hum.length = 0
        humIndex = 0
        humAt = Infinity
      }
      while (danceIndex < DANCE.length && elapsed(clipTime, DANCE[danceIndex][0], 0)) {
        const [at, cue, midi] = DANCE[danceIndex++]
        sample(cue, t - Math.max(0, clipTime - at), 'dance', { midi, replace: true })
      }
    },
  }
}
