#!/usr/bin/env bash
# 清理本次 NATIVE_FILE_PICKER_INTERACTION 真机验证在我们**自己的 demo 服务器**上留下的残留。
#
# 为什么要清：本项目多个 Gate 会做**计数类断言**（"会话内恰好 N 条消息"之类），
#   残留会让它们无故失败 —— 属于"测试污染被测环境"，比测试失败更难排查。
#
# ⚠ 这里操作的是**我们自己的库**（campus）与**我们自己的服务器**，
#   不是第三方原版 app；用户对原版的只读硬约束不适用于这里。
#
# 本次产生的对象（id 全部来自设备端 CDP 抓到的**真实响应体**，不是猜的）：
#   message : 61b234f8-bba8-46ba-aaee-30d544c501cd   （POST /api/threads/.../messages → 201 的响应体）
#   media   : 182638f2-f1d1-447b-8440-bc060d30e053   （POST /api/media → 201 的响应体）
#             storageKey=2026/09/182638f2-....png  scope=private  bytes=7088  640x360
#   线程    : 66666666-cccc-4ccc-8ccc-000000000003（只删上面那一条消息，不用 thread 全删 ——
#             该线程还有 seed/fixture 消息与别人留下的残留）
#
# 顺序很关键：**先取 storage_key，再删行**；否则行没了就没法推出盘上文件路径，
#   会留下未登记文件 → 被 orphan 清扫工具报出来。
set -uo pipefail
THREAD='66666666-cccc-4ccc-8ccc-000000000003'
MSG='61b234f8-bba8-46ba-aaee-30d544c501cd'
MEDIA='182638f2-f1d1-447b-8440-bc060d30e053'
UPLOAD_ROOT='/srv/campus/uploads'

PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 清理前 ==="
echo "  该线程消息数            : $(PSQL "select count(*) from messages where thread_id='$THREAD'")"
echo "  待删消息数              : $(PSQL "select count(*) from messages where id='$MSG'")"
echo "  待删媒体数              : $(PSQL "select count(*) from media where id='$MEDIA'")"
echo "  全局 messages / media   : $(PSQL 'select count(*) from messages') / $(PSQL 'select count(*) from media')"

# ① 先拿盘上路径（删行之前必须拿到）
REL="$(PSQL "select scope || '/' || storage_key from media where id='$MEDIA'")"
echo "  盘上相对路径            : ${REL:-（无）}"

# ② 再删关联表 → 消息 → 媒体（按 id 精确）
PSQL "delete from message_media where message_id='$MSG'" >/dev/null
PSQL "delete from messages where id='$MSG'" >/dev/null
PSQL "delete from media where id='$MEDIA'" >/dev/null

# ③ 盘上文件也删（否则成为 orphan）
if [ -n "$REL" ]; then
  P="$UPLOAD_ROOT/$REL"
  if [ -f "$P" ]; then /bin/rm -f "$P"; echo "  已删文件: $P"; else echo "  盘上文件不存在（可能已删）: $P"; fi
fi

echo
echo "=== 清理后 ==="
echo "  该线程消息数            : $(PSQL "select count(*) from messages where thread_id='$THREAD'")"
echo "  残留消息数              : $(PSQL "select count(*) from messages where id='$MSG'")"
echo "  残留媒体数              : $(PSQL "select count(*) from media where id='$MEDIA'")"
echo "  全局 messages / media   : $(PSQL 'select count(*) from messages') / $(PSQL 'select count(*) from media')"
echo "  该线程剩余消息 id       : $(PSQL "select string_agg(id::text, ',' order by created_at) from messages where thread_id='$THREAD'")"

echo
echo "=== orphan / unattached 清扫 dry-run（json）==="
cd /srv/campus/server || exit 1
UPLOAD_ROOT="$UPLOAD_ROOT" DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" \
  /opt/node-v24.21.0-linux-x64/bin/node dist/cleanup.mjs --json 2>&1 | tail -c 3000
echo
