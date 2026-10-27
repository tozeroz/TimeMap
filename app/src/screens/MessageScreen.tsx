import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconChatBubble, IconClose, IconPlus, IconSearch } from '../components/icons'
import { getThreads, relativeTime, type ApiThread } from '../api/client'
import { getSession } from '../api/session'
/*
  ⚠️ M5 WO#10：本文件**已不再 import 任何 mock 数据**。
  此前是 `import { users, type User } from '../data/types'` —— 它支撑了
  「更多同学」的 9 个写死用户与好友申请链路。随那条假链路一起删除。
  这使 MessageScreen 成为本项目**第一个完全不依赖 mock 数据的页面**。
*/
import { goBack, navigate } from '../router'
import './message.css'

/**
 * 聊天页（原版 MessageActivity）。
 *
 * ## 原版实测结构（M0-M2 只读观察）
 * - 顶部：左上关闭、中间「聊天」、右上加号
 * - 邀请卡：「分享我的校园卡」+「邀请同学一起加入 Campus!」+ 按钮「邀请同学」
 * - 会话列表：群聊行 + 单聊行
 * - 更多同学：每行头像 + 昵称 + 标签/学院/年级 + **添加**按钮 + **移除**按钮
 *   - 点「添加」弹出「好友申请」弹窗（输入框预填「你好我是{我的昵称}」，字数 x/30，取消/发送）
 *   - 点「移除」把该同学从推荐列表移除，列表自动补位
 *
 * ## ⚠️ M5 WO#8：数据来源的**分区标注**（很重要，请勿误读）
 *
 * 本文件此前**整页都读 mock**（`import { groups, me, threads, users } from '../data/mock'`）。
 * 实测后果：从这一页点进会话会跳到 `#/group?id=g1` / `#/chat?id=t1` —— id 全是 mock 的，
 * 而真实后端只认 UUID，于是**用户从「消息」永远到不了真实会话**（详见
 * `docs/archive/legacy-development/m5/WO8-PREFIX-FAIL-EVIDENCE.md`）。
 *
 * 现在按区块区分，**每个区块只有一个明确的数据来源**：
 *
 * | 区块 | 数据来源 | 状态 |
 * |---|---|---|
 * | 会话列表（群聊 + 单聊） | `GET /api/threads` | ✅ **已接真实后端**（WO#8） |
 * | 邀请卡的**姓名** | `getSession().user.displayName` | ✅ 真实（WO#8 修：此前显示 mock 的「自定义名称6」，与底部 tab 栏显示的真名自相矛盾） |
 * | 邀请卡的**头像** | 首字占位（`invite__avatar--ph`） | ✅ **已改占位**（WO#8；因 `users` 表**无 avatar 列**，见下） |
 * | 邀请卡的**学校/学院/年级** | **不渲染** | ✅ **已移除**（WO#8；无权威来源 → 空着比填假值诚实） |
 * | 更多同学 + 好友申请 | mock | ⚠️ **`MOCK_NOT_WIRED`**（后端无推荐/好友申请能力）—— WO#10 处理 |
 *
 * ⚠️ 本表曾在 WO#8 后**未同步更新**（一度仍写着"邀请卡学校/学院/年级/头像 = mock"，
 *    而代码里那几项其实已经移除/改占位了）。2026-09-22 按源码逐项核对后更正。
 *    —— 文档与实际不符本身就是一种缺陷（会误导后续工作单与审核），故单独记这一笔。
 *
 * 为什么这些字段没有权威来源（实测，非推测）：
 *   `users` 表只有 id / handle / display_name / created_at / updated_at / school_campus_id / phone_e164
 *   → **没有** avatar / college / grade / major / mbti / zodiac 这些列；
 *   `school_campus_id` 指向 campuses(id) → schools(id)，但**两张表都没有数据、且三个用户该列全为 NULL**
 *     （`scripts/m5/probe-school-source.sh` 实测）。
 *   姓名我们有权威来源（会话），那几个字段没有 —— 所以只接姓名，
 *   其余**不填假值**。不把整张卡"半接线成看起来全真"是刻意的：**半真半假比明确未接线更危险**。
 *   → WO#10 按字段级 inventory 处理（`docs/archive/legacy-development/m5/WO10-PLAN-message-screen-field-inventory.md`）。
 */

