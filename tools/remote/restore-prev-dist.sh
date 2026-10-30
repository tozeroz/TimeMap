#!/usr/bin/env bash
# 把某个快照里的**后端产物**放回去并重启服务（应急回滚用）。
#
# 为什么用快照而不是"从某个分支重新构建"：
#   线上库的 schema_migrations 里是 `027_release_1_3_2` / `026_fix_place_coords`，
#   而本地 main 上是 `027_bjtu_parent_place` / `026_map_display` —— 说明**线上跑的不是 main**。
#   在不清楚线上到底对应哪个分支时，凭猜测重新构建等于再赌一次；
#   而快照里的 dist 就是刚才还在正常跑的那份二进制，恢复它才是确定的。
#
# 用法（参数是快照目录的绝对路径）：
#   bash restore-prev-dist.sh /srv/campus/backups/pre-release-20261029-214151
set -euo pipefail

SNAP="${1:-}"
if [ -z "$SNAP" ] || [ ! -f "$SNAP/server-dist.tar.gz" ]; then
  echo "用法: $0 <快照目录>（需要 $SNAP/server-dist.tar.gz）"
  exit 2
fi

echo "== 1) 校验快照 =="
( cd "$SNAP" && sha256sum -c SHA256SUMS )

echo
echo "== 2) 把旧产物解出来（先解到临时目录，避免半途失败）=="
TMP=$(mktemp -d /tmp/restore-dist.XXXXXX)
tar -C "$TMP" -xzf "$SNAP/server-dist.tar.gz"
ls -l "$TMP/server/dist/" | sed 's/^/    /'

echo
echo "== 3) 覆盖 /srv/campus/server/dist 并修属主 =="
install -d -o campus -g campus -m 0750 /srv/campus/server/dist
cp -a "$TMP/server/dist/." /srv/campus/server/dist/
chown -R campus:campus /srv/campus/server/dist
chmod 0750 /srv/campus/server/dist/*.mjs
rm -rf "$TMP"
ls -l /srv/campus/server/dist/ | sed 's/^/    /'

echo
echo "== 4) 重启并等待就绪 =="
systemctl restart campus-backend.service
for i in $(seq 1 240); do
  if curl -sf -m 2 http://127.0.0.1:3001/api/ready >/dev/null 2>&1; then
    echo "    就绪耗时: ${i}s"
    break
  fi
  if [ "$i" = 240 ]; then
    echo "    240s 仍未就绪，诊断："
    systemctl status campus-backend.service --no-pager -n 10 || true
    journalctl -u campus-backend.service -n 30 --no-pager || true
    exit 1
  fi
  sleep 1
done

echo
echo "== 5) 结果 =="
printf '  is-active : '; systemctl is-active campus-backend.service
printf '  ready     : '; curl -s -m 5 http://127.0.0.1:3001/api/ready; echo
printf '  迁移日志  : '; journalctl -u campus-backend.service -n 40 --no-pager | grep -o 'applied=[0-9]*/[0-9]*' | tail -1
echo "RESTORE_PREV_DIST: OK"
