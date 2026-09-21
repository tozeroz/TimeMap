#!/usr/bin/env bash
# 诊断：M5_AUTH_STALE_REVOKED_SESSIONS FAIL(5) 的根因（只读）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) 当前\"撤销>24h\"的会话逐条列出 ==="
PSQL "select s.id::text
             || ' | revoked_at=' || to_char(s.revoked_at,'MM-DD HH24:MI:SS')
             || ' | age=' || round(extract(epoch from (now()-s.revoked_at))/3600.0,2)::text || 'h'
             || ' | user=' || left(coalesce(s.user_id::text,'<null>'),8)
        from sessions s
       where s.revoked_at is not null and s.revoked_at < now() - interval '24 hours'
       order by s.revoked_at"

echo
echo "=== 2) 会话状态总览 ==="
PSQL "select 'total=' || count(*)::text
             || ' revoked_not_null=' || count(revoked_at)::text
             || ' revoked_stale(>24h)=' || count(*) filter (where revoked_at < now() - interval '24 hours')::text
             || ' expired_stale(>24h)=' || count(*) filter (where expires_at < now() - interval '24 hours')::text
        from sessions"

echo
echo "=== 3) 撤销时间的分布（看是不是我本轮测试造成的）==="
PSQL "select 'revoked_at 的分钟分布（近 20 条）'
        union all
       select to_char(revoked_at,'MM-DD HH24:MI') || ' x' || count(*)::text
         from sessions where revoked_at is not null
        group by to_char(revoked_at,'MM-DD HH24:MI')
        order by 1 desc limit 20"

echo
echo "=== 4) 清理工具在哪、它上次运行是什么时候 ==="
ls -la /srv/campus/server/dist/ 2>/dev/null | sed 's/^/  /'
echo "  --- systemd timer（若有）---"
systemctl list-timers --all 2>/dev/null | grep -i -E 'campus|auth' | sed 's/^/  /' || echo "  （无相关 timer）"
echo "  --- cron ---"
(crontab -l 2>/dev/null; ls /etc/cron.d 2>/dev/null) | grep -i -E 'campus|auth' | sed 's/^/  /' || echo "  （无相关 cron）"

echo
echo "=== 5) 手动跑一次 auth-hygiene 清理（看它报告什么）==="
cd /srv/campus/server
setpriv --reuid=campus --regid=campus --clear-groups \
  env $(grep -v '^#' /srv/campus/server.env | xargs) \
  /opt/node-v24.21.0-linux-x64/bin/node /srv/campus/server/dist/cleanup-auth.mjs 2>&1 | sed 's/^/  /'

echo
echo "=== 6) 清理后再看 ==="
PSQL "select '撤销>24h 的会话 = ' || count(*)::text
        from sessions where revoked_at is not null and revoked_at < now() - interval '24 hours'"
