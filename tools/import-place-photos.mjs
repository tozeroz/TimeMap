// 地点照片批量导入：每个地标一张照片，只走 HTTP API，不直连数据库。
//
// Run:
//   node tools/import-place-photos.mjs --source <出处> --year <年份标签> [--dry-run] [--api <origin>] [--dir <folder>] [--phone <admin phone>]
//
//   --source 必填，写入每张照片的 source（服务端与 DB 都要求非空，见迁移 016 place_photos_source_not_blank）。
//   --year   必填，写入每张照片的 yearLabel（给人看的原文，如「2026年」）。
//            yearSort 按迁移 029 的同一规则从标签里原样抽出四位年份（1800–2099），抽不出就传 null（= 年代不详）。
//            两者都没有默认值：工具不替照片编出处和年份。
//   --api    API origin，默认 http://127.0.0.1:3002（本地后端）。对生产跑时传生产域名。
//            除 127.0.0.1/localhost 外必须是 https://，否则直接报错（避免明文发送管理员凭据）。
//   --dir    照片文件夹，默认仓库内的 assets/place-photos（随代码提交的原图）。平铺，文件名 = 地点名（精确匹配），扩展名 .jpg/.jpeg/.png/.webp（大小写均可）。
//   --phone  管理员手机号，默认 19900000001（本地管理员）。
//   --dry-run 只登录 + 读取，打印将要做什么，不上传、不挂图、不删除。
//   --remove-demo-photos 显式开启才生效：对本次文件夹里有照片的地点（本次新挂上或已经挂过），
//            经 DELETE /api/admin/place-photos/:id 删除 source 以「演示素材」开头的种子演示照片。
//            没有照片文件的地点一律不碰；dry-run 下只列出将删除哪些。
//
// 登录（管理员会话），按优先级：
//   1. 环境变量 TIMEMAP_TOKEN：直接用现成的会话 token。
//   2. 环境变量 TIMEMAP_ADMIN_PASSWORD：POST /api/auth/admin-login（手机号 + 密码）。
//   3. 验证码：POST /api/auth/request-code，然后读 .local/login-codes/latest.json（本地 dev-sink）；
//      读不到（例如生产发的是短信）就在终端提示输入验证码，再 POST /api/auth/verify-code。
//
// 流程（每个文件）：
//   GET /api/admin/places 按名字精确匹配地点（同名多个 → 报错不导入；已停用地点 → 跳过）
//   → GET /api/places/:id 看是否已有同 title 的照片（title = 地点名），有就跳过（幂等）
//   → POST /api/media（purpose=place，uploadRequestId 由文件内容 sha256 派生，重跑不会重复建媒体）
//   → 若返回的 mediaId 已挂在该地点（title 被改过的情况），也跳过
//   → POST /api/admin/places/:id/photos { title, yearLabel, yearSort, source, mediaId }。
//
// 上传限制（以服务端为准，见 server/src/index.ts 的 /api/media 与 server/src/imageProbe.ts）：
//   单文件 ≤ 5MB；按字节判定格式（JPEG/PNG/WebP），不看扩展名，所以 .JPEG 大写扩展名没问题；
//   单边 ≤ 20000px、总像素 ≤ 40,000,000。本工具不缩放、不重新编码：超过 5MB 的文件直接报错跳过，
//   尺寸超限由服务端拒绝并打印原因。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline/promises'

const MEDIA_MAX_BYTES = 5 * 1024 * 1024
/** 迁移 016 种子演示照片的 source 前缀（「演示素材（待替换为授权校史照片）」） */
const DEMO_SOURCE_PREFIX = '演示素材'
const EXT_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

function parseArgs(argv) {
  const opts = { dryRun: false, api: 'http://127.0.0.1:3002', dir: path.join(import.meta.dirname, '..', 'assets', 'place-photos'), phone: '19900000001' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--remove-demo-photos') opts.removeDemoPhotos = true
    else if (['--api', '--dir', '--phone', '--source', '--year'].includes(a)) {
      const v = argv[++i]?.trim()
      if (!v) throw new Error(`${a} 需要一个值`)
      opts[a.slice(2)] = v
    } else throw new Error(`未知参数: ${a}`)
  }
  if (!opts.source || !opts.year) throw new Error('必须给出 --source 与 --year（工具不替照片编出处和年份）')
  if (opts.source.length > 200) throw new Error('--source 不能超过 200 字')
  if (opts.year.length > 20) throw new Error('--year 不能超过 20 字')
  const y = opts.year.match(/(1[89][0-9][0-9]|20[0-9][0-9])/)
  opts.yearSort = y ? Number(y[1]) : null
  opts.api = opts.api.replace(/\/+$/, '')
  // 管理员 token / 密码会随请求发出：除本机回环地址外只接受 https。
  if (!/^https:\/\//.test(opts.api) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(opts.api)) {
    throw new Error(`--api 必须是 https://（本机 127.0.0.1/localhost 除外）：${opts.api}`)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))

