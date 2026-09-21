#!/usr/bin/env bash
# 复现 verify-message-media.sh 的登录（找出"登录失败"的确切原因）
set -uo pipefail
BASE=http://127.0.0.1
SINK=/run/campus/login-codes

echo "=== 0) 清空 sink（与该脚本第 72 行一致）==="
rm -f "$SINK"/*.json 2>/dev/null || true
ls -la "$SINK" 2>&1 | head -5 | sed 's/^/  /'

login() {
  local phone="$1" req sink code
  req="$(curl -s -m 10 -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$phone\"}")"
  echo "    request-code 响应: $req" >&2
  sink="$(printf '%s' "$req" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
  echo "    解析出的 sink: [$sink]" >&2
  if [ -n "$sink" ] && [ -f "$sink" ]; then
    code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink")"
    echo "    从 sink 读到的 code: [$code]" >&2
  else
    echo "    **sink 不存在或为空** → code 会是空" >&2
    code=""
  fi
  local resp
  resp="$(curl -s -m 10 -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}")"
  echo "    verify-code 响应: $resp" >&2
  printf '%s' "$resp" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

echo
echo "=== 1) 用脚本同样的方式生成两个随机手机号 ==="
PA="139$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
PB="137$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
echo "  PA=$PA  (长度 ${#PA})"
echo "  PB=$PB  (长度 ${#PB})"

echo
echo "=== 2) 登录 A ==="
TA="$(login "$PA")"
echo "  TA=[$TA]"
echo "  --- sink 目录现状 ---"
ls -la "$SINK" 2>&1 | head -6 | sed 's/^/    /'

echo
echo "=== 3) 登录 B ==="
TB="$(login "$PB")"
echo "  TB=[$TB]"

echo
echo "=== 4) 结论 ==="
if [ -n "$TA" ] && [ -n "$TB" ]; then
  echo "  PASS 两个账号登录成功（未复现失败）"
else
  echo "  FAIL 复现了登录失败 —— 即根因在服务端/环境，与本轮改动无关"
fi

echo
echo "=== 5) 顺带：生成的随机手机号形态分布（跑 5 次看是否有异常）==="
for i in 1 2 3 4 5; do
  P="139$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
  echo "    $P  长度=${#P}"
done
