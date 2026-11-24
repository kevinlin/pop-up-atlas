import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const api = 'https://openapi.tripo3d.ai/v3'
const reference = 'reference/concept-r5/tripo-input'
const modes = {
  multiview: { type: 'multiview_to_model', route: '/generation/multiview-to-model' },
  single: { type: 'image_to_model', route: '/generation/image-to-model' },
}
// Both task types have the same generation prices [no texture, standard texture].
// A generation face_limit adds no surcharge. https://developers.tripo3d.ai/en/pricing
// P1: https://docs.tripo3d.ai/get-started/pricing.html
// P2: https://developers.tripo3d.ai/en/models/p2
const models = {
  'v3.1-20260211': { maxCharge: [20, 30], faces: [1, 1_500_000] },
  'v3.0-20250812': { maxCharge: [20, 30], faces: [1, 1_000_000] },
  'v2.5-20250123': { maxCharge: [20, 30], faces: [1, 500_000] },
  'P1-20260311': { maxCharge: [40, 50], faces: [50, 20_000] },
  'P2-20260801': { maxCharge: [100, 110], faces: [48, 50_000] },
}
const terminal = new Set(['success', 'failed', 'cancelled', 'banned', 'expired'])
const knownOutcome = new Set([...terminal, 'not_submitted'])
// These HTTP/code pairs identify request-level rejection. https://developers.tripo3d.ai/en/docs/error-handling
const rejectionCodes = new Map([
  [400, [1003, 1004, 2002, 2003, 2004, 2008, 2015]],
  [401, [2, 1002]], [403, [2010]], [404, [4001]], [429, [1007, 2000]],
])
const isId = (value) => typeof value === 'string' && /^[\w-]{1,128}$/.test(value)
const isCredit = (value) => Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Number(value.toFixed(2)) === value
const cents = (value) => Math.round(value * 100)

async function requireNewDir(out) {
  try {
    await lstat(out)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error(`Output path already exists: ${out}`)
}

async function ledgerState(path, beforeId) {
  const source = await readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT' && !beforeId) return ''
    throw error
  })
  const entries = new Map()
  const invalid = () => new Error('Invalid or incomplete Tripo ledger. Submissions are blocked.')
  if (source && !source.endsWith('\n')) throw invalid()
  for (const line of source.split('\n').filter(Boolean)) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      throw invalid()
    }
    if (!isId(event?.id)) throw invalid()
    const entry = entries.get(event.id)
    if (event.phase === 'before') {
      if (entry || event.service !== 'tripo' || !isCredit(event.maxCharge)
        || event.maxCharge === 0 || !isCredit(event.balanceBefore)) throw invalid()
      if (event.id === beforeId) return [...entries.values()]
      entries.set(event.id, { ...event, taskId: null, outcome: 'unknown' })
    } else if (event.phase === 'submitted' || event.phase === 'after') {
      if (!entry || (event.taskId !== null && !isId(event.taskId))
        || (entry.taskId && entry.taskId !== event.taskId)) throw invalid()
      entry.taskId = event.taskId
      if (event.phase === 'submitted') {
        if (!entry.taskId) throw invalid()
      } else if (knownOutcome.has(event.outcome)) {
        const noSubmit = event.outcome === 'not_submitted'
        if (!isCredit(event.charged) || !(isCredit(event.balanceAfter) || (noSubmit && event.balanceAfter === null))
          || (noSubmit ? entry.taskId || event.charged !== 0 : !entry.taskId)
          || (knownOutcome.has(entry.outcome) && entry.outcome !== event.outcome)) throw invalid()
        entry.outcome = event.outcome
        entry.charged = Math.max(entry.charged ?? 0, event.charged)
      } else if (event.outcome === 'unknown') {
        entry.uncertain = true
      } else {
        throw invalid()
      }
    } else {
      throw invalid()
    }
  }
  if (beforeId) throw invalid()
  return [...entries.values()]
}

async function append(path, event) {
  const file = await open(path, 'a', 0o600)
  try {
    const line = Buffer.from(JSON.stringify(event) + '\n')
    // Use one append write so concurrent processes cannot interleave records.
    if ((await file.write(line)).bytesWritten !== line.length) throw new Error('Short ledger write')
    await file.sync()
  } finally {
    await file.close()
  }
}

