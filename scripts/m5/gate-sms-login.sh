#!/usr/bin/env bash
# ⭐ 门禁：短信登录通道（阿里云 PNVS）+ 登录闭环
#
# ═══════════════════════════════════════════════════════════════════════
# ⚠️ 为什么有些键会是 INCONCLUSIVE 而不是 PASS
# ═══════════════════════════════════════════════════════════════════════
#   本门禁**会真发短信**（因为只要短信通道配好了，调 request-code 就等于发短信）。
#   所以我们**绝不**拿随便一个号去发 —— 那可能是陌生人的真实号码（骚扰 + 计费）。
#   ⇒ 发短信相关的键只在给了 **operator 自己的测试号**（SMS_GATE_TEST_PHONE）时才判定；
#     没给就如实记 INCONCLUSIVE，而不是假装 PASS。
#
# 用法：SMS_GATE_TEST_PHONE=+8613xxxxxxxxx bash gate-sms-login.sh
set -uo pipefail

TEST_PHONE="${SMS_GATE_TEST_PHONE:-}"
API=https://127.0.0.1
pass=0; fail=0; incon=0
ck() { # $1 键  $2 PASS/FAIL/INCONCLUSIVE  $3 说明
  case "$2" in
    PASS) pass=$((pass+1));;
    FAIL) fail=$((fail+1));;
    *)    incon=$((incon+1));;
  esac
  printf '  %-42s %-13s %s\n' "$1" "$2" "${3:-}"
}
jq1() { python3 -c 'import sys,json;d=json.load(sys.stdin);v=d.get(sys.argv[1]);print("" if v is None else v)' "$1" 2>/dev/null; }

echo "=== 1) 静态检查：实现是否按设计（不引 SDK、传自定义码、失败不回退）==="
SRC=/srv/campus/server/dist/index.mjs

# ⚠️⚠️ 这一节我连续修了两次，值得记录（因为它暴露了一条通用规则）
#
#   【第一次】判据 `grep -F '##code##'` 报 FAIL，但代码其实是对的 ——
#     匹配到的是我**为解释设计而写在注释里的那句话**：
#     「⚠️ 传**具体验证码**（不是 ##code## 占位符）⇒ …」
#     而且这个 bundle **没有剥注释**，注释文本照样在文件里。
#
#   【第二次】我改成"先剥注释再搜" —— 结果**更糟**：bundle 是**超长行**，
#     我那条把 `//` 当行注释的正则，把字符串里的 `//`（例如 `https://…`）
#     也当成了注释开头，**吃掉了该行后面几千字符的真实代码**
#     （1921536 → 1786091 字节），把两个本来 PASS 的判据弄成了 FAIL。
#     ⇒ 仪器被我弄坏了，两个方向的结果都不可信。
#
#   【最终做法】不剥注释，改搜**带引号的字符串字面量**：
#     · 注释里的举例是**裸写**的（##code##），不会带引号
#     · 真实代码里的这些标记必然是**字符串字面量**（'HMAC-SHA1' / 'sms_delivery_failed'）
#     ⇒ 用一个**判别性更强、且不需要改动文本**的判据，绕开"注释污染"与"剥离误伤"两难。
#
#   ⭐ 通用规则：**静态判据要选一个"注释与代码必然不同"的特征**（例如引号、赋值形状），
#      而不是先去改文本；否则判据会随注释写法而变（这条已在本项目的多个门禁上重复出现）。

if grep -q -F -e "'HMAC-SHA1'" -e '"HMAC-SHA1"' "$SRC"; then
  ck SMS_SIGNATURE_IS_HMAC_SHA1 PASS '手写 RPC V1 签名（未引 SDK）'
else
  ck SMS_SIGNATURE_IS_HMAC_SHA1 FAIL '未找到 HMAC-SHA1 字面量'
fi

# ⭐ 自定义码（不是 ##code## 占位符）⇒ 校验仍由我们自己做
if grep -q -F -e "'##code##'" -e '"##code##"' -e '`##code##`' "$SRC"; then
  ck SMS_SENDS_CUSTOM_CODE FAIL '代码里出现了 ##code## 字面量 ⇒ 校验会被交给阿里云'
else
  ck SMS_SENDS_CUSTOM_CODE PASS '传具体码，校验仍由本地完成'
fi

