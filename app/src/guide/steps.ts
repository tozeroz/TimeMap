/**
 * 首次注册用户引导 · 六步内容配置（集中在这里，改文案只动这个文件）。
 *
 * 来源：`docs/public/product/首次注册用户引导流程.md` 第 3 节「六步流程」。
 * 每一步最多 2 个提示；提示的目标用「选择器候选列表」表达 —— 页面结构会变，
 * 但引导不该因为某个 class 改名就整段失效，所以按顺序取第一个存在的元素。
 *
 * 关于第 2 步的两次提示：A 在「我的」页指向「编辑资料」，B 在编辑页指向简介输入。
 * 两次都**不代填、不代提交**，只是把入口指出来；用户可以直接跳过（方案 §3 第 2 步）。
 */

export interface GuideRoute {
  path: string
  query?: Record<string, string>
}

export interface GuideHint {
  /** 目标元素的候选选择器，按顺序取第一个存在的；空数组 = 居中卡片（无高亮） */
  targets: string[]
  /** 这条提示应该在哪个页面出现 */
  route: GuideRoute
  title: string
  body: string
  /** 主按钮文案；缺省时只有「下一步」 */
  primary?: string
  /** 用户点了高亮目标才推进（否则点「下一步」推进） */
  advanceOnTarget?: boolean
  /** 卡片相对目标的位置偏好 */
  placement?: 'top' | 'bottom'
}

export interface GuideStep {
  key: string
  /** 步骤名（只在开发/测试与无障碍文案里用） */
  label: string
  hints: GuideHint[]
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    key: 'welcome',
    label: '欢迎',
    hints: [
      {
        targets: [],
        route: { path: 'map' },
        title: '欢迎来到 TimeMap',
        body: '这是北交大的校园记忆地图。花一分钟认一下主要功能，你也可以随时跳过。',
        primary: '开始认识 TimeMap',
        placement: 'bottom',
      },
    ],
  },
  {
    key: 'profile',
    label: '完善资料',
    hints: [
      {
        targets: ['[data-me-entry="edit-profile"]'],
        route: { path: 'me' },
        title: '先花 20 秒，让同学认得出你',
        body: '同学们靠昵称、学院和年级认出你。点这里可以改昵称、写一句简介。',
        primary: '我来填写',
        advanceOnTarget: true,
        placement: 'bottom',
      },
      {
        targets: ['[data-pe-row="bio"]'],
        route: { path: 'profile-edit' },
        title: '比如：计算机学院大三，爱拍照',
        body: '昵称、学院、年级也能一起改。填完点「保存修改」即可，现在不填也没关系。',
        primary: '暂不填写，继续',
        placement: 'bottom',
      },
    ],
  },
  {
    key: 'content',
    label: '地图与帖子',
    hints: [
      {
        targets: ['.rm__label', '.rm__name', '.rm__card', '[data-marker-phase="ready"]'],
        route: { path: 'map' },
        title: '点地点名，可以看这个地点的介绍',
        body: '每个地点都带简介、校史和一小组在这里发布的帖子。',
        placement: 'bottom',
      },
      {
        targets: ['.rm__card', '.rm__img', '[data-marker-phase="ready"]'],
        route: { path: 'map' },
        title: '点上面的卡片，进到帖子详情',
        body: '带照片的卡片是同学发的帖子；纯文字的内容会显示成小气泡。',
        primary: '我知道了',
        advanceOnTarget: true,
        placement: 'top',
      },
    ],
  },
  {
    key: 'publish',
    label: '发布',
    hints: [
      {
        targets: ['.app__publish'],
        route: { path: 'campus' },
        title: '想发自己的内容，点这个「＋」',
        body: '选地标、写正文、配图，一次发完。',
        primary: '看看发帖页',
        advanceOnTarget: true,
        placement: 'top',
      },
      {
        targets: ['[data-pub-place-field]', '.pub__body'],
        route: { path: 'publish' },
        title: '发帖页长这样',
        body: '地标必选，正文最多 500 字；不想露脸时，打开「匿名发布」会统一显示系统头像。',
        primary: '我知道了，继续',
        placement: 'bottom',
      },
    ],
  },
  {
    key: 'activities',
    label: '活动',
    hints: [
      {
        targets: ['.acts__title', '[data-tab="activities"]'],
        route: { path: 'activities' },
        title: '这里看校园活动和实训项目',
        body: '活动按时间排，可以按地标和状态筛选；实训项目可以点赞。',
        primary: '下一步',
        placement: 'top',
      },
    ],
  },
  {
    key: 'projects',
    label: '实训项目',
    hints: [
      {
        targets: ['.acts__modeTrigger'],
        route: { path: 'activities' },
        title: '点标题可以切换「校园活动 / 实训项目」',
        body: '实训项目里是同学们的课程作品，可以给喜欢的项目点赞。',
        primary: '切到实训项目',
        placement: 'bottom',
      },
      {
        targets: ['.projects__like', '[data-project-id]', '.projects__results'],
        route: { path: 'activities', query: { mode: 'projects' } },
        title: '看到喜欢的项目，点个赞',
        body: '项目页里还能按人气查看大家都在点赞的作品。',
        primary: '完成认识',
        placement: 'bottom',
      },
    ],
  },
]

/**
 * 拍平后的总提示数，进度条用它算「第 X / N 步」。
 *
 * 欢迎卡自己不算"提示"——它没有高亮目标，只是开场。首轮实测（子代理体验报告 P3-3）
 * 里第一个真正的页面提示显示成「提示 2/10」，用户会以为自己漏了一步，
 * 所以计数从第 2 步开始。
 */
export const GUIDE_WELCOME_HINTS = GUIDE_STEPS[0]?.hints.length ?? 0
export const GUIDE_HINT_TOTAL =
  GUIDE_STEPS.slice(1).reduce((sum, step) => sum + step.hints.length, 0)

/** 把步骤下标换成「第几段」（进度文案用 1-based） */
export function guideStepLabel(stepIndex: number): string {
  return `第 ${Math.min(stepIndex + 1, GUIDE_STEPS.length)}/${GUIDE_STEPS.length} 步`
}
