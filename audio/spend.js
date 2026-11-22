import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { estimateCredits } from './plan.js'

const origin = 'https://api.elevenlabs.io'
const subscription = '/v1/user/subscription'
const stamp = () => new Date().toISOString()
const validCredits = value => Number.isSafeInteger(value) && value >= 0
const unresolved = ledger => `Unresolved paid call in ${ledger}. Run --reconcile before spending.`

function readLedger(ledger) {
  let data
  try {
    data = readFileSync(ledger, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { calls: [] }
    throw error
  }
  const calls = []
  let pending
  for (const line of data.split('\n').filter(line => line.trim())) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      throw new Error(`Invalid spend record in ${ledger}`)
    }
    if (!entry || typeof entry !== 'object') throw new Error(`Invalid spend record in ${ledger}`)
    if (pending) {
      if (!entry.outcome || entry.row !== pending.row || entry.call_id !== pending.call_id
          || !validCredits(entry.credits)) {
        throw new Error(unresolved(ledger))
      }
      calls.push({ ...pending, ...entry })
      pending = undefined
    } else if (validCredits(entry.estimate) && !entry.outcome && entry.row) {
      pending = entry
    } else {
      throw new Error(`Invalid spend record in ${ledger}`)
    }
  }
  return { calls, pending }
}

export function readSpend(ledger) {
  const { calls, pending } = readLedger(ledger)
  if (pending) throw new Error(unresolved(ledger))
  return calls
}

