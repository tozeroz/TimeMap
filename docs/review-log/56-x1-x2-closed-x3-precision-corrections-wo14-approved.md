# 审核记录 56：X1/X2 关账 · X3 的两处精度修正 · **WO14 已批准可直接实施**

> 时间：2026-09-22 08:20｜Round 264｜来源：网页版 ChatGPT 独立审核
> 关联提交：`da9e3fc`(X1) ／ `d2f832b`(X2) ／ `f96e091`(X3) ／ `f332bc7`(X3.1) ／ `5055254`(X1 接线)

## 一、裁定

```
X1_CORS_CLIENT_METHOD_COVERAGE:     **COMPLETE / PASS / CLOSED**
X2_DESTRUCTIVE_GATE_SEPARATION:     **COMPLETE / PASS / CLOSED**
X3_COLD_START_FACT_FINDING:         **COMPLETE**
X3.1_CONTENTION_CAUSAL_EXPERIMENT:  **COMPLETE**
WO14_PLAN:                          **ALREADY APPROVED TO IMPLEMENT**（上一轮就已批准）
```

审核 56 特别肯定 X1 的这几处：从**客户端使用面**出发；把 **GET + Authorization 也纳入预检**；
**接进常规 server-gate 流程**而不依赖人工记忆；selftest **不只要求"红"，还要求因为正确原因而红**；
旧的错误 Gate 做成 **tombstone** 防以后误用。
并追加一条要求：**tombstone 本身要保持明显的非零退出，且不要进入任何正常聚合器**（已满足：exit 2）。

X2 被肯定的关键点：真正区分了
`ROUTINE REGRESSION ≠ DESTRUCTIVE SELF-HEAL VERIFICATION`，
且**两边都证**（常规→启动时间戳未变；显式→真的重启并验过 self-heal）。
并强调：「**默认 SKIPPED 不是 PASS**」尤其重要；以后 `DESTRUCTIVE: SKIPPED`
应**继续独立展示**，不参与普通 regression 的 PASS 语义。

---

## 二、⭐ X3 的两处**精度修正**（我的措辞过强，必须改）

### 2.1 不要写"DB connection churn 本身已被证明是根因"

原因：我的实验里 **N 同时改变了多个东西** ——
```
psql 进程创建 ／ 连接 churn ／ DB 工作量 ／ CPU 调度压力 ／ 系统负载 ／ 可能的瞬时连接槽竞争
```
所以正确的冻结方式是（**采纳审核 56 的分层**）：
```
COLD_START_DEGRADES_UNDER_CONCURRENT_DB_CLIENT_LOAD:  PROVEN
SPECIFIC_SUBMECHANISM
  (CPU scheduling vs process churn vs connection churn vs transient slot pressure):
                                                    **NOT ISOLATED**
```
历史事件保持原级别、**不升级**：
```
HISTORICAL_176S_EPISODE_EXPLAINED_BY_CONTENTION: **STRONGLY SUPPORTED**
```
（180s 与 176s、相同启动阶段、相同 `database unreachable` 形态已使归因非常有カ，
但历史那一轮**没有**当时的完整因果观测，故不写 PROVEN。）

### 2.2 ⭐ 我**不能**说"所以问题不在 max_connections=15"

我写的证据是"三档 `conn_before` 都是 2"。审核 56 指出**这不够**：
> worker 是短生命周期 `psql -c`（connect → query → disconnect），
> `conn_before=2` 只是**某个采样时点的稳态快照**，**不能排除**负载期间出现**瞬时连接峰值**。
> 尤其 20 个 worker 对一个 `max_connections=15` + `reserved=3` 的实例施压时，
> **瞬时连接槽竞争是一个合理候选**。
正确的写法：
```
MAX_CONNECTIONS_AS_ROOT_CAUSE:      **NOT ESTABLISHED**
NO EVIDENCE JUSTIFYING RAISING IT:  YES
```
并说明：若后续压力实验里新加的 SQLSTATE 捕获出现 `too_many_connections` 之类，
**反而会成为证据**；只有明确捕获到**其它**连接/调度故障、且连续采样证明峰值远低于上限，
才可以进一步排除。**这不改变操作结论：现在不要提高 max_connections。**

