import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { run } from '../scripts/tripo.mjs'

const api = 'https://openapi.tripo3d.ai/v3'
const cdn = 'https://cdn.tripo3d.ai/model.glb'
const balance = `${api}/account/balance`
const multiview = `${api}/generation/multiview-to-model`
const single = `${api}/generation/image-to-model`
const taskId = '123e4567-e89b-42d3-a456-426614174000'
const poll = `${api}/tasks/${taskId}`
const glb = Buffer.from('676c54460200000018000000040000004a534f4e7b7d2020', 'hex')
const json = (data) => Response.json({ code: 0, data })

let dir, ledger, out, fetchMock, log

function options(outDir = out, ...extra) {
  return ['--ledger', ledger, '--out', outDir, ...extra]
}

async function events() {
  return (await readFile(ledger, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
}

function mockTripo({ balanceBefore = 100, charge = 30, type = 'multiview_to_model', status = 'success', id = taskId } = {}) {
  let submitted = false
  fetchMock.mockImplementation(async (url, request) => {
    if (url === `${api}/files`) return json({ file_token: `token-${request.body.get('file').name}` })
    if (url === balance) return json({ balance: submitted ? balanceBefore - charge : balanceBefore, frozen: 0 })
    if (url === multiview || url === single) {
      submitted = true
      expect(await events()).toContainEqual(expect.objectContaining({ phase: 'before', service: 'tripo', balanceBefore }))
      return json({ task_id: id })
    }
    if (url === `${api}/tasks/${id}`) return json({
      task_id: id, type, status, credits_consumed: charge, output: { model_url: cdn },
    })
    if (url === cdn) return new Response(glb)
    throw new Error('Unexpected request')
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tripo-vitest-'))
  ledger = join(dir, 'ledger.jsonl')
  out = join(dir, 'model')
  fetchMock = vi.fn().mockRejectedValue(new Error('Unexpected request'))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TRIPO_API_KEY', 'mock-token')
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

test('refuses when ledger spend leaves less than the published maximum', async () => {
  mockTripo({ charge: 29.25 })
  await run(options())
  fetchMock.mockClear()
  const next = join(dir, 'next')
  await expect(run(options(next, '--allocation', '59.24'))).rejects.toThrow('Remaining allocation 29.99')
  expect(fetchMock).not.toHaveBeenCalled()
  await expect(lstat(next)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('refuses a live balance below the published maximum', async () => {
  mockTripo({ balanceBefore: 29.99 })
  await expect(run(options())).rejects.toThrow('Tripo balance 29.99')
  expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(multiview)
  await expect(lstat(ledger)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('journals before submit and after completion, then saves the multiview GLB and request', async () => {
  mockTripo()
  await run(options(out, '--texture', '--face-limit', '50000'))
  const requestParams = {
    model: 'v3.1-20260211', texture: true, pbr: true, texture_quality: 'standard',
    geometry_quality: 'standard', face_limit: 50_000,
    inputs: [{ front: 'token-b-front.png' }, { left: 'token-b-side.png' }, { back: 'token-b-back.png' }],
  }
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    `${api}/files`, `${api}/files`, `${api}/files`, balance, multiview, poll, balance, cdn,
  ])
  const submit = fetchMock.mock.calls.find(([url]) => url === multiview)[1]
  expect(JSON.parse(submit.body)).toEqual(requestParams)
  expect(submit.redirect).toBe('error')
  expect(fetchMock.mock.calls.at(-1)[1].headers).toBeUndefined()
  expect(await events()).toMatchObject([
    { phase: 'before', service: 'tripo', purpose: 'troll B multiview_to_model', maxCharge: 30, balanceBefore: 100 },
    { phase: 'submitted', taskId },
    { phase: 'after', taskId, outcome: 'success', charged: 30, balanceBefore: 100, balanceAfter: 70 },
  ])
  const metadata = await readFile(join(out, 'task.json'), 'utf8')
  expect(JSON.parse(metadata)).toEqual({ taskId, type: 'multiview_to_model', requestParams, status: 'success' })
  expect(metadata + await readFile(ledger, 'utf8')).not.toContain('mock-token')
  expect(await readFile(join(out, 'model.glb'))).toEqual(glb)
})

test('single mode uploads the front only and disables PBR with texture', async () => {
  mockTripo({ charge: 100, type: 'image_to_model' })
  await run(options(out, '--mode', 'single', '--model-version', 'P2-20260801', '--no-texture', '--allocation', '100'))
  const calls = fetchMock.mock.calls
  expect(calls.filter(([url]) => url === `${api}/files`)).toHaveLength(1)
  expect(JSON.parse(calls.find(([url]) => url === single)[1].body)).toEqual({
    model: 'P2-20260801', texture: false, pbr: false, input: 'token-b-front.png',
  })
  expect((await events())[0].maxCharge).toBe(100)
})

test('timeout records unknown, blocks new submits, and reconciles only after the task becomes terminal', async () => {
  mockTripo({ status: 'running' })
  await expect(run(options(out, '--timeout', '0.2', '--poll-interval', '0.02'))).rejects.toThrow('runtime cap')
  expect((await events()).at(-1)).toMatchObject({
    phase: 'after', taskId, outcome: 'unknown', balanceBefore: 100, balanceAfter: null,
  })
  fetchMock.mockClear()
  const next = join(dir, 'next')
  await expect(run(options(next))).rejects.toThrow('Unknown Tripo outcome')
  expect(fetchMock).not.toHaveBeenCalled()

  const reconciliation = ['--ledger', ledger, '--reconcile']
  await expect(run(reconciliation)).rejects.toThrow('still unresolved')
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([poll, balance])
  mockTripo({ balanceBefore: 70 })
  await run(reconciliation)
  expect((await events()).at(-1)).toMatchObject({
    phase: 'after', taskId, outcome: 'success', charged: 30, balanceBefore: 100, balanceAfter: 70,
  })
  expect(await readFile(join(out, 'model.glb'))).toEqual(glb)
  mockTripo({ balanceBefore: 70, id: '123e4567-e89b-42d3-a456-426614174001' })
  await run(options(next, '--allocation', '60'))
  expect(await readFile(join(next, 'model.glb'))).toEqual(glb)
})

test('a documented create rejection records zero spend without retrying', async () => {
  mockTripo()
  const normalFetch = fetchMock.getMockImplementation()
  fetchMock.mockImplementation((url, request) => {
    if (url === multiview) return Response.json({ code: 2010 }, { status: 403 })
    return normalFetch(url, request)
  })
  await expect(run(options())).rejects.toThrow('HTTP 403')
  expect(fetchMock.mock.calls.filter(([url]) => url === multiview)).toHaveLength(1)
  expect((await events()).at(-1)).toMatchObject({
    phase: 'after', taskId: null, outcome: 'not_submitted', charged: 0, balanceBefore: 100, balanceAfter: 100,
  })
  await run(options(join(dir, 'next'), '--dry-run'))
  expect(JSON.parse(log.mock.calls.at(-1)[0]).guard.remaining).toBe(200)
})

test('lost create response is never retried and can be matched to a confirmed task ID', async () => {
  mockTripo()
  const normalFetch = fetchMock.getMockImplementation()
  fetchMock.mockImplementation((url, request) => {
    if (url === multiview) throw new Error('Connection lost')
    return normalFetch(url, request)
  })
  await expect(run(options())).rejects.toThrow('Outcome unknown')
  expect(fetchMock.mock.calls.filter(([url]) => url === multiview)).toHaveLength(1)
  const [before, after] = await events()
  expect(after).toMatchObject({ phase: 'after', taskId: null, outcome: 'unknown' })
  const reconciliation = ['--ledger', ledger, '--reconcile']
  await expect(run(reconciliation)).rejects.toThrow('matching task')
  fetchMock.mockImplementation((url, request) => {
    if (url === poll) return json({
      task_id: taskId, type: before.type, status: 'failed', credits_consumed: 0,
      created_at: new Date(before.startedAt).toISOString(),
    })
    return normalFetch(url, request)
  })
  await run([...reconciliation, '--task-id', taskId])
  expect((await events()).at(-1)).toMatchObject({ taskId, outcome: 'failed', charged: 0 })
})

test('a before record and task ID without an after record reserve the full charge', async () => {
  mockTripo()
  await run(options())
  const [before, submitted] = await events()
  before.out = join(dir, 'interrupted')
  before.pid = 2_147_483_647
  await mkdir(before.out)
  await writeFile(ledger, [before, submitted].map((event) => JSON.stringify(event)).join('\n') + '\n')
  fetchMock.mockClear()
  await expect(run(options(join(dir, 'next'), '--dry-run'))).rejects.toThrow('Unknown Tripo outcome')
  expect(JSON.parse(log.mock.calls.at(-1)[0]).guard).toMatchObject({ remaining: 170, allowed: false })
  expect(fetchMock).not.toHaveBeenCalled()
  await run(['--ledger', ledger, '--reconcile'])
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([poll, balance, cdn])
  expect((await events()).at(-1)).toMatchObject({ phase: 'after', taskId, outcome: 'success' })
})

test('concurrent submits sharing a ledger cannot both spend the same allocation', async () => {
  mockTripo()
  const normalFetch = fetchMock.getMockImplementation()
  const { promise: bothBalances, resolve: release } = Promise.withResolvers()
  let balanceReads = 0
  fetchMock.mockImplementation(async (url, request) => {
    if (url === balance && balanceReads < 2) {
      if (++balanceReads === 2) release()
      await bothBalances
    }
    return normalFetch(url, request)
  })
  const outcomes = await Promise.allSettled([
    run(options(out, '--allocation', '30')),
    run(options(join(dir, 'next'), '--allocation', '30')),
  ])
  expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(fetchMock.mock.calls.filter(([url]) => url === multiview)).toHaveLength(1)
  expect((await events()).filter(({ outcome }) => outcome).map(({ outcome }) => outcome).sort())
    .toEqual(['not_submitted', 'success'])
})

test('refuses an existing output directory before making requests', async () => {
  await mkdir(out)
  await expect(run(options())).rejects.toThrow('Output path already exists')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('dry run needs no key, makes no requests, and writes nothing', async () => {
  vi.stubEnv('TRIPO_API_KEY', undefined)
  await run(options(out, '--mode', 'multiview', '--dry-run'))
  expect(fetchMock).not.toHaveBeenCalled()
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
    guard: { remaining: 200, maxCharge: 30, allowed: true },
    requests: expect.arrayContaining([{ method: 'GET', url: balance }]),
  })
  await expect(lstat(out)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(lstat(ledger)).rejects.toMatchObject({ code: 'ENOENT' })
})
