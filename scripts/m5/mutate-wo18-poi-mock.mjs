/**
 * 受控突变：把 PoiSearchScreen **恢复成 WO#18 之前的 mock 实现**
 * （读 mock 的 `pois`、客户端 filter、硬编码 distance）
 * —— 用来证明 WO#18 的门禁断言**真的能红**
 *
 * ## 为什么这样突变
 *   审核 59/60/62 一贯要求：敏感度要证明 Gate 能抓出**"接错数据源"这个原因**。
 *   所以这里**复现历史形态**：把 mock 的 5 条地点（含 `posts: 1284` 这类编造数字
 *   与 `distance: '320m'` 这类硬编码文案）接回列表，并改回**客户端** filter。
 *
 * ## 预计打红哪几条
 *   `POI_ROWS_FROM_AUTHORITY`    —— 行集合变成 mock 的 5 条（与 API 的 2 条不符）
 *   `POI_SEARCH_SERVER_SIDE`     —— 客户端 filter 的集合与 API 过滤结果不同
 *   `POI_NO_MOCK_ONLY_PLACES`    —— 出现「思源楼」等在 mock 独有的地点名
 *   `POI_DISTANCE_NOT_MOCK`      —— 距离恰好等于 '320m'/'410m'/'520m'（硬编码常量）
 *   ⭐ 而 `POI_CLEAR_ROW_PRESENT` 与 `POI_EMPTY_STATE` 应**仍 PASS**
 *      —— 突变的只是**数据源**，清除项与空态逻辑没动。
 *         **归因清晰**：突变只打红它该打红的键。
 *   ⚠️ `POI_NO_FABRICATED_NUMBERS` **预计仍 PASS**：因为 `posts: 1284` 在改前的 UI 里
 *      **本来就没被渲染**（我核对过）。所以本键抓的是"将来有人把计数接上 UI" ——
 *      它**不是**这次突变的判别目标。这一点要如实说明，不能假装它也红了。
 *
 * ## 实现方式：替换**数据来源**，**保持渲染结构不变**
 *   这样"红"精确归因到**数据源**，而不是"布局改了导致文本变了"。
 *   注入的实现**必须通过 tsc**，否则验的是"构建会不会崩"，不是"断言能不能红"。
 *
 * 用法：node scripts/m5/mutate-wo18-poi-mock.mjs inject|restore
 *       MUT_TARGET="app/src/screens/PoiSearchScreen.tsx app/src/data/mock.ts"
 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'

const SCREEN = 'G:\\demo map\\app\\src\\screens\\PoiSearchScreen.tsx'
const MOCK = 'G:\\demo map\\app\\src\\data\\mock.ts'
const TARGETS = [SCREEN, MOCK]
const BACKUPS = TARGETS.map((p) => 'G:\\demo map\\tools\\tmp\\' + p.split('\\').pop() + '.orig18.txt')
const mode = process.argv[2]

function norm(text) {
  const crlf = text.includes('\r\n')
  return [crlf ? text.replace(/\r\n/g, '\n') : text, crlf ? '\r\n' : '\n']
}
function denorm(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}
function restoreAll(quiet) {
  let any = false
  TARGETS.forEach((t, i) => {
    if (existsSync(BACKUPS[i])) {
      writeFileSync(t, readFileSync(BACKUPS[i], 'utf8'), 'utf8')
      rmSync(BACKUPS[i], { force: true })
      any = true
    }
  })
  if (any) console.log(quiet ? '  （回滚）已还原两个源文件' : '  已还原 PoiSearchScreen.tsx 与 mock.ts')
  return any
}

/** 历史 mock 地点（**逐字**取自 WO#18 之前 mock.ts 的那 5 条） */
const LEGACY_POIS = `
/* [突变] WO#18 之前的历史 mock 地点（现已移出生产 → scripts/m5/fixtures/legacy-pois.json） */
export const legacyPois: {
  id: string
  name: string
  address: string
  distance: string
  category: string
  posts: number
}[] = [
  { id: 'poi1', name: '北京交通大学图书馆', address: '北京市海淀区西直门外上园村3号', distance: '180m', category: '图书馆', posts: 214 },
  { id: 'poi2', name: '学生食堂', address: '北京交通大学校内', distance: '260m', category: '食堂', posts: 176 },
  { id: 'poi3', name: '北京交通大学交通运输学院', address: '北京市海淀区西直门外上园村3号', distance: '320m', category: '院系', posts: 96 },
  { id: 'poi4', name: '思源楼', address: '北京交通大学校内', distance: '410m', category: '教学楼', posts: 143 },
  { id: 'poi5', name: '教育超市', address: '北京交通大学校内', distance: '520m', category: '超市', posts: 88 },
]
`

