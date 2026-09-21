# 审核记录 47：WO#9B 计划要求（两层分离 + 权限模型未取证）+ 3 条方法论升级

> 审核方：ChatGPT web；时间：2026-09-22 03:17（Asia/Shanghai）
> 本轮提交：WO#9A 关账说明 + WO#8 门禁补 union + 服务器侧 gate 部署缺口 + WO#9B 计划

## 一、WO#9A：**PASS / CLOSED**（与记录 46 一致，此处为完整键表）

```
WO9A_GROUP_CONVERSATION_VERTICAL_SLICE: PASS / CLOSED
GROUP_THREAD_IN_API / MESSAGE_LIST_SHOWS_GROUP / ENTRY_REACHES_GROUP /
GROUP_MESSAGES_FROM_API / GROUP_MESSAGE_IDENTITY: PASS
GROUP_MEMBER_A_READ_WRITE / GROUP_MEMBER_B_READ_WRITE: PASS
GROUP_NONMEMBER_LIST_HIDDEN / GROUP_NONMEMBER_READ_DENIED /
GROUP_NONMEMBER_WRITE_DENIED / GROUP_NONMEMBER_ZERO_MUTATION: PASS
PRIVATE_GROUP_MEDIA_AUTHORIZATION: PASS
GROUP_HEADER_STRUCTURE / GROUP_HEADER_TITLE_MATCHES_API / GROUP_BACK_NAVIGATION: PASS
WO8_REGRESSION / WO7_REGRESSION / WO6_REGRESSION / M5_SERVER_REGRESSION: PASS
```

审核对本轮架构选择的评价（值得保留）：
> "你选择**共享 ChatScreen** 而不是复制群聊发送/媒体逻辑，是这轮一个很好的架构结果。
>  它意味着 direct/group 的核心 message semantics 现在**共享同一实现面**，
>  后续**漂移风险明显更低**。"

**继续保留、不因 WO#9A 关闭而升级的边界**：
```
GROUP_OWN_MESSAGE_RIGHT:                    CONFIRMED
GROUP_PEER_MESSAGE_LEFT:                    CROSS_CONTEXT_REUSE / NOT_DIRECTLY_OBSERVED
GROUP_SENDER_NAME_PRESENTATION:             NOT_EVALUATED
GROUP_AVATAR_DESTINATION:                   NOT_EVALUATED
GROUP_RIGHT_ACTION:                         NOT_EVALUATED / OUT_OF_SCOPE
GROUP_TIME_SEPARATOR_INSERTION_RULE:        NOT_EVALUATED
```

## 二、WO#8 的两处 Gate 修改：**认可为精度修正，不是放松契约**

### 2.1 认可的理由（原话要旨）

> "原 Gate 隐含了一个**没有被产品 contract 规定**的假设：
>  `UI global order == API global order`。
>  但当前产品有明确的 presentation transformation：
>   `API threads → group/direct 分类 → 每个分区内部呈现`。
>  既然'跨类型是否保持全局时间顺序'**从未被定义为 invariant**，
>  那么要求全局数组完全同序是在**测试测试者自己的排序假设**。"

**必须仍确保的三条**（我原版**漏了第一条**，已补并实测 PASS）：
```
① UI ids union == API ids union          ← 集合级完整性（我原版漏了）
② group UI ids == API group ids          （有序）
③ direct UI ids == API direct ids        （有序）
且每个分区内部：no missing / no extra / no substitution / order preserved
```

### 2.2 ⭐ 命名细化（已落实）

> "我甚至建议把名字从泛化的 `IDENTITY_CONTINUITY` 进一步细化为
>  `THREAD_IDENTITY_SET_CONTINUITY` 与 `THREAD_SECTION_ORDER_CONTINUITY`，
>  这样以后**不会再把'身份连续'与'全局展示排序'混成一个概念**。"

**已改并实测两条均 PASS**（commit `4f7caaf`）：
```
THREAD_IDENTITY_SET_CONTINUITY   —— UI id 集合 == API id 集合（不漏/不多/不替换）
THREAD_SECTION_ORDER_CONTINUITY  —— 每个分区内部的顺序与 API 一致
（全局跨类型顺序**不是** contract，故不断言）
```

### 2.3 第二处修改（点第一行 → 显式点 direct 行）同样认可

> "群聊加入以后，'DOM 第一行'已经**不再稳定代表** direct conversation。
>  继续点击第一行反而让 WO#8 开始**无意测试 WO#9A**。"

