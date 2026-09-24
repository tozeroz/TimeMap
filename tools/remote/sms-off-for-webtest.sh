#!/usr/bin/env bash
# 临时把短信投递切到 dev sink，以便在网页端做**真实登录流程**的自动化测试
#
# ════════════════════════════════════════════════════════════════════════════
# 为什么需要、以及为什么这是可接受的
# ════════════════════════════════════════════════════════════════════════════
#   网页端要跑完整门禁就必须先登录；而登录码现在走**真短信**，我读不到。
#   本项目后端本来就有 **dev sink** 模式（短信未配置时，把码写到
#   /run/campus/login-codes/<phone>.json）—— M0–M5 期间模拟器上的 App
#   一直是靠它登录的。⇒ 用它做网页端自动化登录，与既有实践一致。
#
#   ⚠️ 代价必须讲清楚：这个脚本会让 **request-code 暂时不再发短信**。
#      如果在窗口期有真实用户尝试登录，他收不到短信。
#      ⇒ 所以：① 窗口尽量短 ② 结束后**必须**恢复（见 restore-sms.sh）
#        ③ 不并发跑、不在白天用户活跃时跑。
#
#   ⚠️ 刻意**不改代码**、不加测试后门：只临时改配置（operator.env）并重启。
#      往生产代码里加"测试登录通道"才是真正的安全债。
set -uo pipefail

OP=/srv/campus/operator.env
BAK=/srv/campus/operator.env.bak.prewebtest

echo "=== 1) 备份 operator.env ==="
if [ -f "$BAK" ]; then
  echo "  ⚠️ 已存在备份 $BAK ⇒ 说明上次没恢复干净，先人工确认再继续"
  exit 1
fi
cp -a "$OP" "$BAK"
ls -l "$BAK" | sed 's/^/  /'
echo "  --- 当前短信相关配置（值已打码）---"
grep -E '^ALIYUN_SMS' "$OP" | sed 's/=.*/=***/' | sed 's/^/    /'

echo
echo "=== 2) 把 ALIYUN_SMS_* 置空（保留键名，便于原样恢复顺序）==="
python3 - "$OP" <<'PY'
import re, sys
p = sys.argv[1]
lines = open(p, encoding='utf-8').read().split('\n')
out = []
for ln in lines:
    if ln.startswith('ALIYUN_SMS_'):
        k = ln.split('=', 1)[0]
        out.append(f'{k}=')
    else:
        out.append(ln)
open(p, 'w', encoding='utf-8').write('\n'.join(out))
print('  已置空')
PY
grep -E '^ALIYUN_SMS' "$OP" | sed 's/^/    /'

echo
echo "=== 3) 重启后端 ==="
systemctl restart campus-backend.service
sleep 4
systemctl is-active campus-backend.service | sed 's/^/  active: /'

echo
echo "=== 4) 确认启动日志说'未配置'（即确实走了 dev sink）==="
journalctl -u campus-backend.service --no-pager -n 25 2>/dev/null | grep -iE '\[sms\]|listening|error' | tail -5 | sed 's/^/  /'

echo
echo "=== 5) 冒烟：请求一个验证码，确认 delivery=dev-sink ==="
PHONE="${1:-+8613800000001}"
RESP=$(curl -s -m 15 -X POST http://127.0.0.1/api/auth/request-code \
  -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}")
echo "  响应: $RESP"
echo "$RESP" | grep -q 'dev-sink' && echo "  ✓ 已切到 dev sink（可以开始网页端登录测试）" || echo "  ⚠️ 没看到 dev-sink，请人工确认"
echo
echo "  ⚠️⚠️ 记得测完运行：bash tools/remote/restore-sms.sh"
