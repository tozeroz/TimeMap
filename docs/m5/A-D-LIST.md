# M5 的 A/D 清单（差异与缺陷汇总）

> 建立于 2026-09-21 18:47，起因：审核记录 25 要求把新发现的 deviation
> `CHAT_MESSAGE_SENDER_PRESENTATION` 登记进"M5 后续 A/D 清单"，而当时**并不存在**这个清单。
> 本文件即该清单，用来把散落在各 finding / 审核记录里的差异**汇总到一处**，
> 避免同一个差异在多个文档里各说各话、或修好一个忘另一个。

## 分类口径（沿用本项目既有）

| 标记 | 含义 |
|---|---|
| `DEVIATION` | 与原版有真实差异，**尚未修**（已确认存在） |
| `FIXED` | 差异已被修复（附证据） |
| `BLOCKED_BY_POLICY` | 需要写操作才能取证 → **禁止执行**，如实记为此状态（**不是"未做"**） |
| `WITHDRAWN` | 曾经登记过，后来被证据**推翻**（保留以便追溯我错在哪） |
| `NOT_EVALUATED` | 观察不足，尚不能判定（**不等于 PASS**） |

---

## 一、差异清单

### 1. `CHAT_MESSAGE_SENDER_PRESENTATION` — **DEVIATION**（新登记）

```
observed: 自己发的图片消息渲染在左侧 peer 气泡里
来源:     WO#2 前端实现时发现（既有渲染逻辑，非本工作单引入）
审核裁定: 审核记录 25 —— "这是真实产品问题，但不是本工作单引入的"，
          应进入 M5 后续 A/D 清单，**不把 WO#2 无限扩张**
说明:     "我的消息 / 对方消息的布局区分"属于更一般的 chat presentation semantic，
          需要先只读观察原版在这方面的表现，再决定实现（**不要凭感觉加区分**）
```

### 2. 底部 tab 数量与「校园广场」的呈现模型 — **DEVIATION**

```
observed: 原版底部是 4 项（校园广场 / <账号昵称> / 校园 / 地图），我们只有 3 项
证据:     docs/original-baseline/raw-dumps/board-observation-1.xml
补充:     该 tab 指向的页面**不是列表式 feed，而是拼贴照片墙（collage）**：
          collageView + view_image_container + view_user_tag（图片上的作者标签）
性质:     不只是"少一个 tab"，而是**该 tab 的呈现模型本身就不同**
未确证:   交互模型（点单图去哪 / 标签是否可点 / 是否分页）**尚未确证**，需新的只读观察
```

### 3. 留言板表情行 — 四项

| 子项 | 状态 | 说明 |
|---|---|---|
| 项数 / 宽 / pitch / 首末边界 | **FIXED** | 6 项、70 / 112（设备 px）逐项与原版吻合；CSS 40px + gap 24px，设备实测确认 |
| 底色（C5） | **FIXED** | 原版无底色（像素采样圆内点亦纯白）；我们原有灰色圆片 → 已改为 transparent |
| 字号（C6） | **FIXED** | 16px → 24px（据实心字形墨迹外接的**直接测量**；估计值，残余不确定已标注） |
| **字符与形态（C4）** | **DEVIATION** | 原版是**图片**（`emotion_image`），我们用**文字 emoji** → 实现方式待审核裁定（复刻 6 个图标图像 vs 先做 image-based structure） |

### 4. 留言板下拉刷新（C3） — **BLOCKED_BY_POLICY**

```
原因: 该断言需要**非空留言板**才能评估；而造非空必须**发留言＝写操作＝用户明令禁止**
      或依赖"原版账号恰好已有留言"这一我们无法控制的条件
已做的合规尝试: 空态下一次安全区下拉手势（无可观察变化，**不足以判定**）
Gate 口径: 记 BLOCKED_BY_POLICY（**不是**"未做"、**不是**"通过"、**不是**"失败"）
```

### 5. 留言板顶部按钮（C1）/ 留言总数（C2） — **WITHDRAWN**

```
C1 原判: 缺返回按钮（原版有返回+关闭两个）
  实测:   ivClose 的 bounds 完全落在 iv_back 内部、且 ivClose clickable=false
          → 很可能是"一个可点击容器 + 内部图标"，**不是两个按钮**
C2 原判: 缺留言总数
  实测:   tvTotalComment 的可见文本就是标题「留言」，不是计数
证据:   docs/original-baseline/raw-dumps/board-ivback-{before,after}.xml
教训:   **不要把 resource-id 的名字当成行为 contract**（我照名字写结论才错这两条）
```

---

## 二、汇总结论（当前）

```
已修:   表情行几何（项数/宽/pitch/边界）、底色、字号
成立:   C4 表情形态（图片 vs 文字）—— 待裁定实现方式
成立:   CHAT_MESSAGE_SENDER_PRESENTATION（自己消息渲染在 peer 气泡）
成立:   底部 tab 4 vs 3 + 校园广场的 collage 呈现模型
阻断:   C3 下拉刷新（BLOCKED_BY_POLICY）
撤销:   C1 顶部按钮、C2 留言总数（被只读观察推翻）
```

## 三、维护规则

1. **每修掉一项就更新本表**（把 `DEVIATION` 改成 `FIXED` 并附证据），不要只改 finding 文档
2. **撤销的项保留**（`WITHDRAWN`），并写清"我原来错在哪" —— 这个项目里错误的判断链比结论更有教学价值
3. 新增项必须带 `raw_evidence`（可复核产物），否则只能进"线索"不能进本表
