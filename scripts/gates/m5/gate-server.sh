#!/usr/bin/env bash
#
# M5 服务器侧 Gate —— 聚合 scripts/m5/ 下的验证脚本，并按 M4 gate 的约定输出 key。
#
# ## 用法（**在服务器上跑**）
#
#   # 1) 本地把 m5 脚本上传到服务器
#   scp scripts/m5/*.sh root@<host>:/tmp/m5/
#   # 2) 服务器上执行
#   bash /tmp/gate-m5.sh
#
# 若脚本不在默认目录，用第一个参数指定：
#   bash /tmp/gate-m5.sh /tmp/m5
#
# ## 为什么需要这个 gate（审核记录 24 的要求）
#
# 审核明确要求：**把「复数 mediaIds → 400」保留在 API regression Gate 中**，
# 防止将来有人把 schema parser 改成 "strip unknown fields" 之后**又退化**回静默忽略
# （那条路径会让客户端拿到 201、消息发出去了图没挂上 —— 典型的 silent data loss）。
#
# ## 分层（沿用 M4 的口径）
#   PERSISTENT  —— 必须长期保持的契约（API 契约、fail-closed 语义、自愈能力）
#   STAGE       —— 本阶段新引入的能力（TTL GC 等）
#   REGRESSION  —— 防退化项（见上）
#
set -u

DIR="${1:-/tmp/m5}"
FAILED=0
declare -A KEY

step() { printf '\n## %s\n' "$1"; }
setk()  { KEY[$1]="$2"; }

echo "# M5 服务器侧 Gate"
echo "# 脚本目录: $DIR"
echo "# 时间: $(date -Is)"

if [ ! -d "$DIR" ]; then
  echo "# 错误：脚本目录不存在：$DIR"
  echo "#   请先：scp scripts/m5/*.sh root@<host>:$DIR/"
  exit 2
fi

# ---------------------------------------------------------------- 1. 媒体消息 API
step "1. 媒体消息 API（单数 mediaId + strict reject）"
MM="$DIR/verify-message-media.sh"
MM_OUT=''
if [ -f "$MM" ]; then
  MM_OUT="$(bash "$MM" 2>&1)"
  printf '%s\n' "$MM_OUT" | grep -E '^(PASS|FAIL|MESSAGE_MEDIA)' | sed 's/^/    /'
  if printf '%s' "$MM_OUT" | grep -q 'MESSAGE_MEDIA_RESULT PASS'; then
    setk M5_MEDIA_MESSAGE_API PASS
  else
    setk M5_MEDIA_MESSAGE_API FAIL; FAILED=1
  fi
else
  setk M5_MEDIA_MESSAGE_API NOT_RUN; FAILED=1
  echo "    （找不到 $MM）"
fi

# 回归键：复数 mediaIds 必须被拒（ASCII 可 grep：'mediaIds' 与 '400'）
# 注意：**不要**用中文字符串做 grep —— 产物里非 ASCII 会被 esbuild 转义成 \uXXXX，
# 会造成"其实通过了却判 FAIL"的假阴性（本轮实测踩到过）。这里匹配的是脚本的 PASS 行，
# 其 'mediaIds' 与 '400' 都是 ASCII，安全。
if printf '%s' "$MM_OUT" | grep -qE '^PASS mediaIds.*400'; then
  setk M5_MEDIAID_STRICT_REJECT PASS
else
  setk M5_MEDIAID_STRICT_REJECT FAIL; FAILED=1
fi

# ---------------------------------------------------------------- 2. TTL GC
step "2. unattached media 的 TTL GC"
CU="$DIR/verify-cleanup-unattached.sh"
CU_OUT=''
if [ -f "$CU" ]; then
  CU_OUT="$(bash "$CU" 2>&1)"
  printf '%s\n' "$CU_OUT" | grep -E '^(PASS|FAIL|CLEANUP_UNATTACHED)' | sed 's/^/    /'
  if printf '%s' "$CU_OUT" | grep -q 'CLEANUP_UNATTACHED_RESULT PASS'; then
    setk M5_UNATTACHED_TTL_GC PASS
  else
    setk M5_UNATTACHED_TTL_GC FAIL; FAILED=1
  fi
