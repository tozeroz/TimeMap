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
# ⚠️ 这是**本 Gate 唯一会改动共享运行态**的一步（重启服务 + 删 uploads/.tmp）。
#    因此它必须：(a) 等**真的就绪**而不是猜一个固定秒数；(b) 明确宣告副作用。
#    【2026-09-22 修正】原来是 `sleep 5` + 只看 `systemctl is-active`：
#      · `is-active` 在**进程刚起来**就是 active，**不代表能服务请求**（还要连上 PG、跑完迁移检查）；
#      · 固定 5s 是**猜**出来的，机器慢一点就不够。
#    后果：本步之后紧接着的段（第 4 节起要**做登录**）可能撞上"服务还没就绪"的窗口 →
#      表现为**间歇性**的 "FAIL 登录失败"，而单独跑同一脚本却 PASS。
#      （这正是本项目此前那处"未复现、未定位"故障的**同一类机制**；见
#       scripts/m5/capture-login-failure-forensics.sh 与 README 的抓现场说明。）
#    → 改为轮询 /api/ready 直至 200，最多 30s；超时则**显式 FAIL 并打印现场**，
#      而不是让后续段去承担一个含糊的失败。
echo "  副作用声明：本步会重启 $SVC 并删除 $UP/.tmp（会打断此刻在飞的请求）"
systemctl restart "$SVC" || { echo "  FAIL 重启失败"; exit 1; }

READY_OK=0
for i in $(seq 1 30); do
  RC="$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready 2>/dev/null || echo 000)"
  if [ "$RC" = "200" ]; then READY_OK=1; echo "  就绪：/api/ready=200（等待 ${i}s）"; break; fi
  sleep 1
done
if [ "$READY_OK" != "1" ]; then
  # ⚠️ 必须用 `ABORT` 开头 —— gate-m5.sh 对本段输出做了**过滤**：
  #      printf '%s\n' "$TH_OUT" | grep -E '^(SELF_HEAL|ABORT)'
  #    只保留以 SELF_HEAL 或 ABORT 开头的行。若这里用普通 "  FAIL ..." 开头，
  #    失败时会**只剩一条 M5_TMP_SELFHEAL FAIL、看不到原因** —— 那等于把诊断信息丢掉。
  #    （这个过滤是我这次加就绪轮询时才发现的：新加的"副作用声明/就绪"两行明明执行了却没出现在报告里。）
  echo "ABORT 重启后 30s 内未就绪（/api/ready 最后为 $RC）"
  echo "  --- 现场 ---"
  systemctl is-active "$SVC" 2>&1 | sed 's/^/    /'
  journalctl -u "$SVC" -n 30 --no-pager 2>&1 | tail -20 | sed 's/^/    /'
  exit 1
fi
echo "  active=$(systemctl is-active $SVC)"
# 同样用 ABORT 前缀之外的一行把"就绪耗时"带进报告不方便（会被过滤），
# 因此把就绪信息并入 SELF_HEAL 行输出（见文件末尾），这里只在 journal 里留痕。
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
