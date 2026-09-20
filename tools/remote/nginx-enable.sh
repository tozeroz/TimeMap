#!/usr/bin/env bash
set -euo pipefail
echo "== 启用 campus 站点（上一版漏了这一步）=="
ln -sf /etc/nginx/sites-available/campus.conf /etc/nginx/sites-enabled/campus.conf
rm -f /etc/nginx/sites-enabled/default
echo "sites-enabled 现在:"
ls -la /etc/nginx/sites-enabled/
echo
echo "== 校验并重载 =="
nginx -t
systemctl reload nginx
echo
echo "== 验证 =="
printf 'root   -> '; curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
printf 'health -> '; curl -s -m 5 -w ' [%{http_code}]\n' http://127.0.0.1/health
printf 'api    -> '; curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1/api/test
