import { useEffect, useState } from 'react'
import { DrawerPage } from '../components/Drawer'
import { IconChevronRight } from '../components/icons'
import { listSchoolColleges, listSchools } from '../api/client'
import { goBack, navigate } from '../router'
import './drawerpages.css'

/**
 * label + value 的行组件。
 *
 * ⭐ F-004（Round 319）：新增 `onClick` 与 `hook` 两个可选字段 ——
 *   因为「所在学院」要做成**点击打开 picker** 的行（不是跳路由）。
 *   ```
 *     `to`      —— 走路由（原有行为，保持不变）
 *     `onClick` —— 就地动作（如打开同页面板）
 *     `hook`    —— 给该按钮加 data-* 属性，供门禁精确定位（不靠文本匹配）
 *   ```
 */
function Rows({
  items,
}: {
  items: Array<{ label: string; value?: string; to?: string; onClick?: () => void; hook?: string }>
}) {
  return (
    <div className="dprows">
      {items.map((it) => (
        <button
          key={it.label}
          className="dprow"
          {...(it.hook ? { [it.hook]: '' } : {})}
          onClick={() => {
            if (it.onClick) return it.onClick()
            if (it.to) navigate(it.to)
          }}
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
  /* ⭐ F-004/F-006：学院 picker 的状态 */
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [colleges, setColleges] = useState<Array<{ id: string; name: string }>>([])
  const [collegeState, setCollegeState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [college, setCollege] = useState('')          // 已确认的学院
  const [draftCollege, setDraftCollege] = useState('') // 面板里待确认的选择
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      const r = await listSchools()
      if (r.ok && r.value.length > 0) {
        setSchool(r.value[0].name)
        setSchoolId(r.value[0].id)
        setSchoolState('ready')
      } else {
        setSchool(null)
        setSchoolId(null)
        setSchoolState('unavailable')
      }
    })()
  }, [])

  /*
    ⭐ F-006 的数据侧：学院列表取**权威**（后端 colleges 表，种子来自原版观察）。
    ⚠️ 取不到时**如实**说"不可用"，**不**回落成任何编造的学院名。
  */
  useEffect(() => {
    if (!schoolId) {
      if (schoolState === 'unavailable') {
        setColleges([])
        setCollegeState('unavailable')
      }
      return
    }
    void (async () => {
      const r = await listSchoolColleges(schoolId)
      if (r.ok) {
        setColleges(r.value)
        setCollegeState('ready')
      } else {
        setColleges([])
        setCollegeState('unavailable')
      }
    })()
  }, [schoolId, schoolState])

  return (
    <DrawerPage title="填写认证信息" onBack={() => goBack('me')}>
      {/*
        ⭐⭐ F-004 / F-006（审核 67 批准为「一个非常小的 closeout」）
        ═══════════════════════════════════════════════════════════════════
        审核 67 的裁定：原版「所在学院」点击后弹 **picker**，而我们只有纯文本 Row ——
        "这是**交互方式**，不是视觉……**用户操作能力不同**" ⇒ `EXPERIENCE_FIDELITY BLOCKER`。
        ⇒ 现在改为**真正的 picker**：
             点「所在学院」→ 面板（**取消 / 确认** + 学院列表 + 「没有我的学院？」）
             与 Round 319 只读 dump 到的原版面板元素**逐字对齐**。
        ⚠️ 学院数据的证据限度见 `listSchoolColleges` 的注释（**观察到的子集**，非完整表）。
        ⚠️ **就读专业 / 当前年级**保持不可交互的展示行：F-005 `NOT_EVALUATED`
           （点「就读专业」无可见反应；合理假设是"依赖已选学院"，但**未验证**）
           ⇒ **不**编造它们的 picker（那是发明交互）。
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
          /*
            学院行：可点击 ⇒ 打开 picker。`to` 不设（不走路由），改由 onClick 打开面板。
            ⚠️ 这里没有复用 Rows 的 `to` 机制，因为 picker 是**同页面板**而非新页面。
          */
          {
            label: '所在学院',
            value: college ? college : collegeState === 'loading' ? '加载中…' : '',
            onClick: () => setPickerOpen(true),
            hook: 'data-verify-college' as const,
          },
          { label: '就读专业', value: '' },
          { label: '当前年级', value: '' },
        ]}
      />

      {/*
        ⭐ 学院 picker 面板 —— 元素逐字对齐原版 dump：
           ["取消", "所在学院", "确认", <学院列表…>, "没有我的学院？"]
      */}
      {pickerOpen && (
        <div className="vpick" data-verify-college-picker>
          <div className="vpick__mask" onClick={() => setPickerOpen(false)} />
          <div className="vpick__panel">
            <div className="vpick__head">
              <button className="vpick__btn" onClick={() => setPickerOpen(false)}>
                取消
              </button>
              <span className="vpick__title">所在学院</span>
              <button
                className="vpick__btn vpick__btn--primary"
                data-verify-college-confirm
                onClick={() => {
                  setCollege(draftCollege)
                  setPickerOpen(false)
                }}
              >
                确认
              </button>
            </div>
            <div className="vpick__list no-scrollbar">
              {collegeState === 'loading' && <p className="vpick__hint">加载中…</p>}
              {collegeState === 'unavailable' && (
                <p className="vpick__hint" data-verify-college-unavailable>
                  学院列表不可用（未能从后端取到）
                </p>
              )}
              {colleges.map((c) => (
                <button
                  key={c.id}
                  className={`vpick__item ${draftCollege === c.name ? 'is-active' : ''}`}
                  onClick={() => setDraftCollege(c.name)}
                >
                  {c.name}
                </button>
              ))}
              {/*
                ⚠️ 「没有我的学院？」是原版 dump 里**确实存在**的入口，
                   但其**后继流程未观察**（我们不知道点它会发生什么）
                   ⇒ 这里只如实呈现，点击给出明确说明，**不假装**能提交/认证。
              */}
              <button
                className="vpick__item vpick__item--alt"
                data-verify-college-missing
                onClick={() =>
                  setNotice('「没有我的学院？」的后续流程未观察，本 demo 未接入，无法继续。')
                }
              >
                没有我的学院？
              </button>
            </div>
          </div>
        </div>
      )}

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

/**
 * 版本信息（抽屉条目「版本信息」；原版该条目**已由 Round 318 只读观察确认存在**）。
 *
 * ⚠️⚠️ Round 319（A5 机械切片外溢发现）：本页改前有**两处不实信息**
 * ```
 *   ① <div className="dpcard__version">v2.10.0</div>   ← **编造的版本号**（无任何出处）
 *      ⚠️ `docs/original-baseline/screens/` 的 24 个基线目录里**没有**本屏
 *         ⇒ 原版「版本信息」页的**内容/版本号从未被观察** ⇒ `ORIGINAL_VERSION_INFO_PAGE: NOT_EVALUATED`
 *   ② <p>本 demo 为本地复刻版本，**数据全部为 mock，无任何网络请求**。</p>
 *      ← **与事实不符**：应用现在处处走自建后端 API，mock.ts 也已整体退出现代代码
 * ```
 * ⇒ 处置：删掉编造版本号（改为如实说明"版本信息不可用"）、把那句笼统断言改成如实描述。
 * ⚠️ 教训（与 MoreScreen 同类）：**界面陈述会随时间变成假话** ——
 *    不要在 UI 里写"全部/无/纯"这类绝对化断言。
 */
export function AboutScreen() {
  return (
    <DrawerPage title="版本信息" onBack={() => goBack('me')}>
      <div className="dpcard dpcard--center">
        <div className="dpcard__brand">Campus</div>
        {/*
          ⚠️ 刻意**不**写版本号：原版本页的内容与版本号**未观察**，写任何一个具体值都是编造。
        */}
        <div className="dpcard__version" data-version-unavailable>
          版本信息不可用
        </div>
        <p className="dpcard__desc">
          本 demo 数据来自自建后端 API；未实现的能力会在对应页面如实标注。
        </p>
        {/* 「检查更新」只是打开升级弹窗（该弹窗现已如实说明"更新流程未接入"），不声称更新成功 */}
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
