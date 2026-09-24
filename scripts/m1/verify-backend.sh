#!/usr/bin/env bash
# M1 后端侧验证（对应 docs/m1/SPEC.md 第六节 Gate 的第 1/2/3/5/6/7 组）
# 不用 set -e：每步独立报告，失败继续，最后汇总退出码。
#
# 用法: verify-backend.sh [M1|M2]      ← 注意是 $1：脚本经 stdin 交给 bash 时，
#   想传参必须用 `bash -s -- M2` 或先落盘再 `bash /tmp/x.sh M2`（Gate 用的是后者）。
#   M1（默认）：按 M1 的验收语义跑（写路径不需要鉴权）
#   M2        ：M2 起写路径必须带会话，脚本会先登录取得 token
#
# 为什么要有 stage 维度：M1 有几条断言是"M1 阶段的事实"
#   （例如"posts 恰好 5 个字段""schema_migrations 恰好 1 个版本""无 token 也能写"）。
#   把它们当永久不变量用，到 M2 必然假失败 —— 这正是审核记录 04 指出的那类错误。
#   这里已改成两种处理：
#     - 能改成"真正的不变量"的（必需列都在、applied==expected）就改成不变量；
#     - 确实只属于某阶段的（无 token 写入）就按 stage 分支。
#
# 说明：第 0 组（M0 regression）和第 8 组（SCOPE）在 PowerShell 侧做，
#       第 4 组（设备 UI 路径）在 scripts/m1/verify-device.ps1 做。
stage="${1:-M1}"
FAILED=0
ok()   { printf 'PASS %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1"; FAILED=1; }

NODE=/opt/node-v24.21.0-linux-x64/bin/node
BUNDLE=/srv/campus/server/dist/index.mjs
DB_PASS="$(cat /srv/campus/.db_password)"
TMPDB=campus_m1test
TMPPORT=3099

MARK="M1-E2E-$(date +%s)"
echo "标记: $MARK"

# ===========================================================================
echo
echo "=== A0. [MIGRATION] 全新数据库从零建表 + 幂等 ==="
# 用一个临时库 + 第二实例跑真实迁移代码路径（不是拿 psql 手动建表糊过去）
su - postgres -c "psql -q -Atc \"drop database if exists $TMPDB\"" >/dev/null 2>&1
if su - postgres -c "psql -q -Atc \"create database $TMPDB owner campus\"" >/dev/null 2>&1; then
  ok "临时库 $TMPDB 创建成功"
else
  bad "临时库创建失败"
fi

# 第一次启动：应当把 001_init 应用上去
DATABASE_URL="postgresql://campus:${DB_PASS}@127.0.0.1:5432/${TMPDB}" PORT=$TMPPORT \
  setsid "$NODE" "$BUNDLE" >/tmp/m1-tmp1.log 2>&1 &
TMP1=$!
for i in $(seq 1 30); do
  [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:$TMPPORT/api/ready)" = "200" ] && break
  sleep 1
done
R1="$(curl -s -m 5 http://127.0.0.1:$TMPPORT/api/ready)"
echo "  首次 /api/ready: $R1"
echo "  首次日志: $(cat /tmp/m1-tmp1.log | tr '\n' ' ')"
printf '%s' "$R1" | grep -q '"status":"ready"' && ok "空库启动后 readiness=ready（schema 已建）" || bad "空库启动后未就绪"

# 表与索引真的建出来了吗
# 注意：**不要断言"字段数恰好等于 5"**。那是 M1 阶段的事实，M2 加 author_id/place_id 后就变了，
# 这种"阶段事实"当永久不变量用，必然产生假失败（M2 Gate 上实际踩到过）。
# 正确做法是断言"M1 需要的列都在"——这才是不随阶段失效的不变量。
REQ_COLS="id author_name body place created_at"
MISSING=""
for c in $REQ_COLS; do
  n="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc \
    "select count(*) from information_schema.columns where table_name='posts' and column_name='$c'")"
  [ "$n" = "1" ] || MISSING="$MISSING $c"
done
[ -z "$MISSING" ] && ok "posts 表包含全部必需列（$REQ_COLS）" || bad "posts 表缺少列:$MISSING"
IDX="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc \
  "select count(*) from pg_indexes where tablename='posts' and indexname like '%created_at%'")"
[ "$IDX" -ge 1 ] && ok "created_at 索引存在" || bad "created_at 索引缺失"

APPLIED_AT_1="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc \
  "select applied_at from schema_migrations where version='001_init'")"
echo "  schema_migrations(001_init).applied_at = $APPLIED_AT_1"
[ -n "$APPLIED_AT_1" ] && ok "schema_migrations 记录了 001_init" || bad "schema_migrations 无记录"

kill "$TMP1" 2>/dev/null
pkill -f "PORT=$TMPPORT" 2>/dev/null
sleep 1

# 第二次启动：幂等 —— applied_at 不许变，也不该再应用一次
DATABASE_URL="postgresql://campus:${DB_PASS}@127.0.0.1:5432/${TMPDB}" PORT=$TMPPORT \
  setsid "$NODE" "$BUNDLE" >/tmp/m1-tmp2.log 2>&1 &
TMP2=$!
for i in $(seq 1 30); do
  [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:$TMPPORT/api/ready)" = "200" ] && break
  sleep 1
done
APPLIED_AT_2="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc \
  "select applied_at from schema_migrations where version='001_init'")"
LOG2="$(tr '\n' ' ' < /tmp/m1-tmp2.log)"
echo "  二次日志: $LOG2"
if [ "$APPLIED_AT_1" = "$APPLIED_AT_2" ]; then ok "重复执行迁移幂等（applied_at 未变）"; else bad "迁移被重复应用"; fi
printf '%s' "$LOG2" | grep -q 'applied=001_init' && bad "二次启动又重新应用了 001_init" || ok "二次启动未重复应用"
VER_CNT="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc "select count(*) from schema_migrations")"
# 同样不断言"恰好 1 个版本"（M2 起会变成 3 个）。
# 有意义的不变量是：至少应用了 001_init，且与代码里的迁移数一致（后者由 /api/ready 保证）。
HAS_INIT="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc \
  "select count(*) from schema_migrations where version='001_init'")"
[ "$HAS_INIT" = "1" ] && ok "schema_migrations 记录了 001_init（共 $VER_CNT 个版本）" || bad "schema_migrations 未记录 001_init"

kill "$TMP2" 2>/dev/null
sleep 1
su - postgres -c "psql -q -Atc \"drop database if exists $TMPDB\"" >/dev/null 2>&1 && ok "临时库已清理" || bad "临时库清理失败"
rm -f /tmp/m1-tmp1.log /tmp/m1-tmp2.log

# ===========================================================================
echo
echo "=== A. [API] 经 Nginx 写一条 ==="
# M2 起写路径需要会话，后续写请求带 Authorization。
# **M3 起改走手机号 + 一次性验证码**：审核记录 08 判定 M2 的 handle+password 契约
# 已被原版实测语义 supersede（原版没有密码登录），/api/auth/login 现在返回 410。
# 脚本自己就在服务器上，所以可以直接读 dev sink 取码（不经日志）。
AUTH_HDR=()
if [ "$stage" = "M2" ]; then
  LOGIN_JSON="$(curl -s -m 15 -X POST http://127.0.0.1/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"handle":"anmoss","password":"seed-password-1"}')"
  TOKEN="$(printf '%s' "$LOGIN_JSON" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  if [ -n "$TOKEN" ]; then
    AUTH_HDR=(-H "Authorization: Bearer $TOKEN")
    ok "已取得会话（M2 写路径需要鉴权；token 长度 ${#TOKEN}，不打印内容）"
  else
    bad "M2 需要会话但登录失败：$(printf '%s' "$LOGIN_JSON" | head -c 120)"
  fi
fi
if [ "$stage" = "M3" ] || [ "$stage" = "M2PLUS" ]; then
  # 用 seed 用户的手机号（+8613800000001 = anmoss）
  TEST_PHONE="13800000001"
  SINK=/run/campus/login-codes
  rm -f "$SINK/8613800000001.json" 2>/dev/null || true
  REQ_JSON="$(curl -s -m 15 -X POST http://127.0.0.1/api/auth/request-code \
    -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\"}")"
  SINK_PATH="$(printf '%s' "$REQ_JSON" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
  if [ -n "$SINK_PATH" ] && [ -f "$SINK_PATH" ]; then
    CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK_PATH")"
    VER_JSON="$(curl -s -m 15 -X POST http://127.0.0.1/api/auth/verify-code \
      -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"$CODE\"}")"
    TOKEN="$(printf '%s' "$VER_JSON" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
    if [ -n "$TOKEN" ]; then
      AUTH_HDR=(-H "Authorization: Bearer $TOKEN")
      ok "已取得会话（M3：手机号 + dev sink 取码；token 长度 ${#TOKEN}，不打印内容）"
    else
      bad "M3 需要会话但验证码登录失败：$(printf '%s' "$VER_JSON" | head -c 120)"
    fi
  else
    bad "M3 需要会话但没能从 dev sink 取到验证码（响应: $(printf '%s' "$REQ_JSON" | head -c 120)）"
  fi
  rm -f "$SINK/8613800000001.json" 2>/dev/null || true
