# 审核记录 24：WO#2 后端 ACCEPTED；三项裁定

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 18:28（Asia/Shanghai）

## 一、WO#2 后端：ACCEPTED

```
MESSAGE_MEDIA_RESULT:      PASS
CLEANUP_UNATTACHED_RESULT: PASS
WO2_BACKEND: ACCEPTED
WO2_OVERALL: IN_PROGRESS      # 前端用户路径尚未完成
```

审核的理由（要点）：

- **任务 A 的关键保证链已闭合**：
  ```
  session user 是 thread member → media 存在 → private → owner == session user
  → kind=image → message + message_media 同事务
  ```
  失败时没有半条 message 泄漏，DB 约束又独立兜底。
- **任务 B 符合要求**，并特别肯定了**删除语句再次带 `NOT EXISTS`**：
  > 它把"检查时 unattached，删除前恰好被消息引用"的 **TOCTOU 窗口关掉了**。
- `unattachedMissingFile` 单独报告、不擅自处理，也认可：
  > 那是**另一种损坏状态**，不应该顺手混进正常 GC。

## 二、`mediaIds` 出现即 strict 400：**认可，而且应保留**

> **不要改回 ignore。**

审核原话：

> 你已经实测出了 ignore 的危险语义：
> ```
> 客户端错误发送 mediaIds=[...]
> → 服务端忽略未知字段
> → 201
> → text/message row 成功
> → image 没有关联
> ```
> 这是典型的 **silent data loss**。

**契约因此冻结为**：

```
mediaId:  UUID | absent
mediaIds: → 400 bad_media_id
          → reason=array_not_supported_use_singular_mediaId
          → zero DB mutation
```

并给出一条更一般的原则：

> 当一个"**不认识/不允许**"的输入**很可能代表调用方以为自己成功表达了重要业务意图**时，
> **不应静默忽略**。这与 board_notes 对 server-owned identity 字段 strict reject 是同一类原则。
> 尤其媒体附件属于**用户可见数据**，strict reject 明显比 Postel-style 宽松解析安全。

**新增待办**：把这一条**保留在 API regression Gate 中** ——
防止将来有人把 schema parser 改成"strip unknown fields"后**又退化**回去。

## 三、`.tmp` 目录：**选 A（运行时创建）**，但边界要划清

> 我支持：服务启动时 `mkdir(..., { recursive: true })`。

**关键区分（审核的边界划分）**：

> 这不是"把部署配置全塞进应用"，而是在创建一个**应用自己拥有的运行时内部子目录**。
> `.tmp` 的性质与下面这些**不同**：
> - PostgreSQL 必须安装
> - `/srv/campus/uploads` 根目录必须挂载/存在
> - service user 权限
>
> 它更像**应用内部实现细节**：
> ```
> UPLOAD_ROOT/
>     .tmp/
> ```
> 既然上传代码自己依赖它，就应该自己保证它存在。

以及这条判断（与本项目一贯的"persistent invariant"思路一致）：

> 否则现在这种情况很危险：**当前服务器因为历史手工 `install -d` 所以 PASS，fresh install 却 500。**
> **这正是 persistent invariant 漏洞。**

**自愈只做到 `.tmp`（不要把 UPLOAD_ROOT 根目录也接管）**，启动语义应为：

1. `UPLOAD_ROOT` 必须是预期的、可访问的持久存储根 → **应用验证它**（失败则明确报错，不自建）
2. `UPLOAD_ROOT/.tmp` 不存在 → **`mkdir` recursive**（应用拥有）
3. 权限：按需设置（审核后半段被截断，含 "mkdir / permi…"，实现时按最小必要权限处理并写注释）

## 四、下一步

1. **实现 `.tmp` 自愈**（按上面三步语义；`UPLOAD_ROOT` 只验证不创建）
2. **把 `mediaIds` strict 400 加进 API regression Gate**（防退化）
3. WO#2 前端（子代理 `c4836556` 进行中）
4. 仍待裁定：C4 表情形态（图片 vs 文字）、`force-stop` 规则严格度
