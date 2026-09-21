# FINDING：前端部署现状核实 + WO#8 提案（AT 面板 / @所有人）

> 时间：2026-09-22 02:24｜Round 258

## 一、核实：前端**没有**以网页形式部署到服务器（一处需澄清的边界）

### 证据（只读）

```
/etc/nginx/snippets/campus-locations.inc 第 98-99 行：
    # 没有任何静态站点与业务路由，其它一律 404，避免误暴露
    location / { return 404; }
```
站点配置 `/etc/nginx/sites-enabled/campus.conf` 的两个 server 块（80/443）都只 `include` 这份 snippet，
**没有任何 `root` / `alias` 指向前端静态产物**；服务器 `/srv/campus/` 下也没有 web 产物目录
（只有 `server/`、`uploads/`、`backups/` 与密钥文件）。

### 结论（如实表述）

```
服务器上部署的是：PostgreSQL 18.6 + Node 后端(Fastify) + Nginx(网关/媒体) + systemd(campus-backend.service)
前端：**未以网页形式部署**；以 **Android APK**（com.campusx.demo）形式在 MuMu 模拟器上构建与验证
```

### 这与目标措辞的关系

目标写的是"拥有独立前后端的完整项目并部署到阿里云服务器
（**8.148.156.146，Ubuntu 26.04，PostgreSQL + Node 后端 + Nginx + systemd**）"：
- **括号里点名的部署对象 = 后端栈**（PG / Node 后端 / Nginx / systemd）→ **当前状态符合**
- "独立前后端" = 架构上前后端分离（前端 Capacitor 应用 + 后端独立 API）→ **符合**
- ⚠️ 但"是否**也**应把前端 web 产物部署成网页（供浏览器直接访问）"**目标没有明说**

→ **按纪律：这是产品决策，不自己猜**（见 §三 待审核裁定）。

### 若将来要部署，成本与风险（先记下来，供裁定参考）

```
成本：低 —— vite build 产物是纯静态；加一个 nginx location + rsync/scp 即可
风险/待决：
  · 前端目前默认把 API 指向 https://8.148.156.146（同源的话可改为相对路径，更干净）
  · 登录走手机号 + 验证码，而本项目**没有短信通道**（验证码投递到服务器上的 dev sink）
    → 网页版若公开可达，任何人拿到 dev sink 就能登录；这是**演示环境**，需明确不对外
  · HTTPS 用的是**临时私有 CA**（自签），浏览器会警告 —— 网页版体验会受影响
```

---

## 二、WO#8 提案：**AT 面板 + @所有人**（先报计划，不动产品代码）

### 2.1 为什么选它（按审核"按当前账本选"的规则筛）

```
① 原版证据强且可复现 —— 已在 Round 257 取得（静态 APK，可采信）：
     string/at_all              = 「所有人」
     string/at_panel_title      = 「选择提醒的人」
     string/at_panel_empty      = 「暂无群成员」
     string/at_panel_loading_failed = 「加载失败」
     layout/activity_group_at_panel → res/XZ.xml（底部弹层，列表固定 500dp）
     layout/item_at_panel_at_all    → res/KW.xml（行高 88dp、图标 56dp、标签 16sp）
     layout/item_at_panel_member / item_at_panel_section_header（分组标题）
② 当前缺失可确证 —— 我方 AT 面板**没有「所有人」项**
③ 实现语义基本明确 —— 面板形态/文案/几何都有证据
＋ 用户高频可达（群聊里发 @ 就会用）＋ 用户可见影响大 ＋ 不依赖第三方写操作 ＋ 无新依赖
```

### 2.2 范围（**严格限定**）

```
做:
  1. AT 面板按证据呈现：**底部弹层**、标题「选择提醒的人」（16sp bold 居中）、
     关闭按钮（accessible name「关闭」）、列表、空态「暂无群成员」、失败态「加载失败」
  2. **「所有人」项**：行高 88dp、前置图标 56dp×56dp、标签 16sp、
     图文间距 12dp（全部来自 res/KW.xml 的声明值）
  3. 选中「所有人」后把它作为**一个显式的"全体提及"**加入消息（见 2.3 数据模型）
  4. 分组标题（item_at_panel_section_header 存在 → 呈现时保留该结构）
不做（明确排除）:
  · ❌ 不改 composer / 不改消息气泡
  · ❌ 不猜**面板的打开方式**（原版是"点某处打开"还是"输入 @ 自动打开"？**未取证**）
     → 先按"我方提供可达入口"实现，并把触发方式标 `AT_PANEL_TRIGGER: NOT_EVALUATED`
  · ❌ 不做 `at_all` 之外的其它面板交互（如搜索、多选上限——无证据）
```

### 2.3 ⚠️ 数据模型：这是**我方设计决定**，不是"复刻"

AUDIT 里我方代码注释的担忧**仍然正确**：

> "绝不能伪造成某个 user id（那会让'提到全体'与'提到某人'在数据上无法区分）"

而**原版服务端如何表示"提到全体"未知**（要观察网络请求/服务端数据，当前只读范围内不可得）。

```
拟采用（我方设计决定，需审核批准）：
  messages 增加 **mentions_all boolean NOT NULL DEFAULT false**
  → 与既有 message_mentions（逐人）**并存但不混同**
  · @所有人 → mentions_all = true，且**不**写任何 message_mentions 行
  · 同时保留了"明确提到某人"的语义，两者在数据上可区分
约束（Gate 会机械验证）:
  · mentions_all = true 时，该消息的 message_mentions 必须为 0 行
    （否则"全体"与"逐人"会同时存在 → 语义不清）
  · 非群聊（direct）不允许 mentions_all = true（"全体"在两人会话里没有意义）
必须标注:
  AT_ALL_SERVICE_REPRESENTATION: OUR_DESIGN_CHOICE / ORIGINAL_UNKNOWN
  —— 不得声称"与原版一致"
```

### 2.4 Gate（须可失败）

```
改前（当前状态）:
  · 断言"AT 面板里存在「所有人」项" → 必须 **FAIL**（当前确实没有）
（按审核 43：REQUIRED 是**受控敏感度测试**——破坏 invariant → FAIL/nonzero；恢复 → PASS/zero）
改后:
  AT_PANEL_TITLE_TEXT       标题逐字 = 「选择提醒的人」
  AT_ALL_ITEM_PRESENT       面板中存在「所有人」项
  AT_ALL_ITEM_GEOMETRY      行高/图标/字号与声明值一致（设备实测，单位冻结为 CSS px）
  AT_PANEL_EMPTY_STATE      空群时显示「暂无群成员」
  MENTIONS_ALL_DB           DB oracle：选中后 mentions_all=true 且 message_mentions 行数 = 0
  MENTIONS_ALL_NO_FAKE_ID   反例断言：**不得**出现"伪造的 user id"（既有纪律）
  DIRECT_THREAD_REJECT      direct 会话不允许 mentions_all（4xx）
  COMPOSER_REGRESSION       composer 未被破坏；既有 text/image/voice 路径不受影响
  SERVER_REGRESSION         M5 gate 全绿
```

### 2.5 待审核裁定

```
1. 前端**是否也要以网页形式部署**到服务器？（§一 的澄清）
   —— 若"要"，我建议单独立单（涉及 dev sink 暴露面与自签证书体验两个问题）
2. **是否批准 WO#8（AT 面板 + @所有人）**？
3. §2.3 的数据模型（mentions_all boolean + 两项约束）是否认可？
4. "面板打开方式（触发方式）未取证"这一点，是否同意先实现可达入口 + 标 NOT_EVALUATED？
```
