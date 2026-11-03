// 地点抽屉 / 简介页纯逻辑测试：node --experimental-strip-types tools/checks/place-sheet-model.mjs
import assert from 'node:assert/strict'
import { anchorForMarker, computeSnaps, decideOwner, dragVisible, isPanelEligible, parseSheetQuery, resolveRelease } from '../../app/src/screens/placeSheetModel.ts'
import { introHeading, introParagraphs, isCoverCandidate, parsePhotoParam, pickCover } from '../../app/src/screens/placeIntroModel.ts'

// computeSnaps：预览不超过宿主高度（H − headH），单档时两档相等
assert.deepEqual(computeSnaps(816, 108), { previewH: 432, expandedH: 669, single: false })
assert.equal(computeSnaps(362, 108).single, true)
for (let H = 200; H <= 1400; H += 37) for (let headH = 0; headH <= 400; headH += 23) {
  const s = computeSnaps(H, headH)
  if (s.single) assert.ok(s.previewH === s.expandedH && s.expandedH <= H)
  else assert.ok(s.previewH <= H - headH && s.expandedH <= H && s.expandedH - s.previewH >= 80, `${H}/${headH}`)
}

// 手势归属
const base = { zone: 'body', scrollable: true, scrollTopAtStart: 0, dx: 0, touches: 1 }
assert.equal(decideOwner({ ...base, dy: 9 }), 'panel') // 展开态在顶部下拉 → 面板
assert.equal(decideOwner({ ...base, dy: -9 }), 'content') // 展开态上滑 → 正文
assert.equal(decideOwner({ ...base, scrollTopAtStart: 40, dy: 9 }), 'content') // 未到顶下滑 → 正文
assert.equal(decideOwner({ ...base, scrollable: false, dy: -9 }), 'panel') // 预览态正文上拖 → 面板
assert.equal(decideOwner({ ...base, zone: 'handle', scrollTopAtStart: 40, dy: 9 }), 'panel')
assert.equal(decideOwner({ ...base, dx: 20, dy: 9 }), 'none') // 横向
assert.equal(decideOwner({ ...base, touches: 2, dy: 9 }), 'none')
// 第一帧 dy=+1 锁定为拦截、到阈值时 dy=−9：归正文（调用方随即停止拦截，design-review F2）
assert.equal(isPanelEligible('body', true, 0, 1), true)
assert.equal(decideOwner({ ...base, dy: -9 }), 'content')

// 拖动与松手
const s = computeSnaps(816, 108)
assert.equal(dragVisible(s.expandedH, -200, s), s.expandedH) // 上限
assert.ok(dragVisible(s.previewH, 1000, s) >= s.previewH - 40) // 预览以下最多下沉 40
assert.equal(resolveRelease('preview', s.previewH - 40, 2, s), 'preview') // 预览下拉不关闭
assert.equal(resolveRelease('expanded', s.expandedH - 30, 0.6, s), 'preview')
assert.equal(resolveRelease('preview', s.previewH + 10, -0.6, s), 'expanded')

// 标记锚点（实测高度）：放得下时整体居中，底端距 visibleBottom 不越界
for (const [above, below] of [[111, 11], [40, -8], [100, 0]]) {
  const a = anchorForMarker(8, 123, above, below)
  assert.ok(a + below <= 123 + 1e-9, `bottom ${above}/${below}`)
  if (above + below <= 115) assert.ok(a - above >= 8 - 1e-9, `top ${above}/${below}`)
}
assert.equal(anchorForMarker(8, 40, 111, 11), 29) // 放不下：图钉底端贴住 visibleBottom

// URL
assert.equal(parseSheetQuery({ placeId: 'x', sheet: 'preview' }), null)
assert.deepEqual(parseSheetQuery({ placeId: 'aaaaaaaa-1111-4111-8111-000000000003', sheet: 'weird' }), { placeId: 'aaaaaaaa-1111-4111-8111-000000000003', detent: 'preview' })

// 简介页
assert.deepEqual(introParagraphs('a\n\nb', 'a\nc'), ['a', 'b', 'c'])
assert.deepEqual(introParagraphs('same', 'same'), ['same'])
assert.deepEqual(introParagraphs(null, ' '), [])
const photos = [{ imageUrl: '' }, { imageUrl: 'javascript:x' }, { imageUrl: 'data:image/svg+xml,1', source: '演示素材（待替换）' }, { imageUrl: '/a.jpg', source: '真实照片拍摄' }]
const { cover, rest } = pickCover(photos)
assert.equal(cover, photos[3])
assert.equal(rest.length, 3)
assert.equal(isCoverCandidate(photos[2]), false) // 演示素材不作封面 / 缩略图
assert.equal(parsePhotoParam('cover', 0, false), null)
assert.equal(parsePhotoParam('1', 2, true), 1)
assert.equal(parsePhotoParam('2', 2, true), null)
const h = new Map([['p', { id: 'p', name: '明湖', displayLevel: 'place', parentPlaceId: 's' }], ['s', { id: 's', name: '北京交通大学', displayLevel: 'school', parentPlaceId: null }]])
assert.deepEqual(introHeading('p', h, '地标'), { title: '地点简介', eyebrow: '北京交通大学 · 地标' })
assert.deepEqual(introHeading('s', h, '地标'), { title: '校园简介', eyebrow: '地标' })
assert.deepEqual(introHeading('p', null, '地标'), { title: '地点简介', eyebrow: '地标' })
console.log('place-sheet-model: ALL PASS')