---

## 三、审核 56 建议的 X3 最终账本（照此冻结）

```
X3_CLEAN_COLD_START:                                  PASS
    观察到 11–20s（多次独立清洁启动）
CONCURRENT_DB_CLIENT_LOAD_CAUSES_READINESS_DEGRADATION:
                                                      PROVEN IN CONTROLLED EXPERIMENT
    0 → 13s ／ 8 → 18s ／ 20 → 180s
EXACT_LOW_LEVEL_BOTTLENECK:                           NOT ISOLATED
HISTORICAL_176S_EVENT:                                STRONGLY CONSISTENT WITH /
                                                      SUPPORTED BY CONTENTION MECHANISM
MEMORY_EXHAUSTION_AS_ROOT_CAUSE:                      NOT SUPPORTED BY CLEAN-START EVIDENCE
MAX_CONNECTIONS_AS_ROOT_CAUSE:                        NOT ESTABLISHED
CAPACITY_CHANGE:                                      NOT WARRANTED BY CURRENT EVIDENCE
```
理由（审核 56）：这比"176s 已完全证明由连接 churn 导致"**更经得起以后复审**。

### 容量决策
```
max_connections: UNCHANGED ／ swap: UNCHANGED ／ machine size: UNCHANGED  → 确认正确
```
因为已证明：清洁启动 11–20s、MemAvailable ~216–225MB、swap 增量 0、无 OOM、
应用侧 DB 并发很低 ⇒ **没有证据**支持"机器在正常负载下无法运行"。
而真正该先做的三个工程修复**已经完成**：
```
prevent concurrent gates
+ routine gate no longer deliberately restarts service
+ all restart/deploy callers wait for readiness (not arbitrary sleep / liveness)
```
⇒ 扩容保持为 **SEPARATE OPERATIONS / CAPACITY DECISION**，不是 M5 correctness fix。
以后若正常工作负载下仍频繁出现持续内存压力／swap-in-out／readiness 延迟／
DB 连接饥饿／不可接受的用户延迟，再用**实际容量数据**决定。

---

## 四、WO#14：**已批准，可直接实施**（我不必再等）

审核 56 明确：上一轮已批准我提的四点，因此 **WO14: APPROVED TO IMPLEMENT**：
```
1. MeScreen unified authoritative self identity:            APPROVED
2. narrow session-cache synchronization function:           APPROVED
3. own phone may remain visible:                            APPROVED AS CURRENT PRODUCT BEHAVIOR
                                                            （原版呈现 NOT_EVALUATED）
4. ORIGINAL_ME_SELF_IDENTITY_CONFORMANCE:                   NOT_EVALUATED
```
**并额外要求两个 Gate**（必须加进 WO14 门禁）：
```
ME_FAILURE_NO_STALE_IDENTITY
PROFILE_EDIT_FAILURE_DOES_NOT_MUTATE_SESSION_CACHE
```

⚠️ 我的流程偏差（如实记录）：我上一轮把"提交 WO14 计划等批准"当成了阻塞项，
而审核 55 其实只要求"先 inventory"、审核 56 又说明计划**早已批准** ——
**我多等了一轮**。这正是纪律里"不得以等裁定为由停下"要防的形态。

---

## 五、保留为**方法纪律**的一条（审核 56 建议）

> **"检查失败"只有在执行环境满足该检查的前置条件时，才具有目标性质上的证据价值。**

Windows 上缺 `/srv/campus/.db_password` 导致 server-only Gate 红，
**不是在证明 baseline 有问题，而是在证明调用环境错了**。
这与本项目已建立的一套 validity 是同一套思路：
```
Target validity ／ Fixture validity ／ Origin validity ／ Artifact validity ／ Observation validity
→ 现在再补一条：**Environment validity**（执行环境是否满足该检查的前置条件）
```
落地形态：给 server-only 脚本加**环境守卫**（缺依赖即 ABORT 并说清，而不是刷无关错误）
—— 已在 `check-baseline-integrity.sh` 落地（exit 3）。
