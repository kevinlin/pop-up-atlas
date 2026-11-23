import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { stageFlags } from '../src/effects/flags.js'
import { DEFAULT_LOOK_OFF, look, lookFlags } from '../src/materials/stage-look.js'
import { createSteppedPage, launchChromium, previewURL, writeJson } from './capture.mjs'
import {
  addBloomWitness, characterLayers, groveInFrame, installLookProbe, readFoldFlash, readStageEffects, readStageLighting,
} from './look-probe.mjs'
import { lookShots } from './look-shots.mjs'
import { compareStills, compareTrollStills, shots, takeShot } from './sbs.mjs'

const viewport = { width: 1280, height: 720 }
const clearanceCheck = '11 Lantern clearance'
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const hex = (rgb) => '#' + rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')
const share = (count, total) => total ? 100 * count / total : null
const hue = (r, g, b, max, chroma) => {
  const sector = max === r ? (g - b) / chroma : max === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma
  return (60 * sector + 360) % 360
}

function largestRegion(pixels, width) {
  let largest = 0
  const queue = []
  for (let i = 0; i < pixels.length; i++) {
    if (!pixels[i]) continue
    pixels[i] = 0
    queue.push(i)
    for (let head = 0; head < queue.length; head++) {
      const pixel = queue[head]
      const x = pixel % width
      const neighbors = [pixel - width, pixel + width, x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1]
      for (const next of neighbors) {
        if (!pixels[next]) continue
        pixels[next] = 0
        queue.push(next)
      }
    }
    largest = Math.max(largest, queue.length)
    queue.length = 0
  }
  return largest
}

function surfaceFidelity(current, reference, currentMask, referenceMask, width, height, includesLayer) {
  // `includesLayer(layer, pixel)`: the pixel index lets a caller restrict the surface to one character's projected box.
  const count = width * height
  assert.ok(count && [current, reference, currentMask, referenceMask].every((buffer) => buffer.length === 4 * count))
  const ratios = [], differences = []
  const desaturated = new Uint8Array(count)
  let comparedPixels = 0, desaturatedPixels = 0
  for (let i = 0; i < count; i++) {
    const p = 4 * i
    const layer = currentMask[p + 2]
    if (!includesLayer(layer, i) || referenceMask[p + 2] !== layer) continue
    comparedPixels++
    const r = current[p], g = current[p + 1], b = current[p + 2]
    const a = reference[p], j = reference[p + 1], k = reference[p + 2]
    const max = Math.max(r, g, b), refMax = Math.max(a, j, k)
    const chroma = max - Math.min(r, g, b), refChroma = refMax - Math.min(a, j, k)
    if (refMax > 0) ratios.push(luma(r, g, b) / luma(a, j, k))
    if (refChroma > 0) {
      const difference = chroma ? Math.abs(hue(r, g, b, max, chroma) - hue(a, j, k, refMax, refChroma)) : 180
      differences.push(Math.min(difference, 360 - difference))
    }
    if (refChroma > 0.5 * refMax && (max === 0 || chroma < 0.25 * max)) {
      desaturated[i] = 1
      desaturatedPixels++
    }
  }
  const median = (values) => {
    if (!values.length) return null
    values.sort((a, b) => a - b)
    return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2
  }
  const hueDifference = median(differences)
  const lumaRatio = median(ratios)
  const largestDesaturatedRegion = largestRegion(desaturated, width)
  // A connected nine-pixel region spans more than a thin rasterization edge.
  const passed = hueDifference !== null && hueDifference <= 15 && lumaRatio !== null && lumaRatio >= 0.6
    && largestDesaturatedRegion < 9
  return { comparedPixels, hueDifference, lumaRatio, desaturatedPixels, largestDesaturatedRegion, passed }
}

export function propFidelity(current, reference, currentMask, referenceMask, width, height) {
  return surfaceFidelity(current, reference, currentMask, referenceMask, width, height,
    (layer) => layer === 1 || layer === 2 || layer === 4 || layer === 5 || layer === 6)
}

// Hair and body fidelity of the characters. Without `boxes` the two surfaces are measured over the whole frame (both
// characters together, through round 5). With `boxes` ({a: [left, top, right, bottom], b: ...} in top-down pixel rows, from
// the probe's projected bounds) each character is measured on its own: a pixel counts for the one character whose box holds
// it (a pixel in both boxes counts for neither), and a character whose mask covers fewer than `minPixels` pixels has no
// sample (`eligible: false`, `passed: null` on both parts).
export function trollFidelity(current, reference, currentMask, referenceMask, width, height, { boxes, minPixels = minSamples.characterPixels } = {}) {
  const measure = (owner) => Object.fromEntries(Object.entries(characterLayers).map(([part, layer]) => [
    part, surfaceFidelity(current, reference, currentMask, referenceMask, width, height,
      (value, i) => value === layer && (owner === undefined || owners[i] === owner)),
  ]))
  if (!boxes) return measure(undefined)
  const owners = pixelOwners(width, height, boxes)
  const rigs = {}
  for (const [who, code] of [['a', 1], ['b', 2]]) {
    const pixels = countCharacterPixels(currentMask, owners, code)
    const parts = measure(code)
    const eligible = pixels >= minPixels
    rigs[who] = { eligible, pixels, ...Object.fromEntries(Object.entries(parts).map(([part, result]) => [
      part, eligible ? result : { ...result, passed: null },
    ])) }
  }
  return rigs
}

