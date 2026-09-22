#!/usr/bin/env bash
# 组合 runner：**先建 CDP 转发 → 跑 VISUAL_TARGET_VALIDITY → 跑设备 Gate → 再核一次 preflight**
#
# 为什么需要它（H4，本轮踩到的坑）：
#   我原先手动调用顺序是「先 preflight → 后建 CDP 转发」，
#   于是 preflight 的 CDP 检查必然报 unreachable（**假 FAIL**）。
#   假 FAIL 会让"证据作废"这条纪律被误触发，久了就会被忽略 —— 那正是纪律失效的开始。
#   → 把顺序封进 runner，顺序错不了。
#
# 用法（在工作站上跑）：
#   bash scripts/m5/run-device-gate.sh <gate脚本.mjs> [更多参数...]
set -u

# ---------------------------------------------------------------------------
# ⭐ 互斥锁（2026-09-22 新增；起因是一个**未定位的间歇性失败**）
#
# ## 为什么要它
#   M5 **服务器侧** Gate 里有一节 `verify-tmp-selfheal.sh`，它会
#       systemctl restart campus-backend.service   +   rm -rf /srv/campus/uploads/.tmp
#   即：**服务器侧 Gate 会重启后端并清空上传临时目录**（这本身是必要的测试，
#   但意味着它**不是无副作用的**）。
#   因此"设备侧 Gate 正在打同一个后端"与"服务器侧 Gate 正在重启它"**并发**时会互相干扰：
#   在飞的请求会失败，表现为**间歇性**的 "FAIL 登录失败"，
#   而把同一个脚本**单独**再跑一次却 PASS —— 这正是此前那处
#   "未复现、未定位"故障的形态。
#
# ## 它做什么
#   用一个锁目录保证"同一时刻只有一个 Gate 在打这台后端"。
#   锁按**机器**（不是按进程）保护：设备 Gate 在服务器上建锁文件（通过 ssh），
#   服务器 Gate 的入口 `run-gate.sh` 也检查同一把锁。
#   拿到锁 → 跑；拿不到 → **明确报"另一个 Gate 正在运行"并退出**，
#   而不是并行跑出一个含糊的失败。
#
# ## 边界（不要夸大）
#   它解决的是**这一类**并发干扰。它**不**证明 05:19:37 那次具体的失败就是这个原因
#   —— 那一次仍未定位；已按审核 53 的要求加了"下次失败自动抓现场"
#   （scripts/m5/capture-login-failure-forensics.sh）。
# ---------------------------------------------------------------------------
LOCK_HELPER='G:\demo map\scripts\m5\gate-lock.sh'
if [ -x "$LOCK_HELPER" ] || [ -f "$LOCK_HELPER" ]; then
  # 注意：这里必须用 "$1"（GATE 变量在下面才赋值）—— 我第一版写成 "$GATE"，
  # 于是锁的持有者名字是空的（owner=device-gate:），日志里看不出是哪个 Gate 持有。
  if ! bash "$LOCK_HELPER" acquire "device-gate:$(basename "${1:-unknown}")"; then
    echo "FATAL 另一个 Gate 正在运行（互斥锁被占用）—— 两个 Gate 不得并发打同一后端。"
    echo "      稍后重试；若确认没有别的 Gate 在跑：bash scripts/m5/gate-lock.sh release"
    exit 3
  fi
  trap 'bash "$LOCK_HELPER" release >/dev/null 2>&1 || true' EXIT
else
  echo "WARN 找不到 $LOCK_HELPER —— 跳过互斥保护（并发跑 Gate 可能互相干扰）"
fi

