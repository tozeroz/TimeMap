#!/usr/bin/env bash
echo "== status =="
systemctl is-enabled campus-backend.service; systemctl is-active campus-backend.service
systemctl status campus-backend.service --no-pager -l | head -12
echo
echo "== 端口 =="
ss -lntp | grep -E ':80|:3001' || echo "  3001 未监听"
echo
echo "== 日志尾部 =="
journalctl -u campus-backend.service -n 20 --no-pager
echo
echo "== 逐个 curl（不用 set -e，避免一个失败就中断）=="
echo -n "  3001/api/health : "; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1:3001/api/health; echo
echo -n "  3001/api/ready  : "; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1:3001/api/ready; echo
echo -n "  80/health       : "; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1/health; echo
echo -n "  80/api/health   : "; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1/api/health; echo
echo -n "  80/api/ready    : "; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1/api/ready; echo
echo -n "  80/api/posts    : "; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1/api/posts; echo
