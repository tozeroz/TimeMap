#!/usr/bin/env bash
echo "=== sites-enabled 里有什么 ==="
ls -la /etc/nginx/sites-enabled/
echo "=== conf.d 里有什么 ==="
ls -la /etc/nginx/conf.d/ 2>/dev/null
echo "=== nginx.conf 的 include 行 ==="
grep -n 'include' /etc/nginx/nginx.conf
echo "=== 生效配置里所有 default_server ==="
nginx -T 2>/dev/null | grep -n 'default_server' 
echo "=== 生效配置里 health 相关 ==="
nginx -T 2>/dev/null | grep -n -A3 'location = /health'
echo "=== 实际请求 ==="
curl -s -m 5 -o /dev/null -w 'root=%{http_code}\n' http://127.0.0.1/
curl -s -m 5 -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1/health
curl -s -m 5 -H 'Host: 8.148.156.146' -o /dev/null -w 'health_hostip=%{http_code}\n' http://127.0.0.1/health
echo "=== 用 server 块名请求 ==="
curl -s -m 5 http://127.0.0.1/health -H 'Host: campus' ; echo
