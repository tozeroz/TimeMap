#!/usr/bin/env bash
# ⚠️ 状态：**WIP / 未通过**（2026-09-21 14:45）
#
# 已实现：联合备份（DB dump + uploads 归档 + manifest）、数据库恢复、媒体恢复、
#         DB→文件逐行核对（含 sha256）、反向 orphan 核对、以及"核对不到 2 条就判失败"
#         这条防空洞断言；A0 还会通过**真实上传接口**造两条 fixture，
#         避免"没有可核对对象时空洞 PASS"（与清理脚本同一条原则）。
#
# 未解决：把脚本用 `base64 -d | bash` 执行时会在 fixture/核对段报 bash 语法错误
#         （报错行号与本文件对不上，怀疑是该投递方式下的解析问题，而不是脚本逻辑问题）。
#         下一步改用 `base64 -d > /tmp/x.sh && bash /tmp/x.sh` 的落盘再执行方式复现，
#         或用 `bash -n` 在本机（WSL 可用时）先静态校验。
#         在跑通之前**不接入 Gate**，也不声称 M4_BACKUP_RESTORE 已交付。
# M4：DB + 媒体存储的**联合备份与联合恢复**演练
#
# 依据：审核记录 13 第 7 条 + 记录 15：
#   "从 M4 开始，pg_dump restore PASS 只能继续代表数据库恢复，
#    不能再单独代表完整业务数据恢复。"
# 因此本脚本输出**四个独立 key**：
#   DATABASE_RESTORE / MEDIA_STORE_RESTORE / CROSS_REFERENCE_INTEGRITY / M4_BACKUP_RESTORE
#
# 与 M2 的 DB-only 演练**分开记录**，不相互替代（M2 的 BACKUP_DRILL_RESULT 继续有效，
# 但它不覆盖媒体）。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
PSQLD() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d "$1" -Atc "$2" 2>&1; }

UPLOADS=/srv/campus/uploads
BACKUPS=/srv/campus/backups
RESTORE_DB=campus_m4restore
TS="$(date +%Y%m%d-%H%M%S)"
GEN="$BACKUPS/gen-$TS"
RESTORE_DIR="$(mktemp -d)"

echo "=== A. 联合备份（同一个 backup generation）==="
install -d -m 0700 "$GEN"

# ---------------------------------------------------------------------------
# A0. 先造**两条真实媒体**（一条 public、一条 private）作为演练对象。
#
# 为什么必须先造 fixture：如果库里 media 行是 0、盘上也没文件，
# 下面的"逐行核对"会**空洞地通过** —— 那就是假阳性（看着绿、其实什么都没验）。
# 与清理脚本同一条原则：**没有可核对的对象时，脚本必须拒绝给出 PASS**。
# ---------------------------------------------------------------------------
echo "=== A0. 造演练 fixture（走真实上传接口）==="
FIXTURE_IDS=""
if command -v python3 >/dev/null 2>&1; then
  W="$(mktemp -d)"
  python3 - "$W/f.png" <<'PY'