// Minimum samples of the shipped-profile checks (docs/contracts.md "Round 6" → Light, ground and props): a check without
// its sample on a shot excludes that shot.
export const minSamples = { characterPixels: 1500, heroPropPixels: 800, zonePixels: 2000 }
// Rim, page and zone limits of the same section.
export const rimLimits = { character: 1.15, heroProp: 1.10, heroPropVsOff: 1.05, pageDelta: 1, edgeBand: 3, interiorBand: 6, zoneWindowShare: 60 }

// Which character owns each pixel, by the probe's projected boxes: 1 = a, 2 = b, 0 = neither or both.
export function pixelOwners(width, height, boxes) {
  const owners = new Uint8Array(width * height)
  const inside = (box, x, y) => Boolean(box) && x + 0.5 >= box[0] && x + 0.5 <= box[2] && y + 0.5 >= box[1] && y + 0.5 <= box[3]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = inside(boxes.a, x, y)
      const b = inside(boxes.b, x, y)
      owners[y * width + x] = a === b ? 0 : a ? 1 : 2
    }
  }
  return owners
}

// The probe lists the leader's box first; `leader` ('a' | 'b') says which rig that is.
export function rigBoxes(trollBounds, leader = 'a') {
  const follower = leader === 'a' ? 'b' : 'a'
  return { [leader]: trollBounds[0], ...(trollBounds[1] && { [follower]: trollBounds[1] }) }
}

function countCharacterPixels(mask, owners, owner) {
  let count = 0
  for (let i = 0; i < owners.length; i++) {
    const layer = mask[4 * i + 2]
    if (owners[i] === owner && (layer === characterLayers.hair || layer === characterLayers.body)) count++
  }
  return count
}

const lumaPlane = (rgba) => {
  const plane = new Float32Array(rgba.length / 4)
  for (let i = 0; i < plane.length; i++) plane[i] = luma(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2])
  return plane
}

// Chebyshev depth of each selected pixel from the nearest unselected pixel (1 = touching one), capped at `cap`; pixels
// beyond the frame count as selected, so a silhouette cut by the frame has no edge there.
export function depthMap(selected, width, height, cap = rimLimits.interiorBand) {
  const depth = new Uint8Array(selected.length)
  const neighbours = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) neighbours.push([dx, dy])
  let frontier = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!selected[i]) continue
      const touching = neighbours.some(([dx, dy]) => {
        const nx = x + dx
        const ny = y + dy
        return nx >= 0 && ny >= 0 && nx < width && ny < height && !selected[ny * width + nx]
      })
      if (touching) {
        depth[i] = 1
        frontier.push(i)
      }
    }
  }
  for (let level = 1; level < cap; level++) {
    const next = []
    for (const i of frontier) {
      const x = i % width
      const y = Math.floor(i / width)
      for (const [dx, dy] of neighbours) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const n = ny * width + nx
        if (selected[n] && !depth[n]) {
          depth[n] = level + 1
          next.push(n)
        }
      }
    }
    frontier = next
  }
  for (let i = 0; i < selected.length; i++) if (selected[i] && !depth[i]) depth[i] = cap
  return depth
}

// Mean luma of the pixels within `edgeBand` of the selection's edge against the mean of those at least `interiorBand` inside.
// With `off` (the luma plane of the same pose with the rim off) it also gives the same edge pixels' mean there.
export function rimStats(plane, selected, width, height, off) {
  const depth = depthMap(selected, width, height)
  let pixels = 0, edge = 0, interior = 0, edgeSum = 0, interiorSum = 0, offSum = 0
  for (let i = 0; i < selected.length; i++) {
    if (!selected[i]) continue
    pixels++
    if (depth[i] <= rimLimits.edgeBand) {
      edge++
      edgeSum += plane[i]
      if (off) offSum += off[i]
    } else if (depth[i] >= rimLimits.interiorBand) {
      interior++
      interiorSum += plane[i]
    }
  }
  const edgeMean = edge ? edgeSum / edge : null
  const interiorMean = interior ? interiorSum / interior : null
  return { pixels, edgePixels: edge, interiorPixels: interior, edgeMean, interiorMean,
    ratio: edgeMean !== null && interiorMean ? edgeMean / interiorMean : null,
    ratioVsOff: off && edge && offSum ? edgeSum / offSum : null }
}

// Rim on the characters: per character with a mask of at least 1,500 pixels, edge mean >= 1.15x interior mean. The overall
// result is null when no character has its sample.
export function characterRim(rgba, mask, width, height, boxes) {
  const plane = lumaPlane(rgba)
  const owners = pixelOwners(width, height, boxes)
  const rigs = {}
  for (const [who, code] of [['a', 1], ['b', 2]]) {
    const selected = new Uint8Array(width * height)
    for (let i = 0; i < selected.length; i++) {
      const layer = mask[4 * i + 2]
      selected[i] = Number(owners[i] === code && (layer === characterLayers.hair || layer === characterLayers.body))
    }
    const stats = rimStats(plane, selected, width, height)
    const eligible = stats.pixels >= minSamples.characterPixels && stats.ratio !== null
    rigs[who] = { ...stats, eligible, passed: eligible ? stats.ratio >= rimLimits.character : null }
  }
  const measured = Object.values(rigs).filter(({ eligible }) => eligible)
  return { rigs, passed: measured.length ? measured.every(({ passed }) => passed) : null }
}

