import { describe, expect, test } from 'vitest'
import { duoRound, duoTiming, framingVerdict, planDuoCaptureRoute, plannedFoldUps } from '../scripts/capture.mjs'
import { duoContract } from '../scripts/e2e-duo-plan.mjs'
import { LAST_PAGE_ROW, TILE_SIZE } from '../src/world/tiles.js'

const fps = 60
const plan = planDuoCaptureRoute()
const keyAt = (frame) => plan.keys.find((key) => key.frame === frame)

describe('round 5 capture route (30 s duo, default camera)', () => {
  test('plans on a layout with an eastbound yarn bridge in the last page row', () => {
    expect(duoRound).toBe(5)
    const bridge = plan.layout.getCell(plan.bridgeX / TILE_SIZE, LAST_PAGE_ROW)
    expect([bridge.id, bridge.rotation]).toEqual(['yarn_bridge', 0])
    expect(plan.frames.east).toBeGreaterThan(plan.frames.swap)
  })

  test('A walks first, one Space swap lands mid-walk, B leads over the bridge', () => {
    const presses = plan.keys.filter((key) => key.press)
    expect(presses.map((key) => key.press)).toEqual([['Space']])
    const { swap, bridge, stop } = plan.frames
    // Space comes while D is held (A walking east) and at least 3 s into the clip.
    expect(swap / fps).toBeGreaterThanOrEqual(3)
    expect(plan.keys[0]).toEqual({ frame: 1, down: ['KeyD'] })
    expect(keyAt(swap).press).toEqual(['Space'])
    // B turns off the old heading (north) before walking east, so the pair never walk through each other.
    expect(keyAt(plan.frames.north)).toEqual({ frame: plan.frames.north, up: ['KeyD'], down: ['KeyW'] })
    expect(swap).toBeLessThan(bridge[0])
    expect(bridge[1]).toBeLessThan(stop)
    expect(bridge[1] - bridge[0]).toBeGreaterThan(0.5 * fps)
  })

  test('stops long enough for the duo dance in canon: 4 s idle, the 3 s dance, the follower 0.3125 s later', () => {
    const { release, dance, danceEnd } = plan.frames
    expect((dance - release) / fps).toBe(duoTiming.danceIdleSeconds)
    expect(danceEnd - dance).toBeGreaterThanOrEqual(Math.ceil((3 + duoTiming.followerDanceDelay) * fps))
    expect(danceEnd).toBeLessThan(30 * fps)
    // The pair stand still from the key release to the end of the clip.
    expect(plan.keys.filter((key) => key.frame > release)).toEqual([])
    expect(release).toBeGreaterThan(plan.frames.stop)
  })

  test('plans at least 4 fold-up events, spread over the walk', () => {
    expect(plan.folds.length).toBeGreaterThanOrEqual(duoTiming.minFoldUps)
    expect(plannedFoldUps(plan.segments, plan.layout)).toEqual(plan.folds)
    // Flat tiles raise no fold event.
    expect(plan.folds.every(({ i, j }) => !/^(meadow|river_)/.test(plan.layout.getCell(i, j).id))).toBe(true)
    const times = plan.folds.map(({ t }) => t)
    expect(times.every((t) => t > 0 && t < 30)).toBe(true)
    expect(times.filter((t) => t < plan.frames.swap / fps).length).toBeGreaterThanOrEqual(duoTiming.minFoldUps)
  })

  test('the route is deterministic and every leg is clear on the layout', () => {
    expect(planDuoCaptureRoute().seed).toBe(plan.seed)
    for (const { from, to } of plan.segments) {
      for (let i = 0; i <= 40; i++) {
        const u = i / 40
        expect(plan.layout.isBlocked(from.x + (to.x - from.x) * u, from.z + (to.z - from.z) * u)).toBe(false)
      }
    }
  })
})

describe('capture framing verdict (DUO-40)', () => {
  const ok = { limitFrames: 30, outsideFrames: 0, firstOutside: [], longestOverlapFrames: 30, longestOverlapAt: 5,
    longestHiddenFrames: { a: 30, b: 0 }, longestHiddenAt: { a: 9, b: null } }

  test('passes at the limits and fails past them', () => {
    expect(duoContract.stretchSeconds * fps).toBe(ok.limitFrames)
    expect(framingVerdict(ok)).toEqual({ pass: true, problems: [] })
    expect(framingVerdict({ ...ok, outsideFrames: 1, firstOutside: [{ f: 3, label: 'b' }] }).pass).toBe(false)
    expect(framingVerdict({ ...ok, longestOverlapFrames: 31 }).pass).toBe(false)
    expect(framingVerdict({ ...ok, longestHiddenFrames: { a: 0, b: 31 } }).pass).toBe(false)
  })
})