import struct, sys, zlib
w, h = 24, 16
sig = b'\x89PNG\r\n\x1a\n'
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
raw = b''.join(b'\x00' + b'\x11\x22\x33\xff' * w for _ in range(h))
open(sys.argv[1], 'wb').write(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
PY
  # 用一个临时账号上传（真实接口，与生产同一条路径）
  rm -f /run/campus/login-codes/*.json 2>/dev/null || true
  FP="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
  FREQ="$(curl -s -X POST http://127.0.0.1/api/auth/request-code -H 'Content-Type: application/json' -d "{\"phone\":\"$FP\"}")"
  FSF="$(printf '%s' "$FREQ" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
  FCODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$FSF" 2>/dev/null)"
  FTOK="$(curl -s -X POST http://127.0.0.1/api/auth/verify-code -H 'Content-Type: application/json' -d "{\"phone\":\"$FP\",\"code\":\"$FCODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  FID="$(PSQL "select id from users where phone_e164='+86$FP'")"
  for purpose in post chat; do
    R="$(curl -s -H "Authorization: Bearer $FTOK" -X POST http://127.0.0.1/api/media \
      -F "file=@$W/f.png" -F "purpose=$purpose" -F "uploadRequestId=$(cat /proc/sys/kernel/random/uuid)")"
    MID="$(printf '%s' "$R" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
    [ -n "$MID" ] && FIXTURE_IDS="$FIXTURE_IDS $MID"
  done
  rm -rf "$W"
  echo "  fixture 账号=$FP，上传的 media:${FIXTURE_IDS:-（无）}"
  [ -n "$FIXTURE_IDS" ] && ok "已通过真实接口造出演练 fixture" || bad "fixture 上传失败（演练将失去意义）"
else
  bad "缺少 python3，无法造 fixture"
fi

# 1) 数据库
# **必须给 PGPASSWORD**：否则 pg_dump 会等待交互式密码输入 → 脚本永久挂住
# （本轮真实踩到的坑：跑了 10 分钟超时。所有 psql/pg_dump/pg_restore 都要带凭据。）
PGPASSWORD="$(cat /srv/campus/.db_password)" pg_dump -Fc -h 127.0.0.1 -U campus -d campus -f "$GEN/database.dump" 2>/dev/null
[ -s "$GEN/database.dump" ] && ok "database.dump 生成（$(stat -c %s "$GEN/database.dump") 字节）" || bad "database.dump 失败"

# 2) 媒体（只打包 public/ 与 private/，不含 .tmp 与临时文件）
tar --zstd -cf "$GEN/uploads.tar.zst" -C "$UPLOADS" public private 2>/dev/null
[ -s "$GEN/uploads.tar.zst" ] && ok "uploads.tar.zst 生成（$(stat -c %s "$GEN/uploads.tar.zst") 字节）" || bad "uploads.tar.zst 失败"

# 3) manifest：把"这次备份里到底有什么"固定下来
DB_MEDIA_ROWS="$(PSQL 'select count(*) from media')"
DB_USERS="$(PSQL 'select count(*) from users')"
DB_POSTS="$(PSQL 'select count(*) from posts')"
FS_PUBLIC="$(find "$UPLOADS/public" -type f 2>/dev/null | wc -l)"
FS_PRIVATE="$(find "$UPLOADS/private" -type f 2>/dev/null | wc -l)"
cat > "$GEN/manifest.json" <<JSON
{
  "generation": "$TS",
  "created_at": "$(date -Iseconds)",
  "database": {
    "dump": "database.dump",
    "sha256": "$(sha256sum "$GEN/database.dump" | cut -d' ' -f1)",
    "users": $DB_USERS,
    "posts": $DB_POSTS,
    "media_rows": $DB_MEDIA_ROWS
  },
  "media_store": {
    "archive": "uploads.tar.zst",
    "sha256": "$(sha256sum "$GEN/uploads.tar.zst" | cut -d' ' -f1)",
    "public_files": $FS_PUBLIC,
    "private_files": $FS_PRIVATE
  },
  "note": "DB 与 media store 属于同一个 generation；恢复时必须一起用，否则会产生悬空引用"
}
JSON
[ -s "$GEN/manifest.json" ] && ok "manifest.json 生成（记录两侧计数与 sha256）" || bad "manifest.json 失败"
echo "  media 行数=$DB_MEDIA_ROWS  盘上文件=$((FS_PUBLIC + FS_PRIVATE))"

echo
echo "=== B. DATABASE_RESTORE：从 dump 恢复到全新库 ==="
PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d postgres -q -c "drop database if exists $RESTORE_DB" >/dev/null 2>&1
PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d postgres -q -c "create database $RESTORE_DB" >/dev/null 2>&1
PGPASSWORD="$(cat /srv/campus/.db_password)" pg_restore -h 127.0.0.1 -U campus -d "$RESTORE_DB" --no-owner --no-privileges "$GEN/database.dump" >/dev/null 2>&1
R_USERS="$(PSQLD "$RESTORE_DB" 'select count(*) from users')"
R_MEDIA="$(PSQLD "$RESTORE_DB" 'select count(*) from media')"
if [ "$R_USERS" = "$DB_USERS" ] && [ "$R_MEDIA" = "$DB_MEDIA_ROWS" ]; then
  ok "users $R_USERS==$DB_USERS 且 media $R_MEDIA==$DB_MEDIA_ROWS（逐项计数一致）"
  echo "DATABASE_RESTORE: PASS"
else
  bad "恢复后计数不一致（users $R_USERS/$DB_USERS, media $R_MEDIA/$DB_MEDIA_ROWS）"
  echo "DATABASE_RESTORE: FAIL"
fi
# 关键函数也要随 schema 恢复（否则可见性判定会缺失）
FN="$(PSQLD "$RESTORE_DB" "select count(*) from pg_proc where proname in ('can_read_message','can_read_media')")"
[ "$FN" = "2" ] && ok "可见性判定函数已随 schema 恢复" || bad "恢复后缺少判定函数（$FN）"

echo
echo "=== C. MEDIA_STORE_RESTORE：媒体归档恢复到新目录 ==="
tar --zstd -xf "$GEN/uploads.tar.zst" -C "$RESTORE_DIR" 2>/dev/null
R_FILES="$(find "$RESTORE_DIR" -type f 2>/dev/null | wc -l)"
if [ "$R_FILES" = "$((FS_PUBLIC + FS_PRIVATE))" ]; then
  ok "恢复文件数 $R_FILES == 备份时 $((FS_PUBLIC + FS_PRIVATE))"
  echo "MEDIA_STORE_RESTORE: PASS"
else
  bad "恢复文件数不符：$R_FILES vs $((FS_PUBLIC + FS_PRIVATE))"
  echo "MEDIA_STORE_RESTORE: FAIL"
fi

echo
echo "=== D. CROSS_REFERENCE_INTEGRITY：恢复后的 DB 行 → 恢复后的文件，**逐行**核对 ==="
# 这是本脚本最重要的断言：不是抽样，而是"每一条 media 行都必须能在恢复的媒体存储里找到文件"
MISSING=0; CHECKED=0; SHA_MISMATCH=0
# 用 concat_ws 取字段、结果先落临时文件再逐行读：
# 避免 SQL 的 || 与 shell 在嵌套引用里产生解析歧义（本轮真实踩到的语法错误）。
MEDIA_LIST="$(mktemp)"
PSQLD "$RESTORE_DB" "select concat_ws('~', id, scope, storage_key, sha256) from media order by id" > "$MEDIA_LIST" 2>&1
while IFS= read -r line; do
  [ -n "$line" ] || continue
  mid="$(printf '%s' "$line" | cut -d'~' -f1)"
  scope="$(printf '%s' "$line" | cut -d'~' -f2)"
  key="$(printf '%s' "$line" | cut -d'~' -f3)"
  dbsha="$(printf '%s' "$line" | cut -d'~' -f4)"
  # 跳过 psql 报错行（不是 uuid 形状的）
  case "$mid" in *-*-*-*-*) ;; *) continue ;; esac
  CHECKED=$((CHECKED + 1))
  F="$RESTORE_DIR/$scope/$key"
  if [ ! -f "$F" ]; then
    MISSING=$((MISSING + 1))
    [ "$MISSING" -le 3 ] && echo "    缺文件: media=$mid → $scope/$key"
  else
    got="$(sha256sum "$F" | cut -d' ' -f1)"
    [ "$got" = "$dbsha" ] || SHA_MISMATCH=$((SHA_MISMATCH + 1))
  fi
done < "$MEDIA_LIST"
rm -f "$MEDIA_LIST"

if [ "$CHECKED" -lt 2 ]; then
  bad "**只核对到 $CHECKED 条 media 行，演练失去意义**（等于没验；不允许空洞通过）"
fi
if [ "$MISSING" = "0" ]; then
  ok "**逐行核对通过**：$CHECKED 条 media 行全部在恢复的媒体存储里找到文件"
else
  bad "$CHECKED 条里有 $MISSING 条**找不到文件**（悬空引用）"
fi
if [ "$SHA_MISMATCH" = "0" ]; then
  ok "文件 sha256 与 DB 记录**逐条一致**（内容也一致，不只是文件存在）"
else
  bad "$SHA_MISMATCH 条文件内容与 DB 记录不符"
fi
# 反向：恢复的媒体存储里有没有 DB 里查不到的文件（orphan）
ORPHAN=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rel="${f#$RESTORE_DIR/}"
  scope="${rel%%/*}"; key="${rel#*/}"
  n="$(PSQLD "$RESTORE_DB" "select count(*) from media where scope='$scope' and storage_key='$key'")"
  [ "$n" = "1" ] || ORPHAN=$((ORPHAN + 1))
