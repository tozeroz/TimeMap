#!/usr/bin/env bash
# ⭐ 审核 62 点名要求的小敏感度：
#     "4 posts 中只给 1 条设置 campus → 所有 campusCircleCount 仍必须是 null"
#
# ════════════════════════════════════════════════════════════════════
# 为什么这条能抓出真问题（它抓的正是我原来的 bug）
# ════════════════════════════════════════════════════════════════════
#   旧规则（错）："平台里有没有**任何**一条非空归属" ⇒ 有就算覆盖完整
#     ⇒ 4 条帖子里只给 1 条归属时，旧实现会返回
#          校本部 = 1 ／ 威海校区 = 0 ／ 东校区 = 0
#       —— 那两个 0 是**伪造**：另外 3 条 NULL 完全可能属于任意校区。
#   新规则（对）：
#     ```
#     totalRelevantPosts == 0         → 覆盖完整 ⇒ 允许 0
#     0 <= attributed < total         → **覆盖不完整 ⇒ 全部 null**
#     attributed == total             → 覆盖完整 ⇒ 才允许真实 COUNT
#     ```
#
# ⚠️ 合规：写的是**我们自己的**库（只读约束只针对原版 app）；且本脚本**必定撤销**（trap EXIT）。
#
# 三阶段：
#   ① 基线（0 条归属，4 条帖）      ⇒ 全部 count 必须为 null
#   ② 只给 **1 条**帖子设 campus    ⇒ **仍是全部 null**（覆盖不完整）  ← 关键
#   ③ 撤销回 0 条归属              ⇒ 回到全部 null，且 DB 复核无残留
#   （附加）④ 给**全部 4 条**设 campus ⇒ 此时**允许**出现真实数字（证明规则不是"永远 null"）
#
# 用法：bash scripts/m5/selftest-campus-count-coverage.sh
set -uo pipefail
cd "G:/demo map" 2>/dev/null || cd "$(dirname "$0")/../.." || exit 2

KEY='G:\demo map\TimeMap.pem'
HOST='root@8.148.156.146'
API='https://8.148.156.146'
SCHOOL='b0000000-0000-4000-8000-000000000001'
CAMPUS_XIAOBEN='c0000000-0000-4000-8000-000000000001'

ssh_sql() {
  ssh -i "$KEY" -o BatchMode=yes "$HOST" \
    "PGPASSWORD=\$(cat /srv/campus/.db_password) psql -h 127.0.0.1 -U campus -d campus -Atc \"$1\"" 2>/dev/null
}

revoke() {
  ssh_sql "update posts set school_campus_id = null where school_campus_id is not null;" >/dev/null 2>&1 || true
  echo "  （撤销）已把所有 posts.school_campus_id 清回 NULL"
}
trap revoke EXIT

# 取本次要用的 API 返回（只取我们关心的字段，避免大输出）
api_counts() {
  curl -s -k "$API/api/schools/$SCHOOL/campuses" \
    | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try{const j=JSON.parse(s);
          const counts=(j.items||[]).map(i=>i.campusCircleCount);
          console.log(JSON.stringify({complete:j.attributionCoverageComplete,
            coverage:j.coverage||null,counts}));
        }catch(e){console.log(JSON.stringify({error:String(e.message)}))}
      })'
}

fail=0
echo "════════ ① 基线：0 条归属（4 条帖）⇒ 全部 count 必须为 null ════════"
TOTAL="$(ssh_sql 'select count(*) from posts')"
echo "  posts 总数 = $TOTAL"
A1="$(api_counts)"; echo "  $A1"
if echo "$A1" | grep -q '"counts":\[null,null,null\]'; then
  echo "  PASS 全部为 null"
else
  echo "  **FAIL** 期望全部 null"; fail=1
fi

echo
echo "════════ ② 只给 1 条帖子设 campus ⇒ **仍必须全部为 null** ⭐（审核 62 的关键用例） ════════"
ssh_sql "update posts set school_campus_id = '$CAMPUS_XIAOBEN' where id = (select id from posts order by id limit 1);" >/dev/null
ONE="$(ssh_sql 'select count(*) from posts where school_campus_id is not null')"
echo "  现在有归属的帖子数 = $ONE ／ 总帖数 = $TOTAL（覆盖不完整）"
A2="$(api_counts)"; echo "  $A2"
if echo "$A2" | grep -q '"counts":\[null,null,null\]'; then
  echo "  PASS ⭐ 覆盖不完整时仍然全部 null（旧实现这里会返回 1/0/0 —— 那正是被修的 bug）"
else
  echo "  **FAIL** 覆盖不完整却给出了数字 ⇒ 覆盖率语义仍然错"; fail=1
fi
if echo "$A2" | grep -q '"complete":false'; then
  echo "  PASS attributionCoverageComplete=false 如实反映覆盖不完整"
else
  echo "  **FAIL** attributionCoverageComplete 未如实反映"; fail=1
fi

echo
echo "════════ ③ 撤销 ⇒ 回到全部 null，且 DB 无残留 ════════"
revoke
A3="$(api_counts)"; echo "  $A3"
LEFT="$(ssh_sql 'select count(*) from posts where school_campus_id is not null')"
if [ "$LEFT" = "0" ] && echo "$A3" | grep -q '"counts":\[null,null,null\]'; then
  echo "  PASS 撤销后 DB 无归属残留，API 回到全部 null"
else
  echo "  **FAIL** 撤销不彻底（残留 $LEFT）"; fail=1
fi

echo
echo "════════ ④ 覆盖**完整**时才允许真实数字（证明规则不是"永远给 null"）════════"
ssh_sql "update posts set school_campus_id = '$CAMPUS_XIAOBEN';" >/dev/null
ALL="$(ssh_sql 'select count(*) from posts where school_campus_id is not null')"
echo "  现在有归属的帖子数 = $ALL ／ 总帖数 = $TOTAL（覆盖完整）"
A4="$(api_counts)"; echo "  $A4"
if echo "$A4" | grep -q '"complete":true' && ! echo "$A4" | grep -q '"counts":\[null,null,null\]'; then
  echo "  PASS ⭐ 覆盖完整时给出**真实** COUNT（校本部 = 全部帖数，其余为 0 —— 此时 0 是**有资格**的）"
else
  echo "  **FAIL** 覆盖完整时仍给 null ⇒ 规则退化成永远不可用"; fail=1
fi

echo
echo "（撤销，使库回到种子口径）"
revoke
FINAL="$(ssh_sql 'select count(*) from posts where school_campus_id is not null')"
echo "  最终归属残留 = $FINAL"

echo
if [ "$fail" = "0" ]; then
  echo "SELFTEST_CAMPUS_COUNT_COVERAGE: PASS（覆盖不完整⇒null；覆盖完整⇒真实数字；两端都已证明）"
else
  echo "SELFTEST_CAMPUS_COUNT_COVERAGE: FAIL"
fi
exit "$fail"
