#!/usr/bin/env bash
# M2.5 seed 验证（审核记录 05 第五节）
#
# 三条判据，缺一不可：
#   1. fresh DB + seed 一次  ==  fresh DB + seed 两次      （幂等）
#   2. 两者 == **canonical 期望哈希**                        （不是"自己跟自己比"）
#   3. 库里确实收敛到 seed 规格（不是只在第一次正确）
#
# 为什么必须有第 2 条：
#   只比"两次运行是否一致"会被**假幂等**骗过 ——
#   如果 seed 源改了值而库里用 DO NOTHING 保留了旧值，两次运行当然一样，
#   但那个"一样"的值已经偏离 canonical 了。
#   canonical 哈希放在 docs/pending/m2/seed-canonical.txt（入库、需要显式更新）。
#
# 只读 canonical，不会自动改写它 —— Gate 不允许改变被测试对象。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

NODE=/opt/node-v24.21.0-linux-x64/bin/node
SEED=/srv/campus/server/dist/seed.mjs
BUNDLE=/srv/campus/server/dist/index.mjs
DB_PASS="$(cat /srv/campus/.db_password)"
CANON_FILE=/srv/campus/seed-canonical.txt

DB1=campus_seedtest_once
DB2=campus_seedtest_twice
PORT1=3101
PORT2=3102

# 检查用的临时库要先建好表结构：让 API bundle 自己跑迁移（同一条代码路径）
#
# 两个必须做对的地方（都踩过）：
#  1) **按 PID 杀进程，不能用 `kill %1`** —— 非交互 bash 里 job control 不生效，
#     `%1` 杀不掉东西；残留的临时实例会继续占着端口。
#  2) 起实例**之前**先确认端口是空的。否则残留实例会让就绪探测从"旧进程"那里
#     立刻拿到 200，而目标库其实还没建过表，后面的 seed 就会莫名其妙地失败。
TMP_PIDS=()

free_port() { # free_port <port>
  local port="$1" pids
  pids="$(ss -lntp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $NF}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u)"
  for pid in $pids; do
    echo "  (清理占用 $port 的残留进程 pid=$pid)"
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
}

start_and_migrate() { # start_and_migrate <db> <port>
  local db="$1" port="$2"
  free_port "$port"
  DATABASE_URL="postgresql://campus:${DB_PASS}@127.0.0.1:5432/${db}" PORT="$port" \
    setsid "$NODE" "$BUNDLE" >/tmp/seedcheck-$port.log 2>&1 &
  local pid=$!
  TMP_PIDS+=("$pid")
  local i
  for i in $(seq 1 30); do
    [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/ready")" = "200" ] && break
    sleep 1
  done
  # 就绪之后还要确认"迁移真的应用到了**这个**库"，而不是撞上别的实例
  local applied
  applied="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$db" -Atc 'select count(*) from schema_migrations' 2>/dev/null)"
  echo "  ($db 迁移版本数=${applied:-0})"
  kill "$pid" 2>/dev/null || true
  sleep 1
}

seed_run() { # seed_run <db> [extra args]
  local db="$1"; shift
  DATABASE_URL="postgresql://campus:${DB_PASS}@127.0.0.1:5432/${db}" \
    "$NODE" "$SEED" "$@" 2>&1 | sed -n 's/^SEED_HASH //p'
}

make_fresh() { # make_fresh <db>
  local db="$1"
  sudo -u postgres psql -q -Atc "drop database if exists $db" >/dev/null 2>&1
  sudo -u postgres psql -q -Atc "create database $db owner campus" >/dev/null 2>&1
}

echo "=== A. fresh DB + seed 一次 ==="
make_fresh "$DB1"
start_and_migrate "$DB1" "$PORT1"
H1="$(seed_run "$DB1")"
echo "  hash = $H1"
[ -n "$H1" ] && ok "第一次 seed 产出哈希" || bad "第一次 seed 未产出哈希"

echo
echo "=== B. fresh DB + seed 两次（幂等）==="
make_fresh "$DB2"
start_and_migrate "$DB2" "$PORT2"
seed_run "$DB2" >/dev/null
H2="$(seed_run "$DB2")"
echo "  hash = $H2"
[ -n "$H2" ] && ok "第二次 seed 产出哈希" || bad "第二次 seed 未产出哈希"

echo
echo "=== C. 判据 1：fresh+once == fresh+twice ==="
if [ "$H1" = "$H2" ]; then
  ok "两种路径结果一致（seed 幂等）"
else
  bad "fresh+once($H1) != fresh+twice($H2)"
fi

echo
echo "=== D. 判据 2：与 canonical 期望哈希一致 ==="
if [ -f "$CANON_FILE" ]; then
  CANON="$(tr -d ' \n' < "$CANON_FILE")"
  echo "  canonical = $CANON"
  if [ "$H1" = "$CANON" ]; then
    ok "seed 结果与 canonical 期望一致"
  else
    bad "seed 结果偏离 canonical（seed 源改了吗？确认无误后再显式更新 $CANON_FILE）"
  fi
else
  bad "缺少 canonical 文件 $CANON_FILE"
fi

echo
echo "=== E. 判据 3：收敛性 —— 故意改坏库里的值，重跑 seed 必须被改回来 ==="
# 这才是真正区分"convergent"与"DO NOTHING 假幂等"的测试：
# 用 DO NOTHING 的实现，这里改坏之后永远改不回来。
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$DB2" -q -c \
  "update users set display_name = '被改坏的名字' where id = '11111111-1111-4111-8111-111111111111'" >/dev/null
BROKEN="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$DB2" -Atc \
  "select display_name from users where id = '11111111-1111-4111-8111-111111111111'")"
echo "  改坏后的值: $BROKEN"
H3="$(seed_run "$DB2")"
FIXED="$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$DB2" -Atc \
  "select display_name from users where id = '11111111-1111-4111-8111-111111111111'")"
echo "  重跑 seed 后的值: $FIXED"
[ "$FIXED" = "anmoss" ] && ok "重跑 seed 把被改坏的值收敛回 seed 规格" || bad "重跑 seed 没有修正被改坏的值（说明实现是 DO NOTHING 假幂等）"
[ "$H3" = "$H1" ] && ok "修复后哈希回到 canonical" || bad "修复后哈希仍不一致（$H3）"

echo
echo "=== F. 清理 ==="
for db in "$DB1" "$DB2"; do
  sudo -u postgres psql -q -Atc "drop database if exists $db" >/dev/null 2>&1
done
# 按 PID 兜底清理本脚本起过的临时实例（避免污染下一次运行）
for pid in "${TMP_PIDS[@]:-}"; do
  kill -9 "$pid" 2>/dev/null || true
done
free_port "$PORT1"
free_port "$PORT2"
rm -f /tmp/seedcheck-*.log
ok "临时库与临时实例已清理"

echo
if [ "$FAILED" -eq 0 ]; then echo "SEED_RESULT PASS"; else echo "SEED_RESULT FAIL"; fi
exit "$FAILED"
