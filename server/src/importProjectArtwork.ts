/** Administrative, idempotent import of the two user-provided FoodTime Neo images.
 * Run the bundled CLI with DATABASE_URL/UPLOAD_ROOT and ARTWORK_EXPECT_DATABASE.
 * No login tokens, SMS, user creation or schema migrations are performed here.
 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import pg from 'pg'
import { probeImage } from './imageProbe.ts'
import { acquireMediaMutationLock } from './mutationBarrier.ts'

const projectUrl = 'https://github.com/FoodtimeNeo/FoodtimeNeo-Web'
const [logoSource, posterSource, recordPath] = process.argv.slice(2)
if (!logoSource || !posterSource || !recordPath || !process.env.DATABASE_URL || !process.env.UPLOAD_ROOT || !process.env.ARTWORK_EXPECT_DATABASE) throw new Error('Need logo, poster, metadata backup path and explicit database/upload settings')
const database = new URL(process.env.DATABASE_URL)
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || decodeURIComponent(database.pathname.slice(1)) !== process.env.ARTWORK_EXPECT_DATABASE) throw new Error('Unexpected database target')
if (!isAbsolute(process.env.UPLOAD_ROOT)) throw new Error('UPLOAD_ROOT must be absolute')
const root = resolve(process.env.UPLOAD_ROOT, 'public'), dir = resolve(root, 'project-artwork')
if (!dir.startsWith(root + sep)) throw new Error('Invalid media directory')
const uuid = (value: string) => { const h = createHash('sha256').update(value).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
const images = await Promise.all(([['logo', logoSource], ['poster', posterSource]] as const).map(async ([role, source]) => {
  const bytes = await readFile(source), probe = probeImage(bytes)
  if (!probe.ok || bytes.length > 5 * 1024 * 1024) throw new Error(`Invalid ${role} image`)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const ext = probe.mime === 'image/jpeg' ? 'jpg' : probe.mime === 'image/png' ? 'png' : 'webp'
  return { role, source, bytes, probe, sha, id: uuid('foodtime-artwork:' + sha), requestId: uuid('foodtime-artwork-upload:' + sha), storageKey: `project-artwork/${sha}.${ext}` }
}))
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 })
const client = await pool.connect()
try {
  await client.query('begin')
  await acquireMediaMutationLock(client)
  const projects = await client.query('select * from training_projects where project_url=$1 for update', [projectUrl])
  if (projects.rows.length !== 1) throw new Error('Expected exactly one FoodTime Neo project')
  const project = projects.rows[0]
  const oldGallery = (await client.query('select media_id,position from training_project_images where project_id=$1 order by position', [project.id])).rows
  const admin = (await client.query("select id from users where role='admin' order by created_at,id limit 1")).rows[0]
  if (!admin) throw new Error('No existing administrator available for media ownership/audit')
  await writeFile(recordPath, JSON.stringify({ project, gallery: oldGallery, importedFiles: images.map(i => ({ role: i.role, sha256: i.sha, mediaId: i.id })) }, null, 2), { flag: 'wx', mode: 0o600 })
  await mkdir(dir, { recursive: true, mode: 0o755 })
  // Explicitly set permissions because an operator's restrictive umask also affects mkdir.
  await chmod(dir, 0o755)
  for (const image of images) {
    const target = join(root, image.storageKey)
    try { await copyFile(image.source, target, constants.COPYFILE_EXCL); await chmod(target, 0o644) }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (createHash('sha256').update(await readFile(target)).digest('hex') !== image.sha) throw new Error('Existing media file differs')
    }
    const existing = (await client.query('select sha256,scope,storage_key from media where id=$1', [image.id])).rows[0]
    if (existing && (existing.sha256 !== image.sha || existing.scope !== 'public' || existing.storage_key !== image.storageKey)) throw new Error('Existing media identity differs')
    if (!existing) await client.query(`insert into media(id,owner_user_id,scope,storage_key,mime,bytes,width,height,sha256,upload_request_id)
      values($1,$2,'public',$3,$4,$5,$6,$7,$8,$9)`, [image.id, admin.id, image.storageKey, image.probe.mime, image.bytes.length, image.probe.width, image.probe.height, image.sha, image.requestId])
  }
  const logo = images[0], poster = images[1]
  const addPoster = !oldGallery.some(i => i.media_id === poster.id)
  if (addPoster) {
    const position = oldGallery.length ? Math.max(...oldGallery.map(i => i.position)) + 1 : 0
    if (position > 7) throw new Error('Existing gallery is full; no existing image was removed')
    await client.query('insert into training_project_images(project_id,media_id,position) values($1,$2,$3)', [project.id, poster.id, position])
  }
  const changed = project.cover_image_id !== logo.id || addPoster
  if (project.cover_image_id !== logo.id) await client.query('update training_projects set cover_image_id=$2,updated_at=now() where id=$1', [project.id, logo.id])
  if (changed) await client.query('insert into audit_log(id,actor_id,action,target_type,target_id,reason) values($1,$2,$3,$4,$5,$6)', [uuid('foodtime-artwork-audit:' + project.id + ':' + Date.now()), admin.id, 'project_artwork_import', 'project', project.id, '按用户提供素材导入：碗形图标为列表封面，猫咪海报为详情展示图；保留其他项目资料和互动数据。'])
  await client.query('commit')
  console.log(JSON.stringify({ projectId: project.id, projectName: project.name, changed, coverImageId: logo.id, posterMediaId: poster.id, galleryCount: oldGallery.length + (addPoster ? 1 : 0), images: images.map(i => ({ role: i.role, id: i.id, storageKey: i.storageKey, mime: i.probe.mime, width: i.probe.width, height: i.probe.height, sha256: i.sha })) }))
} catch (err) { await client.query('rollback').catch(() => {}); throw err }
finally { client.release(); await pool.end() }
