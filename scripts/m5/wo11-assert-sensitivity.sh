#!/usr/bin/env bash
# WO#11 删除断言的**判别力测试**（REQUIRED 口径）
#
# ## 为什么必须做
#   我在 dry run 里看到"psql exit=0"，那只证明**断言没有误报**。
#   它**不能**证明"断言在真的出错时会拦住" —— 一个永远不 raise 的断言等于没有断言。
#   本项目已多次栽在"无法失败的检查"上（tsc 空过 / provenance 空过 / 顺序断言误过）。
#
# ## 怎么做（不碰生产数据）
#   把同一份 SQL 施加**受控突变**，看断言是否按预期 raise。
#   全部在**事务内**执行并最终 rollback —— 生产数据零改动。
#
#   突变 A：把"期望删除数 20"改成 19 → 必须 raise（deleted_count is 20 not 19）
#   突变 B：把"期望候选数 20"改成 21 → 必须 raise（candidate count is 20 not 21）
#   突变 C：把"期望非候选帖数"改成 +1 → 必须 raise（canonical posts changed）
#   基线  ：原样 + rollback → 必须**不** raise（不误报）
set -uo pipefail
SQL_FILE="${1:-/tmp/wo11-delete.sql}"
PW="$(cat /srv/campus/.db_password)"
PSQLQ() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
RUN() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -f "$1" 2>&1; }

if [ ! -f "$SQL_FILE" ]; then echo "FATAL 找不到 $SQL_FILE"; exit 1; fi
BASE=/tmp/wo11-sens

echo "=== 基线：原样 + rollback → 期望**不** raise ==="
sed 's/^commit;$/rollback;/' "$SQL_FILE" > "$BASE-base.sql"
OUT="$(RUN "$BASE-base.sql")"; RC=$?
if [ "$RC" = "0" ] && ! printf '%s' "$OUT" | grep -q 'ERROR'; then
  echo "  PASS 基线不误报（exit=0、无 ERROR）"
  S0=0
else
  echo "  FAIL 基线就报错 → 断言有问题"; printf '%s' "$OUT" | grep -i error | head -3 | sed 's/^/    /'; S0=1
fi

echo
echo "=== 突变 A：期望删除数 20 → 19，必须 raise ==="
sed 's/^commit;$/rollback;/' "$SQL_FILE" | sed "s/if d <> 20 then raise exception 'deleted_count is % not 20'/if d <> 19 then raise exception 'MUTANT deleted_count mismatch: % (expected 19)'/" > "$BASE-mutA.sql"
OUT="$(RUN "$BASE-mutA.sql")"; RC=$?
if printf '%s' "$OUT" | grep -q 'MUTANT deleted_count mismatch'; then
  echo "  PASS 突变 A 被断言拦住（$(printf '%s' "$OUT" | grep -o 'MUTANT deleted_count mismatch[^ ]*' | head -1)）"
  SA=0
else
  echo "  FAIL 突变 A **未被拦住** → deleted_count 断言无效"; SSA_OUT="$OUT"; SA=1
fi

echo
echo "=== 突变 B：期望候选数 20 → 21，必须 raise ==="
sed 's/^commit;$/rollback;/' "$SQL_FILE" | sed "s/if c <> 20 then raise exception 'candidate count is % not 20'/if c <> 21 then raise exception 'MUTANT candidate count mismatch: % (expected 21)'/" > "$BASE-mutB.sql"
OUT="$(RUN "$BASE-mutB.sql")"; RC=$?
if printf '%s' "$OUT" | grep -q 'MUTANT candidate count mismatch'; then
  echo "  PASS 突变 B 被断言拦住（$(printf '%s' "$OUT" | grep -o 'MUTANT candidate count mismatch[^ ]*' | head -1)）"
  SB=0
else
  echo "  FAIL 突变 B **未被拦住** → 候选数断言无效"; SB=1
fi

echo
echo "=== 突变 C：期望非候选帖数 +1，必须 raise ==="
# 把 canonical posts 的期望值改大 1（用 sed 精确替换那一条 raise 的条件）
NONCANON="$(PSQLQ "select count(*) from posts where not (body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%')")"
WRONG=$((NONCANON + 1))
sed 's/^commit;$/rollback;/' "$SQL_FILE" \
  | sed "s/if n <> $NONCANON then raise exception 'canonical posts changed: % vs $NONCANON'/if n <> $WRONG then raise exception 'MUTANT canonical posts mismatch: % (expected $WRONG)'/" \
  > "$BASE-mutC.sql"
OUT="$(RUN "$BASE-mutC.sql")"; RC=$?
if printf '%s' "$OUT" | grep -q 'MUTANT canonical posts mismatch'; then
  echo "  PASS 突变 C 被断言拦住（$(printf '%s' "$OUT" | grep -o 'MUTANT canonical posts mismatch[^ ]*' | head -1)）"
  SC=0
else
  echo "  FAIL 突变 C **未被拦住** → 规范数据断言无效"; SC=1
fi

echo
echo "=== 确认生产数据零改动（所有变体都 rollback）==="
PSQLQ "select 'posts=' || (select count(*) from posts) || ' messages=' || (select count(*) from messages)" | sed 's/^/  /'

echo
if [ $((S0 + SA + SB + SC)) -eq 0 ]; then
  echo "WO11_DELETE_ASSERT_SENSITIVITY: PASS（基线不误报；三个突变全被拦住）"
  exit 0
else
  echo "WO11_DELETE_ASSERT_SENSITIVITY: FAIL"
  exit 1
fi
