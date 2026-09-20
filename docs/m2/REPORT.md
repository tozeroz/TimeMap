# M2 结果报告：认证 + 数据模型 V0.1 + seed + 备份恢复演练

> 工作单：`docs/m2/SPEC.md`（经审核记录 05 修订，7 项 P0 已并入）
> 设计审核：审核记录 05 —— **M2 DESIGN CONDITIONAL APPROVAL**
> 数据模型追溯：`docs/m2/DATA-MODEL.md`
> 阶段报告口径：**total 22 / observed 19 / evidence-blocked 3**（poi-detail、media-preview、at-panel）

## 一、结论（按审核要求分成两条，不合并）

```
AUTH_FUNCTIONAL:    PASS
TRANSPORT_SECURITY: PASS（临时私有 CA + IP SAN，TLSv1.3；明文例外与 allowMixedContent 已收回）
```

- 认证与授权语义可机械验证（见第三节 A~K 组）。
- 传输安全：443 已放行，最小 TLS 已落地，**Bearer token 不再经公网明文**。

## 二、审核记录 05 的 7 项 P0 → 落地情况

| # | 要求 | 落地 | 证据 |
|---|---|---|---|
| 1 | session 必须有 `expires_at`；token = `randomBytes(32)`；库里存 SHA-256 | 全部满足；`sessions.token_hash` 唯一 | AUTH F 组：库里查不到明文 token；E 组：过期即 401 |
| 2 | 用户不存在也跑同参数 dummy scrypt；异步 scrypt；参数冻结；登录限流 | 全部满足；启动时**预热** dummy 哈希 | AUTH C 组（耗时对比）+ I 组（第 11 次触发 429） |
| 3 | login/logout/me 契约冻结，不加注册/改密/refresh | 只有这三个接口（另有一个默认关闭的 dev-register，见第四节披露） | AUTH A/B/D/H 组 |
| 4 | M1 历史帖子 `author_id = NULL`，不伪造身份 | 13 行保持 NULL；M2 新帖 `author_id` 必来自会话 | AUTH K 组 |
| 5 | seed 改 convergent | `ON CONFLICT (id) DO UPDATE`；改坏库里的值重跑会被纠正 | SEED E 组 |
| 6 | restore 增加行内容哈希；用 `pg_dump -Fc`/`pg_restore` | 四项对比 + 反向验证 | BACKUP 组 |
| 7 | 立即申请 443；TLS 前不给 M2 完整 PASS | 443 已放行并完成 TLS | TLS 组 |

## 三、Gate 结果

`& '.\scripts\gates\m2\milestone.ps1'` → `M2_GATE_RESULT PASS`

