#!/usr/bin/env bash
# ⭐ CORS 门禁（按审核记录 55 的**修正后不变量**）—— `CORS_CLIENT_METHOD_COVERAGE`
#
# ## 一、为什么需要（2026-09-22 的真实事故，两次）
#   ① 我给服务端加了 `PATCH /api/users/me`，忘了加进 CORS allow-methods
#      → 设备上「保存」**100% 失败**（fetch 报 "Failed to fetch"）
#   ② 更早就存在的 `DELETE /api/posts/:id/like`（取消点赞）**一直缺** DELETE
#      → APK 里「取消点赞」长期不可用，而没人发现
#   两次都是同一个根因：**服务端脚本测不出来** ——
#      curl/psql **不带 CORS 语义、根本不发预检**。
#
# ## 二、⭐ 不变量必须是"**客户端实际会调用的**"，不是"所有已注册的"
#   我第一版写的是「每个已注册的 HTTP 方法都必须在 allow-methods 里」。
#   **审核记录 55 判为过强**：将来可能存在
#     "server route exists but intentionally not callable from WebView/browser"
#   —— 强迫它进入 allow-methods 会**无意扩大暴露面**。
#
#   正确的不变量（本脚本实现的就是它）：
#     每一个**被 WebView/browser 客户端实际调用**的 HTTP method，
#     都必须通过**真实 CORS preflight contract**。
#
# ## 三、它怎么做
#   ① 从**客户端源码** `app/src/api/client.ts` 提取客户端真正使用的 method
#      （不是从服务端路由表！这是与第一版的关键差别）
#   ② 对每个这样的 method 发**真实预检**：
#        OPTIONS <api path>
#        Origin: <app origin>                       ← Capacitor WebView 是 https://localhost
#        Access-Control-Request-Method: <method>
#        Access-Control-Request-Headers: authorization,content-type
#   ③ 校验四项：
#        · 2xx / 204
#        · allow-origin **回显**该 origin
#        · allow-methods **包含**所请求的方法
#        · allow-headers **包含**所请求的非简单头
#
# ⚠️ 一个容易漏掉的事实：`authorization` **不是** CORS 安全列表头，
#    所以**带会话的 GET 也会触发预检**。因此 GET 也必须能被预检放行 ——
#    本脚本对 GET 也做预检校验，而不是想当然"GET 是简单请求"。
#
# ## 四、边界（不夸大）
#   它验证的是**预检契约**（服务端是否愿意放行），不是"业务逻辑正确"。
#   真正的端到端仍须由设备侧 Gate 覆盖（见 SERVER_API_PASS ≠ BROWSER_CLIENT_REACHABLE）。
#
# 用法（服务器上）：bash check-cors-contract.sh
set -uo pipefail
BASE="${CAMPUS_BASE:-http://127.0.0.1}"
# Capacitor APK 的 WebView origin；本地浏览器预览是 http://127.0.0.1:517x
APP_ORIGIN="${CAMPUS_APP_ORIGIN:-https://localhost}"
# 客户端 request() 会带上的非简单头（有会话带 authorization；有 body 带 content-type）
REQ_HEADERS="${CAMPUS_REQ_HEADERS:-authorization,content-type}"
FAIL=0
ok()  { echo "  PASS $1"; }
bad() { echo "  FAIL $1"; FAIL=1; }
info(){ echo "  info $1"; }

echo "=== 0) 客户端源码里**实际使用**的 method ==="
# 为什么不从服务端路由表取：见文件头 §二（审核 55 的修正）
CLIENT_SRC=/tmp/client-methods-input.txt
if [ ! -f "$CLIENT_SRC" ]; then
  echo "  FATAL 缺 $CLIENT_SRC"
  echo "        （该文件由部署侧提供：把 app/src/api/client.ts 上传到该路径。）"
  echo "        ⚠️ 缺输入 = 检查范围不完整 → 记 FAIL，不静默通过。"
  echo "CORS_CLIENT_METHOD_COVERAGE: FAIL"
  exit 2
