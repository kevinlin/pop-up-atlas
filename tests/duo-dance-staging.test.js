import { expect, test } from 'vitest'
import { DANCE_TURN, danceHeadings } from '../src/character/duo-events.js'

test('the duo faces the camera at dance start, each turned 15 degrees toward the other', () => {
  expect(danceHeadings(0, 0.75)).toEqual({ leader: DANCE_TURN, follower: -DANCE_TURN })
  expect(danceHeadings(0, -0.75)).toEqual({ leader: -DANCE_TURN, follower: DANCE_TURN })
  expect(Math.abs(danceHeadings(1, 1).leader)).toBeCloseTo(15 * Math.PI / 180)
})
