#!/usr/bin/env bash
# 验证网页端部署是**原子的**：部署的同时持续请求 /，不应出现任何一次失败
#
# ════════════════════════════════════════════════════════════════════════════
# 为什么要这样测（而不是"部署完 curl 一下通不通"）
# ════════════════════════════════════════════════════════════════════════════
#   缺陷的性质是"**部署过程中有一段时间站点是空的**"。
#   部署结束后再查，当然一切正常 —— 那样**测不到**这个缺陷。
#   ⇒ 必须**在部署进行中**连续采样，并断言采样窗口里没有失败。
#
#   证据来源：nginx 错误日志里曾出现（并有一条来自真实客户端 IP）
#     directory index of "/srv/campus/web/" is forbidden, request: "GET /"
#   ⇒ 旧的 `rm -rf $WEB` + 上传确实制造过真实的空窗。
set -uo pipefail

REPO='G:/demo map'
TARGET='https://8.148.156.146/'
N="${1:-120}"

cd "$REPO" || exit 1

echo "=== 起一个后台采样器：每 0.2 秒请求一次 /，记录所有非 200 ==="
SAMPLES='G:/demo map/tools/tmp/atomic-probe.txt'
: > "$SAMPLES"
(
  for i in $(seq 1 "$N"); do
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$TARGET" 2>/dev/null || echo "ERR")
    printf '%s %s\n' "$(date +%H:%M:%S.%3N 2>/dev/null || date +%H:%M:%S)" "$code" >> "$SAMPLES"
    sleep 0.2
  done
) &
PROBE_PID=$!

echo "  （采样器已起，pid=$PROBE_PID）"

echo
echo "=== 部署**之前**的 build-id（用于证明"部署真的发生了"）==="
BEFORE_ID=$(curl -s -m 8 "$TARGET"build-id.txt 2>/dev/null || echo '')
echo "  before: ${BEFORE_ID:-（无）}"
sleep 1

echo
echo "=== 在采样期间执行一次部署（--SkipBuild，只走上传+原子切换）==="
DEPLOY_OUT='G:/demo map/tools/tmp/atomic-deploy-out.txt'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'G:\demo map\tools\deploy-web.ps1' -SkipBuild > "$DEPLOY_OUT" 2>&1
DEPLOY_RC=$?
grep -E 'build-id|staging-ready|staged|原子切换|WEB_SMOKE|DEPLOY_WEB|SWAP FAILED|throw|Exception' "$DEPLOY_OUT" | sed 's/^/  /'
echo "  部署退出码=$DEPLOY_RC"

echo
echo "=== 等采样结束 ==="
wait "$PROBE_PID" 2>/dev/null || true

echo
echo "=== 部署**之后**的 build-id ==="
AFTER_ID=$(curl -s -m 8 "$TARGET"build-id.txt 2>/dev/null || echo '')
echo "  after : ${AFTER_ID:-（无）}"

TOTAL=$(wc -l < "$SAMPLES")
BAD=$(grep -vcE ' 200$' "$SAMPLES" || true)
echo
echo "  采样次数: $TOTAL"
echo "  非 200 的次数: $BAD"
if [ "$BAD" != "0" ]; then
  echo "  --- 失败样本（前 10 条）---"
  grep -vE ' 200$' "$SAMPLES" | head -10 | sed 's/^/    /'
fi

echo
echo "════ 判定 ════"
# ⚠️ 判定分两层，缺一不可：
#   ① **部署真的发生了**（build-id 变化 + 部署退出码为 0）
#   ② 部署**期间没有失败请求**
#   ⚠️ 只看 ② 是**空虚的** —— 我第一版就是这样：scp 其实失败了、什么都没部署，
#      探测却看到"0 次失败"⇒ 误判为"原子切换成功"。
#      "没有失败"在"什么都没做"时同样成立，所以必须先用 ① 排除这种情形。
DEPLOYED=0
if [ "$DEPLOY_RC" = "0" ] && [ -n "$AFTER_ID" ] && [ "$AFTER_ID" != "$BEFORE_ID" ]; then
  DEPLOYED=1
fi

if [ "$TOTAL" -lt 20 ]; then
  echo "  INCONCLUSIVE：采样次数太少（$TOTAL），不足以判定"
  echo "ATOMIC_DEPLOY: INCONCLUSIVE"
  exit 0
fi
if [ "$DEPLOYED" != "1" ]; then
  echo "  ✗ 无法证明部署真的发生过（部署退出码=$DEPLOY_RC；build-id $BEFORE_ID → ${AFTER_ID:-无}）"
  echo "     ⇒ 本次「期间无失败」没有意义（可能是根本没部署）"
  echo "ATOMIC_DEPLOY: INCONCLUSIVE（部署未发生/未生效，不能给出 PASS）"
  exit 0
fi
if [ "$BAD" = "0" ]; then
  echo "  ✓ 部署确实发生（build-id 变为 $AFTER_ID），且全程无失败请求 ⇒ 切换是原子的"
  echo "ATOMIC_DEPLOY: PASS"
  exit 0
fi
echo "  ✗ 部署发生（build-id=$AFTER_ID）但期间出现失败请求 ⇒ 存在空窗"
echo "ATOMIC_DEPLOY: FAIL"
exit 1
