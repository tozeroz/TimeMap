#!/usr/bin/env bash
# 配置 Let's Encrypt IP 证书的自动续期，并**实测一次真实续期**
#
# ⚠️ 为什么必须实测续期而不是只配好就走：
#    这张证书只有 ~6 天有效期 ⇒ "续期没验过"等于"6 天后静默失效"。
#    dry-run 虽能验 ACME 流程，但**不执行 deploy-hook**（certbot 明确说明），
#    所以只有真续一次才能证明"续期后 nginx 真的会加载新证书"。
set -uo pipefail
IP=8.148.156.146
CB=/opt/certbot/bin/certbot

echo "=== 1) 给该证书配 deploy-hook（续期成功 ⇒ reload nginx）==="
$CB reconfigure \
  --cert-name "$IP" \
  --webroot \
  --webroot-path /var/www/certbot \
  --ip-address "$IP" \
  --preferred-profile shortlived \
  --deploy-hook "systemctl reload nginx" \
  --non-interactive \
  2>&1 | sed 's/^/  /'

echo
echo "=== 2) 确认 renewal 配置里真的写进了 renew_hook ==="
grep -E 'renew_hook|authenticator|webroot_path|server' "/etc/letsencrypt/renewal/$IP.conf" 2>&1 | sed 's/^/  /'

echo
echo "=== 3) 记录续期前的证书指纹（用于证明续期真的换了证书）==="
BEFORE=$(openssl x509 -in "/etc/letsencrypt/live/$IP/fullchain.pem" -noout -fingerprint -sha256 | sed 's/.*=//')
BEFORE_NB=$(openssl x509 -in "/etc/letsencrypt/live/$IP/fullchain.pem" -noout -startdate)
echo "  续期前 fingerprint: $BEFORE"
echo "  续期前 notBefore  : $BEFORE_NB"

echo
echo "=== 4) 安装并启用 systemd timer ==="
install -m 0644 /tmp/certbot-renew.service /etc/systemd/system/certbot-renew.service
install -m 0644 /tmp/certbot-renew.timer   /etc/systemd/system/certbot-renew.timer
systemctl daemon-reload
systemctl enable --now certbot-renew.timer 2>&1 | tail -2 | sed 's/^/  /'
echo "  --- timer 状态 ---"
systemctl list-timers certbot-renew.timer --no-pager 2>&1 | head -3 | sed 's/^/  /'

echo
echo "=== 5) ⭐ 实测一次**真实**续期（--force-renewal，证明 deploy-hook 生效）==="
$CB renew --cert-name "$IP" --force-renewal --non-interactive 2>&1 | tail -12 | sed 's/^/  /'

echo
echo "=== 6) 校验：证书是否真的换了 + nginx 是否已加载新证书 ==="
AFTER=$(openssl x509 -in "/etc/letsencrypt/live/$IP/fullchain.pem" -noout -fingerprint -sha256 | sed 's/.*=//')
AFTER_NB=$(openssl x509 -in "/etc/letsencrypt/live/$IP/fullchain.pem" -noout -startdate)
echo "  续期后 fingerprint: $AFTER"
echo "  续期后 notBefore  : $AFTER_NB"
[ "$BEFORE" != "$AFTER" ] && echo "  ✓ 证书确实换新了" || echo "  ⚠️ 指纹未变（可能用了同一张）"

sleep 3
SERVED=$(echo | timeout 8 openssl s_client -connect 127.0.0.1:443 -servername "$IP" 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')
echo "  nginx 正在下发   : $SERVED"
[ "$AFTER" = "$SERVED" ] && echo "  ✓ nginx 已加载新证书（deploy-hook 生效）" || echo "  ✗ nginx 还在用旧证书"

echo
echo "=== 7) 续期后公网信任仍然通过 ==="
curl -s -m 12 -o /dev/null -w '  /api/ready  http=%{http_code}  ssl_verify=%{ssl_verify_result}\n' \
  https://8.148.156.146/api/ready 2>&1 | head -2
