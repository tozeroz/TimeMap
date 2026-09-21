# 共用 location（80 与 443 两个 server 块 include 同一份，避免两处配置漂移）
#
# ⚠️ 这份文件此前只存在于服务器上，未纳入 git —— M4 起把它纳入版本控制。
#    部署方式：tools/deploy-server.ps1 会把它推到 /etc/nginx/snippets/campus-locations.inc
#
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
# 而且这不是"以后再补鉴权"能补的：文件一旦按静态资源下发过，
# 就已经脱离应用层的可见性判断了。
# ---------------------------------------------------------------------------

# 公共动态图片：**公开内容，静态下发**（CDN 友好、不过 Node 转发）
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
    }
    default_type application/octet-stream;
}

# 私有聊天/群聊媒体：**internal** —— 外部直接访问一定会失败
# 只有后端用 X-Accel-Redirect 内部重定向才能命中这里。
# 后端先做「会话 + can_read_media」判定，Nginx 只负责搬字节（396MB 机器上很重要）。
location /_private_media/ {
    internal;
    alias /srv/campus/uploads/private/;
    autoindex off;
    # 私有内容不允许任何缓存（含中间代理）
    add_header Cache-Control "private, no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
    types {
        image/jpeg jpg jpeg;
        image/png  png;
        image/webp webp;
    }
    default_type application/octet-stream;
}

# 临时目录绝不对外可见（上传先用 tmp 再原子 rename）
location ~ ^/(media|_private_media)/\.tmp/ {
    deny all;
    return 404;
}

# 没有任何静态站点与业务路由，其它一律 404，避免误暴露
location / { return 404; }
