#!/usr/bin/env bash
# 只读：取一份共享库的计数快照（用于事后对比"清理前/后"）
# 用途：子代理做完 E2E 会清它自己的残留；有了这份 before 快照，
#       就能验证它是否真的回到基线，而不是"看起来清了"。
set -u
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "SNAPSHOT_AT=$(date -Is)"
for T in users sessions login_challenges messages media board_notes message_threads thread_members message_media; do
  printf '%-20s %s\n' "$T" "$(PSQL "select count(*) from $T")"
done
echo "SEED_USERS         $(PSQL "select count(*) from users where phone_e164 in ('+8613800000001','+8613800000002','+8613800000003')")"
echo "TEST_RESIDUE_USERS $(PSQL "select count(*) from users where created_at >= '2026-09-21' and phone_e164 not in ('+8613800000001','+8613800000002','+8613800000003')")"
