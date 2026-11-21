const EIGHTH = 60 / 96 / 2
const REANCHOR_GAP = 6 * EIGHTH
const PHRASE_HOLD = 6
const VOICE_LIMIT = 8
const ACCENT = 10 ** (2 / 20)
const HARMONY_GAIN = 10 ** (-6 / 20)
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]
const PHRASE = [
  { midi: 74, length: 0.46, gain: ACCENT },
  { midi: 71, length: 0.2, gain: 1 },
  { midi: 76, length: 0.2, gain: 1 },
  { midi: 78, length: 0.2, gain: 1 },
  { midi: 74, length: 0.46, gain: ACCENT },
  { midi: 71, length: 0.2, gain: 1 },
  { midi: 69, length: 0.2, gain: 1 },
  { midi: 74, length: 1.02, gain: 1 },
]

export function createRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function slotAfter(t, origin) {
  if (origin === undefined) return 0
  const nearest = Math.round((t - origin) / EIGHTH)
  return nearest + Number(origin + nearest * EIGHTH <= t)
}

export function harmonyMidi(midi) {
  const degree = SCALE.indexOf(midi)
  return SCALE[degree >= 2 ? degree - 2 : degree + 2]
}

// Use flatMap with chronological folds. A frame's folds share the same game timestamp.
export function createScheduler() {
  const random = createRandom(96)
  let active = []
  let origin
  let lastUpTime
  let lastSlot = 0
  let earliestSlot = 0
  let phraseIndex = 0
  let varyQuestion = false

  return (event, index = 0, events = [event]) => {
    const { t } = event
    if (events[index - 1]?.t === t) return []
    const groups = new Map()
    let secondUpFold
    for (let next = index; events[next]?.t === t; next++) {
      const fold = events[next]
      const group = groups.get(fold.dir)
      if (group) {
        group.count++
        if (fold.dir === 'up' && fold.id !== group.first.id) secondUpFold ??= fold
      } else {
        groups.set(fold.dir, { first: fold, count: 1 })
      }
    }

    active = active.filter((voice) => voice.end > t)
    const scheduled = []
    const upFold = groups.get('up')?.first
    const slot = slotAfter(t, origin)
    const reanchor = lastUpTime === undefined || t > lastUpTime + REANCHOR_GAP
    let chime
    if (upFold && (reanchor || slot > lastSlot)) {
      let chimeSlot = Math.max(slot, earliestSlot)
      if (reanchor) {
        origin = t
        chimeSlot = 0
      }
      if (lastUpTime === undefined || t >= lastUpTime + PHRASE_HOLD) {
        phraseIndex = 0
        varyQuestion = false
      }

      const { id, i, j } = upFold
      const { midi, length, gain } = PHRASE[phraseIndex]
      const pitch = varyQuestion && phraseIndex === 3 ? 81 : midi
      const start = origin + chimeSlot * EIGHTH
      const final = phraseIndex === PHRASE.length - 1
      chime = { kind: 'chime', id, i, j, midi: pitch, t: start, end: start + length, gain, passing: length === 0.2, final }
      active.push(chime)
      lastSlot = chimeSlot
      earliestSlot = chimeSlot + (final ? 2 : 1)
      phraseIndex = (phraseIndex + 1) % PHRASE.length
      if (final) varyQuestion = random() < 0.5
    }
    if (upFold) lastUpTime = t

    const nextSlot = slotAfter(t, origin)
    const nextBoundary = origin === undefined ? Infinity : origin + nextSlot * EIGHTH
    // A pop can overlap the first unquantized chime after a gap or a chime on the grid.
    const nextAnchor = Math.max(t, (lastUpTime ?? -Infinity) + REANCHOR_GAP)
    const reserveAtBoundary = nextSlot >= earliestSlot
    const playingAt = (time) => active.filter((voice) => voice.t <= time && voice.end > time)

    for (const [dir, { first, count }] of groups) {
      const end = t + (dir === 'down' ? 0.03 : 0.045)
      const playing = playingAt(t)
      if (playing.length >= VOICE_LIMIT) continue
      if (end > nextAnchor && playingAt(nextAnchor).length + 1 >= VOICE_LIMIT) continue
      if (end > nextBoundary && playingAt(nextBoundary).length + Number(reserveAtBoundary) >= VOICE_LIMIT) continue

      const overlap = playing.filter(({ kind }) => kind === 'pop').length
      const gain = 10 ** (Math.min(3, Math.log2(count)) / 20) / Math.sqrt(overlap + 1)
      const pop = { kind: 'pop', dir, id: first.id, t, end, gain }
      scheduled.push(pop)
      active.push(pop)
    }

    if (chime) {
      scheduled.push(chime)
      const nextChime = origin + earliestSlot * EIGHTH
      if (secondUpFold && playingAt(chime.t).length < VOICE_LIMIT
        && (chime.end <= nextChime || playingAt(nextChime).length + 1 < VOICE_LIMIT)) {
        const { id, i, j } = secondUpFold
        const harmony = { ...chime, id, i, j, midi: harmonyMidi(chime.midi), gain: chime.gain * HARMONY_GAIN, harmony: true }
        scheduled.push(harmony)
        active.push(harmony)
      }
    }
    return scheduled
  }
}