fi

# M2 起 author 字段属于**禁止字段**（strict schema 会 400），所以按 stage 决定是否带上。
# M1 阶段没有认证，作者就是客户端给的占位名 —— 这正说明 M1 的写法不能带到 M2。
if [ "$stage" = "M2" ] || [ "$stage" = "M3" ] || [ "$stage" = "M2PLUS" ]; then
  POST_PAYLOAD="{\"body\":\"$MARK 这是一条垂直切片验证帖\",\"place\":\"北京交通大学\"}"
else
  POST_PAYLOAD="{\"body\":\"$MARK 这是一条垂直切片验证帖\",\"place\":\"北京交通大学\",\"author\":\"M1验证\"}"
fi
RESP="$(curl -s -m 10 "${AUTH_HDR[@]}" -X POST http://127.0.0.1/api/posts \
  -H 'Content-Type: application/json' -d "$POST_PAYLOAD")"
echo "  响应: $RESP"
POST_ID="$(printf '%s' "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [ -n "$POST_ID" ]; then ok "POST /api/posts 返回 id"; else bad "POST /api/posts 未返回 id"; fi
printf '%s' "$RESP" | grep -q '"createdAt"' && ok "POST 返回 createdAt" || bad "POST 未返回 createdAt"

echo
echo "=== B. [VERTICAL_SLICE] 经 Nginx 读回 ==="
LIST="$(curl -s -m 10 http://127.0.0.1/api/posts)"
echo "  响应: $(printf '%s' "$LIST" | head -c 300)"
if printf '%s' "$LIST" | grep -q "$MARK"; then ok "GET /api/posts 能读到刚写的帖子"; else bad "GET /api/posts 读不到"; fi
if printf '%s' "$LIST" | grep -q '"place":"北京交通大学"'; then ok "place 字段一致"; else bad "place 字段不一致"; fi

