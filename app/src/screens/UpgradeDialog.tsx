import { useState } from 'react'
import { Screen } from '../components/Shell'
import { IconChevronRight } from '../components/icons'
import { navigate } from '../router'
import './upgrade.css'

/**
 * 升级弹窗（对应原版 `campusx://upgradeAlert` / `AppUpdateDialogActivity`）。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ Round 319（最终 audit 的第 ① 问）：本屏原先是**可执行的假数据 + 假成功**surface
 * ════════════════════════════════════════════════════════════════════
 * ```
 * 改前：
 *   import { upgradeInfo } from '../data/mock'
 *     upgradeInfo = { version: '2.11.0', size: '48.6 MB',
 *                     highlights: ['校园广场支持按标签筛选', '群聊新增 @ 面板与消息引用',
 *                                  '修复地图定位偶发偏移'] }        ← ① **全是编造**（无任何出处）
 *   <h2>v{version}</h2> / <p>安装包 {size}</p> / 三条 highlights      ← 把编造值当权威展示
 *   <button>稍后再说</button>                                        ← ② 文案与基线观察**不符**
 *   <button onClick={() => navigate('campus')}>立即更新</button>      ← ③ **假装在更新**（只是跳走）
 * ```
 * 依据（`docs/original-baseline/screens/upgrade-alert/baseline.json`，status=**observed**）：
 * ```
 *   interactions: "弹窗叠在校园广场上：标题 + 版本说明 +「**取消**」「立即更新」"
 *   navigation:   "取消 → 回到广场"
 * ```
 * ⚠️ 而**「立即更新」在原文里做什么 = 未观察**（基线只记了「取消」的去向）。
 *
 * ════════════════════════════════════════════════════════════════════
 * 现在的处置（对齐已观察的部分；不发明未观察的部分）
 * ════════════════════════════════════════════════════════════════════
 *   · 按钮文案「稍后再说」→「**取消**」（**逐字**对齐基线的 observed 文案）
 *   · **删除**编造的 version / size / highlights（**不再把编造值当权威展示**）；
 *     版本说明区改为**如实**说明（我们不知道自己"新版本"是什么 —— 本 demo 没有发布流程）
 *   ·「立即更新」→ **不再假装更新**：点击只给明确说明，**不跳转、不显示任何成功字样**、
 *     不触发任何下载/写入（同 WO#20「下一步」的处置口径）
 *   ·「取消」→ 仍回校园广场（与基线 observed 的 navigation 一致）
 *   · mock 的 `upgradeInfo` **移出生产代码**（→ `scripts/m5/fixtures/legacy-upgrade-info.json`）
 *
 * ⚠️ 术语口径（不夸大）：
 * ```
 *   UPGRADE_ALERT_STRUCTURE:      与基线 observed 一致（标题 + 版本说明 + 取消 + 立即更新）
 *   ORIGINAL_VERSION_TEXT:        **NOT_EVALUATED**（原版「版本说明」的具体文案未观察）
 *   UPDATE_FLOW:                  **NOT_IMPLEMENTED / NOT_EVALUATED**（原文「立即更新」的去向未观察）
 *   UPGRADE_ALERT_EXPERIENCE:     **不可写 PASS**
 * ```
 */
export function UpgradeDialog() {
  const [notice, setNotice] = useState('')

  return (
    <Screen className="up" scroll={false}>
      <div className="up__mask">
        <div className="up__dialog">
          <div className="up__hero" aria-hidden>
            <span className="up__hero-text">Campus</span>
            <span className="up__hero-sub">发现新版本</span>
          </div>

          <div className="up__body">
            {/*
              ⚠️ 这里**刻意不写版本号/体积/几条亮点**：那些在改前是**编造的**（无出处）。
                 原版「版本说明」的**具体文案未观察** ⇒ 如实说明，不发明。
            */}
            <p className="up__unavailable" data-upgrade-unavailable>
              版本信息暂不可用
            </p>
            <p className="up__note" data-upgrade-note>
              本 demo 没有发布/更新流程，也未观察到原版「版本说明」的具体文案。
            </p>
          </div>

          <div className="up__actions">
            {/* 文案逐字对齐基线 observed 的「取消」 */}
            <button className="up__later" data-upgrade-cancel onClick={() => navigate('campus')}>
              取消
            </button>
            {/*
              ⚠️ 原实现这里是 `navigate('campus')` —— 点了就跳走、看起来像"更新完回到广场"。
                 那是**假成功**。现在只给明确说明（同 WO#20「下一步」的处置）。
            */}
            <button
              className="up__now"
              data-upgrade-now
              onClick={() => setNotice('更新流程未接入：本 demo 无法下载或安装更新。')}
            >
              立即更新
              <IconChevronRight size={15} />
            </button>
          </div>
          {notice && (
            <p className="up__note" data-upgrade-notice>
              {notice}
            </p>
          )}
        </div>
      </div>
    </Screen>
  )
}
