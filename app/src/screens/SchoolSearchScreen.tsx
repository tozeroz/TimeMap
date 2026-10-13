import { useEffect, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconSearch } from '../components/icons'
import { listSchoolCampuses, listSchools, type ApiSchool, type ApiCampus } from '../api/client'
import { goBack } from '../router'
import './schoolsearch.css'

/**
 * 学校搜索页（WO#16 层 B；审核 61 批准）—— 对应原版的「搜索选择学校」独立页。
 *
 * ## 基线依据（docs/test/original-baseline/supplements/schools.json 的 school_search）
 * ```
 * 搜索框 placeholder：「搜索选择学校...」+ 取消
 * 分组标题：「更多学校」
 * **行格式：「学校名 (校区名)」+ 右侧「N条校园圈」+ 可选「X小时前更新」**
 * 实例：上海视觉艺术学院 (校本部) 15条校园圈 ／ 上海交通大学 (闵行校区) … 2502条校园圈 …
 * activity：com.xingin.xhsreactnative.ui.XhsReactActivity
 * ```
 *
 * ## 与基线**刻意不同**的两点（都是数据驱动，且已获批登记）
 * 1. **内容规模**：我们只有 1 所学校（种子），原版那次快照里有 4+ 所。
 *    依据：审核 61 `SEARCH_CONTENT_SCALE_DIFFERENCE: ACCEPTABLE / DOCUMENTED`
 *    —— **不**为了"看起来丰富"去种原版的学校与它们的 2502/329/15 这类计数。
 * 2. **计数**：`campusCircleCount` 为 `null` 时**不渲染计数**。
 *    依据：审核 60 的计数策略 A —— null 表示"无法由权威归属计算"，**不是 0**；
 *    显示"0条校园圈"会把"不知道"说成"没有"。审核建议"计数字段干脆不渲染"。
 *    （原版**对 0 条校园圈显示什么**我们未观察 ⇒ `ORIGINAL_EMPTY_CIRCLE_PRESENTATION: NOT_EVALUATED`）
 */
export function SchoolSearchScreen() {
  const [schools, setSchools] = useState<ApiSchool[]>([])
  const [campuses, setCampuses] = useState<ApiCampus[]>([])
  const [keyword, setKeyword] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')
  /** 归属机制是否已建立（false ⇒ 所有计数为 null ⇒ 本页不渲染计数） */
  const [attrEstablished, setAttrEstablished] = useState<boolean | null>(null)

  useEffect(() => {
    void (async () => {
      setState('loading')
      const sr = await listSchools()
      if (!sr.ok) {
        setErr(sr.reason)
        setState('error')
        return
      }
      setSchools(sr.value)
      // 取第一所学校的校区（我们只有 1 所；接口形状本身是 School 1→N Campus）
      const first = sr.value[0]
      if (!first) {
        setCampuses([])
        setAttrEstablished(false)
        setState('ready')
        return
      }
      const cr = await listSchoolCampuses(first.id)
      if (!cr.ok) {
        setErr(cr.reason)
        setState('error')
        return
      }
      setCampuses(cr.value.items)
      setAttrEstablished(cr.value.attributionCoverageComplete)
      setState('ready')
    })()
  }, [])

  const q = keyword.trim()
  const rows = schools.flatMap((s) =>
    campuses
      .filter((c) => (q ? s.name.includes(q) || c.name.includes(q) : true))
      .map((c) => ({ school: s, campus: c })),
  )

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          right={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="取消">
              取消
            </button>
          }
        />
      }
      scroll
    >
      <div className="ss__search">
        <IconSearch size={17} />
        <input
          className="ss__input"
          placeholder="搜索选择学校..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          autoFocus
        />
      </div>

      {state === 'loading' && <p className="ss__hint">加载中…</p>}
      {state === 'error' && (
        <div className="ss__empty">
          <p>网络错误</p>
          <p className="ss__hint">{err}</p>
        </div>
      )}
      {state === 'ready' && rows.length === 0 && (
        <div className="ss__empty">
          <p>{q ? '没有找到「' + q + '」相关的学校' : '暂无可选学校'}</p>
        </div>
      )}
      {state === 'ready' && rows.length > 0 && (
        <>
          <p className="ss__group" data-school-search-group>
            更多学校
          </p>
          <ul className="ss__list" data-school-search-list>
            {rows.map(({ school, campus }) => (
              <li key={campus.id}>
                <button className="ss__row" data-school-row>
                  {/* 行格式**逐字**照基线：「学校名 (校区名)」 */}
                  <span className="ss__name">
                    {school.name} ({campus.name})
                  </span>
                  {/*
                    ⭐ 计数只在**权威可算**时渲染（见文件头说明）。
                    当前 attributionCoverageComplete=false ⇒ 这里**不渲染**，
                    而不是显示"0条校园圈"。
                  */}
                  {campus.campusCircleCount !== null && (
                    <span className="ss__count" data-school-row-count>
                      {campus.campusCircleCount}条校园圈
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {attrEstablished === false && (
            <p className="ss__hint" data-school-count-unavailable>
              校园圈动态数暂不可用（尚无可信的校区归属）
            </p>
          )}
        </>
      )}
    </Screen>
  )
}
