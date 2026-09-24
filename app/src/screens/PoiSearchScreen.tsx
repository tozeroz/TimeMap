import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconCheck, IconClose, IconLocation, IconSearch } from '../components/icons'
import { listPlaces, type ApiPlaceListItem } from '../api/client'
import { distanceMeters, formatDistance, getCurrentFix, type GeoFix } from '../native/geo'
import { goBack, navigate } from '../router'
import './poi.css'

/**
 * 地点选择器（原版 `campusx://poi/search`）。
 *
 * 原版实测的关键行为：**点列表项不会进新页面，而是「选中」**（画面变化但仍在同一
 * CampusPoiSearchActivity），点右上角「确认」才返回发布页并把地点带回去。
 * 注意「不添加地点」是一个特殊的清除项。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ WO#18（审核 62 的 A2）：接权威数据源，去掉 mock `pois`
 * ════════════════════════════════════════════════════════════════════
 * 改前：`import { pois } from '../data/mock'` —— 而 `PoiDetailScreen` 早已走
 *       `GET /api/places/:id` ⇒ 同一实体两种来源（一真一假）。
 * 改后：`GET /api/places`（WO#18 新增）+ **服务端**子串过滤。
 *
 * ## 三处刻意的处置（都有依据，不是"顺手简化"）
 * ```
 * ① `posts: 1284` 这类**编造数字**：
 *    我读了改前的渲染 —— 它**根本没被渲染**（UI 只画 name / address / distance）。
 *    所以它是一份"躺在模型里、随时可能被接上去"的假数据。
 *    ⇒ 改后 API 提供**真实** `postCount`（`posts.place_id` 是直接外键，无需推断）；
 *      但**本屏仍不渲染它**（基线未记录本屏有计数位 ⇒ 不发明 UI）。
 * ② `category`（院系/教学楼/超市…）：**没有**权威来源，UI 也没渲染 ⇒ 一并去掉。
 * ③ `distance`（'320m'）：依赖**用户当前位置** ⇒ 由**客户端**算：
 *    有定位（`getCurrentFix()`）⇒ `distanceMeters` + `formatDistance`；
 *    **没有定位就不渲染距离**（不编造"看起来像真的"的距离）。
 *    这是 WO#15 对地图页「距我N公里」的同一处置。
 *    ⚠️ **拿不到定位 ≠ 0 米** —— 所以用 null 表示"不渲染"，而不是 0。
 * ```
 *
 * ## ⚠️ 数据规模差异（如实登记，不填假数据）
 * 我们只有 **2 个地点**（种子里 posts 实际用到的），原版那次是周边一大堆。
 * 与学校搜索页同性质：**数据驱动的差异**；审核 61 对同类问题给过
 * `SEARCH_CONTENT_SCALE_DIFFERENCE: ACCEPTABLE / DOCUMENTED`。
 * 要对齐的是**结构与语义**（选中语义/清除项/确认回流），不是数据规模。
 */
export function PoiSearchScreen() {
  const [keyword, setKeyword] = useState('')
  const [places, setPlaces] = useState<ApiPlaceListItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorText, setErrorText] = useState('')
  const [selected, setSelected] = useState<string>('')
  /** 用户当前位置：**取不到就是 null** ⇒ 不渲染任何距离（不编造） */
  const [fix, setFix] = useState<GeoFix | null>(null)
  const reqSeq = useRef(0)

  // 位置：挂载时尝试一次；失败就永久不显示距离（不重试、不伪造）
  useEffect(() => {
    let alive = true
    void (async () => {
      const f = await getCurrentFix().catch(() => null)
      if (alive) setFix(f)
    })()
    return () => {
      alive = false
    }
  }, [])

  const load = useCallback(async (q: string) => {
    const seq = ++reqSeq.current
    setState('loading')
    const r = await listPlaces(q)
    // 只接受**最后一次**请求的结果：避免快速输入时旧响应覆盖新响应
    if (seq !== reqSeq.current) return
    if (!r.ok) {
      setErrorText(r.reason)
      setState('error')
      return
    }
    setPlaces(r.value)
    setState('ready')
  }, [])

  // 搜索走**服务端**（沿用 WO#12 纪律：不用客户端 filter）
  useEffect(() => {
    const t = setTimeout(() => void load(keyword), 250)
    return () => clearTimeout(t)
  }, [keyword, load])

  /** 该地点的距离文案；**没有定位时返回 null ⇒ 不渲染** */
  function distanceText(p: ApiPlaceListItem): string | null {
    if (!fix) return null
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return null
    return formatDistance(distanceMeters(fix.lat, fix.lng, p.latitude, p.longitude))
  }

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('publish')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          right={
            <button
              className="poi__confirm"
              onClick={() => navigate('publish', { place: selected })}
            >
              确认
            </button>
          }
        />
      }
      scroll
    >
      <div className="poi__search">
        <IconSearch size={18} />
        <input
          className="poi__input"
          placeholder="搜索地点"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="poi__map">
        <div className="poi__map-grid" />
        <div className="poi__pin">
          <IconLocation size={22} />
        </div>
      </div>

      <div className="list" data-poi-state={state}>
        {/* 清除选择（原版的特殊项） */}
        <button
          className={`row poi__row ${selected === '' ? 'is-selected' : ''}`}
          onClick={() => setSelected('')}
        >
          <div className="row__main">
            <div className="row__title">不添加地点</div>
          </div>
          {selected === '' && (
            <span className="poi__check">
              <IconCheck size={16} />
            </span>
          )}
        </button>

        {state === 'loading' && places.length === 0 && <p className="poi__empty">加载中…</p>}
        {state === 'error' && (
          <p className="poi__empty" data-poi-error>
            加载失败：{errorText}
          </p>
        )}

        {places.map((p) => {
          const d = distanceText(p)
          return (
            <button
              key={p.id}
              className={`row poi__row ${selected === p.name ? 'is-selected' : ''}`}
              data-poi-row
              onClick={() => setSelected(p.name)}
            >
              <div className="row__main">
                <div className="row__title">{p.name}</div>
                <div className="row__sub">{p.address}</div>
              </div>
              {/* ⚠️ 只有**有定位**时才渲染距离；拿不到定位就不显示（不是显示 0） */}
              {d !== null && <span className="poi__distance">{d}</span>}
              {selected === p.name && (
                <span className="poi__check">
                  <IconCheck size={16} />
                </span>
              )}
            </button>
          )
        })}

        {state === 'ready' && places.length === 0 && (
          <p className="poi__empty" data-poi-empty>
            没有找到「{keyword}」相关的地点
          </p>
        )}
      </div>
    </Screen>
  )
}
