const EIGHTH = 60 / 96 / 2
const REST_SLOTS = 6
const VOICE_LIMIT = 8
const ACCENT = 10 ** (2 / 20)
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

// Use flatMap with chronological folds. A frame's folds share the same game timestamp.
export function createScheduler() {
  const random = createRandom(96)
  let active = []
  let origin
  let lastSlot = 0
  let earliestSlot = 0
  let phraseIndex = 0
  let varyQuestion = false

  return (event, index = 0, events = [event]) => {
    const { t } = event
    if (events[index - 1]?.t === t) return []
    const groups = new Map()
    for (let next = index; events[next]?.t === t; next++) {
      const fold = events[next]
      const group = groups.get(fold.dir)
      if (group) group.count++
      else groups.set(fold.dir, { first: fold, count: 1 })
    }

    active = active.filter((voice) => voice.end > t)
    const scheduled = []
    const upFold = groups.get('up')?.first
    const slot = slotAfter(t, origin)
    const restart = origin === undefined || slot - lastSlot > REST_SLOTS
    let chime
    if (upFold && (restart || slot > lastSlot)) {
      let chimeSlot = Math.max(slot, earliestSlot)
      if (restart) {
        origin = t
        chimeSlot = 0
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

    const nextSlot = slotAfter(t, origin)
    const nextBoundary = origin === undefined ? Infinity : origin + nextSlot * EIGHTH
    // Preserve a seat for a new chime right now after a rest, or on the next grid line.
    const reserveNow = origin === undefined || nextSlot - lastSlot > REST_SLOTS
    const reserveAtBoundary = nextSlot >= earliestSlot

    for (const [dir, { first, count }] of groups) {
      const end = t + (dir === 'down' ? 0.03 : 0.045)
      const playing = active.filter((voice) => voice.t <= t)
      if (playing.length + Number(reserveNow) >= VOICE_LIMIT) continue
      const playingAtBoundary = active.filter((voice) => voice.t <= nextBoundary && voice.end > nextBoundary).length
      if (end > nextBoundary && playingAtBoundary + Number(reserveAtBoundary) >= VOICE_LIMIT) continue

      const overlap = playing.filter(({ kind }) => kind === 'pop').length
      const gain = 10 ** (Math.min(3, Math.log2(count)) / 20) / Math.sqrt(overlap + 1)
      const pop = { kind: 'pop', dir, id: first.id, t, end, gain }
      scheduled.push(pop)
      active.push(pop)
    }

    if (chime) scheduled.push(chime)
    return scheduled
  }
}
