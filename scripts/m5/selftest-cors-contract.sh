#!/usr/bin/env bash
# CORS 门禁的**敏感度自测**：证明 `check-cors-contract.sh` **能失败**
#
# ## 为什么必须有它（本项目的纪律）
#   一个"永远 PASS"的断言比没有断言更糟 —— 它给出虚假的安全感。
#   本项目已经踩过多次"空过断言"（例如：用 `grep` 匹配页面上本来就存在的文案，
#   导致断言恒真；或 `grep -c` 的退出码语义让整列恒 yes）。
#   所以**每新增一条机械门禁，都要证明它在你故意破坏时会红**。
#
# ## 三种受控破坏（都不改服务端、可重复）
#   ① 让"客户端输入"**声明**一个服务端未放行的方法（PUT）
#      → 必须报缺 PUT 并 FAIL
#   ② 要求一个**未被允许的非简单头**（x-custom-probe）
#      → 必须报 allow-headers 缺该头并 FAIL
#   ③ 换一个**非白名单 origin**（https://evil.example）
#      → 必须报 allow-origin 不对并 FAIL
#
# 用法（服务器上，需先放好 /tmp/check-cors-contract.sh 与 /tmp/client-methods-input.txt）：
#   bash selftest-cors-contract.sh
set -uo pipefail
GATE=/tmp/check-cors-contract.sh
INPUT=/tmp/client-methods-input.txt
BAK=/tmp/client-methods-input.txt.selftest-bak
FAIL=0

if [ ! -f "$GATE" ]; then echo "FATAL 缺 $GATE"; exit 2; fi
if [ ! -f "$INPUT" ]; then echo "FATAL 缺 $INPUT"; exit 2; fi

echo "=== 0) 基线：不破坏时必须 PASS ==="
BASE_OUT="$(bash "$GATE" 2>&1)"
if printf '%s' "$BASE_OUT" | grep -q 'CORS_CLIENT_METHOD_COVERAGE: PASS'; then
  echo "  PASS 基线为 PASS（否则后面的「被破坏后 FAIL」说明不了问题）"
else
  echo "  FAIL 基线不是 PASS —— 先修门禁本身，再做敏感度"
  printf '%s' "$BASE_OUT" | tail -5 | sed 's/^/    /'
  exit 1
fi

echo
echo "=== ① 破坏：客户端「声明」PUT（服务端未放行）→ 必须 FAIL ==="
cp "$INPUT" "$BAK"
printf "\n  method: 'PUT',\n" >> "$INPUT"
OUT1="$(bash "$GATE" 2>&1)"
if printf '%s' "$OUT1" | grep -q 'CORS_CLIENT_METHOD_COVERAGE: FAIL'; then
  echo "  PASS 已被判 FAIL"
  printf '%s' "$OUT1" | grep -E 'PUT' | head -2 | sed 's/^/    /'
else
  echo "  FAIL 破坏了却没红 —— 该断言缺乏判别力"
  FAIL=1
fi
cp "$BAK" "$INPUT"

echo
echo "=== ② 破坏：要求未被允许的头 x-custom-probe → 必须 FAIL ==="
OUT2="$(CAMPUS_REQ_HEADERS='authorization,content-type,x-custom-probe' bash "$GATE" 2>&1)"
if printf '%s' "$OUT2" | grep -q 'CORS_CLIENT_METHOD_COVERAGE: FAIL' \
   && printf '%s' "$OUT2" | grep -q '缺头x-custom-probe'; then
  echo "  PASS 已被判 FAIL（且原因点名到具体头）"
else
  echo "  FAIL 破坏了却没红（或原因不明确）"
  printf '%s' "$OUT2" | tail -4 | sed 's/^/    /'
  FAIL=1
fi

echo
echo "=== ③ 破坏：非白名单 origin → 必须 FAIL，且原因必须指向 origin ==="
# ⚠️ 这一条是**故意写严**的：它不只要求"红了"，还要求**原因正确**。
#    因为第一版门禁逐项覆盖判定，导致 origin 不被允许时报的是"缺 content-type"——
#    红了但**指向错误的原因**，会把排查者引向错误的修改点。
OUT3="$(CAMPUS_APP_ORIGIN='https://evil.example' bash "$GATE" 2>&1)"
if printf '%s' "$OUT3" | grep -q 'CORS_CLIENT_METHOD_COVERAGE: FAIL' \
   && printf '%s' "$OUT3" | grep -q 'origin未被允许'; then
  echo "  PASS 已被判 FAIL，且原因指向 origin 未被允许"
else
  echo "  FAIL 破坏了却没红（或原因没指向 origin）"
  printf '%s' "$OUT3" | tail -4 | sed 's/^/    /'
  FAIL=1
fi

echo
echo "=== 4) 复原并再确认基线 ==="
cp "$BAK" "$INPUT"
OUT4="$(bash "$GATE" 2>&1)"
if printf '%s' "$OUT4" | grep -q 'CORS_CLIENT_METHOD_COVERAGE: PASS'; then
  echo "  PASS 复原后回到 PASS（证明三次 FAIL 都是「破坏」造成的，不是门禁坏了）"
else
  echo "  FAIL 复原后仍不是 PASS —— 自测污染了环境"
  FAIL=1
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "SELFTEST_CORS_CONTRACT: PASS（三种受控破坏全部被检出，且复原后回到 PASS）"
else
  echo "SELFTEST_CORS_CONTRACT: FAIL"
fi
exit "$FAIL"
