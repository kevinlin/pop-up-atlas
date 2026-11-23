import { expect, test } from 'vitest'
import { groveInFrame, walkCameraPose } from '../scripts/look-probe.mjs'
import { lookShots, walkCamera } from '../scripts/look-shots.mjs'
import {
  bloomCheck, characterRim, depthMap, frameStats, heroPropRim, lanternClearance, minSamples, pageUnchanged, pickVerdicts,
  pixelOwners, profiles, propFidelity, rigBoxes, rimLimits, rimOffURL, shippedVerdicts, summarizeVerdicts, trollFidelity, zoneHue,
} from '../scripts/look-stats.mjs'
import { planShot } from '../scripts/sbs.mjs'
import { createLayout } from '../src/world/layout.js'

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

// ---------------------------------------------------------------------------------------------------------------------
// Round 6: shipped profile
// ---------------------------------------------------------------------------------------------------------------------
const image = (width, height, paint) => {
  const rgba = new Uint8Array(width * height * 4)
  const mask = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [pixel, tag] = paint(x, y)
      rgba.set(pixel, 4 * (y * width + x))
      mask.set(tag, 4 * (y * width + x))
    }
  }
  return { rgba, mask }
}
const gray = (value) => [value, value, value, 255]

test('the six pinned look shots are duo shots at the walk camera, each staged on its recorded seed and pose', () => {
  expect(lookShots).toHaveLength(6)
  expect(walkCamera).toEqual([7.5, 35])
  expect(walkCameraPose).toEqual({ distance: 7.5, pitch: 35 })
  expect(new Set(lookShots.map(({ name }) => name)).size).toBe(6)
  for (const shot of lookShots) {
    expect(shot.cam).toEqual([7.5, 35])
    expect(shot.duo).toBe(true)
    expect(Number.isInteger(shot.seed)).toBe(true)
    expect([shot.x, shot.z, shot.heading].every(Number.isFinite)).toBe(true)
    const layout = createLayout(shot.seed)
    const { from, moveTo } = planShot(shot, layout)
    for (const point of [from, moveTo].filter(Boolean)) expect(layout.isBlocked(point.x, point.z)).toBe(false)
    if (shot.heroProp) expect(layout.getCell(shot.fold.i, shot.fold.j).id).toBe(shot.heroProp)
  }
  // At least two hero-prop fold shots, a bridge, a dance and a river for the rim, zone and fidelity checks.
  expect(lookShots.filter(({ heroProp }) => heroProp).map(({ heroProp }) => heroProp).sort()).toEqual(['cupcake_tree', 'mushroom_house'])
  expect(lookShots.some(({ model }) => model === 'yarn_bridge')).toBe(true)
  expect(lookShots.some(({ state }) => state === 'dance')).toBe(true)
})

test('the grove-in-frame test uses the walk camera by default and sees less than the old 10 / 45 view', () => {
  // Seed 0, three units short of the first grove along the front: the shorter, lower walk camera does not reach it.
  expect(groveInFrame(0, { x: -20, z: -3 }, 1280, 720)).toBe(false)
  expect(groveInFrame(0, { x: -20, z: -3 }, 1280, 720, { distance: 10, pitch: 45 })).toBe(true)
  expect(groveInFrame(0, { x: 8.5, z: -8 }, 1280, 720)).toBe(groveInFrame(0, { x: 8.5, z: -8 }, 1280, 720, walkCameraPose))
})

test('the shipped profile lists exactly the required verdicts and none of the stage ones', () => {
  expect(profiles).toEqual(['shipped', 'stage'])
  const names = Object.keys(shippedVerdicts)
  for (const required of ['10 Motes', '11 Lit emitters and halos', '11 Lantern clearance', '12 Bloom', '12 Emissive witness', '13 Fold flash',
    '2 Prop color fidelity', '2,3 Troll a hair fidelity', '2,3 Troll a body fidelity', '2,3 Troll b hair fidelity', '2,3 Troll b body fidelity',
    '2 Rim on characters', '2 Rim on hero props', '2 Page unchanged', '5 Zone hue']) {
    expect(names).toContain(required)
  }
  // Grade, rear key, bounce, zones-as-tint, moss, haze, backdrop, fronds and dapple are not evaluated.
  for (const stage of ['1 Grade', '1 Luma mean', '2 Highlight tint', '3 Shadow tint', '4 Hue window', '5 Exposed cream', '6 Top vs bottom',
    '6 Far prop saturation', '5 Sunlit moss contrast', '7 Dark foreground', '8 Dappled key contrast', '2 Felt rim visibility', '17 Backdrop gradient']) {
    expect(names).not.toContain(stage)
  }
  // Zone hue needs 5 passing shots of the 6; the others are judged on every shot that has the sample.
  expect(shippedVerdicts['5 Zone hue']).toMatchObject({ required: 5, min: 5 })
  expect(shippedVerdicts['2 Prop color fidelity'].required).toBe('all')
  const all = { '10 Motes': true, '5 Zone hue': true, '1 Grade': false, '8 Dappled key contrast': false }
  expect(pickVerdicts(all, 'shipped')).toEqual({ '10 Motes': true, '5 Zone hue': true })
  expect(pickVerdicts(all, 'stage')).toBe(all)
})

