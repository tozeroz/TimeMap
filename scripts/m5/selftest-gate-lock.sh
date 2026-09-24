#!/usr/bin/env bash
# 测试：Gate 互斥锁在"锁被占用"与"陈旧锁"两种情形下的行为（服务器侧）
set -uo pipefail
LOCK=/srv/campus/gate.lock

echo "=== 1) 造一个**新鲜的**他人锁 → run-gate.sh 必须拒绝（exit 3）==="
printf 'other-gate|999999|%s|otherhost\n' "$(date +%s)" > "$LOCK"
bash /tmp/run-gate.sh /tmp/should-not-run.txt 2>&1 | head -5 | sed 's/^/  /'
RC="${PIPESTATUS[0]}"
echo "  （上面若出现 REAL_EXIT=3 即为正确拒绝）"
echo "  --- 确认它**没有**真的跑 gate（输出文件不应存在）---"
if [ -f /tmp/should-not-run.txt ]; then echo "  FAIL 竟产生了输出文件"; else echo "  OK 未运行 gate"; fi

echo
echo "=== 2) 造一个**陈旧**锁（31 分钟前）→ 应抢占并正常跑 ==="
printf 'stale-gate|999999|1|somehost\n' > "$LOCK"
touch -d '31 minutes ago' "$LOCK"
bash /tmp/run-gate.sh /tmp/gate-wo12b.txt 2>&1 | head -8 | sed 's/^/  /'

echo
echo "=== 3) 跑完后锁应已释放（trap EXIT）==="
if [ -f "$LOCK" ]; then echo "  FAIL 锁仍在：$(cat $LOCK)"; else echo "  OK 锁已释放"; fi

echo
echo "=== 4) gate 结果 ==="
grep -a -E 'M5_SERVER_GATE_RESULT|PERSISTENT|STAGE|REGRESSION' /tmp/gate-wo12b.txt 2>/dev/null | head -6 | sed 's/^/  /'
echo
echo "=== 5) TMP selfheal 段的就绪轮询是否生效 ==="
grep -a -A3 '重启' /tmp/gate-wo12b.txt 2>/dev/null | head -8 | sed 's/^/  /'
grep -a -E '就绪：/api/ready|副作用声明' /tmp/gate-wo12b.txt 2>/dev/null | sed 's/^/  /'
