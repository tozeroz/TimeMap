import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { useToast, Toast } from '../components/TmPostCard'
import { getSession, updateProfile } from '../data/tmStore'
import { goBack } from '../router'

/**
 * 编辑资料（F01 账号资料）：
 * 只收集低敏字段（昵称 / 学院 / 年级 / 一句话介绍），
 * 不涉及手机号、学号、身份证等敏感信息（合规要求）。
 */
export function ProfileEditScreen() {
  const session = getSession()
  const profile = session?.profile
  const [name, setName] = useState(profile?.name ?? '')
  const [college, setCollege] = useState(profile?.college ?? '')
  const [grade, setGrade] = useState(profile?.grade ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [toast, showToast] = useToast()

  if (!profile) return null

  function save() {
    if (!name.trim()) {
      showToast('昵称不能为空')
      return
    }
    updateProfile({
      name: name.trim().slice(0, 12),
      college: college.trim().slice(0, 24),
      grade: grade.trim().slice(0, 16),
      bio: bio.trim().slice(0, 60),
    })
    showToast('资料已更新')
    goBack('me')
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
          center="编辑资料"
          right={
            <button className="tpe__save" onClick={save}>
              保存
            </button>
          }
        />
      }
    >
      <section className="tpe__card">
        <label className="tpe__field">
          <span className="tpe__label">昵称</span>
          <input className="tpe__input" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} />
        </label>
        <label className="tpe__field">
          <span className="tpe__label">学院</span>
          <input
            className="tpe__input"
            value={college}
            onChange={(e) => setCollege(e.target.value)}
            placeholder="如：计算机与信息技术学院"
            maxLength={24}
          />
        </label>
        <label className="tpe__field">
          <span className="tpe__label">年级</span>
          <input
            className="tpe__input"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="如：本科三年级"
            maxLength={16}
          />
        </label>
        <label className="tpe__field">
          <span className="tpe__label">一句话介绍</span>
          <textarea
            className="tpe__input tpe__input--area"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="让同学更快认识你（选填）"
            maxLength={60}
          />
        </label>
      </section>
      <p className="tpe__note">仅收集展示所需的最少信息；不采集手机号、学号、身份证或真实密码。</p>
      <Toast msg={toast} />
    </Screen>
  )
}
