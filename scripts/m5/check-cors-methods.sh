#!/usr/bin/env bash
# ⭐ 机械门禁：**每个已注册的 HTTP 方法都必须在 CORS 的 allow-methods 里**
#
# ## 为什么需要（2026-09-22 的真实教训）
#   我给服务端加了 `PATCH /api/users/me`，**忘了**把它加进 CORS 的 allow-methods
#   （原来是 'GET,POST,OPTIONS'）。
#   后果：PATCH 带 content-type/authorization 会先触发 **CORS 预检（OPTIONS）**；
#         预检响应里没有 PATCH → 预检失败 → 浏览器/WebView 的 fetch 直接报 **"Failed to fetch"**
#         → **设备上"保存"100% 失败**。
#   ⚠️ 而我的服务端验证脚本（curl）**全 PASS** —— 因为 **curl 不带 CORS 语义、根本不发预检**。
#   → 这是一个"只有真机 / 只有浏览器才能暴露"的缺陷类别。
#      本脚本把"记得同步改 CORS"从**人的自觉**变成**机械检查**。
#
# ## 它做什么
#   ① 从部署产物 `dist/index.mjs` 里提取**已注册的路由方法**（app.get/post/patch/put/delete(…）
#   ② 对每个非简单方法发一次**真实预检**（OPTIONS + Access-Control-Request-Method），
#      读回的 `access-control-allow-methods`
#   ③ 断言：每个已注册方法都在 allow-methods 里；否则 FAIL 并列出缺失的方法
#
# ## 为什么从产物里提路由，而不是从源码
#   产物是**实际部署的东西**；源码可能是"改了没部署"。本门禁要证明的是**线上行为**。
#   （与 ARTIFACT_PROVENANCE 的纪律一致：先证明在看正确的产物。）
#
# 用法（在服务器上）：bash check-cors-methods.sh
set -uo pipefail
B=/srv/campus/server/dist/index.mjs
BASE=http://127.0.0.1
FAIL=0
ok()  { echo "  PASS $1"; }
bad() { echo "  FAIL $1"; FAIL=1; }

echo "=== 0) 产物存在性 ==="
if [ ! -f "$B" ]; then echo "  FATAL 缺 $B"; exit 2; fi
echo "  $B （$(stat -c %y "$B" | cut -d. -f1)）"

echo
echo "=== 1) 从产物提取已注册的方法 ==="
# 匹配 app.get('/api/... 之类（esbuild 打包后仍是相同调用形态）
METHODS="$(grep -o -E '\.(get|post|patch|put|delete)\("/api' "$B" 2>/dev/null | sed 's/.*\.//; s/(".*//' | tr 'a-z' 'A-Z' | sort -u)"
if [ -z "$METHODS" ]; then
  echo "  ⚠️ 未提取到任何 /api 路由 —— 提取式可能过期（打包形态变了？）"
  echo "      这是**提取失败**，不是"没有路由"，故本门禁记 FAIL 而不是通过（避免空过）"
  FAIL=1
else
  echo "  提取到: $(printf '%s' "$METHODS" | tr '\n' ' ')"
  ok "路由方法提取成功（$(printf '%s' "$METHODS" | wc -l) 种）"
fi

echo
echo "=== 2) 读一次预检响应里的 allow-methods ==="
PRE="$(curl -s -i -X OPTIONS "$BASE/api/users/me" \
  -H 'Origin: https://localhost' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: content-type,authorization' 2>&1)"
PC="$(printf '%s' "$PRE" | head -1 | grep -o '[0-9][0-9][0-9]' | head -1)"
ALLOW="$(printf '%s' "$PRE" | tr -d '\r' | grep -i '^access-control-allow-methods:' | head -1 | cut -d: -f2- | tr -d ' ' | tr 'a-z' 'A-Z')"
AO="$(printf '%s' "$PRE" | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1 | cut -d: -f2- | tr -d ' ')"
echo "  预检 HTTP $PC"
echo "  allow-methods: ${ALLOW:-<缺失>}"
echo "  allow-origin : ${AO:-<缺失>}"
[ -n "$ALLOW" ] && ok "预检响应带 allow-methods" || bad "预检响应没有 allow-methods（CORS 头缺失）"
[ -n "$AO" ] && ok "预检响应带 allow-origin（白名单来源 https://localhost）" || bad "预检响应没有 allow-origin"

echo
echo "=== 3) ⭐ 逐一比对：已注册方法 ⊆ allow-methods ==="
MISSING=""
for m in $METHODS; do
  case ",$ALLOW," in
    *",$m,"*) printf '  ✓ %-7s 在 allow-methods 里\n' "$m" ;;
    *) printf '  ✗ %-7s **不在** allow-methods 里 ← 该方法的跨域请求会以 "Failed to fetch" 失败\n' "$m"
       MISSING="$MISSING $m" ;;
  esac
done
if [ -z "$MISSING" ]; then
  ok "所有已注册方法都在 allow-methods 里"
else
  bad "以下方法缺失：$MISSING（请把它们加进 CORS 的 access-control-allow-methods）"
fi

echo
echo "=== 4) 反向核对：allow-methods 里是否列了**未注册**的方法（多列不致命，但要可见）==="
EXTRA=""
for m in $(printf '%s' "$ALLOW" | tr ',' ' '); do
  case " $METHODS " in
    *" $m "*) : ;;
    OPTIONS) : ;;   # OPTIONS 是预检本身，必然要留
    *) EXTRA="$EXTRA $m" ;;
  esac
done
if [ -z "$EXTRA" ]; then
  echo "  （无多余方法）"
else
  echo "  info 多列了：$EXTRA（无害，但说明 CORS 比路由更宽——注意别把 DELETE/PUT 之类提前放出去）"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "CORS_METHODS_COVERAGE: PASS（已注册方法 ⊆ allow-methods）"
else
  echo "CORS_METHODS_COVERAGE: FAIL"
fi
exit "$FAIL"
