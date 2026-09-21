import { useEffect, useState } from 'react'
import { me as fetchMe, patchMyDisplayName } from '../api/client'
// ⚠️ SessionUser 定义在 ./session（client.ts 只是 re-export 的引用方）——
//    我第一版从 '../api/client' 里 import 它，类型检查会报"没有导出成员"。
import type { SessionUser } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChevronRight } from '../components/icons'
import { goBack } from '../router'
import './profileedit.css'

/**
 * 个人资料 / 编辑资料（原版：MeScreen 的「编辑资料」进入本页）。
 *
 * ## ⚠️ 基线的两个层次（**必须分开看**，审核记录 54 明确要求）
 * ```
 * ORIGINAL_PROFILE_EDIT_ENTRY:          SUPPORTED by trident-me baseline
 *   （docs/original-baseline/screens/trident-me/baseline.json:38 逐字记了
 *     「我的兴趣 ›」「我的标签 ›」「编辑资料」「介绍一下自己～ ›」「我的学校 ›」的位置与文案；
 *     :42 记了「编辑资料」→ 资料编辑页）
 * ORIGINAL_PROFILE_EDIT_PAGE_STRUCTURE: NOT_EVALUATED
 *   （docs/original-baseline/screens/ 下 26 个屏目录里**没有**资料编辑页的内容基线）
 * Current layout: OUR CURRENT IMPLEMENTATION / **not a conformance claim**
 * ```
 * ⚠️ 本文件此前写着"结构按原版实测：三张卡片…" —— 那是**无落盘基线支撑的结构主张**，
 *    已按审核 54 降级：页面布局是**我们当前的实现**，不是一致性主张。
 *    审核 54 也确认：**没有**另一份可用于补证的观察记录，因此不要为了保住注释去推断存在过证据。
 *
 * ## 本次改动（WO#13；依据审核记录 54）
 * ```
 * ① **消灭假写成功**（本单的核心）：
 *    原实现 saveEdit() **只 setState、零网络请求**，而界面**确实显示新值**
 *    → 用户以为改成功了。而本页从「我的」页**一步可达**（MeScreen 5 个入口），
 *      所以这不是"未接线"，是**向用户谎报持久写入已成功**（审核 54 定级 M5 BLOCKING）。
 *    现在保存链是审核 54 冻结的形态：
 *        draft → PATCH /api/users/me → DB mutation → **服务端返回的权威值** → UI commit
 *        PATCH 失败 → **保留 draft** → 权威值不变 → **不得出现成功表象**
 * ② **昵称走权威读取**（原来是 mock 的 me.name）
 * ③ 头像改**首字占位**；「更换头像」原本**没有 onClick**（inert 控件）→ **不再渲染**
 *    （审核 54：avatar = initial placeholder / no fake "更换头像" control）
 * ④ 简介 / 性别 / 标签 / 校园名片 / 学校：**一律不渲染**
 *    （审核 54 冻结：HIDE / DEFER，**NO DB COLUMN ADDED** ——
 *      没有权威 schema、也没有页面内容基线，不应因为本页长这样就反推数据模型）
 * ```
 */

