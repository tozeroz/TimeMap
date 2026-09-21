# 审核提交 28：WO#3（气泡方向）已完成并真机验证

> 提交时间：2026-09-21 21:09｜审核方：ChatGPT web
> 提交内容与**待裁定事项**如下；裁定结果回来后应另写一份记录。

## 一、提交的核心结论

```
CHAT_MESSAGE_SENDER_PRESENTATION: **FIXED / VERIFIED**
commit c9d7a7d（已 push）
```

## 二、实现（只改接线，未动 CSS）

- `app/src/screens/ChatScreen.tsx`（+43/−15，唯一产品代码改动）
  `senderId === getSession()?.user?.id` → 选 `--me`/`--peer`；
  **`meId` 为 `null` 时 `mine` 恒 false → 降级 `--peer`**（不把所有人当成我）
- `app/src/screens/chat.css` —— **未改**：`.chat__row--me { flex-direction: row-reverse }`
  早已在 `chat.css:15`（真机 computed style 实测生效）→ 未加重复规则

## 三、真机断言（**实际几何**，非类名）

视口 **618×1074 CSS px**，dpr 1.75（= 1080 物理宽）；判定门槛 `0.4 × 618 = 247.2`

```
[我 ] bubble.left=456.3 (73.8%) right=602.3  flex=row-reverse  "你也在图书馆吗？"
[对方] bubble.left=16.0  (2.6%)  right=162.0  flex=row          "在四楼靠窗这边。"
[我 ] bubble.left=386.1 (62.5%) right=602.3  flex=row-reverse  （本轮新 POST）
→ DEVICE_CHAT_SENDER_ALIGN PASS
```

其余：与原版 `…-scroll-newer.png` 并排比对一致；`M5_SERVER_GATE_RESULT` 仍 PASS；
测试消息按 id 精确删除（未造 media），`cleanup.mjs` orphans/unattached 空。

## 四、实现者做的三点**超出委派规格**的事（已沉淀进 `PLAN.md`）

1. **选样本时排除"同样错误的替代实现"**：只在"只有我发的消息"的会话里验证，
   "自己发的靠右"与"**所有消息都靠右**"无法区分（后者同样错）。
   它因此把判据改为"**同时有我发的和对方的**"，并**拒绝了委派方建议的空会话**。
2. **断言依据不来自被测对象的新增产物**：从**服务端** `/api/auth/me` 与消息列表取 `senderId`，
   不用刚加的类名自证（否则类名判反也照样 PASS）。
3. **门禁看增量**：HEAD~1 版单独跑 lint 得 2 warnings、当前版也是 2 → 证明未新增警告。

## 五、如实披露的未覆盖项

- **降级路径（`meId === null`）真机不可达**：未登录进 `#/chat/:id` 直接进错误态、不渲染消息行
  → 该分支**仅由源码保证，无运行时证据**
- 实现者第一版降级探针**是错的**（只清 `localStorage` 未 reload，模块级 cache 仍在 → 误报 FAIL）
- **清理范围略宽于本轮产生**：按 `user_id=Lemy` / `phone` 删 sessions / login_challenges 各命中 2 条，
  其中可能各 1 条非本轮产生（旧 token 失效可重登）

## 六、同时提交的另一项变更：**tab deviation 撤销**

原登记"原版底部 tab 4 项、我们 3 项"是**误数** ——
看 bounds 才知「校园广场」在**顶部区**(y≈130)、三个 tab 在底部区(y≈1829)。
更正后四项逐项与原版一致（3 个文字 tab / 圆形 FAB 发布按钮 / 两列瀑布流 / 顶部 switcher）。
已同步三处文档。

## 七、待裁定的四件事（本次提交的）**

1. WO#3 是否可记为 **CLOSED**（含"降级路径真机不可达"这一未覆盖项）
2. **C4** 是否要我按 `original-chat/INDEX.md` §四 的配方做一次**表情相关**的资源名提取
   （判读方式已预先写好，避免事后凑标准；且即便提到资源名也不能单独定论）
3. `force-stop` 规则严格度（旧问题）
4. "测试期望应从权威数据源推导"纪律（旧问题）

## 八、当前 M5 差异账本

```
tab deviation                    → 撤销
CHAT_MESSAGE_SENDER_PRESENTATION → FIXED / VERIFIED
C4 表情形态                       → UNRESOLVED + FREEZE
```
