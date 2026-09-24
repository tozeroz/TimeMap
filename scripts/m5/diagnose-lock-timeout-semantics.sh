#!/usr/bin/env bash
# 最小实验：lock_timeout 对 advisory lock 到底生效吗？
#
# 背景：服务端 acquireMediaMutationLock() 做的是
#   set local lock_timeout = '5000ms'
#   select pg_advisory_xact_lock_shared(KEY)
# 期望：备份持排他锁时，5s 后抛 55P03 → 调用方翻成 503。
# 实测：上传等了 **7997ms** 并成功 201 —— 说明超时**没生效**。
#
# 本脚本只用 psql 做最小复现，不涉及服务端代码，用来判定
# "是 SQL 语义问题" 还是 "是应用层用法问题"。
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
KEY=1295270465
PSQLC() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== PostgreSQL 版本 ==="
PSQLC "select version()" | cut -c1-60 | sed 's/^/  /'

echo
echo "=== 实验 1：会话持排他锁 6 秒；另一会话设 lock_timeout=2s 取**共享**锁 ==="
# 后台持排他锁
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At \
  -c "select pg_advisory_lock($KEY)" -c "select pg_sleep(6)" -c "select pg_advisory_unlock($KEY)" \
  >/dev/null 2>&1 &
HOLDER=$!
sleep 1

echo "  --- 1a) 在**显式事务**里 set local lock_timeout + xact_lock_shared（与服务端一致）---"
T0=$(date +%s%N)
OUT="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -v ON_ERROR_STOP=1 -Atc "
begin;
set local lock_timeout = '2000ms';
select pg_advisory_xact_lock_shared($KEY);
commit;
" 2>&1)"
RC=$?
T1=$(date +%s%N)
echo "    exit=$RC  耗时=$(( (T1-T0)/1000000 ))ms"
echo "    输出: $(printf '%s' "$OUT" | tr '\n' ' ' | head -c 200)"
case "$OUT" in
  *55P03*|*"lock timeout"*|*"canceling statement"*) echo "    → ✓ 超时被触发（lock_timeout 对 advisory lock **生效**）" ;;
  *) echo "    → ✗ **未触发超时**（等待后成功）" ;;
esac

sleep 6   # 等 holder 结束
wait $HOLDER 2>/dev/null || true

echo
echo "=== 实验 2：换用普通表行锁，确认 lock_timeout 本身有效（对照组）==="
# 造一张临时表来验证机制本身
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At -c "
create table if not exists _lk_probe(id int primary key);
insert into _lk_probe values (1) on conflict do nothing;
" >/dev/null 2>&1

PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At \
  -c "begin" -c "update _lk_probe set id=1 where id=1" -c "select pg_sleep(5)" -c "commit" >/dev/null 2>&1 &
H2=$!
sleep 1
T0=$(date +%s%N)
OUT2="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "
begin;
set local lock_timeout = '1500ms';
update _lk_probe set id=1 where id=1;
commit;
" 2>&1)"
T1=$(date +%s%N)
echo "  耗时=$(( (T1-T0)/1000000 ))ms  输出: $(printf '%s' "$OUT2" | tr '\n' ' ' | head -c 160)"
case "$OUT2" in
  *55P03*|*"lock timeout"*) echo "    → ✓ 对照组：普通行锁的 lock_timeout **生效**（说明机制本身没问题）" ;;
  *) echo "    → 对照组也**没生效**（说明是本会话/配置层面的问题）" ;;
esac
wait $H2 2>/dev/null || true
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At -c "drop table if exists _lk_probe" >/dev/null 2>&1

echo
echo "=== 实验 3：不带 set local（只设会话级）时共享锁行为 ==="
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At \
  -c "select pg_advisory_lock($KEY)" -c "select pg_sleep(5)" -c "select pg_advisory_unlock($KEY)" >/dev/null 2>&1 &
H3=$!
sleep 1
T0=$(date +%s%N)
OUT3="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "
set lock_timeout = '1500ms';
select pg_advisory_lock_shared($KEY);
" 2>&1)"
T1=$(date +%s%N)
echo "  会话级 lock_timeout 耗时=$(( (T1-T0)/1000000 ))ms  输出: $(printf '%s' "$OUT3" | tr '\n' ' ' | head -c 160)"
wait $H3 2>/dev/null || true

echo
echo "=== 实验 4：关键区分 —— 共享锁 vs 排他锁的等待语义 ==="
echo "  问题：pg_advisory_lock_shared 是否会被**排他**锁阻塞，且阻塞时是否受 lock_timeout 约束？"
echo "  （实验 1/3 的结果即为答案；这里额外确认另一方向：排他等共享）"
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At \
  -c "select pg_advisory_lock_shared($KEY)" -c "select pg_sleep(4)" -c "select pg_advisory_unlock_shared($KEY)" >/dev/null 2>&1 &
H4=$!
sleep 1
T0=$(date +%s%N)
OUT4="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "
set lock_timeout = '1500ms';
select pg_advisory_lock($KEY);
" 2>&1)"
T1=$(date +%s%N)
echo "  排他等共享 耗时=$(( (T1-T0)/1000000 ))ms  输出: $(printf '%s' "$OUT4" | tr '\n' ' ' | head -c 160)"
wait $H4 2>/dev/null || true
