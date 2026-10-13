# M0 Anchor（冻结锚点）

> 审核结论：**M0 PASS / CLOSED**（详见 `docs/pending/review-log/03-m0-verdict-and-m1-go.md`）

## 锚点 commit

```
da10163
```

这个 commit 包含 M0 的全部交付物与最终 Gate 记录。此后任何阶段变更都必须能明确回答：
**相对于 M0 anchor 改了什么？**

（获取精确 SHA：`git rev-parse da10163`）

## 冻结时点的 Gate 结论

- 运行环境：干净工作树（`git status --porcelain` 为空）
- 命令：`.\scripts\m0\verify-m0.ps1 -Phase post`
- 结果：**M0_GATE_RESULT PASS**（30 项断言全 PASS，0 FAIL）
- 完整 transcript：`docs/pending/m0/evidence/gate-final.txt`
- reboot Gate：boot_id `c8401851-…` → `19285032-…`（已变化），重启后服务自动恢复

## M0 证明了什么（审核认定的四件事）

| 目标 | 结论 |
|---|---|
| 可重复的服务器基础环境 | PASS |
| Git / scope / secret 治理 | PASS |
| 原版 22 页 scope 已建立（原生分辨率证据） | PASS |
| 后续阶段有机械 Gate 可回归 | PASS |

## 本次冻结的资产清单

| 资产 | 位置 |
|---|---|
| 原版行为基线 22 页（1080×1920 无损 PNG + 九字段 JSON） | `docs/test/original-baseline/` |
| 基线校验和 | `docs/test/original-baseline/SHA256SUMS` |
| 采集环境 metadata | `docs/test/original-baseline/environment.json` |
| 服务器 expected state | `ops/` |
| 环境版本清单 / 起点 / 白名单 | `docs/pending/m0/` |
| 机械 Gate | `scripts/m0/` |
| 证据（资源采样 / 暴露面 / Gate transcript） | `docs/pending/m0/evidence/` |
| 审核记录 01–03 | `docs/pending/review-log/` |

## 未阻断的结转项（审核确认 non-blocking，进入治理清单）

1. **云安全组暴露面契约未纳入 ops/ 自动重建**
   - 期望公网入向：`22/tcp`、`80/tcp`
   - 禁止公网入向：`5432/tcp`、后端内部端口
   - 现实状态已实测正确；治理阶段（部署）明确该契约即可，暂不强上 Terraform
2. **脱敏区域需要被 pixel diff 忽略**
   - `login-sns` 的 `baseline.json` 已加 `evidence_mask`（归一化区域 + 像素框），
     M5 做像素对比时必须跳过该区域，否则会把 `[redacted]` 误判为原版 UI

## 延期取证（Deferred Evidence Acquisition）

下列 3 页在 M0 无法取得原版证据，**记为 not_reproducible + blocked_reason**，
不是 scope 缺失，而是**当前上下文不足**：

| 页面 | M0 事实 | 恢复方式（M3，从真实入口） |
|---|---|---|
| `poi-detail` | deep link 非真实入口，前台回落 TridentActivity | 地图/动态 → 找到带地点的数据 → 点击地点 → 确认真实 navigation → 采集 |
| `media-preview` | 依赖登录态 + 聊天媒体数据 | 建立登录态与聊天数据 → 从消息里的图片进入 → 采集 |
| `at-panel` | 依赖登录态 + 群聊上下文 | 建立群聊上下文 → 从输入框 @ 入口进入 → 采集 |

**硬规则（审核强制）**：

1. M1 **不得**改动这 3 页的验收状态；阶段报告必须始终如实写
   `total 22 / observed 19 / evidence-blocked 3`，绝不允许写成 `19/19`。
2. 现有实现（如 `poi-detail` 已存在于 React 代码里）只能称为
   **current implementation hypothesis**，不得称为 confirmed reproduction。
3. **先恢复原版证据，再实现/验收对应功能**——避免「已经做好了，再找一个基线证明自己对」的确认偏差。
4. **不得覆盖 M0 历史记录**：M3 补采后不要直接把 M0 的 `not_reproducible` 改成 `observed`；
   应通过 `supplements/`（带 `recovered_at` / `recovery_entry` / `supersedes`）追加，
   让审计能解释「M0 为什么没看到」与「M3 如何恢复」。
5. 若 M3 仍无法恢复，最终判定为
   `IMPLEMENTED / ORIGINAL_EVIDENCE_BLOCKED / 1:1 VERDICT = NOT_EVALUATED`，
   **绝不允许**因为「看起来差不多」而自动 PASS。
   届时如实呈现：`19/22 empirically verified 1:1`、`3/22 original evidence unavailable`。
