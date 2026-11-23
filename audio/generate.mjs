import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { decode, inspect, probe, processTake, retunedPitch, verifyMediaTools } from './media.js'
import { detectPitch, medianPitch } from './pitch.js'
import { buildManifest, coverageResult, coverageTargets, designRequests, estimateCredits, planTakes, rawName,
  saveVoiceRequest, SFX, summarizeCalls, sungValid, takeRequest, TTS } from './plan.js'
import { elevenLabs, freeJson, readSpend, reconcileSpend, spendDecision, spendGuard } from './spend.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEGACY_ROUND = 5
const boardPath = round => `deliverables/round-${round}`
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)
const emptyManifest = { version: 1, cues: {} }
const quote = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' && arguments.length > 1) return fallback
    throw error
  }
}

function write(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, data)
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

const writeJson = (file, value) => write(file, JSON.stringify(value, null, 2) + '\n')

function list(directory) {
  try {
    return readdirSync(directory).sort()
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function paths(root, round) {
  return {
    sheet: join(root, 'audio/cues.json'),
    voices: { a: join(root, 'audio/voice.json'), b: join(root, 'audio/voice-b.json') },
    candidates: { a: join(root, 'audio/voice-candidates.json'), b: join(root, 'audio/voice-b-candidates.json') },
    raw: join(root, '.handoff/audio-raw'),
    public: join(root, 'public/audio'),
    boardPath: boardPath(round),
    board: join(root, boardPath(round)),
    smoke: join(root, '.handoff/evidence/G1/smoke'),
  }
}

function takeNumber(cue, src) {
  const prefix = `${cue}-`
  if (typeof src !== 'string' || !src.startsWith(prefix)) return null
  const take = Number(/^([1-9]\d*)\.mp3$/.exec(src.slice(prefix.length))?.[1])
  return Number.isSafeInteger(take) ? take : null
}

function soundboard(sheet, files, manifest) {
  const groups = new Map()
  const player = (label, src, description) =>
    `<article><h3>${quote(label)}</h3><p>${quote(description)}</p><audio controls preload="none" src="${quote(src)}"></audio></article>`
  for (const cue of sheet.cues) {
    for (const { src } of manifest.cues[cue.cue]?.files ?? []) {
      const take = takeNumber(cue.cue, src)
      if (!take) continue
      const text = cue.prompt ?? cue.texts[(take - 1) % cue.texts.length]
      const heading = cue.voice ? `Voice ${cue.voice.toUpperCase()}` : cue.kind
      const players = groups.get(heading) ?? []
      players.push(player(`${cue.cue} · take ${take}`, `../../public/audio/${src}`, text))
      groups.set(heading, players)
    }
  }
  for (const [who, file] of Object.entries(files.candidates)) {
    const candidates = readJson(file, []).filter(candidate => safeId(candidate.id))
    groups.set(`Voice ${who.toUpperCase()} candidates`, candidates.map(({ id, brief, medianF0Hz, voicedRatio, file }) =>
      // Voice A's round-4 candidates predate the per-round board and carry no file path.
      player(id, `${who === 'a' && !file ? '../round-4/voice-candidates' : 'voice-candidates'}/${id}.mp3`,
        `${brief} · F0 ${medianF0Hz?.toFixed(1) ?? 'unvoiced'} Hz · ${(voicedRatio * 100).toFixed(0)}% voiced`)))
  }
  const proceduralDirectory = '../round-4/procedural'
  const procedural = list(join(files.board, proceduralDirectory)).filter(file => /\.mp3$/i.test(file))
  groups.set('Procedural', procedural.map(file =>
    player(basename(file, '.mp3'), `${proceduralDirectory}/${encodeURIComponent(file)}`, '')))
  const sections = [...groups].filter(([, players]) => players.length)
    .map(([kind, players]) => `<section><h2>${quote(kind)}</h2><div>${players.join('\n')}</div></section>`)
  write(join(files.board, 'soundboard.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Pop-up Atlas soundboard</title>
<style>
body { font: 1rem system-ui, sans-serif; margin: 2rem auto; padding: 0 1rem; max-width: 70rem; }
section div { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: 1rem; }
article { padding: 1rem; border: 1px solid #8886; border-radius: .5rem; }
h3 { margin: 0; } audio { width: 100%; }
</style>
<main><h1>Pop-up Atlas soundboard</h1>
${sections.join('\n')}
</main></html>\n`)
}

async function verifyModels(send, required) {
  const models = await freeJson(send, '/v1/models')
  for (const model of required) {
    if (!models.some(entry => entry.model_id === model && entry.can_do_text_to_speech !== false)) {
      throw new Error(`TTS model ${model} absent from GET /v1/models`)
    }
  }
}

function designPlan(sheet, files, whos) {
  return designRequests(sheet, whos).map(request => {
    const directory = join(files.raw, 'voice-design', request.key)
    return { request, directory, index: join(directory, 'previews.json') }
  })
}

async function designVoices(designs, files, paid) {
  const candidates = { a: [], b: [] }
  for (const { request, directory, index } of designs) {
    if (!existsSync(index)) {
      await paid(request, async response => {
        const payload = await response.json()
        if (!payload.previews?.length) throw new Error('ElevenLabs returned no voice previews')
        const previews = payload.previews.map(({ generated_voice_id: id, audio_base_64: audio }) => {
          if (!safeId(id) || !audio) throw new Error('Invalid ElevenLabs voice preview')
          write(join(directory, id + '.mp3'), Buffer.from(audio, 'base64'))
          return id
        })
        writeJson(index, previews)
      }, () => existsSync(index))
    }
    for (const id of readJson(index)) {
      if (!safeId(id)) throw new Error('Invalid cached voice preview id')
      const raw = join(directory, id + '.mp3')
      const file = `${files.boardPath}/voice-candidates/${id}.mp3`
      const destination = join(files.board, 'voice-candidates', id + '.mp3')
      const { medianF0Hz, voicedRatio } = detectPitch(decode(raw))
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(raw, destination)
      candidates[request.who].push({ id, brief: request.body.voice_description, medianF0Hz, voicedRatio, file })
    }
  }
  for (const who of new Set(designs.map(design => design.request.who))) {
    writeJson(files.candidates[who], candidates[who])
    console.log(`Voice ${who.toUpperCase()} candidates`)
    console.table(candidates[who].map(({ brief, ...candidate }) => candidate))
  }
  return candidates
}

function selectVoice(voice, candidates, id) {
  if (id) {
    const candidate = candidates.find(entry => entry.id === id)
    if (!candidate) throw new Error(`Unknown voice candidate ${id}`)
    return { candidate, reason: 'Selected explicitly with --pick.' }
  }
  const [min, max] = voice.targetPitchHz
  const [candidate] = candidates.filter(entry =>
    Number.isFinite(entry.medianF0Hz) && entry.medianF0Hz >= min && entry.medianF0Hz <= max)
    .sort((a, b) => b.voicedRatio - a.voicedRatio)
  if (!candidate) throw new Error(`No candidate has a median F0 in ${min}–${max} Hz. Use --pick to select one explicitly.`)
  const reason = `Auto-picked the highest voiced ratio (${(candidate.voicedRatio * 100).toFixed(1)}%) `
    + `among candidates in ${min}–${max} Hz (median F0 ${candidate.medianF0Hz.toFixed(1)} Hz).`
  return { candidate, reason }
}

function savedVoice(file) {
  const record = readJson(file, null)
  return safeId(record?.voice_id) ? record : null
}

async function saveVoice(voice, who, file, candidate, reason, paid, replace) {
  if (!voice.briefs.includes(candidate.brief)) throw new Error('Selected voice brief is absent from audio/cues.json.')
  await paid(saveVoiceRequest(voice, candidate, who), async response => {
    const { voice_id } = await response.json()
    if (!safeId(voice_id)) throw new Error('ElevenLabs did not return a saved voice id')
    writeJson(file, { voice_id, generated_voice_id: candidate.id, brief: candidate.brief, reason })
  }, () => {
    const current = savedVoice(file)
    // An explicit pick or a redesign replaces whatever is saved, so only the same preview counts as done.
    return current && (!replace || current.generated_voice_id === candidate.id)
  })
  console.log(reason)
}

async function acquireTake(paid, request, file) {
  await paid(request, async response => {
    const audio = Buffer.from(await response.arrayBuffer())
    if (!audio.length) throw new Error(`Empty ElevenLabs audio for ${request.cue} take ${request.take}`)
    write(file, audio)
  }, () => existsSync(file))
}

async function ship(sheet, files, plan, paid) {
  const manifestFile = join(files.public, 'manifest.json')
  const previous = readJson(manifestFile, emptyManifest)
  const reused = {}
  const results = []
  const sungWindows = []
  for (const { cue, hits, pending, selected } of plan) {
    if (!selected && previous.cues[cue.cue]?.files?.length) {
      reused[cue.cue] = { ...previous.cues[cue.cue], ...(cue.voice ? { who: cue.voice } : {}) }
      continue
    }
    const directory = join(files.raw, cue.cue)
    for (const request of pending) {
      await acquireTake(paid, request, join(directory, rawName(request)))
    }
    const takes = []
    const requests = [...hits, ...pending].sort((a, b) => a.take - b.take)
    for (const request of requests) {
      const row = cue.sung ? { cue: cue.cue, take: request.take } : null
      if (row) sungWindows.push(row)
      try {
        const measured = processTake(join(directory, rawName(request)), cue)
        if (row) {
          const { windowStart, medianF0Hz, baseMidi, stability, voicedRatio } = measured
          const accepted = sungValid(measured)
          Object.assign(row, { windowStart, baseMidi, stability, voicedRatio })
          writeJson(join(directory, `${request.key}-${request.take}.pitch.json`),
            { windowStart, medianF0Hz, baseMidi, stability, voicedRatio, accepted })
        }
        takes.push({ take: request.take, ...measured })
      } catch (error) {
        console.error(`Dropped ${cue.cue} take ${request.take}: ${error.message}`)
      }
    }
    if (!takes.some(take => !cue.sung || sungValid(take))) console.error(`No valid takes for ${cue.cue}`)
    const voiceId = cue.voice ? requests[0]?.voiceId : undefined
    if (requests.length && cue.voice && !safeId(voiceId)) throw new Error(`No saved voice id for ${cue.cue}`)
    results.push({ cue, takes, voiceId })
  }
  const manifest = buildManifest(results)
  Object.assign(manifest.cues, reused)
  const shipped = new Set(Object.values(reused).flatMap(group => group.files.map(file => file.src)))
  for (const { cue, takes } of results) {
    for (const { src } of manifest.cues[cue.cue]?.files ?? []) {
      const target = join(files.public, src)
      const { audio } = takes.find(take => take.take === takeNumber(cue.cue, src))
      if (!existsSync(target) || !audio.equals(readFileSync(target))) write(target, audio)
      shipped.add(src)
    }
  }
  writeJson(manifestFile, manifest)
  const managed = new Set(sheet.cues.map(cue => cue.cue))
  for (const cue of Object.keys(previous.cues)) if (safeId(cue)) managed.add(cue)
  for (const file of list(files.public)) {
    const match = /^([A-Za-z0-9_-]+)-[1-9]\d*\.mp3$/.exec(file)
    if (managed.has(match?.[1]) && !shipped.has(file)) rmSync(join(files.public, file))
  }
  soundboard(sheet, files, manifest)
  if (sungWindows.length) {
    console.table(sungWindows.map(({ cue, take, windowStart, baseMidi, stability, voicedRatio }) => ({
      cue, take, startSeconds: rounded(windowStart), baseMidi: rounded(baseMidi),
      stabilityCents: rounded(stability), voicedRatio: rounded(voicedRatio),
      result: shipped.has(`${cue}-${take}.mp3`) ? 'kept' : 'dropped',
    })))
  }
}

const rounded = value => Number.isFinite(value) ? Number(value.toFixed(2)) : '—'

function check(sheet, files) {
  const manifest = readJson(join(files.public, 'manifest.json'), emptyManifest)
  const assets = []
  const coverage = []
  const accounted = new Set()
  const spokenB = []
  const selected = Object.fromEntries(['a', 'b'].map(who => [who, savedVoice(files.voices[who])?.voice_id]))
  let pass = manifest.version === 1
  for (const cue of sheet.cues) {
    const group = manifest.cues[cue.cue]
    const takes = group?.files ?? []
    const candidates = []
    if (!takes.length || group.kind !== cue.kind || group.gain !== cue.gain || group.who !== cue.voice) {
      assets.push({ cue: cue.cue, result: takes.length ? 'kind, gain or voice mismatch' : 'missing shipped cue' })
      pass = false
    }
    for (const take of takes) {
      const name = take.src
      if (!takeNumber(cue.cue, name) || accounted.has(name)) {
        assets.push({ cue: cue.cue, result: 'invalid or duplicate manifest src' })
        pass = false
        continue
      }
      accounted.add(name)
      if (cue.voice && (!selected[cue.voice] || take.voice_id !== selected[cue.voice])) {
        assets.push({ cue: cue.cue, file: name, result: `voice_id mismatch: take ${take.voice_id ?? 'none'}, `
          + `selected ${selected[cue.voice] ?? 'none'} for voice ${cue.voice.toUpperCase()}` })
        pass = false
      }
      const file = join(files.public, name)
      try {
        const measureSpokenPitch = cue.voice === 'b' && !cue.sung
        const measured = inspect(file, { ...cue, measureSpokenPitch })
        if (measureSpokenPitch) spokenB.push(...measured.voicedF0Hz)
        const valid = measured.pass && (!cue.sung || (sungValid(measured) && Number.isFinite(take.baseMidi)))
        pass &&= valid
        assets.push({ cue: cue.cue, file: name, onsetMs: rounded(measured.startMs), peakDbfs: rounded(measured.peakDbfs),
          kbps: measured.kbps, result: valid ? 'pass' : 'fail' })
        if (valid && cue.sung) candidates.push({ file, name, baseMidi: take.baseMidi })
      } catch (error) {
        assets.push({ cue: cue.cue, file: name, result: error.message.split('\n')[0] })
        pass = false
      }
    }
    for (const target of coverageTargets(cue.cue)) {
      const closest = Math.min(...candidates.map(take => Math.abs(take.baseMidi - target)))
      let covered = closest <= 4
      for (const take of candidates) {
        const result = coverageResult(take.baseMidi, target, rate => retunedPitch(take.file, rate))
        coverage.push({ cue: cue.cue, target, file: take.name, shift: rounded(result.shift),
          cents: rounded(result.cents), result: result.pass ? 'pass' : Math.abs(result.shift) > 4 ? 'out of range' : 'fail' })
        if (Math.abs(result.shift) === closest) covered &&= result.pass
      }
      if (!covered) coverage.push({ cue: cue.cue, target, result: 'uncovered' })
      pass &&= covered
    }
  }
  if (sheet.cues.some(cue => cue.voice === 'b' && !cue.sung)) {
    const [min, max] = sheet.voices.b.targetPitchHz
    const median = medianPitch(spokenB)
    const valid = median !== null && median >= min && median <= max
    assets.push({ cue: 'Voice B', medianF0Hz: rounded(median), targetHz: `${min}-${max}`, result: valid ? 'pass' : 'fail' })
    pass &&= valid
  }
  let bytes = 0
  for (const file of list(files.public).filter(name => /\.mp3$/i.test(name))) {
    bytes += statSync(join(files.public, file)).size
    if (!accounted.has(file)) {
      assets.push({ file, result: 'unreferenced MP3' })
      pass = false
    }
  }
  for (const cue of Object.keys(manifest.cues)) {
    if (!sheet.cues.some(item => item.cue === cue)) {
      assets.push({ cue, result: 'unknown manifest cue' })
      pass = false
    }
  }
  console.table(assets)
  console.table(coverage)
  console.log(`Shipped audio: ${bytes} / 2000000 bytes`)
  if (!pass || bytes > 2_000_000) throw new Error('Audio check failed')
}

function smokePlan(sheet, voiceId) {
  const sfx = sheet.cues.find(cue => cue.source === 'sfx' && cue.duration === 0.5)
  const sung = sheet.cues.find(cue => cue.voice === 'a' && cue.sung
    && cue.texts.some(text => /^\[sings\]/i.test(text) && text.length <= 20))
  if (!sfx || !sung) throw new Error('The cue sheet must provide a 0.5 s effect and a short [sings] line')
  const line = sung.texts.findIndex(text => /^\[sings\]/i.test(text) && text.length <= 20) + 1
  return [{ cue: sfx, request: takeRequest(sheet, sfx, 1) },
    { cue: sung, request: takeRequest(sheet, sung, line, voiceId) }]
}

async function smokeTest(sheet, files, ledger, send, paid) {
  const problems = []
  const plan = smokePlan(sheet, '<premade_voice_id>')
  for (const { cue, request: provisional } of plan) {
    try {
      const successful = call => call.row === 'G1' && call.purpose === 'G1 smoke test'
        && call.cue === cue.cue && call.outcome === 'ok'
      const existing = readSpend(ledger).findLast(successful)
      let request = provisional
      if (cue.source === 'tts') {
        let voiceId = existing?.endpoint.startsWith(TTS) ? existing.endpoint.slice(TTS.length) : null
        if (!existing) {
          await verifyModels(send, [sheet.voices.a.ttsModel])
          const { voices } = await freeJson(send, '/v1/voices?show_legacy=true')
          const premade = voices.filter(voice => voice.category === 'premade' && safeId(voice.voice_id))
          voiceId = (premade.find(voice => voice.name === 'Bella') ?? premade[0])?.voice_id
        }
        if (!safeId(voiceId)) throw new Error('No premade voice available for the smoke line')
        request = takeRequest(sheet, cue, request.take, voiceId)
      }
      const base = join(files.smoke, cue.cue)
      const raw = join(files.smoke, cue.cue + '-' + rawName(request))
      if (existing && (existing.key !== request.key || !existsSync(raw))) {
        throw new Error(`Paid smoke response for ${cue.cue} has no raw file matching the current inputs`)
      }
      if (!existsSync(raw)) await acquireTake(paid, { ...request, purpose: 'G1 smoke test' }, raw)
      const record = readSpend(ledger).findLast(successful)
      if (['header', 'character-cost'].includes(record?.credits_source)) {
        const sfx = request.endpoint === SFX
        const rate = record.credits / (sfx ? request.body.duration_seconds : request.body.text.length)
        // Replace only the null rates or the measured values, preserving the cue sheet byte-for-byte otherwise.
        const field = sfx ? 'sfxCreditsPerSecond' : 'ttsCreditsPerChar'
        const contents = readFileSync(files.sheet, 'utf8')
        const rates = /"rates"\s*:\s*\{[^}]*\}/.exec(contents)?.[0]
        const pattern = new RegExp(`("${field}"\\s*:\\s*)(null|[0-9]+(?:\\.[0-9]+)?(?:e[+-]?[0-9]+)?)`, 'i')
        if (!rates || !pattern.test(rates)) throw new Error(`Missing rates.${field} in cue sheet`)
        const updated = rates.replace(pattern, (_, prefix) => prefix + rate)
        if (updated !== rates) write(files.sheet, contents.replace(rates, updated))
      } else {
        problems.push(`${cue.cue}: no measured character-cost header`)
      }
      const { audio } = processTake(raw, cue)
      const output = base + '.mp3'
      write(output, audio)
      const metadata = probe(output)
      const measured = inspect(output, cue, metadata)
      writeJson(base + '.ffprobe.json', metadata)
      const coverage = coverageTargets(cue.cue).map(target => ({
        target, ...coverageResult(measured.baseMidi, target, rate => retunedPitch(output, rate)),
      }))
      writeJson(base + '.measurements.json', { ...measured, ...(cue.sung ? { sungPass: sungValid(measured), coverage } : {}),
        credits: record?.credits, creditsSource: record?.credits_source })
      console.table([{ cue: cue.cue, ...measured, ...(cue.sung ? { sungPass: sungValid(measured) } : {}) }])
      if (coverage.length) console.table(coverage)
    } catch (error) {
      problems.push(error.message)
      readSpend(ledger)
    }
  }
  if (problems.length) throw new Error(problems.join('\n'))
}

// spend.js enforces the per-round cap for round 5 only; later rounds are enforced here.
function roundCapRefusal(calls, estimate, { round, roundCap }) {
  if (round === LEGACY_ROUND) return null
  const spent = calls.filter(call => call.round === round).reduce((sum, call) => sum + call.credits, 0)
  return spent + estimate > roundCap ? `Round ${round} spend cap of ${roundCap} credits exceeded` : null
}

const refusal = (calls, estimate, guard) => roundCapRefusal(calls, estimate, guard) ?? spendDecision(calls, estimate, guard)

function withRoundCap(paid, guard) {
  if (guard.round === LEGACY_ROUND) return paid
  // The skip callback runs inside spendGuard's ledger lock, after it has read the ledger.
  return (request, receive, skip = () => false) => paid(request, receive, () => {
    if (skip()) return true
    const reason = roundCapRefusal(readSpend(guard.ledger), estimateCredits(request.endpoint, request.body, guard.rates), guard)
    if (reason) throw new Error(reason)
    return false
  })
}

function printPlan(requests, sheet, guard, blocked) {
  const { calls, totals, total } = summarizeCalls(requests, sheet.rates)
  let spent = []
  try {
    spent = readSpend(guard.ledger)
  } catch (error) {
    blocked ??= error.message
  }
  for (const call of calls) {
    blocked ??= refusal(spent, call.estimate, guard)
    call.guard = blocked ? `refuse: ${blocked}` : guard.budget === Infinity ? 'requires --budget' : 'allow'
    if (!blocked) spent.push({ row: guard.row, round: guard.round, run_id: guard.runId, credits: call.estimate })
  }
  console.table(calls)
  console.table(totals)
  console.log(`Conservative total: ${total} credits (${calls.length} paid calls)`)
}

const usage = 'Usage: node audio/generate.mjs [--dry-run] [--check | --soundboard | --design [a,b] | --pick a:ID,b:ID | --smoke | --reconcile] '
  + '[--only A,B] [--retake A] [--round N] [--row V6] [--budget CREDITS] [--round-cap 3000] [--cap 15000] [--ledger PATH]'

const WHO = ['a', 'b']

function parseDesign(value) {
  const names = value.split(',').map(name => name.trim()).filter(Boolean)
  if (!names.every(name => WHO.includes(name))) throw new Error('--design takes voices a and/or b, e.g. --design a,b')
  return new Set(names)
}

function parsePicks(value) {
  const picks = {}
  for (const part of value.split(',')) {
    const [, who, id] = /^([ab]):([A-Za-z0-9_-]+)$/.exec(part.trim()) ?? []
    if (!who || who in picks) throw new Error('--pick takes one who:ID per voice, e.g. --pick a:ID,b:ID')
    picks[who] = id
  }
  return picks
}

export async function main(args = process.argv.slice(2), root = ROOT) {
  // A bare --design (no voice list) designs only the voices that have no saved id.
  const argv = args.flatMap((arg, index) =>
    arg === '--design' && (args[index + 1] === undefined || args[index + 1].startsWith('--')) ? ['--design='] : [arg])
  const { values: options } = parseArgs({ args: argv, options: {
    'dry-run': { type: 'boolean' }, check: { type: 'boolean' }, soundboard: { type: 'boolean' },
    design: { type: 'string' }, pick: { type: 'string' }, smoke: { type: 'boolean' }, help: { type: 'boolean' },
    reconcile: { type: 'boolean' },
    only: { type: 'string' }, retake: { type: 'string' }, row: { type: 'string' }, round: { type: 'string' },
    budget: { type: 'string' }, cap: { type: 'string', default: '15000' },
    'round-cap': { type: 'string', default: '3000' },
    ledger: { type: 'string', default: '.handoff/evidence/audio-spend.jsonl' },
  } })
  if (options.help) return console.log(usage)
  const redesign = options.design === undefined ? new Set() : parseDesign(options.design)
  const picks = options.pick === undefined ? {} : parsePicks(options.pick)
  if (WHO.some(who => redesign.has(who) && picks[who])) throw new Error('--design and --pick cannot name the same voice')
  const voiceMode = options.design !== undefined || options.pick !== undefined
  const cueMode = options.only !== undefined || options.retake !== undefined
  const modes = [options.check, options.soundboard, voiceMode, options.smoke, options.reconcile].filter(Boolean)
  if (modes.length > 1 || (cueMode && modes.length)
      || (options['dry-run'] && (options.check || options.soundboard || options.reconcile))) throw new Error(usage)

  const ledger = resolve(root, options.ledger)
  const connect = () => elevenLabs(process.env.ELEVENLABS_API_KEY)
  if (options.reconcile) {
    const record = await reconcileSpend(ledger, connect)
    return console.log(record ? `Reconciled ${record.call_id} at ${record.credits} credits (${record.credits_source})`
      : 'No unresolved paid call')
  }

  const sheet = readJson(join(root, 'audio/cues.json'))
  // --round wins over the cue sheet's round field. Sheets without one keep the round-5 ledger and board.
  const round = options.round === undefined ? sheet.round ?? LEGACY_ROUND : Number(options.round)
  if (!Number.isSafeInteger(round) || round < 1 || (options.round !== undefined && !/^[1-9]\d*$/.test(options.round))) {
    throw new Error('--round (or the cue sheet round) requires a positive integer')
  }
  const files = paths(root, round)
  for (const who of WHO) {
    const voice = sheet.voices?.[who]
    const range = voice?.targetPitchHz
    if (!voice?.ttsModel || !Array.isArray(range) || range.length !== 2
        || !range.every(Number.isFinite) || range[0] <= 0 || range[0] > range[1]) {
      throw new Error(`Invalid voice ${who} in audio/cues.json`)
    }
  }
  const names = new Set()
  for (const { cue, kind, source, voice, takes, keep } of sheet.cues) {
    if (!safeId(cue) || names.has(cue) || !Number.isSafeInteger(takes) || !Number.isSafeInteger(keep)
        || keep < 1 || takes < keep) throw new Error(`Invalid cue or take count for ${cue}`)
    if (kind === 'voice' || source === 'tts') {
      if (kind !== 'voice' || source !== 'tts' || !['a', 'b'].includes(voice) || cue.startsWith('b_') !== (voice === 'b')) {
        throw new Error(`Invalid voice assignment for ${cue}`)
      }
    } else if (voice !== undefined) throw new Error(`Unexpected voice assignment for ${cue}`)
    names.add(cue)
  }
  const manifestFile = join(files.public, 'manifest.json')
  if (options.check) {
    verifyMediaTools()
    return check(sheet, files)
  }
  if (options.soundboard) return soundboard(sheet, files, readJson(manifestFile, emptyManifest))

  const voiceIds = Object.fromEntries(Object.entries(files.voices).map(([who, file]) => [who, savedVoice(file)?.voice_id]))
  const makePlan = () => planTakes(sheet, {
    only: options.only?.split(',').map(name => name.trim()), retake: options.retake,
    voiceIds,
    cached: Object.fromEntries(sheet.cues.map(cue => [cue.cue, list(join(files.raw, cue.cue))])),
  })
  let plan = (voiceMode || options.smoke) ? [] : makePlan()
  const pending = plan.flatMap(group => group.pending)
  const needsVoices = new Set(plan.filter(group => group.cue.voice && group.pending.length).map(group => group.cue.voice))
  const missingA = needsVoices.has('a') && !voiceIds.a ? 'Voice A requires its saved ID in audio/voice.json.' : null
  // Redesigned voices ignore their saved id. Otherwise a voice is designed only when it has none: B on demand
  // when cues need it (the long-standing behaviour), either voice under a bare --design.
  const designed = WHO.filter(who => !picks[who] && (redesign.has(who)
    || (!voiceIds[who] && (options.design !== undefined || (who === 'b' && needsVoices.has('b'))))))
  const designs = designed.length ? designPlan(sheet, files, designed) : []
  const explicit = Object.fromEntries(Object.entries(picks).map(([who, id]) =>
    [who, selectVoice(sheet.voices[who], readJson(files.candidates[who], []), id)]))
  const touched = WHO.filter(who => explicit[who] || designed.includes(who))
  const number = value => value?.trim() ? Number(value) : NaN
  const guard = {
    ledger, row: options.row ?? (options.smoke ? 'G1' : `V${round}`), round,
    cap: number(options.cap), budget: number(options.budget), roundCap: number(options['round-cap']),
    maxCalls: options.smoke ? 3 : Infinity,
  }
  for (const flag of ['cap', 'round-cap', ...(options.budget === undefined ? [] : ['budget'])]) {
    const amount = number(options[flag])
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`--${flag} requires a non-negative integer`)
  }
  if (guard.row === 'G1' && (!options.smoke || guard.budget > 300)) {
    throw new Error('G1 is reserved for --smoke, with a budget up to 300 credits.')
  }
  if (options.smoke && guard.row !== 'G1') throw new Error('--smoke requires row G1')

  if (options['dry-run']) {
    const create = who => explicit[who] ? savedVoice(files.voices[who])?.generated_voice_id !== explicit[who].candidate.id
      : designed.includes(who)
    const requests = options.smoke ? smokePlan(sheet, '<premade_voice_id>').map(item => item.request)
      : [
          ...designs.filter(item => !existsSync(item.index)).map(item => item.request),
          ...WHO.filter(create).map(who =>
            saveVoiceRequest(sheet.voices[who], explicit[who]?.candidate ?? { id: '<candidate_id>' }, who)),
          ...pending,
        ]
    console.log(`Round ${round}, row ${guard.row}`)
    return printPlan(requests, sheet, { ...guard, runId: 'dry-run',
      budget: options.budget === undefined ? Infinity : guard.budget }, missingA)
  }

  if (missingA) throw new Error(missingA)
  if (options.design !== undefined && !touched.length) return console.log('The requested voices are already saved.')
  if (!voiceMode || designs.length) verifyMediaTools()
  if (!voiceMode && !options.smoke && !pending.length) return ship(sheet, files, plan)
  readSpend(ledger)
  const send = connect()
  const paid = withRoundCap(spendGuard({ ...guard, rates: sheet.rates, send }), { ...guard, rates: sheet.rates })
  if (options.smoke) return smokeTest(sheet, files, ledger, send, paid)
  if (needsVoices.size) await verifyModels(send, new Set([...needsVoices].map(who => sheet.voices[who].ttsModel)))
  if (touched.length) {
    const candidates = designs.length ? await designVoices(designs, files, paid) : {}
    soundboard(sheet, files, readJson(manifestFile, emptyManifest))
    const failures = []
    for (const who of touched) {
      try {
        const { candidate, reason } = explicit[who] ?? selectVoice(sheet.voices[who], candidates[who])
        await saveVoice(sheet.voices[who], who, files.voices[who], candidate, reason, paid,
          Boolean(explicit[who]) || redesign.has(who))
      } catch (error) {
        failures.push(`Voice ${who.toUpperCase()}: ${error.message}`)
      }
    }
    if (failures.length) throw new Error(failures.join('\n'))
    if (voiceMode) return
    for (const who of touched) voiceIds[who] = savedVoice(files.voices[who]).voice_id
    plan = makePlan()
  }
  await ship(sheet, files, plan, paid)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
