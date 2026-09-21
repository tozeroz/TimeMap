/**
 * 全量 mock 数据 —— demo 唯一数据源。
 * 内容为真实感虚构：校园场景取北京交通大学（与原 app 截图一致），
 * 人名/文案为编造，避免使用任何真实个人信息。
 */

export interface User {
  id: string
  name: string
  avatar: string
  school?: string
  mbti?: string
  zodiac?: string
  college?: string
  major?: string
  grade?: string
}

export interface FeedPost {
  id: string
  author: User
  text: string
  images: string[]
  /** 配图宽高比（瀑布流错落感的来源；原版是不同尺寸的真实照片，这里按比例还原） */
  ratio?: string
  likes: number
  comments: number
  liked: boolean
  location?: string
  topic?: string
  createdAt: string
}

export interface Comment {
  id: string
  author: User
  text: string
  time: string
  likes: number
  replies?: Comment[]
}

export interface ChatThread {
  id: string
  peer: User
  lastMessage: string
  time: string
  unread: number
  messages: ChatMessage[]
}

export interface ChatMessage {
  id: string
  from: 'me' | 'peer'
  text: string
  time: string
}

export interface Poi {
  id: string
  name: string
  address: string
  distance: string
  category: string
  posts: number
}

export interface BoardNote {
  id: string
  author: User
  text: string
  time: string
  color: string
}