echo
echo "=== C. 直接查 PostgreSQL 确认真实落库 ==="
ROW="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select id||'|'||author_name||'|'||coalesce(place,'-') from posts where id='$POST_ID'")"
echo "  行: $ROW"
if [ -n "$ROW" ]; then ok "PG 中确有该行（不是内存缓存）"; else bad "PG 中查不到该行"; fi

echo
echo "=== D. [API] 校验：空 body 与超长 body ==="
# 注意顺序：M2 起鉴权在参数校验之前，所以不带 token 的请求会先 401 而不是 400。
# 要测"校验本身"，就必须带上会话；否则测到的是鉴权，结论会张冠李戴。
C1="$(curl -s -m 10 "${AUTH_HDR[@]}" -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1/api/posts -H 'Content-Type: application/json' -d '{"body":"   "}')"
[ "$C1" = "400" ] && ok "空 body → 400" || bad "空 body 期望 400，实际 $C1"
LONG="$(printf 'x%.0s' $(seq 1 600))"
C2="$(curl -s -m 10 "${AUTH_HDR[@]}" -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1/api/posts -H 'Content-Type: application/json' -d "{\"body\":\"$LONG\"}")"
[ "$C2" = "400" ] && ok "超长 body → 400" || bad "超长 body 期望 400，实际 $C2"