test('summarizeVerdicts: shipped passes only when every required verdict has its sample and passes', () => {
  const shot = (over = {}) => ({
    '10 Motes': true, '11 Lit emitters and halos': true, '11 Lantern clearance': true, '12 Bloom': true, '2 Prop color fidelity': true,
    '2,3 Troll a hair fidelity': true, '2,3 Troll a body fidelity': true, '2,3 Troll b hair fidelity': true, '2,3 Troll b body fidelity': true,
    '2 Rim on characters': true, '2 Rim on hero props': true, '2 Page unchanged': true, '5 Zone hue': true, ...over,
  })
  const singles = { '12 Emissive witness': true, '13 Fold flash': true }
  const six = Array.from({ length: 6 }, () => shot())
  expect(summarizeVerdicts(six, 'shipped', singles)).toMatchObject({ pass: true, failed: [] })

  // 5 of 6 zone shots pass: fine. 4 of 6: fails.
  const fifth = six.map((checks, i) => (i === 5 ? shot({ '5 Zone hue': false }) : checks))
  expect(summarizeVerdicts(fifth, 'shipped', singles).pass).toBe(true)
  const fourth = fifth.map((checks, i) => (i === 4 ? shot({ '5 Zone hue': false }) : checks))
  expect(summarizeVerdicts(fourth, 'shipped', singles)).toMatchObject({ pass: false, failed: ['5 Zone hue'] })

  // Fewer eligible shots than the check needs fails it (a null is a shot without its sample).
  const sparse = six.map((checks, i) => (i >= 2 ? shot({ '5 Zone hue': null }) : checks))
  expect(summarizeVerdicts(sparse, 'shipped', singles).bullets['5 Zone hue']).toMatchObject({ status: 'FAIL', measured: 2, min: 5 })
  // A rim check with all but two shots sampled still passes if the sampled ones pass, and fails if one does not.
  const rim = six.map((checks, i) => (i < 2 ? shot({ '2 Rim on hero props': null }) : checks))
  expect(summarizeVerdicts(rim, 'shipped', singles).bullets['2 Rim on hero props']).toMatchObject({ status: 'PASS', measured: 4 })
  const rimFail = rim.map((checks, i) => (i === 3 ? shot({ '2 Rim on hero props': false }) : checks))
  expect(summarizeVerdicts(rimFail, 'shipped', singles).failed).toEqual(['2 Rim on hero props'])
  // 'all' checks: any failing shot fails them.
  const fidelity = six.map((checks, i) => (i === 0 ? shot({ '2 Prop color fidelity': false }) : checks))
  expect(summarizeVerdicts(fidelity, 'shipped', singles).failed).toEqual(['2 Prop color fidelity'])
  // Witnesses: a missing or failed one fails.
  expect(summarizeVerdicts(six, 'shipped', { '12 Emissive witness': true, '13 Fold flash': false }).failed).toEqual(['13 Fold flash'])
  expect(summarizeVerdicts(six, 'shipped', { '12 Emissive witness': true }).failed).toEqual(['13 Fold flash'])
  // A shipped verdict that was never measured fails (never N/A).
  expect(summarizeVerdicts(six.map(({ '10 Motes': _, ...rest }) => rest), 'shipped', singles).failed).toEqual(['10 Motes'])
  // A stage-only verdict in the per-shot results is ignored by the shipped summary.
  expect(summarizeVerdicts(six.map((checks) => ({ ...checks, '1 Grade': false })), 'shipped', singles).pass).toBe(true)
})

