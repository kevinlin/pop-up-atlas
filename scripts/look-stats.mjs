import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { stageFlags } from '../src/effects/flags.js'
import { look, lookFlags } from '../src/materials/stage-look.js'
import { createSteppedPage, launchChromium, previewURL, writeJson } from './capture.mjs'
import {
  addBloomWitness, characterLayers, groveInFrame, installLookProbe, readFoldFlash, readStageEffects, readStageLighting,
} from './look-probe.mjs'
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
  const count = width * height
  assert.ok(count && [current, reference, currentMask, referenceMask].every((buffer) => buffer.length === 4 * count))
  const ratios = [], differences = []
  const desaturated = new Uint8Array(count)
  let comparedPixels = 0, desaturatedPixels = 0
  for (let i = 0; i < count; i++) {
    const p = 4 * i
    const layer = currentMask[p + 2]
    if (!includesLayer(layer) || referenceMask[p + 2] !== layer) continue
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

export function trollFidelity(current, reference, currentMask, referenceMask, width, height) {
  return Object.fromEntries(Object.entries(characterLayers).map(([part, layer]) => [
    part, surfaceFidelity(current, reference, currentMask, referenceMask, width, height, (value) => value === layer),
  ]))
}

export function lanternClearance(mask, width, height, [left, top, right, bottom]) {
  assert.equal(mask.length, width * height)
  let visible = 0
  let insideTroll = 0
  let bottomQuarter = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      visible++
      if (x + 0.5 >= left && x + 0.5 <= right && y + 0.5 >= top && y + 0.5 <= bottom) insideTroll++
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
    '12 Bloom': stats.bloomShare === null ? null : stats.bloomShare <= 4 && stats.creamBloomShare === 0,
  }
}

