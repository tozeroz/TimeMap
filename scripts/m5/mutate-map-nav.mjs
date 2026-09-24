/**
 * 受控突变：把地图页两个导航**接错目标**，验证两条落点断言真的能红
 *
 * ## 为什么必须做（本项目的核心纪律）
 *   Round 267 我给地图页补了"真机点击落点"断言：
 *     MAP_REGION_TO_POI_CONTROL（region → poi）
 *     MAP_PLUS_TO_PUBLISH_CONTROL（fab → publish）
 *   它们现在**是 PASS** —— 但"PASS"本身不构成保障：一条恒真断言也会 PASS。
 *   ⇒ 必须证明：把导航目标改错时，它们**必然变红**。
 *
 * ## 突变内容（忠实模拟"接错目标"这个原因，而不是伪造结果）
 *   MapScreen.tsx 里：
 *     navigate('poi')      → navigate('campus')
 *     navigate('publish')  → navigate('campus')
 *   ⇒ 点击后 hash 会落到 #/campus ⇒ 两条断言应当 FAIL；
 *     而**其它键应仍 PASS**（归因清晰：是这两条抓到的，不是整个 Gate 崩了）。
 *
 * 用法：node scripts/m5/mutate-map-nav.mjs inject|restore
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'

const FILE = 'G:\\demo map\\app\\src\\screens\\MapScreen.tsx'
const ORIG = 'G:\\demo map\\tools\\tmp\\MapScreen.orig.txt'
const mode = process.argv[2]

function replaceAll(src, pairs) {
  let out = src
  const missed = []
  for (const [from, to] of pairs) {
    if (!out.includes(from)) {
      missed.push(from)
      continue
    }
    out = out.replace(from, to)
  }
  if (missed.length) {
    console.error('FAIL 以下目标字符串未命中（实现已变化，需先确认）：')
    for (const m of missed) console.error('   · ' + m)
    process.exit(1)
  }
  return out
}

if (mode === 'inject') {
  const src = readFileSync(FILE, 'utf8')
  if (!existsSync(ORIG)) writeFileSync(ORIG, src, 'utf8')
  const out = replaceAll(src, [
    // region 控件：把目标从 poi 改成 campus
    ['<button className="map__region" onClick={() => navigate(\'poi\')}>', '<button className="map__region" onClick={() => navigate(\'campus\')}>'],
    // fab 控件：把目标从 publish 改成 campus
    ['<button className="map__fab" onClick={() => navigate(\'publish\')} aria-label="发布">', '<button className="map__fab" onClick={() => navigate(\'campus\')} aria-label="发布">'],
  ])
  writeFileSync(FILE, out, 'utf8')
  console.log('  已注入突变：region→campus ／ fab→campus（模拟"接错导航目标"）')
} else if (mode === 'restore') {
  if (!existsSync(ORIG)) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
  writeFileSync(FILE, readFileSync(ORIG, 'utf8'), 'utf8')
  rmSync(ORIG, { force: true })
  console.log('  已从备份还原 MapScreen.tsx，并删除备份文件')
} else {
  console.error('用法：node mutate-map-nav.mjs inject|restore')
  process.exit(2)
}
