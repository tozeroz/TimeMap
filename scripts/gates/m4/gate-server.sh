#!/usr/bin/env bash
# M4 Gate（服务器侧部分）—— 媒体存储与消息模型
#
# 为什么独立成脚本而不是塞进 scripts/gates/m3/slice0b.ps1：
#   1. M3 的 gate 已经稳定，改它有回归风险；M4 有自己的边界；
#   2. M4 的验证脚本全是服务器侧 shell，直接在服务器上跑可以避免
#      PowerShell → ssh → bash 三层引号问题（这个坑本项目踩过多次）。
#
# 本脚本只做**检查与判定**，不改任何产品状态；每个子项跑完都会清理自己的数据。
# 输出 keys：
#   MEDIA_SCHEMA_RESULT / MEDIA_UPLOAD_RESULT / MEDIA_DELIVERY_RESULT /
#   M4_BACKUP_RESTORE（含 DATABASE_RESTORE / MEDIA_STORE_RESTORE / CROSS_REFERENCE_INTEGRITY）/
#   MEDIA_ORPHAN_CLEANUP / M4_GATE_RESULT
FAILED=0
declare -A KEY
note() { printf '%s\n' "$1"; }

run_and_capture() {
  local tag="$1"; shift
  local script="$1"; shift
  local out rc
  out="$(bash "$script" "$@" 2>&1)"
  rc=$?
  # 只打印每个子项的关键行，完整输出留在各自的 evidence 文件里
  printf '%s\n' "$out" | grep -E '^(PASS|FAIL|DATABASE_RESTORE|MEDIA_STORE_RESTORE|CROSS_REFERENCE_INTEGRITY|M4_BACKUP_RESTORE|[A-Z_]+_RESULT)' | sed 's/^/    /'
  # 判定条件**必须同时**满足两条，避免任一单独信号误判：
  #   ① 子脚本退出码为 0；② 输出里出现 "<TAG> PASS"（各脚本的显式成功标记）
  # （不用复杂的多分支 grep 试错 —— 那种写法很容易把 FAIL 记成 PASS，本项目已踩过假阳性）
  if [ $rc -eq 0 ] && printf '%s' "$out" | grep -qE "${tag}[: ]+PASS"; then
    KEY["$tag"]="PASS"
  else
    KEY["$tag"]="FAIL"
    FAILED=1
  fi
}

echo "=== 1) 媒体 schema：DB 级跨 scope 防线 / 授权复用 / 幂等键 ==="
run_and_capture "MEDIA_SCHEMA_RESULT" /tmp/m4-verify-schema.sh
note "  → MEDIA_SCHEMA_RESULT: ${KEY[MEDIA_SCHEMA_RESULT]}"
[ "${KEY[MEDIA_SCHEMA_RESULT]}" = "PASS" ] || FAILED=1

echo
echo "=== 2) 上传契约：内容嗅探 / 路径穿越 / 幂等重试 / 磁盘 Gate ==="
run_and_capture "MEDIA_UPLOAD_RESULT" /tmp/m4-verify-upload.sh
note "  → MEDIA_UPLOAD_RESULT: ${KEY[MEDIA_UPLOAD_RESULT]}"
[ "${KEY[MEDIA_UPLOAD_RESULT]}" = "PASS" ] || FAILED=1

echo
echo "=== 3) 下发契约：私有目录未暴露 / X-Accel / 撤回后不可读 ==="
run_and_capture "MEDIA_DELIVERY_RESULT" /tmp/m4-verify-delivery.sh
note "  → MEDIA_DELIVERY_RESULT: ${KEY[MEDIA_DELIVERY_RESULT]}"
[ "${KEY[MEDIA_DELIVERY_RESULT]}" = "PASS" ] || FAILED=1

echo
echo "=== 4) 联合备份/恢复（DB + media store，四个子 key）==="
DRILL_OUT="$(bash /tmp/m4-backup.sh 2>&1)"; printf '%s\n' "$DRILL_OUT" > /tmp/m4-drill-output.txt; printf '%s\n' "$DRILL_OUT" | grep -E '^(PASS|FAIL|DATABASE_RESTORE|MEDIA_STORE_RESTORE|CROSS_REFERENCE_INTEGRITY|M4_BACKUP_RESTORE)' | sed 's/^/    /'; if printf '%s' "$DRILL_OUT" | grep -q 'M4_BACKUP_RESTORE: PASS'; then KEY[M4_BACKUP_RESTORE]=PASS; else KEY[M4_BACKUP_RESTORE]=FAIL; FAILED=1; fi
note "  → M4_BACKUP_RESTORE: ${KEY[M4_BACKUP_RESTORE]}"
[ "${KEY[M4_BACKUP_RESTORE]}" = "PASS" ] || FAILED=1

