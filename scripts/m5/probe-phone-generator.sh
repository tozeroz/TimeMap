#!/usr/bin/env bash
# 排查"间歇性登录失败"的一个具体可测假设：
#   verify-message-media.sh / verify-board-notes.sh 用
#     PA="139$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
#   生成手机号。若 $((RANDOM*RANDOM%100000000)) 出现**负值**，
#   printf '%08d' 会产出 "-0123456"，于是手机号变成 "139-0123456"（非法）→
#   request-code 400 → 拿不到 token → 脚本报「登录失败」。
#   这能解释"同一脚本有时 PASS 有时 FAIL"。
#
# 本脚本只测**生成器**（不碰服务端），跑大批量统计形态分布。
set -uo pipefail
N="${1:-2000}"

echo "=== 1) 生成器形态统计（$N 次）==="
BAD=0; NEG=0; SHORT=0; NONNUM=0
declare -A LEN=()
for i in $(seq 1 "$N"); do
  V=$((RANDOM*RANDOM%100000000))
  [ "$V" -lt 0 ] && NEG=$((NEG+1))
  P="139$(printf '%08d' "$V")"
  L=${#P}
  LEN[$L]=$(( ${LEN[$L]:-0} + 1 ))
  case "$P" in
    *[!0-9]*) NONNUM=$((NONNUM+1)); [ "$BAD" -lt 5 ] && echo "    非法样例: $P" ; BAD=$((BAD+1)) ;;
  esac
  [ "$L" -ne 11 ] && SHORT=$((SHORT+1))
done
echo "  负值次数        = $NEG"
echo "  含非数字字符次数 = $NONNUM"
echo "  长度≠11 次数     = $SHORT"
echo "  长度分布:"
for k in "${!LEN[@]}"; do echo "    长度 $k : ${LEN[$k]} 次"; done

echo
echo "=== 2) 直接暴力枚举 RANDOM*RANDOM 的边界（找是否可能为负）==="
MAX=0
for i in $(seq 1 20000); do
  V=$((RANDOM*RANDOM))
  [ "$V" -gt "$MAX" ] && MAX=$V
done
echo "  20k 次采样里 RANDOM*RANDOM 的最大值 = $MAX"
echo "  （理论最大 32767*32767 = $((32767*32767))）"
if [ "$MAX" -lt 0 ]; then echo "  ⚠️ 出现负值 → 假设成立"; else echo "  未出现负值 → 该假设**不成立**（乘法不会溢出为负）"; fi

echo
echo "=== 3) 那么剩下的可能：取模前的中间量为负？—— bash 的 % 对负数给负值，这里不可能 ==="
echo "  $((-7 % 100000000))   （演示：bash 取模保留符号；但 RANDOM*RANDOM 恒为非负）"

echo
echo "=== 4) 结论 ==="
if [ "$NEG" -eq 0 ] && [ "$NONNUM" -eq 0 ] && [ "$SHORT" -eq 0 ]; then
  echo "  生成器在 $N 次采样中**全部合法**（11 位纯数字）"
  echo "  → 「手机号生成非法导致登录失败」的假设 **不成立**，需另找原因"
else
  echo "  ⚠️ 生成器会产生非法手机号（负值 $NEG / 非数字 $NONNUM / 非 11 位 $SHORT）→ 假设成立"
fi