done < <(find "$RESTORE_DIR" -type f 2>/dev/null)
if [ "$ORPHAN" = "0" ]; then
  ok "反向核对：媒体存储里没有 DB 查不到的文件（无 orphan）"
else
  echo "  ⚠ 反向核对发现 $ORPHAN 个 orphan 文件（当前库里可能存在未登记文件；由清扫脚本负责，不影响本次联合恢复判定）"
fi

if [ "$FAILED" -eq 0 ]; then
  echo "CROSS_REFERENCE_INTEGRITY: PASS"
else
  echo "CROSS_REFERENCE_INTEGRITY: FAIL"
fi

echo
echo "=== E. 清理 ==="
# 清掉 A0 造的 fixture（连落盘文件一起；否则会留下 orphan）
for mid in $FIXTURE_IDS; do
  [ -n "$mid" ] || continue
  REL="$(PSQL "select scope || '/' || storage_key from media where id='$mid'")"
  [ -n "$REL" ] && [ "$REL" != "|" ] && rm -f "$UPLOADS/$REL"
  PSQL "delete from media where id='$mid'" >/dev/null
done
if [ -n "$FIXTURE_IDS" ]; then
  PSQL "delete from sessions where user_id='$FID'" >/dev/null
  PSQL "delete from login_challenges where phone_e164='+86$FP'" >/dev/null
  PSQL "delete from users where id='$FID'" >/dev/null
  LEFT_FIX="$(PSQL "select count(*) from media where owner_user_id='$FID'")"
  [ "$LEFT_FIX" = "0" ] && ok "fixture 已清理（含落盘文件）" || bad "fixture 仍有 $LEFT_FIX 条残留"
fi
PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d postgres -q -c "drop database if exists $RESTORE_DB" >/dev/null 2>&1
rm -rf "$RESTORE_DIR"
[ -d "$GEN" ] && ok "备份 generation 保留在 $GEN（便于复查；不进 git）" || bad "备份目录消失了"

echo
echo "备份 generation: $GEN"
if [ "$FAILED" -eq 0 ]; then echo "M4_BACKUP_RESTORE: PASS"; else echo "M4_BACKUP_RESTORE: FAIL"; fi
exit "$FAILED"