function guard(entries, allocation, maxCharge) {
  const unknown = entries.filter((entry) => entry.outcome === 'unknown')
  const spent = entries.reduce((sum, entry) => sum + cents(entry.charged ?? 0), 0)
  const reserved = unknown.reduce((sum, entry) => sum + cents(entry.maxCharge), 0)
  const remaining = (cents(allocation) - spent - reserved) / 100
  let reason = null
  if (unknown.length) reason = 'Unknown Tripo outcome. Run --reconcile with the same ledger.'
  else if (remaining < maxCharge) reason = `Remaining allocation ${remaining} is below the ${maxCharge}-credit maximum.`
  return { remaining, maxCharge, allowed: reason === null, reason }
}

function tripoClient() {
  const key = process.env.TRIPO_API_KEY
  if (!key) throw new Error('Set TRIPO_API_KEY in the environment.')
  return async (route, { method = 'GET', body, signal = AbortSignal.timeout(30_000) } = {}) => {
    const headers = { Authorization: `Bearer ${key}` }
    if (typeof body === 'string') headers['Content-Type'] = 'application/json'
    let response, payload
    try {
      const result = await fetch(api + route, { method, headers, body, signal, redirect: 'error' })
      response = result.status
      if (result.ok || rejectionCodes.has(response)) payload = await result.json()
    } catch {
      throw new Error(`Tripo ${method} ${route} ${signal.aborted ? 'timed out' : 'request failed'}.`)
    }
    if (response < 200 || response >= 300 || payload?.code !== 0 || !payload.data) {
      const error = new Error(`Tripo ${method} ${route} failed (HTTP ${response}).`)
      error.rejected = rejectionCodes.get(response)?.includes(payload?.code)
      throw error
    }
    return payload.data
  }
}

async function readBalance(request, signal) {
  const { balance } = await request('/account/balance', { signal })
  if (!isCredit(balance)) throw new Error('Tripo returned an invalid credit balance.')
  return balance
}

async function getTask(request, taskId, taskType, signal) {
  const task = await request(`/tasks/${taskId}`, { signal })
  if (task.task_id !== taskId || task.type !== taskType) {
    throw new Error('Tripo returned a different task ID or type.')
  }
  return task
}

async function recordOutcome(ledger, entry, { taskId, outcome, charged, balanceAfter }) {
  await append(ledger, {
    phase: 'after', id: entry.id, taskId, outcome, charged, balanceBefore: entry.balanceBefore, balanceAfter,
  })
}