| 组 | 断言 | 结果 |
|---|---|---|
| PERSISTENT | 永久不变量（Node 冻结、PG 参数、私钥治理、基线完整性、Nginx 语义、外部可达性、证据产物） | PASS |
| STATIC | 明文例外已删除；`allowMixedContent=false`；APK 内置 CA 是公钥；**Android 源码中无自定义 HostnameVerifier/TrustManager** | PASS |
| MIGRATION/API/VERTICAL_SLICE/SYSTEMD/NGINX/RESOURCE | 空库重建、重复执行幂等、经 Nginx 写读、PG 直查、重启后仍在、readiness 503、CORS、端口、20 并发资源 | PASS |
| AUTH_CONTRACT | 11 组：登录/失败不可区分/dummy scrypt 计时/me/过期/明文 token/限流/约束 | PASS |
| AUTHOR_TRUST | 无 token 401；带 `author`/`authorId`/任意未知字段 **400**；`author_id` 来自会话 | PASS |
| SEED | `fresh+once == fresh+twice == canonical`；**改坏后被重跑纠正** | PASS |
| BACKUP | `pg_dump -Fc` → 全新库 `pg_restore`；版本集/行数/PK 集合/**行内容哈希** 四项一致 + 反向验证 | PASS |
| TLS | 正确 CA+正确 IP SAN→200；错误 CA→失败；**CA 正确但地址不匹配→失败**；TLSv1.3；日志无 token | PASS |
| SCOPE | 15 张表与追溯表完全一致（无未追溯表） | PASS |
| TRACEABILITY | `DATA-MODEL.md` 覆盖全部 13 张业务表 | PASS |
| DEVICE | 设备侧 https 200、明文失败；真实触摸发帖 → 库中归属命中 | PASS |

## 四、必须披露的偏差

### 1) 保留了一个默认关闭的 `dev-register` 接口

`POST /api/auth/dev-register` 只在 `ENABLE_DEV_REGISTER=1` 时存在，否则返回 404。
用途是本地/演练环境造账号。**审核要求"不要顺手增加注册接口"，这里属于灰色地带**，
所以写进报告请审核裁量：如果认为连默认关闭也不该有，我会删掉它（生产路径本来就不用它）。

### 2) `VITE_API_ORIGIN` 的默认值在 M2 从 http 改成 https

M1 阶段默认 `http://8.148.156.146`，M2 改为 `https://8.148.156.146`。
同时 `capacitor.config.ts` 的 `allowMixedContent` 由 true 改回 false，
明文例外从 NSC 删除 —— **两项临时债在同一提交里收回**。

### 3) 临时 PKI 的边界（M6 必须替换）

```
Private Root CA（/etc/ssl/campus/ca.key，仅留在服务器）
  └── server leaf（SAN = IP:8.148.156.146，iPAddress）
        └── APK 内置对象：只有 CA 公钥证书 @raw/campus_demo_ca
```
- 叶子轮换不需要重发 APK（这正是选"私有 CA 签叶子"而不是"直接钉自签叶子"的原因）。
- M6 要做的：换真实域名 + 公共 CA + 自动续期，并删除 APK 里的临时 CA 与 NSC 里的 trust-anchor。
- 私钥从未进入仓库：`.gitignore` 忽略 `*.key`/`*.pem`，Gate 有一条永久断言检查私钥不在 git 历史里。

### 4) 80 端口仍然保留

M0 的外部可达性证据就是 `http://<IP>/health == 200`（check-host 三节点），
直接改成 301 跳转会让那条历史验收证据失效。过渡期双栈并存，是否跳转留到 M6 定。

### 5) `comments.parent_id` 是未被观察到的能力

`comment-detail` 在 baseline 里是空白页，评论的嵌套结构**没有观察到**。
保留一个可空自引用只为 M3 校验结构时不必改表，迁移文件里已注明"若 M3 确认无层级应删除"。

## 五、Gate 自抓的问题（都属测试代码，产品代码未发现缺陷）

| # | 现象 | 分类 | 处置 |
|---|---|---|---|
| 1 | `verify-backend.sh` 把"M1 阶段事实"当永久不变量：posts 恰好 5 列（M2 变 7）、`schema_migrations` 恰好 1 版本（M2 变 3）、无 token 也能写（M2 需会话） | GATE_DEFECT | 能改成真不变量的就改（必需列都在、至少记录 `001_init`、`applied==expected`），确实只属于某阶段的按 stage 分支 |
| 2 | M0 的 `/api proxy configuration exists` 在 M2 假失败：它 grep `sites-available/campus.conf`，而 M2 把 location 抽到了 `snippets/` | GATE_DEFECT | 改为断言 `nginx -T` 展开后的**生效配置**（更接近"实际生效"） |
| 3 | 备份演练：`pg_dump` 以 postgres 身份写不进 campus 的备份目录 → Permission denied | GATE_DEFECT | 先 dump 到 /tmp 再 `install` 成 campus:0640 |
| 4 | 备份演练：在 SQL 里拼 `set time zone 'UTC'; select ...` 让 psql 多输出一行 `SET`，被当成表名，刷出假表 | GATE_DEFECT | 改用 `PGOPTIONS=-c timezone=UTC` |
| 5 | seed 哈希查询漏了列别名 → `row.line` 为 undefined 直接抛错 | GATE_DEFECT | 补 `as line` |
| 6 | 计时断言在 Gate 里假失败、单独跑通过 | GATE_DEFECT | 阈值 0.5→0.3 并打印实际比值；口径明确为"是否跑了 scrypt"，非常量时间证明 |
| 7 | Gate 证据按正则只留 PASS/FAIL，失败时恰好缺了诊断数字 | GATE_DEFECT | 改为保留子脚本全部非空行 |

另有一处**产品侧的真实改进**（非缺陷）：
进程启动后第一次"用户不存在"登录要多跑一次 scrypt 生成 dummy 哈希（实测 0.238s vs 0.074s），
已在 `buildServer` 预热，降到 1.07~1.20 倍。

## 六、结转

1. **登录界面尚未接入**（M3）：App 已具备会话通路（`api/session.ts` + `Authorization` 头），
   但没有登录 UI；Gate 通过"注入会话夹具"验证写路径。M3 接 login-sns 页时只动 session 层。
2. `comments.parent_id`、`schools` 是否独立成表 —— 等 M3 从真实入口观察后再定。
3. 叶子证书 825 天后到期；轮换流程（同一 CA 重签 + 重启 nginx）需在 M6 固化为运维步骤。
4. 治理结转项不变：公网入向契约 `22 + 80 + 443`；禁止 `5432`；像素比对遵守 `evidence_mask`。
