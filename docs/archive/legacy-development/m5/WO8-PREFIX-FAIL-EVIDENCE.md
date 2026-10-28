# WO#8 **改前 FAIL** 证据（pre-fix evidence）—— 主路径 mock 化缺陷

> 时间：2026-09-22 02:29｜Round 258｜设备：MuMu `127.0.0.1:16384`（dpr 1.75）
> 脚本：`scripts/m5/gate-wo8-message-list.mjs`（经 `scripts/m5/run-device-gate.sh` 运行）
> 前置：`VISUAL_TARGET_VALIDITY: PASS`（采集前后各一次，均 PASS）

## 一、为什么现在必须跑

审核记录 43 冻结的证据纪律：
```
PREFERRED: pre-fix FAIL → fix → PASS
           （同时证明 Gate 能捕获**真实历史 defect**）
REQUIRED : controlled sensitivity test
           （破坏 invariant → FAIL / exit 非零；恢复 → PASS / exit 0）
```
本缺陷**尚未修复** → 这是取得"改前 FAIL"这条更强证据的**唯一时机**。
（修好之后就再也拿不到，除非回滚构建。）

## 二、实测结果（改前）

```
ENTRY_FROM_TAB                    PASS   ← 从 UI 真的走得到「消息」
MESSAGE_LIST_FROM_API             FAIL   ← 观测到的 /api/threads 请求数 = 0
MESSAGE_LIST_NO_MOCK_ID           FAIL   ← 点击落到 #/group?id=g1（mock id）
MESSAGE_LIST_CLICK_REACHES_CHAT   FAIL   ← 点会话后 /api 请求数 = 0；未取得 200
CHAT_ROUTE_NO_MOCK_FALLBACK       FAIL   ← 见下（铁证）
WO8_DEVICE_GATE                   FAIL   （exit 1）
```

### 2.1 逐条明细

| 断言 | 观测值 |
|---|---|
| `ENTRY_FROM_TAB` | `{"reached":true,"hash":"#/message"}` —— 入口本身是通的 |
| `MESSAGE_LIST_FROM_API` | `listApiCalls: 0`；**唯一的网络请求是 `GET /api/posts`**（那是别的屏幕发出的，不是消息列表） |
| 列表内容 | 5 行，全部是 mock：<br>`计算机学院 2023 级 \| 期末周自习安排已更新… \| 128 人`<br>`Azur冰弦 \| 相同学校 \| 明天下午一起去图书馆吗？ \| 12:31 \| 2`<br>`又又 \| 相同学校 \| 收到，谢谢！ \| 昨天`<br>`eveee \| 相同学校 \| 那家店周末人多，我们早点去 \| 周二`<br>`禾桉涵 \| 相同学校 \| 好，就这么定了 \| 周一` |
| `MESSAGE_LIST_NO_MOCK_ID` | 点击第 1 项 → `#/group?id=g1`（**mock id `g1`**） |
| `MESSAGE_LIST_CLICK_REACHES_CHAT` | `clickApiCalls: 0` —— 点会话后**一次 /api/threads 请求都没有**；落到的是 mock 群聊页（`hasInput:true` 但 `hasBubble:false`，内容全是 mock 的 09:12/09:14/09:15/10:02） |
| `CHAT_ROUTE_NO_MOCK_FALLBACK` | 访问 `#/chat`（**不带 id**）→ 应用**真的请求了 mock id**：<br>`GET /api/threads/t1/messages` → **404** `{"error":"not_found"}`<br>页面显示：「**网络错误 / 这个会话不存在，或你没有权限查看**」 |

### 2.2 ⭐ 铁证（`CHAT_ROUTE_NO_MOCK_FALLBACK`）的意义

```
App.tsx:75   {root === 'chat' && <ChatScreen id={param ?? 't1'} />}
                                                        ^^^^^^^^^^
这个 't1' 是 **mock 数据里的会话 id**（app/src/data/mock.ts 的 threads[0].id），
却被当作**真实 API 调用**的兜底参数 → 服务端返回 404。
```

也就是说：**一个只存在于 mock 里的 id，被硬编码进了路由兜底，并且直达真实后端。**
这不是"看起来像 mock"，而是 **mock 与真实数据在同一处接线，且接线是错的**。

## 三、附带修正：我第一版门禁有一处**自己的假设错误**（如实记录）

```
第一版断言：假设底部 tab「Lemy」直达「消息」
实测：      点「Lemy」→ navigate('me') → #/me（个人页）
→ 那条 FAIL 是**我的假设错了**，不是产品缺陷。
已按证据改正为真实入口：
  顶栏「消息」图标按钮 aria-label="消息"，出现在
    app/src/screens/CampusScreen.tsx:223
    app/src/screens/MeScreen.tsx:42
    app/src/screens/MapScreen.tsx:387
  与原版证据一致（docs/test/original-baseline/screens/original-chat/INDEX.md：
   「个人主页右上角存在无文字的聊天入口图标」）。
改正后再跑 → ENTRY_FROM_TAB: PASS。
```
> 教训（与既有纪律同源）：**门禁里的"用户怎么走到那里"必须来自证据，不能来自想当然**。
> 否则会出现"断言 FAIL 但产品没问题"的假缺陷 —— 与"假 PASS"同样有害。

## 四、修复后的期望

```
ENTRY_FROM_TAB                    PASS（不变）
MESSAGE_LIST_FROM_API             PASS（列表来自 GET /api/threads）
MESSAGE_LIST_NO_MOCK_ID           PASS（每项 id 都是合法 UUID）
MESSAGE_LIST_CLICK_REACHES_CHAT   PASS（落 #/chat/<uuid> 且 GET …/messages 200）
CHAT_ROUTE_NO_MOCK_FALLBACK       PASS（无 id 时显示"未指定"，**不再请求 't1'**）
WO8_DEVICE_GATE                   PASS（exit 0）
```

## 五、可复现

```bash
bash scripts/m5/run-device-gate.sh scripts/m5/gate-wo8-message-list.mjs
# 原始报告：tools/tmp/wo8-gate.json
```
