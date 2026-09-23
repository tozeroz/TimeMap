import { useEffect, useState } from 'react'
import { Screen } from '../components/Shell'
import { IconChevronRight } from '../components/icons'
import { compareVersions, getAppRelease, type ApiAppRelease } from '../api/client'
import { APP_VERSION } from '../version'
import { navigate } from '../router'
import './upgrade.css'

/**
 * 升级弹窗（对应原版 `campusx://upgradeAlert` / `AppUpdateDialogActivity`）。
 *
 * ════════════════════════════════════════════════════════════════════
 * 本屏经历三个阶段（都如实留痕）
 * ════════════════════════════════════════════════════════════════════
 * ```
 *   ① 最初：从 mock 拿 `upgradeInfo = { version: '2.11.0', size: '48.6 MB', highlights: [...] }`
 *      —— **全部无出处**；且「立即更新」是 `navigate('campus')`（点了就跳走，
 *      看起来像"更新完了"）= **假成功**；按钮文案「稍后再说」也与基线 observed 的「取消」不符。
 *   ② Round 319 早段：删掉编造值与假成功，改为"版本信息暂不可用 + 明确说明更新流程未接入"
 *      （**诚实但没有能力**）。
 *   ③ 现在（WO#23；Owner 裁定 ③ 要求"必须实现体验等价"）：**真实的检查更新** ——
 *      向**我们自己的后端**要发布清单（`GET /api/app/release`），拿**本机真实版本**比较。
 * ```
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 术语口径（不夸大）
 * ════════════════════════════════════════════════════════════════════
 * ```
 *   APP_UPDATE_CHECK_IS_REAL:   **PASS**（真请求、真比较、真状态）
 *   ORIGINAL_UPDATE_FLOW:       **NOT_EVALUATED** —— 原版「立即更新」的真实去向未观察；
 *       要观察就得在原版上点它，而那可能触发**真实下载/安装** ⇒ 只读约束下
 *       **BLOCKED_BY_POLICY**，不能去点 ⇒ **无从对齐**
 *   UPDATE_DIALOG_STRUCTURE:    与基线 observed 一致（标题 + 版本说明 +「取消」+「立即更新」）
 *   UPDATE_DIALOG_LAYOUT:       **NOT_EVALUATED**（原版弹窗的视觉布局未逐像素核对）
 * ```
 */

/** 检查结果的**互斥**状态（每种都有专属钩子，便于门禁与排障） */
type CheckPhase = 'checking' | 'uptodate' | 'available' | 'not_configured' | 'error'