if (mode === 'inject') {
  try {
    TARGETS.forEach((t, i) => {
      if (!existsSync(BACKUPS[i])) copyFileSync(t, BACKUPS[i])
    })

    // ① mock.ts：加回历史 mock 地点
    {
      const [src, eol] = norm(readFileSync(MOCK, 'utf8'))
      if (src.includes('export const legacyPois')) throw new Error('mock.ts 已含突变数据（请先 restore）')
      writeFileSync(MOCK, denorm(src.trimEnd() + '\n' + LEGACY_POIS, eol), 'utf8')
    }

    // ② PoiSearchScreen：把数据来源换成 mock（渲染结构不变）
    {
      let [src, eol] = norm(readFileSync(SCREEN, 'utf8'))

      // 2a 改 load()：不再调 API，改为 mock + 客户端 filter
      const from = `    const seq = ++reqSeq.current
    setState('loading')
    const r = await listPlaces(q)
    // 只接受**最后一次**请求的结果：避免快速输入时旧响应覆盖新响应
    if (seq !== reqSeq.current) return
    if (!r.ok) {
      setErrorText(r.reason)
      setState('error')
      return
    }
    setPlaces(r.value)
    setState('ready')`
      if (!src.includes(from)) throw new Error('找不到 load() 的目标块')
      const to = `    /* [突变] 改回历史形态：读 mock + **客户端** filter */
    const seq = ++reqSeq.current
    setState('loading')
    /*
      ⚠️ 下面两行是为了让注入后的代码**通过 tsc**：
        突变后不再走错误分支、也不再使用定位 ⇒ setErrorText / fix 会变成未使用（TS6133）
        而"构建失败"会让自测变成**验构建会不会崩**，而不是**验断言能不能红**
        （我在 WO#16 / WO#17 的突变里已两次踩到同类问题）。
    */
    void setErrorText
    void fix
    {
      const kw = String(q ?? '')
      const legacy = legacyPois
        .filter((p) => (kw ? p.name.includes(kw) || p.address.includes(kw) : true))
        .map(
          (p) =>
            ({
              id: p.id,
              name: p.name,
              address: p.address,
              latitude: null,
              longitude: null,
              postCount: p.posts,
              /* 硬编码距离（历史形态）——保留字段供下方渲染 */
              _legacyDistance: p.distance,
            }) as never,
        )
      if (seq !== reqSeq.current) return
      setPlaces(legacy)
      setState('ready')
      return
    }`
      src = src.replace(from, to)

      // 2b 距离改回 mock 的硬编码值
      const dFrom = `  function distanceText(p: ApiPlaceListItem): string | null {
    if (!fix) return null
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return null
    return formatDistance(distanceMeters(fix.lat, fix.lng, p.latitude, p.longitude))
  }`
      if (!src.includes(dFrom)) throw new Error('找不到 distanceText 目标块')
      const dTo = `  function distanceText(p: ApiPlaceListItem): string | null {
    /* [突变] 改回历史形态：直接显示 mock 的硬编码距离文案 */
    return (p as unknown as { _legacyDistance?: string })._legacyDistance ?? null
  }`
      src = src.replace(dFrom, dTo)

      // 2c 导入 mock
      src = src.replace(
        "import { listPlaces, type ApiPlaceListItem } from '../api/client'",
        "/* [突变] 接回历史 mock 数据源 */\nimport { legacyPois } from '../data/mock'\nimport type { ApiPlaceListItem } from '../api/client'",
      )
      // 2d distanceMeters/formatDistance 不再被用 ⇒ 去掉以免 TS6133
      src = src.replace(
        "import { distanceMeters, formatDistance, getCurrentFix, type GeoFix } from '../native/geo'",
        "import { getCurrentFix, type GeoFix } from '../native/geo'",
      )

      writeFileSync(SCREEN, denorm(src, eol), 'utf8')
    }

    console.log('  已注入突变：PoiSearchScreen **数据源接回 mock** + 客户端 filter + 硬编码距离')
  } catch (err) {
    console.error('FAIL ' + String(err && err.message))
    restoreAll(true)
    process.exit(1)
  }
} else if (mode === 'restore') {
  if (!restoreAll(false)) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
} else {
  console.error('用法：node mutate-wo18-poi-mock.mjs inject|restore')
  process.exit(2)
}
