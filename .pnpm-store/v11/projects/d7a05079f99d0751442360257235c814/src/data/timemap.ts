/**
 * BJTU TimeMap 数据模型与种子数据。
 *
 * 依据《BJTU TimeMap需求分析与产品设计文档》与《北交大校园记忆地图项目需求分析初稿》：
 * - 以「地点」为内容组织单位：所有帖子必须关联管理员启用的预设地点（US-02）；
 * - 首批 8—12 个代表地点，其中含 1—2 个食堂；食堂按普通地点处理，不做菜品库；
 * - 首版帖子和评论直接发布，采用举报与事后下架机制（无待审核状态，US-02/US-08）；
 * - 老照片必须带「年代 + 来源」，年代不明时如实标注（US-01）；
 * - 活动由管理员录入，标注主办方、来源与更新时间；首版无报名/支付/学生投稿（US-04）；
 * - 所有素材为本地生成的示意内容（合规：不搬运第三方数据）。
 */

/* ============================== 基础类型 ============================== */

export type PlaceCategory = '地标' | '食堂' | '教学楼' | '图书馆' | '体育场馆'

export interface OldPhoto {
  id: string
  /** 拍摄年代；未知必须如实写「年代不详」（US-01） */
  era: string
  /** 素材来源说明（US-01/合规：可追溯） */
  source: string
  /** 本地生成示意图（dataURL SVG） */
  image: string
  caption: string
}

export interface CampusPlace {
  id: string
  name: string
  category: PlaceCategory
  /** 离线自绘底图坐标（viewBox 1400x2000） */
  x: number
  y: number
  /** 真实经纬度（在线底图用；演示数据） */
  lat: number
  lng: number
  /** 地点简介 */
  intro: string
  /** 校史与校园背景 */
  history: string
  /** 老照片（至少一组，用于照片对比素材的来源之一；对比功能本身属 P1） */
  photos: OldPhoto[]
  /** 管理员可停用；停用后不能再关联新帖子（US-01） */
  enabled: boolean
}

export interface TmComment {
  id: string
  postId: string
  authorId: string
  text: string
  createdAt: number
  /** 已删除的评论不计入有效评论量（US-03） */
  deleted?: boolean
}

export interface TmPost {
  id: string
  authorId: string
  /** 必填：预设地点（US-02） */
  placeId: string
  text: string
  /** 0—3 张（US-02：1至3张图片；纯文字允许 0 张） */
  images: string[]
  /** 情绪/主题标签；食堂帖使用食堂标签集 */
  tags: string[]
  createdAt: number
  /** 预置点赞基数（不含当前用户；当前用户状态由 likedByMe 表达，保证重复请求不重复计数） */
  baseLikes: number
  likedByMe: boolean
  baseFavorites: number
  favoritedByMe: boolean
  /** published 正常；removed 被管理员下架（退出地图/列表/详情正文） */
  status: 'published' | 'removed'
}

export type ActivityStatus = 'upcoming' | 'ongoing' | 'ended' | 'cancelled'

export interface TmActivity {
  id: string
  title: string
  description: string
  placeId: string
  startAt: number
  endAt: number
  organizer: string
  /** 信息来源（US-04：必须标注来源与更新时间） */
  source: string
  sourceUpdatedAt: number
  /** 非法数据不能成为正式活动（US-04：缺时间/地点不能发布） */
  cancelled?: boolean
}

export type ReportTargetType = 'post' | 'comment'
export type ReportStatus = 'pending' | 'noaction' | 'removed'

export interface TmReport {
  id: string
  targetType: ReportTargetType
  targetId: string
  /** 举报分类 */
  category: string
  detail?: string
  reporterId: string
  createdAt: number
  status: ReportStatus
  handledBy?: string
  handledAt?: number
  /** 不处理或下架必须记录原因（US-08） */
  handleReason?: string
}

export interface AdminOp {
  id: string
  adminName: string
  targetType: string
  /** 对象的可读标识（帖子摘要/地点名/活动名） */
  targetLabel: string
  action: string
  reason?: string
  at: number
}

