#!/usr/bin/env bash
# 轮询前台活动，直到系统选择器（或指定的活动）真的成为前台，或超时。
#
# 为什么必须轮询 dumpsys 而不是"点完等 2 秒然后 dump"：
#   am start / 点击 之后的活动切换是异步的，固定 sleep 要么等太久、
#   要么在慢的一次上误判"没出现"。而且本项目已经栽过一次 ——
#   `am start` 打印 "Starting" 并不代表活动真起来了，
#   所以判据只能是 **topResumedActivity 这一行原文**。
#
# 用法：bash scripts/m5/wait-for-picker.sh [期望的活动子串] [超时秒数]
set -u
ADB='/g/Program Files/Netease/MuMu/nx_main/adb.exe'
SERIAL='127.0.0.1:16384'
NEEDLE="${1:-com.android.documentsui/.picker.PickActivity}"
TIMEOUT="${2:-45}"
i=0
while [ "$i" -lt "$TIMEOUT" ]; do
  LINE="$("$ADB" -s "$SERIAL" shell dumpsys activity activities 2>/dev/null | grep -m1 'topResumedActivity' | tr -d '\r')"
  printf '%s [%02ds] %s\n' "$(date +%H:%M:%S)" "$i" "$LINE"
  case "$LINE" in
    *"$NEEDLE"*)
      echo "PICKER_APPEARED_AFTER=${i}s"
      echo "TOP_RESUMED_VERBATIM=${LINE}"
      exit 0
      ;;
  esac
  i=$((i + 1))
  sleep 1
done
echo "PICKER_TIMEOUT after ${TIMEOUT}s（期望子串：${NEEDLE}）"
exit 1