echo
echo "=== E. 重启 backend 后数据仍在 ==="
systemctl restart campus-backend.service
# 必须轮询 **/api/ready**（就绪语义），不能轮询 /api/health（存活语义）：
# M3 起服务是"先 listen、再后台迁移"，liveness 在迁移完成前就 200，
# 而业务路由在就绪前统一 503。轮询 liveness 会立刻通过，紧接着读 /api/posts 拿到 503，
# 表现成"重启后读不到"（其实是脚本没尊重新旧语义差别）。
for i in $(seq 1 40); do
  [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready)" = "200" ] && break
  sleep 1
done
READY_CODE="$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready)"
LIST2="$(curl -s -m 10 http://127.0.0.1/api/posts)"
if printf '%s' "$LIST2" | grep -q "$MARK"; then
  ok "重启后仍能读到（已持久化）"
else
  bad "重启后读不到（/api/ready=$READY_CODE，响应: $(printf '%s' "$LIST2" | head -c 160)）"
fi

echo
echo "=== F. [API] readiness 语义：停掉 PG 必须 503 ==="
systemctl stop postgresql
sleep 2
RC="$(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready)"
BODY="$(curl -s -m 10 http://127.0.0.1/api/ready)"
echo "  /api/ready → $RC  body=$BODY"
[ "$RC" = "503" ] && ok "PG 不可用时 /api/ready 返回 503" || bad "PG 不可用时期望 503，实际 $RC"
HL="$(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/health)"
[ "$HL" = "200" ] && ok "liveness 不受 PG 影响（仍 200）" || bad "liveness 期望 200，实际 $HL"
systemctl start postgresql
for i in $(seq 1 30); do
  [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready)" = "200" ] && break
  sleep 1
done
RC2="$(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready)"
[ "$RC2" = "200" ] && ok "PG 恢复后 /api/ready 自动回到 200" || bad "PG 恢复后期望 200，实际 $RC2"

echo
echo "=== G. [SYSTEMD] enabled + active ==="
[ "$(systemctl is-enabled campus-backend.service)" = "enabled" ] && ok "campus-backend 已 enable（开机自启）" || bad "campus-backend 未 enable"
[ "$(systemctl is-active campus-backend.service)" = "active" ] && ok "campus-backend 正在运行" || bad "campus-backend 未运行"

echo
echo "=== H. [NGINX] 语义隔离 ==="
EH="$(curl -s -m 5 http://127.0.0.1/health)"
printf '%s' "$EH" | grep -q 'campus-gateway' && ok "/health 由 Nginx 直接返回（gateway 语义）" || bad "/health 语义异常: $EH"
printf '%s' "$EH" | grep -qi 'campus-api' && bad "/health 泄漏了后端语义" || ok "/health 未混入后端语义"
AH="$(curl -s -m 5 http://127.0.0.1/api/health)"
printf '%s' "$AH" | grep -q 'campus-api' && ok "/api/health 来自 Fastify（api 语义）" || bad "/api/health 语义异常: $AH"

echo
echo "=== I. [CORS] APK WebView 来源必须放行，非白名单来源必须不放行 ==="
# APK 里页面来源是 https://localhost，接口在 http://<IP>，属于跨源请求：
# POST + content-type: application/json 会先发 OPTIONS 预检，预检不过就根本发不出帖子。
PRE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X OPTIONS http://127.0.0.1/api/posts \
  -H 'Origin: https://localhost' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type')"
