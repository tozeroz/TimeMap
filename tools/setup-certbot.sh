#!/usr/bin/env bash
# 安装 certbot（>=5.4，需要 --ip-address + --preferwebroot 支持）到 /opt/certbot
# ⚠️ 为什么不用 apt：Ubuntu 26.04 仓库里的 certbot 是 4.0.0，**不支持 IP 证书**（需 >=5.4）。
# ⚠️ 为什么不用 snap：本项目在境内服务器，snap 拉取常慢/不稳；venv 可控且可复现。
set -uo pipefail

echo "=== 1) 确保 python3-venv 可用（venv 需要 ensurepip）==="
if ! python3 -c 'import ensurepip' 2>/dev/null; then
  echo "  ensurepip 缺失 ⇒ 安装 python3.14-venv"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3.14-venv 2>&1 | tail -3 | sed 's/^/    /'
else
  echo "  ensurepip 已有"
fi

echo
echo "=== 2) 清理可能残留的失败 venv ==="
if [ -d /opt/certbot ]; then
  echo "  删除旧的 /opt/certbot"
  rm -rf /opt/certbot
fi

echo
echo "=== 3) 创建 venv 并安装 certbot ==="
python3 -m venv /opt/certbot 2>&1 | sed 's/^/  /'
/opt/certbot/bin/pip install -q --upgrade pip 2>&1 | tail -2 | sed 's/^/  /'
/opt/certbot/bin/pip install -q certbot 2>&1 | tail -3 | sed 's/^/  /'

echo
echo "=== 4) 版本（⚠️ 需要 >= 5.4）==="
/opt/certbot/bin/certbot --version 2>&1 | sed 's/^/  /'

echo
echo "=== 5) 确认支持我们需要的开关 ==="
/opt/certbot/bin/certbot --help all 2>/dev/null \
  | grep -E -- '--ip-address|--preferred-profile|--webroot-path|--deploy-hook' \
  | head -8 | sed 's/^/  /'

echo
echo "=== 6) 建一个可写目录给 ACME 挑战用 ==="
install -d -m 0755 -o www-data -g www-data /var/www/certbot 2>/dev/null \
  || install -d -m 0755 /var/www/certbot
ls -ld /var/www/certbot | sed 's/^/  /'