// Rim on the hero props (tag hero prop, mask of at least 800 pixels): edge mean >= 1.10x interior and >= 1.05x the same edge
// pixels in the rim-off frame.
export function heroPropRim(rgba, rgbaOff, mask, width, height) {
  const selected = new Uint8Array(width * height)
  for (let i = 0; i < selected.length; i++) {
    const layer = mask[4 * i + 2]
    selected[i] = Number(layer === 1 || layer === 2 || layer === 4)
  }
  const stats = rimStats(lumaPlane(rgba), selected, width, height, lumaPlane(rgbaOff))
  const eligible = stats.pixels >= minSamples.heroPropPixels && stats.ratio !== null && stats.ratioVsOff !== null
  return { ...stats, eligible,
    passed: eligible ? stats.ratio >= rimLimits.heroProp && stats.ratioVsOff >= rimLimits.heroPropVsOff : null }
}

// The cream page against the same pose with `rim` added to the default lookOff list: mean |delta luma| <= 1.
export function pageUnchanged(rgba, rgbaOff, mask, width, height) {
  let pixels = 0
  let sum = 0
  for (let i = 0; i < width * height; i++) {
    if (mask[4 * i] !== 255) continue
    pixels++
    sum += Math.abs(luma(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]) - luma(rgbaOff[4 * i], rgbaOff[4 * i + 1], rgbaOff[4 * i + 2]))
  }
  const meanDelta = pixels ? sum / pixels : null
  return { pixels, meanDelta, eligible: pixels > 0, passed: pixels ? meanDelta <= rimLimits.pageDelta : null }
}

// Zone colour sets: among the saturated (s > 0.35, v > 0.2) pixels tagged hero or flat prop (bridges, river, characters,
// lanterns, page, gutter and table carry other tags), >= 60 % lie in one 60 degree hue window. A shot with fewer than
// 2,000 eligible pixels has no sample.
export function zoneHue(rgba, mask, width, height) {
  const hues = []
  for (let i = 0; i < width * height; i++) {
    const layer = mask[4 * i + 2]
    if (layer !== 1 && layer !== 2 && layer !== 4 && layer !== 6) continue
    const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2]
    const max = Math.max(r, g, b)
    const chroma = max - Math.min(r, g, b)
    if (!max || chroma / max <= 0.35 || max / 255 <= 0.2) continue
    hues.push(hue(r, g, b, max, chroma))
  }
  const eligible = hues.length >= minSamples.zonePixels
  const windowShare = eligible ? bestHueWindow(hues) : null
  return { eligiblePixels: hues.length, eligible, windowShare, passed: eligible ? windowShare >= rimLimits.zoneWindowShare : null }
}

// trollBounds is one [left, top, right, bottom] box or a list of them (leader and follower); a pixel is inside
// the troll when it is inside any box.
export function lanternClearance(mask, width, height, trollBounds) {
  assert.equal(mask.length, width * height)
  const boxes = typeof trollBounds[0] === 'number' ? [trollBounds] : trollBounds
  let visible = 0
  let insideTroll = 0
  let bottomQuarter = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      visible++
      if (boxes.some(([left, top, right, bottom]) =>
        x + 0.5 >= left && x + 0.5 <= right && y + 0.5 >= top && y + 0.5 <= bottom)) insideTroll++
      if (y + 0.5 >= 0.75 * height) bottomQuarter++
    }
  }
  return { visible, insideTroll, bottomQuarter, passed: insideTroll === 0 && bottomQuarter === 0 }
}

function trollCrop(mask, { width, height }) {
  let left = width, right = 0, top = height, bottom = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const part = mask[4 * (y * width + x) + 2]
      if (part !== characterLayers.hair && part !== characterLayers.body) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  assert.ok(right > left && bottom > top, 'The troll crop needs a visible character mask')
  const size = Math.max(right - left, bottom - top) + 24
  return [Math.round((left + right - size) / 2), Math.round((top + bottom - size) / 2), size, size]
}

function tint(rgba, levels, count, cutoff, darkest) {
  const rgb = [0, 0, 0]
  const tied = [0, 0, 0]
  let included = 0
  let ties = 0
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] === cutoff) {
      ties++
      for (let channel = 0; channel < 3; channel++) tied[channel] += rgba[4 * i + channel]
    } else if (darkest ? levels[i] < cutoff : levels[i] > cutoff) {
      included++
      for (let channel = 0; channel < 3; channel++) rgb[channel] += rgba[4 * i + channel]
    }
  }
  const tieWeight = ties ? (count - included) / ties : 0
  return hex(rgb.map((sum, channel) => (sum + tieWeight * tied[channel]) / count))
}

function bestHueWindow(hues) {
  hues.sort((a, b) => a - b)
  let end = 0
  let best = 0
  for (let start = 0; start < hues.length; start++) {
    while (end < start + hues.length
      && hues[end % hues.length] + (end >= hues.length ? 360 : 0) - hues[start] < 60) end++
    best = Math.max(best, end - start)
  }
  return share(best, hues.length)
}

