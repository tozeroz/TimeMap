新增 M5 服务器侧 Gate；实跑发现一条**间歇性 flaky 断言**（GATE_DEFECT）

【新增 scripts/gates/m5/gate-server.sh】
按 M4 gate 的约定写（KEY[] 关联数组 / PERSISTENT-STAGE-REGRESSION 分层 / `# KEY: PASS` 输出）。
聚合 scripts/m5/ 下四个脚本，输出：
  M5_MEDIA_MESSAGE_API / M5_MEDIAID_STRICT_REJECT / M5_UNATTACHED_TTL_GC
  M5_TMP_SELFHEAL / M5_BOARD_NOTES
  # M5_SERVER_GATE_RESULT: PASS|FAIL
  # M5_OVERALL: OPEN（WO#2 前端未完；后端已 ACCEPTED）

**落实审核记录 24 的要求**：把「复数 mediaIds → 400」做成**独立的 REGRESSION 键**
（M5_MEDIAID_STRICT_REJECT），与总键分开 —— 这样即使其它子项失败，
"防退化"这一项本身仍能被单独观察、单独告警。

Gate 内有一条注释值得留档：**grep 用 ASCII 标记**（匹配 'mediaIds' 与 '400'），
不用中文字符串 —— 因为产物里非 ASCII 会被 esbuild 转义成 \uXXXX，
会造成"其实通过了却判 FAIL"的假阴性（本轮实测踩到过）。

【实跑结果（服务器上）】
  PERSISTENT   PASS
  STAGE        PASS
  REGRESSION   PASS
  M5_MEDIAID_STRICT_REJECT   PASS
  M5_UNATTACHED_TTL_GC       PASS
  M5_TMP_SELFHEAL            PASS
  M5_BOARD_NOTES             PASS
  M5_MEDIA_MESSAGE_API       FAIL   ← 唯一失败项
  M5_SERVER_GATE_RESULT: FAIL

【那唯一 FAIL 的真实原因：脚本的 id 集合断言，且是**间歇性**的】
  实际 613a3080-…,7c645c69-…
  期望 ,7c645c69-…          ← 期望值以逗号开头 = $MSG（A1 的消息 id）**为空**
即脚本在 A1 处**没抓到消息 id**，于是拿一个残缺的期望集合去比较。

**关键判断依据**：紧邻的断言「会话内恰好 2 条消息（全部媒体校验失败都没写入）」是 **PASS**，
说明数据库里确实只有该有的 2 条 —— **产品行为正确**，问题在脚本。
这与上一轮 A7 那次是同一类（当时也是先读原始数据才发现产品是对的）。

**更值得警惕的一点：这次断言是间歇性的** ——
同一个脚本在 18:23 那次跑出来是 `MESSAGE_MEDIA_RESULT PASS`，
18:34 这次却 FAIL。**flaky 断言比稳定失败的断言更危险**：
它可能靠运气通过，从而让真正的问题长期不被发现。

【待修（下一轮）】
  脚本中 A1 的消息 id 捕获（例如 json_field 取 id 在某次响应形状下返回空）：
  修法建议 —— 不要依赖"响应里抓到的 id 变量"来构造期望集合，
  而应改为**从数据库直接取该会话的消息集合**并与"应有 2 条"这一事实对齐，
  或者对 A1 的 id 捕获加断言（抓到空则立即 FAIL 并打印原始响应）。
  同时在脚本里加"开头断言会话为空"之外，再对 `$MSG`/`$MSG2` 非空做前置断言。
