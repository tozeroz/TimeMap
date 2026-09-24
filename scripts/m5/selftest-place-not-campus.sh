#!/usr/bin/env bash
# 敏感度：证明 PLACE_DOES_NOT_IMPLY_CAMPUS 这条 Gate **真的能红**
#
# ════════════════════════════════════════════════════════════════════
# 依据（审核 60 的原话）
# ════════════════════════════════════════════════════════════════════
#   > Sensitivity 可以故意写：post.place == "北京交通大学" → 自动归属校本部。Gate 必须 FAIL。
#   > 因为这正是当前最容易为了"让数字出来"而重新引入的**数据伪造路径**。
#
# ⇒ 本脚本就**照审核的字面要求**做那次伪造：把 `place = 北京交通大学` 的帖子
#   归属到「校本部」，然后看 Gate 是否变红。
#
# ════════════════════════════════════════════════════════════════════
# ⚠️ 合规说明（为什么可以在 DB 上写）
# ════════════════════════════════════════════════════════════════════
#   用户硬约束是"对**原版第三方 app** 只读"。这里写的是**我们自己的**机房数据库
#   （自建后端 + 自建 PostgreSQL），用户明确允许："需要读写上下文的证据，
#   改在我们自己的 demo 里造数（自建后端与数据库，随便写）"。
#   ⚠️ 且本脚本**必定撤销**（trap EXIT + 显式撤销），不留残留。
#
# ════════════════════════════════════════════════════════════════════
# 三阶段
# ════════════════════════════════════════════════════════════════════
#   ① 基线   ：Gate 应为 PASS
#   ② 伪造   ：按审核字面执行"place=北京交通大学 → 校本部"
#              ⇒ PLACE_DOES_NOT_IMPLY_CAMPUS_DATA 必须 **FAIL**（且只有它红）
#   ③ 撤销   ：把归属改回 NULL ⇒ Gate 回到 PASS，并断言 DB 已无残留归属
#
# 用法：bash scripts/m5/selftest-place-not-campus.sh
set -uo pipefail
cd "G:/demo map" 2>/dev/null || cd "$(dirname "$0")/../.." || exit 2

KEY='G:\demo map\TimeMap.pem'
HOST='root@8.148.156.146'
GATE='scripts/m5/gate-place-not-campus.mjs'

ssh_sql() { ssh -i "$KEY" -o BatchMode=yes "$HOST" "PGPASSWORD=\$(cat /srv/campus/.db_password) psql -h 127.0.0.1 -U campus -d campus -Atc \"$1\""; }

# 撤销：把 posts/users 的归属清回 NULL（并顺带删掉为本实验造的 campus 行）
revoke() {
    # ⚠️ 这里修过一个**真实疏漏**：第一版只删了 campuses 行，**没删 schools 行**
  #    ⇒ 实验后 `schools = 1` 残留（实跑发现）。
  #    而主基线脚本 check-server-baseline.sh **不含 schools/campuses**
  #    ⇒ 那个残留**没被基线检查报出来** —— 与之前 `places` 22 行残留同一类：
  #      **清理不完整 + 检查未覆盖该表**。
  #    ⇒ 现在按实验用的**固定 UUID**精确删除（不用模糊条件），并对 schools 也做复核。
  ssh_sql "update posts set school_campus_id = null where school_campus_id is not null; update users set school_campus_id = null where school_campus_id is not null; delete from campuses where school_id = '99999999-0000-4000-8000-000000000001'; delete from schools where id = '99999999-0000-4000-8000-000000000001';" >/dev/null 2>&1 || true
  echo "  （撤销）已把 posts/users 的 school_campus_id 清回 NULL，并删除本实验造的 campus 行"
}
trap revoke EXIT

# ⚠️ 这里修过一个**我自己的错误**：门禁的裁决行是 **JSON** 形式
#      VERDICT = {"PLACE_DOES_NOT_IMPLY_CAMPUS_DATA":"PASS",...,"PLACE_NOT_CAMPUS_GATE":"PASS"}
#    而我第一版按 shell 赋值形式去 grep（`KEY = "PASS"`）⇒ **永远不匹配**
#    ⇒ 三个阶段都误报 FAIL，看起来像"断言没有判别力"，其实是我 grep 错了。
#    （又一次印证：**"断言/检查本身写错"与"实现错了"在输出上无法区分**。）
run_gate() { node "$GATE" 2>&1 | grep -E '"PLACE_DOES_NOT_IMPLY_CAMPUS|"PLACE_NOT_CAMPUS_GATE'; }

