import { useState } from 'react'
import { logout } from '../api/client'
import { getSession } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { Drawer } from '../components/Drawer'
import {
  IconChatBubble,
  IconChevronRight,
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
          <button className="me__entry" onClick={() => navigate('profile-edit')}>
            <span>我的兴趣</span>
            <IconChevronRight size={14} />
          </button>
          <button className="me__entry" onClick={() => navigate('profile-edit')}>
            <span>我的标签</span>
            <IconChevronRight size={14} />
          </button>
        </div>

        <div className="me__center">
          <img className="me__avatar" src={me.avatar} alt="" />
          <h2 className="me__name">{me.name}</h2>
          <button className="me__edit" onClick={() => navigate('profile-edit')}>
            <IconEdit size={14} />
            <span>编辑资料</span>
          </button>
        </div>

        <div className="me__side me__side--right">
          <button className="me__entry" onClick={() => navigate('profile-edit')}>
            <span>介绍一下自己～</span>
            <IconChevronRight size={14} />
          </button>
          <button className="me__entry" onClick={() => navigate('profile-edit')}>
            <span>我的学校</span>
            <IconChevronRight size={14} />
          </button>
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
