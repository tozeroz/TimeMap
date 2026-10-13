# 敏感度覆盖审计：哪些门禁断言**被证明过能红**？

> 时间：2026-09-22｜Round 267（断电恢复后）｜触发：在我自己最新的门禁上发现自己漏了这条纪律

## 〇、为什么做这个审计

本项目的核心纪律之一是：**断言必须被证明能红**（否则一条恒真断言也会 PASS）。
我在 WO#12–WO#15 各单里都做过敏感度（受控突变 → 变红 → 撤销 → 回绿），
**但在 WO#16 的留言板门禁上漏了** —— 那个门禁跑出 `PASS + INCONCLUSIVE` 就交付了，
**从未证明过任何一条键能红**。

⇒ 顺着这个问题做了一次全量审计：**13 个设备门禁里，到底有几个有"可重复"的敏感度证明？**

## 一、审计方法（机械，可复现）

```bash
# 门禁清单 vs 自测脚本清单
Get-ChildItem scripts/m5 -Filter 'gate-*.mjs'      # 13 个
Get-ChildItem scripts/m5 -Filter 'selftest-*'      # 10 个
# 按 WO 号配对（避免只看文件名相似）
```
⚠️ 我**第一版配对是错的**：用门禁全名去匹配自测名，于是把
`selftest-wo10-gate.mjs` 判成"不覆盖 `gate-wo10-message-screen-mock.mjs`"（其实覆盖）。
⇒ 改成**按 WO 号**配对后才对。教训：**配对规则本身要能被验证**（人工抽查两条）。

## 二、审计结果（2026-09-22，Round 267）

```
13 个设备门禁；**只有 2 个**有"可重复"的敏感度脚本：
  ✓ gate-wo10-message-screen-mock.mjs  ← selftest-wo10-gate.mjs
  ✓ gate-wo15-map-markers.mjs          ← selftest-wo15-card-content.sh
  ❌ 其余 11 个（含我新写的 gate-wo16-board-avatar.mjs）
```

**但这不等于"那 11 个没做过敏感度"** —— 多数在对应轮次里**做过一次性**敏感度并写进了文档：
```
docs/pending/review-log/43-wo7-closed-with-4-corrections.md   : 敏感度 3 处
docs/pending/m5/WO13-PLAN-profile-edit-field-inventory.md     : 2 处
docs/pending/m5/WO9B-PLAN-at-panel-mentions-all.md            : 2 处
docs/pending/review-log/53-wo12-approved-identity-safety…md    : 2 处
docs/pending/m5/WO8-PLAN-message-list-real-backend.md          : 1 处
docs/pending/m5/WO8-PREFIX-FAIL-EVIDENCE.md                    : 1 处
docs/pending/m5/WO9A-PLAN-group-conversation-slice.md          : 1 处
…
```
⇒ **真正的缺口是"纪律存在、但没有机械化"**：做过，但下次无法一遍复现。

## 三、⭐ 本轮的两个具体产出

### 3.1 补上我自己漏掉的那个（`gate-wo16-board-avatar.mjs`）
```
新增 scripts/m5/mutate-board-avatar.mjs：**忠实还原历史 bug**（不是伪造结果）
  ① 加回 import { boardEmojis, me } from '../data/mock'
  ② 把首字占位换回 <img className="note__avatar" src={me.avatar} alt="" />
    （即"每条留言都用同一个 mock 自称身份的头像"）
实跑：
  ① 基线：2 键 PASS                                   EXIT=0
  ② 突变：BOARD_NOTE_AVATAR_NOT_MOCK              **FAIL**（isImg=true 被抓到）
          BOARD_NOTE_AVATAR_INITIAL_MATCHES_NAME  **FAIL**（initial="" 被抓到）
          BOARD_NOTE_AVATAR_TWO_PARTIES_DIFFER    INCONCLUSIVE（样本只有一方，如实）
          BOARD_NO_PEER_COMPOSER_DISABLED         **PASS**（不受此突变影响 ⇒ 归因清晰）
          EXIT=1
  ③ 还原：`git diff --exit-code` = 0（字节一致）⇒ 重跑回到全绿 EXIT=0
```