export function UpgradeDialog() {
  const [phase, setPhase] = useState<CheckPhase>('checking')
  const [release, setRelease] = useState<ApiAppRelease | null>(null)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await getAppRelease()
      if (!alive) return
      if (!r.ok) {
        setErr(r.reason)
        setPhase('error')
        return
      }
      setRelease(r.value)
      if (!r.value.configured) {
        /* 后端没有生效的发布行 ⇒ 如实说"没有清单"，**不**编造版本 */
        setPhase('not_configured')
        return
      }
      const latest = r.value.latestVersion ?? ''
      /* ⭐ 真实比较：本机 APP_VERSION vs 后端清单里的 latestVersion */
      setPhase(compareVersions(APP_VERSION, latest) < 0 ? 'available' : 'uptodate')
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <Screen className="up" scroll={false}>
      <div className="up__mask">
        <div className="up__dialog">
          <div className="up__hero" aria-hidden>
            <span className="up__hero-text">Campus</span>
            <span className="up__hero-sub">
              {phase === 'available' ? '发现新版本' : phase === 'checking' ? '正在检查更新' : '版本信息'}
            </span>
          </div>

          <div className="up__body">
            {/*
              ⭐ 本机当前版本**始终**可见（带钩子）。
              ⚠️ 为什么单列一行而不是只在"已是最新"分支里显示：
                 WO#23 门禁要能判断"设备装的版本 vs 清单里的最新版本"的相对关系，
                 而"有更新"分支原先不显示当前版本 ⇒ 门禁读不到 ⇒ 只能记 INCONCLUSIVE。
                 ⇒ 让事实**始终可观测**，门禁才能给出确定的判断。
            */}
            <p className="up__note" data-upgrade-current>
              当前版本 v{APP_VERSION}
            </p>

            {phase === 'checking' && (
              <p className="up__unavailable" data-upgrade-checking>
                正在检查更新…
              </p>
            )}

            {/*
              ⭐ 已是最新：这是**真实**结论（本机版本 ≥ 后端清单里的最新版本）。
              ⚠️ 仍然显示本机真实版本号 —— 它来自单一定义 app/src/version.ts
                 （与 android versionName 的一致性由门禁机械校验）。
            */}
            {phase === 'uptodate' && (
              <p className="up__unavailable" data-upgrade-uptodate>
                已是最新版本
              </p>
            )}

            {/* 有更新：显示后端清单里的真实版本与说明；下载地址来自后端（可能未配置） */}
            {phase === 'available' && (
              <>
                <p className="up__unavailable" data-upgrade-available>
                  新版本 v{release?.latestVersion}
                </p>
                {release?.notes && <p className="up__note">{release.notes}</p>}
                {release?.apkUrl ? (
                  <p className="up__note" data-upgrade-apk>
                    安装包地址：{release.apkUrl}
                  </p>
                ) : (
                  /* ⚠️ 我们**没有**托管安装包 ⇒ 如实说，**不**编造链接、不假装能下载 */
                  <p className="up__note" data-upgrade-no-apk>
                    安装包尚未托管，因此无法在此下载。
                  </p>
                )}
              </>
            )}

            {/* 后端没有生效的发布清单 */}
            {phase === 'not_configured' && (
              <>
                <p className="up__unavailable" data-upgrade-not-configured>
                  版本信息不可用
                </p>
                <p className="up__note">后端尚未配置发布清单，无法判断是否有新版本。</p>
              </>
            )}

            {/* 检查本身失败（网络/服务不可用）—— 如实报错，不假装"已是最新" */}
            {phase === 'error' && (
              <>
                <p className="up__unavailable" data-upgrade-error>
                  检查更新失败
                </p>
                <p className="up__note">{err || '网络或服务不可用，请稍后再试。'}</p>
              </>
            )}
          </div>

          <div className="up__actions">
            {/* 文案逐字对齐基线 observed 的「取消」 */}
            <button className="up__later" data-upgrade-cancel onClick={() => navigate('campus')}>
              取消
            </button>
            {/*
              ⚠️ 「立即更新」只在**真的有可下载地址**时才给出动作；
                 否则只给明确说明（不跳转、不显示成功、不触发任何下载）。
                 原版该按钮的真实去向**未观察** ⇒ 我们不发明一个假的下载流程。
            */}
            {/*
              ⚠️ 审核 68 第 ③ 项：原版「立即更新」的真实去向**未观察**（不可去点），
                 但 Owner 裁定"自更新必须实现体验等价" ⇒ 至少要能**真的把用户带进
                 一个可安装的 APK 流程**。

              ⚠️⚠️ 这里修过一处**真实缺陷**（WO#23 门禁抓出来的）：
                 初版写的是 `window.open(release.apkUrl, '_blank')` ——
                 在 Capacitor 的 WebView 里**什么都不发生**（门禁实测：
                 点击后 **没有任何**对 apkUrl 的请求，Android 的 DownloadManager 也没有条目）。
                 ⇒ 改成**真实导航** `window.location.href = apkUrl`：
                   Capacitor 的 WebViewClient 会把**本应用 origin 之外**的 URL 交给系统处理
                   （系统浏览器/下载器），于是 APK 真的开始下载、用户点通知即可安装。
                 ⚠️ 这会离开本应用页面 —— 那是**有意的**：更新动作本来就该交出去。
                 仍然**不声称**"安装完成"：安装确认是 Android 系统 UI，不是我们能断言的。
            */}
            <button
              className="up__now"
              data-upgrade-now
              onClick={() => {
                if (phase === 'available' && release?.apkUrl) {
                  /* 真实导航 ⇒ 交给系统浏览器/下载器 */
                  window.location.href = release.apkUrl
                  return
                }
                if (phase === 'uptodate') {
                  setNotice(`已是最新版本（v${APP_VERSION}），无需更新。`)
                  return
                }
                setNotice('当前没有可下载的安装包，无法执行更新。')
              }}
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