if grep -q -F -e "'sms_delivery_failed'" -e '"sms_delivery_failed"' "$SRC"; then
  ck SMS_FAILURE_DOES_NOT_FALLBACK PASS '发送失败 ⇒ 返回 503，不回退 dev sink'
else
  ck SMS_FAILURE_DOES_NOT_FALLBACK FAIL '未找到失败分支字面量'
fi

echo
echo "=== 2) 运行态：进程是否真的看到了短信配置（只看有无，不打印值）==="
journalctl -u campus-backend --no-pager | grep -F '[sms]' | tail -1 | sed 's/^/  /'
if journalctl -u campus-backend --no-pager | grep -F '[sms] 已配置' | tail -1 | grep -q '已配置'; then
  ck SMS_CHANNEL_CONFIGURED PASS
else
  ck SMS_CHANNEL_CONFIGURED FAIL '启动日志显示未配置'
fi

echo
echo "=== 3) 运行态：错误码必须被正确拒绝（不发短信，可安全自动跑）==="
WRONG=$(curl -s -m 20 -X POST "$API/api/auth/verify-code" -k -H 'content-type: application/json' \
  -d "{\"phone\":\"+8613800000099\",\"code\":\"000000\"}" | jq1 error)
[ "$WRONG" = "invalid_code" ] && ck AUTH_REJECTS_WRONG_CODE PASS "error=$WRONG" || ck AUTH_REJECTS_WRONG_CODE FAIL "got=$WRONG"

echo
echo "=== 4) 真发短信相关（仅在给了测试号时判定）==="
if [ -z "$TEST_PHONE" ]; then
  ck SMS_DELIVERY_IS_REAL INCONCLUSIVE '未提供 SMS_GATE_TEST_PHONE（不拿陌生号发短信）'
  ck SMS_SENDER_NAME_EXPOSED INCONCLUSIVE '同上'
  ck SMS_NO_PLAINTEXT_CODE_ON_DISK INCONCLUSIVE '同上'
else
  SINK="/run/campus/login-codes/$(printf '%s' "$TEST_PHONE" | tr -d '+').json"
  rm -f "$SINK" 2>/dev/null || true
  RESP=$(curl -s -m 25 -X POST "$API/api/auth/request-code" -k -H 'content-type: application/json' \
    -d "{\"phone\":\"$TEST_PHONE\"}")
  echo "  响应: $(printf '%s' "$RESP" | head -c 300)"
  DELIV=$(printf '%s' "$RESP" | jq1 delivery)
  SENDER=$(printf '%s' "$RESP" | jq1 sms_sender)
  [ "$DELIV" = "sms" ] && ck SMS_DELIVERY_IS_REAL PASS "delivery=$DELIV" || ck SMS_DELIVERY_IS_REAL FAIL "delivery=$DELIV"
  [ -n "$SENDER" ] && ck SMS_SENDER_NAME_EXPOSED PASS "sender=$SENDER" || ck SMS_SENDER_NAME_EXPOSED FAIL 'sms_sender 为空'
  # ⭐ 走短信通道时**不应**再往磁盘落明文验证码
  if [ -f "$SINK" ]; then
    ck SMS_NO_PLAINTEXT_CODE_ON_DISK FAIL "居然落了 sink 文件：$SINK"
  else
    ck SMS_NO_PLAINTEXT_CODE_ON_DISK PASS '未落盘（走短信时不写明文码）'
  fi
  echo "  ⚠️ 已真发一条短信到 $TEST_PHONE（计费 + 需人工确认到达）"
fi

echo
echo "=== 5) 未验证到的（如实登记，不假装）==="
echo "  · 短信**实际到达运营商/手机**：需人工确认（本门禁只能证明 API 接受并返回 OK）"
echo "  · 端到端登录（用收到的码换 token）：需人工提供码，或由 operation 手工跑 tools/tmp/verify-login-loop.sh"

echo
echo "══ 汇总 ══"
echo "  PASS=$pass FAIL=$fail INCONCLUSIVE=$incon"
if [ "$fail" -eq 0 ]; then
  if [ "$incon" -gt 0 ]; then echo "SMS_LOGIN_GATE: PASS_WITH_INCONCLUSIVE"; else echo "SMS_LOGIN_GATE: PASS"; fi
  exit 0
else
  echo "SMS_LOGIN_GATE: FAIL"; exit 1
fi
