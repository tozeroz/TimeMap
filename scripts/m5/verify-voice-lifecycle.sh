#!/usr/bin/env bash
# WO#5 Phase 1 关账：**audio/webm 专属**的媒体基础设施生命周期断言（审核记录 37）
#
# ## 为什么需要这个脚本
#
# 审核 37 的裁定是 `WO5_PHASE1_IMPLEMENTATION: ACCEPTED` + `WO5_PHASE1_FINAL_CLOSE: HOLD`，
# 唯一原因是"既有媒体基础设施**没有暗藏只支持图片的假设**"这一点，**尚未用真实 audio fixture 验证**。
# 已有的 M5_UNATTACHED_TTL_GC 用的是图片 fixture，覆盖不到音频分支。
#
# 另外这条也顺带补上 M4 时代自己记下的**弱证据**（见 scripts/m4/verify-backup-barrier.sh 的文件头）：
#   "**不证明**：HTTP API 层在窗口内返回 503 —— 需要真实会话 + multipart 上传；本脚本不覆盖；
#    该路径的正确性目前只由'共享锁接入 + isBarrierTimeout→503'的代码审查支撑，属**弱证据**。"
#   → 本脚本的 C 组用**真实 audio/webm + 真实会话**走 HTTP，把它从弱证据升为端到端证据。
#
# ## 三条断言
#
#   A 未引用的语音 media：TTL 前**不删**；超 TTL 后 **DB 行 + 盘上文件都删**
#   B 被引用的语音 media：`cleanup --apply` 后 **DB 行 + 盘上文件都仍在**
#   C 备份排他屏障生效时：真实 audio/webm `POST /api/media` → **503** 且**零 DB/文件变更**；
#     屏障释放后**同类上传恢复成功**
#
# ## fixture 纪律（沿用本项目的 FIXTURE VALIDITY GATE）
#   fixture 必须**先走成功路径**验证有效，否则后续负向断言会因为"输入早已坏在上游"而假通过。
#   （我此前手工拼过假 WebM，头长度 vint 写错 0x88/0x84，导致断言因错误原因通过。）
#   本脚本用 scripts/m5/fixtures/voice-sample.webm —— **真机 MediaRecorder 产出**，已自查 EBML 魔数 + DocType=webm。
set -u
API='http://127.0.0.1:3001'
UP=/srv/campus/uploads
PHONE='+8613800000002'
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
CLEANUP_DSN="postgres://campus:$PW@127.0.0.1/campus"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  PASS %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
die() { printf '  FATAL %s\n' "$1"; echo; echo "VOICE_LIFECYCLE: FAIL（前置失败）"; exit 2; }

# fixture 查找：按几个候选位置找（gate 从 /tmp/m5 跑，手工跑时在 /tmp）
FIX=''
for cand in /tmp/voice-sample.webm /tmp/m5/voice-sample.webm /tmp/m5/fixtures/voice-sample.webm "$(dirname "$0")/fixtures/voice-sample.webm"; do
  if [ -f "$cand" ]; then FIX="$cand"; break; fi
done
[ -n "$FIX" ] || die "缺少 voice-sample.webm fixture（候选位置都找不到；用 capture-voice-fixture.mjs 采集后 scp 上去）"
echo "  fixture 路径: $FIX"

echo "=== 0) fixture 自查（EBML 魔数 + DocType）==="
MAGIC=$(od -An -tx1 -N4 "$FIX" | tr -d ' \n')
echo "  魔数=$MAGIC（应为 1a45dfa3） 大小=$(stat -c%s "$FIX") 字节"
[ "$MAGIC" = "1a45dfa3" ] || die "fixture 不是 EBML（魔数不符）"
grep -qa 'webm' "$FIX" || die "fixture 里找不到 DocType=webm"
ok "fixture 是合法 WebM（真机产出）"