export function ProfileEditScreen() {
  /** 权威身份（来自 GET /api/auth/me）；null = 还没读到 */
  const [identity, setIdentity] = useState<SessionUser | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  /** 正在编辑面板里输入的草稿；null = 面板关闭 */
  const [draft, setDraft] = useState<string | null>(null)
  /** 保存中（禁用按钮，防重复提交） */
  const [saving, setSaving] = useState(false)
  /** 保存失败时的错误；**存在即表示不得显示成功** */
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const u = await fetchMe()
      if (!alive) return
      if (!u) {
        // 未登录 / 读不到 → 明确的不可用态，**不显示任何人的资料**（与 WO#12 同一纪律）
        setIdentity(null)
        setPhase('unavailable')
        return
      }
      setIdentity(u)
      setPhase('ready')
    })()
    return () => {
      alive = false
    }
  }, [])

  const displayName = identity?.displayName ?? ''
  const avatarInitial = displayName.trim().slice(0, 1) || '?'

  /** 打开昵称编辑面板：draft 初值取**当前权威值** */
  function openNickname() {
    setSaveError(null)
    setDraft(displayName)
  }

  /**
   * 保存：**真的发请求**，并只用**服务端返回值**更新界面。
   *
   * 审核 54 冻结的语义，逐条对应：
   *   · 失败 → 保留 draft（不清空、不关闭面板）、权威值不变、显示错误
   *   · 成功 → 用服务端返回的 displayName 更新 identity（**不是**用 draft 冒充成功）
   */
  async function saveNickname() {
    if (draft === null || saving) return
    const next = draft.trim()
    if (!next) {
      setSaveError('昵称不能为空')
      return
    }
    setSaving(true)
    setSaveError(null)
    const r = await patchMyDisplayName(next)
    setSaving(false)
    if (!r.ok) {
      /*
        ⚠️ 关键：**失败时保留用户输入**（面板不关、draft 不动），并给出明确错误。
        绝不 setIdentity(next) —— 那正是原来的"假写成功"。

        注意失败结果的形状是 { ok:false, reason, status? }（**没有** error 字段）——
        我第一版读了 r.error，类型检查当场报 TS2339；这里按 status 区分未授权。
      */
      setSaveError(
        r.status === 401 ? '登录已过期，请重新登录' : '保存失败，请稍后重试（你的输入已保留）',
      )
      return
    }
    // 只用**服务端权威值**提交到界面
    setIdentity((prev) => (prev ? { ...prev, displayName: r.value.displayName } : prev))
    setDraft(null)
  }

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('me')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="个人资料"
        />
      }
      scroll
    >
      {phase === 'loading' && (
        <section className="pe__card" data-pe-state="loading">
          <p className="pe__note">加载中…</p>
        </section>
      )}

      {phase === 'unavailable' && (
        <section className="pe__card" data-pe-state="unavailable">
          <p className="pe__note">无法读取你的资料（可能未登录）</p>
        </section>
      )}

      {phase === 'ready' && identity && (
        <>
          <section className="pe__card" data-pe-state="ready">
            <div className="pe__avatarRow">
              <div className="pe__avatarWrap">
                {/* 头像：首字占位（users 表没有 avatar 列）。原「更换头像」是 inert 控件，已移除。 */}
                <div className="pe__avatar pe__avatar--ph" aria-hidden data-pe-avatar-placeholder>
                  {avatarInitial}
                </div>
              </div>
            </div>

            <button className="pe__row" onClick={openNickname} data-pe-row="nickname">
              <span className="pe__label">昵称</span>
              {/* 权威值：来自 GET /api/auth/me */}
              <span className="pe__value" data-pe-name>
                {displayName}
              </span>
              <IconChevronRight size={15} />
            </button>

            {/*
              ⚠️ 简介 / 性别 / 标签 / 校园名片 / 学校 **刻意不渲染**：
                · users 表没有 bio/gender/tags 列；schools/campuses 两表为空、用户未关联
                · 审核记录 54 冻结：HIDE / DEFER 且 **NO DB COLUMN ADDED**
                  （没有权威 schema、也没有页面内容基线，不应因为本页长这样就反推数据模型）
            */}
          </section>

          {/* 昵称编辑面板：只在用户主动打开时出现 */}
          {draft !== null && (
            <section className="pe__panel" data-pe-panel="nickname">
              <h3 className="pe__panelTitle">修改昵称</h3>
              <input
                className="pe__input"
                data-pe-input
                value={draft}
                maxLength={40}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="输入新的昵称"
              />
              {saveError && (
                <p className="pe__error" data-pe-error>
                  {saveError}
                </p>
              )}
              <div className="pe__panelActions">
                <button
                  className="pe__cancel"
                  data-pe-cancel
                  onClick={() => {
                    setDraft(null)
                    setSaveError(null)
                  }}
                >
                  取消
                </button>
                <button className="pe__save" data-pe-save onClick={() => void saveNickname()} disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </Screen>
  )
}
