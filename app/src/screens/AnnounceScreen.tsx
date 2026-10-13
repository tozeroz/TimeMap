import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack } from '../router'
import './announce.css'

/**
 * 群公告（对应原版 `campusx://announce` / `com.kairuotu.chat.announce.AnnounceActivity`）。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ Round 319（A5 机械切片查出的**新偏差**，已修）
 * ════════════════════════════════════════════════════════════════════
 * 原版基线（`docs/test/original-baseline/screens/announce/baseline.json`，**observed**）：
 * ```
 *   title        = 群公告
 *   interactions = ["顶部标题「校园活动」+ 左上返回", "内容区为空"]
 *   navigation   = ["返回 → 上一页"]
 * ```
 * 改前我们的实现（**两处偏差**）：
 * ```
 *   ① center="校园公告"                      ← 标题与基线不符（原文是「校园活动」）
 *   ② const ANNOUNCEMENTS = [ 3 条 ]         ← 基线明写「**内容区为空**」，
 *      {ANNOUNCEMENTS.map(...)}                 我们却渲染了 3 条**编造的公告**
 *      （含"校园广场内容规范更新""图书馆四楼自习区开放时间调整""新生校园卡领取提醒"
 *        及其正文与时间 —— **全部无出处**）
 *   ③ 左上 IconBack + aria-label="返回"      ← 与基线"左上返回"**相符** ✓（不动）
 * ```
 * ⚠️ 为什么这是必须修的：那 3 条公告是**编造的业务内容**，而且这条偏差**从未被核对过**
 *    —— Round 261 的 `FIDELITY-GAP-AUDIT-closed-screens-vs-baseline.md` 只逐条核对了
 *    4 个屏（feed-list / message / group / at-panel），本屏不在其中。
 *
 * ════════════════════════════════════════════════════════════════════
 * 现在的处置
 * ════════════════════════════════════════════════════════════════════
 *   · 标题 → 「**校园活动**」（逐字对齐 observed）
 *   · **删除**那 3 条编造公告，改为**如实**呈现"无内容"（与 observed 的"内容区为空"一致）
 *   · 左上返回保持不变（本来就相符）
 *
 * ⚠️ 术语口径（不夸大）：
 * ```
 *   ANNOUNCE_TITLE:        「校园活动」（对齐 observed）
 *   ANNOUNCE_LIST_CONTENT: **NOT_EVALUATED** —— 原版观察到的状态是"内容区为空"，
 *                          即"当时没有公告"；**有公告时**渲染成什么样**未观察**
 *                          （需要原版账号在该群里有公告才能看到 ⇒ 属另一个状态的观察）
 *   ANNOUNCE_EMPTY_STATE:  我们显示"暂无内容"；原版空态**是否**长这样**未观察**
 *                          ⇒ 不发明样式，保持朴素
 * ```
 * ⚠️ 本屏的内容**不接后端**：我们**没有**公告实体/接口；若要做成"有内容"，
 *    需要先有权威来源（那是新功能，不在本单范围）。**不得**为了"看起来完整"再编数据。
 */
export function AnnounceScreen() {
  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="校园活动"
        />
      }
      scroll
    >
      <div className="ann">
        {/*
          ⚠️ 刻意**不**渲染任何公告条目：原版观察到的就是"内容区为空"，
             而我们有公告时的正确形态**未观察**、也**没有**权威公告数据。
        */}
        <p className="ann__empty" data-announce-empty>
          暂无内容
        </p>
      </div>
    </Screen>
  )
}
