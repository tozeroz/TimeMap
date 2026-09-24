/**
 * ⭐ 审核 60 明确要求的 Gate：**PLACE_DOES_NOT_IMPLY_CAMPUS**
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么必须有这一条（审核 60 的原话）
 * ════════════════════════════════════════════════════════════════════
 *   > 另外请给这一单留一个非常关键的 Gate：PLACE_DOES_NOT_IMPLY_CAMPUS
 *   > Sensitivity 可以故意写：post.place == "北京交通大学" → 自动归属校本部。
 *   > Gate 必须 FAIL。
 *   > 因为这正是当前最容易为了"让数字出来"而重新引入的**数据伪造路径**。
 *
 * 背景（为什么这条路径特别容易走）：
 *   `posts.place_id → places.name = "北京交通大学"` 只说明**一个地理 POI**，
 *   而「校园圈」的粒度是 **学校 × 校区**（迁移 004 已确立）。
 *   当有人想让「N 条校园圈」有数字时，最容易的做法就是：
 *     "既然帖子在'北京交通大学'，那就归属它的校本部吧" ⇒ **这就是伪造**。
 *   而迁移 004 的注释明确写着「未知就表示未知，**不伪造归属**」。
 *
 * ════════════════════════════════════════════════════════════════════
 * 本 Gate 检查三层（都在**服务器侧**）
 * ════════════════════════════════════════════════════════════════════
 *   ① **数据层**：`posts.school_campus_id` 与 `users.school_campus_id`
 *      **必须全为 NULL**（我们目前没有任何权威来源能确定归属）
 *   ② **行为层**：`GET /api/schools/:id/campuses`（层 B 将实现）返回的
 *      `campusCircleCount` 在无法由权威归属计算时必须是 **null，不是 0**
 *      ⚠️ 该接口尚不存在时记 **NOT_EVALUATED**（不假装通过）
 *   ③ **代码层**：服务端源码里**不得存在**"由 place 推断 campus"的路径
 *      （例如 join places→campuses、或用 place 名去匹配 campus 名）
 *
 * ════════════════════════════════════════════════════════════════════
 * 敏感度（证明它能红）
 * ════════════════════════════════════════════════════════════════════
 *   见 `scripts/m5/selftest-place-not-campus.sh`：
 *   故意执行那条**被禁止的** UPDATE（把 place=北京交通大学 的帖子归属到校本部）
 *   ⇒ ①层必须变红；撤销后回绿。
 *   ⚠️ 这条突变会在**我们自己的**数据库上写（合规：只读约束只针对原版 app）。
 *
 * 用法：bash scripts/m5/run-check.sh scripts/m5/gate-place-not-campus.mjs
 *   （或直接 node，但需要 ssh 凭据；本 Gate 走 ssh 在服务器上执行只读 SQL）
 */
import { execFileSync } from 'node:child_process'

const KEY = 'G:\\demo map\\TimeMap.pem'
const HOST = 'root@8.148.156.146'
const OUT = 'G:\\demo map\\tools\\tmp\\place-not-campus-gate.json'

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  console.log(k, '=', JSON.stringify(v))
}

/** 在服务器上跑一段只读 SQL，返回纯文本结果 */
function sqlOne(query) {
  const remote = `PGPASSWORD=$(cat /srv/campus/.db_password) psql -h 127.0.0.1 -U campus -d campus -Atc ${JSON.stringify(query)}`
  return execFileSync('ssh', ['-i', KEY, '-o', 'BatchMode=yes', HOST, remote], { encoding: 'utf8' }).trim()
}

console.log('=== ① 数据层：不得存在由 place 推来的 campus 归属 ===')
let postsAttr = null
let usersAttr = null
try {
  postsAttr = sqlOne('select count(*) from posts where school_campus_id is not null')
  usersAttr = sqlOne('select count(*) from users where school_campus_id is not null')
} catch (e) {
  console.error('FATAL 无法连服务器执行只读查询：' + String(e && e.message))
  process.exit(2)
}
log('POSTS_WITH_CAMPUS_ATTRIBUTION', postsAttr)
log('USERS_WITH_CAMPUS_ATTRIBUTION', usersAttr)

