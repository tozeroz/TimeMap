#!/usr/bin/env bash
# M5 工作单 #2 —— unattached media 的 TTL GC（审核记录 21 修订 2）
#
# 依据：docs/m5/WORKORDER-2.md（修订 2：上传成功但消息发送失败留下的 media 必须有 TTL GC）
#       server/src/cleanup-entry.ts（实现；TTL 默认 24h，取值依据写在该文件头部注释）
#
# 本脚本覆盖的断言（对应 cleanup-entry.ts 的 A 类 orphan 与 B 类 unattached 两类泄漏）：
#   C1 刚上传、尚未挂到消息的 private media → **dry-run 不处理**（在途图片不会被误删）
#   C2 阈值很大（8760h）时，连过期候选也不动（阈值保护生效）
#   C3 **dry-run 什么都不删**（行在、文件在）
#   C4 unattached 与 orphan 分开计数/分开报告（JSON 里是两个字段，文本里是两行）
#   C5 --apply 只删 unattached：过期未被引用的行与文件一起消失
#   C6 **被消息引用的 media 无论多老都不删**（引用优先于 TTL）
#   C7 重复 --apply 幂等：第二次什么都不删
#   C8 有行、无引用、但盘上无文件 → 不动、不崩，且如实报出条数（unattachedMissingFile）
#      以及：缺 DATABASE_URL → 退出码 2（既有 fail-closed 纪律）
#
# 前提：脚本在**服务器**上执行（与 scripts/m4/verify-cleanup-failclosed.sh 同环境）：
#   - /srv/campus/server/dist/cleanup.mjs 是含本改动的产物（`pnpm build` 之后传上去）
#   - 有 psql，/srv/campus/.db_password 可读（root），UPLOAD_ROOT=/srv/campus/uploads
#   - 备注：备份窗口内的 fail-closed（退出码 3、一个都不删）由既有脚本
#     scripts/m4/verify-cleanup-failclosed.sh 覆盖，本脚本不重复测那一条
# 用法：bash scripts/m5/verify-cleanup-unattached.sh
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
UP=/srv/campus/uploads
CLEANUP=/srv/campus/server/dist/cleanup.mjs
UUID() { cat /proc/sys/kernel/random/uuid; }

# 归一化 UUID（去掉连字符 → 拼成 36 位 [0-9a-f-] 形态，满足 media id 的格式约束）
U32() { cat /proc/sys/kernel/random/uuid | tr -d '-'; }
MID_OLD="$(U32)"; MID_NEW="$(U32)"; MID_REF="$(U32)"; MID_GHOST="$(U32)"
KEY_OLD="2026/09/wo2-unattached-old-${MID_OLD}.png"
KEY_NEW="2026/09/wo2-unattached-new-${MID_NEW}.png"
KEY_REF="2026/09/wo2-unattached-ref-${MID_REF}.png"
KEY_GHOST="2026/09/wo2-unattached-ghost-${MID_GHOST}.png"
THREAD="$(cat /proc/sys/kernel/random/uuid)"
MSG="$(cat /proc/sys/kernel/random/uuid)"

U_OLD='11111111-1111-4111-8111-111111111111'
U2='22222222-2222-4222-8222-222222222222'
PIXEL='WO2PIXEL01'   # 10 字节
SHA_PLACEHOLDER="$(printf 'a7%.0s' {1..32})"

echo "=== 0. 造测试数据（绕过 HTTP，直接建 4 类 media 行）==="
[ -x "$CLEANUP" ] || [ -f "$CLEANUP" ] || { bad "找不到 $CLEANUP（先 pnpm build 并部署产物）"; echo "CLEANUP_UNATTACHED_RESULT FAIL"; exit 1; }
install -d -o campus -g campus -m 0750 "$UP/private/2026/09"
for K in "$KEY_OLD" "$KEY_NEW" "$KEY_REF" "$KEY_GHOST"; do
  printf '%s' "$PIXEL" > "$UP/private/$K"
  chown campus:campus "$UP/private/$K"; chmod 0640 "$UP/private/$K"
done
# 旧（3 天前上传，无引用）—— 应该被回收
PSQL "insert into media (id,owner_user_id,scope,storage_key,mime,bytes,width,height,sha256,upload_request_id,created_at)
      values ('$MID_OLD','$U_OLD','private','$KEY_OLD','image/png',10,24,16,'$SHA_PLACEHOLDER','$(cat /proc/sys/kernel/random/uuid)', now() - interval '3 days')" >/dev/null
