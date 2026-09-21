# 审核记录 14：M3 Final Gate 通过、M3 CLOSED、M4 批准开工

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 14:21（Asia/Shanghai）
> 提交物：两项 closeout 的修复与验证 + 新 HEAD 上的三层 Final Gate 重跑

## 正式状态

```
M3 Final Gate — PASS
M3 — ACCEPTED / CLOSED
M4 — APPROVED TO START
```

审核原话（要点）：两个 closeout 都真正销项，且是在**新的 HEAD 上重新执行三层 Final Gate**
后得到 PASS，不是"文档补写后沿用旧结果"，因此接受作为 M3 的最终冻结状态。

## 一、两个 closeout 的判定

### 同名地点歧义：CLOSED

> 0 个 → NULL / 1 个 → bind / >1 个 → NULL 是正确语义；
> 尤其"歧义帖子不能出现在任一同名地点聚合列表"这一反向断言，
> 把最危险的静默错误覆盖到了。

### board_notes：CLOSED

> 现有只读证据足够支持产品层面的结论：
> board note 是面向另一用户的、双方可见的私密留言关系，而不是 post/place 的子资源。

## 二、两条文档层面的细化（不要求返工，但必须记录）

### 1. 认识论边界（关于 board_notes 的结论强度）

> 这些证据支持行为/领域语义上的独立 user↔user board-note relation，
> **不证明原版后端内部一定用了独立 board_notes 表**而不是某种内部 thread 实现。
> 这不影响你自己的 `board_notes(from_user_id, to_user_id, ...)` 建模，也不影响 M3 CLOSE。

**为什么重要**：我们观察到的是**界面行为与领域语义**，
不是对方的**服务端存储结构**。前者能支撑"该怎么建模"，
后者我们本来也看不到（只读观察看不到别人的表）。
把结论写成"原版有一张 board_notes 表"就是**超出证据的断言**。

### 2. 证据权重（关于第 3、4 条证据的性质）

> 你列的第 3 条"resource-id 里没有 post/place 痕迹"和第 4 条"deep link 无参数"
> 属于**辅助证据**，不要单独承担排除性证明；
> 真正强证据是"仅双方可见""给同学留言"以及页面整体交互对象。

**这条是方法论提醒，值得记住**：
- **强证据** = 直接表达语义的文本/交互对象（「仅双方可见」「可以给同学留言噢」）
- **弱证据** = 命名、可达性这类间接线索（没有 `post_id` 字样、deep link 无参数）——
  它们可以**支持**结论，但不能**单独**排除其他解释
  （命名可能不反映真实关系；无参数可能是默认指向"我"）

两处已按此修正文档：`MODEL-VALIDATION.md` §2.8 与
`supplements/message-board.json` 都标明了强弱分层与认识论边界。

## 三、M3 的最终语义边界（审核确认）

审核接受两维报告，并确认这解决了最大的潜在误读：

```
BASELINE_PAGE_COVERAGE:  22 / 22 observed
CONFORMANCE_EVIDENCE:    admissible / inadmissible / blocked
```

> 22/22 observed **不等于** 22/22 strict 1:1 conformance verified。

同时明确保留：OTP 页视觉未评估；at-panel / media-preview 证据不可采信；
若干原版写入 transition 被政策阻断；geolocation 偏差；media 留到 M4。
因此 **M3 PASS 没有过度声明**。

## 四、M4 的启动方式（审核同意）

> 第一份 M4 工作单先拿 PLAN §6 的冻结（图片存储设计），
> 逐条回答那 7 条边界，再动手实现。

7 条边界（审核记录 13 提出，M4 工作单 #1 必须逐条给出明确答案）：

1. 数据库存 metadata/reference，**不把任意客户端路径当存储地址**
2. 上传文件名由**服务器生成**，不信任客户端 filename/path，防路径穿越
3. 不只信 Content-Type，要**按实际内容确认**图片类型，并限制单文件大小/请求体大小
4. 定义 DB row 与文件之间的**失败原子性**（DB 成功文件失败 / 反之 → orphan 处理）
5. 这台服务器只有 20 GB 磁盘 → 必须定义 **disk-full / quota / orphan cleanup** 行为
6. **公共动态图片与私有聊天图片不能自动采用同一访问控制** ← 审核标注"最重要"：
   聊天媒体不能因为 Nginx 能静态下发就变成"拿到 URL 谁都能读"
7. **`pg_dump` 已经不能单独代表完整 M4 backup**：媒体二进制在 PG 外，
   M4 必须新增 **DB + media store 联合恢复**证据
