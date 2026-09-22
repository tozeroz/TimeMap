import { useEffect, useState } from 'react'
import { DrawerPage } from '../components/Drawer'
import { IconChevronRight } from '../components/icons'
import { listSchools } from '../api/client'
import { goBack, navigate } from '../router'
import './drawerpages.css'

function Rows({ items }: { items: Array<{ label: string; value?: string; to?: string }> }) {
  return (
    <div className="dprows">
      {items.map((it) => (
        <button
          key={it.label}
          className="dprow"
          onClick={() => it.to && navigate(it.to)}
        >
          <span className="dprow__label">{it.label}</span>
          <span className="dprow__value">{it.value ?? ''}</span>
          <IconChevronRight size={15} />
        </button>
      ))}
    </div>
  )
}

export function AccountScreen() {
  return (
    <DrawerPage title="账号与安全" onBack={() => goBack('me')}>
      <Rows
        items={[
          { label: '手机号', value: '132****2969' },
          { label: '微信', value: '已绑定' },
          { label: 'QQ', value: '未绑定' },
          { label: '修改密码', to: 'privacy' },
          { label: '注销账号' },
        ]}
      />
    </DrawerPage>
  )
}

/**
 * 校园认证（原版 `com.xingin.xhsreactnative.ui.XhsReactActivity`）。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ WO#20（F-003；审核 65 明确范围）：这是**表单页**，不是状态卡
 * ════════════════════════════════════════════════════════════════════
 * 原版**实测**（Round 318 有界只读观察：抽屉 → 校园认证 → uiautomator dump + bounds）：
 * ```
 *   标题「填写认证信息」                      ← **不是**「校园认证」（那是抽屉条目的名字）
 *   「就读学校」 = 北京交通大学               [187,638] / [697,638]
 *   「所在学院」 （空）                        [187,834]
 *   「就读专业」 （空）                        [187,1030]
 *   「当前年级」 （空）                        [187,1226]
 *   按钮「下一步」                            [498,1456][582,1498]
 * ```
 * 改前我们的实现（**几乎全是编的**）：
 * ```
 *   标题「校园认证」／「未认证」卡片 ／ desc「完成学生认证后可解锁校园广场发帖、同校推荐等能力。」
 *   按钮「去认证」→ navigate('board')  ← **错跳留言板**
 *   Rows「认证方式 = 学生证 / 校园卡」「认证状态 = 待认证」
 * ```
 * ⇒ 已按审核 65 改为**表单形态**，并删除上面那些**编造**的状态卡与文案。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐ 一处我们**可以**比原版观察做得更实的地方：「就读学校」接**权威**数据
 * ════════════════════════════════════════════════════════════════════
 *   原版那格显示「北京交通大学」（它来自该账号绑定的学校）。
 *   而我们自己后端**已有** `GET /api/schools`（WO#16 层 B 种的实体）
 *   ⇒ 这一格改为取权威值，**不硬编码**；取不到时**留空并说明**（不编造学校名）。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 两处**刻意不做**的事（都写在代码里，避免日后被误解为漏做）
 * ════════════════════════════════════════════════════════════════════
 *   ① **「下一步」不假装成功**（审核 65 原话："我们自己的 demo **不能假装认证成功**"）：
 *      该按钮在原版里会推进真实认证流程 = **写操作** ⇒ 按只读约束属
 *      `BLOCKED_BY_POLICY` ⇒ 这里点它只显示**明确的"未实现/无法继续"说明**，
 *      绝不跳转、绝不显示"认证成功"、绝不写入任何东西。
 *   ② **不实现真正的提交**：没有权威的认证后端，也没有真实学生证/校园卡校验。
 *      `认证状态` 之类字段我们**没有**权威来源 ⇒ 不显示（不编造）。
 *      若要显示状态，需先有权威来源或被批准的 KNOWN_DEVIATION。
 */
export function VerifyScreen() {
  const [school, setSchool] = useState<string | null>(null)
  const [schoolState, setSchoolState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void (async () => {
      const r = await listSchools()
      if (r.ok && r.value.length > 0) {
        setSchool(r.value[0].name)
        setSchoolState('ready')
      } else {
        setSchool(null)
        setSchoolState('unavailable')
      }
    })()
  }, [])

  return (
    <DrawerPage title="填写认证信息" onBack={() => goBack('me')}>
      {/*
        ⚠️ 字段呈现的证据限度（如实标注）：
          dump 只给了「label + value + bounds」，**没有**告诉我们那几行是"可输入的输入框"
          还是"带箭头的选择行"（学院/专业/年级在原版是空的，看不出控件类型）。
        ⇒ 这里沿用本项目既有的 Rows 形态（label + value），**不发明**输入控件类型；
          要精确对齐需再做一次只读观察（点开其中一行看是否有选择器/键盘）。
      */}
      <Rows
        items={[
          {
            label: '就读学校',
            value:
              schoolState === 'ready' && school
                ? school
                : schoolState === 'loading'
                  ? '加载中…'
                  : '未获取到（学校数据不可用）',
          },
          { label: '所在学院', value: '' },
          { label: '就读专业', value: '' },
          { label: '当前年级', value: '' },
        ]}
      />

      <div className="dpcard">
        {/*
          ⭐ 审核 65："'下一步'后续流程由于涉及真实认证写操作，仍保持 BLOCKED_BY_POLICY /
             NOT_EVALUATED；我们自己的 demo 不能假装认证成功。"
          ⇒ 点它只给明确说明，不跳转、不写入、不显示成功。
        */}
        <button
          className="dpcard__btn"
          data-verify-next
          onClick={() =>
            setNotice('下一步的认证流程涉及真实身份核验与写入，本 demo 未接入，无法继续。')
          }
        >
          下一步
        </button>
        {notice && (
          <p className="dpcard__desc" data-verify-notice>
            {notice}
          </p>
        )}
      </div>
    </DrawerPage>
  )
}

export function PrivacyScreen() {
  return (
    <DrawerPage title="隐私设置" onBack={() => goBack('me')}>
      <Rows
        items={[
          { label: '谁可以看到我的动态', value: '同校同学' },
          { label: '允许通过手机号找到我', value: '已关闭' },
          { label: '个性化推荐', value: '已开启' },
          { label: '地理位置', value: '使用时允许' },
        ]}
      />
    </DrawerPage>
  )
}

export function BlacklistScreen() {
  return (
    <DrawerPage title="黑名单" onBack={() => goBack('me')}>
      <div className="dpempty">黑名单为空</div>
    </DrawerPage>
  )
}

export function AboutScreen() {
  return (
    <DrawerPage title="版本信息" onBack={() => goBack('me')}>
      <div className="dpcard dpcard--center">
        <div className="dpcard__brand">Campus</div>
        <div className="dpcard__version">v2.10.0</div>
        <p className="dpcard__desc">本 demo 为本地复刻版本，数据全部为 mock，无任何网络请求。</p>
        <button className="dpcard__btn" onClick={() => navigate('upgrade')}>
          检查更新
        </button>
      </div>
    </DrawerPage>
  )
}

export function ContactScreen() {
  return (
    <DrawerPage title="联系我们" onBack={() => goBack('me')}>
      <Rows
        items={[
          { label: '客服邮箱', value: 'support@campus.demo' },
          { label: '意见反馈', to: 'board' },
          { label: '用户协议' },
          { label: '隐私政策' },
        ]}
      />
    </DrawerPage>
  )
}
