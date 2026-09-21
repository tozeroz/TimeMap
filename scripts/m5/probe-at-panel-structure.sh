#!/usr/bin/env bash
# 核对 @所有人 与 AT 面板的结构证据（这两项此前被我方判为"设计决定：不做"，理由是缺证据）
set -u
AAPT2='G:\android-sdk\build-tools\35.0.0\aapt2.exe'
APK='G:\demo map\.mumu-capture\apk\target.apk'
DUMP=/tmp/arsc-at.txt
"$AAPT2" dump resources "$APK" > "$DUMP" 2>&1

echo "=== 1) AT 面板相关文案（资源名 → 文案，精确归属）==="
for r in string/at_all string/at_panel_empty string/at_panel_loading_failed string/at_panel_title; do
  awk -v pat="resource [0-9a-fx]+ $r\$" '
    $0 ~ pat {print "  " $0; getline; print "    " $0; exit}
  ' "$DUMP"
done

echo
echo "=== 2) AT 面板布局的混淆路径 ==="
for r in layout/activity_group_at_panel layout/item_at_panel_at_all layout/item_at_panel_member layout/item_at_panel_section_header; do
  echo "  --- $r ---"
  grep -A1 "resource [0-9a-fx]* $r\$" "$DUMP" | head -2 | sed 's/^/    /'
done

echo
echo "=== 3) AT 面板相关的 id（先看声明了哪些控件）==="
grep -E '^ *resource 0x[0-9a-f]+ id/.*(at_|atPanel|at_panel|mention)' "$DUMP" | head -20 | sed 's/^/  /'

echo
echo "=== 4) 媒体预览相关 id 与布局 ==="
grep -E '^ *resource 0x[0-9a-f]+ id/(im_image_preview|photo_view|chat_media_preview)' "$DUMP" | sed 's/^/  /'
grep -E '^ *resource 0x[0-9a-f]+ layout/(activity_image_preview|chat_image_preview_bottom_bar|activity_single_image_preview)' "$DUMP" | sed 's/^/  /'
