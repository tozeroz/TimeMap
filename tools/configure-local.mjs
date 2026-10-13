import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const local = path.join(root, '.local')
fs.mkdirSync(local, { recursive: true })
const passwordFile = path.join(local, 'db-password')
if (!fs.existsSync(passwordFile)) fs.writeFileSync(passwordFile, crypto.randomBytes(24).toString('hex'))
const password = fs.readFileSync(passwordFile, 'utf8').trim()
for (const folder of ['uploads/public', 'uploads/private', 'uploads/.tmp', 'login-codes']) {
  fs.mkdirSync(path.join(local, folder), { recursive: true })
}
function update(file, values) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp('^' + key + '=.*$', 'm')
    text = pattern.test(text) ? text.replace(pattern, key + '=' + value) : text.trimEnd() + '\n' + key + '=' + value + '\n'
  }
  fs.writeFileSync(file, text.replace(/^\n/, ''))
}
const envFile = path.join(root, 'server/.env')
const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''
update(envFile, {
  DATABASE_URL: `postgresql://campus:${password}@127.0.0.1:15432/campus_local`,
  HOST: '127.0.0.1', PORT: '3002',
  UPLOAD_ROOT: path.join(local, 'uploads').replaceAll('\\', '/'),
  LOCAL_MEDIA_SERVE: '1',
  LOGIN_CODE_SINK: path.join(local, 'login-codes').replaceAll('\\', '/'),
  CORS_ORIGINS: 'http://127.0.0.1:5180,http://localhost:5180,http://127.0.0.1:5174,http://localhost:5174',
  ...(!/^LOGIN_CODE_HMAC_KEY=.+/m.test(current) ? { LOGIN_CODE_HMAC_KEY: crypto.randomBytes(32).toString('hex') } : {}),
})
update(path.join(root, 'app/.env.local'), { VITE_API_ORIGIN: 'http://127.0.0.1:3002' })
console.log('Local settings ready. Existing cutout credentials preserved.')
