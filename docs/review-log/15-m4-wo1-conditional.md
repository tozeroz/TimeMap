# 审核记录 15：M3 冻结状态确认 + M4 工作单 #1 有条件批准

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 14:24（Asia/Shanghai）

## 一、正式状态

```
M0: CLOSED
M1: CLOSED
M2: CLOSED
M3: CLOSED          （Final Gate PASS，PERSISTENT/STAGE/REGRESSION 三层全绿）
M4: GO              （工作单 #1 有条件批准）
```

M3 的两项 closeout 被确认真正销项，且是**在新 HEAD 上重跑三层 Final Gate** 后的 PASS，
不是"文档补写后沿用旧结果"。

## 二、M4 的三条核心主线（审核冻结）

```
A. Media lifecycle
   upload → validate → store → authorize → deliver → delete/recover

B. Messaging model completion
   message kind + media reference + public/private media boundary

C. Mention relation
   SELF_OWNED_MENTION_FUNCTIONAL only
   ORIGINAL_MENTION_MODEL_CONFORMANCE: NOT_EVALUATED（无新合规证据则不反向推断）
```

## 三、7 条边界要变成**可机械 Gate 的契约**（不是设计说明）

审核列出的机械断言：

| # | 契约断言 |
|---|---|
| 1 | 上传验证：伪造 `.jpg` + 非图片内容必须拒绝；超限文件必须拒绝 |
| 2 | 路径安全：客户端 filename 中带 `../` 不得影响实际存储路径 |
| 3 | 原子性：故障注入证明 DB/file 不会**长期**形成未登记 orphan |
| 4 | 私有媒体授权：会话成员能读，非成员/匿名不能读；**知道 URL 也不能绕过** |
| 5 | 公共媒体：允许的访问模型**单独**验证，不与私聊图复用错误授权 |
| 6 | 磁盘容量：达到配额/ENOSPC 时返回受控错误，**不把 DB 写成"上传成功"** |
| 7 | 联合恢复：DB dump + media store backup → 新环境 restore → metadata 与文件 hash/引用一致 |

### 备份结果必须拆成四个 key（从 M4 起）

审核明确：**`pg_dump restore PASS` 只能继续代表数据库恢复，不能再单独代表完整业务数据恢复。**

```
DATABASE_RESTORE:        PASS
MEDIA_STORE_RESTORE:     PASS
CROSS_REFERENCE_INTEGRITY: PASS
M4_BACKUP_RESTORE:       PASS
```

## 四、工作单 #1 的有条件批准：必须补的 4 条失败边界

整体方向认可，尤其缺口 C（public/private 双命名空间）的修正是对的。
但在实现前要再补 4 条，**其中两条 P0**。

### P0-A：私有媒体**不要自己发明一套 authorization**

我原写法是"请求者是发送者 ∨ 是所在会话成员 ∧ 消息未撤回"。方向对但不够强。
审核要求抽象成更强的不变量：

```
canReadPrivateMedia(user, media)
  =
  EXISTS message
    WHERE message references media
      AND canReadMessage(user, message)
      AND message not revoked
```

**媒体授权必须复用消息可见性的同一个 predicate。**

否则以后很容易出现权限漂移：

```
GET /messages/:id            → 404
GET /api/media/:mediaId      → 200      ← 同一个用户、同一条消息，结论却不同
```

好处：成员退群、被移除、历史消息可见性等规则**只在 `canReadMessage` 一处定义**，
不让 media endpoint 单独猜。

### P0-B：scope 要有 **DB 级防线**

仅靠应用层"post 上传→public / message 上传→private"不够强。
要让以下非法状态在**数据库层也无法建立**：

```
post_media    → private media      拒绝
message_media → public media       拒绝
```

手段可以是 trigger，或拆分 attachment schema 让错误 FK 结构上不可能
（不一定要拆两张 media 主表）。**Gate 要直接尝试制造 cross-scope reference，并确认数据库拒绝。**

这样"同一张图两种身份"不会因为将来某个漏校验的 endpoint 再次出现。

### 私有媒体下发：推荐 **X-Accel-Redirect**（而非 Node 搬字节）

```
GET /api/media/:id
   ↓
Node：session + SQL authorization
   ↓
X-Accel-Redirect
   ↓
Nginx internal location
   ↓
/srv/campus/uploads/private/...
```

```nginx
location /_private_media/ {
    internal;          # 外部直接访问会失败
    alias /srv/campus/uploads/private/;
}
```

**仍然满足"私有媒体必须先经过应用层授权"**，同时字节传输不压在 Node 上 ——
在 396 MB 内存的机器上比 Node 自己流式转发更合适。

无论用哪种方式，一并冻结响应头：

```
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

### 缺口 A 补漏：**客户端重试导致重复媒体**

我处理了三种状态（file ok/DB fail → unlink；rename ok/崩溃 → orphan → GC；
DB ok/响应前崩溃 → 文件与行都正常）。审核指出最后一种有后续：

```
DB insert 成功 → 响应前进程死 → 客户端不知道成功 → 重试上传
→ 第二个 UUID + 第二份文件 + 第二条 media
```

不是破坏性 corruption，但产生逻辑重复与磁盘浪费。M4 第一版**必须做一个选择并写明**：

- **推荐（审核建议现在就做，成本很低）**：上传幂等键
  ```
  客户端为一次逻辑上传生成 upload_request_id = UUID
  数据库：UNIQUE(user_id, upload_request_id)
  相同上传重试 → 返回原来的 media
  ```
- 或显式登记为已知限制：`retry-after-unknown-success may duplicate media`

### 文件系统细节

`tmp → rename(final)` 必须确保 **tmp 与 final 位于同一文件系统**，
这样 rename 的原子语义才成立（跨文件系统 rename 会退化成复制+删除）。

## 五、下一步

以上 4 条并入 `docs/m4/WORKORDER-1-STORAGE-CONFORMANCE.md` 后即可按原顺序实现：
schema → 上传 → 私有下发 → 公共 alias → 清扫 → 联合备份 → M4 Gate 组。