# 新（1 分钟前上传，无引用）—— **在途图片，绝不能删**
PSQL "insert into media (id,owner_user_id,scope,storage_key,mime,bytes,width,height,sha256,upload_request_id,created_at)
      values ('$MID_NEW','$U_OLD','private','$KEY_NEW','image/png',10,24,16,'$SHA_PLACEHOLDER','$(cat /proc/sys/kernel/random/uuid)', now() - interval '1 minute')" >/dev/null
# 旧 + 已被消息引用 —— **无论多老都不该删**
PSQL "insert into media (id,owner_user_id,scope,storage_key,mime,bytes,width,height,sha256,upload_request_id,created_at)
      values ('$MID_REF','$U_OLD','private','$KEY_REF','image/png',10,24,16,'$SHA_PLACEHOLDER','$(cat /proc/sys/kernel/random/uuid)', now() - interval '3 days')" >/dev/null
# 旧 + 无引用 + **盘上无文件** —— 行/文件不一致，本轮不动但必须报出来
PSQL "insert into media (id,owner_user_id,scope,storage_key,mime,bytes,width,height,sha256,upload_request_id,created_at)
      values ('$MID_GHOST','$U_OLD','private','$KEY_GHOST','image/png',10,24,16,'$SHA_PLACEHOLDER','$(cat /proc/sys/kernel/random/uuid)', now() - interval '3 days')" >/dev/null
rm -f "$UP/private/$KEY_GHOST"
# 引用 MID_REF 的消息（本脚本自己造，不依赖种子数据）
PSQL "insert into message_threads (id,kind,title) values ('$THREAD','direct','WO2 清扫测试会话')" >/dev/null
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$U_OLD')" >/dev/null
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$U2')" >/dev/null
PSQL "insert into messages (id,thread_id,sender_id,body,kind) values ('$MSG','$THREAD','$U_OLD','[图片]','image')" >/dev/null
PSQL "insert into message_media (message_id,media_id,media_scope,position) values ('$MSG','$MID_REF','private',0)" >/dev/null
ok "4 类 media 行 + 1 条引用消息就绪（旧无引用 / 新无引用 / 旧有引用 / 旧无引用无文件）"

echo
echo "=== C1+C3+C4. dry-run：新图不进候选、孤儿列表不受影响、什么都不删 ==="
J="$(UPLOAD_ROOT="$UP" DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" node "$CLEANUP" --json 2>&1)"
printf '%s' "$J" | grep -q "\"$MID_OLD\"" && ok "3 天前的无引用 media 出现在 unattached 候选里" || bad "旧的无引用 media 没被识别：$(printf '%s' "$J" | head -c 300)"
printf '%s' "$J" | grep -q "\"$MID_NEW\"" && bad "**1 分钟前的在途图片竟然进了候选**（会误删用户正要发的图）" \
  || ok "1 分钟前的无引用 media **不在候选里**（TTL 保护在途图片）"
printf '%s' "$J" | grep -q "\"$MID_REF\"" && bad "**被消息引用的 media 进了候选**" \
  || ok "被消息引用的 media 不在候选里（引用优先）"
printf '%s' "$J" | grep -q '"unattachedMissingFile":1' && ok "盘上无文件的那条被单独报出（unattachedMissingFile=1），不混进候选" \
  || bad "没有如实报出「有行无文件」的条数：$(printf '%s' "$J" | head -c 400)"
printf '%s' "$J" | grep -q '"orphans"' && printf '%s' "$J" | grep -q '"unattached"' \
  && ok "JSON 里 orphan 与 unattached 是**两个字段**（分开计数）" || bad "JSON 结构里两类没分开"
TXT="$(UPLOAD_ROOT="$UP" DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" node "$CLEANUP" 2>&1)"
printf '%s' "$TXT" | grep -q '孤儿（未登记文件）' && printf '%s' "$TXT" | grep -q 'unattached（有 media 行、无任何消息引用）' \
  && ok "文本输出里两类**分开报告**" || bad "文本输出没有分开报告：$(printf '%s' "$TXT" | head -c 300)"
[ "$(PSQL "select count(*) from media where id='$MID_OLD'")" = "1" ] && [ -f "$UP/private/$KEY_OLD" ] \
  && ok "**dry-run 后行在、文件在**（什么都没删）" || bad "dry-run 竟然动了数据"