export function frameStats(rgba, width, height, { mask, groveInFrame = false } = {}) {
  const count = width * height
  assert.ok(count && rgba.length === 4 * count && (!mask || mask.length === rgba.length))
  const levels = new Float64Array(count)
  const hues = []
  const bands = Array.from({ length: 3 }, () => ({ sum: 0, count: 0, backdrop: 0, backdropCount: 0 }))
  const props = [{ sum: 0, count: 0 }, { sum: 0, count: 0 }]
  let lumaSum = 0
  let satSum = 0
  let bright = 0
  let dark = 0
  let cream = 0
  let bloom = 0
  let creamBloom = 0
  for (let i = 0; i < count; i++) {
    const offset = i * 4
    const r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2]
    const gray = luma(r, g, b)
    const min = Math.min(r, g, b), max = Math.max(r, g, b)
    const chroma = max - min
    const sat = max ? chroma / max : 0
    levels[i] = gray
    lumaSum += gray
    satSum += sat
    if (gray > 230) bright++
    if (gray < 40) dark++
    if (sat > 0.35 && max > 51) {
      hues.push(hue(r, g, b, max, chroma))
    }
    const y = Math.floor(i / width)
    const band = bands[Math.floor(3 * y / height)]
    band.sum += gray
    band.count++
    const isCream = mask ? mask[offset] === 255 : r >= 177 && r >= g && g >= b
      && sat >= 0.07 && sat <= 0.29 && g >= 0.87 * r && g - b >= r - g
    const isBloom = mask?.[offset + 1] === 255
    if (isCream) cream++
    if (isBloom) bloom++
    if (isCream && isBloom) creamBloom++
    const layer = mask?.[offset + 2]
    if (layer === 1 || layer === 2) {
      props[layer - 1].sum += sat
      props[layer - 1].count++
    }
    if (layer === 3) {
      band.backdrop += gray
      band.backdropCount++
    }
  }
  const sorted = levels.slice().sort()
  const percentile = (fraction) => sorted[Math.ceil(fraction * count) - 1]
  const bandMean = (i) => bands[i].count ? bands[i].sum / bands[i].count : null
  const backdropMean = (i) => bands[i].backdrop / bands[i].backdropCount
  const [focus, far] = props
  return {
    lumaMean: lumaSum / count,
    lumaP95: percentile(0.95),
    above230: share(bright, count),
    below40: share(dark, count),
    saturationMean: satSum / count,
    hueWindowShare: bestHueWindow(hues),
    topMinusBottom: bandMean(2) === null ? null : bandMean(0) - bandMean(2),
    highlightTint: tint(rgba, levels, Math.ceil(count * 0.05), sorted[count - Math.ceil(count * 0.05)], false),
    shadowTint: tint(rgba, levels, Math.ceil(count * 0.10), percentile(0.10), true),
    bloomShare: mask ? share(bloom, count) : null,
    creamBloomShare: mask ? share(creamBloom, count) : null,
    exposedCreamShare: groveInFrame ? share(cream, count) : null,
    farSaturationDrop: focus.sum && far.count ? 100 * (1 - (far.sum / far.count) / (focus.sum / focus.count)) : null,
    backdropTopMinusBottom: bands[0].backdropCount && bands[2].backdropCount ? backdropMean(0) - backdropMean(2) : null,
    backdropBands: [bands[0], bands[2]].map(({ backdrop, backdropCount }) => ({
      pixels: backdropCount, luma: backdropCount ? backdrop / backdropCount : null,
    })),
  }
}

export function tintMetrics(tint) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16))
  const max = Math.max(r, g, b)
  const chroma = max - Math.min(r, g, b)
  return { hex: tint, hue: chroma ? hue(r, g, b, max, chroma) : null,
    saturation: max ? chroma / max : 0, luma: luma(r, g, b) }
}

// #12: at most 4 % of the frame in the bloom mask and no cream page pixel in it.
export const bloomCheck = (stats) => stats.bloomShare === null ? null : stats.bloomShare <= 4 && stats.creamBloomShare === 0

