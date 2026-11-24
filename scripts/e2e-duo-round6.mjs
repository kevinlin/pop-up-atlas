// The round-6 acceptance gate (R6-*, tests/e2e/round6.feature): runs the four extra routes of scripts/e2e-duo-round6-sessions.mjs,
// pools them with the duo runner's own sessions (their recorder data) and reports every scenario through the caller's
// `check(name, measured, verify)`. The analyses are pure functions of the session results, so a saved run can be re-analysed
// without a browser (scripts/e2e-duo-round6-run.mjs --load).
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { launchChromium } from './capture.mjs'
import { manifestPath, summarizeTroll, trollA, trollB } from './e2e-duo-assets.mjs'
import { analyzeCamera, finishCamera, newCameraPool } from './e2e-duo-round6-camera.mjs'
import { analyzeCharacters, finishCharacters, newCharacterPool } from './e2e-duo-round6-character.mjs'
import { analyzeFootsteps, analyzeHum, finishAudio, newAudioPool } from './e2e-duo-round6-audio.mjs'
import {
  createResults, firstLine, prepare, round6RequiredChecks, round6Scenarios, round6Titles,
} from './e2e-duo-round6-common.mjs'
import { analyzeFoldSession } from './e2e-duo-folds.mjs'
import { duoViewports } from './e2e-duo-sessions.mjs'
import { fixedCameraSession, humSession, riverSession, round6SessionScenarios, stageSession } from './e2e-duo-round6-sessions.mjs'

export { round6RequiredChecks, round6Scenarios }

const foldIds = ['R6-FOLD-01', 'R6-FOLD-02', 'R6-FOLD-03', 'R6-FOLD-04', 'R6-FOLD-05']

// Static facts the analyses need from the shipped files: clip lengths of both rigs and the cue manifest (for sung pitch).
export async function loadContext() {
  const read = async (file) => {
    try {
      const { clipInfo } = await summarizeTroll(file)
      return Object.fromEntries(Object.entries(clipInfo).map(([name, { duration }]) => [name, duration]))
    } catch {
      return {}
    }
  }
  return { manifest: JSON.parse(await readFile(manifestPath, 'utf8')), clips: { a: await read(trollA), b: await read(trollB) } }
}

// ---- folds: the model checks and the silence of stage 1 ------------------------------------------------------------

// Stage 1 is silent: nothing sounds that a stage-2 fold event does not account for.
function analyzeSilence(x, out) {
  const { foldLog = [], popLog = [], audioLog = [], cueLog = [] } = x.result
  for (const pop of popLog) {
    if (!foldLog.some((fold) => fold.t === pop.t && fold.dir === pop.dir && fold.id === pop.id)) {
      out.problem('R6-FOLD-01', x.where, `pop of ${pop.id} ${pop.dir} at ${pop.t} s has no fold event`)
    }
  }
  const claimed = new Set()
  for (const chime of audioLog.filter(({ harmony }) => harmony !== true)) {
    const fold = foldLog.find((candidate) => !claimed.has(candidate) && candidate.dir === 'up' && candidate.i === chime.i && candidate.j === chime.j
      && candidate.t <= chime.t + 1e-6 && chime.t - candidate.t <= 2.5)
    if (fold) claimed.add(fold)
    else out.problem('R6-FOLD-01', x.where, `chime MIDI ${chime.midi} at ${chime.t} s for ${chime.i},${chime.j} has no fold-up event before it`)
  }
  for (const cue of cueLog.filter(({ cause }) => cause === 'fold')) {
    if (!popLog.some((pop) => Math.abs(pop.t - cue.t) <= 0.01)) out.problem('R6-FOLD-01', x.where, `fold layer ${cue.cue} at ${cue.t} s has no pop`)
  }
  out.measure('R6-FOLD-01', `${x.where} sound`, { foldEvents: foldLog.length, pops: popLog.length, chimes: audioLog.filter(({ harmony }) => harmony !== true).length })
}

function analyzeFolds(x, out, pool) {
  const sink = {
    problem: (id, text) => out.problem(id, '', text),
    measure: (id, value) => Object.assign(out.results.get(id).measured, value),
    counts: (where, counts) => { for (const [name, count] of Object.entries(counts)) pool[name] = (pool[name] ?? 0) + count },
  }
  analyzeFoldSession(x.result, sink)
}

function finishFolds(pool, out) {
  const need = [
    ['R6-FOLD-01', 'lift', 'no stage-1 lift to -63° settled'], ['R6-FOLD-01', 'drop', 'no stage-1 drop to -90° settled'],
    ['R6-FOLD-02', 'up from flat', 'no stage-2 fold-up from flat was measured'], ['R6-FOLD-02', 'up from -63°', 'no stage-2 fold-up from -63° was measured'],
    ['R6-FOLD-03', 'up from flat', 'no stage-2 fold-up from flat was measured'], ['R6-FOLD-03', 'up from -63°', 'no stage-2 fold-up from -63° was measured'],
    ['R6-FOLD-04', 'down settled at -63°', 'no fold-down within 5.5 units settled at -63°'], ['R6-FOLD-04', 'down settled at -90°', 'no fold-down beyond 5.5 units settled at -90°'],
    ['R6-FOLD-05', 'stage held flat', 'no prop held flat through a dance'], ['R6-FOLD-05', 'stage settled flat', 'no prop went flat at duo-dance-start'],
  ]
  const names = { lift: 'lift settled at -63°', drop: 'drop settled at -90°' }
  for (const [id, name, text] of need) if (!pool[names[name] ?? name]) out.problem(id, '', text)
}

