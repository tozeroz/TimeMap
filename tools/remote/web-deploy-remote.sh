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

# ── ⭐ 原子替换（修掉"部署期间站点打空"的真实缺陷）─────────────────────
# ⚠️ 原来的做法是 `rm -rf $WEB && mkdir -p $WEB` 再上传 ⇒
#    **整个上传期间站点是空的**（不是"旧版本继续服务"，而是"什么都没有"）。
#    这不是理论风险：nginx 错误日志里有证据 ——
#      01:58:2x  directory index of "/srv/campus/web/" is forbidden  (GET /)
#    而且其中一条来自**真实客户端 IP**（不是我的 127.0.0.1）⇒ 真有访客撞上了。
#    同时它也让"部署后立刻冒烟"变得不可靠（可能读到半成品）。
# ⇒ 改为：新内容先放到 $WEB.new（已在别处上传），再 **两次 mv 原子切换**。
#    mv 在同文件系统内是 rename(2)，是原子的 ⇒ **不存在中间态**。
atomic_swap() {
  local stage="${1:-$WEB.new}"
  if [ ! -d "$stage" ]; then
    echo "  ✗ 找不到暂存目录 $stage（新内容没上传？）⇒ 不做切换，保留现有版本"
    return 1
  fi
  if [ ! -f "$stage/index.html" ]; then
    echo "  ✗ $stage/index.html 不存在 ⇒ 拒绝切换（避免把站点切成空的）"
    return 1
  fi
  fix_perms "$stage"
  local old="${WEB}.old.$$"
  if [ -d "$WEB" ]; then
    mv "$WEB" "$old"          # 1) 当前版本挪走
  fi
  mv "$stage" "$WEB"          # 2) 新版本就位（此刻起对外可见）
  [ -d "$old" ] && rm -rf "$old"
  echo "  ✓ 已原子切换（中间不存在空目录状态）"
  echo -n "  切换后文件数: "; find "$WEB" -type f | wc -l
}

# ── 权限修正（⚠️ 不做这步 /assets 会 403，页面白屏）─────────────────────
fix_perms() {
  local dir="${1:-$WEB}"
  chown -R campus:campus "$dir"
  # ⚠️ 目录 755 / 文件 644 **分开设**，不用 chmod -R 一刀切：
  #    一刀切会给普通文件加可执行位 —— 没好处，却扩大"被当程序执行"的面。
  find "$dir" -type d -exec chmod 755 {} \;
  find "$dir" -type f -exec chmod 644 {} \;
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
  echo "  --- 挂载点检查（⚠️ 这一条是补上来的，见下）---"
  # ⚠️⚠️ 为什么必须查 #root：
  #   我曾在"精简 index.html 注释"时**误删了 <body> 与 <div id="root">**，
  #   部署后 `/` 仍是 200、<title> 也正常 —— 于是**原有冒烟全绿**，
  #   但页面上什么都没有（React createRoot 拿到 null，报 React error #299）。
  #   ⇒ "HTTP 200 + 标题对" **证明不了应用能挂载**。
  #     所以这里显式断言挂载点与模块脚本都在。
  HTML=$(curl -s -m 10 http://127.0.0.1/)
  if printf '%s' "$HTML" | grep -q 'id="root"'; then
    p "HTML 含 <div id=\"root\">" "yes"
  else
    p "HTML 含 <div id=\"root\">" "**NO**"; fail=1
  fi
  if printf '%s' "$HTML" | grep -q 'type="module"'; then
    p "HTML 含 module 入口脚本" "yes"
  else
    p "HTML 含 module 入口脚本" "**NO**"; fail=1
  fi
  if printf '%s' "$HTML" | grep -q '<body'; then
    p "HTML 含 <body>" "yes"
  else
    p "HTML 含 <body>" "**NO**"; fail=1
  fi

  echo
  echo "  --- 页面标题（确认下发的真的是我们的 index.html）---"
  printf '%s' "$HTML" | grep -o '<title>[^<]*</title>' | head -1 | sed 's/^/    /'
  echo "  --- 是否声明了图标（favicon 404 的验证点）---"
  printf '%s' "$HTML" | grep -o 'rel="icon"[^>]*' | head -1 | sed 's/^/    /'
  echo "  --- 文件总数 ---"
  find "$WEB" -type f | wc -l | sed 's/^/    /'

  echo
  if [ "$fail" = 0 ]; then echo "WEB_SMOKE: PASS"; else echo "WEB_SMOKE: FAIL"; exit 1; fi
}

case "$MODE" in
  perms) fix_perms "$WEB"; echo "  --- 权限（应见 drwxr-xr-x 与 -rw-r--r--）---"; ls -la "$WEB" | sed 's/^/    /'; ls -la "$WEB/assets" | head -6 | sed 's/^/    /' ;;
  swap)  atomic_swap "${2:-}" ;;
  smoke) smoke ;;
  all)   atomic_swap "${2:-}"; echo; smoke ;;
  *)     echo "用法: $0 {perms|swap [stage]|smoke|all [stage]}"; exit 2 ;;
esac