/** 会话行要显示的名字：群聊用 title；单聊用对方昵称（后端新给的 peerName） */
function threadTitle(t: ApiThread): string {
  if (t.kind === 'group') return t.title?.trim() || '未命名群聊'
  return t.peerName?.trim() || t.title?.trim() || '未命名会话'
}

/** 最后一条消息的摘要（与 WO#5 的语音/图片摘要规则保持一致） */
function lastSummary(t: ApiThread): string {
  const lm = t.lastMessage
  if (!lm) return '暂无消息'
  if (lm.kind === 'image') return '[图片]'
  if (lm.kind === 'voice') return '[语音]'
  return lm.body
}

export function MessageScreen() {
  /*
    ⚠️ M5 WO#10：这里原本有 5 份**纯前端假状态**，现已全部删除：
      suggestions / applied  —— 9 个写死的 mock 用户 + "已申请"标记
      target / request       —— 好友申请弹窗的收件人与申请文案
      inviteOpen             —— 邀请分享面板开关
    它们共同构成一条"看起来能操作、实际零副作用"的链路：
      添加 → 弹窗 → 写文案 → 发送 → 显示"已申请"（实测 fetchCountDelta = 0）
    审核记录 51 把本单判据冻结为："用户在 MessageScreen 上不得再看到任何会被合理理解为
    '来自真实业务状态'或'执行了真实业务操作'的 mock 内容。"
    删掉这些状态就是删掉那条假链路的根 —— 而不是只把按钮藏起来。
    （原先的 9 元素硬编码数组已抄进测试 fixture：
      scripts/m5/fixtures/known-message-screen-mocks.json，供 Gate 反向断言使用。）
  */

  /** 邀请卡的显示名：来自**真实会话**（此前是 mock，与底部 tab 栏不一致） */
  const [meName] = useState<string>(() => getSession()?.user?.displayName?.trim() || '我')

  /** 会话列表状态机（与 ChatScreen 同风格：加载 / 就绪 / 失败 三态都必须明确可见） */
  const [threads, setThreads] = useState<ApiThread[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listErr, setListErr] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadThreads = useCallback(async () => {
    setListState('loading')
    const r = await getThreads()
    if (!mounted.current) return
    if (r.ok) {
      setThreads(r.value.items)
      setListErr('')
      setListState('ready')
    } else {
      // 失败时必须说出来：静默保留旧内容会让用户以为列表是最新的
      setThreads([])
      setListErr(`加载失败：${r.reason}`)
      setListState('error')
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  function openThread(t: ApiThread) {
    /*
      路由 id 一律用**后端给的 UUID**，并按审核记录 44 冻结的形式传：
        CANONICAL: `#/chat?id=<uuid>`（`navigate(path, query)` 产生的就是这个）
      ⚠️ 这里**绝不能**再传 mock id —— 那正是本单修掉的缺陷。
    */
    if (t.kind === 'group') navigate('group', { id: t.id })
    else navigate('chat', { id: t.id })
  }

  /*
    ⚠️ M5 WO#10：`openRequest()` 与 `sendRequest()` 已删除 —— 它们就是那条"假成功"链路的实现：
      openRequest: setTarget(user) + setRequest(`你好我是${meName}`)  ← 预填看起来像真的
      sendRequest: setApplied(...) + setTarget(null)                  ← **零网络请求**却标记"已申请"
    删掉它们（连同上面的 state）才是真的把假能力移除；
    只隐藏按钮而留着函数，等于把 fake affordance 从 UI 挪进了死代码。
  */

  const groupThreads = threads.filter((t) => t.kind === 'group')
  const directThreads = threads.filter((t) => t.kind !== 'group')

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center="聊天"
          right={
            <button className="iconbtn" aria-label="新建">
              <IconPlus size={22} />
            </button>
          }
        />
      }
      scroll
    >
      {/* 校园卡邀请卡（姓名已接真实会话；学校/学院/年级/头像见文件头 MOCK_NOT_WIRED） */}
      <section className="invite">
        <div className="invite__head">
          <div className="invite__avatar invite__avatar--ph" aria-hidden>
            {meName.slice(0, 1)}
          </div>
          <div>
            <div className="invite__title">分享我的校园卡</div>
            <div className="invite__sub">邀请同学一起加入 TimeMap!</div>
          </div>
        </div>
        <div className="invite__card">
          <div className="invite__brand">TimeMap</div>
          <div className="invite__info">
            <div className="invite__name" data-me-name>
              {meName}
            </div>
            {/*
              ⚠️ MOCK_NOT_WIRED：学校/学院/年级后端暂无来源（/api/auth/me 未返回这些字段）。
              刻意**不**用 mock 值填充 —— 空着比填一个假学院诚实；接线单见 NEXT-ACTIONS WO#10。
            */}
          </div>
        </div>
        {/*
          ⚠️ M5 WO#10：原来这里是一个「邀请同学」按钮，点了打开分享面板。
          按审核记录 51 的更严格要求（**入口本身也不能是假的**），
          在没有任何真实分享能力之前，这个按钮**不再渲染**：

            原状：点「邀请同学」→ 打开面板 → 5 个"分享目标"点了只关面板
                  = fake affordance 藏在第二层
            审核要求：这类入口必须**隐藏/禁用并明确不可用**，而不是保留一个空弹层

          真实分享需要原生能力（系统分享面板 / 微信 SDK 等），属独立工作单；
          在那之前"没有这个按钮"比"有这个按钮但什么都不做"诚实得多 ——
          后者会让用户以为自己分享成功了。

          ⚠️ 与 1:1 目标的关系（如实记录，不假装）：原版**确实有**分享入口与分享面板。
          因此这一处是**有意的功能后撤**（为了不撒谎），已登记为 conformance backlog：
              ORIGINAL_SHARE_UI_EXISTS: 有（M0/M1 只读观察）
              OUR_SHARE_ENTRY:          不渲染（无可用的真实分享能力）
              BACKLOG:                  待实现真实分享后再恢复该入口与面板
          Gate 对应：NO_INERT_SHARE_ENTRY（不允许"看着可操作但其实什么都不做"的分享流程）
        */}
      </section>

      {/* ---------------------------------------------------------------
          会话列表：**真实数据**（GET /api/threads）
          三态都必须明确可见：加载中 / 失败 / 空
          ⚠️ 这里**不允许出现任何 mock 行**（审核记录 44 对"权威会话列表"的要求）
      --------------------------------------------------------------- */}
      <section className="list" data-list="threads">
        {listState === 'loading' && <p className="list__state">加载中…</p>}
        {listState === 'error' && (
          <div className="list__state" data-state="error">
            <p>会话列表加载失败</p>
            <p className="list__stateSub">{listErr}</p>
            <button className="list__retry" onClick={() => void loadThreads()}>
              重试
            </button>
          </div>
        )}
        {listState === 'ready' && threads.length === 0 && (
          <div className="list__state" data-state="empty">
            <p>还没有会话</p>
            <p className="list__stateSub">去「校园广场」找人聊两句吧</p>
          </div>
        )}

        {listState === 'ready' &&
          groupThreads.map((t) => (
            <button
              key={t.id}
              className="row"
              data-thread-id={t.id}
              data-thread-kind={t.kind}
              onClick={() => openThread(t)}
            >
              <span className="row__groupIcon" aria-hidden>
                <IconChatBubble size={20} />
              </span>
              <div className="row__main">
                <div className="row__title">{threadTitle(t)}</div>
                <div className="row__sub">{lastSummary(t)}</div>
              </div>
              <div className="row__time">{t.memberCount} 人</div>
            </button>
          ))}

        {listState === 'ready' &&
          directThreads.map((t) => (
            <button
              key={t.id}
              className="row"
              data-thread-id={t.id}
              data-thread-kind={t.kind}
              onClick={() => openThread(t)}
            >
              <span className="row__avatar row__avatar--ph" aria-hidden>
                {threadTitle(t).slice(0, 1)}
              </span>
              <div className="row__main">
                <div className="row__title">{threadTitle(t)}</div>
                <div className="row__sub">{lastSummary(t)}</div>
              </div>
              <div className="row__time">
                {t.lastMessage?.createdAt ? relativeTime(t.lastMessage.createdAt) : ''}
              </div>
            </button>
          ))}
      </section>

      {/*
        ⚠️ M5 WO#10：**移除假推荐 + 假好友申请**，保留区块结构壳。

        审核记录 51 的冻结口径：
          SUGGEST_SECTION_STRUCTURE:   PRESERVED      （原版确有这一区域 → 不制造"原版没有"的新偏差）
          SUGGEST_ROWS:                NONE           （不再伪造 9 个"真实同学"）
          SUGGEST_EMPTY_PRESENTATION:  OUR_DESIGN_CHOICE
          ORIGINAL_EMPTY_STATE:        NOT_EVALUATED

        为什么删而不是保留 + 打标：
          推荐区的每一行都是"看起来来自真实业务状态"的内容 —— 头像、昵称、
          「相同学校」标签、MBTI/星座、学院-专业、年级，以及一个**点了会显示"已申请"
          但其实不发任何请求**的「添加」按钮。
          审核记录 51 把本单的完成判据冻结为一句话：
            **用户在 MessageScreen 上不得再看到任何会被合理理解为
              "来自真实业务状态"或"执行了真实业务操作"的 mock 内容。**
          推荐规则、好友关系模型、学校数据**都不存在** → 本单**删除虚假能力**，
          而**不**临时设计后端（不造列、不造接口）。

        ⚠️ 空态文案必须是**中性的**（审核 51 明确禁止暗示我们掌握了某类数据）：
          ❌ "暂无同校同学"            → 暗示我们掌握了"同校"
          ❌ "暂时没有符合你学院的推荐"  → 暗示我们掌握了学院
          ❌ "完善资料即可发现更多同学"  → 暗示有推荐算法
          ✅ "暂无可显示的推荐"         → 中性，不断言任何业务事实
        文案标 OUR_DESIGN_CHOICE；Gate **只**验证"有明确空态 + 无 mock 行 + 无假 CTA +
        无虚构业务事实"，**不**把具体文案升级成原版 conformance。
      */}
      <section className="suggest" data-mock-region="suggestions">
        <header className="suggest__head">
          <h3 className="suggest__title">更多同学</h3>
          <button className="iconbtn" aria-label="搜索">
            <IconSearch size={18} />
          </button>
        </header>
        <p className="suggest__empty" data-suggest-empty>
          暂无可显示的推荐
        </p>
      </section>

      {/*
        ⚠️ M5 WO#10：好友申请弹窗**整块移除**（连同上方的「添加」按钮一起）。

        为什么必须整块删而不是禁用「发送」：
          这个弹窗存在的唯一目的就是服务那个假「添加」按钮。它有三层假：
            ① 输入框预填"你好我是{昵称}" → 像真的在写申请
            ② 字数 x/30             → 像真的有长度限制契约
            ③ 点「发送」后进入"已申请" → **看起来申请发出去了**
          实测（改前证据）：点「发送」时 **fetchCountDelta = 0** ——
          **零网络请求**，却把按钮改成"已申请"。这是最恶劣的一种：
          用户以为完成了一次真实业务操作，实际什么都没发生。
          审核记录 51 因此新增一条反向 Gate：NO_FAKE_FRIEND_REQUEST_STATE。

        后端能力确实不存在：无好友关系表、无好友申请表、无好友申请接口
        （`scripts/m5/probe-school-source.sh` / `probe-users-schema-for-wo10.sh` 实测）。
        → 本单**删除**这个假操作路径；真正的推荐/好友能力属 WO#11（需先定义推荐规则与好友模型）。
      */}

      {/*
        ⚠️ M5 WO#10：邀请分享面板 —— 按审核记录 51 **比原计划更严格一步**：
        不仅删掉 5 个假分享目标，**入口本身也不再产生"可操作但什么都不做"的流程**。

        审核 51 的原话要旨：
          "如果仍然存在：点击'邀请/分享' → 打开一个没有任何真实动作的空面板，
           那只是把 fake affordance 从第二层挪到了第一层。"
        因此：没有真实分享能力时 → 不展示假 target、不产生任何"已分享/复制成功"反馈、
        **入口本身必须隐藏/禁用并明确不可用**。
        原版 share UI 的存在继续记录为 conformance backlog（保留 1:1 目标），
        但不为了"结构像原版"而保留一个假的操作入口。
      */}
    </Screen>
  )
}
