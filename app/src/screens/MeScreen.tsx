import { useEffect, useState } from 'react'
import { logout, me as fetchMe } from '../api/client'
import type { SessionUser } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { Drawer } from '../components/Drawer'
import {
  IconChatBubble,
  IconEdit,
  IconImage,
  IconMenu,
  IconShare,
} from '../components/icons'
import { navigate } from '../router'
import './me.css'

/** 个人页：对齐原版 —— 纯白底、无多余模块，中部只有「拍下眼前的风景」+ 提示气泡 */
export function MeScreen() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  // ⚠️ WO#14：原来这里还有 `const [session, setSession] = useState(() => getSession())`。
  //    身份改由**权威** `identity`（GET /api/auth/me）提供后，`session` 不再被读取，
  //    tsc 的 noUnusedLocals 当场报 TS6133 —— 于是删掉（而不是留着当"以后可能有用"）。
  //    logout 路径仍用 getSession 吗？不再需要：logout() 内部已 clearSession()。

  /*
    ⭐ M5 WO#14：**身份必须只有一个权威来源**。

    ## 改前（本轮设备实测）
      · 中心大字：`me.name` = mock 的「自定义名称6」
      · 下方登录行：`session.user.displayName` = 权威「Lemy」
      ⇒ **同一屏上同时显示两个身份**（用户抬头看到 A、低头看到 B）。
    ## 两处**互相独立**的缺陷
      ① 中心名字/头像走 mock（mock.ts 的 me）
      ② 登录行读的是**陈旧缓存**：`getSession()` 有模块级 cache，而本组件只挂载时读一次；
         WO#13 的 PATCH 成功后原先**没有**任何代码把新 displayName 写回缓存
         （现已在 ProfileEditScreen 成功分支调用 `updateSessionUser`）。
    ## 现在的做法
      用 `GET /api/auth/me` 取**权威** displayName，**中心大字与登录行共用同一个值**
      —— 从结构上消除"同屏两个身份"的可能，而不是让两处各自去读各自的来源。
      未登录 / 读到失败 → **明确不可用态，不回落 mock**（与 WO#12 冻结的 identity 安全原则同源）。
  */
  const [identity, setIdentity] = useState<SessionUser | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let alive = true
    void (async () => {
      const u = await fetchMe()
      if (!alive) return
      if (!u) {
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

  /** 权威显示名（唯一来源）。未就绪时为空串，避免任何地方退回 mock。 */
  const displayName = identity?.displayName ?? ''
  /** 头像首字占位：users 表没有 avatar 列（与 WO#12/WO#13 同一冻结） */
  const avatarInitial = displayName.trim().slice(0, 1) || '?'

  return (
    <Screen
      header={
        <TopBar
          left={
            <>
              <button
                className="iconbtn"
                aria-label="菜单"
                onClick={() => setDrawerOpen(true)}
              >
                <IconMenu size={22} strokeWidth={2.2} />
              </button>
              <button className="iconbtn" aria-label="分享">
                <IconShare size={20} strokeWidth={2.2} />
              </button>
            </>
          }
          right={
            <button className="iconbtn" onClick={() => navigate('message')} aria-label="消息">
              <IconChatBubble size={22} strokeWidth={2.2} />
            </button>
          }
          variant="plain"
        />
      }
      scroll
    >
      <section className="me__profile">
        <div className="me__side me__side--left">
          {/*
            ⚠️ M5 WO#13 + 审核记录 54：这四个入口**原本全部 navigate('profile-edit')**，
               也就是把「我的兴趣 / 我的标签 / 介绍一下自己～ / 我的学校」都当成"改昵称页面"——
               这是**没有证据支持**的（审核 54：你只证明了 Me 里五个条目存在、「编辑资料」→资料编辑页）。
               冻结的处置：
                 · 条目本身**保留**（trident-me/baseline.json:38 逐字记了这五个文案与位置 → 有基线）
                 · 但**不得**再进入 ProfileEditScreen；也**不得**接到 App.tsx 里那五个旧 mock 路由
                 · 当前目的地显式记为 NOT_EVALUATED / DEFERRED，**不能再假装"我的兴趣 = 改昵称"**
               因此这里渲染为**不可点**的行，并明确标注"待核对"，而不是留一个通向错误页面的可点入口。
          */}
          <div className="me__entry me__entry--deferred" data-me-entry="interests">
            <span>我的兴趣</span>
            <span className="me__deferredTag">待核对</span>
          </div>
          <div className="me__entry me__entry--deferred" data-me-entry="tags">
            <span>我的标签</span>
            <span className="me__deferredTag">待核对</span>
          </div>
        </div>

        <div className="me__center">
          {/*
            头像：**首字占位**（users 表没有 avatar 列）。
            改前是 `me.avatar`（mock 生成的 SVG data URI）—— 与"编造的昵称"同一类问题：
            看起来像真实资料，其实是我们画的。
          */}
          <div className="me__avatar me__avatar--ph" aria-hidden data-me-avatar-placeholder>
            {phase === 'loading' ? '' : avatarInitial}
          </div>
          {/*
            昵称：`data-me-name` 是测试钩子；值来自**权威** `GET /api/auth/me`。
            ⚠️ 这里**刻意不写** `{displayName || '某个兜底名'}`：
               读不到就显示不可用态，**绝不回落 mock**（WO#14 的核心修复之一）。
          */}
          {phase === 'ready' ? (
            <h2 className="me__name" data-me-name>
              {displayName}
            </h2>
          ) : (
            <h2 className="me__name" data-me-name data-me-name-unavailable>
              {phase === 'loading' ? '加载中…' : '未登录'}
            </h2>
          )}
          {/* ⭐ 只有这一个入口指向 ProfileEditScreen（有基线支持：baseline.json:42） */}
          <button className="me__edit" data-me-entry="edit-profile" onClick={() => navigate('profile-edit')}>
            <IconEdit size={14} />
            <span>编辑资料</span>
          </button>
        </div>

        <div className="me__side me__side--right">
          <div className="me__entry me__entry--deferred" data-me-entry="bio">
            <span>介绍一下自己～</span>
            <span className="me__deferredTag">待核对</span>
          </div>
          <div className="me__entry me__entry--deferred" data-me-entry="school">
            <span>我的学校</span>
            <span className="me__deferredTag">待核对</span>
          </div>
        </div>
      </section>

      {/*
        登录状态区（M3 Slice 0B；WO#14 起身份改用**权威**来源）。
        原版不登录也能浏览（M0 基线里个人页显示的是一个本地默认账号，没有登录提示），
        所以这里**不强制**跳登录；只在未登录时给一个明确的入口。
        这个入口同时是设备 E2E 的真实 UI 路径 —— 审核记录 08 要求
        「冷启动 → 无 session → 登录入口页」必须走真实点击，而不是改 hash 或注入会话。

        ⚠️ WO#14 的关键改动：这里的名字**不再**读 `session.user.displayName`
           （那是**模块级缓存**，改完昵称不会更新），而是与中心大字**共用**同一个
           权威值 `displayName`（来自 `GET /api/auth/me`）。
           ⇒ 从结构上不可能再出现"同屏两个身份"。
        手机号仍显示（审核 56：APPROVED AS CURRENT PRODUCT BEHAVIOR；
        这是**自己的**号，与 WO#12 冻结的"他人主页不暴露 phone"不冲突；
        原版呈现方式：NOT_EVALUATED）。
      */}
      <section className="me__auth">
        {phase === 'ready' && identity ? (
          <>
            <span className="me__authWho" data-me-authwho>
              已登录 {displayName}
              {identity.phone ? ` · ${identity.phone}` : ''}
            </span>
            <button
              className="me__authBtn"
              onClick={async () => {
                await logout()
                // logout() 内部已 clearSession()（含模块级缓存）；这里只需把本地 UI 态切到"不可用"
                setIdentity(null)
                setPhase('unavailable')
              }}
            >
              退出登录
            </button>
          </>
        ) : (
          <>
            <span className="me__authWho" data-me-authwho>
              {phase === 'loading' ? '读取中…' : '未登录'}
            </span>
            <button
              className="me__authBtn me__authBtn--primary"
              onClick={() => navigate('loginselect')}
            >
              登录 Campus
            </button>
          </>
        )}
      </section>

      {/* 语音动态条（原版个人页实测存在「我的第一条语音」卡片） */}
      <section className="me__voiceRow">
        <button className="me__voiceCard" onClick={() => navigate('publish')}>
          <span className="me__voiceBar" aria-hidden>
            {Array.from({ length: 18 }).map((_, i) => (
              <i key={i} style={{ height: `${7 + ((i * 23) % 15)}px` }} />
            ))}
          </span>
          <span className="me__voiceLabel">我的第一条语音</span>
        </button>
        <div className="me__hint">
          <span className="me__hint-spark">✦</span>
          <span className="me__hint-bubble">快来试试吧～</span>
        </div>
      </section>

      {/* 记录入口：原版是「拍下眼前的风景」黑色胶囊 */}
      <section className="me__prompt">
        <button className="me__capture" onClick={() => navigate('publish')}>
          <IconImage size={17} />
          <span>拍下眼前的风景</span>
        </button>
      </section>

      {/* 左上角三横线打开的抽屉菜单（原版实测有 8 项） */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </Screen>
  )
}
