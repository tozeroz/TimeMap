#!/usr/bin/env bash
# 网页端部署的**服务器侧**部分（由 tools/deploy-web.ps1 scp 上来执行）
#
# ⚠️ 为什么服务器侧逻辑单独成文件、而不是写在 .ps1 的 here-string 里：
#   ① PowerShell 5.1 对**无 BOM 的 UTF-8 .ps1** 会按本地代码页（GBK）解析
#      ⇒ 里面的中文会变乱码（实测出现过 `鐩綍鍙揪` 这种）。
#      bash 读 UTF-8 没有这个问题 ⇒ 把带中文的逻辑放这里更稳。
#   ② PowerShell 不支持 `< 文件` 做 stdin 重定向（`<` 是保留操作符），
#      而 `运行远程脚本` 的常规做法就是 scp 过去再 bash。
set -uo pipefail

WEB=/srv/campus/web
MODE="${1:-all}"

# ── 权限修正（⚠️ 不做这步 /assets 会 403，页面白屏）─────────────────────
fix_perms() {
  chown -R campus:campus "$WEB"
  # ⚠️ 目录 755 / 文件 644 **分开设**，不用 chmod -R 一刀切：
  #    一刀切会给普通文件加可执行位 —— 没好处，却扩大"被当程序执行"的面。
  find "$WEB" -type d -exec chmod 755 {} \;
  find "$WEB" -type f -exec chmod 644 {} \;
  echo "  --- 权限（应见 drwxr-xr-x 与 -rw-r--r--）---"
  ls -la "$WEB" | sed 's/^/    /'
  ls -la "$WEB/assets" | head -6 | sed 's/^/    /'
}

# ── 冒烟验证 ────────────────────────────────────────────────────────────
smoke() {
  local ASSET CSS fail=0 r
  ASSET=$(ls "$WEB"/assets/*.js  2>/dev/null | head -1 | xargs -r basename)
  CSS=$(ls   "$WEB"/assets/*.css 2>/dev/null | head -1 | xargs -r basename)
  p() { printf '  %-32s %s\n' "$1" "$2"; }
  code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$1"; }

  # ⭐ 关键：**必须查 /assets 下的真实 JS**。只查首页会漏掉"权限导致白屏"——
  #    那种情况下 / 与 /index.html 仍是 200，只有 assets 是 403。
  r=$(code http://127.0.0.1/);                    p "首页 /" "$r";              [ "$r" = 200 ] || fail=1
  r=$(code "http://127.0.0.1/assets/$ASSET");     p "JS  /assets/$ASSET" "$r";  [ "$r" = 200 ] || fail=1
  r=$(code "http://127.0.0.1/assets/$CSS");       p "CSS /assets/$CSS" "$r";    [ "$r" = 200 ] || fail=1
  r=$(code http://127.0.0.1/favicon.svg);         p "图标 /favicon.svg" "$r";   [ "$r" = 200 ] || fail=1
  r=$(code http://127.0.0.1/api/health);          p "API /api/health" "$r";     [ "$r" = 200 ] || fail=1
  r=$(code http://127.0.0.1/nope/should-404);     p "未知路径应 404" "$r";       [ "$r" = 404 ] || fail=1
  r=$(code http://127.0.0.1/.env);                p "点文件应 404" "$r";        [ "$r" = 404 ] || fail=1
  r=$(code http://127.0.0.1/.well-known/acme-challenge/x); p "ACME 目录仍可达" "$r"

  echo
  echo "  --- 页面标题（确认下发的真的是我们的 index.html）---"
  curl -s -m 10 http://127.0.0.1/ | grep -o '<title>[^<]*</title>' | head -1 | sed 's/^/    /'
  echo "  --- 是否声明了图标（favicon 404 的验证点）---"
  curl -s -m 10 http://127.0.0.1/ | grep -o 'rel="icon"[^>]*' | head -1 | sed 's/^/    /'
  echo "  --- 是否有 version.ts 之外的可疑残留文件 ---"
  find "$WEB" -type f | wc -l | sed 's/^/    文件总数: /'

  echo
  if [ "$fail" = 0 ]; then echo "WEB_SMOKE: PASS"; else echo "WEB_SMOKE: FAIL"; exit 1; fi
}

case "$MODE" in
  perms) fix_perms ;;
  smoke) smoke ;;
  all)   fix_perms; echo; smoke ;;
  *)     echo "用法: $0 {perms|smoke|all}"; exit 2 ;;
esac
