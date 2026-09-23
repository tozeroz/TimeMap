#!/usr/bin/env bash
# 恢复短信投递（在 sms-off-for-webtest.sh 之后**必须**运行）
#
# ⚠️ 这个脚本存在的意义就是"保证恢复"：临时关闭短信是为了做网页端登录测试，
#    但它会让真实用户暂时收不到验证码。所以恢复必须是一步到位的命令，
#    而不是靠我记着手工改回去。
set -uo pipefail

OP=/srv/campus/operator.env
BAK=/srv/campus/operator.env.bak.prewebtest

echo "=== 1) 校验备份存在 ==="
if [ ! -f "$BAK" ]; then
  echo "  ✗ 找不到备份 $BAK ⇒ 无法确认原值，**不要**手写猜测，请人工处理"
  exit 1
fi

echo "=== 2) 恢复 operator.env ==="
cp -a "$BAK" "$OP"
rm -f "$BAK"
echo "  已恢复，并删除备份"
grep -E '^ALIYUN_SMS' "$OP" | sed 's/=.*/=***（值存在）/' | sed 's/^/    /'

echo
echo "=== 3) 检查是否真的非空（空值等于没恢复）==="
EMPTY=$(grep -cE '^ALIYUN_SMS_[A-Z_]+=$' "$OP" || true)
if [ "$EMPTY" -gt 0 ]; then
  echo "  ✗ 仍有 $EMPTY 个 ALIYUN_SMS_* 是空值 ⇒ **恢复不完整**"
  exit 1
fi
echo "  ✓ 四个键都有值"

echo
echo "=== 4) 重启后端 ==="
systemctl restart campus-backend.service
sleep 4
systemctl is-active campus-backend.service | sed 's/^/  active: /'

echo
echo "=== 5) ⭐ 决定性确认：启动日志必须说'已配置' ==="
journalctl -u campus-backend.service --no-pager -n 30 2>/dev/null | grep -iE '\[sms\]' | tail -3 | sed 's/^/  /'
if journalctl -u campus-backend.service --no-pager -n 30 2>/dev/null | grep -iE '\[sms\]' | tail -3 | grep -q '已配置'; then
  echo "  ✓ 短信已恢复为'已配置'状态"
else
  echo "  ✗ 没看到'已配置' ⇒ 短信可能仍未生效，请人工确认"
  exit 1
fi

echo
echo "=== 6) 顺带确认其他功能没被重启影响 ==="
printf '  /api/health : '; curl -s -o /dev/null -m 10 -w '%{http_code}\n' http://127.0.0.1/api/health
printf '  /api/ready  : '; curl -s -o /dev/null -m 10 -w '%{http_code}\n' http://127.0.0.1/api/ready
