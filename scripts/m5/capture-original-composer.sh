#!/usr/bin/env bash
# G2.1：原版群聊 composer —— **目标明确的只读采集**（审核记录 41 要求的第 ② 步）
#
# ## 合规边界（逐条写清，避免越界）
#   · 允许：拉起原版 App、点击纯导航（消息列表 → 群聊）、点击**只展开面板**的按钮（表情 / +）、
#           截图、uiautomator dump
#   · 禁止（一律不执行）：发消息、发图、发语音、点赞、改资料、建群、注销 等一切写操作
#   · 本次**不输入任何文字**、**不点发送**、**不选任何媒体**
#
# ## 关于"进入会话是否算写"的判断（如实记录）
#   进入会话页在多数 IM 里会触发"标记已读"（一次服务端写）。
#   本群 `GroupForEvidence(1)` 的 2 条消息**全部由本账号自己发出**
#   （出处：docs/test/original-baseline/screens/original-chat/INDEX.md 〇节 + POLICY-VIOLATION 文档），
#   因此"把自己发的消息标记为已读"在语义上是**空操作**（没有第二方的已读状态会因此改变）。
#   ⚠ 这是**判断**不是**证明**：我无法只读地观测"服务端是否收到了一次已读上报"。
#     若审核认为这一点仍不可接受，应记为 BLOCKED_BY_POLICY 并停止本条采集 —— 请裁定。
#
# ## 为什么需要这次采集
#   已有 dump 显示原版群聊 composer 只有 [输入框][表情][加号] 三个控件、**没有麦克风按钮**；
#   但原版资源表里存在 im_chat_voice_layout / im_chat_voice_ic / im_chat_record_error
#   → **原版录音入口的位置尚未由行为证据确定**（按纪律不得据资源名推断）。
#   逐级做法：点"+"看面板内容；点表情看面板内容；观察 composer 是否出现"键盘/语音"两态切换。
set -u
ADB='G:\Program Files\Netease\MuMu\nx_main\adb.exe'
SERIAL='127.0.0.1:16384'
OUTDIR='G:\demo map\docs\test\original-baseline\screens\original-composer'
PKG='com.kairuotu.campus'

mkdir -p "$OUTDIR"
TS="$(date +%Y%m%d-%H%M%S)"
echo "=== 采集批次: $TS ==="

shot() { # $1 = 名称
  local name="$1"
  # 用 screencap 写设备端再 pull：**不要**用 shell 重定向（PowerShell 会破坏二进制）
  "$ADB" -s "$SERIAL" shell screencap -p "/sdcard/oc-$name.png" >/dev/null 2>&1
  "$ADB" -s "$SERIAL" pull "/sdcard/oc-$name.png" "$OUTDIR/$TS-$name.png" >/dev/null 2>&1
  "$ADB" -s "$SERIAL" shell uiautomator dump "/sdcard/oc-$name.xml" >/dev/null 2>&1
  "$ADB" -s "$SERIAL" pull "/sdcard/oc-$name.xml" "$OUTDIR/$TS-$name.xml" >/dev/null 2>&1
  local focus
  focus="$("$ADB" -s "$SERIAL" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r')"
  echo "  [$name] focus: $focus"
  if echo "$focus" | grep -q "$PKG"; then
    echo "         VISUAL_TARGET_VALIDITY: PASS (foreground is $PKG)"
  else
    echo "         VISUAL_TARGET_VALIDITY: **FAIL** -> 本帧证据作废！"
  fi
}

echo
echo "--- 0) 前置：把原版带到前台（am start，不做 force-stop）---"
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 4
shot "00-before"

echo
echo "--- 1) 回到消息列表（若已在会话页先返回）---"
# 连按两次返回：会话页 → 消息列表。返回键是纯导航，不产生写入。
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_BACK >/dev/null 2>&1
sleep 1
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_BACK >/dev/null 2>&1
sleep 2
shot "01-after-back"

echo
echo "--- 2) 用 dump 找到群聊会话项并点进（纯导航）---"
"$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/tmpnav.xml >/dev/null 2>&1
"$ADB" -s "$SERIAL" pull /sdcard/tmpnav.xml /tmp/tmpnav.xml >/dev/null 2>&1
COORD="$(python3 - <<'PY'
import re, sys
try:
    x = open('/tmp/tmpnav.xml', encoding='utf-8', errors='replace').read()
except Exception:
    print(''); sys.exit(0)
# 找含 "GroupForEvidence" 的节点，取其中点坐标
best = None
for m in re.finditer(r'<node[^>]*>', x):
    tag = m.group(0)
    if 'GroupForEvidence' in tag:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            best = ((x1 + x2) // 2, (y1 + y2) // 2)
            break
print(f'{best[0]} {best[1]}' if best else '')
PY
)"
if [ -n "$COORD" ]; then
  echo "  找到会话项，点击 ($COORD)"
  "$ADB" -s "$SERIAL" shell input tap $COORD >/dev/null 2>&1
  sleep 3
  shot "02-chat-open"
else
  echo "  ⚠️ 当前页面里找不到 GroupForEvidence —— 记录当前页，人工判断入口"
  shot "02-not-found"
fi

echo
echo "--- 3) 点「+」按钮（只展开面板，不选任何项）---"
# + 的坐标来自已有 dump：x=[968,1024] y=[1818,1874] → 中点 (996, 1846)
"$ADB" -s "$SERIAL" shell input tap 996 1846 >/dev/null 2>&1
sleep 2
shot "03-plus-panel"

echo
echo "--- 4) 关闭面板并点表情按钮（只展开面板）---"
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_BACK >/dev/null 2>&1
sleep 1
"$ADB" -s "$SERIAL" shell input tap 923 1846 >/dev/null 2>&1   # emojiBtn 中点 (923,1846)
sleep 2
shot "04-emoji-panel"

echo
echo "--- 5) 收尾：关闭面板，停在原版页面（不改变任何会话内容）---"
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_BACK >/dev/null 2>&1
sleep 1
shot "05-final"

echo
echo "=== 产物（$OUTDIR）==="
ls -1 "$OUTDIR" | grep "^$TS" | sed 's/^/  /'
echo
echo "⚠️ 本次采集**未**输入文字、**未**点发送、**未**选任何媒体。"
