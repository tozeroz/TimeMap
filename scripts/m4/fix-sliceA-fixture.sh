#!/usr/bin/env bash
# 清掉 Slice A 的残留 fixture，并报告当前 DB↔文件 的一致性。
#
# 背景：CROSS_REFERENCE_INTEGRITY 报"1 条文件内容与 DB 记录不符"。
# 根因是**我自己的 fixture 不一致**：sliceA-dev.png 的 DB 行 sha256 是最早用 8 字节
# 假样本写的，后来我把磁盘文件替换成真 PNG（8824 字节）以验证 CORS 修复 ——
# DB 记录没同步更新。检查**正确地**抓到了它，属于测试残留而非产品缺陷。
set -uo pipefail
export PGPASSWORD="$(cat /srv/campus/.db_password)"
PSQL() { psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
UP=/srv/campus/uploads

echo "=== 清理前：逐行比对 ==="
psql -h 127.0.0.1 -U campus -d campus -Atc "select id || ' ' || scope || ' ' || storage_key || ' ' || sha256 from media" > /tmp/mlist.txt
while read -r mid sc key sha; do
  [ -n "${mid:-}" ] || continue
  f="$UP/$sc/$key"
  if [ -f "$f" ]; then
    got="$(sha256sum "$f" | cut -d' ' -f1)"
    [ "$got" = "$sha" ] && echo "  OK   $sc/$key" || echo "  不符 $sc/$key（DB ${sha:0:12}… 文件 ${got:0:12}…）"
  else
    echo "  缺文件 $sc/$key"
  fi
done < /tmp/mlist.txt

echo
echo "=== 清理 Slice A 残留 fixture ==="
PSQL "delete from message_media where media_id in (select id from media where storage_key like '%sliceA%')" >/dev/null
PSQL "delete from media where storage_key like '%sliceA%'" >/dev/null
find "$UP" -name 'sliceA-*' -type f -delete 2>/dev/null || true
echo "  已清理（media 行 + 磁盘文件）"

echo
echo "=== 清理后：逐行比对 ==="
REMAIN=0
psql -h 127.0.0.1 -U campus -d campus -Atc "select id || ' ' || scope || ' ' || storage_key || ' ' || sha256 from media" > /tmp/mlist.txt
while read -r mid sc key sha; do
  [ -n "${mid:-}" ] || continue
  f="$UP/$sc/$key"
  if [ -f "$f" ]; then
    got="$(sha256sum "$f" | cut -d' ' -f1)"
    if [ "$got" = "$sha" ]; then echo "  OK   $sc/$key"; else echo "  不符 $sc/$key"; REMAIN=1; fi
  else
    echo "  缺文件 $sc/$key"; REMAIN=1
  fi
done < /tmp/mlist.txt
rm -f /tmp/mlist.txt
echo "REMAIN_MISMATCH=$REMAIN"