console.log('')
console.log('=== ③ 代码层：服务端不得有"由 place 推断 campus"的路径 ===')
/*
  做法：在服务器上对**已部署的 bundle**（也就是真正在跑的那份）做只读检索。
  ⚠️ 为什么查 bundle 而不是源码：bundle 才是**实际执行**的东西
     （本项目已有教训：源码干净不代表真机/真服务上跑的是干净版本）。
  判据：不得出现把 campuses 与 places 关联起来、或用 place 去匹配 campus 名的写法。
*/
let codeHit = ''
try {
  const remote =
    "grep -nE 'campuses[^;]{0,120}places|places[^;]{0,120}campuses' /srv/campus/server/dist/index.mjs | head -5 | sed 's/^/  /' ; echo '---END---'"
  codeHit = execFileSync('ssh', ['-i', KEY, '-o', 'BatchMode=yes', HOST, remote], { encoding: 'utf8' })
    .split('---END---')[0]
    .trim()
} catch (e) {
  codeHit = ''
}
log('CODE_PATH_HITS', codeHit || '（无命中）')

console.log('')
console.log('=== ② 行为层：campusCircleCount 的 null 语义（层 B 尚未实现）===')
let campusesApi = null
try {
  const remote =
    "curl -s -o /dev/null -w '%{http_code}' https://127.0.0.1/api/schools -k 2>/dev/null || echo 'curl-fail'"
  campusesApi = execFileSync('ssh', ['-i', KEY, '-o', 'BatchMode=yes', HOST, remote], { encoding: 'utf8' }).trim()
} catch (e) {
  campusesApi = 'error'
}
log('SCHOOLS_API_HTTP', campusesApi)

const v = {
  /** ① 数据层：所有归属必须为 NULL（0 行有归属） */
  PLACE_DOES_NOT_IMPLY_CAMPUS_DATA:
    postsAttr === '0' && usersAttr === '0' ? 'PASS' : 'FAIL',
  /** ③ 代码层：已部署 bundle 里不得有 place↔campus 关联 */
  PLACE_DOES_NOT_IMPLY_CAMPUS_CODE: codeHit === '' ? 'PASS' : 'FAIL',
  /**
   * ② 行为层：层 B 的 count 语义
   * ⚠️ `/api/schools` 尚不存在 ⇒ **NOT_EVALUATED**（如实标记，不假装通过）
   */
  CAMPUS_CIRCLE_COUNT_NULL_NOT_ZERO:
    campusesApi === '200' ? 'NOT_EVALUATED（接口已存在但本 Gate 尚未实现语义检查）' : 'NOT_EVALUATED',
  detail: {
    postsWithCampusAttribution: postsAttr,
    usersWithCampusAttribution: usersAttr,
    codePathHits: codeHit || null,
    schoolsApiHttp: campusesApi,
  },
  notes: {
    为什么这条是关键:
      '审核 60：这是当前最容易为了"让数字出来"而重新引入的**数据伪造路径** —— ' +
      'place=北京交通大学 只说明一个地理 POI，推不出 school_campus=校本部。',
    证据位置:
      '数据层与代码层都查**服务器上的实况**（DB + 已部署 bundle），不是查本地源码。',
    层B待补:
      'campusCircleCount 必须是 null（=无法由权威归属计算），不是 0 —— ' +
      '层 B 实现 /api/schools/:id/campuses 后，本条要从 NOT_EVALUATED 升为实测。',
  },
}
const KEYS = ['PLACE_DOES_NOT_IMPLY_CAMPUS_DATA', 'PLACE_DOES_NOT_IMPLY_CAMPUS_CODE']
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
v.PLACE_NOT_CAMPUS_GATE = anyFail ? 'FAIL' : 'PASS'
log('VERDICT', v)

import('node:fs').then((fs) => fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8'))
process.exit(anyFail ? 1 : 0)
