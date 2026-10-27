# M5 工作单 #2：聊天图片「从 App 发出」的完整闭环（计划，实现前提交）

> 时间：2026-09-21 17:40（Asia/Shanghai）
> 依据：`scripts/m4/verify-cross-layer-constants.sh` 的 C1 检查揭示的**覆盖缺口**
> 性质：**只出计划，不动代码**（按项目协议：计划 → 提交审核 → 实现）

## 一、怎么发现的（不是猜的，是机械检查揭出来的）

我在落实审核记录 20 那条通则（跨层共享常量要做机械一致性检查）时，
新增了 C1 检查："前端发送的 purpose 取值必须 ⊆ 服务端接受的"。

首次运行结果：

```
服务端接受: chat post
前端发送:   （未解析到）
```

**`app/src` 下根本没有 `purpose`** —— 也就是说：

> **后端 `POST /api/media` 已经存在并且测透了（26 条断言），
> 但 App 侧从来没有接入过上传。**

此前我以为"聊天图片已经做完了"，因为设备端能看到图片消息、blob 加载断言也全绿；
**但那些图片是种子数据里的，不是 App 上传产生的**。
这是一个典型的"实现存在 ≠ 用户路径存在"的缺口 ——
与 M4 早期"后端支持 private media 但用户侧没有消费路径"是同一类问题（那次是审核指出的）。

## 二、要做的闭环（三处，缺一不可）

### 2.1 后端：发送消息必须能带媒体（**当前不支持**）

`POST /api/threads/:id/messages` 现在只写 `messages` + `message_mentions`，
**不接受任何 media id**（这一点在 M4 的 barrier 接线时被确认过）。

要做：
- 请求体接受 `mediaIds: string[]`（可空）
- 校验：每个 media 必须**存在**、且 `scope='private'`、且 **owner 是当前会话用户**
  （防止把别人的私有图片挂到自己的消息里 —— 这是最容易漏的一条越权）
- 插入 `message_media(message_id, media_id, media_scope='private', position)`
- **复用既有防线**：`message_media` 的常量 CHECK + 复合外键已经保证
  "message 只能挂 private media"，服务端不需要自己重写这套判断，让它继续在 DB 层兜底
- 事务性：消息与 message_media 同事务（否则会出现"消息存在但图挂了"或反之）

### 2.2 前端：选图 → 上传 → 作为消息发出

- 选图：Capacitor 环境下用 `<input type="file" accept="image/*">` 触发系统选择器
  （**不引入新插件**，避免又要改原生工程；WebView 的 file input 在 Android 上可用）
- 上传：`FormData` 带 `file` + `purpose=chat` + **`uploadRequestId` 必须是 UUID**
  （这是 M4 端到端测试踩过的坑：非 UUID 会被 400 `bad_upload_request_id`）
- 拿到 `mediaId` 后 `POST /api/threads/:id/messages` 带 `mediaIds:[id]` 与 `kind:'image'`
- 失败路径要有可见提示（不能让用户以为发出去了）

### 2.3 渲染：**已经做好，不需要改**

`ChatScreen` 的 `MediaImage` 已用 blob 方式加载私有图（6 条设备断言 PASS），
所以这一环只需求证"上传得到的 media 与种子 media 走同一条渲染路径"。

## 三、Gate 断言（计划）

- **后端**（脚本，与 `verify-messaging-api.sh` 同风格）：
  - 带 `mediaIds` 发消息 → 201 且 `message_media` 有行、`media_scope='private'`
  - **挂别人的私有 media → 4xx 且不写入**（越权）
  - 挂 public scope 的 media → **被 DB 拒绝**（复合外键/CHECK 仍在兜底）
  - 挂不存在的 media id → 4xx
  - 消息与 media 关联**同事务**：故意让 media 校验失败 → 断言消息也没写进去
- **前端 / 设备端**：
  - 走真实路径选一张图 → 上传 → 发出 → 界面上出现该图（`naturalWidth > 0`）
  - **凭据不进 URL**（沿用既有断言）
  - 上传后**重新加载**仍在（证明落了服务端）
- **C1 覆盖缺口闭合**：`verify-cross-layer-constants.sh` 的 C1 由 FAIL 转 PASS
  （前端开始发送 `purpose`，且取值 ⊆ 服务端接受集）

## 四、我判断的范围边界（请审核确认）

