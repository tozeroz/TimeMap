# 共用 location（80 与 443 两个 server 块 include 同一份，避免两处配置漂移）
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

# 没有任何静态站点与业务路由，其它一律 404，避免误暴露
location / { return 404; }
