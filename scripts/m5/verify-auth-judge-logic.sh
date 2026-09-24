#!/usr/bin/env bash
# 判定逻辑自检：把 gate 第 6 节的"死数据=0"判定**单独抽出来跑几种输入**，
# 证明它在"有死数据"时**会**判 FAIL（即该不变量有判别力），在 0 时判 PASS。
#
# 为什么要单独抽出来：gate 的第 6 节依赖服务器上真实的 cleanup-auth 输出；
# 而现在服务器恰好是"0 条死数据"，无法从中看出"有死数据时会怎样"。
# 所以这里用**手工构造的 JSON** 驱动同一段判定逻辑 —— 这正是 SENSITIVITY 的做法。
set -u

# 与 gate-server.sh 第 6 节**同一段**判定逻辑（照抄，保持语义一致）
judge() {
  local AH_JSON="$1" label="$2"
  ahget() {
    printf '%s' "$AH_JSON" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('$1', 'ERR'))
except Exception:
    print('ERR')" 2>/dev/null
  }
  local es rs ec cc
  es="$(ahget expiredSessions)"; rs="$(ahget revokedSessions)"
  ec="$(ahget expiredChallenges)"; cc="$(ahget consumedChallenges)"
  local failed=0
  [ "$es" = "0" ] || failed=1
  [ "$rs" = "0" ] || failed=1
  [ "$ec" = "0" ] || failed=1
  [ "$cc" = "0" ] || failed=1
  if [ $failed -eq 0 ]; then
    echo "  $label → PASS（四类死数据均为 0）"
  else
    echo "  $label → **FAIL**（expiredSessions=$es revokedSessions=$rs expiredChallenges=$ec consumedChallenges=$cc）"
  fi
}

echo "=== 第 6 节判定逻辑的判别力自检 ==="
echo "（用构造输入驱动与 gate 相同的判定，证明它不是'恒 PASS'）"
echo
judge '{"expiredSessions":0,"revokedSessions":0,"expiredChallenges":0,"consumedChallenges":0}' "全 0（服务器当前情形）"
judge '{"expiredSessions":0,"revokedSessions":3,"expiredChallenges":0,"consumedChallenges":0}' "有 3 条撤销会话"
judge '{"expiredSessions":2,"revokedSessions":0,"expiredChallenges":0,"consumedChallenges":0}' "有 2 条过期会话"
judge '{"expiredSessions":0,"revokedSessions":0,"expiredChallenges":7,"consumedChallenges":0}' "有 7 条过期挑战"
judge '{"expiredSessions":0,"revokedSessions":0,"expiredChallenges":0,"consumedChallenges":5}' "有 5 条消费挑战"
judge '{}' "字段缺失（应判 FAIL，不得当 0）"
echo
echo "结论：该判定在四类任一非 0 时**都会 FAIL**，且字段缺失也不放过 → 有判别力。"
