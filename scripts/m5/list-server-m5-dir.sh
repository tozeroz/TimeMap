#!/usr/bin/env bash
# 比对 /tmp/m5 里的辅助脚本与当前仓库 scripts/m5/*.sh 是否一致
# 并列出"仓库有、服务器没有"的（新加的脚本最容易漏）
set -uo pipefail
DIR=/tmp/m5

echo "=== /tmp/m5 目录内容（服务器）==="
if [ -d "$DIR" ]; then
  ls -1 "$DIR" | sed 's/^/  /'
  echo "  共 $(ls -1 "$DIR" | wc -l) 个文件"
else
  echo "  目录不存在：$DIR"
fi

echo
echo "=== 各文件 sha256（服务器侧）==="
if [ -d "$DIR" ]; then
  for f in "$DIR"/*.sh; do
    [ -e "$f" ] || continue
    printf '  %-46s %s\n' "$(basename "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
  done
fi
