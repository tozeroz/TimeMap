import { useState } from 'react'
import { logout } from '../api/client'
import { getSession } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { Drawer } from '../components/Drawer'
import {
  IconChatBubble,
  IconEdit,
  IconImage,
  IconMenu,
  IconShare,
} from '../components/icons'
import { me } from '../data/mock'
import { navigate } from '../router'
import './me.css'

/** 个人页：对齐原版 —— 纯白底、无多余模块，中部只有「拍下眼前的风景」+ 提示气泡 */
export function MeScreen() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [session, setSession] = useState(() => getSession())

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
          <img className="me__avatar" src={me.avatar} alt="" />
          <h2 className="me__name">{me.name}</h2>
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
        登录状态区（M3 Slice 0B）。
        原版不登录也能浏览（M0 基线里个人页显示的是一个本地默认账号，没有登录提示），
        所以这里**不强制**跳登录；只在未登录时给一个明确的入口。
        这个入口同时是设备 E2E 的真实 UI 路径 —— 审核记录 08 要求
        「冷启动 → 无 session → 登录入口页」必须走真实点击，而不是改 hash 或注入会话。
      */}
      <section className="me__auth">
        {session ? (
          <>
            <span className="me__authWho">
              已登录 {session.user.displayName}
              {session.user.phone ? ` · ${session.user.phone}` : ''}
            </span>
            <button
              className="me__authBtn"
              onClick={async () => {
                await logout()
                setSession(getSession())
              }}
            >
              退出登录
            </button>
          </>
        ) : (
          <>
            <span className="me__authWho">未登录</span>
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