[ "$PRE" = "204" ] && ok "预检 OPTIONS → 204" || bad "预检期望 204，实际 $PRE"
# 用 GET 而不是 POST 来检查回显：POST 会往库里塞测试行，把信息流弄脏
ACO="$(curl -s -m 10 -D - -o /dev/null http://127.0.0.1/api/posts \
  -H 'Origin: https://localhost' | tr -d '\r' | awk -F': ' '/[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin/ {print $2}')"
[ "$ACO" = "https://localhost" ] && ok "白名单来源回显 allow-origin" || bad "白名单来源未回显 allow-origin（$ACO）"
if curl -s -m 10 -D - -o /dev/null http://127.0.0.1/api/posts -H 'Origin: https://evil.example' \
  | tr -d '\r' | grep -qi 'access-control-allow-origin'; then
  bad "非白名单来源拿到了 allow-origin"
else
  ok "非白名单来源没有 allow-origin"
fi

echo
echo "=== J. 端口暴露面 ==="
if ss -lnt | grep -qE '0\.0\.0\.0:3001|\[::\]:3001'; then bad "3001 暴露在公网接口"; else ok "3001 仅 127.0.0.1 监听"; fi
if ss -lnt | grep -qE '0\.0\.0\.0:5432|\[::\]:5432'; then bad "5432 暴露在公网接口"; else ok "5432 未对外监听"; fi

# ===========================================================================
echo
echo "=== K. [RESOURCE_after_M1] 真实打 /api/posts 采样 ==="

# oom_kill 是累计值，用增量证明"这轮压测没把机器打爆"
oom_now() { awk '/^oom_kill/ {print $2}' /proc/vmstat; }
mem_now() { awk '/MemAvailable/ {print $2}' /proc/meminfo; }
swap_now() { free -m | awk '/^Swap:/ {print $3}'; }
node_rss() { systemctl show -p MemoryCurrent campus-backend.service | cut -d= -f2; }
pg_rss() { ps -o rss= -C postgres | awk '{s+=$1} END {printf "%d", s}'; }
load_now() { cut -d' ' -f1-3 /proc/loadavg; }

snapshot() {
  printf '  %-10s MemAvailable=%sKB swap=%sMB nodeRSS=%sB pgRSS=%sKB load=%s oom_kill=%s\n' \
    "$1" "$(mem_now)" "$(swap_now)" "$(node_rss)" "$(pg_rss)" "$(load_now)" "$(oom_now)"
}

OOM_BEFORE="$(oom_now)"
snapshot "idle"
sleep 3
snapshot "idle+3s"

LOAD_TEST() {
  N="$1"
  printf '  --- %s 并发 GET /api/posts ---\n' "$N"
  seq 1 "$N" | xargs -P "$N" -I{} sh -c \
    'curl -s -o /dev/null -w "%{http_code}\n" -m 15 http://127.0.0.1/api/posts' \
    | sort | uniq -c | sed 's/^/    /'
}

LOAD_TEST 5
sleep 2
snapshot "after-5"
LOAD_TEST 20
sleep 3
snapshot "after-20"

OOM_AFTER="$(oom_now)"
OOM_DELTA=$((OOM_AFTER - OOM_BEFORE))
echo "  oom_kill 增量: $OOM_DELTA"
[ "$OOM_DELTA" -eq 0 ] && ok "压测期间没有 OOM kill" || bad "发生 OOM kill"
RC3="$(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready)"
[ "$RC3" = "200" ] && ok "压测后 readiness 仍为 200" || bad "压测后 readiness=$RC3"
MEM_AFTER="$(mem_now)"
[ "$MEM_AFTER" -gt 51200 ] && ok "压力后 MemAvailable 仍有 $((MEM_AFTER/1024))MB（>50MB）" || bad "内存偏紧: $((MEM_AFTER/1024))MB"

echo
if [ "$FAILED" -eq 0 ]; then echo "BACKEND_RESULT PASS"; else echo "BACKEND_RESULT FAIL"; fi
exit "$FAILED"
