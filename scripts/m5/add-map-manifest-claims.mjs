/**
 * AUDIT.7 落地：把 **地图页（trident-map）** 的基线 claim 冻结进 manifest
 *
 * ## 为什么需要这个（AUDIT.7 是队列里的一条纪律）
 *   `scripts/m5/fixtures/baseline-manifest.json` 已冻结 6 屏（feed-list / message / group /
 *   user-profile / profile-edit / at-panel），但**WO#15 的地图页不在其中**。
 *   而 WO#15 的 Gate 里已经有该屏的设备测量 ⇒ 正应该按既有先例把它**冻结**下来：
 *     · claim  +  status  +  evidence（**指向本 Gate 的测量值**）
 *   ⇒ 这样"同一事实不会这次判 MATCH、下次判 DEVIATION"（manifest 检查器会守住引用完整性）。
 *
 * ## 证据类型的**如实标注**（不夸大）
 *   本屏有两种证据强度，我在每条 evidence 里写清是哪一种：
 *     · **设备实测**：Gate 在真机上量到的值（有具体字段名）
 *     · **源码确认**：读出实现里写死的目标（例如 navigate('poi')）——
 *       ⚠️ 这不等于"设备侧验证了跳转结果"，我**不**把它写成设备实测
 *
 * 用法：node scripts/m5/add-map-manifest-claims.mjs           # 写入
 *       node scripts/m5/add-map-manifest-claims.mjs --check    # 只看现有状态
 */
import { readFileSync, writeFileSync } from 'node:fs'

const MANIFEST = 'G:\\demo map\\scripts\\m5\\fixtures\\baseline-manifest.json'
const GATE = 'scripts/m5/gate-wo15-map-markers.mjs'
const KEY = 'trident-map'

