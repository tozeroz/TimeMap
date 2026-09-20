/**
 * M0：生成原版行为基线（docs/original-baseline/）
 *
 * 输入：本文件里的 SCREENS 元数据表 + screens/<id>/*.png 实际截图
 * 输出：
 *   docs/original-baseline/manifest.json      —— 期望 22 页，供 Gate 判定 expected/completed
 *   docs/original-baseline/environment.json   —— 采集环境 metadata（可复现性）
 *   docs/original-baseline/screens/<id>/baseline.json
 *   docs/original-baseline/SHA256SUMS         —— 锁住冻结证据
 *
 * 状态枚举（固定，不允许留空）：
 *   observed / not_applicable / not_reproducible / blocked / unknown
 *
 * 用法： node scripts/m0/gen-baseline.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BASE = path.join(ROOT, 'docs', 'original-baseline')
const SHOTS = path.join(BASE, 'screens')

/** 采集环境（M0 冻结；改动需重新采集并更新校验和） */
const ENVIRONMENT = {
  captured_at: '2026-09-21T03:00+08:00',
  method: 'deep-link (campusx://) + adb screencap; 个人/地图 tab 用底部导航点击',
  device: {
    emulator: 'MuMu (Android 12)',
    model: 'BVL-AN00',
    resolution: '1080x1920',
    dpi: 'unknown',
    font_scale: 'unknown',
    locale: 'zh-CN',
    theme: 'light',
    orientation: 'portrait (rotation locked 0)',
  },
  app: {
    package: 'com.kairuotu.campus',
    app_version: 'unknown',
    version_code: 'unknown',
    note: 'APK 由用户提供并安装于模拟器；版本号未从 app 内取得',
  },
  account_state: {
    logged_in: false,
    user_alias: 'account-A',
    note: '未登录。因此依赖登录态的页面（动态详情/评论/单聊/群聊/群公告）呈现错误页或空白态，这是原版真实行为，已如实记录。',
  },
  network_condition: '本机网络可达（部分页面仍返回「网络错误」，说明其强依赖后端）',
  data_precondition: '使用 app 本地已有数据；未做额外造数',
  evidence_note: 'login-sns 截图中的手机号已打码处理（[redacted]）',
}

/**
 * 22 个有界面的原版页面（来源：APK 内 TheRouter 路由表，见 docs/page-map.md）。
 * 每页记录：入口、四态、交互、跳转、持久化、未解之谜。
 */
