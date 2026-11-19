/** Mock provider requests: no paid calls or production writes. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { registerCutoutRoutes } from '../src/cutout.ts'
import type { Db } from '../src/db.ts'
import { boxInside, imagePoint, selectionFromDrag } from '../../shared/cutout.ts'

assert.deepEqual(imagePoint(60, 120, { left: 10, top: 20, width: 200, height: 400 }, 1000, 2000), [250, 500])
assert.deepEqual(imagePoint(-10, 900, { left: 0, top: 0, width: 200, height: 400 }, 1000, 2000), [1, 1999])
assert.deepEqual(selectionFromDrag([80, 90], [10, 20]), [[10, 20], [80, 90]])
assert(!boxInside([[0, 1], [20, 20]], 128, 128))
assert(!boxInside([[1, 1], [128, 20]], 128, 128))
assert(!boxInside([[1, 1], [5, 20]], 128, 128))

const root = await mkdtemp(join(tmpdir(), 'timemap-cutout-'))
const owner = randomUUID(), mediaId = randomUUID(), requestId = randomUUID()
const jobs = new Map<string, Record<string, unknown>>()
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWQAAAABJRU5ErkJggg=='
const calls: Record<string, unknown>[] = []
let fileReads = 0
async function query(sql: string, values: unknown[] = []) {
  if (sql.includes('select * from cutout_jobs')) return { rows: jobs.has(String(values[0])) ? [jobs.get(String(values[0]))] : [] }
  if (sql.startsWith('select storage_key')) { fileReads++; return { rows: [{ storage_key: 'source.png', width: 800, height: 600 }] } }
  if (sql.includes('select count')) return { rows: [{ n: 0 }] }
  if (sql.includes('insert into cutout_jobs')) jobs.set(String(values[0]), { owner_id: owner, media_id: mediaId, status: 'processing', created_at: new Date() })
  if (sql.includes("set status='done'")) Object.assign(jobs.get(String(values[0]))!, { status: 'done', result_base64: values[1] })
  return { rows: [] }
}
const app = Fastify()
registerCutoutRoutes(app, { pool: { query, connect: async () => ({ query, release() {} }) } } as unknown as Db, root, async () => owner)
const oldFetch = globalThis.fetch
const oldEnv = [process.env.BAIDU_CUTOUT_API_KEY, process.env.BAIDU_CUTOUT_SECRET_KEY, process.env.CUTOUT_MAX_CALLS]
process.env.BAIDU_CUTOUT_API_KEY = 'fixture'
process.env.BAIDU_CUTOUT_SECRET_KEY = 'fixture'
process.env.CUTOUT_MAX_CALLS = '100'
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/oauth/')) return new Response(JSON.stringify({ access_token: 'fixture-token', expires_in: 3600 }))
  calls.push(JSON.parse(String(options?.body)))
  return new Response(JSON.stringify({ image: png, log_id: 'fixture' }))
}
const submit = (extra: object) => app.inject({ method: 'POST', url: '/api/media/cutout', payload: { mediaId, requestId, ...extra } })
try {
  await mkdir(join(root, 'public'))
  await writeFile(join(root, 'public', 'source.png'), Buffer.from(png, 'base64'))
  for (const extra of [{ method: 'bad' }, { method: 'control' }, { method: 'control', position: [] },
    { method: 'control', position: [[[0, 1], [30, 30]]] }, { method: 'control', position: [[[1, 1], [5, 30]]] },
    { method: 'control', position: [[[1.5, 1], [30, 30]]] }, { method: 'auto', position: [[[1, 1], [30, 30]]] }]) {
    assert.equal((await submit(extra)).statusCode, 400)
  }
  assert.equal(fileReads, 0)
  assert.equal((await submit({ method: 'control', position: [[[1, 1], [800, 40]]] })).statusCode, 400)
  assert.equal(calls.length, 0)
  const selection = { method: 'control', position: [[[20, 30], [500, 400]]] }
  let result = await submit(selection)
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(result.json().method, 'control')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { image: png, ...selection, return_form: 'rgba', refine_mask: 'true' })
  assert.equal((await submit(selection)).statusCode, 200)
  assert.equal(calls.length, 1, 'Identical selection replays without a provider call')
  result = await submit({ method: 'control', position: [[[40, 40], [600, 500]]] })
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(calls.length, 2, 'New selection must not reuse the previous result')
  result = await submit({})
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(calls[2].method, 'auto')
  assert(!('position' in calls[2]))
  assert.equal((await submit({})).statusCode, 200)
  assert.equal(calls.length, 3)
  console.log('PASS manual cutout: coordinate conversion, invalid/border selections, provider payload, selection-specific cache, retries and automatic compatibility')
} finally {
  globalThis.fetch = oldFetch
  for (const [index, key] of ['BAIDU_CUTOUT_API_KEY', 'BAIDU_CUTOUT_SECRET_KEY', 'CUTOUT_MAX_CALLS'].entries()) {
    if (oldEnv[index] === undefined) delete process.env[key]
    else process.env[key] = oldEnv[index]
  }
  await app.close()
  await rm(root, { recursive: true, force: true })
}
