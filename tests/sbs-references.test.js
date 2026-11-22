import { readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { lineClear } from '../scripts/capture.mjs'
import { duoShots, planShot, referenceSet, shots } from '../scripts/sbs.mjs'
import { createLayout } from '../src/world/layout.js'

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

test('round 5 pairs the four concept-r5 duo frames with duo shots and leaves out the character sheet', () => {
  const set = referenceSet(5)
  const all = readdirSync(set.dir).sort()
  const frames = all.filter((name) => set.pattern.test(name))
  expect(all).toContain('concept-r5-00-sheet-b.png')
  expect(frames).toEqual([
    'concept-r5-01-duo-walk.png',
    'concept-r5-02-duo-fold-up.png',
    'concept-r5-03-duo-dance.png',
    'concept-r5-04-duo-bridge.png',
  ])
  expect(set.shotFor).toHaveLength(frames.length)
  expect(set.shots).toBe(duoShots)
  expect(set.shotFor.every((index) => duoShots[index]?.duo === true)).toBe(true)
  // 01 walk (A leads), 02 fold-up beside the pair, 03 duo dance, 04 B leading over a bridge.
  const [walk, fold, dance, bridge] = set.shotFor.map((index) => duoShots[index])
  expect([walk.state, walk.swap, walk.fold]).toEqual(['walk', undefined, undefined])
  expect([fold.fold.dir, fold.state]).toEqual(['up', 'idle'])
  expect([dance.state, dance.followerState]).toEqual(['dance', 'dance'])
  expect([bridge.model, bridge.swap, bridge.state]).toEqual(['yarn_bridge', true, 'walk'])
})

test('later rounds keep the round 5 set and round 4 keeps r4', () => {
  expect(referenceSet(6).dir).toBe('reference/concept-r5')
  expect(referenceSet(99)).toBe(referenceSet(5))
  expect(referenceSet(4).dir).toBe('reference/concept-r4')
  expect(referenceSet(4).shots).toBe(shots)
})

test('every round 5 shot has a clear staging for the leader and for the follower 1.1 behind it', () => {
  for (const shot of duoShots) {
    const layout = createLayout(shot.seed)
    const { from, moveTo } = planShot(shot, layout)
    for (const point of [from, moveTo].filter(Boolean)) expect(layout.isBlocked(point.x, point.z)).toBe(false)
    const behind = { x: from.x - 1.1 * Math.sin(shot.heading), z: from.z - 1.1 * Math.cos(shot.heading) }
    expect(lineClear(layout, behind, from)).toBe(true)
  }
})
