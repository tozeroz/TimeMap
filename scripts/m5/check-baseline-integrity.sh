#!/usr/bin/env bash
# 检查共享 demo 库的"基线完整性"：种子是否还在、有没有测试残留没清干净。
#
# 为什么需要：多个子代理在不同时间跑过真机/接口验证，各自建过临时账号。
# 若某个子代理没清理干净，残留会：
#   1. 让**计数类断言**无故失败（本项目多个 Gate 做这种断言）
#   2. 让"当前状态"与"种子基线"不一致，后续排查时误导判断
# 已发生的事实：前端子代理报告"服务端 DB 被并发写者重置过（users=11）"，
# 而隔离验证当时显示 SEED_USERS=3 —— 差距需要解释。
#
# ⚠️ 环境守卫（2026-09-22 加）：本脚本**只能在服务器上跑**。
#   原因：它依赖 `/srv/campus/.db_password` 与 `psql`。
#   为什么必须显式挡：我把它误放进"本地检查聚合器"后，在 Windows 上跑它，
#   输出的是满屏 `cat: /srv/campus/.db_password: No such file` + `psql: command not found` ——
#   **失败原因与它要验证的性质毫无关系**。
#   一个"因为错误的原因而红"的检查会训练人忽略红色，所以这里宁可**早退 + 说清**。
set -u
if [ ! -f /srv/campus/.db_password ] || ! command -v psql >/dev/null 2>&1; then
  echo "ABORT 本脚本只能在服务器上运行（需要 /srv/campus/.db_password 与 psql）。" >&2
  echo "      当前环境缺：$([ ! -f /srv/campus/.db_password ] && echo '/srv/campus/.db_password ')$(command -v psql >/dev/null 2>&1 || echo 'psql')" >&2
  echo "      请先 scp 到服务器再执行：bash /tmp/check-baseline-integrity.sh" >&2
  echo "      本地聚合器已把它移出（见 scripts/m5/check-all-local.sh 的文件头）。" >&2
  exit 3
fi
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) 种子基线核对（canonical seed 里的账号应当都在）==="
echo "  种子文件: /srv/campus/seed-canonical.txt"
if [ -f /srv/campus/seed-canonical.txt ]; then
  echo "  --- 文件里登记的账号（前 10 行）---"
  head -10 /srv/campus/seed-canonical.txt | sed 's/^/    /'
else
  echo "  （种子文件不存在）"
fi

echo
echo "=== 2) 当前用户表（看是否有测试残留）==="
echo "  users 总数: $(PSQL 'select count(*) from users')"
echo "  --- 前 20 个账号（手机号 + 昵称 + 创建时间）---"
PSQL "select '+86' || phone_e164, coalesce(display_name,'(无昵称)'), to_char(created_at,'MM-DD HH24:MI') from users order by created_at limit 20" | sed 's/^/    /'

echo
echo "=== 3) 其它容易积残留的表 ==="
for T in sessions login_challenges messages media board_notes message_threads threads; do
  C=$(PSQL "select count(*) from $T" 2>/dev/null)
  echo "  $T: ${C:-（表不存在或查询失败）}"
done

echo
echo "=== 4) 疑似测试残留（按创建时间近 2 小时）==="
echo "  近 2 小时新建的 users:      $(PSQL "select count(*) from users where created_at > now() - interval '2 hours'")"
echo "  近 2 小时新建的 messages:   $(PSQL "select count(*) from messages where created_at > now() - interval '2 hours'")"
echo "  近 2 小时新建的 media:      $(PSQL "select count(*) from media where created_at > now() - interval '2 hours'")"
echo "  近 2 小时新建的 board_notes:$(PSQL "select count(*) from board_notes where created_at > now() - interval '2 hours'")"

echo
echo "=== 5) 盘上与 DB 的一致性（orphan / unattached）==="
cd /srv/campus/server || exit 1
UPLOAD_ROOT=/srv/campus/uploads DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" \
  node dist/cleanup.mjs --json 2>&1 | head -c 500
echo
echo
echo "注意：本脚本**只读**，不做任何清理。清理需另行决定（见输出结论）。"