fi
# 显式 method: 'X'
EXPLICIT="$(grep -o -E "method:\s*'[A-Z]+'" "$CLIENT_SRC" | grep -o -E "[A-Z]+" | sort -u)"
# 默认 GET：request<...>(' 或 request(...)(' 未带 method
IMPLICIT_GET="$(grep -c -E "request<[^>]*>\(" "$CLIENT_SRC" || echo 0)"
METHODS="$EXPLICIT"
[ "${IMPLICIT_GET:-0}" -gt 0 ] && METHODS="$(printf '%s\nGET\n' "$METHODS" | sort -u)"
METHODS="$(printf '%s\n' "$METHODS" | sed '/^$/d')"
if [ -z "$METHODS" ]; then
  bad "未能从客户端源码提取任何 method（提取式可能过期）—— 属「检查范围没覆盖到」，记 FAIL"
else
  info "客户端实际使用: $(printf '%s' "$METHODS" | tr '\n' ' ')"
  info "客户端会带的非简单头: $REQ_HEADERS"
fi

echo
echo "=== 1) 对每个客户端 method 发**真实预检**并校验契约 ==="
printf '  %-8s %-6s %-14s %s\n' "method" "HTTP" "allow-methods" "结论"
printf '  %s\n' "--------------------------------------------------------------"

while read -r M; do
  [ -z "$M" ] && continue
  R="$(curl -s -i -X OPTIONS "$BASE/api/posts" \
        -H "Origin: $APP_ORIGIN" \
        -H "Access-Control-Request-Method: $M" \
        -H "Access-Control-Request-Headers: $REQ_HEADERS" 2>&1)"
  CODE="$(printf '%s' "$R" | head -1 | grep -o '[0-9][0-9][0-9]' | head -1)"
  AM="$(printf '%s' "$R" | tr -d '\r' | grep -i '^access-control-allow-methods:' | head -1 | cut -d: -f2- | tr -d ' ' | tr 'a-z' 'A-Z')"
  AH="$(printf '%s' "$R" | tr -d '\r' | grep -i '^access-control-allow-headers:' | head -1 | cut -d: -f2- | tr -d ' ' | tr 'A-Z' 'a-z')"
  AO="$(printf '%s' "$R" | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1 | cut -d: -f2- | tr -d ' ')"

  # ⚠️ 判定必须**累积**所有未通过项，不能像第一版那样让后面的检查**覆盖**前面的结论。
  #    第一版是 `VERDICT="FAIL(...)"` 逐项赋值 → **最后一项赢**：
  #    当 origin 不在白名单时（服务端根本不回任何 CORS 头），真正的根因是"origin 不被允许"，
  #    但门禁报的是"allow-headers 缺 content-type" —— **指向了错误的原因**，
  #    会让排查的人去改 CORS 头配置，而其实该改的是 origin 白名单。
  #    （这是自测发现的：③ 破坏 origin 时门禁确实红了，但原因写错了，自测的第二条件匹配不上。）
  PROBLEMS=""
  # ① 状态码：预检成功应为 2xx/204
  case "$CODE" in 2*|204) : ;; *) PROBLEMS="$PROBLEMS 状态码=${CODE:-none};" ;; esac
  # ② allow-origin 必须回显该 origin（我们用白名单，不用 *）
  [ "$AO" != "$APP_ORIGIN" ] && PROBLEMS="$PROBLEMS origin未被允许(allow-origin='${AO:-空}');"
  # ③ allow-methods 必须包含所请求方法
  case ",$AM," in
    *",$M,"*) : ;;
    *) PROBLEMS="$PROBLEMS 缺方法${M}(allow-methods='${AM:-空}');" ;;
  esac
  # ④ allow-headers 必须包含所请求的非简单头
  for h in $(printf '%s' "$REQ_HEADERS" | tr ',' ' '); do
    case ",${AH}," in
      *",$h,"*) : ;;
      *) PROBLEMS="$PROBLEMS 缺头${h};" ;;
    esac
  done
  if [ -z "$PROBLEMS" ]; then VERDICT=OK; else VERDICT="FAIL(${PROBLEMS# })"; fi

  printf '  %-8s %-6s %-14s %s\n' "$M" "${CODE:-none}" "${AM:-none}" "$VERDICT"
  if [ "$VERDICT" = "OK" ]; then
    ok "$M 预检契约通过"
  else
    # ⚠️ 这里用**中文引号**而不是 ASCII 双引号：
    #    早先为了避开 shell 引号我用 ''…'' 占位，结果那对单引号**泄漏进了输出**，
    #    变成 "客户端会以 ''Failed to fetch'' 失败"。输出里的假引号同样会降低可读性。
    bad "$M $VERDICT（客户端会以「Failed to fetch」失败 —— 用户可见的功能不可用）"
  fi
done <<< "$METHODS"

echo
echo "=== 2) 反向信息（只报告，不判红）==="
# 列了但客户端不用的方法：无害，但说明 CORS 比客户端需要更宽 —— 值得可见
PRE="$(curl -s -i -X OPTIONS "$BASE/api/posts" -H "Origin: $APP_ORIGIN" \
      -H 'Access-Control-Request-Method: GET' 2>&1)"
ALL="$(printf '%s' "$PRE" | tr -d '\r' | grep -i '^access-control-allow-methods:' | head -1 | cut -d: -f2- | tr -d ' ' | tr 'a-z' 'A-Z')"
info "服务端当前 allow-methods: ${ALL:-<缺失>}"
# ⚠️ 必须先把 METHOD 列表**压成空格分隔**再比对：
#    我第一版直接 `case " $METHODS "`，而 $METHODS 是**换行分隔**的，
#    于是 " GET "（前后各一个空格）匹配不到 —— 因为 GET 前面是**换行**而不是空格。
#    结果是**所有**方法都被报成"客户端不用"，包括明明在用的 GET/POST/PATCH/DELETE。
#    这类"信息性输出本身是错的"同样有害：它会训练人忽略这一段。
METHODS_FLAT="$(printf '%s' "$METHODS" | tr '\n' ' ' | tr -s ' ')"
EXTRA=""
for m in $(printf '%s' "$ALL" | tr ',' ' '); do
  # ⚠️ 必须**直接判断 $m**，不能写成 case 的 `OPTIONS)` 分支：
  #    case 的 pattern 是拿去匹配**case 主语**的（这里是 " $METHODS_FLAT "），
  #    而不是匹配 $m —— 所以 `OPTIONS)` 永远不会命中（主语是整个方法列表，不是 "OPTIONS"）。
  #    我第一版就是这么写的，结果 OPTIONS 被当成"客户端不用"报了出来。
  #    （在隔离环境里跑一小段才定位出来：EXTRA=[ OPTIONS]。）
  [ "$m" = "OPTIONS" ] && continue   # OPTIONS 是预检机制本身，必然要留
  case " $METHODS_FLAT " in
    *" $m "*) : ;;
    *) EXTRA="$EXTRA $m" ;;
  esac
done
if [ -n "$EXTRA" ]; then
  info "多列了客户端不用的方法：$EXTRA（无害；但注意别把未使用的方法提前放出去）"
else
  info "没有多余方法（allow-methods 与客户端需求一致）"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "CORS_CLIENT_METHOD_COVERAGE: PASS（客户端实际调用的每个 method 都通过真实预检契约）"
else
  echo "CORS_CLIENT_METHOD_COVERAGE: FAIL"
fi
exit "$FAIL"
