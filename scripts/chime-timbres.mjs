// Chime timbre loudness check (docs/contracts.md, "Chime timbre by tile"): each tile timbre's peak within ±1.5 dB of the
// bell at the same note. Renders one chime per tile, note and length through the shipped sound bank (src/audio/sounds.js)
// in an OfflineAudioContext, chime only, and compares each peak with the bell's at the same note and length.
//   node scripts/chime-timbres.mjs [PREVIEW_URL]      (needs `npm run preview`; exits 1 on a violation)
import { fileURLToPath } from 'node:url'
import { launchChromium, previewURL } from './capture.mjs'

const LIMIT_DB = 1.5
const tiles = ['flower', 'mushroom_house', 'cupcake_tree', 'river_straight', 'yarn_bridge']
const browser = await launchChromium()
let failed = false
try {
  const page = await browser.newPage()
  await page.goto(process.argv[2] ?? previewURL)
  await page.route('**/__chime_audio/*.js', (route) => route.fulfill({
    path: fileURLToPath(new URL(`../src/audio/${new URL(route.request().url()).pathname.split('/').at(-1)}`, import.meta.url)),
    contentType: 'text/javascript',
  }))
  const peaks = await page.evaluate(async (ids) => {
    const { createSoundBank } = await import(new URL('/__chime_audio/sounds.js', location.href))
    const out = {}
    for (const id of ['meadow', ...ids]) {
      out[id] = []
      // The melody's notes and both lengths (accented 0.46 s and passing 0.2 s).
      for (const midi of [69, 71, 74, 76, 78, 81]) {
        for (const [length, gain] of [[0.46, 10 ** (2 / 20)], [0.2, 1]]) {
          const context = new OfflineAudioContext(2, 48000, 48000)
          createSoundBank(context)({ kind: 'chime', id, i: 0, j: 0, midi, t: 0.05, end: 0.05 + length, gain, passing: length === 0.2, final: false })
          const buffer = await context.startRendering()
          let peak = 0
          for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v))
          out[id].push({ midi, length, db: 20 * Math.log10(peak) })
        }
      }
    }
    return out
  }, tiles)
  for (const id of tiles) {
    const deltas = peaks[id].map((entry, k) => ({ ...entry, delta: entry.db - peaks.meadow[k].db }))
    const worst = deltas.reduce((w, d) => (Math.abs(d.delta) > Math.abs(w.delta) ? d : w))
    const pass = Math.abs(worst.delta) <= LIMIT_DB
    failed ||= !pass
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: worst ${worst.delta.toFixed(2)} dB vs bell (MIDI ${worst.midi}, ${worst.length} s), limit ±${LIMIT_DB}`)
  }
} finally {
  await browser.close()
}
process.exitCode = failed ? 1 : 0