/* ============================== 工具 ============================== */

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 种子数据的时间基准：模块加载时刻，保证「3 分钟前」永远新鲜 */
export const NOW = Date.now()

/** 本地生成示意配图（渐变 + 构图色块，离线可用，不含文字避免误读） */
function seedPhoto(seed: string, from: string, to: string): string {
  const h = [...seed].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 997, 7)
  const cx = 120 + (h % 360)
  const cy = 180 + ((h * 7) % 400)
  const r = 160 + ((h * 13) % 220)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">` +
    `<defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient>` +
    `<radialGradient id="s" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="600" height="800" fill="url(#g)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#s)"/>` +
    `<rect x="0" y="520" width="600" height="280" fill="#000000" fill-opacity="0.12"/>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** 用户头像（本地生成，不使用真实人物） */
function seedAvatar(seed: string, bg: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">` +
    `<defs><radialGradient id="bg" cx="35%" cy="28%" r="78%">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>` +
    `<stop offset="45%" stop-color="${bg}"/>` +
    `<stop offset="100%" stop-color="#000000" stop-opacity="0.18"/>` +
    `</radialGradient></defs>` +
    `<rect width="160" height="160" rx="80" fill="url(#bg)"/>` +
    `<circle cx="80" cy="62" r="34" fill="#ffffff" fill-opacity="0.85"/>` +
    `<ellipse cx="80" cy="132" rx="52" ry="42" fill="#ffffff" fill-opacity="0.7"/>` +
    `<text x="80" y="76" font-size="34" font-weight="700" font-family="PingFang SC,sans-serif" ` +
    `fill="#ffffff" fill-opacity="0.92" text-anchor="middle">${seed}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < MIN) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 2 * DAY) return '昨天'
  const d = new Date(ts)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function formatRange(startAt: number, endAt: number): string {
  const f = (t: number) => {
    const d = new Date(t)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${f(startAt)} — ${f(endAt)}`
}

/** 活动状态推导（按时间与取消标记） */
export function activityStatus(a: TmActivity, now = Date.now()): ActivityStatus {
  if (a.cancelled) return 'cancelled'
  if (now < a.startAt) return 'upcoming'
  if (now <= a.endAt) return 'ongoing'
  return 'ended'
}

export const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  upcoming: '即将开始',
  ongoing: '进行中',
  ended: '已结束',
  cancelled: '已取消',
}

/* ============================== 用户 ============================== */

export interface TmUser {
  id: string
  name: string
  avatar: string
  college?: string
  grade?: string
  bio?: string
}

export const seedUsers: Record<string, TmUser> = {
  u1: { id: 'u1', name: '红果园常驻', avatar: seedAvatar('红', '#f2994a'), college: '计算机与信息技术学院', grade: '本科三年级' },
  u2: { id: 'u2', name: '明湖晚风', avatar: seedAvatar('明', '#2d9cdb'), college: '交通运输学院', grade: '硕士二年级' },
  u3: { id: 'u3', name: '思源石上', avatar: seedAvatar('思', '#bb6bd9'), college: '经济管理学院', grade: '本科二年级' },
  u4: { id: 'u4', name: '图 Opt', avatar: seedAvatar('图', '#27ae60'), college: '电子信息工程学院', grade: '博士一年级' },
  u5: { id: 'u5', name: '差分小李', avatar: seedAvatar('李', '#56ccf2'), college: '自动化与智能学院', grade: '本科四年级' },
  u6: { id: 'u6', name: '藕汤不喝', avatar: seedAvatar('藕', '#f2c94c'), college: '建筑与艺术学院', grade: '本科一年级' },
}

/** 当前登录用户的默认资料（登录后可编辑，持久化在会话里） */
export const defaultMe: TmUser = {
  id: 'me',
  name: '交大同学',
  avatar: seedAvatar('交', '#6b7cff'),
  college: '计算机与信息技术学院',
  grade: '本科三年级',
  bio: '',
}

/* ============================== 地点（首批 10 个） ============================== */