function checks(stats) {
  const atLeast = (value, threshold) => value === null ? null : value >= threshold
  const highlight = tintMetrics(stats.highlightTint)
  const shadow = tintMetrics(stats.shadowTint)
  const grade = {
    '1 Luma mean': stats.lumaMean >= 120 && stats.lumaMean <= 140,
    '1 Luma p95': stats.lumaP95 <= 215,
    '1 Pixels above 230': stats.above230 <= 3,
    '1 Pixels below 40': stats.below40 >= 3 && stats.below40 <= 8,
    '1 Saturation mean': stats.saturationMean >= 0.50 && stats.saturationMean <= 0.58,
  }
  return {
    '1 Grade': Object.values(grade).every(Boolean),
    ...grade,
    '2 Highlight tint': highlight.hue >= 50 && highlight.hue <= 80
      && highlight.saturation >= 0.25 && highlight.saturation <= 0.50 && highlight.luma >= 205,
    '3 Shadow tint': shadow.hue >= 90 && shadow.hue <= 180 && shadow.luma >= 35 && shadow.luma <= 70,
    '4 Hue window': atLeast(stats.hueWindowShare, 65),
    '5 Exposed cream': stats.exposedCreamShare === null ? null : stats.exposedCreamShare <= 10,
    '6 Top vs bottom': atLeast(stats.topMinusBottom, 15),
    '6 Far prop saturation': atLeast(stats.farSaturationDrop, 30),
    '12 Bloom': bloomCheck(stats),
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Verdict profiles. `shipped` (the default) judges the build as shipped (docs/contracts.md "Round 6" → Light, ground and
// props, "Look-stats, shipped profile"): only the required verdicts below are evaluated and any failed one makes the run
// exit non-zero. `stage` evaluates the full round-4 stage list as a diagnostic (no exit code). A required verdict with
// fewer eligible shots than its minimum fails; it is never "N/A".
// ---------------------------------------------------------------------------------------------------------------------
const some = (required) => ({ required, min: required })
const everyShot = (min) => ({ required: 'all', min })
const single = { required: 1, min: 1, single: true }
export const shippedVerdicts = {
  '10 Motes': some(5),
  '11 Lit emitters and halos': some(5),
  [clearanceCheck]: everyShot(6),
  '12 Bloom': some(5),
  '12 Emissive witness': single,
  '13 Fold flash': single,
  '2 Prop color fidelity': everyShot(6),
  ...Object.fromEntries(['a', 'b'].flatMap((who) => Object.keys(characterLayers).map((part) => [`2,3 Troll ${who} ${part} fidelity`, everyShot(4)]))),
  '2 Rim on characters': everyShot(4),
  '2 Rim on hero props': everyShot(3),
  '2 Page unchanged': everyShot(6),
  '5 Zone hue': some(5),
}
export const profiles = ['shipped', 'stage']

export function pickVerdicts(results, profile) {
  if (profile !== 'shipped') return results
  return Object.fromEntries(Object.entries(results).filter(([name]) => Object.hasOwn(shippedVerdicts, name)))
}

// `perShot`: one {name: true | false | null} per shot (null = no sample on that shot). `singles`: one-off witnesses.
export function summarizeVerdicts(perShot, profile, singles = {}) {
  const shipped = profile === 'shipped'
  const names = shipped ? Object.keys(shippedVerdicts) : [...new Set([...perShot.flatMap(Object.keys), ...Object.keys(singles)])]
  const bullets = {}
  for (const name of names) {
    const spec = shipped ? shippedVerdicts[name] : undefined
    const values = spec?.single || (!spec && Object.hasOwn(singles, name)) ? [singles[name] ?? null] : perShot.map((checks) => checks[name] ?? null)
    const measured = values.filter((value) => value !== null)
    const passed = measured.filter(Boolean).length
    let required
    let status
    if (shipped) {
      required = spec.required === 'all' ? measured.length : spec.required
      status = measured.length >= spec.min && passed >= required ? 'PASS' : 'FAIL'
    } else {
      required = spec?.single || Object.hasOwn(singles, name) ? 1
        : name.endsWith('fidelity') || name === clearanceCheck ? perShot.length : 5
      status = measured.length === 0 ? 'N/A' : passed >= required ? 'PASS' : 'FAIL'
    }
    bullets[name] = { status, passed, measured: measured.length, required, ...(shipped && { min: spec.min }) }
  }
  const failed = Object.entries(bullets).filter(([, { status }]) => status === 'FAIL').map(([name]) => name)
  return { bullets, failed, pass: failed.length === 0 }
}

function effectChecks(effects) {
  const inBand = (value, min, max) => value !== null && value >= min && value <= max
  const limits = (pair, min, max) => pair[0] >= min - 1e-6 && pair[1] <= max + 1e-6
  const { moss, fronds, motes, emitters } = effects
  const lights = emitters.filter(({ luma, radius }) => inBand(luma, 200, 235)
    && inBand(radius / viewport.width, 0.015, 0.03))
  return {
    '5 Sunlit moss contrast': inBand(moss.sunToShade, 1.5, 1.8),
    '7 Dark foreground': inBand(fronds.share, 5, 12) && inBand(fronds.medianLuma, 30, 70) && fronds.overlap === 0,
    '10 Motes': inBand(motes?.visible ?? null, 80, 150) && limits(motes.sizes, 2, 5)
      && limits(motes.alphas, 0.20, 0.50) && limits(motes.speeds, 0.05, 0.20)
      && motes.twinkling === 0.2 * motes.placed,
    '11 Lit emitters and halos': inBand(lights.length, 3, 8) && emitters.filter(({ radius }) => radius > 0).length <= 8,
  }
}

function rimCoverage(mask, rims, width) {
  const remaining = Uint8Array.from({ length: mask.length / 4 }, (_, i) => Number(mask[i * 4 + 2] === 1))
  const parts = []
  for (let start = 0; start < remaining.length; start++) {
    if (!remaining[start]) continue
    const queue = [start]
    remaining[start] = 0
    let edge = 0, lit = 0
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]
      const x = i % width
      const neighbors = [i - width, i + width, x ? i - 1 : -1, x < width - 1 ? i + 1 : -1]
      if (neighbors.some((neighbor) => mask[neighbor * 4 + 2] !== 1)) {
        edge++
        if (rims[i * 4] >= 4) lit++
      }
      for (const neighbor of neighbors) {
        if (!remaining[neighbor]) continue
        queue.push(neighbor)
        remaining[neighbor] = 0
      }
    }
    if (queue.length >= 100) parts.push({ pixels: queue.length, edge, lit })
  }
  const rimmed = parts.filter(({ lit, edge }) => lit >= 4 && lit >= 0.025 * edge).length
  return { silhouettes: parts.length, rimmed, share: share(rimmed, parts.length) }
}

async function pixelsFromPng(page, png) {
  const base64 = await page.evaluate(async (pngBase64) => {
    const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + pngBase64)).blob())
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    return new Uint8Array(data.buffer).toBase64()
  }, png.toString('base64'))
  return Buffer.from(base64, 'base64')
}

// The URL of the same pose with `rim` added to the URL's own lookOff list (the shipped default list when it has none).
export function rimOffURL(url) {
  const off = new URL(url)
  const list = (off.searchParams.get('lookOff') ?? DEFAULT_LOOK_OFF).split(',').filter(Boolean)
  off.searchParams.set('lookOff', [...new Set([...list, 'rim'])].join(','))
  return off
}

