#!/usr/bin/env bash
# WO14.5b：清理 `places` 表里的测试残留（`同名地点<数字>`）
#
# ## 依据（本轮实测）
#   · `places` 共 24 行：**真实 2 行** + **残留 22 行**（`同名地点<10位数字>`）
#   · 唯一外键是 `posts.place_id -> places.id`；
#     残留被 posts 引用的数量 = **0** ⇒ 删除不会破坏任何 post
#   · ⭐ 这 22 行之所以长期不可见，是因为 **`check-server-baseline.sh` 不覆盖 places**
#
# ## 为什么单独写脚本而不是一句 SQL
#   本项目纪律：**破坏性操作要显式**，并且要能**先看后做**、**做完能自证**。
#   因此：默认 **dry-run**（只报告将要删什么）；只有显式 `--apply` 才真删；
#   删除前**再次**断言"零引用"，删后**再断言**一次（失败即非零退出）。
#
# ## 安全边界
#   · 只删 `name like '同名地点%'` 的行（形态极窄，且是本轮实测认定的测试造数）
#   · **不**碰 `北京交通大学` 与 `达美乐比萨(广州萝岗万达广场)`（后者是**原版基线实测到**的地点）
#   · 有任何一行被引用 → **整体拒绝执行**（不做部分删除）
#
# 用法（服务器上）：
#   bash /tmp/cleanup-places-residue.sh            # dry-run（默认）
#   bash /tmp/cleanup-places-residue.sh --apply    # 真删
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
P() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
MODE="${1:-dry-run}"
FAIL=0

echo "=== 0) 形态确认 ==="
TOTAL="$(P "select count(*)::text from places" | tr -d '\n')"
RES="$(P "select count(*)::text from places where name like '同名地点%'" | tr -d '\n')"
REAL="$(P "select count(*)::text from places where name not like '同名地点%'" | tr -d '\n')"
echo "  places 总数=${TOTAL:-?}  残留=${RES:-?}  真实=${REAL:-?}"
echo "  --- 将要保留的真实行（务必核对）---"
P "select '    KEEP: ' || name || ' | ' || coalesce(address,'<null>') || ' | ' || latitude::text || ',' || longitude::text
     from places where name not like '同名地点%'"

echo
echo "=== 1) ⚠️ 安全断言：残留**不得**被任何 post 引用 ==="
REF="$(P "select count(*)::text
           from posts p join places pl on pl.id = p.place_id
          where pl.name like '同名地点%'" | tr -d '\n')"
echo "  被引用数 = ${REF:-?}（必须为 0）"
if [ "${REF:-1}" != "0" ]; then
  echo "  **ABORT** 有残留被 posts 引用 → 拒绝执行（不做部分删除）。"
  exit 3
fi
echo "  PASS 零引用，删除不会破坏任何 post"

echo
echo "=== 2) 残留行的形态抽样（确认确实是测试造数，不是真实数据）==="
P "select '    ' || name || ' | ' || coalesce(address,'<null>') || ' | ' || latitude::text || ',' || longitude::text
     from places where name like '同名地点%' order by name limit 5"

if [ "$MODE" != "--apply" ]; then
  echo
  echo "=== 3) DRY-RUN：未做任何修改 ==="
  echo "  将要删除 ${RES:-?} 行（name like '同名地点%'）"
  echo "  要真删请显式执行：bash /tmp/cleanup-places-residue.sh --apply"
  echo "PLACES_RESIDUE_CLEANUP: DRY_RUN_OK"
  exit 0
fi

echo
echo "=== 3) APPLY：执行删除 ==="
P "delete from places where name like '同名地点%'"
P "select '    deleted_remaining_residue=' || count(*)::text from places where name like '同名地点%'"

echo
echo "=== 4) 删后自证 ==="
T2="$(P "select count(*)::text from places" | tr -d '\n')"
R2="$(P "select count(*)::text from places where name like '同名地点%'" | tr -d '\n')"
R2REAL="$(P "select count(*)::text from places where name not like '同名地点%'" | tr -d '\n')"
echo "  places 总数=${T2:-?}  残留=${R2:-?}  真实=${R2REAL:-?}"
if [ "${R2:-1}" = "0" ]; then echo "  PASS 残留已清零"; else echo "  **FAIL** 残留仍为 ${R2}"; FAIL=1; fi
if [ "${R2REAL:-0}" = "2" ]; then echo "  PASS 两条真实行完好保留"; else echo "  **FAIL** 真实行数异常（期望 2，实际 ${R2REAL}）"; FAIL=1; fi
# 关键：post 的 place 关联不能被打断
ORPH="$(P "select count(*)::text from posts p left join places pl on pl.id=p.place_id
            where p.place_id is not null and pl.id is null" | tr -d '\n')"
echo "  posts 中 place 变成悬空的数量 = ${ORPH:-?}（必须为 0）"
if [ "${ORPH:-1}" = "0" ]; then echo "  PASS 没有 post 失去地点关联"; else echo "  **FAIL** 出现悬空引用"; FAIL=1; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "PLACES_RESIDUE_CLEANUP: PASS"; else echo "PLACES_RESIDUE_CLEANUP: FAIL"; fi
exit "$FAIL"
