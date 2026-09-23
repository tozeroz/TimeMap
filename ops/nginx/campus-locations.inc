# 共用 location（80 与 443 两个 server 块 include 同一份，避免两处配置漂移）
#
# ⚠️⚠️ Round 319 修正：本文件此前与**服务器上的实际内容不一致** ——
#   仓库里只有 23 行（仅 /health、/api/、404），而服务器上是 99 行（含 /media/、
#   /_private_media/、.tmp 守卫）。而本文件顶部原本就写着"唯一真源 = 本仓库"。
#   后果：**若从仓库重建服务器，公共图片与私有媒体会全部失效**（/media/ 不存在 ⇒ 404）。
#   ⇒ 处置（本轮 WO#23 的副产物，如实记录）：把**服务器上的实际内容**取回并**纳入本文件**，
#     使"唯一真源 = 本仓库"这句话**重新为真**；此后新增的 location 也在这里定义。
#   ⚠️ 教训（与"验证产物"同源）：**文档声称的单一事实来源，必须被机械校验**，
#     否则它就会像这次一样，悄悄地不再是事实。

# 语义隔离（审核点名，不能用一个 /health 假装证明三件事）：
#   /health      → Nginx 自己回答：证明「网关活着」
#   /api/health  → 反代到 Fastify：证明「后端进程活着」
#   /api/ready   → 反代到 Fastify：证明「能连 PG 且迁移就绪」，不满足返回 503

location = /health {
    default_type application/json;
    return 200 '{"status":"ok","service":"campus-gateway","stage":"M0"}';
}

location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ---------------------------------------------------------------------------
# M4 媒体：**两个命名空间，两条完全不同的访问控制链**
#
# 依据：审核记录 13 第 6 条（"公共动态图与私有聊天图不能自动采用同一访问控制"，
#       审核标注"最重要"）+ 审核记录 15 的 X-Accel 建议。
#
# 为什么必须分开：如果私聊图片也落在被静态 alias 的目录下，
# **任何拿到 URL 的人都能读** —— URL 就成了唯一凭证，没有会话校验、
# 没有会话成员校验、也没有"消息撤回后不该再可读"的控制。
# ---------------------------------------------------------------------------

# 公共动态图片/语音：**公开内容，静态下发**（CDN 友好、不过 Node 转发）
location /media/ {
    alias /srv/campus/uploads/public/;
    autoindex off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options "nosniff" always;
    # 只按扩展名给类型，不给任何可执行/脚本类型
    types {
        image/jpeg jpg jpeg;
        image/png  png;
        image/webp webp;
        audio/webm webm;
    }
    default_type application/octet-stream;
}

# 私有聊天/群聊媒体：**internal** —— 外部直接访问一定会失败
# 只有后端用 X-Accel-Redirect 内部重定向才能命中这里。
location /_private_media/ {
    internal;
    alias /srv/campus/uploads/private/;
    autoindex off;
    add_header Cache-Control "private, no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
    # CORS：**必须**加上，否则前端拿不到私有图（实测踩到的坑）
    # X-Accel-Redirect 的响应由 Nginx 直接生成，不携带 Fastify 的 CORS 头。
    add_header Access-Control-Allow-Origin $http_origin always;
    add_header Access-Control-Allow-Credentials "true" always;
}

# ⭐⭐ WO#23（Owner 裁定 ③：App 自更新必须实现体验等价）：
#    托管本 App 自己的安装包，让「立即更新」有**真的**可下载的东西。
#
# 为什么放这里而不是走 /api/：
#   · APK 是**静态大文件**（~11MB），没有必要经 Node 转发（与 /media/ 同一考虑）
#   · 下载不应要求会话（用户在"检查更新"时可能还没登录）
#
# ⚠️ 访问控制的口径（如实说明）：**本目录是公开可下载的**（与 /media/ 同类）。
#    它只放**我们自己的 demo APK**，不含任何用户数据。
#    ⇒ 若将来要限制，应改为带签名的临时 URL —— 那属发布流程，不在本轮范围。
#
# ⚠️ 类型：APK 的 MIME 必须是 application/vnd.android.package-archive
#    （若给成 octet-stream，某些浏览器/下载器会拒绝把它识别为可安装包）。
location /download/ {
    alias /srv/campus/downloads/;
    autoindex off;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options "nosniff" always;
    types {
        application/vnd.android.package-archive apk;
        application/octet-stream bin;
    }
    default_type application/octet-stream;
}

