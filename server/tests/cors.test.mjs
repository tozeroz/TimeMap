/** Run after `npm run build`: exercise the production CORS hook without a database. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { buildServer } from '../dist/index.mjs'

// Include methods in conditional expressions (project saves use id ? 'PUT' : 'POST')
// and in API modules split out from client.ts.
const apiDir = new URL('../../app/src/api/', import.meta.url)
const methods = new Set(['GET'])
for (const file of readdirSync(apiDir).filter(name => name.endsWith('.ts'))) {
  const source = readFileSync(new URL(file, apiDir), 'utf8')
  for (const match of source.matchAll(/['"](GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)['"]/g)) methods.add(match[1])
}
assert(methods.has('PUT'), 'Cover project edits and likes')
const app = buildServer({
  db: { status: () => ({ ready: true }), pool: { query() { throw new Error('Preflight must not query the database') } } },
  loginRequestMax: 5, loginVerifyMaxAttempts: 5, loginWindowSeconds: 300,
})
const paths = ['/api/admin/projects/c1a55000-0000-4000-8000-000000000001', '/api/projects/c1a55000-0000-4000-8000-000000000001/like']
try {
  for (const origin of ['https://localhost', 'http://127.0.0.1:5173']) {
    for (const method of methods) {
      for (const url of paths) {
        const response = await app.inject({ method: 'OPTIONS', url, headers: {
          origin, 'access-control-request-method': method,
          'access-control-request-headers': 'content-type,authorization',
        } })
        assert.equal(response.statusCode, 204)
        assert.equal(response.headers['access-control-allow-origin'], origin)
        assert(response.headers.vary.split(',').map(s => s.trim()).includes('Origin'))
        assert(response.headers['access-control-allow-methods'].split(',').includes(method), `${method} blocked for ${origin} ${url}`)
        const headers = response.headers['access-control-allow-headers'].split(',')
        for (const header of ['content-type', 'authorization']) assert(headers.includes(header))
      }
    }
  }
  const denied = await app.inject({ method: 'OPTIONS', url: paths[0], headers: {
    origin: 'https://untrusted.example', 'access-control-request-method': 'PUT',
  } })
  assert.equal(denied.headers['access-control-allow-origin'], undefined)
  console.log(`PASS CORS: client methods ${[...methods].join(',')}, Android/browser project edits and likes, untrusted origin denied`)
} finally { await app.close() }
