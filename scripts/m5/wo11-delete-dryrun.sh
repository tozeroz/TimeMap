#!/usr/bin/env bash
# WO#11 删除步骤的 **DRY RUN**：用同一份 SQL 但把 commit 换成 rollback
#
# ## 为什么必须先 dry run
#   ① 验证 SQL 语法与 `do $$ … $$` 块在真实 psql 下可执行
#   ② 验证**断言真的会拦**（判别力）—— 一个"永远不会 raise"的断言等于没有断言
#   ③ 证明事务边界正确：rollback 后数据**完全没变**
#
# ## 用法
#   bash wo11-delete-dryrun.sh /tmp/wo11-delete.sql
set -uo pipefail
SQL_FILE="${1:-/tmp/wo11-delete.sql}"
PW="$(cat /srv/campus/.db_password)"
Q() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

if [ ! -f "$SQL_FILE" ]; then echo "FATAL 找不到 $SQL_FILE（先跑 wo11-delete-residue.sh 生成）"; exit 1; fi

BEFORE_RES="$(Q "select count(*) from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%'")"
BEFORE_ALL="$(Q "select count(*) from posts")"
BEFORE_MSGS="$(Q "select count(*) from messages")"

echo "=== dry run 前 ==="
echo "  候选帖=$BEFORE_RES  总帖=$BEFORE_ALL  消息=$BEFORE_MSGS"

echo
echo "=== 构造 dry run SQL（commit → rollback）==="
sed 's/^commit;$/rollback;/' "$SQL_FILE" > /tmp/wo11-delete-dry.sql
echo "  --- 末尾三行（确认是 rollback）---"
tail -3 /tmp/wo11-delete-dry.sql | sed 's/^/    /'

echo
echo "=== 执行 dry run ==="
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -f /tmp/wo11-delete-dry.sql 2>&1 | sed 's/^/    /'
RC=${PIPESTATUS[0]}
echo "  psql exit=$RC"

AFTER_RES="$(Q "select count(*) from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%'")"
AFTER_ALL="$(Q "select count(*) from posts")"
AFTER_MSGS="$(Q "select count(*) from messages")"

echo
echo "=== dry run 后（应完全没变）==="
echo "  候选帖=$AFTER_RES  总帖=$AFTER_ALL  消息=$AFTER_MSGS"

echo
if [ "$RC" = "0" ] && [ "$AFTER_RES" = "$BEFORE_RES" ] && [ "$AFTER_ALL" = "$BEFORE_ALL" ] && [ "$AFTER_MSGS" = "$BEFORE_MSGS" ]; then
  echo "WO11_DELETE_DRYRUN: PASS（SQL 可执行 + 断言未误报 + rollback 后数据完全未变）"
  echo "  ⚠️ 注意：dry run 只证明\"SQL 能跑通且断言不误报\"；"
  echo "     断言**能否拦住真错误**需要另做受控突变（见 wo11-assert-sensitivity.sh）"
  exit 0
else
  echo "WO11_DELETE_DRYRUN: FAIL"
  exit 1
fi