echo
echo "=== C2. 阈值放到 8760h（一年）→ 候选为空、什么都不删 ==="
J="$(UPLOAD_ROOT="$UP" DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" node "$CLEANUP" --json --unattached-max-age-hours 8760 2>&1)"
printf '%s' "$J" | grep -q "\"$MID_OLD\"" && bad "阈值放大到一年后旧图仍在候选里（阈值参数没生效）" \
  || ok "阈值 8760h 时候选为空（阈值保护生效）"

echo
echo "=== C5. --apply：只删过期且无引用的，行与文件一起删 ==="
OUT="$(UPLOAD_ROOT="$UP" DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" node "$CLEANUP" --apply --json 2>&1)"
echo "$OUT"
printf '%s' "$OUT" | grep -q '"unattachedRowsDeleted":1' && ok "报告里 unattached 行删除数=1（**与孤儿数分开报**）" \
  || bad "unattachedRowsDeleted 不是 1：$(printf '%s' "$OUT" | tail -c 300)"
printf '%s' "$OUT" | grep -q '"unattachedFilesDeleted":1' && ok "报告里 unattached 文件删除数=1" || bad "unattachedFilesDeleted 不是 1"
[ "$(PSQL "select count(*) from media where id='$MID_OLD'")" = "0" ] && ok "过期的无引用 media **行已删**" || bad "行没删掉"
[ -f "$UP/private/$KEY_OLD" ] && bad "**文件还在**（行删了文件没删 = 变成未登记文件）" || ok "文件**同时被删**（行与文件一起回收）"
[ "$(PSQL "select count(*) from media where id='$MID_NEW'")" = "1" ] && [ -f "$UP/private/$KEY_NEW" ] \
  && ok "1 分钟前的在途图片**行与文件都在**" || bad "在途图片被删了（TTL 失效）"
[ "$(PSQL "select count(*) from media where id='$MID_REF'")" = "1" ] && [ -f "$UP/private/$KEY_REF" ] \
  && ok "**被消息引用的 media 行与文件都在**（引用优先于 TTL）" || bad "被引用的 media 被删了"
[ "$(PSQL "select count(*) from message_media where media_id='$MID_REF'")" = "1" ] && ok "引用关系完好（消息仍然指着那张图）" || bad "引用关系被破坏"
[ "$(PSQL "select count(*) from media where id='$MID_GHOST'")" = "1" ] && ok "有行无文件的那条**没被动**（不属于本工具的处置范围）" || bad "那条不一致的行被删了"

echo
echo "=== C7. 再跑一次 --apply → 幂等，什么都不删 ==="
OUT2="$(UPLOAD_ROOT="$UP" DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" node "$CLEANUP" --apply --json 2>&1)"
printf '%s' "$OUT2" | grep -q '"unattachedRowsDeleted":0' && ok "第二次 --apply：unattached 删除数=0（幂等）" \
  || bad "第二次 --apply 还删了东西：$(printf '%s' "$OUT2" | tail -c 300)"

echo
echo "=== C8. 退出码：无 DATABASE_URL → 2（既有纪律，防止无目标库误删）==="
UPLOAD_ROOT="$UP" DATABASE_URL='' node "$CLEANUP" --apply >/dev/null 2>&1
RC=$?
[ "$RC" = "2" ] && ok "缺 DATABASE_URL → 退出码 2" || bad "期望退出码 2，实际 $RC"

echo
echo "=== Z. 清理测试数据 ==="
for K in "$KEY_OLD" "$KEY_NEW" "$KEY_REF" "$KEY_GHOST"; do rm -f "$UP/private/$K"; done
PSQL "delete from message_threads where id='$THREAD'" >/dev/null
PSQL "delete from media where id in ('$MID_OLD','$MID_NEW','$MID_REF','$MID_GHOST')" >/dev/null
LEFT="$(PSQL "select count(*) from media where id in ('$MID_OLD','$MID_NEW','$MID_REF','$MID_GHOST')")"
LEFTF=0
for K in "$KEY_OLD" "$KEY_NEW" "$KEY_REF" "$KEY_GHOST"; do [ -f "$UP/private/$K" ] && LEFTF=$((LEFTF+1)); done
[ "$LEFT" = "0" ] && [ "$LEFTF" = "0" ] && ok "测试数据已清理（DB 0 行、盘上 0 个文件）" || bad "仍有残留：DB $LEFT 行 / 盘上 $LEFTF 个"

echo
if [ "$FAILED" -eq 0 ]; then echo "CLEANUP_UNATTACHED_RESULT PASS"; else echo "CLEANUP_UNATTACHED_RESULT FAIL"; fi
exit "$FAILED"