1. **不做**多图选择（原版是否支持多图，我们**没有可采信证据**；
   在拿到证据前实现多图属于凭空设计）
2. **不做**图片压缩 —— 已在 audit 表里定性为 architecture choice，
   且若要做唯一合理路径是客户端 canvas 缩放，应另立一单
3. **不做**语音（审核已确认 voice 留 backlog）
4. 相册权限：用 file input 不触发 READ_MEDIA_IMAGES 权限申请，
   因此**不引入新的权限面**；若审核认为需要"仅选择照片"的受限访问，另议

## 五、请审核裁定

1. 这个闭环作为 M5 第二单是否批准？顺序上是否应排在"只读观察补原版表情字符"之前？
2. 2.1 里"owner 必须是当前会话用户"这条校验，是否还要额外限制
   （例如只允许挂**本次上传**的 media，而不允许挂自己很久以前上传的私有图）？
   我倾向**不额外限制**（用户对自己的图片有处置权），但这条涉及产品语义，请你定。
3. "不做多图"是否符合原版？如果你那边有原版多条图片消息的证据，请指出 ——
   我这边 `supplements` 里没有。

---

## 六、审核记录 21 的裁定与**强制修订**（本工作单已按此更新）

审核：**设计上 APPROVED**，但有两处修订必须遵守。

### 修订 1：API 用**单数 `mediaId`**，不是 `mediaIds[]`

> API 用单数 mediaId，不是 mediaIds[]，因为**当前没有证据支持一条消息多图**。

**这直接推翻了我原计划里的 `mediaIds: string[]`。** 我当时的理由是"为将来多图留余地"——
但那属于**没有证据的扩张**，而且与我自己在同一份工作单里写的"不做多图"**自相矛盾**。
修订后的请求体：

```json
POST /api/threads/:id/messages
{ "body": "...", "kind": "image", "mediaId": "<uuid>" }
```

（`mediaId` 可省略 → 纯文本消息。**不接受数组**；将来若真有多图证据，再另立一单扩展。）

### 修订 2：unattached media 必须有 **TTL GC 生命周期**

> 上传成功、消息发送失败留下的 unattached media 必须有 TTL GC 生命周期，不能永久吃磁盘。

这条指出一个我原计划**完全没考虑**的泄漏路径：
用户上传成功（文件 + media 行已落）→ 接着发消息失败（网络断、会话过期等）
→ 那张图**永远没有被任何 message 引用**，但**行和文件都留着**，永久占磁盘。

要做的：
- 识别"unattached"：`scope='private'` 且**没有任何 message_media 引用**的 media
- 加 TTL：超过阈值仍未被引用 → 由清扫工具回收（**而不是立刻删**，
  否则会误删"上传了但还没发出"的正常在途图片）
- **阈值不能太短**：要覆盖"用户上传后犹豫几分钟再发"的正常行为
- 与既有的 `MEDIA_ORPHAN_CLEANUP` 的关系要写清：
  现有清扫管的是"**盘上有文件、DB 无行**"（未登记文件）；
  这一条管的是"**DB 有行、盘上有文件，但没有任何消息引用**"（attached 缺失）——**两者不同**
- 该能力也要有自己的 Gate 断言与一个有依据的阈值（阈值取值必须写清依据，不能拍脑袋）

### 修订 3（确认，不是修改）：**不限制**"只能挂本次上传的 media"

> 你原来的判断正确。

发送图片消息只要求：
```
current user 是 thread member
media exists
media.scope = private
media.owner_user_id = current session user
media 当前有效
kind = image
```
**不要求**"必须是这一次 composer 刚上传的"。额外做"本次上传绑定"会引入
upload session / correlation token 等**没有证据价值的状态**。

若同一 media 被引用到多个会话，读取授权沿用 M4 已冻结规则：
**请求者只要能读取至少一条引用该 media 的 live message，才可以读取该 media。**

### 修订 4（措辞）：**不能说"不做多图"符合原版**

> 目前没有 admissible evidence ……

即：实现上不做多图可以，但**措辞必须是"未评估/无证据"**，
不能写成"原版也是单图"。这一点要体现在报告与 Gate 的 key 命名上。

### 执行顺序（审核明确）

```
board_notes：身份字段 strict 400（已完成）
           + **第三账号真机隔离验证（未完成）**
           → Slice 1 CLOSED
           → 才开始 WO#2
```