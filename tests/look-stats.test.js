import { expect, test } from 'vitest'
import { frameStats, lanternClearance, propFidelity, trollFidelity } from '../scripts/look-stats.mjs'

test('lantern clearance counts projected overlap and the bottom quarter independently', () => {
  const width = 5, height = 8
  const mask = new Uint8Array(width * height)
  const bounds = [1.4, 4.4, 3.5, 6.5]
  for (const [x, y] of [[3, 4], [2, 6], [0, 7], [0, 5], [4, 4]]) mask[y * width + x] = 1
  expect(lanternClearance(mask, width, height, bounds)).toEqual({
    visible: 5, insideTroll: 2, bottomQuarter: 2, passed: false,
  })
  mask[4 * width + 3] = mask[6 * width + 2] = mask[7 * width] = 0
  expect(lanternClearance(mask, width, height, bounds)).toEqual({
    visible: 2, insideTroll: 0, bottomQuarter: 0, passed: true,
  })
})

test('lantern clearance covers the leader and the follower, not the space between them', () => {
  const width = 10, height = 8
  const mask = new Uint8Array(width * height)
  const trolls = [[1, 1, 3, 5], [6, 1, 8, 5]]
  mask[2 * width + 7] = 1 // inside the follower only
  mask[2 * width + 2] = 1 // inside the leader only
  mask[2 * width + 4] = 1 // in the gap between them: allowed
  expect(lanternClearance(mask, width, height, trolls)).toEqual({
    visible: 3, insideTroll: 2, bottomQuarter: 0, passed: false,
  })
  expect(lanternClearance(mask, width, height, trolls[0]).insideTroll).toBe(1)
  mask[2 * width + 7] = mask[2 * width + 2] = 0
  expect(lanternClearance(mask, width, height, trolls)).toEqual({
    visible: 1, insideTroll: 0, bottomQuarter: 0, passed: true,
  })
})

test('frame statistics use Rec.709, HSV and measured pixel masks', () => {
  const rgba = Uint8Array.from([
    255, 255, 255, 255, 255, 0, 4, 255,
    255, 4, 0, 255, 0, 0, 0, 255,
    0, 64, 0, 255, 20, 20, 20, 255,
  ])
  const mask = Uint8Array.from([
    255, 0, 3, 255, 0, 255, 1, 255,
    0, 0, 2, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 0, 0, 3, 255,
  ])
  const stats = frameStats(rgba, 2, 3, { mask, groveInFrame: true })
  expect(stats.lumaMean).toBeCloseTo(72.0580667)
  expect(stats.lumaP95).toBeCloseTo(255)
  expect(stats.above230).toBeCloseTo(100 / 6)
  expect(stats.below40).toBeCloseTo(200 / 6)
  expect(stats.saturationMean).toBeCloseTo(0.5)
  expect(stats.hueWindowShare).toBeCloseTo(200 / 3)
  expect(stats.topMinusBottom).toBeCloseTo(121.8645)
  expect(stats.highlightTint).toBe('#ffffff')
  expect(stats.shadowTint).toBe('#000000')
  expect(stats.exposedCreamShare).toBeCloseTo(100 / 6)
  expect(stats.bloomShare).toBeCloseTo(100 / 6)
  expect(stats.creamBloomShare).toBe(0)
  expect(stats.farSaturationDrop).toBe(0)
  expect(stats.backdropTopMinusBottom).toBeCloseTo(235)
})

test('a frame without saturated pixels or masks reports unavailable measurements', () => {
  const stats = frameStats(Uint8Array.of(40, 40, 40, 255), 1, 1)
  expect(stats.hueWindowShare).toBeNull()
  expect(stats.bloomShare).toBeNull()
  expect(stats.exposedCreamShare).toBeNull()
})

test('prop fidelity compares circular hue and rejects contiguous desaturation', () => {
  const repeat = (pixel, count) => Uint8Array.from(Array.from({ length: count }, () => pixel).flat())
  const ref = repeat([200, 28, 40, 255], 16)
  const mask = repeat([0, 0, 4, 255], 16)
  const colored = repeat([160, 31, 24, 255], 16)
  const matching = propFidelity(colored, ref, mask, mask, 4, 4)
  expect(matching.passed).toBe(true)
  expect(matching.hueDifference).toBeLessThan(10)
  expect(matching.lumaRatio).toBeGreaterThan(0.6)

  const charcoal = repeat([55, 55, 55, 255], 16)
  const faded = propFidelity(charcoal, ref, mask, mask, 4, 4)
  expect(faded.passed).toBe(false)
  expect(faded.largestDesaturatedRegion).toBe(16)
})

test('prop fidelity ignores non-prop pixels and reports isolated edge pixels', () => {
  const ref = Uint8Array.from([180, 0, 20, 255, 180, 0, 20, 255, 180, 0, 20, 255])
  const current = Uint8Array.from([180, 0, 25, 255, 55, 55, 55, 255, 55, 55, 55, 255])
  const mask = Uint8Array.from([0, 0, 4, 255, 255, 0, 0, 255, 0, 0, 4, 255])
  const result = propFidelity(current, ref, mask, mask, 3, 1)
  expect(result.comparedPixels).toBe(2)
  expect(result.desaturatedPixels).toBe(1)
  expect(result.largestDesaturatedRegion).toBe(1)
})

test('troll fidelity measures hair and body independently on matching visible surfaces', () => {
  const pixels = (makePixel) => Uint8Array.from(Array.from({ length: 24 }, (_, i) => makePixel(i)).flat())
  const ref = pixels((i) => i < 12 ? [178, 35, 93, 255] : [95, 172, 125, 255])
  const current = pixels((i) => i < 12 ? [33, 34, 32, 255] : [80, 137, 103, 255])
  const mask = pixels((i) => [0, 0, i < 12 ? 8 : 9, 255])
  const refMask = mask.slice()
  refMask[2] = 0
  const { hair, body } = trollFidelity(current, ref, mask, refMask, 4, 6)
  expect(hair).toMatchObject({ comparedPixels: 11, largestDesaturatedRegion: 11, passed: false })
  expect(hair.lumaRatio).toBeLessThan(0.6)
  expect(body).toMatchObject({ comparedPixels: 12, largestDesaturatedRegion: 0, passed: true })
  expect(body.hueDifference).toBeLessThan(15)
})