const SCREENS = [
  {
    id: 'trident-campus',
    title: '校园广场（主容器默认 tab）',
    target: 'campusx://trident',
    activity: 'com.kairuotu.trident.TridentActivity',
    preconditions: ['app_launched'],
    steps: ['cold start 或 deep link campusx://trident'],
    states: { normal: 'observed', loading: 'not_reproducible', empty: 'not_reproducible', error: 'not_applicable' },
    interactions: [
      '双列瀑布流：图片 + 文案 + 作者头像/昵称 + 点赞数/评论数',
      '顶部：大标题 Campus + 副标题「校园广场 ▼」+ 右上消息气泡',
      '底部导航三项 + 右下黑色圆形 + 按钮（点击进入发布页 PostActivity）',
    ],
    navigation: ['底部 tab → 个人页 / 地图页', '+ → campusx://publish_post', '消息气泡 → 聊天列表'],
    persistence: ['无（纯浏览）'],
    known_unknowns: ['瀑布流的分页/加载更多行为未观察到', '下拉刷新手势未验证'],
  },
  {
    id: 'trident-me',
    title: '个人主页（底部 tab 1）',
    target: 'bottom-tab:135,1810（无 deep link）',
    activity: 'com.kairuotu.trident.TridentActivity',
    preconditions: ['app_launched', '已在主容器'],
    steps: ['deep link campusx://trident', '点击底部第一个 tab（x=135,y=1810）'],
    states: { normal: 'observed', loading: 'not_reproducible', empty: 'not_reproducible', error: 'not_applicable' },
    interactions: [
      '顶栏：菜单图标 / 分享图标 / 右侧消息图标',
      '用户区：左「我的兴趣 ›」「我的标签 ›」；中间头像+昵称+「编辑资料」；右「介绍一下自己～ ›」「我的学校 ›」',
      '中部：黑色胶囊按钮 + 蓝色气泡提示',
    ],
    navigation: ['「编辑资料」→ 资料编辑页', '「我的兴趣/标签/学校」→ 二级编辑页'],
    persistence: ['资料修改应持久化（未登录态下未验证）'],
    known_unknowns: ['未登录时资料区显示的是本地缓存还是默认值', 'tab 名称来自用户昵称（本机显示「自定义名称6」）'],
  },
  {
    id: 'trident-map',
    title: '地图页（底部 tab 3）',
    target: 'bottom-tab:675,1810（deep link campusx://map 在 singleTask 下不生效）',
    activity: 'com.kairuotu.trident.TridentActivity',
    preconditions: ['app_launched', '已在主容器'],
    steps: ['deep link campusx://trident', '点击底部第三个 tab（x=675,y=1810）'],
    states: { normal: 'observed', loading: 'not_reproducible', empty: 'not_reproducible', error: 'not_applicable' },
    interactions: [
      '顶部：大标题 Map + 地区选择「北京交通大学（校本部）」+ 右上消息图标',
      '主体：地图 + 用户头像标记 + 深色气泡卡片',
      '右下：定位复位按钮 + 黑色圆形 +',
    ],
    navigation: ['地区名 → 选点页（poi/search）', '+ → 发布页'],
    persistence: ['无'],
    known_unknowns: [
      'page-map.md 记录首次进入会有阻断式「授权地理位置」弹窗；本次采集时弹窗未出现（此前已授权/已选择过）',
      '地图底图为腾讯地图 SDK；具体缩放级别与标记规则未记录',
    ],
  },
  {
    id: 'feed-list',
    title: '校园圈',
    target: 'campusx://feed/list',
    activity: 'com.kairuotu.feed.list.FeedActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://feed/list'],
    states: { error: 'observed', normal: 'not_reproducible', loading: 'not_reproducible', empty: 'not_reproducible' },
    interactions: ['顶部「校园圈」+「北京交通大学 ▼」+ 左上关闭', '中央：网络错误图标 + 「网络不给力，点击刷新试试」+ 刷新按钮'],
    navigation: ['关闭 → 返回上一页', '刷新 → 重新请求'],
    persistence: ['无'],
    known_unknowns: ['有后端且已登录时的正常列表长什么样（本机无法进入）'],
  },
  {
    id: 'feed-daily',
    title: '今日打卡',
    target: 'campusx://feed/daily',
    activity: 'com.kairuotu.feed.list.DailyFeedListActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://feed/daily'],
    states: { normal: 'observed', empty: 'observed', error: 'not_reproducible', loading: 'not_reproducible' },
    interactions: ['顶部返回 + 分享', '上半：黄色品牌图（Campus）；下半灰白内容区（本机为空）'],
    navigation: ['返回 → 上一页', '分享 → 系统分享面板'],
    persistence: ['无'],
    known_unknowns: ['下半内容区在完赛/打卡数据存在时展示什么'],
  },
  {
    id: 'feed-detail',
    title: '动态详情',
    target: 'campusx://feed/detail',
    activity: 'com.kairuotu.feed.detail.FeedDetailActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://feed/detail（未带 id 参数）'],
    states: { error: 'observed', normal: 'unknown', loading: 'not_reproducible', empty: 'not_reproducible' },
    interactions: ['左上返回 + 右上更多', '中央：网络错误图标 + 「网络不给力，点击刷新试试」+ 刷新按钮'],
    navigation: ['返回 → 上一页'],
    persistence: ['无'],
    known_unknowns: ['带合法 id 且已登录时的详情结构（图片/点赞/评论区）必须由 demo 依据设计还原，本机无法观察'],
  },
  {
    id: 'comment-detail',
    title: '评论详情',
    target: 'campusx://feed/comment/detail',
    activity: 'com.kairuotu.feed.detail.CommentDetailActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://feed/comment/detail（未带参数）'],
    states: { normal: 'unknown', empty: 'observed', error: 'not_reproducible', loading: 'not_reproducible' },
    interactions: ['左上返回 + 右上更多', '页面全白，无列表内容'],
    navigation: ['返回 → 上一页'],
    persistence: ['无'],
    known_unknowns: ['page-map.md 记为「需带参数，直接打开为空态」；带参数时的结构未知'],
  },
  {
    id: 'message-board',
    title: '留言板',
    target: 'campusx://messageBoard',
    activity: 'com.kairuotu.feed.messageboard.MessageBoardActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://messageBoard'],
    states: { normal: 'observed', empty: 'unknown', loading: 'not_reproducible', error: 'not_reproducible' },
    interactions: [
      '顶部「留言」+ 副标题「仅双方可见」',
      '彩色便签式留言列表',
      '底部：表情行 + 输入框「可以给同学留言噢」+ 按钮「留言」',
    ],
    navigation: ['返回 → 上一页'],
    persistence: ['留言应持久化（未验证）'],
    known_unknowns: ['无留言时的空态样式', '表情行的完整表情集合'],
  },
  {
    id: 'poi-search',
    title: '地点搜索 / 选点',
    target: 'campusx://poi/search',
    activity: 'com.kairuotu.poi.CampusPoiSearchActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://poi/search'],
    states: { normal: 'observed', empty: 'not_reproducible', loading: 'not_reproducible', error: 'not_reproducible' },
    interactions: [
      '左上关闭、右上「确认」',
      '搜索框提示「搜索地点」；列表首项「不添加地点」',
      '列表项：地点名 + 地址（如「北京交通大学 / 西直门外上园村3号」）',
    ],
    navigation: ['选中 + 确认 → 回到来源页并带上地点'],
    persistence: ['无'],
    known_unknowns: ['搜索结果排序规则；无结果时的空态'],
  },
  {
    id: 'poi-detail',
    title: '地点详情',
    target: 'campusx://feed/poi/detail（实测回落到 trident，deep link 不生效）',
    activity: '（未落到目标 Activity）',
    preconditions: ['app_launched', '需要一个有效地点参数'],
    steps: ['尝试 deep link campusx://feed/poi/detail → 前台仍是 TridentActivity（校园广场）'],
    states: { normal: 'not_reproducible', loading: 'not_reproducible', empty: 'not_reproducible', error: 'not_reproducible' },
    interactions: [],
    navigation: [],
    persistence: [],
    known_unknowns: [
      '该 deep link 不带参数时不路由；真实入口应是地图/动态里的地点点击',
      '地点详情页的真实结构需要在有内容时才能观察（见 blocked 原因）',
    ],
    blocked_reason: 'deep link 无法直达，且需要登录态下的真实地点数据才能进入',
  },
  {
    id: 'publish',
    title: '发布（相机）',
    target: 'campusx://publish_post',
    activity: 'com.kairuotu.post.activity.PostActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://publish_post；或主容器右下 + 按钮'],
    states: { normal: 'observed', error: 'unknown', loading: 'not_reproducible', empty: 'not_applicable' },
    interactions: [
      '顶部：左上关闭 + 地点胶囊「📍<地点名> ×」',
      '取景框（真实相机预览）',
      '底部：变焦 1x / 2 / 5；模式 语音 / 拍摄 / 文字；快门按钮；相册与前后置切换',
    ],
    navigation: ['关闭 → 上一页', '地点胶囊 → 选点页', '快门 → 拍摄并入草稿'],
    persistence: ['草稿在会话内保留'],
    known_unknowns: ['无相机权限时的降级界面', '语音模式的真实录音交互'],
  },
  {
    id: 'message',
    title: '聊天列表',
    target: 'campusx://message',
    activity: 'com.kairuotu.chat.messagepage.view.MessageActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://message'],
    states: { normal: 'observed', empty: 'unknown', loading: 'not_reproducible', error: 'not_reproducible' },
    interactions: [
      '顶部「聊天」+ 左上关闭 + 右上加号',
      '邀请卡「分享我的校园卡 / 邀请同学一起加入 Campus! / 邀请同学」',
      '「更多同学」列表：昵称 + 相同学校标签 + MBTI/星座 + 学院-专业 + 年级',
    ],
    navigation: ['点会话 → 单聊', '邀请同学 → 分享面板', '右上加号 → 新建会话'],
    persistence: ['会话列表应持久化（未验证）'],
    known_unknowns: ['已存在会话时的列表样式（本机为 0 会话）'],
  },
  {
    id: 'chat',
    title: '单聊',
    target: 'campusx://chat',
    activity: 'com.kairuotu.chat.conversation.ChatActivity',
    preconditions: ['app_launched', '需要会话参数'],
    steps: ['deep link campusx://chat（未带参数）'],
    states: { empty: 'observed', normal: 'unknown', loading: 'not_reproducible', error: 'not_reproducible' },
    interactions: ['顶部昵称 + 返回 + 更多', '底部输入框「发消息...」+ 表情 + 加号'],
    navigation: ['返回 → 上一页'],
    persistence: ['消息应持久化（未验证）'],
    known_unknowns: ['带会话参数时的消息气泡样式、时间分组、已读状态'],
  },
  {
    id: 'group',
    title: '群聊',
    target: 'campusx://group',
    activity: 'com.kairuotu.chat.conversation.GroupChatActivity',
    preconditions: ['app_launched', '需要群参数'],
    steps: ['deep link campusx://group（未带参数）'],
    states: { empty: 'observed', normal: 'unknown', loading: 'not_reproducible', error: 'not_reproducible' },
    interactions: ['顶部昵称 + 返回 + 更多', '底部输入框 + 表情 + 加号'],
    navigation: ['返回 → 上一页'],
    persistence: ['消息应持久化（未验证）'],
    known_unknowns: ['群成员列表、@面板入口、群公告入口的位置'],
  },
  {
    id: 'announce',
    title: '群公告',
    target: 'campusx://announce',
    activity: 'com.kairuotu.chat.announce.AnnounceActivity',
    preconditions: ['app_launched', '需要群参数'],
    steps: ['deep link campusx://announce（未带参数）'],
    states: { empty: 'observed', normal: 'unknown', loading: 'not_reproducible', error: 'not_reproducible' },
    interactions: ['顶部标题「校园活动」+ 左上返回', '内容区为空'],
    navigation: ['返回 → 上一页'],
    persistence: ['无'],
    known_unknowns: ['有公告内容时的排版（标题/正文/发布者/时间）'],
  },
  {
    id: 'scanner',
    title: '扫码',
    target: 'campusx://scanner',
    activity: 'com.kairuotu.scanner.scanner.QrCodeScannerActivityV2',
    preconditions: ['app_launched', '相机权限'],
    steps: ['deep link campusx://scanner'],
    states: { normal: 'observed', error: 'unknown', loading: 'not_reproducible', empty: 'not_applicable' },
    interactions: ['左上返回箭头', '取景框 + 提示「请将二维码对准扫码框中心」', '底部「我的二维码」「相册」'],
    navigation: ['我的二维码 → 二维码展示页', '相册 → 系统相册选图识别'],
    persistence: ['无'],
    known_unknowns: ['识别成功后的结果处理路径', '无相机权限时的降级界面'],
  },
  {
    id: 'login-select',
    title: '登录（选择方式）',
    target: 'campusx://login/select',
    activity: 'com.kairuotu.account.login.activity.CampusLoginActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://login/select'],
    states: { normal: 'observed', loading: 'not_reproducible', empty: 'not_applicable', error: 'unknown' },
    interactions: ['Campus logo + 装饰元素', '底部「登录 Campus」按钮 + 协议勾选'],
    navigation: ['登录 Campus → 手机号登录页'],
    persistence: ['登录态应持久化（未验证）'],
    known_unknowns: ['协议未勾选时按钮是否禁用'],
  },
  {
    id: 'login-sns',
    title: '手机号登录',
    target: 'campusx://login/sns',
    activity: 'com.kairuotu.account.login.activity.CampusSnsLoginActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://login/sns'],
    states: { normal: 'observed', loading: 'not_reproducible', empty: 'not_applicable', error: 'unknown' },
    interactions: ['标题「输入手机号」', '区号 +86 + 手机号输入框 +「获取验证码」按钮'],
    navigation: ['获取验证码 → 进入验证码输入'],
    persistence: ['无'],
    known_unknowns: ['验证码倒计时、错误提示、协议勾选的强制时机'],
    evidence_note: '截图中的手机号已打码为 [redacted]',
  },
  {
    id: 'onboarding',
    title: '新手引导（昵称）',
    target: 'campusx://login/onboarding',
    activity: 'com.kairuotu.account.login.activity.CampusOnBoardingActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://login/onboarding'],
    states: { normal: 'observed', loading: 'not_reproducible', empty: 'not_applicable', error: 'unknown' },
    interactions: ['标题「告诉大家，怎么称呼你？」', '昵称输入框 + 灰色「就这样」按钮 + 装饰元素'],
    navigation: ['就这样 → 下一步引导'],
    persistence: ['昵称应持久化（未验证）'],
    known_unknowns: ['引导共有几步、每步内容'],
  },
  {
    id: 'upgrade-alert',
    title: '升级弹窗',
    target: 'campusx://upgradeAlert',
    activity: 'com.kairuotu.base.update.AppUpdateDialogActivity',
    preconditions: ['app_launched'],
    steps: ['deep link campusx://upgradeAlert'],
    states: { normal: 'observed', loading: 'not_reproducible', empty: 'not_applicable', error: 'unknown' },
    interactions: ['弹窗叠在校园广场上：标题 + 版本说明 +「取消」「立即更新」'],
    navigation: ['取消 → 回到广场', '立即更新 → 下载/商店'],
    persistence: ['无'],
    known_unknowns: ['强制更新（不可取消）时的形态'],
  },
  {
    id: 'media-preview',
    title: '图片预览',
    target: 'campusx://chat/media-preview（实测回落到 trident）',
    activity: '（未落到目标 Activity）',
    preconditions: ['需要聊天中的图片资源'],
    steps: ['尝试 deep link campusx://chat/media-preview → 前台仍是 TridentActivity'],
    states: { normal: 'not_reproducible', loading: 'not_reproducible', empty: 'not_reproducible', error: 'not_reproducible' },
    interactions: [],
    navigation: [],
    persistence: [],
    known_unknowns: ['预览页的缩放手势、页码指示、保存按钮位置均未观察'],
    blocked_reason: 'deep link 无法直达；真实入口是聊天消息里的图片，而本机无聊天数据',
  },
  {
    id: 'at-panel',
    title: '@面板',
    target: 'campusx://group/atPanel（实测回落到 trident）',
    activity: '（未落到目标 Activity）',
    preconditions: ['需要群聊会话与成员'],
    steps: ['尝试 deep link campusx://group/atPanel → 前台仍是 TridentActivity'],
    states: { normal: 'not_reproducible', loading: 'not_reproducible', empty: 'not_reproducible', error: 'not_reproducible' },
    interactions: [],
    navigation: [],
    persistence: [],
    known_unknowns: ['面板以抽屉还是弹层出现、成员列表排序、搜索框有无'],
    blocked_reason: 'deep link 无法直达；需要群聊上下文',
  },
]

