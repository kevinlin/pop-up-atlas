import { readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { lineClear } from '../scripts/capture.mjs'
import { blindStills, duoShots, planShot, r6Shots, referenceSet, shots } from '../scripts/sbs.mjs'
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

test('round 5 keeps the r5 set and round 4 keeps r4', () => {
  // Round 6 moved on to the r6 set (below); rounds 5 and 4 are unchanged.
  expect(referenceSet(5).dir).toBe('reference/concept-r5')
  expect(referenceSet(5).shots).toBe(duoShots)
  expect(referenceSet(4).dir).toBe('reference/concept-r4')
  expect(referenceSet(4).shots).toBe(shots)
})

test('round 6 and later pair the four concept-r6 frames with r6 shots and leave out both character sheets', () => {
  const set = referenceSet(6)
  const all = readdirSync(set.dir).sort()
  const frames = all.filter((name) => set.pattern.test(name))
  expect(all).toEqual(expect.arrayContaining(['concept-r6-00-sheet-a.png', 'concept-r6-00-sheet-b.png']))
  expect(frames).toEqual([
    'concept-r6-01-duo-walk.png',
    'concept-r6-02-duo-dance.png',
    'concept-r6-03-umbrella-pop.png',
    'concept-r6-04-hero-fold.png',
  ])
  expect(set.dir).toBe('reference/concept-r6')
  expect(referenceSet(99)).toBe(set)
  expect(set.shots).toBe(r6Shots)
  expect(r6Shots).toHaveLength(6)
  expect(set.shotFor).toEqual([0, 1, 2, 3])
  const [walk, dance, umbrella, hero] = set.shotFor.map((index) => r6Shots[index])
  expect([walk.state, walk.swap, walk.fold]).toEqual(['walk', undefined, undefined])
  expect([dance.state, dance.followerState, dance.cam]).toEqual(['dance', 'dance', [4.5, 22]])
  expect([umbrella.swap, umbrella.umbrella, umbrella.collide.x]).toEqual([true, true, 39.64])
  expect([hero.fold.dir, hero.state, hero.cam]).toEqual(['up', 'idle', [6, 30]])
  expect(createLayout(hero.seed).getCell(hero.fold.i, hero.fold.j).id).toBe('cupcake_tree')
})

test('every round 6 shot has a clear staging for the leader and for the follower 1.1 behind it', () => {
  for (const shot of r6Shots) {
    const layout = createLayout(shot.seed)
    const { from, moveTo } = planShot(shot, layout)
    for (const point of [from, moveTo].filter(Boolean)) expect(layout.isBlocked(point.x, point.z)).toBe(false)
    const behind = { x: from.x - 1.1 * Math.sin(shot.heading), z: from.z - 1.1 * Math.cos(shot.heading) }
    expect(lineClear(layout, behind, from)).toBe(true)
  }
})

test('the umbrella shot walks B east into the river bank on its pinned lane and stops there', () => {
  const shot = r6Shots.find(({ umbrella }) => umbrella)
  const layout = createLayout(shot.seed)
  const { from, frames } = planShot(shot, layout)
  // Staged exactly as pinned, never nudged: the collision frame depends on the start.
  expect(from).toEqual({ x: shot.x, z: shot.z })
  expect(layout.isBlocked(shot.collide.x - 0.005, shot.z)).toBe(false)
  expect(layout.isBlocked(shot.collide.x + 0.005, shot.z)).toBe(true)
  expect(layout.blockedBy(shot.collide.x + 0.005, shot.z)).toBe('river')
  // The bank is reached within the walk, with at least 0.3 s of the umbrella's open time left at the capture frame.
  const reach = (shot.collide.x - from.x) / 1.2
  expect(reach).toBeGreaterThan(0)
  expect(frames / 60 - reach).toBeGreaterThanOrEqual(0.3)
  // A staging that cannot reach the bank is refused rather than silently moved far away.
  expect(() => planShot({ ...shot, collide: { x: shot.collide.x + 3 } }, layout)).toThrow()
})

test('blind stills: a seeded shuffle of pairs and sides with the answer key kept separate', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ name: `shot-${i + 1}`, first: 'old', second: 'new' }))
  const run = blindStills(items, { seed: 12345 })
  expect(blindStills(items, { seed: 12345 })).toEqual(run)
  expect(run.pairs.map(({ file }) => file).sort()).toEqual(['pair-01.png', 'pair-02.png', 'pair-03.png', 'pair-04.png', 'pair-05.png', 'pair-06.png'])
  // Every shot appears exactly once and each pair holds one old and one new.
  expect(Object.values(run.key.pairs).map(({ name }) => name).sort()).toEqual(items.map(({ name }) => name))
  for (const { file, a, b } of run.pairs) {
    expect([a, b].sort()).toEqual(['new', 'old'])
    expect(run.key.pairs[file]).toMatchObject({ a, b })
  }
  expect(run.key.seed).toBe(12345)
  // The judge-facing pairs name no shot and no answer: only the file and the sides (A/B content is the key's).
  expect(Object.keys(run.pairs[0]).sort()).toEqual(['a', 'b', 'file'])
  // Different seeds shuffle differently, and over many seeds both sides get used for the old build.
  const sides = new Set(Array.from({ length: 30 }, (_, seed) => blindStills(items, { seed }).pairs[0].a))
  expect(sides).toEqual(new Set(['old', 'new']))
  const orders = new Set(Array.from({ length: 30 }, (_, seed) => JSON.stringify(Object.values(blindStills(items, { seed }).key.pairs).map(({ name }) => name))))
  expect(orders.size).toBeGreaterThan(5)
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
