#!/usr/bin/env bash
# 手动部署后端产物（绕过 deploy-server.ps1 —— 该脚本本轮被我发现/踩坑后正在单独修）
#
# 为什么要临时绕过：
#   deploy-server.ps1 里那个 bash here-string 对 **BOM 与 CRLF** 都很敏感
#   （PowerShell 5.1 无 BOM 会按 ANSI 解码中文注释 → 解析失败；
#     CRLF 会让 bash 收到 "pipefail\r" → "invalid option name"）。
#   本轮我修 CORS 缺 DELETE 时正好撞上这两点。
#   为了不让"部署工具本身的脆弱"挡住"修复上线"，这里先用手动步骤把产物送上去。
#   ⚠️ 这不是长期方案：deploy-server.ps1 已单独修好并会在后续提交里验证。
set -euo pipefail

KEY='G:\demo map\TimeMap.pem'
TARGET='root@8.148.156.146'

echo "== 1) 上传产物 =="
scp -i "$KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
  'G:\demo map\server\dist\index.mjs' "$TARGET:/tmp/campus-backend-index.mjs"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
  'G:\demo map\server\dist\seed.mjs' "$TARGET:/tmp/campus-seed.mjs"

echo "== 2) 安装 + 重启 + 等就绪 =="
ssh -i "$KEY" -o BatchMode=yes "$TARGET" 'bash -s' <<'REMOTE'
set -euo pipefail
install -o campus -g campus -m 0750 /tmp/campus-backend-index.mjs /srv/campus/server/dist/index.mjs
install -o campus -g campus -m 0750 /tmp/campus-seed.mjs /srv/campus/server/dist/seed.mjs
rm -f /tmp/campus-backend-index.mjs /tmp/campus-seed.mjs
systemctl restart campus-backend.service
# 就绪轮询：实测这台机器重启后最长约 176 秒才 ready
i=0
while [ "$i" -lt 240 ]; do
  i=$((i+1))
  if curl -sf -m 2 http://127.0.0.1:3001/api/ready >/dev/null 2>&1; then
    echo "  /api/ready 200（等待 ${i}s）"
    break
  fi
  sleep 1
done
if ! curl -sf -m 2 http://127.0.0.1:3001/api/ready >/dev/null 2>&1; then
  echo "  FAIL 240s 内未 ready"
  journalctl -u campus-backend.service -n 20 --no-pager || true
  exit 1
fi
echo "== 3) 核对产物里的 CORS =="
grep -c 'GET,POST,PATCH,DELETE,OPTIONS' /srv/campus/server/dist/index.mjs || true
echo "== 4) 预检核对（DELETE）=="
curl -s -i -X OPTIONS http://127.0.0.1/api/posts/x/like \
  -H 'Origin: https://localhost' -H 'Access-Control-Request-Method: DELETE' \
  | tr -d '\r' | grep -i 'allow-methods' || true
REMOTE