test('summarizeVerdicts: the stage profile keeps the round-4 rules (5 shots, N/A when unmeasured)', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ '1 Grade': i < 5, '7 Dark foreground': null, '2 Prop color fidelity': true }))
  const { bullets, pass } = summarizeVerdicts(six, 'stage', { '17 Backdrop gradient': true })
  expect(bullets['1 Grade']).toMatchObject({ status: 'PASS', passed: 5, required: 5 })
  expect(bullets['7 Dark foreground'].status).toBe('N/A')
  expect(bullets['2 Prop color fidelity']).toMatchObject({ status: 'PASS', required: 6 })
  expect(bullets['17 Backdrop gradient']).toMatchObject({ status: 'PASS', measured: 1 })
  expect(pass).toBe(true)
  six[5]['2 Prop color fidelity'] = false
  expect(summarizeVerdicts(six, 'stage').failed).toEqual(['2 Prop color fidelity'])
})

test('bloomCheck: at most 4 % bloom and no cream in it', () => {
  expect(bloomCheck({ bloomShare: 3, creamBloomShare: 0 })).toBe(true)
  expect(bloomCheck({ bloomShare: 4.5, creamBloomShare: 0 })).toBe(false)
  expect(bloomCheck({ bloomShare: 1, creamBloomShare: 0.1 })).toBe(false)
  expect(bloomCheck({ bloomShare: null, creamBloomShare: null })).toBeNull()
})

test('the rim-off URL adds rim to the URL\'s own lookOff list, or to the shipped default', () => {
  expect(rimOffURL('http://x/?seed=1').searchParams.get('lookOff')).toBe('grade,backlight,bounce,zones,haze,backdrop,dapple,rim')
  expect(rimOffURL('http://x/?lookOff=grade,bloom').searchParams.get('lookOff')).toBe('grade,bloom,rim')
  expect(rimOffURL('http://x/?lookOff=rim').searchParams.get('lookOff')).toBe('rim')
  expect(rimOffURL('http://x/?seed=1').searchParams.get('seed')).toBe('1')
})

test('depthMap counts pixels in from the nearest unselected pixel, capped at the interior band', () => {
  const width = 20, height = 20
  const selected = new Uint8Array(width * height)
  for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) selected[y * width + x] = 1
  const depth = depthMap(selected, width, height)
  expect(depth[4 * width + 4]).toBe(1)
  expect(depth[5 * width + 7]).toBe(2)
  expect(depth[7 * width + 7]).toBe(4)
  expect(depth[9 * width + 9]).toBe(rimLimits.interiorBand)
  expect(depth[0]).toBe(0)
  // A silhouette cut by the frame has no edge there.
  const cut = new Uint8Array(width * height).fill(1)
  expect(Math.max(...depthMap(cut, width, height))).toBe(rimLimits.interiorBand)
  expect(Math.min(...depthMap(cut, width, height))).toBe(rimLimits.interiorBand)
})

test('pixel owners follow the projected boxes: a pixel in both boxes belongs to neither', () => {
  const owners = pixelOwners(10, 4, { a: [0, 0, 6, 4], b: [4, 0, 10, 4] })
  expect([owners[0], owners[5], owners[9]]).toEqual([1, 0, 2])
  expect(rigBoxes([[1], [2]], 'a')).toEqual({ a: [1], b: [2] })
  expect(rigBoxes([[1], [2]], 'b')).toEqual({ b: [1], a: [2] })
  expect(rigBoxes([[1]], 'b')).toEqual({ b: [1] })
})

// Two 50x50 squares (2,500 px each) of body surface on a plain background; the edge ring (3 px) of each is lit by `edge`.
const twoCharacters = (edgeA, edgeB) => {
  const width = 140, height = 70
  const at = (x, y) => (x >= 10 && x < 60 && y >= 10 && y < 60 ? ['a', x - 10, y - 10] : x >= 80 && x < 130 && y >= 10 && y < 60 ? ['b', x - 80, y - 10] : null)
  const { rgba, mask } = image(width, height, (x, y) => {
    const hit = at(x, y)
    if (!hit) return [gray(30), [0, 0, 0, 255]]
    const [who, px, py] = hit
    const ring = Math.min(px, py, 49 - px, 49 - py) < 3
    return [gray(ring ? (who === 'a' ? edgeA : edgeB) : 100), [0, 0, 9, 255]]
  })
  return { width, height, rgba, mask, boxes: { a: [10, 10, 60, 60], b: [80, 10, 130, 60] } }
}

