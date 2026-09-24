# CHAT_MESSAGE_SENDER_PRESENTATION 偏差的代码刻画（只读分析）

> 时间：2026-09-21 18:48（Asia/Shanghai）
> 来源：审核记录 25 把它登记为新 deviation（"自己发的图片渲染在左侧 peer 气泡"），
> 要求归入 M5 A/D 清单、不借此扩张 WO#2。本文件是**只读代码分析**，用于界定修法范围。

## 一、结论：这**不是"缺功能"，而是"已写好却没接线"**

三块拼图：

| 要素 | 现状 | 位置 |
|---|---|---|
| 消息 DTO 是否带发送者 | **✓ 带了** | `app/src/api/client.ts:123` `senderId: string \| null`；服务端 `server/src/index.ts:1478` `senderId: row.sender_id` |
| "我"的气泡样式 | **✓ 已存在** | `app/src/screens/chat.css:41` `.bubble--me { background: var(--c-primary); color: var(--c-primary-fg); border-top-right-radius: 5px }` |
| 渲染时是否用它 | **✗ 从不使用** | `app/src/screens/ChatScreen.tsx:245` 硬编码 `className="chat__row chat__row--peer"`，246 行 `bubble bubble--peer` |

**即**：CSS 与数据两侧都齐了，只是渲染路径**没有把 `senderId` 与当前用户比较**，
于是所有消息（含自己发的）一律套用 `--peer`（左侧、surface 底色、左上圆角）。

## 二、因此修法的**量级**是"接线"，不是"造功能"

若最终确认要做，改动大致是：

```
取当前用户 id（App 里已有会话身份）
→ 渲染时 m.senderId === me ? ('chat__row--me' + 'bubble--me') : ('chat__row--peer' + 'bubble--peer')
```

**注意**：`chat.css` 里有 `.bubble--me` 但**没有** `.chat__row--me`（本次未见到），
所以可能还要补一个 `.chat__row--me`（右侧对齐）。这属实现细节，需动手时确认。

## 三、但**现在不能做**：缺一个关键证据

按本项目 Gate 原则：**驱动实现改动的事实必须能追溯到可复核原始产物**。
当前我们知道的是"**我们**没区分"，**不知道**"**原版**有没有区分"。

- 若**原版也区分**（大概率）→ 这是真 DEVIATION，应修
- 若**原版也不区分**（即其会话页同样全部左对齐）→ 那就**不是** deviation，
  我们反而是对的，改了才会制造差异

**→ 需要一次对原版会话页的只读观察**（截图 / 控件树 dump），确认其是否存在左右区分。
这属于纯只读导航，**不涉及任何写操作**，合规。

## 四、为什么现在没做这个观察（如实说明）

**设备此刻被另一个子代理占用**（`a24179f5` 正在做"原生系统文件选择器交互"的真机验证），
按本项目已确立的纪律 `docs/DISCIPLINE-device-concurrency.md`：

> 有设备端验证在跑时，不要重装 APK、不要抢同一条 CDP 连接。

而这次观察会用到 dump / 截图（也要用 adb），存在相互干扰风险。
**所以排队等子代理结束后再做**，而不是并发去动设备。

## 五、待办

- [ ] 等设备空闲 → 只读观察原版会话页是否有"我/对方"左右区分（截图 + dump，入库 raw-dumps）
- [ ] 依观察结果决定：修（若原版区分）或**撤销该 deviation**（若原版不区分）
- [ ] 若修：改动预计很小（接线级），但仍需真机验证 + 截图对比
