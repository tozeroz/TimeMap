#!/usr/bin/env bash
# 实测登录流程：请求验证码 → 从 sink 读出 → 用它换 token
# 用途：给你在真机上登录时"取码"用（本项目没有短信通道）
set -uo pipefail
PHONE="${1:-+8613800000001}"

echo "=== 1) 请求验证码 phone=$PHONE ==="
curl -s -m 10 -X POST https://127.0.0.1/api/auth/request-code -k \
  -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}"
echo

echo "=== 2) sink 目录 ==="
ls -ld /run/campus/login-codes 2>&1
ls -la /run/campus/login-codes/ 2>&1 | head -5

echo "=== 3) 读出的验证码 ==="
F="/run/campus/login-codes/$(printf '%s' "$PHONE" | tr -d '+').json"
if [ -f "$F" ]; then
  cat "$F"; echo
  CODE=$(sed -n 's/.*"code":[[:space:]]*"\([0-9]*\)".*/\1/p' "$F")
  echo "  ⇒ code = $CODE"
  echo "=== 4) 用它换 token（验证码确实可用）==="
  curl -s -m 10 -X POST https://127.0.0.1/api/auth/verify-code -k \
    -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" \
    | head -c 400
  echo
else
  echo "  ✗ 没找到 $F"
fi
