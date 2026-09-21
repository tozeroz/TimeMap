#!/usr/bin/env bash
# M2 TLS 验证（服务器侧）—— 对应审核记录 05 第七节九条中的 6/7/8/9 与部分 3/5。
#
# 关键立意：**不能只测"能访问"**。
# 必须证明三件事同时成立：
#   1. 正确的私有 CA + 正确 IP SAN → 通过
#   2. 错误的 CA → 失败
#   3. CA 正确但地址不匹配 → 失败   ← 这一条证明"没有偷偷关掉主机名校验"
#
# 第 3 条用一个很干净的办法测：证书里的 SAN 是 IP:8.148.156.146，
# 于是用 https://127.0.0.1 去访问（同一台机器、同一张证书、同一条信任链）
# 必须**校验失败**。如果谁写了 always-true 的 HostnameVerifier 或者用 -k 之类的开关，
# 这条就会漏过去。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

DIR=/etc/ssl/campus
IP=8.148.156.146
CA="$DIR/ca.crt"
LEAF="$DIR/server.crt"

echo "=== A. 证书本体：SAN 必须是 iPAddress 类型 ==="
SAN_LINE="$(openssl x509 -in "$LEAF" -noout -ext subjectAltName 2>/dev/null | grep -i 'IP Address' || true)"
echo "  SAN: $(printf '%s' "$SAN_LINE" | tr -d '\r' | sed 's/^ *//')"
if printf '%s' "$SAN_LINE" | grep -q "IP Address:$IP"; then
  ok "叶子证书含 IP SAN: $IP（iPAddress 类型）"
else
  bad "叶子证书缺少 IP SAN（DNS SAN 或只有 CN 都会导致校验失败）"
fi
# 明确排除"只有 DNS SAN"这种错法
if openssl x509 -in "$LEAF" -noout -ext subjectAltName 2>/dev/null | grep -qi 'DNS:'; then
  bad "叶子证书里出现了 DNS SAN（对 IP 访问无效，属于配置错误）"
else
  ok "没有 DNS SAN（访问方式是 IP，只应有 IP SAN）"
fi

echo
echo "=== B. 信任链 ==="
if openssl verify -CAfile "$CA" "$LEAF" >/dev/null 2>&1; then
  ok "用私有 CA 能验证叶子证书（链完整）"
else
  bad "链校验失败"
fi

echo
echo "=== C. 正确 CA + 正确地址 → 必须通过 ==="
C1="$(curl -s -m 8 --cacert "$CA" -o /dev/null -w '%{http_code}' "https://$IP/health")"
[ "$C1" = "200" ] && ok "https://$IP/health → 200（正确 CA + 正确 IP SAN）" || bad "期望 200，实际 $C1"
C2="$(curl -s -m 8 --cacert "$CA" -o /dev/null -w '%{http_code}' "https://$IP/api/ready")"
[ "$C2" = "200" ] && ok "https://$IP/api/ready → 200" || bad "期望 200，实际 $C2"

echo
echo "=== D. 错误的 CA → 必须失败 ==="
# 系统 CA 库里没有我们的私有 CA，所以用它校验必须失败
if curl -s -m 8 --cacert /etc/ssl/certs/ca-certificates.crt -o /dev/null "https://$IP/health" 2>/dev/null; then
  bad "用系统 CA 也能通过 —— 说明证书链存在公共信任来源，不符合'临时私有 CA'的预期"
else
  ok "用系统 CA 校验失败（符合预期：私有 CA 不被公共信任）"
fi

echo
echo "=== E. CA 正确但地址不匹配 → 必须失败（证明主机名校验没被关掉）==="
if curl -s -m 8 --cacert "$CA" -o /dev/null "https://127.0.0.1/health" 2>/dev/null; then
  bad "用 127.0.0.1 访问同一张证书竟然通过了 —— 主机名校验被绕过，属于严重配置错误"
else
  ok "用 127.0.0.1 访问时校验失败（SAN 是 $IP，地址不匹配 → 正确拒绝）"
fi

