# 审核记录 19：M4 仍差 1 个 P0（真正的备份 mutation barrier），其余全部接受

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 17:00（Asia/Shanghai）

## 一、已接受的（明确 CLOSED）

> 你补交的 ②③④⑤ 我全部接受：
> - 双向 row↔file 恢复校验：CLOSED
> - restore 后私有授权行为：CLOSED
> - cleanup DB-down fail-closed：CLOSED
> - pixel / dimensions bound：CLOSED
> 而且新 Gate 真正抓出了上传测试留下 orphan 的根因，这说明这些 closeout 不是形式检查。

## 二、① 被判"名实不符"——这是本轮唯一的 P0

审核的原话要点：

> 你现在证明的是"备份开始前状态一致"……它证明的是 **pre-backup consistency check**。
> 它没有阻止下面这个时序：
> ```
> A2 检查通过
>   ↓
> pg_dump 开始/完成
>   ↓
> 此时用户上传一张新图 → DB row + file 都成功
>   ↓
> uploads.tar 开始 → tar 包含新文件，但 pg_dump 不包含新 DB row
> ```
> 或者：
> ```
> pg_dump 完成 → 某条消息撤回 / media mutation → media archive
> ```
> 于是数据库和媒体 archive 分别都"内部正确"，但**不属于同一个逻辑时刻**。

**这个批评是对的，而且我的命名确实夸大了保证强度。**
我证明的"两侧一致"是**某一时刻**而**不是**"备份窗口内的一致性"——
两者是不同性质：前者是"快照干净"，后者是"窗口冻结"。
我把前者写成了 BACKUP_CONSISTENCY_BARRIER，属于**保证强度被夸大**——
这正是本项目一直在防的那类问题（把弱证据当强证据），只不过这次出在我自己的命名上。

## 三、要做的修改（审核给的方案）

### 1. 改名（保留原断言，不删）

现有 A2 改名为 `PRE_BACKUP_CROSS_REFERENCE_INTEGRITY`
（它本身是有价值的断言，只是名字不该叫 barrier）。

### 2. 新增真正的 mutation barrier + 竞争条件测试

**备份期间**：
- 禁止：media upload、media delete/GC、**message revoke 中影响 media live state 的动作**、
  其它会新增/删除/改变 media reference 的写操作
- 允许：普通读取

**顺序**：进入 barrier → `pg_dump` → archive uploads → manifest/hash → 释放 barrier

**允许的实现形式**（审核原话："关键不是实现形式"）：
- PostgreSQL advisory lock，且**业务 mutation 也必须共同遵守**
- 或 应用 maintenance flag + DB lock

**Gate 必须制造竞争条件**：
```
backup barrier active
→ 并发 upload/revoke 尝试
→ 不得在 DB dump 与 media archive 之间完成
→ barrier 解除后写操作恢复
```

### 3. 新增 key

```
PRE_BACKUP_CROSS_REFERENCE_INTEGRITY: PASS   （原 ① 改名）
BACKUP_MUTATION_BARRIER:             PASS   （真新增）
```

### 4. 补完后重跑（当前 HEAD）

`M4_STORAGE_GATE_RESULT` + M3 完整 regression + M4 三层
→ 审核预计可直接判 **M4 — ACCEPTED / CLOSED**，且**不需要重审 A/B/C**。

## 四、我的实现设计（下单前先写清，避免边做边改）

**机制选择：PostgreSQL advisory lock（共享/排他）**

- 备份进程：`pg_advisory_lock(KEY)` —— **排他**
- 影响 media generation 的业务写：`pg_advisory_lock_shared(KEY)` —— **共享**
- 语义正好：排他等待已有共享释放并阻塞新共享 → 备份窗口内写操作无法进入；
  备份结束后自动放行。普通读取**不加锁**，不受影响。
- 为什么选它而不是"应用 flag"：advisory lock 是**数据库层**的，
  不依赖"每个写路径都记得检查 flag"——后者一旦有人新写一个接口忘了检查就漏了。
  这与本项目"防线要放在数据库层"的既有纪律一致（同 scope 复合外键那次）。

