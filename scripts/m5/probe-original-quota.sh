#!/usr/bin/env bash
# G3.2 前提取证：原版是否有 per-user 配额 / 上传限制？
#
# ## 方法与声明强度（严格写清，避免夸大）
#   方法：**只读**扫描原版 APK 的资源表与字符串表里与"配额/限制/上限/大小"相关的名字与文案。
#   证明强度：
#     · 命中 → 是"**存在该机制**"的证据（仍不等于"在当前账号/当前场景下会触发"）
#     · 未命中 → 只能说明"没有这些明显命名的资源/文案"，
#               **不等于**原版没有配额（可能是服务端策略、无 UI 文案、或命名不可猜测）
#   → 因此本扫描**不足以**单独判定 (D) 类"per-user 配额"是否为真实缺口。
#     它的用途是：给出**可复现的第一步**，把"完全不知道"变成"知道了哪些命名不存在"。
set -u
AAPT2='G:\android-sdk\build-tools\35.0.0\aapt2.exe'
APK='G:\demo map\.mumu-capture\apk\target.apk'
DUMP=/tmp/arsc-quota.txt
"$AAPT2" dump resources "$APK" > "$DUMP" 2>&1
echo "资源表 dump: $(wc -l < "$DUMP") 行"
echo

echo "=== 1) 资源**名字**里的配额/限制线索 ==="
for kw in quota limit maxcount max_count storage space capacity exceed overflow \
          insufficient 'too_large' too_big oversize upload_limit file_limit \
          remain_count left_count daily_limit month_limit; do
  n="$(grep -c -i "$kw" "$DUMP" || true)"
  if [ "$n" != "0" ]; then
    echo "  [$kw] 命中 $n 条，前 6 条："
    grep -i "$kw" "$DUMP" | head -6 | sed 's/^/      /'
  fi
done

echo
echo "=== 2) 资源**文案**里的配额/限制线索（中文关键词）==="
# aapt2 的 dump 会把字符串字面量打出来，直接在其中搜中文
for kw in 配额 上限 达到 限制 不足 超出 超出限制 空间不足 上限为 最多 每天 次数 已满 剩余; do
  n="$(grep -c "$kw" "$DUMP" || true)"
  if [ "$n" != "0" ]; then
    echo "  [$kw] 命中 $n 条，前 5 条："
    grep -n "$kw" "$DUMP" | head -5 | sed 's/^/      /'
  fi
done

echo
echo "=== 3) 与"上传/媒体"相关的限制类字符串（英文文案）==="
grep -n -i -E '"(upload|image|photo|media|file)[^"]{0,40}(limit|max|full|exceed|large)' "$DUMP" | head -10 | sed 's/^/  /'

echo
echo "=== 4) 判定 ==="
echo "  ⚠️ 无论命中与否，本扫描都**不能**单独证明原版有无 per-user 配额："
echo "     · 命中的是"存在该资源/文案"的证据，不等于"当前会触发""
echo "     · 未命中只说明"没有这些明显命名的资源/文案""
echo "  → 结论一律记为：PER_USER_QUOTA_CONFORMANCE = EVIDENCE_NOT_OBTAINABLE_BY_CURRENT_METHODS"
echo "     （除非将来从**行为侧**拿到只读可复现的证据，例如界面明确显示配额数字）"