const STATE_KEYS = ['loading', 'empty', 'normal', 'error']
const ALLOWED = new Set(['observed', 'not_applicable', 'not_reproducible', 'blocked', 'unknown'])

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

mkdirSync(SHOTS, { recursive: true })
const sumLines = []
const missing = []

for (const s of SCREENS) {
  const dir = path.join(SHOTS, s.id)
  mkdirSync(dir, { recursive: true })
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : []
  if (files.length === 0) missing.push(s.id)

  const states = {}
  for (const k of STATE_KEYS) {
    const status = s.states[k]
    if (!ALLOWED.has(status)) throw new Error(`${s.id}.${k}: 非法状态枚举 ${status}`)
    states[k] = {
      status,
      evidence: status === 'observed' && files.length ? ['normal.png'] : [],
    }
  }

  const doc = {
    screen_id: s.id,
    title: s.title,
    target_route: s.target,
    activity: s.activity,
    entry: { preconditions: s.preconditions, steps: s.steps },
    states,
    interactions: s.interactions,
    navigation: s.navigation,
    persistence: s.persistence,
    known_unknowns: s.known_unknowns,
    ...(s.evidence_note ? { evidence_note: s.evidence_note } : {}),
    ...(s.blocked_reason ? { blocked_reason: s.blocked_reason } : {}),
  }
  writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify(doc, null, 2) + '\n', 'utf8')

  for (const f of files.sort()) {
    const p = path.join(dir, f)
    sumLines.push(`${sha256(p)}  screens/${s.id}/${f}`)
  }
}

// manifest
const manifest = {
  gate_version: 1,
  expected_screen_count: SCREENS.length,
  screens: SCREENS.map((s) => ({
    id: s.id,
    title: s.title,
    target: s.target,
    has_evidence: existsSync(path.join(SHOTS, s.id, 'normal.png')),
    states: s.states,
  })),
}
writeFileSync(path.join(BASE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
writeFileSync(path.join(BASE, 'environment.json'), JSON.stringify(ENVIRONMENT, null, 2) + '\n', 'utf8')
writeFileSync(path.join(BASE, 'SHA256SUMS'), sumLines.join('\n') + '\n', 'utf8')

console.log(JSON.stringify({
  screens: SCREENS.length,
  withEvidence: manifest.screens.filter((s) => s.has_evidence).length,
  missingEvidence: missing,
  sumEntries: sumLines.length,
  base: BASE,
}, null, 2))
