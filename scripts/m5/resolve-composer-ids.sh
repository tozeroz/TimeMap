#!/usr/bin/env bash
# 解析 composer 布局（res/P9.xml）里出现的资源 ID → 真实名字
#
# 为什么必须解析（而不是猜）：本项目已 4 次栽在"用 id 名/类名推断行为"上
# （ivClose / tvTotalComment / emotion_image / collageView）。
# 这里做的是反向操作：先看**结构里实际声明了哪些控件**，再把 id 解析成名字用来**描述**它们，
# 而不是反过来用名字去推断"应该有什么"。
set -u
AAPT2='G:\android-sdk\build-tools\35.0.0\aapt2.exe'
APK='G:\demo map\.mumu-capture\apk\target.apk'

DUMP=/tmp/arsc-full.txt
"$AAPT2" dump resources "$APK" > "$DUMP" 2>&1
echo "资源表 dump: $(wc -l < "$DUMP") 行"
echo

# composer 里出现的 id（十六进制）
IDS="0x7f0a0505 0x7f0a088c 0x7f0a0364 0x7f0a019f 0x7f0a025e 0x7f0a0452 0x7f0a059d 0x7f0a059e 0x7f0a0692 0x7f0a05db 0x7f0a0744 0x7f0a0582"
echo "=== composer 里出现的 id → 名字 ==="
for id in $IDS; do
  line="$(grep -m1 "resource $id " "$DUMP" | tr -d '\r')"
  printf '  %-12s %s\n' "$id" "${line:-（未找到）}"
done

echo
echo "=== ViewStub 引用的布局 0x7f0d00da → 名字 ==="
for id in 0x7f0d00da 0x7f0d00e8 0x7f0d00dd 0x7f0d00de 0x7f0d00dc; do
  line="$(grep -m1 "resource $id " "$DUMP" | tr -d '\r')"
  printf '  %-12s %s\n' "$id" "${line:-（未找到）}"
done

echo
echo "=== composer 里出现的 drawable → 名字 ==="
for id in 0x7f080388 0x7f08039d 0x7f080610 0x7f080317; do
  line="$(grep -m1 "resource $id " "$DUMP" | tr -d '\r')"
  printf '  %-12s %s\n' "$id" "${line:-（未找到）}"
done

echo
echo "=== 字符串（hint 与 TextView text）==="
for id in 0x7f13024c 0x7f1303c3; do
  # 字符串条目通常形如：  resource 0x7f13024c string/xxx
  #                        () (string8) "...."
  line="$(grep -m1 -A2 "resource $id " "$DUMP" | tr -d '\r' | tr '\n' ' ')"
  printf '  %-12s %s\n' "$id" "$line"
done

echo
echo "=== 尺寸常量（dp）==="
for id in 0x7f070406 0x7f07040d 0x7f070423 0x7f070411 0x7f0703d0 0x7f0703d8 0x7f0703fb 0x7f070437 0x7f070415 0x7f070442 0x7f070453; do
  line="$(grep -m1 -A1 "resource $id " "$DUMP" | tr -d '\r' | tr '\n' ' ')"
  printf '  %-12s %s\n' "$id" "$line"
done