**由此升华出一条长期测试原则**：
```
测试对象应通过**稳定的业务身份/语义**选择，不应通过**偶然位置**选择。
优先：thread UUID / kind / data-testid / semantic role
避免：第一个 / 第 N 行 / 数组下标 0
除非"第一项"**本身就是产品 contract**。
```

## 三、⭐ 三个 harness bug 升级为**长期方法论**

审核认为我列的 6 个 bug 都不阻塞关账，但其中三类值得进入方法论：

### 3.1 Oracle contamination（证据污染）

> "多个角色复用同一个临时文件，后一个 observation 覆盖前一个。
>  以后多 actor Gate 应默认：**one actor → one evidence artifact**。
>  **不要复用可变 evidence sink。**"

→ 已落实为纪律：每个 actor / 每个断言各自留证（WO#9A 授权矩阵已按此改：
`/tmp/wo9a_read_a.json` / `_b.json` / `_c.json`）。

### 3.2 Authoritative identity oracle（身份必须来自权威源）

> "不猜 localStorage key。身份继续**统一来自 `/api/auth/me` 或服务端/DB**。"

→ 已落实：断言取 token 用真实 key `campus.demo.session.v1`，但"我是谁"**由 `/api/auth/me` 回答**。

### 3.3 ⭐ Origin validity（相对 URL → Capacitor localhost）—— 升级为**机械前置**

> "这是**已经第二次**发生的相对 URL → Capacitor localhost 问题。
>  建议把它从'个人经验'升级成**机械 precondition**：
>  ```
>  API_E2E_ORIGIN_VALIDITY:
>      request URL origin == configured backend origin
>  ```
>  关键 API E2E 如果捕获到 **`text/html`**，也应该**直接 FATAL**，
>  而不是继续 `json()` 后让 `{}` 污染后续判断。"

→ **本记录之后立即实现**（见 PLAN 的对应小节）：
```
1. 所有设备侧 Gate 的关键 API 调用**必须用绝对 origin**（https://8.148.156.146）
2. 断言层加机械前置：若响应 content-type 含 text/html → **FATAL**，不进入 json() 解析
3. 把该前置写进 run-device-gate.sh（作为与 VISUAL_TARGET_VALIDITY 并列的 setup precondition）
```

## 四、⭐ WO#9B 的计划要求（**已据此修订计划**）

### 4.1 前提已成立（审核确认）

> "现在前置条件终于成立：real group + real members + real group messages +
>  real membership authorization + real UI entry，
>  所以 AT **不再是在 mock 页面上做假功能**。"

### 4.2 必须**两层分离**（审核原话要旨）

> "WO#9B 报计划时，我建议把两个层次明确分开：
>  **A. AT_PANEL / mention selection UI**
>  **B. mentions_all persistence / message semantics**"

→ 已修订计划为两层，**各自独立的 Gate 与状态键**（任一层的未知不被另一层的 PASS 掩盖）。

### 4.3 必须先冻结的 5 个问题（计划 §三 已逐一给立场）

```
1. mentions_all 是独立 boolean，还是 mention records 的一种特殊形式？
2. 非 group thread 是否必须拒绝 mentions_all？
3. ⚠️ **普通 member 是否都能 @所有人，还是原版存在 role restriction？**
4. API 接收 mentions_all 后，读模型如何返回？
5. reload 后是否仍保留？
```

### 4.4 ⚠️ 第 3 问是**最重要的边界**（审核特别强调）

> "**不要因为原版存在 AT panel 就推断所有成员都具备 @all 权限。**
>  你现在的 `thread_members` **没有角色列**，而原版是否限制 @所有人的资格
>  目前**如果无证据**，就**不能偷偷定义'所有成员都能 @all'并称为 conformance**。
>  因此下一单最好先做：**现有证据能确定的 AT UI + 数据持久化语义**；
>  任何'谁有权限 @所有人'的未知部分**单独标 NOT_EVALUATED**，除非你已有直接证据。"

→ 已落实：`AT_ALL_PERMISSION_MODEL: NOT_EVALUATED`，实现上只做"**是群成员即可用**"的**最小选择**，
   并明确标注为**我方设计选择**而非 conformance。

## 五、最终状态（审核给定）

```
WO#9A: CLOSED
REAL GROUP FOUNDATION: ESTABLISHED
NEXT: WO#9B AT PANEL / MENTIONS_ALL
GROUP MANAGEMENT / ROLES: 仍独立 OUT OF SCOPE
```
