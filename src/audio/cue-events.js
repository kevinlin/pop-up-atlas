import { events } from '../scene/runtime.js'

// Bridges the cue director to the `events` bus (docs/contracts.md "Round 6" → Events). Character cues
// carry `who`; fold layers and the chorus do not and stay off the bus. `cue` fires when a cue is
// scheduled with its effective `end`; `cue-end` fires when a cut moves that `end` earlier.
export function createCueEvents(bus = events) {
  const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }))
  return {
    emit({ who, cue, t, end }) {
      if (who) emit('cue', { who, cue, t, end })
    },
    cut({ who, cue, end }) {
      if (who) emit('cue-end', { who, cue, end })
    },
  }
}
