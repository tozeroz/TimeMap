#!/usr/bin/env bash
# X2 自测：破坏性门禁的**两条关键路径**
#
# 依据审核记录 55：把 TMP_SELFHEAL / restart test 从常规回归拆出为
# **DESTRUCTIVE_SELF_HEAL_GATE**，要求显式 maintenance / exclusive execution。
#
# 本自测验证：
#   ① 锁被他人占用时 → 破坏性 runner **拒绝执行**（exit 3），不并发
#   ② 没有显式开启时 → 第 3 节记 SKIPPED_DESTRUCTIVE，**且不重启后端**
#      （这一条已在 run-gate.sh 那边按"后端启动时间未变"验证过，这里再核一次输出）
#   ③ 显式开启（M5_ALLOW_DESTRUCTIVE=1）→ 第 3 节**真跑**（会重启后端 + 清 .tmp）
#      —— 本条**只在明确知道会短暂不可用时**才跑；默认由 SELFTEST_GO_DESTRUCTIVE=1 控制
set -uo pipefail
LOCK=/srv/campus/gate.lock
SELFHEAL_SVC=campus-backend.service
FAIL=0

echo "=== ① 锁被占用 → runner 必须拒绝（exit 3）==="
printf 'other-gate|999999|%s|otherhost\n' "$(date +%s)" > "$LOCK"
OUT1="$(bash /tmp/run-destructive-gate.sh /tmp/x2-should-not-run.txt 2>&1)"
RC1=$?
printf '%s\n' "$OUT1" | tail -3 | sed 's/^/    /'
echo "    exit=$RC1（期望 3）"
if [ "$RC1" = "3" ] && printf '%s' "$OUT1" | grep -q '必须独占'; then
  echo "  PASS 正确拒绝（未并发执行破坏性门禁）"
else
  echo "  FAIL 期望 exit 3 且提示必须独占"
  FAIL=1
fi
rm -f "$LOCK"

echo
echo "=== ② 未显式开启 → 第 3 节记 SKIPPED_DESTRUCTIVE 且**不重启后端** ==="
T_BEFORE="$(systemctl show "$SELFHEAL_SVC" -p ExecMainStartTimestamp --value)"
OUT2="$(bash /tmp/gate-m5.sh 2>&1)"
T_AFTER="$(systemctl show "$SELFHEAL_SVC" -p ExecMainStartTimestamp --value)"
printf '%s' "$OUT2" | grep -E 'M5_TMP_SELFHEAL|DESTRUCTIVE' | head -4 | sed 's/^/    /'
echo "    后端启动时间：$T_BEFORE  →  $T_AFTER"
if printf '%s' "$OUT2" | grep -q 'M5_TMP_SELFHEAL *SKIPPED_DESTRUCTIVE' && [ "$T_BEFORE" = "$T_AFTER" ]; then
  echo "  PASS 已跳过且**没有重启后端**（审核 55 的核心要求）"
else
  echo "  FAIL 要么没跳过、要么重启了后端"
  FAIL=1
fi

echo
echo "=== ③ 显式开启 → 第 3 节真跑（**会重启后端**）==="
if [ "${SELFTEST_GO_DESTRUCTIVE:-0}" != "1" ]; then
  echo "  SKIPPED（未设置 SELFTEST_GO_DESTRUCTIVE=1）—— 本项会制造短暂不可用，需显式开启"
  echo "  ⚠️ 注意：这里的「跳过」**不是 PASS**，只是没执行（与门禁里同一纪律）"
else
  T_B3="$(systemctl show "$SELFHEAL_SVC" -p ExecMainStartTimestamp --value)"
  OUT3="$(M5_ALLOW_DESTRUCTIVE=1 bash /tmp/gate-m5.sh 2>&1)"
  T_A3="$(systemctl show "$SELFHEAL_SVC" -p ExecMainStartTimestamp --value)"
  printf '%s' "$OUT3" | grep -E 'M5_TMP_SELFHEAL|DESTRUCTIVE|就绪' | head -5 | sed 's/^/    /'
  echo "    后端启动时间：$T_B3  →  $T_A3"
  if [ "$T_B3" != "$T_A3" ] && printf '%s' "$OUT3" | grep -q 'M5_TMP_SELFHEAL *PASS'; then
    echo "  PASS 显式开启后**真的跑了**（后端被重启、且断言 PASS）"
  else
    echo "  FAIL 显式开启后没有真正执行破坏性测试"
    FAIL=1
  fi
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "SELFTEST_DESTRUCTIVE_GATE: PASS"
else
  echo "SELFTEST_DESTRUCTIVE_GATE: FAIL"
fi
exit "$FAIL"
