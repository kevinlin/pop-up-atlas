import { expect, test } from 'vitest'
import { envelope } from '../src/audio/sounds.js'

test('an envelope is silent before its first automation event', () => {
  const events = []
  const gain = {
    value: 1,
    setValueAtTime: (value, time) => events.push(['set', value, time]),
    linearRampToValueAtTime: (value, time) => events.push(['linear', value, time]),
    exponentialRampToValueAtTime: (value, time) => events.push(['exp', value, time]),
  }
  const context = { createGain: () => ({ gain, connect: () => {} }) }
  // A bridge pluck's start time as logged, with float noise.
  envelope(context, {}, 0.2000000000000135, 0.3800000000000132, 0.004, 0.0211)

  expect(gain.value).toBe(0)
  expect(events[0]).toEqual(['set', 0, 0.2000000000000135])
})
