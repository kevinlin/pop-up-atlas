import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createSteppedPage, launchChromium, previewURL } from './capture.mjs'
import { shots, shotViewport, takeShot } from './sbs.mjs'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { before: { type: 'boolean' } },
})
assert(positionals.length <= 1,
  'Usage: node scripts/look-shots.mjs [URL] [--before]')
const baseURL = positionals[0] ?? previewURL
const variant = values.before ? 'before' : 'after'
const out = resolve('.handoff/evidence/T7/r3')
const names = ['establishing', 'walking', 'fold-up', 'river-bridge', 'dance', 'fold-back']
const focusPoints = [[22, 2], [0.8, -5.25], [2, -3.9], [24, 8.28], [-4, 8], [-2, -3.8]]

await mkdir(out, { recursive: true })
const browser = await launchChromium()
try {
  const capture = await createSteppedPage(browser, shotViewport)
  for (const [index, shot] of shots.entries()) {
    const url = new URL(baseURL)
    // The before capture uses the prior renderer's default focus at the same camera pose.
    if (!values.before) url.searchParams.set('focus', focusPoints[index].join(','))
    const number = String(index + 1).padStart(2, '0')
    await takeShot(capture, url.href, shot, resolve(out, `${number}-${names[index]}-${variant}.png`))
  }
} finally {
  await browser.close()
}