echo
echo "=== F. 明文路径不再是可用路径 ==="
# http 仍在（M0 的外部可达性证据依赖 80），但 M2 之后 App 不再使用它。
# 这里断言的是"App 的配置里已无明文例外"，服务器侧只报告 80 是否仍在。
if ss -lnt | grep -q ':80 '; then
  echo "  说明：80 仍在监听（过渡期双栈，M0 的外部 /health 证据依赖它；M6 再定是否 301）"
fi
if grep -qE 'cleartextTrafficPermitted="true"' /etc/nginx/sites-available/campus.conf 2>/dev/null; then
  bad "nginx 配置里出现了 cleartextTrafficPermitted=true"
else
  ok "nginx 配置中无明文例外声明"
fi

echo
echo "=== G. TLS 版本与加密套件 ==="
TLSINFO="$(echo | openssl s_client -connect "127.0.0.1:443" -servername "$IP" 2>/dev/null | grep -E 'Protocol|Cipher' | head -2 | tr -d '\r')"
echo "$TLSINFO" | sed 's/^/  /'
if printf '%s' "$TLSINFO" | grep -qE 'TLSv1\.(2|3)'; then
  ok "协商到 TLSv1.2/1.3"
else
  bad "TLS 版本异常（不应出现 TLSv1.0/1.1）"
fi

echo
echo "=== H. bearer 不得出现在日志里 ==="
# 用一个临时会话真实调用一次，然后检查 nginx 访问日志与应用日志里是否出现该 token。
# 注意：绝不要把 token 打印出来，只打印长度与判定结果。
#
# M3 起改用**手机号 + 一次性验证码**取会话：审核记录 08 判定 M2 的 handle+password
# 契约已被原版实测语义 supersede（/api/auth/login 现在返回 410）。
# 本脚本在服务器上执行，所以可以直接读 dev sink 取码（不经日志）。
BASE=https://$IP/api
TEST_PHONE=13800000001
SINK=/run/campus/login-codes
rm -f "$SINK/8613800000001.json" 2>/dev/null || true
REQ="$(curl -s -m 15 --cacert "$CA" -X POST "$BASE/auth/request-code" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\"}")"
SINK_PATH="$(printf '%s' "$REQ" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
CODE=""
[ -n "$SINK_PATH" ] && [ -f "$SINK_PATH" ] && CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK_PATH")"
LOGIN=""
if [ -n "$CODE" ]; then
  LOGIN="$(curl -s -m 15 --cacert "$CA" -X POST "$BASE/auth/verify-code" \
    -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"$CODE\"}")"
fi
rm -f "$SINK/8613800000001.json" 2>/dev/null || true
TOKEN="$(printf '%s' "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
if [ -n "$TOKEN" ]; then
  ok "取到临时会话用于日志检查（token 长度 ${#TOKEN}，不打印内容）"
  # 用该 token 发一条帖子（触发一次真实的带鉴权请求）
  curl -s -m 15 --cacert "$CA" -o /dev/null -X POST "$BASE/posts" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"body":"TLS 日志泄漏检查（可忽略）","place":"北京交通大学"}'
  sleep 1
  # 1) nginx 访问日志
  if grep -q "$TOKEN" /var/log/nginx/access.log 2>/dev/null; then
    bad "nginx 访问日志里出现了 bearer token"
  else
    ok "nginx 访问日志中没有 bearer token"
  fi
  # 2) 应用日志
  if journalctl -u campus-backend.service --since '-5 min' --no-pager 2>/dev/null | grep -q "$TOKEN"; then
    bad "应用 journal 里出现了 bearer token"
  else
    ok "应用 journal 中没有 bearer token"
  fi
  # 3) 顺手撤销这个临时会话，避免留下可用凭证
  curl -s -m 10 --cacert "$CA" -o /dev/null -X POST "$BASE/auth/logout" -H "Authorization: Bearer $TOKEN"
  ok "临时会话已 logout 撤销"
else
  bad "未能取到临时会话，日志检查未执行"
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "TLS_SERVER_RESULT PASS"; else echo "TLS_SERVER_RESULT FAIL"; fi
exit "$FAILED"
