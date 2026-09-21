#!/usr/bin/env bash
# 验证 .tmp 启动自愈真的有效（模拟 fresh install：删掉 .tmp，重启服务，断言被重建）。
#
# ⚠ 两点踩坑记录（第三次修正后）：
#   1. 服务单元名是 campus-backend.service，**不是** campus-api.service。
#   2. 产物核验**不能用中文字符串**：esbuild 会把非 ASCII 转义成 \uXXXX，
#      于是 grep '中文' 恒为 0 → 造成"新代码没部署"的假阴性。
#      必须用 **ASCII 标记**（这里用 `uploads]`，来自日志前缀 [uploads]）做核验。
set -u
UP=/srv/campus/uploads
SVC=campus-backend.service

echo "=== 0) 产物核验（ASCII 标记；先做，避免拿旧产物下结论）==="
N=$(grep -c 'uploads\]' /srv/campus/server/dist/index.mjs || true)
echo "  产物里 'uploads]' 出现 $N 次（应 >=1，否则说明部署没生效）"
if [ "${N:-0}" -lt 1 ]; then echo "  ABORT: 产物不含新代码，自愈测试无意义"; exit 2; fi

echo
echo "=== 1) 模拟 fresh install：删掉 .tmp ==="
if [ -d "$UP/.tmp" ]; then echo "  删除前存在"; else echo "  删除前不存在"; fi
/bin/rm -rf "$UP/.tmp"
[ -d "$UP/.tmp" ] && { echo "  FAIL 删除失败"; exit 1; } || echo "  OK  .tmp 已不存在"

echo
echo "=== 2) 重启 $SVC ==="
systemctl restart "$SVC" || { echo "  FAIL 重启失败"; exit 1; }
sleep 5
echo "  active=$(systemctl is-active $SVC)"
echo "  --- journal 里 uploads 相关 ---"
journalctl -u "$SVC" -n 60 --no-pager | grep -a 'uploads' | tail -3 || echo "  (无 uploads 日志)"

echo
echo "=== 3) 断言自愈结果 ==="
if [ -d "$UP/.tmp" ]; then
  stat -c '  %A %U:%G %n' "$UP/.tmp"
  echo "SELF_HEAL_PASS  .tmp 由启动流程自动重建"
else
  echo "SELF_HEAL_FAIL  .tmp 未被重建 —— 上传会 500"
  exit 1
fi

echo
echo "=== 4) 就绪态 ==="
echo "  /api/ready = $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready)"