function effectChecks(effects) {
  const inBand = (value, min, max) => value !== null && value >= min && value <= max
  const limits = (pair, min, max) => pair[0] >= min - 1e-6 && pair[1] <= max + 1e-6
  const { moss, fronds, bokeh, motes, emitters } = effects
  const lights = emitters.filter(({ luma, radius }) => inBand(luma, 200, 235)
    && inBand(radius / viewport.width, 0.015, 0.03))
  return {
    '5 Sunlit moss contrast': inBand(moss.sunToShade, 1.5, 1.8),
    '7 Dark foreground': inBand(fronds.share, 5, 12) && inBand(fronds.medianLuma, 30, 70) && fronds.overlap === 0,
    '9 Bokeh': inBand(bokeh?.visible ?? null, 15, 30) && limits(bokeh.sizes, 0.03, 0.10)
      && limits(bokeh.alphas, 0.15, 0.35) && bokeh.sharp === 0 && bokeh.top40 >= 0.7 * bokeh.visible,
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

async function measure({ url, out, before, preStage }) {
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
    // Same defaults as the game: layers off unless the URL turns them on.
    const disabled = new Set(Object.entries(lookFlags(captureURL.search)).filter(([, on]) => !on).map(([name]) => name))
    referenceURL.searchParams.set('lookOff', [...new Set([...disabled, 'backlight', 'bounce'])].join(','))
    for (const [index, shot] of shots.entries()) {
      const path = join(dir, (before ? 'before-' : 'shot-') + String(index + 1).padStart(2, '0') + '.png')
      let rgba
      let png
      let mask
      let effects
      let dapple
      let rims
      const staged = await takeShot(stepped, captureURL, { ...shot, cam: null }, null, async () => {
        png = await page.locator('canvas').screenshot({ path: !before || index === 0 ? path : undefined })
        rgba = await pixelsFromPng(page, png)
        if (before) return
        mask = await readMask()
        assert.ok(mask, 'Look diagnostic shader was not drawn by preview')
        const { riggingMask, trollBounds, ...stageEffects } = await readStageEffects(page, mask)
        effects = stageEffects
        if (stageFlags(captureURL.search).lanterns) {
          assert.ok(riggingMask, 'Lantern rigging mask was unavailable')
          effects.clearance = { trollBounds,
            ...lanternClearance(Buffer.from(riggingMask, 'base64'), viewport.width, viewport.height, trollBounds) }
        }
        if (!disabled.has('dapple')) dapple = dappleContrast(await readMask(2))
        if (!disabled.has('backlight')) rims = rimCoverage(mask, await readMask(3), viewport.width)
        if (index === 0) lighting = await readStageLighting(page)
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
      })
      const grove = groveInFrame(shot.seed, staged.player, viewport.width, viewport.height)
      const stats = frameStats(rgba, viewport.width, viewport.height, { mask, groveInFrame: grove })
      const passed = checks(stats)
      let fidelity
      let troll
      if (!before) {
        let reference, referenceMask
        const referenceStage = await takeShot(stepped, referenceURL, { ...shot, cam: null }, null, async () => {
          reference = await pixelsFromPng(page, await page.locator('canvas').screenshot())
          referenceMask = await readMask()
        })
        assert.deepEqual(referenceStage, staged, 'Lighting reference must use the same pose and frame')
        fidelity = propFidelity(rgba, reference, mask, referenceMask, viewport.width, viewport.height)
        passed['2 Prop color fidelity'] = fidelity.passed
        console.log(`${fidelity.passed ? 'PASS' : 'FAIL'} 2 Prop color fidelity, shot ${index + 1} ${JSON.stringify(fidelity)}`)
        let allOffPng
        const allOffStage = await takeShot(stepped, allOffURL, { ...shot, cam: null }, null, async () => {
          allOffPng = await page.locator('canvas').screenshot()
          reference = await pixelsFromPng(page, allOffPng)
          referenceMask = await readMask()
        })
        assert.deepEqual(allOffStage, staged, 'Troll reference must use the same pose and frame')
        troll = trollFidelity(rgba, reference, mask, referenceMask, viewport.width, viewport.height)
        for (const [part, result] of Object.entries(troll)) {
          passed[`2,3 Troll ${part} fidelity`] = result.passed
          console.log(`${result.passed ? 'PASS' : 'FAIL'} Troll ${part}, shot ${index + 1} ${JSON.stringify(result)}`)
        }
        if (preStage && index < 3) {
          let beforePng
          const beforeStage = await takeShot(stepped, preStage, { ...shot, cam: null }, null, async () => {
            beforePng = await page.locator('canvas').screenshot()
          })
          assert.deepEqual(beforeStage, staged, 'Pre-stage close-up must use the same pose and frame')
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
      frames.push({ ...staged, groveInFrame: grove, stats, tints: {
        highlight: tintMetrics(stats.highlightTint), shadow: tintMetrics(stats.shadowTint),
      }, fidelity, troll, dapple, rims, effects, checks: passed })
      console.log('Shot ' + (index + 1) + ' ' + JSON.stringify(stats))
    }
    if (!before) {
      const backdropShot = { ...shots[0], cam: [44, 34] }
      const staged = await takeShot(stepped, captureURL, backdropShot, null, async () => {
        const png = await page.locator('canvas').screenshot({ path: join(dir, 'backdrop.png') })
        const stats = frameStats(await pixelsFromPng(page, png), viewport.width, viewport.height, { mask: await readMask() })
        backdrop = { bands: stats.backdropBands, lumaDifference: stats.backdropTopMinusBottom,
          passed: stats.backdropTopMinusBottom >= 30 }
      })
      backdrop = { ...staged, ...backdrop }
      if (stageFlags(captureURL.search).response) {
        const fold = { dir: 'up', i: -4, j: -3 }
        const shot = { seed: 0, x: -9.3, z: -5.1, heading: Math.PI / 4, state: 'idle', frames: 17, fold }
        await takeShot(stepped, captureURL, shot, null, async () => {
          const fps = 60
          for (let frame = 168; frame <= 186; frame++) {
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
            foldResponse = { ...flash, latency, settled: steady?.emissive, ratio,
              passed: flash.visible && flash.flakes >= 24 && flash.flakes <= 48
                && Math.abs(ratio - 1.5) < 0.01 && Math.abs(latency) < 0.0001 }
            break
          }
        })
        foldResponse ??= { passed: false }
      }
      await compareStills(page, 'reference/concept-r4/concept-r4-01-green-gold-grove.png', join(dir, 'shot-01.png'),
        join(dir, 'shot-01-vs-concept.png'), viewport)
      if (closeUps.length) await compareTrollStills(page, closeUps, crops, join(dir, 'troll-close-ups.png'))
    }
  } finally {
    await browser.close()
  }
  const bullets = Object.fromEntries(Object.keys(frames[0].checks).map((name) => {
    const measured = frames.map((frame) => frame.checks[name]).filter((result) => result !== null)
    const passed = measured.filter(Boolean).length
    const required = name.endsWith('fidelity') || name === clearanceCheck ? frames.length : 5
    const status = measured.length === 0 ? 'N/A' : passed >= required ? 'PASS' : 'FAIL'
    console.log(status + '  ' + name + ' (' + passed + '/' + measured.length + ')')
    return [name, { status, passed, measured: measured.length, required }]
  }))
  if (bullets[clearanceCheck]) {
    const totals = { insideTroll: 0, bottomQuarter: 0 }
    for (const { effects } of frames) {
      totals.insideTroll += effects.clearance.insideTroll
      totals.bottomQuarter += effects.clearance.bottomQuarter
    }
    Object.assign(bullets[clearanceCheck], totals)
    console.log(`Lantern clearance totals ${JSON.stringify(totals)}`)
  }
  if (backdrop) {
    const status = backdrop.passed ? 'PASS' : 'FAIL'
    bullets['17 Backdrop gradient'] = { status, passed: Number(backdrop.passed), measured: 1, required: 1 }
    console.log(status + '  17 Backdrop gradient (' + backdrop.lumaDifference + ' luma)')
  }
  if (foldResponse) {
    const status = foldResponse.passed ? 'PASS' : 'FAIL'
    bullets['13 Fold flash'] = { status, passed: Number(foldResponse.passed), measured: 1, required: 1 }
    console.log(status + '  13 Fold flash ' + JSON.stringify(foldResponse))
  }
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
    troll: 'Matching visible hair and body masks at the same pose with all lookOff layers disabled and the same effects',
    rims: 'Connected sharp-band prop silhouettes with measurable backlight along their perimeter',
    moss: 'Median luma ratio of directly lit focus-band moss pixels against the same frame with the key removed',
    darkForeground: 'Visible frond mask and projected conservative troll bounds',
    air: 'Projected centers that change by at least 3 RGB levels when the corresponding layer is hidden',
    emitters: 'Visible core-center luma and median emissive halo radius along eight rays',
    clearance: 'Changed RGB pixels with the lantern rig hidden, tested against the projected troll bounds and bottom quarter',
  }
  await writeJson(out, {
    viewport, url, before, methods, trollReference, preStage, lighting, backdrop, bloomWitness, foldResponse, frames, bullets,
  })
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
    },
  })
  assert.ok(positionals.length <= 1,
    'Usage: node scripts/look-stats.mjs [PREVIEW_URL] [--out PATH] [--before] [--pre-stage PREVIEW_URL]')
  await measure({ url: positionals[0] ?? previewURL, out: values.out, before: values.before ?? false,
    preStage: values['pre-stage'] })
}
