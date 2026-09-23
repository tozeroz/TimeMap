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
#   我们用它把证书换成公共信任的（详见 ops/tls/ 与 docs/）。
#
# ⚠️ IP 证书只能用 **http-01 / tls-alpn-01** 验证（IP 不涉及 DNS，没法用 dns-01）
#   ⇒ 必须让 LE 能从**公网 80 端口**取到挑战文件 ⇒ 就是这条 location。
# ⚠️ 它必须**先于下面的 `location / { return 404; }` 生效**：nginx 前缀匹配取最长匹配，
#   本 location 比 `/` 更具体，所以能正确命中；这里放在它前面只是为了让阅读顺序也清楚。
# ⚠️ 只暴露 challenge 目录本身，不暴露其它任何静态文件（`try_files` 兜成 404）。
location /.well-known/acme-challenge/ {
    root /var/www/certbot;
    default_type "text/plain";
    try_files $uri =404;
}

# 临时目录绝不对外可见（上传先用 tmp 再原子 rename）
location ~ ^/(media|_private_media)/\.tmp/ {
    deny all;
    return 404;
}

# 没有任何静态站点与业务路由，其它一律 404，避免误暴露
location / { return 404; }