export const seedPlaces: CampusPlace[] = [
  {
    id: 'pl_gate',
    name: '南门',
    category: '地标',
    x: 700,
    y: 1720,
    lat: 39.9479,
    lng: 116.3368,
    intro: '北京交通大学正门，新生报到、毕业合影的默认背景板。',
    history:
      '南门面朝西直门外大街方向，是大部分同学与访客进入校园的第一站。每逢开学季与毕业季，门前广场都会搭起迎新与合影的拱门。',
    photos: [
      { id: 'ph_gate1', era: '2000年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('南门-旧', '#b7c9d3', '#7f9aab'), caption: '翻修前的南门与门前林荫道' },
      { id: 'ph_gate2', era: '年代不详', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('南门-泛黄', '#d8cdb4', '#a89a7c'), caption: '据校友提供的旧影，具体年代待考' },
    ],
    enabled: true,
  },
  {
    id: 'pl_siyuanbei',
    name: '思源碑',
    category: '地标',
    x: 700,
    y: 1480,
    lat: 39.9492,
    lng: 116.3365,
    intro: '「饮水思源」碑，校园中轴上的精神坐标。',
    history:
      '思源碑取「饮水思源」之意，提醒交大学子不忘来路。碑前空间开阔，是社团合影、校庆宣誓与日常打卡的高频地点。',
    photos: [
      { id: 'ph_syb1', era: '1990年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('思源碑-旧', '#c9b8a3', '#94826a'), caption: '碑体早年样貌，四周尚为绿地' },
    ],
    enabled: true,
  },
  {
    id: 'pl_minghu',
    name: '明湖',
    category: '地标',
    x: 430,
    y: 1330,
    lat: 39.9502,
    lng: 116.334,
    intro: '校园西部的湖景地标，绕湖一圈是经典遛弯路线。',
    history:
      '明湖一带旧为洼地，后疏浚成湖并沿湖布置步道与座椅。夏天有荷花与晚霞，冬天结冰后是天然的「湖面摄影棚」。',
    photos: [
      { id: 'ph_mh1', era: '1980年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('明湖-旧', '#9ec7d8', '#5d92a8'), caption: '疏浚后的明湖与东岸凉亭' },
      { id: 'ph_mh2', era: '2010年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('明湖-新', '#8fd0c8', '#4a9a90'), caption: '步道整修后的明湖南岸' },
    ],
    enabled: true,
  },
  {
    id: 'pl_lib',
    name: '图书馆',
    category: '图书馆',
    x: 980,
    y: 640,
    lat: 39.9523,
    lng: 116.3395,
    intro: '期末周最难抢座位的地方，也是全校最安静的自习据点。',
    history:
      '图书馆几经扩建，从单一的借阅楼成长为集阅览、研讨间、特藏展陈于一体的学习综合体；四楼靠窗的座位常年一位难求。',
    photos: [
      { id: 'ph_lib1', era: '1990年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('图书馆-旧', '#cfc6b8', '#9a8f7c'), caption: '扩建前的图书馆正立面' },
    ],
    enabled: true,
  },
  {
    id: 'pl_syl',
    name: '思源楼',
    category: '教学楼',
    x: 1150,
    y: 1100,
    lat: 39.9494,
    lng: 116.3413,
    intro: '主要教学楼之一，早八人的必争之地。',
    history:
      '思源楼得名与思源碑一脉相承，是本科生公共课与部分院系专业课的主要上课地点，楼内阶梯教室在考试周常被征用作考场。',
    photos: [
      { id: 'ph_syl1', era: '2000年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('思源楼-旧', '#c8cdd6', '#8d94a3'), caption: '外立面整修前的思源楼' },
    ],
    enabled: true,
  },
  {
    id: 'pl_yifu',
    name: '逸夫教学楼',
    category: '教学楼',
    x: 900,
    y: 1000,
    lat: 39.951,
    lng: 116.3403,
    intro: '以邵逸夫先生捐资冠名的教学楼，走廊尽头能看到明湖方向。',
    history:
      '逸夫教学楼是全国众多「逸夫楼」中的一座，落成后缓解了扩招带来的教室紧张，晚上常有社团借用教室开展活动。',
    photos: [
      { id: 'ph_yf1', era: '年代不详', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('逸夫-旧', '#d6cfc2', '#a39a86'), caption: '落成初期的逸夫教学楼（年代待考）' },
    ],
    enabled: true,
  },
  {
    id: 'pl_tianyou',
    name: '天佑会堂',
    category: '地标',
    x: 860,
    y: 800,
    lat: 39.9518,
    lng: 116.3381,
    intro: '以詹天佑先生之名命名的会堂，晚会与报告厅担当。',
    history:
      '天佑会堂纪念中国铁路工程先驱、我校校友詹天佑。开学典礼、校庆晚会与高水平讲座都在这里举行。',
    photos: [
      { id: 'ph_ty1', era: '1990年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('天佑-旧', '#c4b6c9', '#8a7a92'), caption: '会堂落成初期外观' },
    ],
    enabled: true,
  },
  {
    id: 'pl_xyc',
    name: '学苑餐厅',
    category: '食堂',
    x: 340,
    y: 1200,
    lat: 39.9486,
    lng: 116.3352,
    intro: '学苑公寓旁的食堂，晚餐时段排队从 11 号窗口排到门口。',
    history:
      '学苑餐厅随学苑公寓区建成，服务于西区住宿学生。楼层经过改造后增加了风味档口，麻辣香锅与石锅拌饭是长青款。',
    photos: [
      { id: 'ph_xyc1', era: '2000年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('学苑餐厅-旧', '#d9c9a8', '#a68f63'), caption: '改造前的一层大灶窗口' },
    ],
    enabled: true,
  },
  {
    id: 'pl_c2',
    name: '二食堂',
    category: '食堂',
    x: 520,
    y: 1560,
    lat: 39.9483,
    lng: 116.3377,
    intro: '离南门和教学楼都近，下课冲刺第一站。',
    history:
      '二食堂以出餐快著称，一楼主打基础套餐，二楼风味档口轮流更换。期中期末的深夜档是学生们的共同记忆。',
    photos: [
      { id: 'ph_c21', era: '年代不详', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('二食堂-旧', '#d8bfa0', '#a3805f'), caption: '早年二食堂门口（年代待考）' },
    ],
    enabled: true,
  },
  {
    id: 'pl_field',
    name: '主操场',
    category: '体育场馆',
    x: 430,
    y: 1010,
    lat: 39.9505,
    lng: 116.3428,
    intro: '标准田径场，晨跑、体育课与运动会的共同主场。',
    history:
      '主操场历经煤渣跑道到塑胶跑道的改造，看台在近年翻新。每年春季运动会与晚间荧光夜跑都在这里进行。',
    photos: [
      { id: 'pl_f1', era: '2000年代', source: '演示数据 · 本地生成示意图（来源待补录）', image: seedPhoto('操场-旧', '#b8c9a8', '#7d9663'), caption: '煤渣跑道时期的主操场' },
    ],
    enabled: true,
  },
]

/** 地点类别 → 标记配色（与原 app 图钉语言一致） */
export const CATEGORY_COLOR: Record<PlaceCategory, string> = {
  地标: '#f5453b',
  食堂: '#f2b800',
  教学楼: '#2f9e44',
  图书馆: '#3b6ef5',
  体育场馆: '#9b51e0',
}

/* ============================== 标签 ============================== */

/** 食堂帖标签集（初稿 5.2：推荐/避雷/新品/性价比/排队/随便聊聊） */
export const CANTEEN_TAGS = ['推荐', '避雷', '新品', '性价比', '排队', '随便聊聊']
/** 通用情绪标签（初稿 MVP：情绪标签） */
export const EMOTION_TAGS = ['怀旧', '自豪', '治愈', '打卡', '吐槽', '期待']

/* ============================== 帖子（种子） ============================== */

export const seedPosts: TmPost[] = [
  {
    id: 'tp1',
    authorId: 'u1',
    placeId: 'pl_lib',
    text: '期末周的图书馆：早上七点半门口已经排起小队，四楼靠窗全线沦陷。建议改约思源楼三楼，意外地空。',
    images: [seedPhoto('图书馆自习', '#d5cfc4', '#a89f90')],
    tags: ['打卡'],
    createdAt: NOW - 42 * MIN,
    baseLikes: 128,
    likedByMe: false,
    baseFavorites: 18,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp2',
    authorId: 'u2',
    placeId: 'pl_minghu',
    text: '傍晚的明湖，晚霞把湖面染成了橘色。绕湖三圈，烦恼清零。',
    images: [seedPhoto('明湖晚霞', '#f6b26b', '#e06666'), seedPhoto('明湖步道', '#f7c59f', '#d98e73')],
    tags: ['治愈'],
    createdAt: NOW - 3 * HOUR,
    baseLikes: 342,
    likedByMe: false,
    baseFavorites: 41,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp3',
    authorId: 'u3',
    placeId: 'pl_siyuanbei',
    text: '路过思源碑想起来，入学教育就是在碑前宣誓的。四年了，饮水思源这四个字越来越有分量。',
    images: [],
    tags: ['怀旧'],
    createdAt: NOW - 5 * HOUR,
    baseLikes: 96,
    likedByMe: false,
    baseFavorites: 12,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp4',
    authorId: 'u5',
    placeId: 'pl_xyc',
    text: '学苑餐厅新出的石锅拌饭，锅巴很脆，12 块性价比可以。就是 11 点半之后队伍夸张，建议错峰。',
    images: [seedPhoto('石锅拌饭', '#e8b04b', '#c97b2d')],
    tags: ['推荐', '排队'],
    createdAt: NOW - 90 * MIN,
    baseLikes: 233,
    likedByMe: false,
    baseFavorites: 35,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp5',
    authorId: 'u6',
    placeId: 'pl_c2',
    text: '二食堂二楼麻辣香锅今天换了大厨，辣度终于像样了！一楼套餐还是老样子，稳。',
    images: [seedPhoto('麻辣香锅', '#e07b54', '#b84a2e')],
    tags: ['推荐', '新品'],
    createdAt: NOW - 8 * HOUR,
    baseLikes: 189,
    likedByMe: false,
    baseFavorites: 22,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp6',
    authorId: 'u4',
    placeId: 'pl_syl',
    text: '思源楼 307 的投影仪修好了，下午的课终于不用看「雪花屏」了。',
    images: [],
    tags: ['吐槽'],
    createdAt: NOW - 26 * HOUR,
    baseLikes: 77,
    likedByMe: false,
    baseFavorites: 4,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp7',
    authorId: 'u2',
    placeId: 'pl_gate',
    text: '毕业前把南门的日出补上了。四年前来报到那天也是在这个门口，爸妈帮我扛着行李。',
    images: [seedPhoto('南门日出', '#f2c94c', '#e28f4b'), seedPhoto('南门拱门', '#c9d8f2', '#7f9cc9')],
    tags: ['怀旧', '自豪'],
    createdAt: NOW - 2 * DAY,
    baseLikes: 421,
    likedByMe: false,
    baseFavorites: 63,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp8',
    authorId: 'u1',
    placeId: 'pl_tianyou',
    text: '天佑会堂的音响翻新了？今晚社团晚会的人声清楚了一大截，坐最后一排也不闷。',
    images: [seedPhoto('天佑会堂内', '#b58fd9', '#6f4fa8')],
    tags: ['打卡'],
    createdAt: NOW - 30 * HOUR,
    baseLikes: 88,
    likedByMe: false,
    baseFavorites: 9,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp9',
    authorId: 'u6',
    placeId: 'pl_field',
    text: '晚上八点的主操场：三拨夜跑、两节课的足球队、还有荧光板的排练。氛围感拉满。',
    images: [seedPhoto('夜跑', '#89c4f4', '#4a90d9'), seedPhoto('看台', '#9fb8d9', '#5f7ca8'), seedPhoto('跑道', '#a8d9c4', '#5f9c86')],
    tags: ['打卡'],
    createdAt: NOW - 50 * HOUR,
    baseLikes: 156,
    likedByMe: false,
    baseFavorites: 17,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp10',
    authorId: 'u5',
    placeId: 'pl_yifu',
    text: '逸夫教学楼走廊尽头的窗户是拍明湖方向的隐藏机位，夕阳时候去，出片。',
    images: [seedPhoto('走廊机位', '#d9c7a8', '#a8906a')],
    tags: ['打卡'],
    createdAt: NOW - 3 * DAY,
    baseLikes: 205,
    likedByMe: false,
    baseFavorites: 44,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp11',
    authorId: 'u3',
    placeId: 'pl_lib',
    text: '图书馆新到的校史特藏展柜，有老照片和早年学生证样式，路过值得停三分钟。',
    images: [seedPhoto('校史展柜', '#c9b8a3', '#94826a')],
    tags: ['怀旧'],
    createdAt: NOW - 4 * DAY,
    baseLikes: 132,
    likedByMe: false,
    baseFavorites: 28,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp12',
    authorId: 'u4',
    placeId: 'pl_c2',
    text: '避雷：二食堂一楼左二窗口的套餐今天严重翻车，米饭夹生。希望只是意外。',
    images: [],
    tags: ['避雷'],
    createdAt: NOW - 20 * HOUR,
    baseLikes: 64,
    likedByMe: false,
    baseFavorites: 6,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp13',
    authorId: 'u6',
    placeId: 'pl_minghu',
    text: '考试周解压指南：买杯热饮坐明湖长椅看十分钟水面，比刷手机管用。',
    images: [],
    tags: ['治愈'],
    createdAt: NOW - 6 * DAY,
    baseLikes: 98,
    likedByMe: false,
    baseFavorites: 21,
    favoritedByMe: false,
    status: 'published',
  },
  {
    id: 'tp14',
    authorId: 'u1',
    placeId: 'pl_syl',
    text: '在思源楼考完大学里最后一门期末。交卷铃响的那一刻，走廊里所有人都在笑。',
    images: [seedPhoto('考场走廊', '#c8cdd6', '#8d94a3')],
    tags: ['期待'],
    createdAt: NOW - 10 * MIN,
    baseLikes: 12,
    likedByMe: false,
    baseFavorites: 2,
    favoritedByMe: false,
    status: 'published',
  },
]

/* ============================== 评论（种子） ============================== */

function cm(id: string, postId: string, authorId: string, text: string, agoMs: number): TmComment {
  return { id, postId, authorId, text, createdAt: NOW - agoMs }
}

export const seedComments: TmComment[] = [
  cm('tc1', 'tp1', 'u3', '思源楼三楼 +1，插座还多', 30 * MIN),
  cm('tc2', 'tp1', 'u5', '七点半就排队？卷不动了', 22 * MIN),
  cm('tc3', 'tp1', 'u6', '四楼靠窗是信仰，我认了', 12 * MIN),
  cm('tc4', 'tp2', 'u1', '这个角度是南岸吧，改天蹲一个', 2 * HOUR),
  cm('tc5', 'tp2', 'u4', '拍出了明湖的精髓', 100 * MIN),
  cm('tc6', 'tp4', 'u2', '12 块这个料可以了', 80 * MIN),
  cm('tc7', 'tp4', 'u6', '排队 20 分钟换锅巴脆，值', 60 * MIN),
  cm('tc8', 'tp5', 'u1', '大厨别走 🙏', 6 * HOUR),
  cm('tc9', 'tp5', 'u3', '辣度终于正常了 +1', 5 * HOUR),
  cm('tc10', 'tp7', 'u5', '看哭了，今年我也这个门口毕业', 1 * DAY),
  cm('tc11', 'tp7', 'u3', '日出那张绝了', 1 * DAY + 2 * HOUR),
  cm('tc12', 'tp9', 'u4', '足球那拨是我们院的，欢迎加入', 40 * HOUR),
  cm('tc13', 'tp10', 'u2', '机位收藏了', 2 * DAY),
  cm('tc14', 'tp11', 'u6', '展柜在进门左手边，别错过', 3 * DAY),
  cm('tc15', 'tp12', 'u1', '我今天也吃到了，同翻车', 15 * HOUR),
]

/* ============================== 活动（种子，管理员录入） ============================== */

export const seedActivities: TmActivity[] = [
  {
    id: 'ta1',
    title: '「影像中的交大」老照片征集宣讲',
    description:
      '面向全校征集校园老照片与新照片，介绍投稿规范、授权要求与展示方式。欢迎对校史和摄影感兴趣的同学参加。',
    placeId: 'pl_tianyou',
    startAt: NOW + 2 * DAY,
    endAt: NOW + 2 * DAY + 90 * MIN,
    organizer: '校学生会',
    source: '校学生会公众号',
    sourceUpdatedAt: NOW - 1 * DAY,
  },
  {
    id: 'ta2',
    title: '130 周年校庆志愿者培训',
    description:
      '校庆志愿者第一次集中培训：流程讲解、点位分配与问答。请已报名的志愿者携带学生证提前 15 分钟入场。',
    placeId: 'pl_syl',
    startAt: NOW + 5 * DAY,
    endAt: NOW + 5 * DAY + 2 * HOUR,
    organizer: '校团委',
    source: '校园信息网通知',
    sourceUpdatedAt: NOW - 3 * DAY,
  },
  {
    id: 'ta3',
    title: '校园定向越野 · 打卡十个地标',
    description:
      '从主操场出发，按线索打卡南门、思源碑、明湖等地标，完赛可领取纪念徽章。现场签到，无报名门槛。',
    placeId: 'pl_field',
    startAt: NOW - 1 * HOUR,
    endAt: NOW + 3 * HOUR,
    organizer: '定向越野协会',
    source: '社团联合会公告',
    sourceUpdatedAt: NOW - 2 * DAY,
  },
  {
    id: 'ta4',
    title: '图书馆校史特藏导览',
    description:
      '图书馆特藏部老师带队讲解校史文献与老照片展柜，名额有限，当日现场取号。',
    placeId: 'pl_lib',
    startAt: NOW + 7 * DAY,
    endAt: NOW + 7 * DAY + 60 * MIN,
    organizer: '图书馆',
    source: '图书馆主页通知',
    sourceUpdatedAt: NOW - 12 * HOUR,
  },
  {
    id: 'ta5',
    title: '食堂菜品意见交流日',
    description: '饮食服务中心在学苑餐厅一层设意见台，收集同学对菜品与出餐速度的建议。',
    placeId: 'pl_xyc',
    startAt: NOW - 1 * DAY,
    endAt: NOW - 1 * DAY + 3 * HOUR,
    organizer: '饮食服务中心',
    source: '后勤处通知',
    sourceUpdatedAt: NOW - 4 * DAY,
  },
  {
    id: 'ta6',
    title: '草坪音乐节（因天气取消）',
    description: '原定在主操场举行的社团草坪音乐节，因连续降雨场地不满足安全要求，已取消，择期再办。',
    placeId: 'pl_field',
    startAt: NOW + 9 * DAY,
    endAt: NOW + 9 * DAY + 4 * HOUR,
    organizer: '社团联合会',
    source: '社团联合会公告',
    sourceUpdatedAt: NOW - 6 * HOUR,
    cancelled: true,
  },
]

/* ============================== 举报分类 ============================== */

export const REPORT_CATEGORIES = ['违规信息', '侵权', '不实信息', '隐私泄露', '垃圾广告', '其他']

/* ============================== 地图标记（派生） ============================== */

/** 地点聚合标记（初稿 5.1 全景规则：地点名称 + 帖子数，不铺开单帖） */
export interface PlaceMapMarker {
  id: string
  place: string
  category: PlaceCategory
  color: string
  x: number
  y: number
  lat: number
  lng: number
  count: number
  cover?: string
}
