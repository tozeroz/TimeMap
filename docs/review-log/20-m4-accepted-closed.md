# 审核记录 20：**M4 — ACCEPTED / CLOSED**

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 17:35（Asia/Shanghai）

## 一、正式判定

审核原话："**可以关账。**"

```
M4_FINAL_GATE_RESULT: PASS
PERSISTENT: PASS
STAGE:      PASS
REGRESSION: PASS
M4_STATUS: ACCEPTED / CLOSED
```

## 二、为什么放行（不是"锁代码存在"，而是链路被证明）

> 关键原因不是"锁代码存在"，而是你现在已经证明了完整链路：
> ```
> backup exclusive window active
> → 真实 /api/media 写请求 503
> → 真实 cleanup --apply exit 3 且零删除
> → 普通 GET 仍然 200
> → window release
> → 同一路径上传重新 201
> ```
> 这正是我们之前要求的：**窗口内阻断 mutation，窗口外恢复 mutation，而 read path 不被无意义冻结。**
> 因此 `BACKUP_MUTATION_BARRIER` 现在是**真正名实相符**的。

## 三、两层 Gate 被判定"永久保留、不要合并"

> 你遇到的锁键错误：
> ```
> backup/test side = wrong key
> application side = correct key
> ```
> 却仍然能让机制层 PASS，这个案例非常典型。
> 它说明：**一个测试可以非常严格地证明一个错误系统内部自洽。**
> 所以现在这两层**不要合并**：
> - **Layer 1 `LOCK_PRIMITIVE`**：证明同 key 的 shared/exclusive 互斥关系正确
> - **Layer 2 `BARRIER_E2E`**：证明真实生产路径与备份脚本**实际上使用的是同一个 contract**
>
> 特别是 **E0 lock-key equality**：虽然看起来很"小"，
> 实际上是**这次最关键的 wiring invariant 之一**。

### 审核给出的一条通则（已作为项目纪律记下）

> 建议以后凡是跨：
> - shell ↔ application
> - frontend ↔ backend
> - migration ↔ runtime
> - backup ↔ service
>
> **共享 magic value / protocol constant 的地方，都优先做这种"双方值机械一致性检查"，
> 不要只靠复制粘贴和代码审查。**

这条正是本次 `BARRIER_KEY_MISMATCH` 的教训被提炼成的规则——
我手算错了锁键（1295270465 写成 1295258177），而**机制层测试照样 PASS**。

## 四、我留下的四个边界：审核确认**不阻塞 M4**

| 边界 | 审核结论 |
|---|---|
| 撤回 API 尚不存在 | 不阻塞。将来新增真实 revoke mutation 时**必须**取共享屏障并新增对应 Gate |
| `seed.ts` 写 media | 不阻塞。它是受控 fixture/admin workflow，不是在线业务 mutation；维持"不得与正式联合备份并发执行"的运维约束即可 |
| 直接 SQL 不受锁约束 | 不阻塞。advisory-lock contract 保护的是**受治理应用路径**，不声称超级用户无法绕过系统 |
| cleanup 与 upload 的共享锁不互斥 | 接受。二者需要**共同被 backup exclusive 挡住**，并不代表二者之间必须串行化 |

## 五、M5 推进方式：正式确认

> 从现在开始正式冻结：
> - `docs/AUDIT-M0-M4.md` = **M5 Current Verified Baseline**
>
> 然后**逐项销项**。不再回头扩 M4，除非出现真正的问题。

## 六、当前总体状态

| 阶段 | 状态 |
|---|---|
| M0 | CLOSED |
| M1 | CLOSED |
| M2 | CLOSED（审核 08 接受） |
| M3 | CLOSED（审核 14 接受） |
| **M4** | **ACCEPTED / CLOSED**（审核 20） |
| M5 | 进行中：board_notes 第一单已基本完成（strict reject 改动进行中） |

## 七、下一步（按裁定）

1. 按 `docs/AUDIT-M0-M4.md` 作为 Verified Baseline **逐项销项**推进 M5
2. board_notes 的 `from_user_id` 改 **strict reject（400）** 后收口第一单
3. 用**原版只读观察**核实表情入口数量（我们 mock 是 6 个，需确认原版到底几个）
4. 把审核的通则落地：**凡是跨层共享 magic value 的地方都加机械一致性检查**
   —— 不只是锁键，还包括（例如）purpose→scope 映射、mime 白名单、退出码语义等
