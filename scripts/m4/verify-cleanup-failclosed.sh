#!/usr/bin/env bash
# M4 CLOSEOUT ④：cleanup 在数据库不可用时必须 **fail-closed**
#
# 审核记录 18 点名的第 ④ 条。此前的缺口：
#   只覆盖了"缺少 DATABASE_URL 时拒绝执行"（build.mjs 里的冒烟），
#   但**"URL 存在、连不上库"**没有验证。
#
# 为什么这条重要：清扫工具会**删磁盘文件**。如果它在拿不到"哪些文件被引用"的情况下
# 仍然继续按空引用集去扫，就会把**所有**文件都判成孤儿并删掉 —— 那是灾难性误删。
# 所以必须证明：连不上库时它**什么都不删**。
#
# 为什么用"不可达端口"而不是"停 PG"：等效（连接失败）但不干扰服务器上其它进程，
# 也不影响并发的验证脚本。这比 systemctl stop postgresql 更安全。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

UP=/srv/campus/uploads
NODE=/opt/node-v24.21.0-linux-x64/bin/node
CLI=/srv/campus/server/dist/cleanup.mjs

count_files() { find "$UP/public" "$UP/private" -type f 2>/dev/null | wc -l; }

echo "=== 前置：确认正常路径可用（连得上库）==="
BEFORE="$(count_files)"
echo "  当前盘上文件数: $BEFORE"

echo
echo "=== ④-1：DATABASE_URL 指向**不可达端口** → 必须非 0 退出 ==="
OUT="$(sudo -u campus bash -c "set -a; . /srv/campus/server.env; set +a; DATABASE_URL='postgres://campus:x@127.0.0.1:59999/campus' $NODE $CLI --apply --max-age-hours 0 --json" 2>&1)"
RC=$?
echo "  退出码: $RC"
echo "  输出（截断）: $(printf '%s' "$OUT" | head -c 200)"
[ "$RC" != "0" ] && ok "连不上库时非 0 退出" || bad "连不上库却以 0 退出（会静默继续）"

AFTER="$(count_files)"
echo "  盘上文件数: $BEFORE → $AFTER"
[ "$BEFORE" = "$AFTER" ] && ok "**文件数未变（fail-closed：什么都没删）**" || bad "文件数从 $BEFORE 变成 $AFTER —— 连不上库却删了文件！"

echo
echo "=== ④-2：对照 —— 连得上库时 dry-run 不应删任何东西 ==="
BEFORE2="$(count_files)"
sudo -u campus bash -c "set -a; . /srv/campus/server.env; set +a; $NODE $CLI --json --max-age-hours 0" >/dev/null 2>&1
AFTER2="$(count_files)"
[ "$BEFORE2" = "$AFTER2" ] && ok "dry-run 未删除任何文件（$BEFORE2 保持不变）" || bad "dry-run 删了文件（$BEFORE2 → $AFTER2）"

echo
echo "=== ④-3：缺 DATABASE_URL → 也必须拒绝（已有冒烟，这里复验一次）==="
RC3="$(sudo -u campus bash -c "set -a; . /srv/campus/server.env; set +a; unset DATABASE_URL; $NODE $CLI" >/dev/null 2>&1; echo $?)"
[ "$RC3" = "2" ] && ok "缺 DATABASE_URL → 退出码 2（拒绝执行）" || bad "期望退出码 2，实际 $RC3"

echo
if [ "$FAILED" -eq 0 ]; then echo "CLEANUP_FAILCLOSED_RESULT PASS"; else echo "CLEANUP_FAILCLOSED_RESULT FAIL"; fi
exit "$FAILED"