const section = {
  baseline_file: 'docs/original-baseline/screens/trident-map/baseline.json',
  baseline_evidence_strength:
    '**有基线**：states.normal=observed（normal.png）。' +
    '但 known_unknowns 明记「具体缩放级别与标记规则未记录」、「首次进入的授权弹窗本次未出现」' +
    '⇒ 视觉/语义类只能 NOT_EVALUATED，不得用 DOM 存在性冒充。',
  claims_explanation:
    'WO#15（Round 265–267）落地。测量块在 ' +
    GATE +
    ' 的 BASELINE_CLAIMS_MEASURED（Gate 用 provider 无关量 + 显式 data-* 钩子）。' +
    '⚠️ 本屏的"证据"分两类并在每条里写明：**设备实测**（真机量到的字段值）' +
    '与 **源码确认**（实现里写死的目标）—— 后者不算设备验证结果。',
  claims: [
    {
      id: 'MAP_TITLE_LITERAL',
      claim: '顶部大标题逐字为「Map」',
      evidence:
        'baseline interactions[0] = "顶部：大标题 Map + 地区选择…"；' +
        '**设备实测** BASELINE_CLAIMS_MEASURED.bigTitle = "Map"（选择器 .map__title）' +
        '—— ⚠️ 我第一版用 .bigtitle__main 量到 null 造成假 FAIL：' +
        '地图页**不用 BigTitle 组件**，有自己的 .map__title 结构（MapScreen.tsx:520）。',
      status: 'MATCH',
      implementation_impact: '已实现：MapScreen.tsx:520 <h1 className="map__title">Map</h1>',
      work_order: 'WO#15',
      deviation_id: null,
    },
    {
      id: 'MAP_REGION_TEXT',
      claim: '顶部地区选择文字含「北京交通大学（校本部）」',
      evidence:
        'baseline interactions[0] = "…地区选择「北京交通大学（校本部）」…"；' +
        '**设备实测** BASELINE_CLAIMS_MEASURED.regionText = "北京交通大学（校本部）"',
      status: 'MATCH',
      implementation_impact: '已实现：MapScreen.tsx:521 .map__region',
      work_order: 'WO#15',
      deviation_id: null,
    },
    {
      id: 'MAP_MESSAGE_CONTROL',
      claim: '顶部右上是消息图标',
      evidence:
        'baseline interactions[0] = "…+ 右上消息图标"；' +
        '**设备实测** BASELINE_CLAIMS_MEASURED.msgAria = "消息"',
      status: 'MATCH',
      implementation_impact: '已实现：MapScreen.tsx:526 aria-label="消息"',
      work_order: 'WO#15',
      deviation_id: null,
    },
    {
      id: 'MAP_BOTTOM_RIGHT_CONTROLS',
      claim: '右下有「定位复位按钮」与圆形发布按钮（+）',
      evidence:
        'baseline interactions[2] = "右下：定位复位按钮 + 黑色圆形 +"；' +
        '**设备实测** BASELINE_CLAIMS_MEASURED.locateAria = "回到定位"、ctrlCount = 2、' +
        'fabAria = "发布"（两枚 .map__ctrl + 一枚 .map__fab）',
      status: 'MATCH',
      implementation_impact: '已实现：MapScreen.tsx:649 aria-label="回到定位"、:652 aria-label="放大"、:657 aria-label="发布"',
      work_order: 'WO#15',
      deviation_id: null,
    },
    {
      id: 'MAP_GEO_PERMISSION_MODAL',
      claim: '首次进入地图页有阻断式「授权地理位置」弹窗',
      evidence:
        'baseline known_unknowns[0] 记「page-map.md 记录首次进入会有阻断式『授权地理位置』弹窗；' +
        '本次采集时弹窗未出现」；' +
        '**设备实测** BASELINE_CLAIMS_MEASURED.geoModalPresent = true、geoModalTitle = "授权地理位置"' +
        '（并见 WO15.6 的专门自测 selftest-dismiss-modals.mjs：强制重启 App 后弹窗必现）',
      status: 'MATCH',
      implementation_impact:
        '已实现且**已被专门治理**：该弹窗会跨 Gate 残留（曾导致 WO#14 门禁偶发失败），' +
        '现由 run-device-gate.sh 第 8 步 + dismiss-blocking-modals.mjs 收起，' +
        '并加了 data-blocking-modal 通用登记位',
      work_order: 'WO#15',
      deviation_id: null,
    },
    {
      id: 'MAP_TENCENT_BASEMAP',
      claim: '底图是腾讯地图 SDK',
      evidence:
        'baseline known_unknowns[1] = "地图底图为腾讯地图 SDK"；' +
        '**设备实测** BASELINE_CLAIMS_MEASURED.providerText = "腾讯地图" 且 hasTencentWatermark = true' +
        '（页面含 ©2026 Tencent 水印）',
      status: 'MATCH',
      implementation_impact: '默认 provider 为腾讯（与之一致）；另有高德/栅格/离线自绘三条回落路径',
      work_order: 'WO#15',
      deviation_id: null,
    },
    {
      id: 'MAP_REGION_TO_POI',
      claim: '点地区名 → 进入选点页（poi/search）',
      evidence:
        'baseline navigation[0] = "地区名 → 选点页（poi/search）"；' +
        '**设备实测**该控件存在（regionText 非空）；' +
        '**源码确认**其 onClick 为 navigate(\'poi\')（MapScreen.tsx:521）' +
        '⚠️ 本条**未**在设备上点击并确认落点 —— 设备侧只验了控件存在与文案；' +
        '点击后的落点由源码确认（真机点击验证列为待办，不在此冒充已验）',
      status: 'MATCH',
      implementation_impact: '已实现：navigate(\'poi\')',
      work_order: 'WO#15',
      deviation_id: null,
      _known_gap: '真机点击落点未验证（源码确认）',
    },
    {
      id: 'MAP_PLUS_TO_PUBLISH',
      claim: '点 + → 进入发布页',
      evidence:
        'baseline navigation[1] = "+ → 发布页"；' +
        '**设备实测** fabAria = "发布"；**源码确认** onClick 为 navigate(\'publish\')（MapScreen.tsx:657）' +
        '⚠️ 同 MAP_REGION_TO_POI：设备侧未点击确认落点',
      status: 'MATCH',
      implementation_impact: '已实现：navigate(\'publish\')',
      work_order: 'WO#15',
      deviation_id: null,
      _known_gap: '真机点击落点未验证（源码确认）',
    },
    {
      id: 'MAP_MARKER_PRESENTATION',
      claim: '主体：地图 + **用户头像标记** + **深色气泡卡片**',
      evidence:
        'baseline interactions[1] 记录了这个组合；但：' +
        '① "深色"是**视觉属性**，DOM 存在性证明不了；' +
        '② 我们的标记是「照片卡片 + 彩色图钉 + 地名」，与"用户头像标记"是否同一物**无定论**' +
        '（supplements/poi-detail.json 记的是图钉＝**照片缩略图**，与"头像"表述不一致）；' +
        '③ 机械像素分析（Round 266）只能给"存在红/蓝色块"这类**测量**，给不出语义。' +
        '⇒ 不做任何一致性主张。',
      status: 'NOT_EVALUATED',
      implementation_impact: '保持现状；标记配色/气泡形态另立可视化核对（见 WO15.4/15.5）',
      work_order: null,
      deviation_id: null,
    },
    {
      id: 'MAP_ZOOM_AND_MARKER_RULES',
      claim: '缩放级别与标记规则与原版一致',
      evidence: 'baseline known_unknowns[1] 明记「具体缩放级别与标记规则**未记录**」⇒ 原版侧无证据可比',
      status: 'NOT_EVALUATED',
      implementation_impact: '不做主张。已按审核 58 处置"未校准投影时 offline 不渲染权威标记"',
      work_order: null,
      deviation_id: null,
    },
    {
      id: 'MAP_OFFLINE_RENDERING',
      claim: 'offline 底图是否应渲染权威标记',
      evidence:
        '基线**没有**离线自绘底图这回事（原版只有腾讯 SDK）⇒ 我方独有形态，无原版可比；' +
        '但**我们自己的位置正确性**可判：未校准投影 ⇒ 不渲染。' +
        '**设备实测** OFFLINE_RENDERS_NO_GEO_MARKERS：离线 DOM 标记数 = 0 且徽标 = offline-unsupported',
      status: 'MATCH',
      implementation_impact:
        '审核 58 的选项 A：offline 不渲染权威标记 + 明确说明「离线底图不支持标记显示」' +
        '（不能只把投影一致性写成 NOT_EVALUATED 却仍把标记画给用户看）',
      work_order: 'WO#15',
      deviation_id: null,
    },
  ],
}

const raw = readFileSync(MANIFEST, 'utf8')
const j = JSON.parse(raw)

if (process.argv.includes('--check')) {
  console.log('  现有 manifest 屏幕:', Object.keys(j.screens).join(', '))
  console.log('  是否已含 ' + KEY + ':', KEY in j.screens)
  process.exit(0)
}

if (KEY in j.screens) {
  console.log('  ' + KEY + ' 已存在，覆盖为新版本')
}
// 插到 screens 里（保持其它屏顺序；新键追加到末尾即可）
j.screens[KEY] = section
writeFileSync(MANIFEST, JSON.stringify(j, null, 2) + '\n', 'utf8')
console.log('  已写入 ' + KEY + ' 段，claims = ' + section.claims.length)
console.log('    MATCH: ' + section.claims.filter((c) => c.status === 'MATCH').length)
console.log('    NOT_EVALUATED: ' + section.claims.filter((c) => c.status === 'NOT_EVALUATED').length)
