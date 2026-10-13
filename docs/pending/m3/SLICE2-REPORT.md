# M3 Slice 2 报告：点赞

> 依据：审核记录 09（Slice 2 GO + 前置政策：**不得在原版上点 Like**）
> 完成时间：2026-09-21（Asia/Shanghai）
> Gate：`scripts/gates/m3/slice0b.ps1` 第 6.6 组 → **M3_SLICE2_GATE_RESULT: PASS**

## 一、结论

```
M3_SLICE2_GATE_RESULT: PASS
  LIKE_TOGGLE_IDEMPOTENT:        PASS
  LIKE_CROSS_USER_ISOLATION:     PASS
  LIKE_COUNT_HIDDEN_WHEN_ZERO:   PASS（与原版只读观察一致）
  COMMENT_COUNT_ZERO_SHOWS_WORD: PASS（与原版只读观察一致）
  LIKE_TOGGLE_EVIDENCE:          BLOCKED_BY_POLICY（原版禁止取证；仅自建系统验证，不声称 1:1）

后端 LIKES_RESULT PASS（26 条断言）
设备端 SLICE2_DISPLAY ×2 / SLICE2_AUTHGATE 全 PASS
```

## 二、取证边界（这一节是本切片最重要的部分）

审核记录 09 的明确前置政策：**不得为了观察点赞/取消而在原版第三方系统上点 Like**。
我按此执行，并在动手前先把边界写成表（`docs/pending/POLICY-VIOLATION-2026-09-21.md` 第 7 节）。

### 原版侧：只读观察到的事实（`supplements/slice2-likes-readonly.json`）

| 事实 | 证据 |
|---|---|
| 点赞区整体是热区 | `post_like_section` LinearLayout 且 `clickable=true`，[869,1780][936,1857] |
| 图标左、计数右；计数**纯数字无单位** | `post_like_icon` 42×42；`post_like_count` text='1' |
| **0 赞时计数控件不存在** | 0 赞帖子的 dump 里根本没有 `post_like_count` 节点，且热区宽度从 67 缩到 42 |
| 评论数 0 时显示**文字「评论」** | 无评论动态的 `num_comment` 文本为「评论」；有 1 条时为 '1' |
| 没有「谁点了赞」的列表 | 详情页点赞区附近无头像/昵称 |
| 存在点赞动画覆盖层 | `like_animation_view` [0,0][1080,1085] → **`LIKE_ANIMATION_CAPABILITY: OBSERVED`**（只证明存在相关 view 结构）；**`LIKE_ANIMATION_TRANSITION: BLOCKED_BY_POLICY`**（不能凭节点断言"点击时一定播动画"） |

### 原版侧：**禁止**取证的部分（BLOCKED_BY_POLICY）

- 点赞的**切换行为**（点一下会发生什么、能否取消、取消后反馈）
- **已点赞态的样式**（图标是否变实心/变色）

理由：两者都必须"点赞"才能产生，而点赞是写操作。
连"点一下看 UI 反馈"也不做 —— 对写操作来说，**点击就是执行**。

因此本切片**不声称**切换行为与已点赞态与原版 1:1 一致；
这两项只在本自建系统里验证（后端 26 条断言 + 设备端 3 组用例）。

## 三、实现

### 接口

```
POST   /api/posts/:id/like   幂等（on conflict do nothing）→ {liked, likeCount, likedByMe}
DELETE /api/posts/:id/like   幂等
GET    /api/posts/:id        + likeCount + likedByMe（可选会话：未登录不查库、恒 false）
GET    /api/posts           每条 + likeCount / commentCount / likedByMe
```

### 前端（两条展示规则，分别实现）

- 点赞数 **0 → 不渲染计数**（只留图标，热区随之变窄）；>0 → 纯数字
- 评论数 **0 → 显示「评论」二字**；>0 → 显示数字（含回复）

> 这两条规则**不一样**，很容易写成一个"有就显示数字"的逻辑。
> 它们分别有独立断言，避免以后被顺手合并。

前端**不本地加减**：点完用服务端返回的权威计数覆盖本地状态。
原版的切换行为取不到证据，与其猜"点一下数字怎么变"，不如让服务端给权威值 ——
同时也顺带满足了 M1 冻结的"写失败绝不本地假成功"。

## 四、验证

### 后端 `scripts/m3/verify-likes.sh`（26 条断言，LIKES_RESULT PASS）

关键几条：

- **跨用户隔离**：seed 里别人点过 2 个赞，带我的会话读详情时 `likeCount=2` 但 `likedByMe=false`
  —— 别人的赞不会被算成我的（这条最容易被实现错）
- 鉴权：未登录 POST/DELETE → 401
- 幂等：重复点赞计数不重复增加、DB 仍只有 1 行；重复取消同样幂等
- 隔离：点赞不会串到另一篇帖子
- 错误输入：非法 id → 400、不存在的帖子 → 404
- 清理：点赞表回到 seed 状态、测试账号的赞清零

### 设备端 `scripts/m3/device-slice2.mjs`

- p1（DB: likes=2 comments=2）→ UI 显示「2」纯数字 + 评论「2」
- p2（DB: likes=0 comments=0）→ UI **不渲染点赞计数** + 评论显示「评论」
- 未登录点赞 → 跳登录页；**回到详情后计数仍为 2、点赞态未变**（无本地假成功）

三条都与**数据库权威值**做过比对（期望值由编排脚本从 DB 读出后传入）。

## 五、本轮 Gate 抓出的两个缺陷（都是测试侧）

1. **DB 计数探针的引号被三层解析吃掉**（GATE_DEFECT）
   在 Gate 里内联一段带嵌套引号的 shell，经 PowerShell → ssh → bash 后引号丢失，
   psql 报错，拿到 `likes=-c:` 这种垃圾数据 → Slice 2 被**误判成 FAIL**。
   修法：改成 `scripts/m3/counts.sh`（文件 + base64 传输，本项目已验证可靠的路径），
   并加一条"解析失败即 FAIL"的自检 —— 不允许用垃圾数据继续判断。

2. **测试用"点击前 vs 当前"比状态**（GATE_DEFECT）
   未登录点赞会跳转到登录页，此时详情页已不在，读到 null → 误报"状态被改了"。
   修法：**回到详情页再读一次**，与服务端权威值比对。
   这与 Slice 1 的教训同类：**断言的基准必须是被测对象真实存在的状态**。

## 六、证据

| 文件 | 内容 |
|---|---|
| `docs/pending/m3/evidence/likes-*.txt` | 后端 26 条断言输出 |
| `docs/pending/m3/evidence/gate-slice2-*.txt` | 完整 Gate（含 Slice 2 组） |
| `docs/test/original-baseline/supplements/slice2-likes-readonly.json` | 原版只读观察（含 BLOCKED_BY_POLICY 登记） |
| `scripts/m3/verify-likes.sh`、`scripts/m3/device-slice2.mjs`、`scripts/m3/counts.sh` | 断言脚本 |
