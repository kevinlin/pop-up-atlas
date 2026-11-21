import { readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { referenceSet, shots } from '../scripts/sbs.mjs'

test('rounds 1-3 pair each concept-claude frame with its own shot', () => {
  const set = referenceSet(3)
  expect(readdirSync(set.dir).filter((name) => set.pattern.test(name))).toHaveLength(shots.length)
  expect(set.shotFor).toEqual([0, 1, 2, 3, 4, 5])
})

test('round 4 pairs each concept-r4 frame with the shot of its earlier concept', () => {
  const set = referenceSet(4)
  const frames = readdirSync(set.dir).filter((name) => set.pattern.test(name)).sort()
  expect(frames).toHaveLength(set.shotFor.length)
  // style.md: 01 establishing, 02-03 walking, 04 river bridge, 05 fold-up, 06 dance.
  expect(set.shotFor).toEqual([0, 1, 1, 3, 2, 4])
  expect(set.shotFor.every((index) => shots[index])).toBe(true)
})