echo "════════ ① 基线：Gate 应为 PASS ════════"
BASE="$(run_gate)"
echo "$BASE" | sed 's/^/  /'
fail=0
if echo "$BASE" | grep -q '"PLACE_NOT_CAMPUS_GATE":"PASS"'; then
  echo "  PASS 基线为绿"
else
  echo "  **FAIL** 基线不是绿的"
  fail=1
fi

echo
echo "════════ ② 伪造：按审核字面执行「place=北京交通大学 → 校本部」════════"
# 造最小的实体（学校 + 校本部），再把 place=北京交通大学 的帖子挂上去 ——
# 这正是审核所说的"最容易为了数字而走的路"。
INJECT=$(ssh_sql "
insert into schools (id, name) values ('99999999-0000-4000-8000-000000000001','北京交通大学') on conflict (id) do nothing;
insert into campuses (id, school_id, name) values ('99999999-0000-4000-8000-000000000002','99999999-0000-4000-8000-000000000001','校本部') on conflict (id) do nothing;
update posts set school_campus_id = '99999999-0000-4000-8000-000000000002' where place_id in (select id from places where name = '北京交通大学');
select 'attributed_posts=' || count(*) from posts where school_campus_id is not null;
" 2>&1)
echo "  $INJECT" | sed 's/^/  /'

MUT="$(run_gate)"
echo "$MUT" | sed 's/^/  /'
if echo "$MUT" | grep -q '"PLACE_DOES_NOT_IMPLY_CAMPUS_DATA":"FAIL"'; then
  echo "  PASS ⭐ 数据层断言**真的能红**（这正是审核要求的那条伪造路径）"
else
  echo "  **FAIL** ⭐ 伪造之后 Gate 竟然没红 ⇒ 它**没有判别力**"
  fail=1
fi
if echo "$MUT" | grep -q '"PLACE_NOT_CAMPUS_GATE":"FAIL"'; then
  echo "  PASS 总裁决变 FAIL"
else
  echo "  **FAIL** 总裁决没变 FAIL"
  fail=1
fi

echo
echo "════════ ③ 撤销：应回到 PASS 且 DB 无残留归属 ════════"
revoke
REST="$(run_gate)"
echo "$REST" | sed 's/^/  /'
if echo "$REST" | grep -q '"PLACE_NOT_CAMPUS_GATE":"PASS"'; then
  echo "  PASS 撤销后回到绿（证明②的变红确实由那次伪造引起）"
else
  echo "  **FAIL** 撤销后没回到绿"
  fail=1
fi
# 独立核对 DB：归属必须为 0
LEFT="$(ssh_sql "select count(*) from posts where school_campus_id is not null")"
if [ "$LEFT" = "0" ]; then
  echo "  PASS DB 复核：posts 带归属的行数 = 0"
else
  echo "  **FAIL** DB 仍有 $LEFT 行带归属（残留！）"
  fail=1
fi
# ⚠️ 同时复核**实验造的实体**（schools / campuses）也必须清干净 —— 第一版漏了这条
LEFTS="$(ssh_sql "select count(*) from schools where id = '99999999-0000-4000-8000-000000000001'")"
LEFTC="$(ssh_sql "select count(*) from campuses where school_id = '99999999-0000-4000-8000-000000000001'")"
if [ "$LEFTS" = "0" ] && [ "$LEFTC" = "0" ]; then
  echo "  PASS DB 复核：实验造的 schools/campuses 行数 = 0"
else
  echo "  **FAIL** 实验造的实体有残留（schools=$LEFTS campuses=$LEFTC）"
  fail=1
fi

echo
if [ "$fail" = "0" ]; then
  echo "SELFTEST_PLACE_NOT_CAMPUS: PASS（那条伪造路径已被证明会被 Gate 抓住；撤销后 DB 无残留）"
else
  echo "SELFTEST_PLACE_NOT_CAMPUS: FAIL"
fi
exit "$fail"