### 3.2 ⭐ 把三阶段流程抽成**通用驱动**（降低补齐成本）
```
新增 scripts/m5/selftest-mutation.sh
  用法：bash scripts/m5/selftest-mutation.sh <门禁> <突变脚本> <期望变红的键...>
        （环境：MUT_TARGET=<被突变源文件>；GATE_ENV="K=V ..."）
  ⇒ 新增一单的敏感度覆盖成本从"写一个脚本"降到"填三个参数"
  ⚠️ 纪律（与 selftest-wo15-card-content.sh 一致，且都写进了脚本注释）：
     · 突变必须**忠实重现历史 bug**（证明"能抓出接错源"，而非"对空值敏感"）
     · 突变本身必须**语法有效**（否则验的是"构建会不会崩"）
     · 突变阶段必须**重新构建+安装**（run-device-gate.sh 不负责构建）
     · 还原后比 **本自测开始前的 sha256**（不是比 HEAD —— 见下）
```

## 四、⚠️ 本轮踩的坑（都是"我自己的"，且第 3 个很险）

```
① 突变脚本第一版生成 textContent = '')（多一右括号）⇒ tsc 失败 ⇒ 自测在②中断
   ⇒ 那会让自测验的是"构建会不会崩"而**不是**"断言能不能红"
② 自测忘了"重新构建+安装"⇒ 设备跑旧包 ⇒ 无意义结论
③ ⚠️⚠️ **通用驱动第一版用 `grep | head -2` ⇒ 泄漏门禁锁**
   机制：`head -2` 取够 2 行就退出 ⇒ grep 再写吃 SIGPIPE ⇒ **门禁脚本被杀死在半路，
        走不到"释放锁"那一步** ⇒ 服务器 `/srv/campus/gate.lock` 残留。
   实跑证据：`gate-lock.sh status` 显示
     `device-gate:gate-wo16-board-avatar.mjs|320357|…（年龄 197s）` 而**没有任何门禁在跑**；
   下一次门禁直接 FATAL「另一个 Gate 正在运行（互斥锁被占用）」，
   于是通用驱动的③阶段**静默地拿不到 VERDICT**（表现为"还原后没回到全绿"，
   而真实原因与断言无关）。
   ⇒ 修法：**先把输出整个收下来**再本地提取需要行（不提前关管道）；
     并在每个阶段前加**有界等待锁空闲**（wait_lock_free，最多 60s）。
   ⇒ 教训：**在"会自己获取/释放资源的脚本"下游用 head/N 行截断，等于可能把它杀掉。**
     并且：当③失败但①②都过时，要先怀疑**基础设施**（锁/设备/端口），不要先怀疑断言。
④ 清陈旧锁时我用了**完整 owner 串**（含 pid/时间戳/主机名）→ 工具拒绝（它只认前缀）
   ⇒ 用前缀 `device-gate:<gate 文件名>` 才释放成功。
   ⚠️ 但释放前我**先确认了服务器上没有任何门禁进程在跑**（ps 为空）——
     陈旧锁不能盲目 release。
```

## 五、建议（不擅自执行）

```
· 把"通用驱动"接入常规检查？**不建议**自动跑：它每阶段含构建+安装（约 3–6 分钟），
  且会改源码（虽然是受控突变）。建议**在"改动某门禁后"手动跑一次**，并在 WO 报告里给出输出。
· 余下 11 个门禁的敏感度补齐顺序建议（按"断言最可能恒真"排序）：
    gate-wo11-feed-list ／ gate-wo12-user-profile ／ gate-wo13-profile-edit ／
    gate-wo14-me-identity ／ gate-wo8-message-list ／ gate-wo9a-group-slice ／
    gate-wo9b-at-panel-layerA ／ gate-wo7-text-send ／ gate-wo6-tabbar-orientation ／
    gate-composer-coverage ／ gate-wo10（已有脚本，但可迁到通用驱动统一形态）
· ⚠️ 每补一个都需要一个**忠实重现该缺陷**的突变脚本 —— 这是主要成本，
  不能靠"把值弄空"糊过去（那证明不了"能抓出接错源"）。
```