**要加锁的具体写入点**（必须逐一定位，不能漏）：
1. `POST /api/media` 的 INSERT 段
2. `dist/cleanup.mjs` 的删除段（GC）
3. 撤回消息（`update messages set deleted_at`）—— 因为它会改变 media 的 live state
4. 未来任何"改变 media 引用"的接口（在 Gate 里加注释提醒）

**竞争条件测试**（Gate 内执行，必须真的竞争）：
1. 起一个后台任务：进入 barrier（拿排他锁）、`sleep` 数秒、再释放
2. 在 barrier 持有期间，**并发**发起 upload 与 revoke，断言：
   - 它们**没有**在 barrier 窗口内完成（阻塞或被明确拒绝）
3. 释放 barrier 后，同样的写操作**必须成功**（证明不是永久锁死）
4. 断言 barrier 本身的时序：dump 与 archive 都在 barrier 内完成

**风险与取舍（先写明，避免自欺）**：
- 锁超时要设（`lock_timeout`），否则一个慢备份会把写入挂死；
  超时应返回 **503 + 明确错误**，而不是无限等待
- 单机 demo 下"排他锁 + 共享锁"足够；审核也明确说不需要分布式 snapshot
- 测试时间不能太长（否则 M4 gate 变慢），barrier 窗口控制在数秒

## 五、M5 相关裁定（同一条回复里）

- **推进方式确认**：M4 关闭后，按 `docs/test/AUDIT-M0-M4.md` 作为 Verified Baseline **逐项销项**
- **board_notes 确认为第一单**；我新增的两条机械断言都要做，并且：
  > 客户端提交 from_user_id → 400 / ignored-by-contract；**我更偏向 strict reject**
  —— 即：**改成明确拒绝（400）**，而不只是"忽略"。这是一处行为变更，要改实现 + 改断言。
- 他们另外列出的要求包括"真机空态、占位、**7 个表情入口**、App restart 后仍来自服务器"
  —— 注意：审核也写了 **7 个**。这与我在证据文件里查不到 emoji 字段的矛盾仍未解决，
  需要**回到原版只读观察**去数（只读，允许），不能再靠记忆。
- **Voice 确认保持 backlog**，不承诺为 Work Order #2；优先继续 A 类与可缩小的 D 类。

## 六、下一步（按优先级）

1. **实现 backup mutation barrier**（advisory lock + 四个写入点 + 竞争条件测试）← 唯一阻塞 M4 关账的项
2. 改名为 `PRE_BACKUP_CROSS_REFERENCE_INTEGRITY`，新增 `BACKUP_MUTATION_BARRIER`
3. 重跑 M4 存储 gate + M3 完整 regression → 提交审核请求 M4 CLOSE
4. board_notes 的 `from_user_id` 改为 **strict reject（400）** 并改断言
5. 用**只读观察**核实原版表情入口数量（7 个？）

---

## 七、实现进展与备份侧锁的具体做法（本轮）

### 已完成

- **`server/src/mutationBarrier.ts` 已创建**（本轮）：
  `MEDIA_MUTATION_LOCK_KEY`、`acquireMediaMutationLock(client)`（事务级共享锁 +
  `lock_timeout`）、`isBarrierTimeout(err)`。
  刻意用**事务级** `pg_advisory_xact_lock_shared` 而不是会话级：
  事务结束即释放，**不存在"忘记 unlock 导致永久锁死"**这条漏子。
  并写明强度边界：它约束的是**遵循同一把锁的业务写路径**；
  直接连库的手工改数据不受约束（管理面操作，不在业务路径上）。

- **业务侧接入已交给子代理执行**（media INSERT / cleanup GC / 其它 media 写路径），
  要求：已在事务里就地取锁、不在事务里则包成事务、锁超时返回 **503 + Retry-After**
  （语义是"稍后重试"而不是"出错了"）、**读取路径一律不加锁**。