async function call(method, route, { body, token, form } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body) headers['content-type'] = 'application/json'
  const res = await fetch(opts.api + route, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text.slice(0, 200) } }
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${JSON.stringify(data)}`)
  return data
}

async function readCode() {
  const file = path.resolve('.local/login-codes/latest.json')
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(opts.api)
  if (isLocal && fs.existsSync(file)) {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (c.code) return String(c.code)
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try { return (await rl.question(`请输入发到 ${opts.phone} 的验证码: `)).trim() } finally { rl.close() }
}

async function login() {
  if (process.env.TIMEMAP_TOKEN) return process.env.TIMEMAP_TOKEN
  if (process.env.TIMEMAP_ADMIN_PASSWORD) {
    return (await call('POST', '/api/auth/admin-login', { body: { phone: opts.phone, password: process.env.TIMEMAP_ADMIN_PASSWORD } })).token
  }
  await call('POST', '/api/auth/request-code', { body: { phone: opts.phone } })
  const code = await readCode()
  return (await call('POST', '/api/auth/verify-code', { body: { phone: opts.phone, code } })).token
}

/** 由内容哈希派生的 uploadRequestId：同一文件重跑时服务端返回同一条 media（idempotentReplay）。 */
function requestIdFor(buf) {
  const h = crypto.createHash('sha256').update(buf).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const files = fs.readdirSync(opts.dir, { withFileTypes: true })
  .filter((d) => d.isFile() && EXT_MIME[path.extname(d.name).toLowerCase()])
  .map((d) => ({ file: d.name, name: path.basename(d.name, path.extname(d.name)).normalize('NFC').trim() }))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh'))

console.log(`${opts.dryRun ? '[dry-run] ' : ''}API ${opts.api}  folder ${opts.dir}  files ${files.length}`)
console.log(`source「${opts.source}」 yearLabel「${opts.year}」 yearSort ${opts.yearSort ?? 'null（年代不详）'}`)
const token = await login()
const places = (await call('GET', '/api/admin/places', { token })).items
const byName = new Map()
for (const p of places) byName.set(p.name, [...(byName.get(p.name) ?? []), p])

const tally = { uploaded: 0, wouldUpload: 0, skipped: 0, deleted: 0, wouldDelete: 0, failed: 0 }
const covered = new Set()
for (const { file, name } of files) {
  const matches = byName.get(name) ?? []
  if (matches.length !== 1) {
    tally.failed++
    console.log(`FAIL   ${file}: ${matches.length ? `有 ${matches.length} 个同名地点` : '没有同名地点'}`)
    continue
  }
  const place = matches[0]
  covered.add(place.id)
  // 已停用地点（如迁移 032 下架的茅以升坐像、郑振铎铜像、留园）不挂新图、不删演示照片。
  if (!place.enabled) {
    tally.skipped++
    console.log(`SKIP   ${name}: 地点已停用`)
    continue
  }
  try {
    const detail = await call('GET', `/api/places/${place.id}`, { token })
    const photos = detail.photos ?? []
    if (photos.some((ph) => ph.title === name)) {
      tally.skipped++
      console.log(`SKIP   ${name}: 已有同名照片`)
    } else {
      await importOne(file, name, place, photos)
    }
    // 只有在该地点已经有（或本次 dry-run 将会有）文件夹照片时才删演示照片，避免地点被删空。
    if (opts.removeDemoPhotos) await removeDemo(name, photos)
  } catch (err) {
    tally.failed++
    console.log(`FAIL   ${name}: ${err.message}`)
  }
}

async function removeDemo(name, photos) {
  const demo = photos.filter((ph) => typeof ph.source === 'string' && ph.source.startsWith(DEMO_SOURCE_PREFIX)
    && ph.source !== opts.source && ph.title !== name)
  for (const ph of demo) {
    if (opts.dryRun) {
      tally.wouldDelete++
      console.log(`WOULD  ${name}: 删除演示照片 ${ph.id}「${ph.title}」（${ph.source}）`)
      continue
    }
    await call('DELETE', `/api/admin/place-photos/${ph.id}`, { token })
    tally.deleted++
    console.log(`DEL    ${name}: 已删除演示照片 ${ph.id}「${ph.title}」`)
  }
}

async function importOne(file, name, place, photos) {
  const buf = fs.readFileSync(path.join(opts.dir, file))
  if (buf.length > MEDIA_MAX_BYTES) throw new Error(`文件 ${buf.length} 字节，超过服务端上限 ${MEDIA_MAX_BYTES}（本工具不缩放）`)
  if (opts.dryRun) {
    tally.wouldUpload++
    console.log(`WOULD  ${name}: 上传 ${file}（${buf.length} 字节）并挂到地点 ${place.id}`)
    return
  }
  const form = new FormData()
  form.append('purpose', 'place')
  form.append('uploadRequestId', requestIdFor(buf))
  form.append('file', new Blob([buf], { type: EXT_MIME[path.extname(file).toLowerCase()] }), file)
  const media = await call('POST', '/api/media', { token, form })
  // 第二道幂等：照片 title 被管理员改过时，同一文件重放出的 mediaId 已挂在该地点上，也算已导入。
  if (photos.some((ph) => ph.mediaId === media.id)) {
    tally.skipped++
    console.log(`SKIP   ${name}: 这张图（media ${media.id}）已挂在该地点上`)
    return
  }
  const photo = await call('POST', `/api/admin/places/${place.id}/photos`, {
    token,
    body: { title: name, yearLabel: opts.year, yearSort: opts.yearSort, source: opts.source, mediaId: media.id },
  })
  tally.uploaded++
  console.log(`OK     ${name}: media ${media.id}${media.idempotentReplay ? '（复用）' : ''} → photo ${photo.id}`)
}

const landmarksWithoutFile = places.filter((p) => !covered.has(p.id)).map((p) => p.name)
console.log(`没有照片文件的地点（不处理）: ${landmarksWithoutFile.join('、') || '无'}`)
const demoSummary = opts.removeDemoPhotos ? `, ${opts.dryRun ? `would delete demo ${tally.wouldDelete}` : `deleted demo ${tally.deleted}`}` : ''
console.log(`Summary: ${opts.dryRun ? `would upload ${tally.wouldUpload}` : `uploaded ${tally.uploaded}`}, skipped ${tally.skipped}${demoSummary}, failed ${tally.failed}`)
if (tally.failed) process.exitCode = 1
