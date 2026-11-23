// Remembers the `cue` events of one character, with the effective end after any `cue-end` cut.
// Cue times are in the same clock as the `elapsed` passed to the frame update.
export function createCueTracker(bus, who) {
  const segments = []

  const onCue = ({ detail }) => {
    if (detail.who !== who) return
    segments.push({ cue: detail.cue, t: detail.t, end: detail.end })
    if (segments.length > 32) segments.shift()
  }
  const onEnd = ({ detail }) => {
    if (detail.who !== who) return
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      if (segments[i].cue === detail.cue && segments[i].end > detail.end) {
        segments[i].end = detail.end
        return
      }
    }
  }
  bus.addEventListener('cue', onCue)
  bus.addEventListener('cue-end', onEnd)

  return {
    // The most recently started cue accepted by `filter` that holds at `now`, `hold` seconds past its end.
    latest(now, hold, filter) {
      for (let i = segments.length - 1; i >= 0; i -= 1) {
        const segment = segments[i]
        if (segment.t <= now && now < segment.end + hold && filter(segment.cue)) return segment
      }
      return undefined
    },
    dispose() {
      bus.removeEventListener('cue', onCue)
      bus.removeEventListener('cue-end', onEnd)
    },
  }
}

// `b_voice_ooh` and `voice_ooh` share one mouth and one hair reaction.
export const baseCue = (cue) => cue.replace(/^b_/, '')