test('character rim: edge mean >= 1.15x the interior, per character with a 1,500 px mask', () => {
  const lit = twoCharacters(125, 125)
  const result = characterRim(lit.rgba, lit.mask, lit.width, lit.height, lit.boxes)
  expect(result.passed).toBe(true)
  expect(result.rigs.a).toMatchObject({ eligible: true, passed: true })
  expect(result.rigs.a.ratio).toBeCloseTo(1.25)
  expect(result.rigs.a.pixels).toBe(2500)
  // One character without its rim fails the shot.
  const flat = twoCharacters(125, 100)
  const one = characterRim(flat.rgba, flat.mask, flat.width, flat.height, flat.boxes)
  expect(one.rigs.b).toMatchObject({ eligible: true, passed: false })
  expect(one.passed).toBe(false)
  // A character with fewer than 1,500 mask pixels has no sample; no sampled character: null.
  const small = characterRim(lit.rgba, lit.mask, lit.width, lit.height, { a: [10, 10, 40, 40], b: [200, 0, 210, 10] })
  expect(small.rigs.a.eligible).toBe(false)
  expect(small.rigs.a.pixels).toBeLessThan(minSamples.characterPixels)
  expect(small.passed).toBeNull()
})

const heroProps = (edge, size = 40) => {
  const width = 80, height = 80
  const { rgba, mask } = image(width, height, (x, y) => {
    const inside = x >= 10 && x < 10 + size && y >= 10 && y < 10 + size
    if (!inside) return [gray(30), [0, 0, 0, 255]]
    const ring = Math.min(x - 10, y - 10, 10 + size - 1 - x, 10 + size - 1 - y) < 3
    return [gray(ring ? edge : 100), [0, 0, 4, 255]]
  })
  return { width, height, rgba, mask }
}

test('hero prop rim: >= 1.10x the interior and >= 1.05x the same edge with the rim off, with an 800 px mask', () => {
  const on = heroProps(120)
  const off = heroProps(100)
  const result = heroPropRim(on.rgba, off.rgba, on.mask, on.width, on.height)
  expect(result).toMatchObject({ eligible: true, passed: true })
  expect(result.ratio).toBeCloseTo(1.2)
  expect(result.ratioVsOff).toBeCloseTo(1.2)
  // Bright already without the rim (e.g. a lit edge): the interior ratio holds, the rim-off ratio does not.
  const alreadyLit = heroPropRim(on.rgba, heroProps(118).rgba, on.mask, on.width, on.height)
  expect(alreadyLit.ratio).toBeGreaterThan(1.1)
  expect(alreadyLit.passed).toBe(false)
  // No rim at all.
  expect(heroPropRim(off.rgba, off.rgba, off.mask, off.width, off.height).passed).toBe(false)
  // Too small a mask: no sample.
  const tiny = heroProps(120, 20)
  expect(heroPropRim(tiny.rgba, tiny.rgba, tiny.mask, tiny.width, tiny.height)).toMatchObject({ eligible: false, passed: null })
  expect(minSamples.heroPropPixels).toBe(800)
})

test('page unchanged: mean |delta luma| of cream page pixels against the rim-off frame is at most 1', () => {
  const width = 10, height = 10
  const { mask } = image(width, height, (x) => [gray(0), [x < 5 ? 255 : 0, 0, 0, 255]])
  const frame = (value, rest) => image(width, height, (x) => [gray(x < 5 ? value : rest), [0, 0, 0, 255]]).rgba
  expect(pageUnchanged(frame(200, 0), frame(200, 90), mask, width, height)).toMatchObject({ pixels: 50, meanDelta: 0, passed: true })
  expect(pageUnchanged(frame(200.9, 0), frame(200, 0), mask, width, height).passed).toBe(true)
  const shifted = pageUnchanged(frame(203, 0), frame(200, 0), mask, width, height)
  expect(shifted.meanDelta).toBeCloseTo(3)
  expect(shifted.passed).toBe(false)
  expect(pageUnchanged(frame(0, 0), frame(0, 0), new Uint8Array(width * height * 4), width, height)).toMatchObject({ eligible: false, passed: null })
})

