const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]
const STEPS = [-2, -1, 1, 2]
const EIGHTH = 60 / 96 / 2
const VOICE_LIMIT = 8
const POP_LENGTH = 0.04
const CHIME_LENGTH = 1.02

export function createRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

// Feed events in chronological order, in seconds on the game timeline.
export function createScheduler() {
  const random = createRandom(96)
  let active = []
  let lastSlot = -1
  let degree = 5 // D5

  return ({ dir, id, i, j, t }) => {
    active = active.filter((voice) => voice.end > t)
    const scheduled = []
    const popEnd = t + POP_LENGTH
    const slot = Math.floor(t / EIGHTH) + 1
    const chimeTime = slot * EIGHTH
    const playing = active.filter((voice) => voice.t <= t).length
    // Reserve room at the next boundary even if its first up fold has yet to arrive.
    const playingAtSlot = active.filter((voice) => voice.end > chimeTime).length
      + Number(lastSlot !== slot)

    if (playing < VOICE_LIMIT && (popEnd <= chimeTime || playingAtSlot < VOICE_LIMIT)) {
      scheduled.push({ kind: 'pop', dir, id, t, end: popEnd })
    }

    if (dir === 'up' && lastSlot !== slot) {
      if (lastSlot >= 0) {
        const next = STEPS.map((step) => degree + step).filter((d) => d >= 0 && d < SCALE.length)
        degree = next[Math.floor(random() * next.length)]
      }
      lastSlot = slot
      scheduled.push({ kind: 'chime', id, i, j, midi: SCALE[degree], t: chimeTime, end: chimeTime + CHIME_LENGTH })
    }

    active.push(...scheduled)
    return scheduled
  }
}