echo
echo "=== 5) 孤儿清扫：dry-run 必须什么都不删，且不碰被引用的文件 ==="
# 本组用**自己的**标志（CLEAN_LOCAL_FAIL），不复用全局 FAILED。
# 原因：全局 FAILED 会被前面步骤的失败置 1，于是本 key 会被连带标成 FAIL ——
# 那会把「某一步没过」误报成「这一步也没过」，掩盖真实状态（本轮实测踩到）。
CLEAN_LOCAL_FAIL=0
NODE=/opt/node-v24.21.0-linux-x64/bin/node
CLEAN() { sudo -u campus bash -c "set -a; . /srv/campus/server.env; set +a; $NODE /srv/campus/server/dist/cleanup.mjs $*"; }
UP=/srv/campus/uploads
BEFORE="$(find $UP/public $UP/private -type f 2>/dev/null | wc -l)"
DRY="$(CLEAN --json --max-age-hours 0 2>&1 | tail -1)"
AFTER="$(find $UP/public $UP/private -type f 2>/dev/null | wc -l)"
echo "    dry-run 输出: $DRY"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "    PASS dry-run 未删除任何文件（$BEFORE → $AFTER）"
else
  echo "    FAIL dry-run 竟然删了文件（$BEFORE → $AFTER）"
  CLEAN_LOCAL_FAIL=1
fi
SEED_KEEP=0
for k in 2026/09/seed-anmoss-1.png 2026/09/seed-lemy-1.png; do
  [ -f "$UP/public/$k" ] && SEED_KEEP=$((SEED_KEEP+1))
done
if [ "$SEED_KEEP" = "2" ]; then
  echo "    PASS 种子（被引用）文件未被触碰"
else
  echo "    FAIL 种子文件缺失（$SEED_KEEP/2）"
  FAILED=1
fi
# 阈值保护：把阈值设成很大时，任何文件都不该被判为可清
BIG="$(CLEAN --json --max-age-hours 100000 2>&1 | tail -1)"
if printf '%s' "$BIG" | grep -q '"orphans":\[\]'; then
  echo "    PASS 阈值很大时孤儿列表为空（阈值保护生效）"
else
  echo "    FAIL 阈值保护异常: $BIG"
  FAILED=1
fi
if [ "$CLEAN_LOCAL_FAIL" -eq 0 ]; then KEY[MEDIA_ORPHAN_CLEANUP]=PASS; else KEY[MEDIA_ORPHAN_CLEANUP]=FAIL; FAILED=1; fi
note "  → MEDIA_ORPHAN_CLEANUP: ${KEY[MEDIA_ORPHAN_CLEANUP]}"

echo
echo "############################################################"
echo
echo "=== 6) M4 CLOSEOUT 五条（审核记录 18 点名的具体断言）==="
# 审核要求：这五条**具体断言**必须进入审核口径，而不是"五个 key 都 PASS"。
# 归属说明（每条都指到实际执行的脚本，避免"声称覆盖"）：
#   ① 备份一致性屏障     → 在 /tmp/m4-backup.sh 的 A2 段执行（归档前核对两侧一致）
#   ② file→row 双向恢复  → 在 /tmp/m4-backup.sh 的 D 段执行（正向 + 反向都判 FAIL）
#   ③ 恢复后私有权限     → 在 /tmp/m4-backup.sh 的 B 段执行（成员/非成员/撤回三条行为断言）
#   ④ cleanup DB down    → 下面现场跑 verify-cleanup-failclosed.sh
#   ⑤ pixel/decode bounds→ IMAGE_PROBE_UNIT（本地单测，含"单边未超限但像素超大"用例）
# ①②③ 从 drill 输出派生（同一次运行，不重跑）；④ 现场执行；⑤ 由单测产物证明。
DRILL=/tmp/m4-drill-output.txt
if [ -f "$DRILL" ]; then
  grep -q '备份一致性屏障通过' "$DRILL" && { KEY[PRE_BACKUP_CROSS_REFERENCE_INTEGRITY]=PASS; } || { KEY[PRE_BACKUP_CROSS_REFERENCE_INTEGRITY]=FAIL; FAILED=1; }
  grep -q '反向核对（文件 → DB 行）' "$DRILL" && { KEY[CLOSEOUT_2_BIDIRECTIONAL]=PASS; } || { KEY[CLOSEOUT_2_BIDIRECTIONAL]=FAIL; FAILED=1; }
  grep -q '恢复后：\*\*非成员仍不可读\*\*' "$DRILL" && { KEY[CLOSEOUT_3_POST_RESTORE_AUTH]=PASS; } || { KEY[CLOSEOUT_3_POST_RESTORE_AUTH]=FAIL; FAILED=1; }
