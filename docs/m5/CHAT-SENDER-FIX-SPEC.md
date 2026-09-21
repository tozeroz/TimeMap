# 实现规格：`CHAT_MESSAGE_SENDER_PRESENTATION` 的接线级修复（待执行）

> 判定已完成（`docs/m5/CHAT-SENDER-PRESENTATION-CONFIRMED.md`）：**偏差成立**，
> 原版自己发的消息靠右（气泡 x=[625,975]、头像 x=[989,1052]），我们全部硬编码靠左。
> 本文件把修复写成**可机械执行**的步骤，避免下次还要重新勘察代码。

## 一、要改的三处（都已定位）

### 1) `app/src/screens/ChatScreen.tsx:245–246` —— 渲染处

现状（硬编码 `--peer`）：

```tsx
<div key={m.id} className="chat__row chat__row--peer" data-message-id={m.id}>
  <div className="bubble bubble--peer">
```

改为按"是否自己发的"选择类名（示例形状，实际以实现时读到的变量名为准）：

```tsx
{messages.map((m) => {
  const mine = meId !== null && m.senderId === meId
  return (
    <div key={m.id}
         className={`chat__row ${mine ? 'chat__row--me' : 'chat__row--peer'}`}
         data-message-id={m.id}>
      <div className={`bubble ${mine ? 'bubble--me' : 'bubble--peer'}`}>
```

**注意**：`meId` 为 `null`（拿不到当前用户）时**必须降级为 `--peer`**（现状行为），
不要因为拿不到 id 就渲染成 `--me` —— 那会把所有人当成"我"。

### 2) 数据侧**已就绪，无需改**

```
app/src/api/client.ts:123    ApiMessage.senderId: string | null   ← 已带
server/src/index.ts:1478     senderId: row.sender_id              ← 已返回
```

### 3) `app/src/screens/chat.css` —— 样式

- `.bubble--me` **已存在**（第 41 行：primary 底、右上圆角）→ 可直接用
- `.chat__row--me` **未见**（现有 `.chat__row` / `.chat__row--peer`）→ **很可能需要补**：
  右侧对齐（例如 `flex-direction: row-reverse` 或 `justify-content: flex-end`），
  **实现时以实际读到的 `.chat__row` 定义为准**，不要照猜。

## 二、待勘察的一件事（实现时第一步做）

**"当前用户 id"从哪读**——本轮已确认存在这些入口但未定位到具体函数：

```
app/src/api/client.ts:428   setSession({ token, expiresAt, user: SessionUser })   ← 写入侧
app/src/api/client.ts:676   export function readSnapshot<T>(key)                  ← 通用快照读取
```

→ 第一步：在 `client.ts` 里找**读取 session/user 的现有导出**（不要新造一套存储），
   拿到 `meId`；若现无导出，则应新增一个最小的 `readSessionUser()` 并**复用它**，
   不要在每个屏幕各自解析 localStorage。

## 三、验证要求（按本项目纪律，缺一不可）

1. `cd app && npx tsc -b` → 0 错误；`pnpm lint`；`pnpm build` → 再 `cap sync android` → `tools/build-android.ps1`
2. **设备验证（必须）**：装机后用 CDP 断言
   - 自己发的消息：气泡所在行的 `justify-content`/`flex-direction` 呈**右侧**对齐
   - 对方消息：仍左侧
   - ⚠ **不能只看"类名加上了"** —— 要断言**实际渲染的几何**（例如行内气泡的 `getBoundingClientRect().left` 明显大于视口左半），
     因为"类名对了但 CSS 没生效"是这类改动最常见的失败形态
3. **截图对照**：与原版那条右对齐消息（`docs/original-baseline/screens/original-chat/20260921-205519-06-scroll-newer.png`）并排比对
4. 真机改完后**重新跑 M5 gate**（确认未破坏其它不变量）

## 四、不得越界的部分（写清以防顺手改错）

- **不要**顺手改"对方靠左"的依据 —— 那是**推断**，本次无直接证据（详见判定文档 §四）
- **不要**因为看到 `.bubble--me` 早已存在、却从未被使用，就假设"原设计就是这样" ——
  它是**未接线的样式**，不是"已决定的行为"
- **不要**改 `postThreadImageMessage` / `uploadMedia` 等已通过审核的路径

---

## 附：勘察完成（2026-09-21 20:59）—— `meId` 的来源已确定，规格无未知项

**现成入口（不需要新造存储）**：

```
app/src/api/session.ts        getSession()          ← 已有模块
app/src/screens/MeScreen.tsx:3,21   import { getSession } from '../api/session'
                                    const [session, setSession] = useState(() => getSession())
app/src/components/TabBar.tsx:2,28  import { getSession } from '../api/session'
                                    const s = getSession()
```

**即**：`ChatScreen` 只需 `import { getSession } from '../api/session'`，
用 `getSession()?.user?.id`（**以实现时读到的 SessionUser 字段为准**）取 `meId`。

**注意**：`MeScreen`/`TabBar` 都用了"状态 + 重新读取"的模式（`useState(() => getSession())`、
并在登录/退出后重新 `getSession()`）。`ChatScreen` 若要跟随登录态变化，
应**沿用同一模式**，不要引入新的订阅机制。

### 至此修复的完整清单（无未知项）

```
1. ChatScreen.tsx   + import { getSession } from '../api/session'
                    + 取 meId（null 时降级为 --peer）
                    ~ 第 245–246 行：按 mine 选择 chat__row--me/--peer 与 bubble--me/--peer
2. chat.css         ~ 补 .chat__row--me 的右侧对齐（.bubble--me 已存在可用）
3. 验证             tsc/lint/build → cap sync → build-android → 装机
                    → CDP 断言**实际几何**（气泡 getBoundingClientRect().left 明显偏右）
                    → 截图对照原版 raw-dumps/original-chat/...-scroll-newer.png
                    → 重跑 M5 gate
```