// ---- the whole analysis ---------------------------------------------------------------------------------------------

const sessionOf = (label) => label.split(' ')[0]

// Every R6 scenario's measured values and problems, from session results as collected by the duo gate and by runRound6Sessions.
export function analyzeRound6(results, ctx, { blocked = [] } = {}) {
  const out = createResults()
  const pools = { camera: newCameraPool(), character: newCharacterPool(), audio: newAudioPool(), folds: {} }
  const fixedSeen = results.some(({ label }) => /^fixed-camera/.test(label))
  const guard = (x, ids, fn) => {
    try {
      fn()
    } catch (error) {
      for (const id of ids) out.problem(id, x.where, `analysis failed: ${firstLine(error)}`)
    }
  }
  for (const { session, ids, error, where } of blocked) for (const id of ids) out.problem(id, where, `blocked by ${session}: ${error}`)
  for (const result of results) {
    for (const { phase, ids, error } of round6SessionScenarios[sessionOf(result.label)] ? result.failures ?? [] : []) {
      for (const id of ids) out.problem(id, result.label, `blocked by ${sessionOf(result.label)}/${phase}: ${error}`)
    }
    let x
    try {
      x = prepare(result)
    } catch (error) {
      for (const [id] of round6Scenarios) out.problem(id, result.label, firstLine(error))
      continue
    }
    guard(x, ['R6-CAM-01', 'R6-CAM-02', 'R6-CAM-03', 'R6-CAM-04', 'R6-CAM-05', 'R6-CAM-06', 'R6-CAM-07'], () => analyzeCamera(x, out, pools.camera))
    guard(x, foldIds, () => {
      analyzeFolds(x, out, pools.folds)
      analyzeSilence(x, out)
    })
    guard(x, ['R6-CHR-01', 'R6-CHR-02', 'R6-CHR-03', 'R6-CHR-04', 'R6-CHR-05', 'R6-CHR-06', 'R6-CHR-07'],
      () => analyzeCharacters(x, out, pools.character, { look: ctx?.clips?.b?.look }))
    guard(x, ['R6-AUD-01'], () => analyzeFootsteps(x, out, pools.audio, ctx))
    if (/^hum /.test(result.label)) guard(x, ['R6-AUD-02'], () => analyzeHum(x, out, pools.audio, ctx))
  }
  if (results.length) {
    finishCamera(pools.camera, out, { fixedSeen })
    finishFolds(pools.folds, out)
    finishCharacters(pools.character, out, ctx)
    finishAudio(pools.audio, out)
  } else {
    for (const [id] of round6Scenarios) out.problem(id, '', 'no session produced a result')
  }
  return out
}

// ---- running the routes -----------------------------------------------------------------------------------------------

const routes = (viewports) => [
  ['stage', stageSession, viewports],
  ['river', riverSession, viewports.slice(0, 1)],
  ['hum', humSession, viewports.slice(0, 1)],
  ['fixed-camera', fixedCameraSession, viewports.slice(0, 1)],
]

async function closePages(browser) {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.close().catch(() => {})
}

// Runs the round-6 routes (or the named ones) and returns their results plus the routes that could not run.
export async function runRound6Sessions({ baseURL, browser, viewports = duoViewports, only }) {
  const results = []
  const blocked = []
  for (const [name, session, list] of routes(viewports)) {
    if (only && !only.includes(name)) continue
    for (const viewport of list) {
      const where = `${name} ${viewport.width}x${viewport.height}`
      try {
        const result = await session(browser, viewport, { baseURL })
        result.viewport = `${viewport.width}x${viewport.height}`
        results.push(result)
      } catch (error) {
        blocked.push({ session: name, where, ids: round6SessionScenarios[name], error: firstLine(error) })
      } finally {
        await closePages(browser)
      }
    }
  }
  return { results, blocked }
}

const MAX_PROBLEMS = 12
const clip = (problems) => (problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), `... and ${problems.length - MAX_PROBLEMS} more`] : problems)

// Reports every R6 scenario through `check`. `duoResults` are the sessions the duo gate collected (runDuo's `collect`).
// `resultsOut` writes everything the analyses read, for scripts/e2e-duo-round6-run.mjs --load.
export async function runRound6({ baseURL, check, duoResults = [], resultsOut, only }) {
  let failure
  let mine = { results: [], blocked: [] }
  const ctx = await loadContext()
  try {
    const browser = await launchChromium()
    try {
      mine = await runRound6Sessions({ baseURL, browser, only })
    } finally {
      await browser.close()
    }
  } catch (error) {
    failure = firstLine(error)
  }
  const all = [...duoResults, ...mine.results]
  if (resultsOut) {
    await mkdir(dirname(resultsOut), { recursive: true })
    await writeFile(resultsOut, JSON.stringify(all))
  }
  if (mine.blocked.length) {
    console.log('Round-6 routes that did not run (each fails only the listed scenarios):')
    for (const { where, ids, error } of mine.blocked) console.log(`  ${where} -> ${ids.join(', ')}: ${error}`)
  }
  const out = analyzeRound6(all, ctx, { blocked: mine.blocked })
  for (const [id] of round6Scenarios) {
    const { measured, problems } = out.results.get(id)
    check(round6Titles.get(id), measured, () => {
      if (failure) assert.fail(`not reached: ${failure}`)
      assert.deepEqual(clip(problems), [])
    })
  }
}
