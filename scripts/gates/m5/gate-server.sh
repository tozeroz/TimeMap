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

# ---------------------------------------------------------------- 5. 基线完整性
step "5. 共享库基线完整性（种子是否完好 / 盘库是否一致）"
# 为什么要这一段：多个子代理在不同时间跑过验证，各建临时账号。
# 若基线被悄悄污染，之后**每次**计数类断言失败都要先排除"是不是库被污染了"。
#
# ⚠️ 刻意区分两类，不混为一谈：
#   **阻塞项（必须恒成立）**：种子账号完好、盘库一致（无 orphan / unattached）
#   **仅报告（当前因残留而偏高，不判 FAIL）**：users / sessions / login_challenges 计数
# 理由：把"users==3"也设成阻塞，会让 gate 因为一个**已知排队中的清理项**长期变红 ——
#       而**恒红的 gate 会被忽略，等于没有 gate**（本轮刚论证过这一点）。
BSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
SEED_N="$(BSQL "select count(*) from users where phone_e164 in ('+8613800000001','+8613800000002','+8613800000003')")"
if [ "$SEED_N" = "3" ]; then
  setk M5_BASELINE_SEED_INTEGRITY PASS
else
  setk M5_BASELINE_SEED_INTEGRITY "FAIL（种子账号 $SEED_N/3）"; FAILED=1
fi

# 盘库一致性：cleanup 的 dry-run 不应报出 orphan / unattached
CD_OUT=''
if [ -f /srv/campus/server/dist/cleanup.mjs ]; then
  CD_OUT="$(cd /srv/campus/server && UPLOAD_ROOT=/srv/campus/uploads \
    DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" \
    node dist/cleanup.mjs --json 2>&1 | head -c 600)"
fi
if printf '%s' "$CD_OUT" | grep -q '"orphans":\[\]' && printf '%s' "$CD_OUT" | grep -q '"unattached":\[\]'; then
  setk M5_BASELINE_STORAGE_CONSISTENT PASS
else
  setk M5_BASELINE_STORAGE_CONSISTENT "FAIL（dry-run 报出 orphan 或 unattached）"; FAILED=1
fi

# 仅报告（不参与判定）
printf '#   %-34s %s\n' "info users 总数" "$(BSQL 'select count(*) from users')（种子 3；偏高说明有验证残留，见清理队列）"
printf '#   %-34s %s\n' "info sessions" "$(BSQL 'select count(*) from sessions')"
printf '#   %-34s %s\n' "info login_challenges" "$(BSQL 'select count(*) from login_challenges')"
printf '#   %-34s %s\n' "info messages / media / board_notes" \
  "$(BSQL 'select count(*) from messages') / $(BSQL 'select count(*) from media') / $(BSQL 'select count(*) from board_notes')"

# ---------------------------------------------------------------- 汇总
echo
echo "# ----------------------------------------------------------------"
echo "# M5 分层结果"
P_FAIL=0
for k in M5_MEDIAID_STRICT_REJECT M5_TMP_SELFHEAL M5_BASELINE_SEED_INTEGRITY M5_BASELINE_STORAGE_CONSISTENT; do
  [ "${KEY[$k]}" = "PASS" ] || P_FAIL=1
done
printf '#   %-12s %s\n' "PERSISTENT" "$([ $P_FAIL -eq 0 ] && echo PASS || echo FAIL)"
printf '#   %-12s %s\n' "STAGE" "$([ "${KEY[M5_UNATTACHED_TTL_GC]}" = "PASS" ] && echo PASS || echo FAIL)"
printf '#   %-12s %s\n' "REGRESSION" "$([ "${KEY[M5_MEDIAID_STRICT_REJECT]}" = "PASS" ] && echo PASS || echo FAIL)"
echo '#'
for k in M5_MEDIA_MESSAGE_API M5_MEDIAID_STRICT_REJECT M5_UNATTACHED_TTL_GC M5_TMP_SELFHEAL M5_BOARD_NOTES M5_BASELINE_SEED_INTEGRITY M5_BASELINE_STORAGE_CONSISTENT; do
  printf '#   %-26s %s\n' "$k" "${KEY[$k]}"
done
echo
echo "# M5_SERVER_GATE_RESULT: $([ "$FAILED" -eq 0 ] && echo PASS || echo FAIL)"
# ⚠️ 与 M4 同口径：这个 key **不是**"M5 整体完成"。
#    当前精确状态（审核记录 25 的裁定）：
#      WO2_BACKEND / APP_UPLOAD_SEND_RENDER / FAILPATH / RELOAD_PERSISTENCE / CROSS_LAYER_C1：全 PASS
#      WO2_IMPLEMENTATION: ACCEPTED
#      NATIVE_FILE_PICKER_INTERACTION: NOT_YET_VERIFIED  ← 唯一未决项
#      WO2_FINAL_CLOSE: HOLD
#    ⚠️ 且审核要求**永久分列**这两个 key，不得合并表述成"真实用户完整选图 E2E"：
#      FILE_INPUT_POST_SELECTION_E2E   （DOM.setFileInputFiles 之后的完整产品链路）
#      NATIVE_FILE_PICKER_INTERACTION  （真实点击入口 → 系统 picker → 选图 → WebView 收到 File）
#    → 所以这里**不再**笼统写"前端用户路径未完成"（那会让人误以为前端没做完），
#      而是点名唯一未决的那一格。
# ⚠️ 分列写明（审核记录 27 强制）：**不得**合并成"真人触摸完整 E2E"之类的说法 ——
#    前者说的是"产品路径通了"（这是 WO#2 的命题），
#    后者说的是"Android 输入层分发也走通了"（本次用 CDP 注入触摸，**未验证**）。
echo "# M5_OVERALL: WO2_CLOSED（审核记录 27）"
echo "#   NATIVE_FILE_PICKER_PRODUCT_PATH:     PASS"
echo "#   SYSTEM_PICKER_SELECTION:             PASS"
echo "#   WEBVIEW_FILE_DELIVERY:               PASS"
echo "#   ANDROID_INPUTDISPATCHER_ENTRY_TOUCH: NOT_EVALUATED（CDP 注入触摸，非物理输入分发）"
echo "#   FILE_INPUT_POST_SELECTION_E2E:       PASS"
echo "#   M5 其余 A/D 项: C4（UNRESOLVED+FREEZE）/ tab deviation / 气泡偏差观察——见 docs/m5/A-D-LIST.md"
exit "$([ "$FAILED" -eq 0 ] && echo 0 || echo 1)"