async function measure({ url, out, before, preStage, profile }) {
  const shipped = !before && profile === 'shipped'
  const dir = dirname(out)
  await mkdir(dir, { recursive: true })
  const browser = await launchChromium()
  const frames = []
  const closeUps = []
  const crops = []
  let bloomWitness
  let lighting
  let backdrop
  let foldResponse
  let trollReference
  try {
    const stepped = await installLookProbe(await createSteppedPage(browser, viewport))
    const { page, readMask } = stepped
    const captureURL = new URL(url)
    captureURL.searchParams.delete('focus')
    if (!before) captureURL.searchParams.set('look-probe', '')
    const referenceURL = new URL(captureURL)
    const allOffURL = new URL(captureURL)
    allOffURL.searchParams.set('lookOff', Object.keys(look).join(','))
    if (!before) trollReference = allOffURL.href
    const rimOff = rimOffURL(captureURL)
    // Same defaults as the game: layers off unless the URL turns them on.
    const disabled = new Set(Object.entries(lookFlags(captureURL.search)).filter(([, on]) => !on).map(([name]) => name))
    referenceURL.searchParams.set('lookOff', [...new Set([...disabled, 'backlight', 'bounce'])].join(','))
    // `--before` keeps the round-3 shots at their own lens; the others are the six pinned walk-camera shots.
    const shotList = before ? shots.map((shot) => ({ ...shot, cam: null })) : lookShots
    const options = before ? undefined : { panel: false }
    for (const [index, shot] of shotList.entries()) {
      const path = join(dir, (before ? 'before-' : 'shot-') + String(index + 1).padStart(2, '0') + '.png')
      let rgba
      let png
      let mask
      let effects
      let dapple
      let rims
      const staged = await takeShot(stepped, captureURL, shot, null, async () => {
        png = await page.locator('canvas').screenshot({ path: !before || index === 0 ? path : undefined })
        rgba = await pixelsFromPng(page, png)
        if (before) return
        mask = await readMask()
        assert.ok(mask, 'Look diagnostic shader was not drawn by preview')
        const { riggingMask, trollBounds, leader, ...stageEffects } = await readStageEffects(page, mask)
        effects = { ...stageEffects, trollBounds, leader }
        if (stageFlags(captureURL.search).lanterns) {
          assert.ok(riggingMask, 'Lantern rigging mask was unavailable')
          effects.clearance = { trollBounds,
            ...lanternClearance(Buffer.from(riggingMask, 'base64'), viewport.width, viewport.height, trollBounds) }
        }
        // The round-4 stage diagnostics are not evaluated (and not drawn) in the shipped profile.
        if (!shipped && !disabled.has('dapple')) dapple = dappleContrast(await readMask(2))
        if (!shipped && !disabled.has('backlight')) rims = rimCoverage(mask, await readMask(3), viewport.width)
        if (!shipped && index === 0) lighting = await readStageLighting(page)
        if (index === 0 && !disabled.has('bloom')) {
          const centers = await addBloomWitness(page)
          const witnessMask = await readMask()
          await page.locator('canvas').screenshot({ path: join(dir, 'emissive-witness.png') })
          await page.evaluate(() => window.__lookProbe.removeWitness())
          const counts = centers.map(([x, y]) => countNewBloom(witnessMask, mask, Math.round(x), Math.round(y)))
          const witness = frameStats(rgba, viewport.width, viewport.height, { mask: witnessMask })
          bloomWitness = { emissivePixels: counts[0], nonEmissivePixels: counts[1],
            creamBloomShare: witness.creamBloomShare, totalBloomShare: witness.bloomShare,
            passed: counts[0] > 0 && counts[1] === 0 && witness.creamBloomShare === 0 && witness.bloomShare <= 4 }
          console.log((bloomWitness.passed ? 'PASS' : 'FAIL') + '  12 Emissive witness ' + JSON.stringify(bloomWitness))
        }
      }, options)
      const grove = groveInFrame(shot.seed, staged.player, viewport.width, viewport.height)
      const stats = frameStats(rgba, viewport.width, viewport.height, { mask, groveInFrame: grove })
      const passed = shipped ? { '12 Bloom': bloomCheck(stats) } : checks(stats)
      let fidelity
      let troll
      let rim
      let page6
      let zone
      if (!before) {
        const boxes = rigBoxes(effects.trollBounds, effects.leader)
        let reference, referenceMask
        let allOffPng
        const stage = async (stageURL, what, inspect) => {
          const again = await takeShot(stepped, stageURL, shot, null, inspect, options)
          assert.deepEqual(again, staged, `${what} must use the same pose and frame`)
        }
        if (!shipped) {
          await stage(referenceURL, 'Lighting reference', async () => {
            reference = await pixelsFromPng(page, await page.locator('canvas').screenshot())
            referenceMask = await readMask()
          })
          fidelity = propFidelity(rgba, reference, mask, referenceMask, viewport.width, viewport.height)
          passed['2 Prop color fidelity'] = fidelity.passed
          console.log(`${fidelity.passed ? 'PASS' : 'FAIL'} 2 Prop color fidelity, shot ${index + 1} ${JSON.stringify(fidelity)}`)
        }
        await stage(allOffURL, 'Troll reference', async () => {
          allOffPng = await page.locator('canvas').screenshot()
          reference = await pixelsFromPng(page, allOffPng)
          referenceMask = await readMask()
        })
        if (shipped) {
          // Felt colours against the same pose with every look layer (and the rim) off.
          fidelity = propFidelity(rgba, reference, mask, referenceMask, viewport.width, viewport.height)
          passed['2 Prop color fidelity'] = fidelity.passed
          console.log(`${fidelity.passed ? 'PASS' : 'FAIL'} 2 Prop color fidelity, shot ${index + 1} ${JSON.stringify(fidelity)}`)
        }
        troll = trollFidelity(rgba, reference, mask, referenceMask, viewport.width, viewport.height, { boxes })
        for (const [who, rig] of Object.entries(troll)) {
          for (const part of Object.keys(characterLayers)) {
            passed[`2,3 Troll ${who} ${part} fidelity`] = rig[part].passed
            console.log(`${rig[part].passed === null ? 'SKIP' : rig[part].passed ? 'PASS' : 'FAIL'} Troll ${who} ${part}, shot ${index + 1} ${JSON.stringify(rig[part])}`)
          }
        }
        if (shipped) {
          let rimOffRgba
          await stage(rimOff, 'Rim-off frame', async () => {
            rimOffRgba = await pixelsFromPng(page, await page.locator('canvas').screenshot())
          })
          rim = { characters: characterRim(rgba, mask, viewport.width, viewport.height, boxes),
            heroProps: heroPropRim(rgba, rimOffRgba, mask, viewport.width, viewport.height) }
          page6 = pageUnchanged(rgba, rimOffRgba, mask, viewport.width, viewport.height)
          zone = zoneHue(rgba, mask, viewport.width, viewport.height)
          passed['2 Rim on characters'] = rim.characters.passed
          passed['2 Rim on hero props'] = rim.heroProps.passed
          passed['2 Page unchanged'] = page6.passed
          passed['5 Zone hue'] = zone.passed
          console.log(`Rim, shot ${index + 1} ${JSON.stringify({ characters: rim.characters, heroProps: rim.heroProps })}`)
          console.log(`Page, shot ${index + 1} ${JSON.stringify(page6)}  Zone hue ${JSON.stringify(zone)}`)
        }
        if (preStage && index < 3) {
          let beforePng
          await stage(preStage, 'Pre-stage close-up', async () => {
            beforePng = await page.locator('canvas').screenshot()
          })
          closeUps.push([beforePng, png, allOffPng])
          crops.push(trollCrop(mask, viewport))
        }
      }
      if (dapple) passed['8 Dappled key contrast'] = dapple.passed
      if (rims) passed['2 Felt rim visibility'] = rims.share === null ? null : rims.share >= 50
      if (effects) Object.assign(passed, effectChecks(effects))
      if (effects?.clearance) {
        passed[clearanceCheck] = effects.clearance.passed
        console.log(`${effects.clearance.passed ? 'PASS' : 'FAIL'} ${clearanceCheck}, shot ${index + 1} ${JSON.stringify(effects.clearance)}`)
      }
      frames.push({ name: shot.name, ...staged, groveInFrame: grove, stats, tints: {
        highlight: tintMetrics(stats.highlightTint), shadow: tintMetrics(stats.shadowTint),
      }, fidelity, troll, rim, page: page6, zone, dapple, rims, effects, checks: pickVerdicts(passed, before ? 'stage' : profile) })
      console.log('Shot ' + (index + 1) + ' ' + JSON.stringify(stats))
    }
    if (!before) {
      if (!shipped) {
        const backdropShot = { ...shots[0], cam: [44, 34] }
        const staged = await takeShot(stepped, captureURL, backdropShot, null, async () => {
          const png = await page.locator('canvas').screenshot({ path: join(dir, 'backdrop.png') })
          const stats = frameStats(await pixelsFromPng(page, png), viewport.width, viewport.height, { mask: await readMask() })
          backdrop = { bands: stats.backdropBands, lumaDifference: stats.backdropTopMinusBottom,
            passed: stats.backdropTopMinusBottom >= 30 }
        })
        backdrop = { ...staged, ...backdrop }
      }
      if (stageFlags(captureURL.search).response) foldResponse = await measureFoldFlash(stepped, captureURL, dir)
      await compareStills(page, shipped ? 'reference/concept-r6/concept-r6-01-duo-walk.png' : 'reference/concept-r4/concept-r4-01-green-gold-grove.png',
        join(dir, 'shot-01.png'), join(dir, 'shot-01-vs-concept.png'), viewport)
      if (closeUps.length) await compareTrollStills(page, closeUps, crops, join(dir, 'troll-close-ups.png'))
    }
  } finally {
    await browser.close()
  }
  const singles = {
    ...(bloomWitness && { '12 Emissive witness': bloomWitness.passed }),
    ...(foldResponse && { '13 Fold flash': foldResponse.passed }),
    ...(backdrop && { '17 Backdrop gradient': backdrop.passed }),
  }
  const verdict = summarizeVerdicts(frames.map(({ checks: results }) => results), before ? 'stage' : profile,
    shipped ? { '12 Emissive witness': bloomWitness?.passed ?? null, '13 Fold flash': foldResponse?.passed ?? null } : singles)
  for (const [name, { status, passed, measured, required }] of Object.entries(verdict.bullets)) {
    console.log(status + '  ' + name + ' (' + passed + '/' + measured + ', needs ' + required + ')')
  }
  const { bullets } = verdict
  if (bullets[clearanceCheck]) {
    const totals = { insideTroll: 0, bottomQuarter: 0 }
    for (const { effects } of frames) {
      if (!effects?.clearance) continue
      totals.insideTroll += effects.clearance.insideTroll
      totals.bottomQuarter += effects.clearance.bottomQuarter
    }
    Object.assign(bullets[clearanceCheck], totals)
    console.log(`Lantern clearance totals ${JSON.stringify(totals)}`)
  }
  if (backdrop) console.log((backdrop.passed ? 'PASS' : 'FAIL') + '  17 Backdrop gradient (' + backdrop.lumaDifference + ' luma)')
  if (foldResponse) console.log((foldResponse.passed ? 'PASS' : 'FAIL') + '  13 Fold flash ' + JSON.stringify(foldResponse))
  if (lighting) {
    lighting.backlightPassed = lighting.farSide && lighting.elevation >= 30 && lighting.elevation <= 45
      && lighting.key === '#ffe9a8'
    lighting.bouncePassed = lighting.ground === '#2f5a50'
    console.log((lighting.backlightPassed ? 'PASS' : 'FAIL') + '  2 Key direction and color')
    console.log((lighting.bouncePassed ? 'PASS' : 'FAIL') + '  3 Ground bounce color')
  }
  const creamMethod = before ? 'sRGB color estimate' : 'visible page material mask'
  const methods = {
    cream: creamMethod,
    troll: 'Matching visible hair and body masks per character (projected character bounds) at the same pose with all lookOff layers disabled and the same effects',
    rimCharacters: 'Mean luma of character mask pixels within 3 px of the mask edge against those 6 px or more inside, per character with a mask of 1,500 px or more',
    rimHeroProps: 'The same ratio on the hero-prop mask (800 px or more), and the edge pixels against the same pixels with rim in lookOff',
    pageUnchanged: 'Mean |delta luma| of cream page pixels against the same pose with rim added to the lookOff list',
    zoneHue: 'Saturated (s > 0.35, v > 0.2) hero- and flat-prop mask pixels in the best 60 degree hue window, shots with 2,000 or more eligible pixels',
    rims: 'Connected sharp-band prop silhouettes with measurable backlight along their perimeter',
    moss: 'Median luma ratio of directly lit focus-band moss pixels against the same frame with the key removed',
    darkForeground: 'Visible frond mask and projected conservative troll bounds',
    air: 'Projected centers that change by at least 3 RGB levels when the corresponding layer is hidden',
    emitters: 'Visible core-center luma and median emissive halo radius along eight rays',
    clearance: 'Changed RGB pixels with the lantern rig hidden, tested against the union of the projected bounds of both trolls and the bottom quarter',
  }
  await writeJson(out, {
    viewport, url, before, profile: before ? 'before' : profile, commit: gitHead(), minSamples, rimLimits, methods, trollReference, preStage, lighting, backdrop,
    bloomWitness, foldResponse, shots: before ? undefined : lookShots.map(({ name, seed, x, z, heading, cam, state, fold }) => ({ name, seed, x, z, heading, cam, state, fold })),
    frames, bullets, failed: verdict.failed, pass: verdict.pass,
  })
  if (shipped && !verdict.pass) {
    console.error(`Required verdicts failed: ${verdict.failed.join('; ')}`)
    process.exitCode = 1
  }
  return verdict
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// The fold-flash witness (#13). The burst is anchored to the upright crossing in `hingeTrace` (`readFoldFlash` finds the
// first sample at or after the fold event with angle >= 0), so the witness steps until the crossing exists instead of
// looking at a fixed frame window; the stage-1 lift and the anticipation dip move the crossing from build to build.
async function measureFoldFlash(stepped, captureURL, dir) {
  const { page } = stepped
  const fold = { dir: 'up', i: -4, j: -3 }
  const shot = { seed: 0, x: -9.3, z: -5.1, heading: Math.PI / 4, state: 'idle', frames: 17, fold }
  let foldResponse
  await takeShot(stepped, captureURL, shot, null, async () => {
    const fps = 60
    const first = 168
    for (let frame = first; frame <= first + 120; frame++) {
      await stepped.advance(frame, fps)
      const flash = await readFoldFlash(page, fold, frame, fps)
      if (!flash?.flakes) continue
      const spread = frame + 8
      await stepped.advance(frame + 1, fps, spread - frame)
      await page.locator('canvas').screenshot({ path: join(dir, 'fold-flash.png') })
      const settled = frame + 36
      await stepped.advance(spread + 1, fps, settled - spread)
      const steady = await readFoldFlash(page, fold, settled, fps)
      const ratio = flash.emissive / steady?.emissive
      const latency = flash.burstAt - flash.uprightAt
      foldResponse = { ...flash, frame, latency, settled: steady?.emissive, ratio,
        passed: flash.visible && flash.flakes >= 24 && flash.flakes <= 48
          && Math.abs(ratio - 1.5) < 0.01 && Math.abs(latency) < 0.0001 }
      break
    }
  })
  return foldResponse ?? { passed: false }
}

function dappleContrast(mask) {
  let pixels = 0
  let min = 255
  let max = 0
  for (let i = 0; i < mask.length; i += 4) {
    const key = mask[i]
    if (!key) continue
    pixels++
    min = Math.min(min, key)
    max = Math.max(max, key)
  }
  const ratio = pixels ? max / min : null
  return { pixels, ratio, passed: pixels > 0 && ratio >= 1.4 && ratio <= 1.8 }
}

function countNewBloom(witness, original, centerX, centerY) {
  let changed = 0
  for (let y = centerY - 50; y <= centerY + 50; y++) {
    for (let x = centerX - 50; x <= centerX + 50; x++) {
      const offset = (y * viewport.width + x) * 4 + 1
      if (witness[offset] === 255 && original[offset] !== 255) changed++
    }
  }
  return changed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: '.handoff/evidence/V2c/look-stats.json' },
      before: { type: 'boolean' },
      'pre-stage': { type: 'string' },
      profile: { type: 'string', default: 'shipped' },
    },
  })
  assert.ok(positionals.length <= 1 && profiles.includes(values.profile),
    'Usage: node scripts/look-stats.mjs [PREVIEW_URL] [--out PATH] [--profile shipped|stage] [--before] [--pre-stage PREVIEW_URL]')
  await measure({ url: positionals[0] ?? previewURL, out: values.out, before: values.before ?? false,
    preStage: values['pre-stage'], profile: values.profile })
}
