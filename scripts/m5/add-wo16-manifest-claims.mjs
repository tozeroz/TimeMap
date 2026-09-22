/**
 * ⭐ AUDIT.7 的兑现：把 **WO#16 涉及的两屏**的基线 claim 冻结进 manifest
 *
 * 依据（队列里我自己的承诺 + 审核 60/61 的纪律）：
 *   "后续每做一单（含 WO#16）都要照此补一屏的 claim 到 manifest"
 *   —— manifest 是审核 57/58 批准的**防结论漂移**机制：
 *      把"同一事实的解释"冻结下来，之后 Gate 只检查"实现是否违反冻结的 manifest"。
 *
 * 本次补两屏：
 *   ① `trident-campus`（校园广场页）—— baseline_file = screens/trident-campus/baseline.json
 *   ② `school-search`（学校搜索页）  —— **没有** screens/school-search 目录；
 *      证据在 `docs/original-baseline/supplements/schools.json` 的 `school_search` 段
 *      ⇒ 按 `user-profile` 的先例（baseline_file=null + 显式说明"证据在哪"）处理
 *
 * ⚠️ 每条 claim 的 `evidence` 都指向**具体测量来源**（门禁键名或探针字段），
 *    不写"已实现"这种无法复核的话。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const MANIFEST = 'G:\\demo map\\scripts\\m5\\fixtures\\baseline-manifest.json'

const campusSection = {
  baseline_file: 'docs/original-baseline/screens/trident-campus/baseline.json',
  baseline_evidence_strength:
    '**有基线**：states.normal=observed。interactions[1] 逐字记「顶部：大标题 Campus + ' +
    '副标题「校园广场 ▼」+ 右上消息气泡」；known_unknowns 记分页/下拉刷新手势未观察。',
  claims_explanation:
    'WO#16 层 A/B（审核 60/61）。层 A 移除 mock 学校数据、层 B 改接权威实体。' +
    '测量在 gate-wo16a-campus-mock.mjs（5 键）与 gate-wo16b-schools.mjs（8 键，含面板 3 键）。' +
    '⚠️ 与**地图页**的顶部控件**不是同一个东西**（审核 60/61 都强调过）：' +
    '地图页显示「学校（校区）」，校园广场页显示固定标签「校园广场」——**不可互相套用**。',
  claims: [
    {
      id: 'CAMPUS_SUBTITLE_TEXT',
      claim: '顶部副标题逐字为「校园广场」（▼ 由 BigTitle 组件附加）',
      evidence:
        'baseline interactions[1] = "…副标题「校园广场 ▼」…"；' +
        '**设备实测** gate-wo16a-campus-mock.mjs 的 CAMPUS_SUBTITLE_IS_LITERAL ' +
        '（BASELINE_CLAIMS 读 .map__title 之外，本屏读 .bigtitle__sub ⇒ subtitle="校园广场"）',
      status: 'MATCH',
      implementation_impact:
        '已实现（WO#16 层 A）：常量 CAMPUS_SUBTITLE="校园广场"。' +
        '⚠️ 改前此处显示 mock 的学校名（campusInfo.name），那是偏差 —— 见 A-D-LIST.md §五之二',
      work_order: 'WO#16',
      deviation_id: null,
      _fixed_in: 'WO#16 层 A（commit 2e0d3a6）',
    },
    {
      id: 'CAMPUS_TAB_BAR_THREE_ITEMS',
      claim: '底部文字 tab 为 3 项（自定义名称6/校园/地图）',
      evidence: 'baseline interactions[2] = "底部导航三项 + 右下黑色圆形 + 按钮"；对照 A-D-LIST.md §五 的定稿结论',
      status: 'MATCH',
      implementation_impact: '已实现：TabBar.tsx（navigate me/campus/map）+ tabbar__fab → publish',
      work_order: null,
      deviation_id: null,
    },
    {
      id: 'CAMPUS_WATERFALL_LAYOUT',
      claim: '主体是两列瀑布流（双列 + 高度不等 + y 交错）',
      evidence:
        'A-D-LIST.md §五「校园广场呈现模型：原版**两列瀑布流**（见 FINDING-campus-layout-waterfall.md）」；' +
        '我们 campus.css 用 column-count:2',
      status: 'MATCH',
      implementation_impact: '已实现：CampusScreen 的 campus__grid + campus.css',
      work_order: null,
      deviation_id: null,
    },
    {
      id: 'CAMPUS_PICKER_CONTENT',
      claim: '点「校园广场 ▼」后面板的内容（原版 = 校区列表 + 搜索其他学校入口）',
      evidence:
        '证据在 supplements/schools.json 的 campus_picker（「北京交通大学（当前学校）」+ 校本部/威海校区/东校区 + 搜索其他学校）；' +
        '⚠️ 该证据采自**地图页**同类控件，本页形态**未逐项观察** ⇒ 只按"结构对齐"主张；' +
        '**设备实测**（gate-wo16b-schools.mjs）：CAMPUS_PANEL_TITLE（标题="北京交通大学（当前学校）"）、' +
        'CAMPUS_PANEL_FROM_AUTHORITY（项=该校 3 个校区）、SCHOOL_SEARCH_ENTRY_NAVIGATES（入口→#/schools）',
      status: 'DEVIATION_DELIBERATE',
      implementation_impact:
        '层 A 曾是"尚未接入"占位（登记 D-004 TEMPORARY）；层 B 已改为渲染**权威实体**。' +
        '⚠️ 但**计数**仍为 null（归属未建模）⇒ 该部分**未**恢复到原版形态',
      work_order: 'WO#16',
      deviation_id: 'D-004',
    },
    {
      id: 'CAMPUS_MOCK_DATA_ABSENT',
      claim: '本屏不得出现 mock 的 8 所学校与编造成员数',
      evidence:
        '**设备实测** gate-wo16a-campus-mock.mjs：CAMPUS_NO_MOCK_SCHOOL_NAMES ／ ' +
        'CAMPUS_NO_FABRICATED_NUMBERS（禁用 ' +
        '12,486 ／ 38,920 ／ "位同学" 与 7 个**只在 mock 里存在**的学校名）；' +
        '⚠️ 刻意**不**禁用「北京交通大学」——那是我们 seed 真实在用的学校名，禁用会造成假 FAIL',
      status: 'MATCH',
      implementation_impact:
        '已实现：`campusInfo` / `schools` 已从生产 mock.ts **移出**（→ scripts/m5/fixtures/legacy-schools.json）',
      work_order: 'WO#16',
      deviation_id: null,
      _fixed_in: 'WO#16 层 A（commit 2e0d3a6）',
    },
  ],
}

const schoolSearchSection = {
  baseline_file: null,
  baseline_evidence_strength:
    '**没有** screens/school-search 目录；证据在 `docs/original-baseline/supplements/schools.json` 的 ' +
    '`school_search` 段（M3 Evidence Preflight 采集，verdict=SUPPORTED）：' +
    '搜索框「搜索选择学校...」/ 分组「更多学校」/ 行格式「学校名 (校区名)」+「N条校园圈」+ 可选「X小时前更新」/' +
    'activity=com.xingin.xhsreactnative.ui.XhsReactActivity。',
  claims_explanation:
    'WO#16 层 B 新增的屏。测量在 gate-wo16b-schools.mjs（8 键，其中 5 键属本屏）。' +
    '⚠️ 期望值全部从**实时 API** 取（不硬编码实体名）⇒ 换种子不会假 FAIL。',
  claims: [
    {
      id: 'SCHOOL_SEARCH_PLACEHOLDER',
      claim: '搜索框 placeholder 逐字「搜索选择学校...」',
      evidence:
        'supplements/schools.json → school_search[0]；**设备实测** gate-wo16b-schools.mjs 的 ' +
        'SCHOOL_SEARCH_PLACEHOLDER（读 .ss__input 的 placeholder 属性）',
      status: 'MATCH',
      implementation_impact: '已实现：SchoolSearchScreen.tsx',
      work_order: 'WO#16',
      deviation_id: null,
    },
    {
      id: 'SCHOOL_SEARCH_GROUP_LABEL',
      claim: '分组标题逐字「更多学校」',
      evidence: 'supplements/schools.json → school_search[1]；**设备实测** SCHOOL_SEARCH_GROUP_LABEL',
      status: 'MATCH',
      implementation_impact: '已实现：SchoolSearchScreen.tsx',
      work_order: 'WO#16',
      deviation_id: null,
    },
    {
      id: 'SCHOOL_ROW_SHAPE',
      claim: '每行格式为「学校名 (校区名)」',
      evidence:
        'supplements/schools.json → school_search[2]（实例「北京交通大学 (校本部)」）；' +
        '**设备实测** SCHOOL_ROW_SHAPE 与 SCHOOL_ROWS_FROM_AUTHORITY' +
        '（用 API 返回的实体拼出期望值，做**多重集**比较，不比数组顺序）',
      status: 'MATCH',
      implementation_impact: '已实现：行文本 `{school.name} ({campus.name})`',
      work_order: 'WO#16',
      deviation_id: null,
    },
    {
      id: 'CIRCLE_COUNT_NULL_NOT_ZERO',
      claim: '「N条校园圈」的计数在**无法由权威归属计算**时必须是 null，且 UI 不渲染计数字段',
      evidence:
        '**审核 60 的计数策略 A**（不是从基线转述，而是审核裁定）：' +
        'count=COUNT(posts WHERE school_campus_id=campus.id)；无法计算时给 null，**不是 0**、不由 place 推断。' +
        '**设备实测** CIRCLE_COUNT_NULL_NOT_RENDERED（按服务端**实际返回**分支判定：' +
        '全 null ⇒ 不许渲染计数；有数字 ⇒ 必须渲染出该数字）+ ' +
        'gate-place-not-campus.mjs 的 PLACE_DOES_NOT_IMPLY_CAMPUS_DATA',
      status: 'MATCH',
      implementation_impact:
        '已实现：服务端返回 campusCircleCount=null（attributionEstablished=false 时全 null）；' +
        'UI 仅在非 null 时渲染',
      work_order: 'WO#16',
      deviation_id: null,
    },
    {
      id: 'SCHOOL_SEARCH_CONTENT_SCALE',
      claim: '学校搜索页的**内容规模**与原版一致',
      evidence:
        '原版那次快照里有 4+ 所学校（上海视觉艺术学院/上海交通大学/北京交通大学/浙江师范大学）' +
        '与它们的 15/2502/4/329 计数；**我们只有 1 所**（种子北交大，3 校区）',
      status: 'NOT_EVALUATED',
      implementation_impact:
        '**有意不复制**：审核 61 `SEARCH_CONTENT_SCALE_DIFFERENCE: ACCEPTABLE / DOCUMENTED`' +
        '——那些是原版某次真实数据快照，不是我们 demo 必须复制的数据集。' +
        '要对齐的是**结构与语义**（行格式/计数位置/搜索入口/选择行为），不是数据规模',
      work_order: 'WO#16',
      deviation_id: null,
    },
    {
      id: 'ORIGINAL_EMPTY_CIRCLE_PRESENTATION',
      claim: '原版对「0 条校园圈」的圈子显示什么（"0条校园圈"？隐藏？）',
      evidence: '基线**未观察**到 0 条计数时的呈现（原版那次快照里每行都有非 0 计数）',
      status: 'NOT_EVALUATED',
      implementation_impact: '不做主张。我们的处置（null ⇒ 不渲染）是 OUR_DESIGN_CHOICE',
      work_order: null,
      deviation_id: null,
    },
  ],
}

const j = JSON.parse(readFileSync(MANIFEST, 'utf8'))
j.screens['trident-campus'] = campusSection
j.screens['school-search'] = schoolSearchSection
writeFileSync(MANIFEST, JSON.stringify(j, null, 2) + '\n', 'utf8')

const keys = Object.keys(j.screens)
console.log('  manifest 现有屏（' + keys.length + '）: ' + keys.join(', '))
for (const k of ['trident-campus', 'school-search']) {
  const s = j.screens[k]
  console.log(
    '    ' + k + ': ' + s.claims.length + ' claims（MATCH ' +
      s.claims.filter((c) => c.status === 'MATCH').length + ' ／ NOT_EVALUATED ' +
      s.claims.filter((c) => c.status === 'NOT_EVALUATED').length + ' ／ DEVIATION_DELIBERATE ' +
      s.claims.filter((c) => c.status === 'DEVIATION_DELIBERATE').length + '）',
  )
}
