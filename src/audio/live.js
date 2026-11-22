import { createCueDirector } from './cues.js'
import { playVoice } from './index.js'
import { createScheduler } from './music.js'
import { createSamplePlayback, loadSamples, VOICE_FADE } from './samples.js'
import { createSoundBank } from './sounds.js'

// Keep the scheduling margin when a voice fade starts before its cue marker.
const LEAD_TIME = 0.025 + VOICE_FADE
const UNLOCK_INPUTS = ['pointerdown', 'pointerup', 'keydown']
let live

export function initAudio(manifestURL, world, player, debug) {
  if (live || !window.AudioContext) return
  // Opening the audio device on first input used to stall that frame.
  const context = new window.AudioContext()
  const sound = createSoundBank(context)
  const { position } = player
  let pending = []
  let ready
  let playback
  let origin
  let leader = 'a'
  const cues = {}

  function enableSamples() {
    if (ready && context.state === 'running') Object.assign(cues, ready)
  }

  const director = createCueDirector(cues, (play) => {
    origin ??= context.currentTime + LEAD_TIME - play.t
    playback.play(play, origin)
    debug.cueLog.push(play)
  }, (play) => playback.cut(play, origin))

  function surface() {
    return world.tileAt(position.x, position.z)
  }

  live = {
    fold(event) {
      if (context.state !== 'running') return
      origin ??= context.currentTime + LEAD_TIME - event.t
      pending.push(event)
    },
    flushFolds: playFolds,
    setLeader(id) { leader = id },
    update(t, state, danceFinished) {
      director.setSeed(world.seed)
      // The character update follows the swap callback in the same frame.
      director.setLeader(leader, t)
      if (state !== 'dance') director.dance(t, undefined, !danceFinished)
      director.walk(t, state === 'walk')
      director.idle(t)
      director.surface(t, surface())
      if (player.blockedBy && context.state === 'running') director.bump(t, player.blockedBy)
    },
    step(t) { director.step(t, surface()) },
    dance(t, clipTime) { director.dance(t, clipTime) },
  }

  const schedule = createScheduler()
  function playFolds() {
    if (!pending.length) return
    const frame = pending
    pending = []
    let up
    let down
    for (const voice of frame.flatMap(schedule)) {
      playVoice(sound, voice, origin)
      if (voice.kind === 'pop') {
        const { t, dir, id } = voice
        debug.popLog.push({ t, dir, id })
        if (dir === 'up') up = frame.find((fold) => fold.dir === dir && fold.id === id)
        else down = frame.find((fold) => fold.dir === dir && fold.id === id)
      } else if (voice.kind === 'chime' && !voice.harmony) {
        director.note(voice.t, voice.midi)
      }
    }
    for (const fold of frame) director.fold(fold, fold === up || fold === down, position.x, position.z)
  }

  loadSamples(context, manifestURL).then(({ cues: loaded, buffers }) => {
    if (!buffers.size) return
    playback = createSamplePlayback(context, sound, buffers)
    ready = loaded
    enableSamples()
    debug.audioReadyMs = Math.round(performance.now())
  })

  const unlock = async () => {
    try {
      await context.resume()
    } catch {
      return
    }
    enableSamples()
    for (const input of UNLOCK_INPUTS) window.removeEventListener(input, unlock, true)
  }

  for (const input of UNLOCK_INPUTS) window.addEventListener(input, unlock, true)
}

export const playFold = (event) => live?.fold(event)
export const flushAudioFolds = () => live?.flushFolds()
export const updateCharacterAudio = (t, state, danceFinished) => live?.update(t, state, danceFinished)
export const playFootstep = (t) => live?.step(t)
export const playDance = (t, clipTime) => live?.dance(t, clipTime)
export const setLeader = (id) => live?.setLeader(id)