# ⭐ ACME 挑战目录（Let's Encrypt 签发/续期用）
#
# 背景：本项目的后端用 HTTPS，但证书原本是**自建私有 CA 自签**的 ——
#   App 能用是因为 APK 里内置了那个 CA；而**浏览器不认** ⇒ 网页端必然报证书错误。
#   2026 起 Let's Encrypt 正式支持给**纯 IP** 签发公共信任证书（无需域名），
#   我们用它把证书换成公共信任的（详见 ops/tls/ 与 docs/TLS-IP-CERTIFICATE.md）。
#
# ⚠️ IP 证书只能用 **http-01 / tls-alpn-01** 验证（IP 不涉及 DNS，没法用 dns-01）
#   ⇒ 必须让 LE 能从**公网 80 端口**取到挑战文件 ⇒ 就是这条 location。
#
# ⚠️⚠️ 用 `^~` 而不是普通的 `location`（这是 WO#25 引入 SPA 后**必须**的改动）：
#   nginx 的匹配规则是「前缀匹配选最长」**但正则匹配会盖过普通前缀匹配**
#   （只有 `^~` 前缀能在命中后**跳过正则**）。
#   我们下面新增了 `location ~ /\.` 来拒绝点文件（原来靠 `location / { return 404; }`
#   顺带挡住）—— 而 `/.well-known/acme-challenge/...` **本身就是一个点开头的路径**，
#   若不用 `^~`，正则会抢先命中 ⇒ **ACME 挑战被拒 ⇒ 证书续期直接失效**。
#   ⇒ 这类"一个改动悄悄打断另一条链路"的风险，靠的是**显式优先级**而不是运气。
# ⚠️ 只暴露 challenge 目录本身，不暴露其它任何静态文件（`try_files` 兜成 404）。
location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
    default_type "text/plain";
    try_files $uri =404;
}

# 临时目录绝不对外可见（上传先用 tmp 再原子 rename）
location ~ ^/(media|_private_media)/\.tmp/ {
    deny all;
    return 404;
}

# 拒绝**点文件**（如 .env、.git/*、.db_password 之类）。
# ⚠️ 为什么需要它：改前 `location / { return 404; }` 顺手挡住了所有点路径；
#   引入 SPA 后 `/` 变成静态托管 ⇒ 若不显式拒绝，托管目录里将来出现点文件就会被下发。
# ⚠️ 用 `(?!well-known)` 负向断言排除 ACME 目录，**并且**上面那条已用 `^~` 保底
#   （双保险：即便有人改动这里的正则，ACME 也不会因此失效）。
location ~ /\.(?!well-known) {
    deny all;
    return 404;
}

# ⭐⭐ 网页端 SPA（WO#25：用户要求"双端"—— 手机端 APK + 网页端）
#
# ════════════════════════════════════════════════════════════════════════════
# ⚠️ 这行改动**撤掉了一道原有的保护**，如实记录
# ════════════════════════════════════════════════════════════════════════════
# 改前这里是：`location / { return 404; }` —— 注释写着
#   「没有任何静态站点与业务路由，其它一律 404，避免误暴露」。
# 这是一条**保守的默认拒绝**。现在要做网页端，就必须把它换成"托管前端产物"。
# ⇒ 我没有假装这个变化不存在，而是：
#   ① 只托管**一个目录** `/srv/campus/web`（前端构建产物），不托管其它任何路径
#   ② `autoindex off` —— 绝不列目录
#   ③ **显式拒绝点文件**（见上面的 `location ~ /\.`）—— 改前是"顺带"挡住的，
#      现在必须**显式**挡，否则托管目录里将来出现 .env/.git 就会被下发
#   ④ 用 `try_files ... =404` 而**不是**回退到 index.html：
#      ⚠️ 我们用的是**自写 hash 路由**（路径形如 `/#/campus`），**路径部分永远是 `/`**，
#         所以**不需要** history fallback。
#         反过来，如果写成"找不到就返回首页"，会让**任何拼错的路径都返回 200**，
#         从而掩盖真实的配置/部署错误 —— 那是"让错误看起来像正常"的典型。
#
# ⚠️ 安全边界（明确写下，避免日后误解）：
#   · 前端是**公开可访问**的（任何人打开 https://<IP>/ 都能看到登录页）
#   · 业务数据仍受**会话鉴权**保护（未登录只能到登录页）
#   · 这是"托管一个公开 demo 前端"的**有意选择**，不是疏忽
#
# ⚠️ 三个 location **平铺**写，不嵌套：nginx 支持嵌套 location 但很少见、易踩坑
#   （例如嵌套块内的匹配规则与外层叠加时的行为不直观）。
#   这里内容简单，平铺最不容易出错。
#   注意：`index index.html` 会触发**内部重定向**到 `/index.html`，
#   所以下面 `location = /index.html` 能命中它 ✓。
location = /index.html {
    root /srv/campus/web;
    add_header Cache-Control "no-cache" always;
}

# 带哈希名的不变资源 ⇒ 可长缓存
location /assets/ {
    root /srv/campus/web;
    autoindex off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location / {
    root /srv/campus/web;
    index index.html;
    autoindex off;
    try_files $uri $uri/ =404;
}
