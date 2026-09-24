#!/usr/bin/env bash
# M4：先清理历次失败运行留下的 fixture，再跑联合备份/恢复演练。
#
# 为什么要单独这一步：演练脚本前三次运行都因 bug 提前中断，A0 造的 fixture
# 没走到清理段，留下 6 条 media（含落盘文件）。演练脚本自己不该制造
# 需要别人来扫的垃圾 —— 这也正是 M4 要做的"孤儿清扫"要解决的同一类问题。
set -uo pipefail
export PGPASSWORD="$(cat /srv/campus/.db_password)"
UPLOADS=/srv/campus/uploads
SEED_MEDIA="'bbbbbbbb-0001-4001-8001-000000000001','bbbbbbbb-0002-4002-8002-000000000002'"
SEED_PHONES="'+8613800000001','+8613800000002','+8613800000003'"

echo "=== A. 清理历次失败运行留下的 fixture ==="
psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select id || ' ' || scope || '/' || storage_key from media where id not in ($SEED_MEDIA)" > /tmp/leftover.txt
CNT=0
while read -r mid rel; do
  [ -n "${mid:-}" ] || continue
  rm -f "$UPLOADS/$rel"
  psql -h 127.0.0.1 -U campus -d campus -q -c "delete from media where id='$mid'" >/dev/null
  CNT=$((CNT+1))
done < /tmp/leftover.txt
rm -f /tmp/leftover.txt
echo "  清理了 $CNT 条非种子 media（含落盘文件）"
psql -h 127.0.0.1 -U campus -d campus -q -c "delete from sessions where user_id in (select id from users where phone_e164 not in ($SEED_PHONES))" >/dev/null
psql -h 127.0.0.1 -U campus -d campus -q -c "delete from login_challenges where phone_e164 not in ($SEED_PHONES)" >/dev/null
psql -h 127.0.0.1 -U campus -d campus -q -c "delete from users where phone_e164 not in ($SEED_PHONES)" >/dev/null
echo "  剩余 media 行: $(psql -h 127.0.0.1 -U campus -d campus -Atc 'select count(*) from media')"
echo "  剩余 users: $(psql -h 127.0.0.1 -U campus -d campus -Atc 'select count(*) from users')"
echo "  盘上文件: $(find $UPLOADS/public $UPLOADS/private -type f 2>/dev/null | wc -l)"
rm -f /run/campus/login-codes/*.json 2>/dev/null || true

echo
echo "=== B. 跑联合备份/恢复演练（带 timeout 兜底，避免再次挂死）==="
if timeout 300 bash /tmp/m4-backup.sh; then
  echo "DRILL_EXIT 0"
else
  echo "DRILL_EXIT $?"
fi