/** 头像：用本地生成的形象头像，不依赖网络（渐变底 + 高光，接近原版 3D 头像的质感） */
function avatar(seed: string, bg: string, fg = '#ffffff'): string {
  const light = bg
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">` +
    `<defs>` +
    `<radialGradient id="bg" cx="35%" cy="28%" r="78%">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>` +
    `<stop offset="45%" stop-color="${light}"/>` +
    `<stop offset="100%" stop-color="#000000" stop-opacity="0.18"/>` +
    `</radialGradient>` +
    `<linearGradient id="face" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>` +
    `<stop offset="100%" stop-color="#ffffff" stop-opacity="0.55"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="160" height="160" rx="80" fill="url(#bg)"/>` +
    `<circle cx="80" cy="62" r="34" fill="url(#face)"/>` +
    `<ellipse cx="80" cy="132" rx="52" ry="42" fill="url(#face)"/>` +
    `<text x="80" y="76" font-size="34" font-weight="700" font-family="PingFang SC,sans-serif" ` +
    `fill="${fg}" fill-opacity="0.92" text-anchor="middle">${seed}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * 帖子配图：本地生成的抽象渐变图，保证离线可用。
 * 注意不要在图上写字——实测视觉模型会把图上的文字误读成「分类标签」，
 * 而原版配图是真实照片，没有这类文字。
 */
function photo(seed: string, from: string, to: string): string {
  // 用 seed 派生几个色块/圆弧，做出「照片」的构图感，而不是纯色板
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

export const me: User = {
  id: 'u_me',
  name: '自定义名称6',
  avatar: avatar('我', '#6b7cff'),
  school: '北京交通大学',
  mbti: 'INFP',
  zodiac: '天秤座',
  college: '计算机与信息技术学院',
  major: '计算机科学与技术',
  grade: '本科三年级',
}

export const users: Record<string, User> = {
  u1: { id: 'u1', name: '蒸柿煮捞呆', avatar: avatar('柿', '#f2994a'), school: '北京交通大学' },
  u2: { id: 'u2', name: 'anmoss', avatar: avatar('a', '#2d9cdb'), school: '北京交通大学' },
  u3: { id: 'u3', name: '肆季', avatar: avatar('肆', '#bb6bd9'), school: '北京交通大学' },
  u4: { id: 'u4', name: 'Lemy', avatar: avatar('L', '#27ae60'), school: '北京交通大学' },
  u5: {
    id: 'u5',
    name: 'Azur冰弦',
    avatar: avatar('冰', '#56ccf2'),
    school: '北京交通大学',
    mbti: 'INFP',
    zodiac: '天秤座',
    college: '软件学院',
    major: '软件工程',
    grade: '硕士一年级',
  },
  u6: {
    id: 'u6',
    name: '又又',
    avatar: avatar('又', '#f2c94c'),
    school: '北京交通大学',
    college: '物理科学与工程学院',
    major: '物理学',
    grade: '本科一年级',
  },
  u7: {
    id: 'u7',
    name: '辣椒面',
    avatar: avatar('辣', '#eb5757'),
    school: '北京交通大学',
    college: '建筑与艺术学院',
    major: '数字媒体艺术',
    grade: '本科五年级',
  },
  u8: {
    id: 'u8',
    name: '苏苏',
    avatar: avatar('苏', '#9b51e0'),
    school: '北京交通大学',
    college: '语言与传播学院',
    major: '网络与新媒体',
    grade: '本科四年级',
  },
  u9: {
    id: 'u9',
    name: 'eveee',
    avatar: avatar('e', '#219653'),
    school: '北京交通大学',
    college: '经济管理学院',
    major: '企业管理',
    grade: '硕士三年级',
  },
  u10: {
    id: 'u10',
    name: '小支',
    avatar: avatar('支', '#f2994a'),
    school: '北京交通大学',
    college: '建筑与艺术学院',
    major: '设计学',
    grade: '硕士二年级',
  },
  u11: {
    id: 'u11',
    name: '禾桉涵',
    avatar: avatar('禾', '#6fcf97'),
    school: '北京交通大学',
    mbti: 'INTJ',
    zodiac: '摩羯座',
    college: '电子信息工程学院',
    major: '通信工程',
    grade: '本科二年级',
  },
  u12: {
    id: 'u12',
    name: '小熊汉堡',
    avatar: avatar('熊', '#c98b56'),
    school: '北京交通大学',
  },
}

export const posts: FeedPost[] = [
  {
    id: 'p1',
    author: users.u1,
    text: '草头娃娃，听说浇水能长草，让我来试试~',
    images: [photo('草头娃娃', '#a8e6a1', '#5fbf6a')],
    ratio: '3 / 5',
    likes: 128,
    comments: 24,
    liked: false,
    location: '北京交通大学·思源楼',
    createdAt: '3 分钟前',
  },
  {
    id: 'p2',
    author: users.u2,
    text: '而我不再觉得，孤独是一种遗憾。',
    images: [photo('傍晚', '#f6b26b', '#e06666')],
    ratio: '1 / 1',
    likes: 342,
    comments: 51,
    liked: true,
    createdAt: '20 分钟前',
  },
  {
    id: 'p3',
    author: users.u3,
    text: '韩国编剧朴海英：写台词的时候，我会先想这个人今天过得怎么样。',
    images: [photo('书摘', '#d9c7a8', '#a8906a')],
    ratio: '4 / 5',
    likes: 96,
    comments: 12,
    liked: false,
    topic: '#今日书摘',
    createdAt: '1 小时前',
  },
  {
    id: 'p4',
    author: users.u4,
    text: '在大理淘到了好多漂亮的小物品，已经迫不及待想布置宿舍了。',
    images: [photo('大理', '#89c4f4', '#4a90d9'), photo('小物', '#f7cac9', '#e79ba8')],
    ratio: '3 / 4',
    likes: 233,
    comments: 37,
    liked: false,
    location: '大理古城',
    createdAt: '2 小时前',
  },
  {
    id: 'p5',
    author: users.u12,
    text: '永恒八月，汪川。今天单曲循环了一整天。',
    images: [photo('耳机', '#b3c7e6', '#7d97bf')],
    ratio: '5 / 4',
    likes: 77,
    comments: 8,
    liked: false,
    createdAt: '4 小时前',
  },
  {
    id: 'p6',
    author: users.u7,
    text: '词/曲：垚依依 编曲：蛙池。坦白来说，坦白是ok的。',
    images: [photo('演出', '#b58fd9', '#6f4fa8')],
    ratio: '1 / 1',
    likes: 45,
    comments: 5,
    liked: false,
    topic: '#现场演出',
    createdAt: '6 小时前',
  },
  {
    id: 'p7',
    author: users.u11,
    text: '教超今晚十点半关门，别跑空了。',
    images: [photo('超市', '#a8c9a0', '#6f9c66')],
    ratio: '4 / 5',
    likes: 312,
    comments: 66,
    liked: true,
    location: '北京交通大学·教育超市',
    createdAt: '8 小时前',
  },
  {
    id: 'p8',
    author: users.u5,
    text: '图书馆四楼靠窗的位置下午三点后基本没光，适合睡觉不适合背书（亲测）。',
    images: [photo('图书馆', '#d5cfc4', '#a89f90')],
    ratio: '3 / 5',
    likes: 189,
    comments: 28,
    liked: false,
    location: '北京交通大学·图书馆',
    createdAt: '昨天',
  },
]

export const comments: Comment[] = [
  {
    id: 'c1',
    author: users.u6,
    text: '这个我也有！养了两周真的长出来了',
    time: '2 分钟前',
    likes: 12,
    replies: [
      { id: 'c1r1', author: users.u1, text: '真的假的，我要去浇水了', time: '1 分钟前', likes: 3 },
    ],
  },
  {
    id: 'c2',
    author: users.u8,
    text: '同款娃，不过我的已经被舍友养死了',
    time: '10 分钟前',
    likes: 28,
  },
  {
    id: 'c3',
    author: users.u9,
    text: '在哪里买的呀，求链接',
    time: '18 分钟前',
    likes: 6,
  },
  {
    id: 'c4',
    author: users.u10,
    text: '好可爱，草长出来记得更新',
    time: '25 分钟前',
    likes: 4,
  },
]

export const threads: ChatThread[] = [
  {
    id: 't1',
    peer: users.u5,
    lastMessage: '明天下午一起去图书馆吗？',
    time: '12:31',
    unread: 2,
    messages: [
      { id: 'm1', from: 'peer', text: '在吗～', time: '12:28' },
      { id: 'm2', from: 'me', text: '在的，怎么了', time: '12:29' },
      { id: 'm3', from: 'peer', text: '明天下午一起去图书馆吗？', time: '12:31' },
    ],
  },
  {
    id: 't2',
    peer: users.u6,
    lastMessage: '收到，谢谢！',
    time: '昨天',
    unread: 0,
    messages: [
      { id: 'm4', from: 'me', text: '笔记发你了，第 3 章是我整理的', time: '昨天 20:10' },
      { id: 'm5', from: 'peer', text: '收到，谢谢！', time: '昨天 20:12' },
    ],
  },
  {
    id: 't3',
    peer: users.u9,
    lastMessage: '那家店周末人多，我们早点去',
    time: '周二',
    unread: 0,
    messages: [
      { id: 'm6', from: 'peer', text: '那家店周末人多，我们早点去', time: '周二 18:40' },
    ],
  },
  {
    id: 't4',
    peer: users.u11,
    lastMessage: '好，就这么定了',
    time: '周一',
    unread: 0,
    messages: [{ id: 'm7', from: 'me', text: '好，就这么定了', time: '周一 09:15' }],
  },
]

export const pois: Poi[] = [
  {
    id: 'poi1',
    name: '北京交通大学',
    address: '北京市海淀区西直门外上园村3号',
    distance: '0m',
    category: '学校',
    posts: 1284,
  },
  {
    id: 'poi2',
    name: '北京交通大学教学楼8号楼',
    address: '北京市海淀区西直门外上园村3号',
    distance: '160m',
    category: '教学楼',
    posts: 207,
  },
  {
    id: 'poi3',
    name: '北京交通大学交通运输学院',
    address: '北京市海淀区西直门外上园村3号',
    distance: '320m',
    category: '院系',
    posts: 96,
  },
  {
    id: 'poi4',
    name: '思源楼',
    address: '北京交通大学校内',
    distance: '410m',
    category: '教学楼',
    posts: 143,
  },
  {
    id: 'poi5',
    name: '教育超市',
    address: '北京交通大学校内',
    distance: '520m',
    category: '超市',
    posts: 88,
  },
]

export const boardNotes: BoardNote[] = [
  {
    id: 'b1',
    author: users.u5,
    text: '有没有人周末一起去看展？',
    time: '10 分钟前',
    color: '#ffd9e8',
  },
  {
    id: 'b2',
    author: users.u8,
    text: '求一份高数期中真题，谢谢好心人 🙏',
    time: '1 小时前',
    color: '#d9e8ff',
  },
  {
    id: 'b3',
    author: users.u10,
    text: '今天在二食堂捡到一张校园卡，交到失物招领处了。',
    time: '3 小时前',
    color: '#e6f7d9',
  },
  {
    id: 'b4',
    author: users.u11,
    text: '图书馆四楼今天空调有点冷，记得带外套。',
    time: '5 小时前',
    color: '#fff3c4',
  },
]

/*
  留言板表情行。
  **数量必须与只读证据一致**：supplements/message-board.json 的 strength=strong 条目记载
    "id/rvEmojiList 下 id/fl_emoji_root 出现 7 次（间距 112px）"，fact 为"表情行恰好 7 个表情"。
  此前这里只有 6 个 —— 是一处**真实的一致性缺口**，本轮已补齐为 7 个。

  ⚠ **但不声称具体是哪 7 个**：baseline.json 把"表情行的完整表情集合"列为**待补项**，
    也就是说**只有数量与间距有证据，具体字符没有采集**。
    因此前 6 个沿用既有值（它们来自更早的观察），第 7 个用 '🎉' 仅是占位，
    **不是证据支持的结论**；要声称字符一致，必须先做一次只读观察把 7 个字符都 dump 下来。
*/
export const boardEmojis = ['😂', '👑', '❤️', '👀', '😱', '+1', '🎉']

export const dailyFeed = [
  { id: 'd1', title: '今天最想说的一句话', desc: '一句话记录今天', color: '#ffd9e8' },
  { id: 'd2', title: '今天拍到的一张照片', desc: '随手拍也可以', color: '#d9e8ff' },
  { id: 'd3', title: '今天吃到的好吃的', desc: '食堂也算', color: '#e6f7d9' },
  { id: 'd4', title: '今天的心情', desc: '给自己打个分', color: '#fff3c4' },
]

export const campusInfo = {
  name: '北京交通大学',
  region: '北京市·海淀区',
  members: '12,486',
  posts: '38,920',
}

/* ============ 以下为补充页面所需数据 ============ */

export interface GroupChat {
  id: string
  name: string
  memberCount: number
  notice: string
  members: User[]
  messages: ChatMessage[]
}

export const groups: GroupChat[] = [
  {
    id: 'g1',
    name: '计算机学院 2023 级',
    memberCount: 128,
    notice: '期末周自习安排已更新，图书馆四楼开放到 22:30。',
    members: [users.u5, users.u6, users.u7, users.u8, users.u9, users.u10, users.u11],
    messages: [
      { id: 'g1m1', from: 'peer', text: '有人明天去图书馆吗？', time: '09:12' },
      { id: 'g1m2', from: 'me', text: '我去，四楼靠窗', time: '09:14' },
      { id: 'g1m3', from: 'peer', text: '@自定义名称6 帮我占个位子可以吗', time: '09:15' },
      { id: 'g1m4', from: 'peer', text: '群公告更新了，大家看一下', time: '10:02' },
    ],
  },
]

/** 地点详情：某个 POI 下的动态聚合 */
export const poiDetail = {
  id: 'poi1',
  name: '北京交通大学',
  address: '北京市海淀区西直门外上园村3号',
  category: '学校',
  posts: 1284,
  visitors: 3562,
  related: ['poi2', 'poi3', 'poi4'],
}

/** 升级弹窗文案（原版 campusx://upgradeAlert） */
export const upgradeInfo = {
  version: '2.11.0',
  size: '48.6 MB',
  highlights: [
    '校园广场支持按标签筛选',
    '群聊新增 @ 面板与消息引用',
    '修复地图定位偶发偏移',
  ],
}

/** 扫码页的提示文案 */
export const scannerHints = ['扫描校园卡二维码', '扫描群邀请二维码', '扫描活动签到码']

/**
 * 地图上的动态标记。
 * 原版实测样式：一张图片卡片 + 彩色图钉 + 地点名，点击进入该条动态。
 * x/y 是地图世界坐标（与 MapScreen 里 SVG 的 viewBox 同一坐标系）。
 */
export interface MapMarker {
  id: string
  place: string
  color: string
  userId: string
  postId: string
  x: number
  y: number
  /** 真实经纬度（接入在线地图后用） */
  lat: number
  lng: number
}

export const mapMarkers: MapMarker[] = [
  { id: 'm1', place: '阳光操场', color: '#f5453b', userId: 'u1', postId: 'p1', x: 430, y: 1030, lat: 39.9512, lng: 116.3381 },
  { id: 'm2', place: '教育超市', color: '#f2b800', userId: 'u11', postId: 'p7', x: 560, y: 1660, lat: 39.9495, lng: 116.3372 },
  { id: 'm3', place: '图书馆', color: '#f5453b', userId: 'u5', postId: 'p8', x: 980, y: 640, lat: 39.9521, lng: 116.3412 },
  { id: 'm4', place: '逸夫教学楼', color: '#2f9e44', userId: 'u2', postId: 'p2', x: 900, y: 1020, lat: 39.9502, lng: 116.3428 },
  { id: 'm5', place: '思源楼', color: '#f2b800', userId: 'u4', postId: 'p4', x: 1180, y: 1120, lat: 39.9491, lng: 116.3439 },
  { id: 'm6', place: '学苑公寓', color: '#2f9e44', userId: 'u7', postId: 'p6', x: 340, y: 1220, lat: 39.9487, lng: 116.3362 },
]

/** 可切换的学校（对应原版点「校园广场 ▼」后的「搜索其他学校」） */
export const schools = [
  { id: 's1', name: '北京交通大学', region: '北京市·海淀区', members: '12,486' },
  { id: 's2', name: '清华大学', region: '北京市·海淀区', members: '38,021' },
  { id: 's3', name: '北京大学', region: '北京市·海淀区', members: '42,138' },
  { id: 's4', name: '中国人民大学', region: '北京市·海淀区', members: '28,905' },
  { id: 's5', name: '北京航空航天大学', region: '北京市·海淀区', members: '31,672' },
  { id: 's6', name: '北京师范大学', region: '北京市·海淀区', members: '26,410' },
  { id: 's7', name: '复旦大学', region: '上海市·杨浦区', members: '33,204' },
  { id: 's8', name: '上海交通大学', region: '上海市·闵行区', members: '40,558' },
]

/** 按用户取动态（他人主页用） */
export function postsByUser(userId: string): FeedPost[] {
  return posts.filter((p) => p.author.id === userId)
}

