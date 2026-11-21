const EIGHTH = 60 / 96 / 2
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

// Use flatMap with chronological folds. A frame's folds share the same game timestamp.
export function createScheduler() {
  const random = createRandom(96)
  let active = []
  let lastSlot = -1
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
    const slot = Math.floor(t / EIGHTH) + 1
    const chimeTime = slot * EIGHTH

    for (const [dir, { first, count }] of groups) {
      const end = t + (dir === 'down' ? 0.03 : 0.045)
      const playing = active.filter((voice) => voice.t <= t).length
      // Reserve room at the next boundary even if its first up fold has yet to arrive.
      const playingAtSlot = active.filter((voice) => voice.end > chimeTime).length
        + Number(lastSlot !== slot)
      if (playing < VOICE_LIMIT && (end <= chimeTime || playingAtSlot < VOICE_LIMIT)) {
        const gain = 10 ** (Math.min(3, Math.log2(count)) / 20)
        const pop = { kind: 'pop', dir, id: first.id, t, end, gain }
        scheduled.push(pop)
        active.push(pop)
      }
    }

    const upFold = groups.get('up')?.first
    if (upFold && lastSlot !== slot) {
      if (slot - lastSlot > 4) {
        phraseIndex = 0
        varyQuestion = false
      }
      const { id, i, j } = upFold
      const { midi, length, gain } = PHRASE[phraseIndex]
      const pitch = varyQuestion && phraseIndex === 3 ? 81 : midi
      const chime = { kind: 'chime', id, i, j, midi: pitch, t: chimeTime, end: chimeTime + length, gain }
      scheduled.push(chime)
      active.push(chime)
      lastSlot = slot
      phraseIndex = (phraseIndex + 1) % PHRASE.length
      if (phraseIndex === 0) varyQuestion = random() < 0.5
    }

    return scheduled
  }
}
