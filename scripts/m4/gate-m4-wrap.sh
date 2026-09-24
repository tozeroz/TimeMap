#!/usr/bin/env bash
# 把 M4 gate 需要的脚本放到它期望的 /tmp 路径，然后运行 M4 服务器侧 Gate。
#
# 为什么需要这个包装：
#   scripts/gates/m4/gate-server.sh 里写死了 /tmp/m4-verify-*.sh 这些路径，
#   而仓库里的文件名与之不同（verify-media-schema.sh 等）。手工 scp 容易漏一个，
#   漏掉时 gate 会报 FAIL —— 那是**测试设施的假 FAIL**，本项目已因此浪费过轮次
#   （A7 误判、flaky 断言）。所以把映射固化成脚本，避免重复踩。
#
# 用途：改动过 server/ 之后跑一次 M4 回归（持久不变量 + 阶段不变量 + 回归）。
#
# 用法（服务器上，脚本已上传到 /tmp/gate-m4-wrap.sh）：
#   bash /tmp/gate-m4-wrap.sh
set -u
SRC="${1:-/tmp/m4src}"     # 仓库里 scripts/m4/ 的副本所在目录
GATE="${2:-/tmp/gate-m4.sh}"

if [ ! -d "$SRC" ]; then echo "缺少脚本源目录 $SRC"; exit 2; fi
if [ ! -f "$GATE" ]; then echo "缺少 gate 脚本 $GATE"; exit 2; fi

echo "=== 就位 M4 gate 期望的路径 ==="
cp -f "$SRC/verify-media-schema.sh"       /tmp/m4-verify-schema.sh
cp -f "$SRC/verify-media-upload.sh"       /tmp/m4-verify-upload.sh
cp -f "$SRC/verify-media-delivery.sh"     /tmp/m4-verify-delivery.sh
cp -f "$SRC/backup-restore-joint.sh"      /tmp/m4-backup.sh
cp -f "$SRC/verify-cleanup-failclosed.sh" /tmp/m4-verify-failclosed.sh
cp -f "$SRC/verify-backup-barrier.sh"     /tmp/m4-verify-barrier.sh
cp -f "$SRC/verify-barrier-e2e.sh"        /tmp/m4-verify-barrier-e2e.sh
cp -f "$SRC/backup-with-barrier.sh"       /tmp/backup-with-barrier.sh

echo "  --- 就位结果 ---"
for F in /tmp/m4-verify-schema.sh /tmp/m4-verify-upload.sh /tmp/m4-verify-delivery.sh \
         /tmp/m4-backup.sh /tmp/m4-verify-failclosed.sh /tmp/m4-verify-barrier.sh \
         /tmp/m4-verify-barrier-e2e.sh /tmp/backup-with-barrier.sh; do
  if [ -f "$F" ]; then echo "  OK   $F"; else echo "  缺失 $F"; fi
done

echo
echo "=== 前置：产物核验（先确认验的是新产物，本轮已栽过一次）==="
N=$(grep -c 'uploads\]' /srv/campus/server/dist/index.mjs || true)
echo "  dist/index.mjs 里 'uploads]' 出现 $N 次（应 >=1，说明含 .tmp 自愈的新代码）"

echo
echo "=== 运行 M4 服务器侧 Gate ==="
bash "$GATE"
RC=$?
echo
echo "M4 gate 退出码: $RC"
echo "（注意：备份/恢复项较重，耗时可能数分钟；它在临时库上做，不污染主库）"
exit "$RC"
