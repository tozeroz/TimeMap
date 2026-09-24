#!/usr/bin/env bash
# 机械核验 native picker E2E 的"声称"（不需要重跑 E2E，只检查它留下的产物与库状态）
#
# 为什么写这个：
#   子代理会汇报 NATIVE_FILE_PICKER_INTERACTION 的结论。若我逐项手查，
#   会消耗大量上下文；更重要的是——**手查不可复现**。
#   把它变成脚本后：① 我一条命令跑完 ② 任何人都能重跑 ③ 结论与产物绑定。
#
# 核验四项：
#   a) picker 是否真的出现：证据里应能找到 PickActivity / documentsui
#   b) 是否真的在 picker 里点了图（**运行时**无 setFileInputFiles 痕迹）
#   c) 清理是否回到基线（对着 docs/m5/evidence/db-counts-before-picker-e2e.txt 比）
#   d) 0 字节的 dump 是否被解释（不能只有产物没有说明）
#
# 用法（服务器上，脚本与仓库副本都在 /tmp）：
#   bash /tmp/verify-picker-e2e-claims.sh <E2E证据目录> <E2E报告文件>
# 例：
#   bash /tmp/verify-picker-e2e-claims.sh /tmp/m5repo/docs/m5/evidence /tmp/m5repo/docs/m5/PICKER-E2E-RESULT.md
set -u
EVID="${1:-/tmp/m5repo/docs/m5/evidence}"
REPORT="${2:-}"

PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

echo "=== a) picker 是否真的出现（证据里应有 PickActivity / documentsui）==="
HITS=0
if [ -d "$EVID" ]; then
  HITS=$(grep -rl 'documentsui' "$EVID" 2>/dev/null | wc -l | tr -d ' ')
  NODES=$(grep -rho 'com\.android\.documentsui:id/[a-z_]*' "$EVID" 2>/dev/null | sort -u | wc -l | tr -d ' ')
  echo "  含 documentsui 的证据文件: $HITS 个；去重控件 id: $NODES 个"
  if [ "$HITS" -ge 1 ] && [ "$NODES" -ge 3 ]; then ok "picker 控件树确实被采到"; else bad "证据里 documentsui 内容不足"; fi
else
  bad "证据目录不存在：$EVID"
fi

echo
echo "=== b) 运行时是否用了捷径（setFileInputFiles）==="
# 注意：脚本**注释里**说明"不碰 setFileInputFiles"是允许的；
# 这里检查的是**证据/日志**里有没有实际调用痕迹，两者不同。
TRACE=0
if [ -d "$EVID" ]; then
  TRACE=$(grep -rl 'setFileInputFiles' "$EVID" 2>/dev/null | wc -l | tr -d ' ')
fi
if [ "$TRACE" -eq 0 ]; then
  ok "证据里没有 setFileInputFiles 痕迹（未被捷径污染）"
else
  bad "证据里有 $TRACE 个文件提到 setFileInputFiles —— 需确认是注释还是**实际调用**"
fi

echo
echo "=== c) 库是否回到基线（对照 19:09:46 的快照）==="
# 基线（E2E 之前）：messages 4 / media 7 / message_media 1 / users 10
# 基线已更正为**纯种子基线**（2026-09-21 19:31 清理后；此前那份 users=10/messages=4 是**被污染的基线**）declare -A BASE=([messages]=2 [media]=2 [message_media]=0 [users]=3)
for T in messages media message_media users; do
  NOW=$(PSQL "select count(*) from $T")
  WANT="${BASE[$T]}"
  # users 允许 10（用种子用户）或 11（建了新账号但**未清**则应报 FAIL）
  if [ "$T" = "users" ]; then
    if [ "$NOW" -le 10 ]; then ok "users=$NOW（基线 10，未新增或已清）"; else bad "users=$NOW > 基线 10 —— 似有未清理的测试账号"; fi
  else
    if [ "$NOW" -le "$WANT" ]; then ok "$T=$NOW（基线 $WANT，未超）"; else bad "$T=$NOW > 基线 $WANT —— 似有残留未清"; fi
  fi
done
echo "  （参考基线：users 10 / sessions 121 / challenges 99 / messages 4 / media 7 / board_notes 2）"
echo "   sessions=$(PSQL 'select count(*) from sessions')  challenges=$(PSQL 'select count(*) from login_challenges')"
echo "   ↑ 这两项每次登录都会增加，**属正常**，不判 FAIL"

echo
echo "=== c2) 盘库一致性（orphan / unattached 应为空）==="
if [ -f /srv/campus/server/dist/cleanup.mjs ]; then
  CD=$(cd /srv/campus/server && UPLOAD_ROOT=/srv/campus/uploads \
    DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" \
    node dist/cleanup.mjs --json 2>&1 | head -c 400)
  echo "  $CD"
  if printf '%s' "$CD" | grep -q '"orphans":\[\]' && printf '%s' "$CD" | grep -q '"unattached":\[\]'; then
    ok "无 orphan / unattached"
  else
    bad "有 orphan 或 unattached 残留"
  fi
else
  echo "  （未部署 cleanup.mjs，跳过）"
fi

echo
echo "=== d) 0 字节 dump 是否被解释（报告里应有说明）==="
ZERO=$(find "$EVID" -type f -size 0 2>/dev/null | wc -l | tr -d ' ')
echo "  证据目录里 0 字节文件: $ZERO 个"
if [ "$ZERO" -eq 0 ]; then
  ok "没有 0 字节产物（不存在此问题）"
elif [ -n "$REPORT" ] && [ -f "$REPORT" ]; then
  if grep -qE '0 字节|空 dump|第一次.*空|empty' "$REPORT"; then
    ok "报告解释了 0 字节产物"
  else
    bad "有 $ZERO 个 0 字节产物但报告未解释 —— 读者可能误以为所有 dump 都成功"
  fi
else
  bad "有 $ZERO 个 0 字节产物，但未提供报告文件供检查"
fi

echo
echo "PICKER_E2E_CLAIMS_RESULT: $([ "$FAILED" -eq 0 ] && echo PASS || echo FAIL)"
exit "$FAILED"
