// Stand-alone runner for the round-6 routes and analyses (the gate itself runs them from scripts/e2e.mjs):
//   node scripts/e2e-duo-round6-run.mjs [--url URL] [--only stage,river,hum,fixed-camera] [--viewports 1] [--save FILE] [--scenario R6-CAM]
//   node scripts/e2e-duo-round6-run.mjs --load FILE [--load FILE2 ...] [--scenario R6-FOLD]   (re-analyse saved results, no browser)
// A saved file is the JSON array of session results; the duo runner's own sessions can be added from `scripts/e2e.mjs`'s trace output.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { launchChromium, previewURL } from './capture.mjs'
import { analyzeRound6, loadContext, round6Scenarios, runRound6Sessions } from './e2e-duo-round6.mjs'
import { duoViewports } from './e2e-duo-sessions.mjs'

const { values } = parseArgs({
  options: {
    url: { type: 'string' }, only: { type: 'string' }, save: { type: 'string' }, scenario: { type: 'string' }, load: { type: 'string', multiple: true },
    viewports: { type: 'string' },
  },
})

let results = []
let blocked = []
if (values.load?.length) {
  for (const file of values.load) results.push(...JSON.parse(await readFile(file, 'utf8')))
} else {
  const browser = await launchChromium()
  try {
    ;({ results, blocked } = await runRound6Sessions({
      baseURL: values.url ?? previewURL, browser, only: values.only?.split(','), viewports: duoViewports.slice(0, Number(values.viewports ?? duoViewports.length)),
    }))
  } finally {
    await browser.close()
  }
  if (values.save) {
    await mkdir(dirname(values.save), { recursive: true })
    await writeFile(values.save, JSON.stringify(results))
    console.log(`saved ${results.length} session results to ${values.save}`)
  }
}
for (const { where, ids, error } of blocked) console.log(`BLOCKED ${where} -> ${ids.join(', ')}: ${error}`)

const out = analyzeRound6(results, await loadContext(), { blocked })
let failed = 0
for (const [id, title] of round6Scenarios) {
  if (values.scenario && !id.startsWith(values.scenario)) continue
  const { measured, problems } = out.results.get(id)
  console.log(`${problems.length ? 'FAIL' : 'PASS'} ${id} ${title}`)
  if (problems.length) failed += 1
  for (const problem of problems.slice(0, 12)) console.log(`     ${problem}`)
  if (problems.length > 12) console.log(`     ... and ${problems.length - 12} more`)
  if (process.env.R6_VERBOSE) console.log(JSON.stringify(measured, null, 1))
}
console.log(`${failed} of ${values.scenario ? '' : round6Scenarios.length} scenarios failed`)
process.exitCode = failed ? 1 : 0
