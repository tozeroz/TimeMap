#!/usr/bin/env bash
# 清理 WO#2 前端真机验证在**我们自己的 demo 服务器**上留下的残留。
#
# 为什么必须清：
#   残留是线程 66666666-cccc-4ccc-8ccc-000000000003 里的 2 条图片消息
#   + 2 条 private media。本项目多个 Gate 会做**计数类断言**
#   （例如"会话内恰好 N 条消息"），残留会让它们无故失败 —— 属于
#   "测试污染被测环境"，比测试失败更难排查。
#
# 注意：这里操作的是**我们自己的库**（campus），不是第三方原版 app。
#   用户对原版的只读硬约束不适用于这里；我们自己造的测试数据可以随便清理。
set -u
THREAD='66666666-cccc-4ccc-8ccc-000000000003'
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 清理前 ==="
echo "  该线程消息数: $(PSQL "select count(*) from messages where thread_id='$THREAD'")"
echo "  待删媒体数  : $(PSQL "select count(*) from media where id in ('8ee3a801-63d6-4560-8f3d-71bb6e633e09','d5da48f3-53c4-434d-ac69-f5d3a92ed277')")"
echo "  全局 messages: $(PSQL 'select count(*) from messages')   media: $(PSQL 'select count(*) from media')"

# 先取盘上文件路径（删行之前必须拿到，否则会留下未登记文件 → 触发 orphan 清扫）
FILES="$(PSQL "select scope || '/' || storage_key from media where id in ('8ee3a801-63d6-4560-8f3d-71bb6e633e09','d5da48f3-53c4-434d-ac69-f5d3a92ed277')")"

# 只删这两条消息（按 id 精确，不用 thread 全删 —— 该线程可能有种子/fixture 消息）
PSQL "delete from message_media where message_id in ('26ba07d3-7dbd-4f7c-bb58-29fbf286b047','00dfe54f-bc7c-4ac7-8509-008109b39685')" >/dev/null
PSQL "delete from messages where id in ('26ba07d3-7dbd-4f7c-bb58-29fbf286b047','00dfe54f-bc7c-4ac7-8509-008109b39685')" >/dev/null
PSQL "delete from media where id in ('8ee3a801-63d6-4560-8f3d-71bb6e633e09','d5da48f3-53c4-434d-ac69-f5d3a92ed277')" >/dev/null

# 盘上文件也删（否则成为 orphan，被清扫工具报出）
while IFS= read -r REL; do
  [ -n "$REL" ] || continue
  P="/srv/campus/uploads/$REL"
  if [ -f "$P" ]; then /bin/rm -f "$P"; echo "  已删文件: $P"; fi
done <<< "$FILES"

echo
echo "=== 清理后 ==="
echo "  该线程消息数: $(PSQL "select count(*) from messages where thread_id='$THREAD'")"
echo "  全局 messages: $(PSQL 'select count(*) from messages')   media: $(PSQL 'select count(*) from media')"
echo "  残留待删媒体: $(PSQL "select count(*) from media where id in ('8ee3a801-63d6-4560-8f3d-71bb6e633e09','d5da48f3-53c4-434d-ac69-f5d3a92ed277')")"

# 用既有 orphan 清扫做一次只读确认（dry-run 不该报出我们刚制造/留下的孤儿）
echo
echo "=== orphan 清扫 dry-run（应当没有我们刚处理的残留）==="
cd /srv/campus/server || exit 1
UPLOAD_ROOT=/srv/campus/uploads DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" \
  node dist/cleanup.mjs --json 2>&1 | head -c 400
echo