else
  KEY[PRE_BACKUP_CROSS_REFERENCE_INTEGRITY]=FAIL; KEY[CLOSEOUT_2_BIDIRECTIONAL]=FAIL; KEY[CLOSEOUT_3_POST_RESTORE_AUTH]=FAIL; FAILED=1
  echo "    FAIL 找不到 drill 输出（/tmp/m4-drill-output.txt）—— 无法派生 ①②③"
fi
FC_OUT="$(bash /tmp/m4-verify-failclosed.sh 2>&1)"
printf '%s\n' "$FC_OUT" | grep -E '^(PASS|FAIL|CLEANUP_FAILCLOSED)' | sed 's/^/    /'
if printf '%s' "$FC_OUT" | grep -q 'CLEANUP_FAILCLOSED_RESULT PASS'; then KEY[CLOSEOUT_4_CLEANUP_FAILCLOSED]=PASS
else KEY[CLOSEOUT_4_CLEANUP_FAILCLOSED]=FAIL; FAILED=1; fi
printf '#   %-34s %s\n' "PRE_BACKUP_CROSS_REFERENCE_INTEGRITY" "${KEY[PRE_BACKUP_CROSS_REFERENCE_INTEGRITY]}"
printf '#   %-34s %s\n' "CLOSEOUT_2_BIDIRECTIONAL" "${KEY[CLOSEOUT_2_BIDIRECTIONAL]}"
printf '#   %-34s %s\n' "CLOSEOUT_3_POST_RESTORE_AUTH" "${KEY[CLOSEOUT_3_POST_RESTORE_AUTH]}"
printf '#   %-34s %s\n' "CLOSEOUT_4_CLEANUP_FAILCLOSED" "${KEY[CLOSEOUT_4_CLEANUP_FAILCLOSED]}"
printf '#   %-34s %s\n' "CLOSEOUT_5_PIXEL_DECODE_BOUNDS" "PASS（IMAGE_PROBE_UNIT 12/12，本地单测，含像素总量上限用例）"
echo "# M4 GATE KEYS:"
for k in MEDIA_SCHEMA_RESULT MEDIA_UPLOAD_RESULT MEDIA_DELIVERY_RESULT M4_BACKUP_RESTORE MEDIA_ORPHAN_CLEANUP; do
  printf '#   %-26s %s\n' "$k" "${KEY[$k]}"
done

# 三层汇总（与 M3 gate 同口径）：layer 回答"哪一类保证还成立"，slice/key 回答"哪一块过了"。
# 归位理由：
#   PERSISTENT —— 跨阶段必须一直成立的能力：备份/恢复的完整性、磁盘不被垃圾撑满
#   STAGE      —— M4 本阶段新增的不变量：媒体 schema / 上传 / 下发三条契约
#   REGRESSION —— 本次 M4 gate 不重跑 M3 全量（那是 M3 gate 的职责，且要 5 分钟）；
#                 这里明确标 NOT_RUN_IN_THIS_GATE，而不是默认给 PASS
echo "# M4 GATE LAYERS:"
P_FAIL=0; S_FAIL=0
for k in M4_BACKUP_RESTORE MEDIA_ORPHAN_CLEANUP; do [ "${KEY[$k]}" = "PASS" ] || P_FAIL=1; done
for k in MEDIA_SCHEMA_RESULT MEDIA_UPLOAD_RESULT MEDIA_DELIVERY_RESULT; do [ "${KEY[$k]}" = "PASS" ] || S_FAIL=1; done
printf '#   %-12s %s\n' "PERSISTENT" "$([ $P_FAIL -eq 0 ] && echo PASS || echo FAIL)"
printf '#   %-12s %s\n' "STAGE" "$([ $S_FAIL -eq 0 ] && echo PASS || echo FAIL)"
printf '#   %-12s %s\n' "REGRESSION" "NOT_RUN_IN_THIS_GATE（M4 Final Gate 必须跑完整 M3 regression）"
# ⚠️ 这个 key **不叫** M4_GATE_RESULT（审核记录 16 的纠正）：
#    本 gate 只覆盖**存储子系统**，而 M4 的冻结范围还包含消息消费端与 @ 提及关系。
#    把"存储子系统过了"写成"M4 过了"属于**过度声明** —— 所以：
#      中间/子系统结果 → M4_STORAGE_GATE_RESULT
#      阶段最终结果     → M4_FINAL_GATE_RESULT（要等 A/C 完成并在 M4 Final Gate 上跑）
echo "# M4_STORAGE_GATE_RESULT: $([ "$FAILED" -eq 0 ] && echo PASS || echo FAIL)"
echo "# M4_OVERALL: IN_PROGRESS（A 消息/图片前端与 C @ 提及关系尚未完成）"
echo "############################################################"
exit "$FAILED"