async function finishTask(ledger, entry, task, balanceAfter) {
  const taskId = task.task_id
  const outcome = task.status
  // A missing per-task charge cannot safely be inferred from a shared account balance.
  const refunded = outcome === 'failed' || outcome === 'cancelled'
  const charged = isCredit(task.credits_consumed) ? task.credits_consumed : refunded ? 0 : entry.maxCharge
  await recordOutcome(ledger, entry, { taskId, outcome, charged, balanceAfter })

  await writeFile(join(entry.out, 'task.json'), JSON.stringify({
    taskId, type: entry.type, requestParams: entry.requestParams, status: outcome,
  }, null, 2) + '\n', { flag: 'wx' })
  if (outcome !== 'success') return

  let model
  try {
    const url = new URL(task.output.model_url)
    if (url.protocol !== 'https:') throw new Error()
    const response = await fetch(url.href, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error()
    model = Buffer.from(await response.arrayBuffer())
  } catch {
    throw new Error(`GLB download failed for Tripo task ${taskId}.`)
  }
  if (model.length < 12 || model.toString('ascii', 0, 4) !== 'glTF'
    || model.readUInt32LE(4) !== 2 || model.readUInt32LE(8) !== model.length) {
    throw new Error(`Tripo task ${taskId} returned an invalid GLB.`)
  }
  await writeFile(join(entry.out, 'model.glb'), model, { flag: 'wx' })
}

function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid Tripo ledger process ID.')
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function reconcile(ledger, entries, suppliedId) {
  const unknown = entries.filter((entry) => entry.outcome === 'unknown')
  if (!unknown.length) return console.log('No unknown Tripo outcomes.')
  const missingId = suppliedId && unknown.find((entry) => !entry.taskId)
  if (suppliedId && (!missingId || entries.some((entry) => entry.taskId === suppliedId))) {
    throw new Error('--task-id must identify an unresolved submit that has no recorded Tripo task ID.')
  }
  const request = tripoClient()
  for (const entry of unknown) {
    if (!entry.uncertain && processIsRunning(entry.pid)) {
      throw new Error('The submitting process is still running. Wait for it before reconciling.')
    }
    const taskId = entry.taskId ?? (entry === missingId ? suppliedId : null)
    if (!taskId) {
      throw new Error('Find the matching task in Tripo and run --reconcile --task-id <id>.')
    }
    const task = await getTask(request, taskId, entry.type)
    if (!entry.taskId && !(Date.parse(task.created_at) >= entry.startedAt - 5_000)) {
      throw new Error('The supplied task ID predates the submit.')
    }
    const balanceAfter = await readBalance(request)
    if (!terminal.has(task.status)) throw new Error(`Tripo task ${taskId} is still unresolved.`)
    await finishTask(ledger, entry, task, balanceAfter)
    console.log(`Reconciled Tripo task ${taskId} (${task.status}).`)
  }
}

export async function run(args) {
  const { values } = parseArgs({ args, options: {
    mode: { type: 'string', default: 'multiview' },
    'model-version': { type: 'string', default: 'v3.1-20260211' },
    texture: { type: 'boolean' }, 'no-texture': { type: 'boolean' }, 'face-limit': { type: 'string' },
    out: { type: 'string' }, ledger: { type: 'string' }, allocation: { type: 'string', default: '200' },
    timeout: { type: 'string', default: '600' }, 'poll-interval': { type: 'string', default: '2' },
    'dry-run': { type: 'boolean' }, reconcile: { type: 'boolean' }, 'task-id': { type: 'string' },
    input: { type: 'string', default: reference }, prefix: { type: 'string', default: 'b' },
  } })
  if (!values.ledger) throw new Error('--ledger <path> is required.')
  const ledger = resolve(values.ledger)
  if (values.reconcile) {
    if (values['dry-run'] || values.out) throw new Error('--reconcile uses the ledger and its recorded output path.')
    if (values['task-id'] !== undefined && !isId(values['task-id'])) throw new Error('Invalid --task-id.')
    return reconcile(ledger, await ledgerState(ledger), values['task-id'])
  }
  if (values['task-id'] !== undefined) throw new Error('--task-id requires --reconcile.')
  if (!values.out) throw new Error('--out <dir> is required.')
  const out = resolve(values.out)
  await requireNewDir(out)
  if ([out, join(out, 'model.glb'), join(out, 'task.json')].includes(ledger)) {
    throw new Error('--ledger cannot share a path with an output.')
  }
  if (!Object.hasOwn(modes, values.mode)) throw new Error('--mode must be multiview or single.')
  const { type, route } = modes[values.mode]
  const model = values['model-version']
  if (!Object.hasOwn(models, model)) throw new Error('No published charge is configured for this --model-version.')
  if (values.texture && values['no-texture']) throw new Error('Choose --texture or --no-texture.')
  const texture = !values['no-texture']
  const options = { model, texture, pbr: texture }
  if (texture && model !== 'v2.5-20250123') options.texture_quality = 'standard'
  if (model.startsWith('v3.')) options.geometry_quality = 'standard'
  const { maxCharge: prices, faces: [minFaces, maxFaces] } = models[model]
  if (values['face-limit'] !== undefined) {
    const limit = Number(values['face-limit'])
    if (!Number.isInteger(limit) || limit < minFaces || limit > maxFaces) {
      throw new Error(`--face-limit must be an integer from ${minFaces} to ${maxFaces}.`)
    }
    options.face_limit = limit
  }
  const allocation = Number(values.allocation)
  if (!values.allocation.trim() || !isCredit(allocation)) throw new Error('Invalid --allocation in credits.')
  const timeout = Math.round(Number(values.timeout) * 1000)
  const interval = Math.round(Number(values['poll-interval']) * 1000)
  if (![timeout, interval].every((ms) => ms >= 1 && ms <= 2_147_483_647)) {
    throw new Error('--timeout and --poll-interval must be positive durations in seconds.')
  }
  const maxCharge = prices[Number(texture)]
  const decision = guard(await ledgerState(ledger), allocation, maxCharge)

  // Nose pointing to image left shows the troll's left profile (Tripo's `left` slot).
  const views = values.mode === 'multiview' ? { front: 'front', left: 'side', back: 'back' } : { front: 'front' }
  const files = Object.entries(views).map(([view, name]) => [view, `${values.input}/${values.prefix}-${name}.png`])
  const params = (inputs) => ({ ...options, ...(values.mode === 'multiview'
    ? { inputs: inputs.map(([view, token]) => ({ [view]: token })) }
    : { input: inputs[0][1] }) })
  if (values['dry-run']) {
    console.log(JSON.stringify({
      guard: { ...decision, allocation, liveBalance: 'unchecked (dry run)' },
      requests: [
        ...files.map(([view, file]) => ({ method: 'POST', url: api + '/files', view, file })),
        { method: 'GET', url: api + '/account/balance' },
        { method: 'POST', url: api + route, type, body: params(files.map(([view]) => [view, `<${view} file_token>`])) },
        { method: 'GET', url: api + '/tasks/<task_id>', pollIntervalSeconds: interval / 1000, timeoutSeconds: timeout / 1000 },
        { method: 'GET', url: api + '/account/balance' },
        { method: 'GET', url: '<output.model_url>' },
      ], out, ledger,
    }, null, 2))
  }
  if (!decision.allowed) throw new Error(decision.reason)
  if (values['dry-run']) return

  const request = tripoClient()
  const inputs = []
  for (const [view, file] of files) {
    const data = await readFile(fileURLToPath(new URL(`../${file}`, import.meta.url)))
    const form = new FormData()
    form.set('file', new Blob([data], { type: 'image/png' }), basename(file))
    const { file_token: token } = await request('/files', { method: 'POST', body: form })
    if (typeof token !== 'string' || !token) throw new Error('Tripo upload returned no file token.')
    inputs.push([view, token])
  }
  const balanceBefore = await readBalance(request)
  if (balanceBefore < maxCharge) throw new Error(`Tripo balance ${balanceBefore} is below the ${maxCharge}-credit maximum.`)
  await mkdir(out)
  const entry = {
    phase: 'before', id: randomUUID(), service: 'tripo', purpose: `troll B ${type}`, type, maxCharge,
    balanceBefore, requestParams: params(inputs), out, pid: process.pid, startedAt: Date.now(),
  }
  await append(ledger, entry)
  // A reservation may submit only if the ledger prefix before it still permits spending.
  const reserved = guard(await ledgerState(ledger, entry.id), allocation, maxCharge)
  if (!reserved.allowed) {
    await recordOutcome(ledger, entry, { taskId: null, outcome: 'not_submitted', charged: 0, balanceAfter: null })
    throw new Error(reserved.reason)
  }

  const signal = AbortSignal.timeout(timeout)
  let taskId = null, task, balanceAfter
  try {
    const created = await request(route, { method: 'POST', body: JSON.stringify(entry.requestParams), signal })
    if (!isId(created.task_id)) throw new Error('Tripo submit returned no valid task ID.')
    taskId = created.task_id
    // Persist the ID before polling so a killed process can still be reconciled.
    await append(ledger, { phase: 'submitted', id: entry.id, taskId })
    do {
      signal.throwIfAborted()
      task = await getTask(request, taskId, type, signal)
      if (terminal.has(task.status)) break
      await delay(interval, undefined, { signal })
    } while (true)
    balanceAfter = await readBalance(request, signal)
    signal.throwIfAborted()
  } catch (error) {
    if (!taskId && error.rejected && !signal.aborted) {
      const balanceAfterRejection = await readBalance(request, signal).catch(() => null)
      await recordOutcome(ledger, entry, {
        taskId: null, outcome: 'not_submitted', charged: 0, balanceAfter: balanceAfterRejection,
      })
      throw error
    }
    await recordOutcome(ledger, entry, { taskId, outcome: 'unknown', charged: null, balanceAfter: null })
    const reason = signal.aborted ? 'Tripo runtime cap reached.' : error.message
    throw new Error(`${reason} Outcome unknown. Run --reconcile with the same ledger.`)
  }
  await finishTask(ledger, entry, task, balanceAfter)
  if (task.status !== 'success') throw new Error(`Tripo task ${taskId} ended with status ${task.status}.`)
  console.log(`Tripo task ${taskId} saved to ${out}.`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await run(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
