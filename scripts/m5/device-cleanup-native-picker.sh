#!/usr/bin/env bash
# 清理**设备上**本次验证留下的临时文件。
#
# 两类：
#   1) 我推到公共目录的测试图 /sdcard/Download/m5-picker-probe-20260921.png
#      —— 不删的话它会一直出现在系统选择器的"最近/图库"里，污染后续验证。
#   2) 过程中产生的临时 dump / 截图（uiautomator dump 的 xml、screencap 的 png）
#      —— 这些不是产品数据，但留在设备上会让人分不清"哪些是证据、哪些是垃圾"。
#
# ⚠ 只删**本脚本列出的确切文件**，不用通配符扫目录（避免误删别人的东西）。
#    特别注意：**不动** /sdcard/Download/m5-wo2.png 与
#    /sdcard/Download/native-picker-*.png —— 那些是别的执行者留下的，不在本次范围内。
set -u
# ⚠ Git Bash（MSYS2）会把看起来像 Unix 路径的**参数**改写成 Windows 路径：
#   /sdcard/picker-now.xml  →  C:/Program Files/Git/sdcard/picker-now.xml
#   于是 adb 收到的是本地路径，`ls` 失败、`rm` 也就没执行（第一版就踩到了：
#   输出里"已删"一条都没有，可文件其实还在）。关掉转换即可。
export MSYS_NO_PATHCONV=1
ADB='/g/Program Files/Netease/MuMu/nx_main/adb.exe'
SERIAL='127.0.0.1:16384'

TARGETS=(
  /sdcard/Download/m5-picker-probe-20260921.png
  /sdcard/picker-now.xml
  /sdcard/picker-after-tap.xml
  /sdcard/x.xml
  /sdcard/picker-shot.png
  /sdcard/shot2.png
  /sdcard/shot3.png
  /sdcard/health-a.png
  /sdcard/health-b.png
  /sdcard/picker2.xml
)

echo "=== 删除前：Download 目录 ==="
"$ADB" -s "$SERIAL" shell ls -l /sdcard/Download/ 2>/dev/null | grep -i 'm5-picker-probe' || echo '  （没有找到本次推的测试图）'

for f in "${TARGETS[@]}"; do
  if "$ADB" -s "$SERIAL" shell ls "$f" >/dev/null 2>&1; then
    "$ADB" -s "$SERIAL" shell rm -f "$f" >/dev/null 2>&1
    echo "  已删: $f"
  fi
done

# 顺带清掉 picker dump 过程中产生的带时间戳的 xml（只匹配我们自己的前缀）
"$ADB" -s "$SERIAL" shell 'for f in /sdcard/picker-2026*.xml; do [ -e "$f" ] && rm -f "$f" && echo "  已删: $f"; done' 2>/dev/null

echo "=== 删除后：Download 目录 ==="
"$ADB" -s "$SERIAL" shell ls -l /sdcard/Download/ 2>/dev/null | grep -i 'm5' || echo '  （Download 里已无 m5-* 残留）'
echo "=== 删除后：/sdcard 下本次相关文件 ==="
"$ADB" -s "$SERIAL" shell 'ls /sdcard/ | grep -Ei "picker|shot|health|x\.xml"' 2>/dev/null || echo '  （无）'
