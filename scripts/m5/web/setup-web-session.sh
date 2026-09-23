#!/usr/bin/env bash
# 为网页端建立已登录会话：从模拟器 App 复制会话 token 注入网页端
#
# ════════════════════════════════════════════════════════════════════════════
# 为什么这样做（而不是临时关短信、或往生产代码加测试后门）
# ════════════════════════════════════════════════════════════════════════════
#   会话是 bearer token，**与来源无关** —— 服务端只认 Authorization 头。
#   模拟器上的 App 早就登录了（M0–M5 期间就在用），它的 token 仍在有效期内。
#   ⇒ 把它复制到网页端 origin 的 localStorage（同一个键名）即可。
#      · 对真实用户**零影响**（不需要临时关闭短信投递）
#      · 不往生产代码里加任何"测试登录通道"（那才是真的安全债）
#
# ⚠️ token 明文只落在 tools/tmp/（.gitignore 已忽略），不打印完整值、不进仓库。
#
# ⚠️ 两个目标抢 9222（见 launch-web-chrome.sh 的说明），所以流程是：
#     停 web Chrome → 转发到模拟器读会话 → 关转发 → 再起 web Chrome → 注入
set -uo pipefail
cd "$(dirname "$0")/../../.." 2>/dev/null || true

ADB="${ADB_BIN:-G:/Program Files/Netease/MuMu/nx_main/adb.exe}"
SERIAL="${ADB_SERIAL:-127.0.0.1:16384}"
SESSION_FILE='G:/demo map/tools/tmp/web-session.json'
CHROME_EXE='chrome.exe'

echo "=== 1) 关掉 web Chrome（释放 9222）==="
# ⚠️ 这里修过一次：初版用 `tasklist ... + wmic process where` 在 Git-Bash 里匹配命令行，
#    **没匹配上、静默什么都没杀**，于是 9222 仍被 web Chrome 占着，
#    后续"读会话"读到的其实是网页端（url 显示 https://8.148.156.146/#/login），
#    还一度让我以为"App 没登录"。⇒ 改用 PowerShell 的 CimInstance 按**profile 参数**
#    精确匹配，并打印实际杀掉的 pid（不再静默）。
# ⚠️ 绝不能 taskkill /IM chrome.exe：那会把用户自己的浏览器一起杀掉。
powershell.exe -NoProfile -Command "
\$ps = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*web-chrome-profile*' }
if (\$ps) { \$ps | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Output ('  已结束 ' + \$ps.Count + ' 个 web Chrome 进程') } else { Write-Output '  （没有在跑的 web Chrome）' }
" 2>&1 | sed 's/^/  /'
sleep 2

echo "  --- 确认 9222 已释放 ---"
if curl -s -m 5 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "  ✗ 9222 仍被占用 ⇒ 中止（不强行抢端口，避免读到错的目标）"
  exit 1
fi
echo "  ✓ 已释放"

echo
echo "=== 2) 把 9222 转发到模拟器的 WebView ==="
APP_PID="$("$ADB" -s "$SERIAL" shell pidof com.campusx.demo 2>/dev/null | tr -d '\r\n ')"
if [ -z "$APP_PID" ]; then
  echo "  ⚠️ App 没在跑，尝试启动"
  "$ADB" -s "$SERIAL" shell monkey -p com.campusx.demo -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 6
  APP_PID="$("$ADB" -s "$SERIAL" shell pidof com.campusx.demo 2>/dev/null | tr -d '\r\n ')"
fi
echo "  App pid = ${APP_PID:-未取到}"
[ -n "$APP_PID" ] || { echo "  ✗ 拿不到 pid，无法读会话"; exit 1; }
"$ADB" -s "$SERIAL" forward --remove tcp:9222 >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" forward tcp:9222 "localabstract:webview_devtools_remote_$APP_PID" 2>&1 | sed 's/^/  /'
sleep 2

echo
echo "=== 3) 读会话 ==="
node scripts/m5/web/capture-app-session.mjs || { echo "  ✗ 读会话失败"; exit 1; }

echo
echo "=== 4) 关转发，把 9222 让给 web Chrome ==="
"$ADB" -s "$SERIAL" forward --remove tcp:9222 >/dev/null 2>&1 || true
sleep 1

echo
echo "=== 5) 起 web Chrome ==="
bash scripts/m5/web/launch-web-chrome.sh || exit 1

echo
echo "=== 6) 注入会话并刷新 ==="
node scripts/m5/web/inject-web-session.mjs