else
  setk M5_UNATTACHED_TTL_GC NOT_RUN; FAILED=1
  echo "    （找不到 $CU）"
fi

# ---------------------------------------------------------------- 3. .tmp 自愈
step "3. 上传根目录 .tmp 的启动自愈（persistent invariant）"
TH="$DIR/verify-tmp-selfheal.sh"
TH_OUT=''
if [ -f "$TH" ]; then
  TH_OUT="$(bash "$TH" 2>&1)"
  printf '%s\n' "$TH_OUT" | grep -E '^(SELF_HEAL|ABORT)' | sed 's/^/    /'
  if printf '%s' "$TH_OUT" | grep -q 'SELF_HEAL_PASS'; then
    setk M5_TMP_SELFHEAL PASS
  else
    setk M5_TMP_SELFHEAL FAIL; FAILED=1
  fi
else
  setk M5_TMP_SELFHEAL NOT_RUN; FAILED=1
  echo "    （找不到 $TH）"
fi

# ---------------------------------------------------------------- 4. 留言板
step "4. 留言板 API（strict reject from_user_id + 权限隔离）"
BN="$DIR/verify-board-notes.sh"
BN_OUT=''
if [ -f "$BN" ]; then
  BN_OUT="$(bash "$BN" 2>&1)"
  printf '%s\n' "$BN_OUT" | grep -E '^(PASS|FAIL|BOARD_NOTES)' | sed 's/^/    /'
  if printf '%s' "$BN_OUT" | grep -q 'BOARD_NOTES_RESULT PASS'; then
    setk M5_BOARD_NOTES PASS
  else
    setk M5_BOARD_NOTES FAIL; FAILED=1
  fi
else
  setk M5_BOARD_NOTES NOT_RUN; FAILED=1
  echo "    （找不到 $BN）"
fi

# ---------------------------------------------------------------- 汇总
echo
echo "# ----------------------------------------------------------------"
echo "# M5 分层结果"
P_FAIL=0
for k in M5_MEDIAID_STRICT_REJECT M5_TMP_SELFHEAL; do
  [ "${KEY[$k]}" = "PASS" ] || P_FAIL=1
done
printf '#   %-12s %s\n' "PERSISTENT" "$([ $P_FAIL -eq 0 ] && echo PASS || echo FAIL)"
printf '#   %-12s %s\n' "STAGE" "$([ "${KEY[M5_UNATTACHED_TTL_GC]}" = "PASS" ] && echo PASS || echo FAIL)"
printf '#   %-12s %s\n' "REGRESSION" "$([ "${KEY[M5_MEDIAID_STRICT_REJECT]}" = "PASS" ] && echo PASS || echo FAIL)"
echo '#'
for k in M5_MEDIA_MESSAGE_API M5_MEDIAID_STRICT_REJECT M5_UNATTACHED_TTL_GC M5_TMP_SELFHEAL M5_BOARD_NOTES; do
  printf '#   %-26s %s\n' "$k" "${KEY[$k]}"
done
echo
echo "# M5_SERVER_GATE_RESULT: $([ "$FAILED" -eq 0 ] && echo PASS || echo FAIL)"
# ⚠️ 与 M4 同口径：这个 key **不是**"M5 整体完成"。
#    WO#2 的前端用户路径（App 侧选图→上传→发送）尚未完成，
#    故 M5_OVERALL 在它通过之前保持 OPEN。
echo "# M5_OVERALL: OPEN（WO#2 前端用户路径未完成；后端已 ACCEPTED）"
exit "$([ "$FAILED" -eq 0 ] && echo 0 || echo 1)"
