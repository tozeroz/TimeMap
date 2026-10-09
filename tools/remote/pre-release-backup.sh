#!/usr/bin/env bash
# Take a real, restorable snapshot of the server state BEFORE a release.
#
# WHY (this is not decoration): the release in question only flips one app_release row, but the
# deploy also replaces server/dist/*.mjs and restarts the service. If anything about the new bundle
# is wrong, the fast way back is "restore this snapshot", and that only works if the snapshot was
# taken while the old bundle was still on disk. Taking it afterwards is worthless.
#
# Deliberately does NOT print secrets: server.env is never echoed.
#
# USAGE: tools/remote.ps1 -ScriptFile tools/remote/pre-release-backup.sh
set -euo pipefail

TS=$(date +%Y%m%d-%H%M%S)
DIR="/srv/campus/backups/pre-release-$TS"
mkdir -p "$DIR"

echo "== 记录当前状态 =="
sudo -u postgres psql -Atc "select version, checksum from schema_migrations order by version" campus \
  > "$DIR/schema_migrations.txt"
sudo -u postgres psql -Atc "select id, latest_version, coalesce(apk_url,'(null)'), active from app_release" campus \
  > "$DIR/app_release.txt"
sudo -u postgres psql -Atc "select version, checksum from schema_migrations order by version" campus | tail -3
cat "$DIR/app_release.txt"
printf 'backend  : %s\n' "$(systemctl is-active campus-backend.service)"

echo
echo "== 数据库快照（pg_dump -Fc，可 pg_restore）=="
# 用 postgres 身份做 dump：应用口令不参与，避免把口令写进任何文件
sudo -u postgres pg_dump -Fc campus > "$DIR/campus-db.dump"
ls -l "$DIR/campus-db.dump"

echo
echo "== 当前后端产物（连同 dist 一起留档，回滚时可直接放回）=="
tar -C /srv/campus -czf "$DIR/server-dist.tar.gz" server/dist
ls -l "$DIR/server-dist.tar.gz"

echo
echo "== 校验和 =="
( cd "$DIR" && sha256sum campus-db.dump server-dist.tar.gz schema_migrations.txt app_release.txt > SHA256SUMS && cat SHA256SUMS )

echo
echo "== 目录 =="
ls -l "$DIR"
df -h /srv | tail -1
echo "BACKUP_DIR=$DIR"
