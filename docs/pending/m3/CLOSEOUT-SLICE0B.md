# M3 Slice 0B 收尾（CLOSEOUT）

> 状态：**CLOSED**（2026-09-21 销项；依据见下）
>
> 销项依据（审核记录 09 点名要这一项在项目记录里明确销项，而不是"默认为已解决"）：
> - `scripts/m2/verify-auth.sh` 已从历史提交**恢复**（内容不改），commit `5f7c9c6`
> - M2 Gate 的认证组已改回调用它，并在脚本里写明"只对 M2 修订可复现"（同 commit）
> - 复现步骤见本文第三节
> - **当前产品未恢复任何 password 功能**：`POST /api/auth/login` → 410、
>   `users.password_hash` 列已删除、`auth.ts` 里没有密码原语。
>   两者同时成立正是审核要求的"保留历史可复现性、不把密码登录带回产品"。
> - Gate 里的机械验证：M3 Gate 第 3.2 组断言 `login_status=410`、`password_col=0`、
>   "发密码后未新增任何会话"、"响应里没有 token 字段"。

> 依据：审核记录 08 的 Slice 0B 裁定
> ```
> PRODUCT_BEHAVIOR: ACCEPTED
> AUTH_UI_INTEGRATION: PASS
> OTP_FUNCTIONAL: PASS
> OTP_VISUAL_CONFORMANCE: NOT_EVALUATED
> SMS_GATEWAY: NOT_INTEGRATED
> TRANSPORT_SECURITY: PASS
>
> CLOSEOUT_REQUIRED:
> - preserve/recover historical M2 auth Gate reproducibility
>   without reintroducing password auth into the current product
> ```

## 一、这次收尾要解决什么

Slice 0B 把 M2 的公开凭证机制（`handle` + `password`）**退休**了。
退休过程中我顺手删掉了 `scripts/m2/verify-auth.sh`（它测的正是那条已退休的契约），
并把 M2 Gate 的认证组改指向 M3 的脚本。

审核指出这有问题：**删掉它就等于抹掉了历史 Gate 的可复现性**。
审计要求是两者都要：

1. **历史 M2 auth Gate 仍然可复现**（回到 M2 修订能重跑出 PASS）；
2. 但**不能**因此把密码登录重新引入当前产品。

这两件事不矛盾，关键是分清"历史"与"当前"：

| | 历史 | 当前 |
|---|---|---|
| 认证契约 | `handle` + `password` + scrypt | 手机号 + 一次性验证码 |
| 断言脚本 | `scripts/m2/verify-auth.sh` | `scripts/m3/verify-auth-otp.sh` |
| 归属 Gate | M2 milestone gate（只对 M2 修订） | M3 gate（对当前部署） |

## 二、采取的措施

1. **恢复 `scripts/m2/verify-auth.sh`**（从历史提交取回，内容不改）。
   它是 M2 阶段的审计产物，不是"过时代码"，不应删除。
2. **M2 Gate 的认证组改回调用它**，并在脚本里写明：
   这组断言只在 M2 修订上可复现；对当前部署运行会（正确地）失败。
3. **当前产品的认证断言留在 M3 Gate**（`slice0b.ps1` → `verify-auth-otp.sh`），
   两者互不替代。

## 三、复现历史 M2 auth Gate 的步骤

**前提**：需要一个与 M2 修订配套的部署（M2 时代的产品契约）。
**禁止**拿当前部署去跑这组断言 —— 它必然失败，且那是预期行为，不是缺陷。

```bash
# 1) 取 M2 收尾的修订（M2 CLOSED 时的提交）
git log --oneline | grep 'M2 closeout'      # 记录：7c6e364（M2 收尾：移除 dev-register）

# 2) 用该修订构建并部署到**隔离环境**（不要覆盖当前产品）
git worktree add /tmp/m2-audit 7c6e364
cd /tmp/m2-audit/server && pnpm install && pnpm build
# 部署到临时实例（例如换端口 + 独立数据库），或直接在该 worktree 上对着
# 一台专用测试机部署

# 3) 在该部署上运行 M2 的历史断言
bash /tmp/m2-audit/scripts/m2/verify-auth.sh      # 期望 AUTH_RESULT PASS

# 4) 清理
git worktree remove /tmp/m2-audit
```

**为什么必须用隔离部署**：`verify-auth.sh` 会真的调用 `/api/auth/login`（当前返回 410）、
并断言 `users.password_hash` 存在（当前已经被删除）。这些断言在 M2 修订上成立、
在当前产品上不成立 —— 这正是"契约被 supersede"的含义。

## 四、为什么这样做是诚实的（而不是"把失败藏起来"）

- **没有**为了"让老脚本继续过"而把密码登录加回产品 —— 那会违反审核记录 08 第 1 点；
- **没有**删掉老脚本假装历史不存在 —— 那会毁掉审计线索；
- 而是把"历史契约的断言"与"当前契约的断言"**各自留在各自阶段的 Gate 里**，
  并写明各自的适用范围。任何一次审计都能看到：M2 当时过的是什么、现在过的是什么、
  以及为什么两者不同。

## 五、与本次收尾相关的其它记录

- M2 的认证历史事实：`docs/pending/review-log/06-m2-verdict-and-m3-go.md`、`docs/pending/m2/SPEC.md`
- 契约变更的裁定：`docs/pending/review-log/08-m3-preflight-slice0a-verdict.md`
- 当前契约的实现与验证：`docs/pending/m3/SLICE0B-REPORT.md`、`scripts/m3/verify-auth-otp.sh`