function append(ledger, entry) {
  const fd = openSync(ledger, 'a', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(entry) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export function elevenLabs(apiKey, fetchImpl = fetch) {
  if (!apiKey) throw new Error('Export ELEVENLABS_API_KEY before making ElevenLabs requests.')
  return (endpoint, { body, outputFormat } = {}) => {
    const url = new URL(endpoint, origin)
    if (url.origin !== origin || !url.pathname.startsWith('/v1/')) throw new Error('Invalid ElevenLabs URL')
    if (outputFormat) url.searchParams.set('output_format', outputFormat)
    return fetchImpl(url, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: { 'xi-api-key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    })
  }
}

export async function freeJson(send, endpoint) {
  let response
  try {
    response = await send(endpoint)
  } catch {
    throw new Error(`ElevenLabs ${endpoint} returned no response`)
  }
  if (!response.ok) throw new Error(`ElevenLabs ${endpoint} failed with HTTP ${response.status}`)
  return response.json()
}

async function usageSnapshot(send) {
  const { character_count: count, next_character_count_reset_unix: reset } = await freeJson(send, subscription)
  if (!validCredits(count) || !Number.isSafeInteger(reset) || reset <= Date.now() / 1000) {
    throw new Error('ElevenLabs subscription returned no usable character count or reset time.')
  }
  return { count, reset }
}

function usageCharge(estimate, before, after) {
  const reset = before.reset !== after.reset
  const delta = reset ? 0 : after.count - before.count
  return {
    credits: Math.max(estimate, delta),
    credits_source: reset ? 'estimate-period-reset' : delta >= estimate ? 'subscription-count' : 'estimate',
    subscription_after: after,
  }
}

function releaseLock(lock, owner) {
  try {
    unlinkSync(join(lock, owner))
    rmdirSync(lock)
  } catch (error) {
    // Another caller can replace the empty directory after its owner is removed.
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
  }
}

function clearDeadLock(lock) {
  const [owner] = readdirSync(lock)
  const pid = Number(/^(\d+)-[a-f0-9-]+$/.exec(owner)?.[1])
  if (!Number.isSafeInteger(pid) || pid <= 0) return
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error.code === 'ESRCH') releaseLock(lock, owner)
    else if (error.code !== 'EPERM') throw error
  }
}

async function withLedgerLock(ledger, operation, reconcile = false) {
  mkdirSync(dirname(ledger), { recursive: true })
  let target
  try {
    target = realpathSync(ledger)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    target = join(realpathSync(dirname(ledger)), basename(ledger))
  }
  const lock = target + '.lock'
  const owner = `${process.pid}-${randomUUID()}`
  const temporary = mkdtempSync(lock + '-')
  try {
    // Publish a nonempty directory atomically so even a killed owner leaves its PID.
    writeFileSync(join(temporary, owner), '')
    if (reconcile) {
      try {
        clearDeadLock(lock)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    try {
      renameSync(temporary, lock)
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
      throw new Error(`Spend ledger is locked at ${lock}. Run --reconcile if the owning process has exited.`)
    }
    try {
      return await operation(target)
    } finally {
      releaseLock(lock, owner)
    }
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
}

export function spendDecision(calls, estimate, { row, round, runId, cap, budget, roundCap, maxCalls = Infinity }) {
  const total = list => list.reduce((sum, call) => sum + call.credits, 0)
  const run = calls.filter(call => call.run_id === runId)
  if (total(calls) + estimate > cap) return `Spend cap of ${cap} credits exceeded`
  if (round === 5 && total(calls.filter(call => call.round === 5)) + estimate > roundCap) {
    return `Round 5 spend cap of ${roundCap} credits exceeded`
  }
  if (total(run) + estimate > budget) return `Run budget of ${budget} credits exceeded`
  if (calls.filter(call => call.row === row).length >= maxCalls) return `Row ${row} paid-call limit reached`
  return null
}

export function reconcileSpend(ledger, connect) {
  return withLedgerLock(ledger, async target => {
    const { pending } = readLedger(target)
    if (!pending) return null
    const before = pending.subscription_before
    if (!validCredits(before?.count)) {
      throw new Error('The unresolved call has no baseline subscription count to reconcile against.')
    }
    const after = await usageSnapshot(connect())
    if (before.reset !== after.reset || before.count > after.count) {
      throw new Error('The ElevenLabs subscription period or count changed. Spend remains unresolved.')
    }
    // The count is account-wide and may lag the timed-out request, so retain the reservation as a floor.
    const entry = { ts: stamp(), row: pending.row, call_id: pending.call_id, outcome: 'reconciled',
      ...usageCharge(pending.estimate, before, after) }
    append(target, entry)
    return entry
  }, true)
}

export function spendGuard({ ledger, row, round = 5, cap = 15_000, budget, roundCap = 3000, rates,
  maxCalls = Infinity, send }) {
  if (!row || ![cap, budget, roundCap].every(validCredits)) {
    throw new Error('Paid calls require a row and non-negative integer values for --budget, --cap and --round-cap.')
  }
  const runId = randomUUID()
  return async function paid(request, receive = response => response, skip = () => false) {
    const estimate = estimateCredits(request.endpoint, request.body, rates)
    return withLedgerLock(ledger, async target => {
      const calls = readSpend(target)
      if (skip()) return
      const refusal = spendDecision(calls, estimate, { row, round, runId, cap, budget, roundCap, maxCalls })
      if (refusal) throw new Error(refusal)
      const { endpoint, cue, take, key, purpose } = request
      const call_id = randomUUID()
      const subscription_before = await usageSnapshot(send)
      append(target, { ts: stamp(), row, round, run_id: runId, call_id, service: 'ElevenLabs',
        endpoint, cue, take, key, purpose, estimate, subscription_before })
      let response
      try {
        response = await send(endpoint, request)
      } catch {
        throw new Error(`ElevenLabs ${endpoint} returned no response. Run --reconcile for the pending ledger record.`)
      }
      const header = response.headers.get('character-cost')
      const measured = header !== null && header.trim() !== '' && validCredits(Number(header))
      const settle = charge => append(target, { ts: stamp(), row, call_id,
        request_id: response.headers.get('request-id') ?? response.headers.get('x-request-id'),
        outcome: response.ok ? 'ok' : `http_${response.status}`, ...charge })
      if (measured) settle({ credits: Number(header), credits_source: 'header' })
      try {
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`ElevenLabs ${endpoint} failed with HTTP ${response.status}`)
        }
        return await receive(response, { credits: measured ? Number(header) : estimate, measured })
      } finally {
        if (!measured) {
          let after
          try {
            // Audio responses can still be streaming when their headers arrive.
            after = await usageSnapshot(send)
          } catch (error) {
            throw new Error(`Could not read usage after ${endpoint}. Run --reconcile for the pending ledger record. ${error.message}`)
          }
          settle(usageCharge(estimate, subscription_before, after))
        }
      }
    })
  }
}