test('zone hue: one 60 degree window holds at least 60 % of the saturated hero and flat prop pixels, with 2,000 of them', () => {
  const width = 100, height = 50
  const paint = (colors, tag = 4) => image(width, height, (x, y) => [colors((y * width + x) % colors.length === 0 ? 0 : 1, x, y), [0, 0, tag, 255]])
  // Pink-violet: hues 300 and 330 (inside one window).
  const pinkViolet = paint((n) => (n ? [220, 40, 160, 255] : [160, 40, 220, 255]))
  expect(zoneHue(pinkViolet.rgba, pinkViolet.mask, width, height)).toMatchObject({ eligible: true, eligiblePixels: 5000, passed: true })
  // Rainbow: hues spread over the wheel.
  const wheel = [[220, 40, 40], [220, 220, 40], [40, 220, 40], [40, 220, 220], [40, 40, 220], [220, 40, 220]]
  const rainbow = image(width, height, (x, y) => [[...wheel[(x + y) % 6], 255], [0, 0, 6, 255]])
  const spread = zoneHue(rainbow.rgba, rainbow.mask, width, height)
  expect(spread.eligible).toBe(true)
  expect(spread.windowShare).toBeLessThan(60)
  expect(spread.passed).toBe(false)
  // Flat props count too; other tags (character 8, bridge rail, page) and desaturated or dark pixels do not.
  const flat = paint(() => [220, 40, 160, 255], 6)
  expect(zoneHue(flat.rgba, flat.mask, width, height).eligiblePixels).toBe(5000)
  for (const tag of [8, 9, 0, 3]) {
    const other = paint(() => [220, 40, 160, 255], tag)
    expect(zoneHue(other.rgba, other.mask, width, height)).toMatchObject({ eligiblePixels: 0, eligible: false, passed: null })
  }
  const grey = paint(() => [120, 110, 115, 255])
  expect(zoneHue(grey.rgba, grey.mask, width, height).eligiblePixels).toBe(0)
  const dark = paint(() => [40, 5, 30, 255])
  expect(zoneHue(dark.rgba, dark.mask, width, height).eligiblePixels).toBe(0)
  // Fewer than 2,000 eligible pixels: the shot is excluded.
  const small = image(30, 50, () => [[220, 40, 160, 255], [0, 0, 4, 255]])
  expect(zoneHue(small.rgba, small.mask, 30, 50)).toMatchObject({ eligiblePixels: 1500, eligible: false, passed: null })
  expect(minSamples.zonePixels).toBe(2000)
})

test('troll fidelity per character measures each rig on its own box and skips a rig without a 1,500 px mask', () => {
  const { width, height, mask, boxes } = twoCharacters(100, 100)
  const reference = twoCharacters(100, 100).rgba
  const colour = new Uint8Array(reference)
  for (let i = 0; i < width * height; i++) if (mask[4 * i + 2] === 9) colour.set([200, 60, 60, 255], 4 * i)
  const refColour = new Uint8Array(colour)
  const measured = trollFidelity(refColour, refColour, mask, mask, width, height, { boxes })
  expect(measured.a).toMatchObject({ eligible: true, pixels: 2500 })
  expect(measured.a.body).toMatchObject({ passed: true, comparedPixels: 2500 })
  // The hair layer has no pixels here: no sample, no verdict.
  expect(measured.a.hair.comparedPixels).toBe(0)
  // A keeps its felt colour, B turns to charcoal.
  const faded = new Uint8Array(refColour)
  for (let y = 10; y < 60; y++) for (let x = 80; x < 130; x++) faded.set([55, 55, 55, 255], 4 * (y * width + x))
  const split = trollFidelity(faded, refColour, mask, mask, width, height, { boxes })
  expect(split.a.body.passed).toBe(true)
  expect(split.b.body.passed).toBe(false)
  // A box that holds fewer than 1,500 mask pixels: no sample.
  const small = trollFidelity(faded, refColour, mask, mask, width, height, { boxes: { a: [10, 10, 30, 30], b: boxes.b } })
  expect(small.a).toMatchObject({ eligible: false })
  expect(small.a.body.passed).toBeNull()
  // Without boxes the old whole-frame shape is unchanged.
  expect(Object.keys(trollFidelity(faded, refColour, mask, mask, width, height))).toEqual(['hair', 'body'])
})
