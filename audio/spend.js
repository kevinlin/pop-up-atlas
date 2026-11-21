import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, rmdirSync,
  writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { estimateCredits } from './plan.js'

const origin = 'https://api.elevenlabs.io'
const stamp = () => new Date().toISOString()
const validCredits = value => Number.isSafeInteger(value) && value >= 0

export function readSpend(ledger) {
  let data
  try {
    data = readFileSync(ledger, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
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
        throw new Error(`Unresolved paid call in ${ledger}. Resolve it by hand before spending.`)
      }
      calls.push({ ...pending, ...entry })
      pending = undefined
    } else if (validCredits(entry.estimate) && !entry.outcome && entry.row) {
      pending = entry
    } else {
      throw new Error(`Invalid spend record in ${ledger}`)
    }
  }
  if (pending) throw new Error(`Unresolved paid call in ${ledger}. Resolve it by hand before spending.`)
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

export function spendGuard({ ledger, row, cap = 15_000, budget, rates, maxCalls = Infinity, send }) {
  if (!row || !validCredits(cap) || !validCredits(budget)) {
    throw new Error('Paid calls require a row and a non-negative integer --budget and --cap.')
  }
  return async function paid(request, receive = response => response, skip = () => false) {
    const estimate = estimateCredits(request.endpoint, request.body, rates)
    mkdirSync(dirname(ledger), { recursive: true })
    let target
    try {
      target = realpathSync(ledger)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      target = join(realpathSync(dirname(ledger)), basename(ledger))
    }
    const lock = target + '.lock'
    try {
      mkdirSync(lock)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      throw new Error(`Spend ledger is locked at ${lock}. Clear a stale lock only after checking the ledger.`)
    }
    try {
      const calls = readSpend(target)
      if (skip()) return
      const rowCalls = calls.filter(call => call.row === row)
      const total = list => list.reduce((sum, call) => sum + call.credits, 0)
      if (total(calls) + estimate > cap) throw new Error(`Spend cap of ${cap} credits exceeded`)
      if (total(rowCalls) + estimate > budget) throw new Error(`Row ${row} budget of ${budget} credits exceeded`)
      if (rowCalls.length >= maxCalls) throw new Error(`Row ${row} paid-call limit reached`)
      const { endpoint, cue, take, key, purpose } = request
      const call_id = randomUUID()
      append(target, { ts: stamp(), row, call_id, service: 'ElevenLabs', endpoint, cue, take, key, purpose, estimate })
      let response
      try {
        response = await send(endpoint, request)
      } catch {
        throw new Error(`ElevenLabs ${endpoint} returned no response. Resolve the pending ledger record before spending.`)
      }
      const header = response.headers.get('character-cost')
      const measured = header !== null && header.trim() !== '' && validCredits(Number(header))
      const credits = measured ? Number(header) : estimate
      append(target, { ts: stamp(), row, call_id, request_id: response.headers.get('request-id')
        ?? response.headers.get('x-request-id'), outcome: response.ok ? 'ok' : `http_${response.status}`,
      credits, credits_source: measured ? 'character-cost' : 'estimate' })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`ElevenLabs ${endpoint} failed with HTTP ${response.status}`)
      }
      return await receive(response, { credits, measured })
    } finally {
      rmdirSync(lock)
    }
  }
}