echo
echo "=== 0.5) 取会话 token（真实登录接口 + dev sink）==="
curl -s -X POST "$API/api/auth/request-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"${PHONE#+86}\"}" >/dev/null
sleep 1
CODE=$(python3 - <<'PY'
import json
try:
    with open('/run/campus/login-codes/latest.json') as f:
        print(json.load(f)['code'])
except Exception:
    print('')
PY
)
[ -n "$CODE" ] || die "取不到验证码"
TOKEN=$(curl -s -X POST "$API/api/auth/verify-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"${PHONE#+86}\",\"code\":\"$CODE\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
[ -n "$TOKEN" ] || die "登录未拿到 token"
AUTH="authorization: Bearer $TOKEN"
ok "token 已取得"

echo
echo "=== 1.5) ★ FIXTURE VALIDITY GATE：音频 fixture 必须能**正常上传成功** ==="
# 若这里失败，后面所有负向断言都会"因上游坏掉而正确失败"，毫无覆盖意义
MEDIA0=$(PSQL "select count(*) from media")
AUD_OK=$(curl -s -X POST "$API/api/media" -H "$AUTH" \
  -F "file=@$FIX;type=audio/webm" -F 'purpose=chat' \
  -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=2500')
AUD_OK_ID=$(printf '%s' "$AUD_OK" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
[ -n "$AUD_OK_ID" ] || die "音频 fixture 无法正常上传（响应：${AUD_OK:0:200}）"
MIME_OK=$(PSQL "select mime from media where id='$AUD_OK_ID'")
[ "$MIME_OK" = "audio/webm" ] || die "服务端判定的 mime 不是 audio/webm（实际 $MIME_OK）"
ok "fixture 走成功路径 OK（id=${AUD_OK_ID:0:8}…, 服务端判定 mime=$MIME_OK）"
# 这条只是"证明 fixture 有效"，用完即删
AUD_OK_KEY=$(PSQL "select scope || '/' || storage_key from media where id='$AUD_OK_ID'")
PSQL "delete from media where id='$AUD_OK_ID'" >/dev/null
[ -f "$UP/$AUD_OK_KEY" ] && /bin/rm -f "$UP/$AUD_OK_KEY"
ok "validity 探针的 media 已清理（media 回到 $MEDIA0）"
[ "$(PSQL 'select count(*) from media')" = "$MEDIA0" ] || die "validity 探针清理不干净"

# ===========================================================================
echo
echo "=== A. 未引用的语音 media：TTL 前不删；超 TTL 后行+文件都删 ==="
# ===========================================================================
# 直接按"服务端会写的那种形态"造两行 audio/webm：一行 created_at 老（超 TTL），一行刚建（在途）
OLD_KEY="2026/09/lc-a-old-$(date +%s).webm"
NEW_KEY="2026/09/lc-a-new-$(date +%s).webm"
mkdir -p "$UP/private/2026/09"
cp "$FIX" "$UP/private/$OLD_KEY"
cp "$FIX" "$UP/private/$NEW_KEY"
OLD_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
NEW_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
OWNER=$(PSQL "select id from users where phone_e164='+8613800000002'")
PSQL "insert into media (id, owner_user_id, scope, storage_key, mime, bytes, sha256, upload_request_id, duration_ms, created_at)
      values ('$OLD_ID','$OWNER','private','$OLD_KEY','audio/webm',$(stat -c%s "$FIX"),repeat('a',64),'$OLD_ID',2500, now() - interval '72 hours')" >/dev/null
PSQL "insert into media (id, owner_user_id, scope, storage_key, mime, bytes, sha256, upload_request_id, duration_ms, created_at)
      values ('$NEW_ID','$OWNER','private','$NEW_KEY','audio/webm',$(stat -c%s "$FIX"),repeat('b',64),'$NEW_ID',2500, now())" >/dev/null
echo "  已造：老=$OLD_ID（72h 前）/ 新=$NEW_ID（刚建，均无引用）"

# dry-run 必须先看到"老的入选、新的不入选"（TTL 保护在途）
DRY=$(cd /srv/campus/server && UPLOAD_ROOT=$UP DATABASE_URL="$CLEANUP_DSN" node dist/cleanup.mjs --json 2>&1)
OLD_IN=$(printf '%s' "$DRY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids=[x.get('id') for x in d.get('unattached',[])]
print('yes' if '$OLD_ID' in ids else 'no')
" 2>/dev/null)
NEW_IN=$(printf '%s' "$DRY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids=[x.get('id') for x in d.get('unattached',[])]
print('yes' if '$NEW_ID' in ids else 'no')
" 2>/dev/null)
[ "$OLD_IN" = "yes" ] && ok "A1 超 TTL 的未引用语音**是**候选" || bad "A1 超 TTL 的未引用语音不在候选里（dry-run 输出：$(printf '%s' "$DRY" | head -c 200)）"
[ "$NEW_IN" = "no" ]  && ok "A2 在途的未引用语音**不是**候选（TTL 保护生效）" || bad "A2 在途语音竟被选为候选"

# apply：老的应被删（行+文件），新的应保留
(cd /srv/campus/server && UPLOAD_ROOT=$UP DATABASE_URL="$CLEANUP_DSN" node dist/cleanup.mjs --apply >/dev/null 2>&1)
OLD_ROW=$(PSQL "select count(*) from media where id='$OLD_ID'")
NEW_ROW=$(PSQL "select count(*) from media where id='$NEW_ID'")
[ "$OLD_ROW" = "0" ] && ok "A3 超 TTL 的**行已删**" || bad "A3 超 TTL 的行仍在（count=$OLD_ROW）"
if [ -f "$UP/private/$OLD_KEY" ]; then bad "A4 超 TTL 的**文件仍在**"; else ok "A4 超 TTL 的**文件已删**"; fi
[ "$NEW_ROW" = "1" ] && ok "A5 在途的**行保留**" || bad "A5 在途的行被误删"
if [ -f "$UP/private/$NEW_KEY" ]; then ok "A6 在途的**文件保留**"; else bad "A6 在途的文件被误删"; fi

# 清理 A 组残留
PSQL "delete from media where id='$NEW_ID'" >/dev/null
[ -f "$UP/private/$NEW_KEY" ] && /bin/rm -f "$UP/private/$NEW_KEY"

# ===========================================================================
echo
echo "=== B. 被引用的语音 media：cleanup --apply 后行+文件都仍在 ==="
# ===========================================================================
THREAD='66666666-cccc-4ccc-8ccc-000000000003'
B_KEY="2026/09/lc-b-ref-$(date +%s).webm"
cp "$FIX" "$UP/private/$B_KEY"
B_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
PSQL "insert into media (id, owner_user_id, scope, storage_key, mime, bytes, sha256, upload_request_id, duration_ms, created_at)
      values ('$B_ID','$OWNER','private','$B_KEY','audio/webm',$(stat -c%s "$FIX"),repeat('c',64),'$B_ID',2500, now() - interval '72 hours')" >/dev/null
MSG_ID=$(python3 -c 'import uuid;print(uuid.uuid4())')
PSQL "insert into messages (id, thread_id, sender_id, body, kind) values ('$MSG_ID','$THREAD','$OWNER','[语音]','voice')" >/dev/null
PSQL "insert into message_media (message_id, media_id, media_scope, position) values ('$MSG_ID','$B_ID','private',0)" >/dev/null
echo "  已造：一条 voice 消息 $MSG_ID 引用 media $B_ID（该 media created_at 为 72h 前）"
echo "  ⚠ 刻意把 created_at 设成过期：用来证明'**被引用**优先于 TTL'，而不是靠新建时间侥幸躲过"

(cd /srv/campus/server && UPLOAD_ROOT=$UP DATABASE_URL="$CLEANUP_DSN" node dist/cleanup.mjs --apply >/dev/null 2>&1)
[ "$(PSQL "select count(*) from media where id='$B_ID'")" = "1" ] && ok "B1 被引用的行**保留**（引用优先于 TTL）" || bad "B1 被引用的行被删了"
if [ -f "$UP/private/$B_KEY" ]; then ok "B2 被引用的**文件保留**"; else bad "B2 被引用的文件被删了"; fi
[ "$(PSQL "select count(*) from message_media where media_id='$B_ID'")" = "1" ] && ok "B3 引用关系完好" || bad "B3 引用关系被破坏"

# 端到端再确认一次：该语音消息在 API 里仍可读出（时长仍在）
B_READ=$(curl -s "$API/api/threads/$THREAD/messages" -H "$AUTH")
printf '%s' "$B_READ" | grep -q "$B_ID" && ok "B4 读模型仍能取到该语音媒体" || bad "B4 读模型取不到该媒体"
printf '%s' "$B_READ" | grep -q '"durationMs"' && ok "B5 读模型仍返回 durationMs" || bad "B5 读模型缺 durationMs"

# 清理 B 组
PSQL "delete from message_media where message_id='$MSG_ID'" >/dev/null
PSQL "delete from messages where id='$MSG_ID'" >/dev/null
PSQL "delete from media where id='$B_ID'" >/dev/null
[ -f "$UP/private/$B_KEY" ] && /bin/rm -f "$UP/private/$B_KEY"
echo "  B 组残留已清理"

# ===========================================================================
echo
echo "=== C. 备份排他屏障生效时：真实 audio/webm 上传 → 503 + 零变更；释放后恢复 ==="
# ===========================================================================
KEY=1295270465
MEDIA_BEFORE=$(PSQL "select count(*) from media")
FILES_BEFORE=$(find "$UP" -type f -name '*.webm' | wc -l)
echo "  基线：media=$MEDIA_BEFORE  webm 文件=$FILES_BEFORE"

# 持排他锁 8 秒（与备份侧同一把锁、同一调用形态）
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At \
  -c "select pg_advisory_lock($KEY)" -c "select pg_sleep(8)" -c "select pg_advisory_unlock($KEY)" \
  >/tmp/lc-barrier-holder.log 2>&1 &
HOLDER=$!
sleep 1.5   # 等它确实拿到锁

T0=$(date +%s%N)
R=$(curl -s -m 20 -w '\n%{http_code}' -X POST "$API/api/media" -H "$AUTH" \
  -F "file=@$FIX;type=audio/webm" -F 'purpose=chat' \
  -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=2500')
T1=$(date +%s%N)
CODE_C=$(printf '%s' "$R" | tail -1)
BODY_C=$(printf '%s' "$R" | head -1)
ELAPSED_MS=$(( (T1 - T0) / 1000000 ))
echo "  窗口内上传：HTTP $CODE_C（耗时 ${ELAPSED_MS}ms）"
echo "  响应体：$(printf '%s' "$BODY_C" | python3 -c 'import sys; print(sys.stdin.read()[:110])')"
MEDIA_DURING=$(PSQL "select count(*) from media")
FILES_DURING=$(find "$UP" -type f -name '*.webm' | wc -l)

[ "$CODE_C" = "503" ] && ok "C1 屏障窗口内真实上传返回 **503**（不是 500/201）" || bad "C1 期望 503，实际 $CODE_C"
printf '%s' "$BODY_C" | grep -q 'backup' && ok "C2 响应体指明是备份屏障（$(printf '%s' "$BODY_C" | python3 -c 'import sys; print(sys.stdin.read()[:60])')）" || bad "C2 响应体未指明备份屏障：$(printf '%s' "$BODY_C" | head -c 90)"
[ "$MEDIA_DURING" = "$MEDIA_BEFORE" ] && ok "C3 窗口内 **DB 零变更**（media 仍 $MEDIA_BEFORE）" || bad "C3 DB 有变更：$MEDIA_BEFORE → $MEDIA_DURING"
[ "$FILES_DURING" = "$FILES_BEFORE" ] && ok "C4 窗口内 **盘上零变更**（webm 文件仍 $FILES_BEFORE）" || bad "C4 盘上有变更：$FILES_BEFORE → $FILES_DURING"

wait $HOLDER 2>/dev/null || true
sleep 0.5
echo "  屏障已释放"

# 释放后：同类上传必须成功（证明屏障不会把功能永久锁死）
R2=$(curl -s -m 20 -w '\n%{http_code}' -X POST "$API/api/media" -H "$AUTH" \
  -F "file=@$FIX;type=audio/webm" -F 'purpose=chat' \
  -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=2500')
CODE_D=$(printf '%s' "$R2" | tail -1)
BODY_D=$(printf '%s' "$R2" | head -1)
C_ID=$(printf '%s' "$BODY_D" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
[ "$CODE_D" = "201" ] && ok "C5 屏障释放后同类上传**恢复成功**（201）" || bad "C5 释放后期望 201，实际 $CODE_D（$(printf '%s' "$BODY_D" | python3 -c 'import sys; print(sys.stdin.read()[:90])')）"

# 清理 C 组
if [ -n "$C_ID" ]; then
  C_KEY=$(PSQL "select scope || '/' || storage_key from media where id='$C_ID'")
  PSQL "delete from media where id='$C_ID'" >/dev/null
  [ -n "$C_KEY" ] && [ -f "$UP/$C_KEY" ] && /bin/rm -f "$UP/$C_KEY"
fi
echo "  C 组残留已清理"

# ===========================================================================
echo
echo "=== 收尾：回到纯种子基线 ==="
echo "  users(应3): $(PSQL 'select count(*) from users')"
echo "  messages(应2): $(PSQL 'select count(*) from messages')"
echo "  media(应2): $(PSQL 'select count(*) from media')"
echo "  board_notes(应1): $(PSQL 'select count(*) from board_notes')"
echo "  message_media(应0): $(PSQL 'select count(*) from message_media')"
echo -n "  盘库一致: "
(cd /srv/campus/server && UPLOAD_ROOT=$UP DATABASE_URL="$CLEANUP_DSN" node dist/cleanup.mjs --json 2>&1 | head -c 260)
echo
echo
echo "VOICE_LIFECYCLE_RESULT: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "VOICE_LIFECYCLE: PASS" || echo "VOICE_LIFECYCLE: FAIL"