- **业务侧接入已完成**（本轮子代理执行，typecheck/build 通过；**尚未在服务器上做竞争条件实测**）：

  | 写路径 | 位置 | 处置 |
  |---|---|---|
  | `POST /api/media` 的 INSERT | `server/src/index.ts`（`app.post('/api/media')`） | 原本不在事务里 → 包成事务：`begin` → `acquireMediaMutationLock` → 写文件 + INSERT → `commit`；锁等待超时 → **503 + `Retry-After: 5`**（`error: backup_in_progress`）。取锁**在写盘之前**，避免"先把文件落盘再等锁"自己制造不一致窗口 |
  | 孤儿清扫 GC（真删文件） | `server/src/cleanup-entry.ts`（`--apply` 分支） | 删除段整体放进共享锁事务；拿不到锁 → **不删任何文件**、打印明确信息、**退出码 3**（与"缺 DATABASE_URL=2""其它失败=1"区分）。dry-run 是纯读，**不加锁** |

  逐条 grep 确认过的"**不是**写路径"（因此刻意不加锁，避免把屏障扩大到读路径）：
  - `POST /api/posts`、`POST /api/posts/:id/comments`、点赞/取消赞、`POST /api/board-notes/:userId`：
    都不写 media / post_media / message_media
  - `POST /api/threads/:id/messages`：只写 messages 与 message_mentions，且**不接受 media id**，
    不产生 message_media 关联 → 不改变 media generation
  - `GET /api/media/:id`、`GET /api/threads/:id/messages` 等读接口：一律不加锁
  - **撤回消息接口目前不存在**（设计清单第 3 条）：`update messages set deleted_at` 只出现在
    `scripts/m4/*.sh` 的 Gate 脚本里，那是**管理面** psql 直连，不在业务写路径上。
    将来真加"撤回"接口时，必须按同一模式取共享锁（会改变 media 的 live state）
  - `server/src/seed.ts`：会写 media / post_media，但它是**夹具/种子 CLI**（不是业务写路径，
    且运行时机在 gate/部署准备阶段），本轮刻意未接入 —— 这是一处**明确记录下来的取舍**，
    不是遗漏

  另：`cleanup` 只删**盘上的孤儿文件**，并不 `delete from media` —— 应用代码里没有删除 media 行的写路径
  （那些 `delete from media` 都在 Gate 脚本里，属管理面）。

### 备份侧排他锁的做法（设计已定，待实现）

`scripts/m4/backup-restore-joint.sh` 里现在是：line 86 `pg_dump` → line 90 `tar`。
要把这两步**放进同一个排他锁窗口**。

**做法：用单个 psql 会话持有锁，并在锁内用 `\!` 执行 shell 步骤**

```bash
KEY=1295258177   # 与 mutationBarrier.ts 的 MEDIA_MUTATION_LOCK_KEY 必须一致
steps="$GEN/.barrier-steps.sh"
cat > "$steps" <<'STEPS'
PGPASSWORD="$(cat /srv/campus/.db_password)" pg_dump -Fc -h 127.0.0.1 -U campus -d campus -f "$GEN/database.dump"
tar --zstd -cf "$GEN/uploads.tar.zst" -C "$UPLOADS" public private 2>/dev/null
STEPS
PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -q <<SQL
select pg_advisory_lock($KEY);
\! bash $steps
select pg_advisory_unlock($KEY);
SQL
```

为什么可行：`pg_advisory_lock` 是**会话级**的，而 `\!` 只在同一个 psql 会话内执行 shell，
会话不退出锁就一直有效 —— 于是 dump 与 archive **都在排他窗口内**完成。
（业务侧用**事务级**共享锁，备份侧用**会话级**排他锁，两者配合正确：
共享锁挡不住排他锁的申请，排他锁会等待已持有的共享锁释放、并阻塞新的共享锁。）

`lock_timeout` 在备份侧**不要设得太短**（备份本身要时间），
但业务侧的 `lock_timeout` 要短（5 秒）以便快速返回 503。

### 竞争条件测试（Gate 必做，下轮实现）

1. 后台起一个"持有排他锁 N 秒"的任务（模拟备份窗口）
2. 在窗口内**并发**发起 upload 与 revoke，断言：
   - 它们**没有**在窗口内完成（阻塞至超时 → 503，或阻塞到窗口结束）
3. 窗口结束后，同样的写操作**必须成功** —— 证明不是永久锁死（这条最关键，
   否则"屏障"可能只是把功能弄坏了）
4. 断言 dump 与 archive **都在窗口内**（用时间戳或日志证明）