if [ $# -lt 1 ]; then
  echo "用法: bash scripts/m5/run-device-gate.sh <gate脚本.mjs> [args...]"
  exit 2
fi
GATE="$1"; shift

ADB='G:\Program Files\Netease\MuMu\nx_main\adb.exe'
SERIAL='127.0.0.1:16384'
PKG='com.campusx.demo'
PREFLIGHT='G:\demo map\scripts\m5\preflight-capture.ps1'
API_ORIGIN_PREFLIGHT='G:\demo map\scripts\m5\preflight-api-origin.mjs'
PROVENANCE_CHECK='G:\demo map\scripts\m5\check-artifact-provenance.sh'

echo "=== 1/9 把目标 App 带到前台（am start，不做 force-stop）==="
"$ADB" -s "$SERIAL" shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 3

echo "=== 2/9 建 CDP 转发（必须早于 preflight 的 CDP 检查）==="
PID="$("$ADB" -s "$SERIAL" shell pidof "$PKG" | tr -d '\r')"
if [ -z "$PID" ]; then echo "  FATAL 拿不到 $PKG 的 pid"; exit 1; fi
"$ADB" -s "$SERIAL" forward --remove-all >/dev/null 2>&1
"$ADB" -s "$SERIAL" forward tcp:9222 "localabstract:webview_devtools_remote_${PID}" >/dev/null 2>&1
sleep 1
echo "  forward tcp:9222 → webview_devtools_remote_$PID"

echo "=== 3/9 VISUAL_TARGET_VALIDITY（采集前）==="
powershell -NoProfile -Command "& '$PREFLIGHT' -ExpectPackage $PKG -ExpectCdpUrl localhost" || {
  echo "  VISUAL_TARGET_VALIDITY: FAIL → 证据作废，终止（这不是产品 FAIL）"
  exit 1
}

echo "=== 4/9 ARTIFACT_PROVENANCE（web → cap asset → 已装 APK 三者一致）==="
# 为什么要有它（真实事故；审核记录 50 建议做成机械证明）：
#   我改完前端只跑了 pnpm build + build-android.ps1，**漏跑 npx cap sync android**，
#   装机后跑的是**旧 bundle**，而设备 Gate 照样有输出 ——
#   差点把"新代码根本没生效"误读成"新代码没通过"。
#   同类问题还有：服务器上的 gate 是手工拷贝的旧副本（改了仓库不会自动生效）。
#   两者本质相同：**source changed ≠ executed artifact changed**。
#   → 引用任何设备结论之前，先证明 web 产物 / cap asset / 已装 APK **同名且同 sha256**。
bash "$PROVENANCE_CHECK" || {
  echo "  ARTIFACT_PROVENANCE: FAIL → 本次设备结论**不可引用**（装的可能不是当前代码）"
  exit 3
}

echo "=== 5/9 API_E2E_ORIGIN_VALIDITY（采集前；审核记录 47 要求的机械前置）==="
# 为什么要有它（本项目**已踩两次**的坑）：
#   在 Capacitor WebView 里用**相对路径** fetch 会打到 WebView 自己的本地服务器
#   （https://localhost），并且**返回 HTML 且状态码 200** → json() 得 {}，
#   看起来像"服务端没返回字段"。第一次踩在 WO#5 的语音 E2E，第二次踩在 WO#9A 的身份 oracle。
# 审核 47 要求把它升级成**机械前置**：捕获到 text/html 就**直接 FATAL**，
#   不要继续 json() 让 {} 污染后续判断。
# 因此：这里先证明"绝对 origin 能从 WebView 打到后端且返回 JSON"，
#   不成立就终止（exit 2），后续所有 API 断言一并不作数。
node "$API_ORIGIN_PREFLIGHT"
RC_ORIGIN=$?
if [ "$RC_ORIGIN" -ne 0 ]; then
  echo "  API_E2E_ORIGIN_VALIDITY: FATAL（exit $RC_ORIGIN）→ 本次所有 API 断言不可信，终止"
  exit 2
fi

echo "=== 6/9 跑 Gate: $GATE ==="
node "$GATE" "$@"
RC=$?

echo "=== 7/9 VISUAL_TARGET_VALIDITY（采集后复核：确认期间没被切走）==="
powershell -NoProfile -Command "& '$PREFLIGHT' -ExpectPackage $PKG -ExpectCdpUrl localhost" || {
  echo "  VISUAL_TARGET_VALIDITY(after): FAIL → 本次证据作废"
  exit 1
}

# ---------------------------------------------------------------- 7.5 清理 DB 残留
echo
echo "=== 8/9 清理本次 Gate 可能留下的 DB 残留（best-effort）==="
# ## ⭐ 为什么放在 **runner** 而不是每个 Gate 自己
#   本项目已有 8+ 个设备 Gate，各自都会造数（消息 / 媒体 / 账号 / 会话）。
#   实测证据（2026-09-22 Round 264→265）：
#     一次"8 条回归全扫"跑完后，`messages` 从 **5** 变成 **8**，残留 3 条：
#       WO9B-SEL-SUCCESS／WO9B-SEL-CANCEL／WO7-GATE-<ts>
#   即：**每个 Gate 只管造、不管收**。逐个去改 8 个 Gate 既慢又必然漏；
#   放在**唯一的入口**上，才能保证"跑完就是干净的"。
# ## 纪律
#   · **绝不**让清理失败影响门禁结论（RC 已在上一步固化）——
#     "门禁判定"与"环境是否干净"是两件事，不能互相污染。
#   · 清理是**只删已知测试形态**（WO 前缀等），不是清空表。
#   · 拿不到凭据/连不上就当跳过（打印 WARN），不报错。
CLEAN_HELPER='G:\demo map\scripts\m5\cleanup-all-gate-residue.sh'
SSH_KEY='G:\demo map\TimeMap.pem'
SSH_HOST='root@8.148.156.146'
if [ -f "$CLEAN_HELPER" ]; then
  if scp -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=8 "$CLEAN_HELPER" "$SSH_HOST:/tmp/" >/dev/null 2>&1; then
    CLEAN_OUT="$(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=8 "$SSH_HOST" \
      'bash /tmp/cleanup-all-gate-residue.sh' 2>&1 || true)"
    printf '%s\n' "$CLEAN_OUT" | grep -aE '清理后基线|剩余 WO\* 残留|已删除' | sed 's/^/  /'
  else
    echo "  WARN 无法把清理脚本送到服务器（跳过；**基线可能不干净**，请手动核对）"
  fi
else
  echo "  WARN 找不到 $CLEAN_HELPER（跳过清理）"
fi

echo
echo "=== 9/9 汇总 ==="
echo "DEVICE_GATE_EXIT=$RC"
exit $RC
