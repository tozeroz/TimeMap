#!/usr/bin/env bash
echo "=== 生效配置里的 server 块概览 ==="
nginx -T 2>/dev/null | grep -nE '^\s*(server \{|listen |server_name |root |location )' | head -40
echo
echo "=== campus.conf 是否被包含 ==="
nginx -T 2>/dev/null | grep -c 'campus-gateway' || true
echo
echo "=== 强制重启 nginx ==="
systemctl restart nginx
sleep 1
systemctl is-active nginx
echo
printf 'health -> '; curl -s -m 5 -w ' [%{http_code}]\n' http://127.0.0.1/health
printf 'root   -> '; curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
echo
echo "=== nginx 错误日志尾部 ==="
tail -5 /var/log/nginx/error.log 2>/dev/null || echo "(无)"
