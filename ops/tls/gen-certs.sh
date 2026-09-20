#!/usr/bin/env bash
#
# 生成「临时私有 CA + 服务器叶子证书」（M2 的最小 TLS 前置条件）。
#
# 为什么是这个结构（审核记录 05 定稿）：
#   1. **信任链与主机身份校验是两道独立检查**。光把证书配成 App 的 trust-anchor，
#      HTTPS 仍然会校验证书里的地址是否与请求的地址匹配 —— 绕不过去，
#      也绝不允许用 always-true 的 HostnameVerifier 去绕（那是自废 MITM 防护）。
#   2. 请求的地址是 IP，所以叶子证书的 SAN 必须是 **iPAddress 类型**：
#          subjectAltName = IP:8.148.156.146
#      写成 DNS:8.148.156.146 或只放 CN 都会校验失败。
#   3. 用「私有 CA 签发叶子」而不是「直接钉一张自签叶子」：
#      叶子到期或轮换时，App 里内置的 CA 不用换，也就不必重新发 APK。
#
# 本脚本只负责生成；证书路径与 Nginx 配置见 ops/nginx/campus.conf。
# CA 公钥证书（ca.crt）需要内置进 APK：app/android/app/src/main/res/raw/campus_demo_ca.crt
# 私钥（ca.key / server.key）**只留在服务器**，绝不进仓库（.gitignore 已忽略 *.key / *.pem）。
#
# 用法（在服务器上，root）：bash gen-certs.sh
set -euo pipefail

DIR=/etc/ssl/campus
IP="${1:-8.148.156.146}"

mkdir -p "$DIR"
chmod 700 "$DIR"

echo "== 目录: $DIR  目标 IP: $IP =="

# ---------- 私有 Root CA ----------
if [ -f "$DIR/ca.key" ]; then
  echo "-- CA 已存在，复用（避免重复生成导致已发布的 APK 失效）"
else
  echo "-- 生成私有 Root CA（10 年）"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$DIR/ca.key" -out "$DIR/ca.crt" \
    -subj "/CN=Campus Demo Temporary Root CA/O=Campus Demo" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
fi

# ---------- 服务器叶子证书（SAN = IP） ----------
cat > "$DIR/leaf.ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:$IP
EOF

echo "-- 生成叶子密钥与 CSR"
openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$DIR/server.key" -out "$DIR/server.csr" \
  -subj "/CN=$IP/O=Campus Demo" 2>/dev/null

echo "-- 用私有 CA 签发叶子（825 天）"
openssl x509 -req -in "$DIR/server.csr" \
  -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial \
  -out "$DIR/server.crt" -days 825 -sha256 -extfile "$DIR/leaf.ext" 2>/dev/null

chmod 600 "$DIR/ca.key" "$DIR/server.key"
chmod 644 "$DIR/ca.crt" "$DIR/server.crt"
rm -f "$DIR/server.csr"

echo
echo "== 校验 =="
echo "-- 叶子证书的 SAN（必须看到 IP Address:$IP）"
openssl x509 -in "$DIR/server.crt" -noout -text | grep -A1 'Subject Alternative Name' | sed 's/^/   /'
echo "-- 签发者与有效期"
openssl x509 -in "$DIR/server.crt" -noout -subject -issuer -dates | sed 's/^/   /'
echo "-- 链校验（用我们的 CA 验叶子）"
if openssl verify -CAfile "$DIR/ca.crt" "$DIR/server.crt" | sed 's/^/   /'; then
  echo "   链校验通过"
else
  echo "   链校验失败"; exit 1
fi

echo
echo "== 文件 =="
ls -l "$DIR"
echo
echo "== 提示 =="
echo "   CA 公钥证书需要内置进 APK: app/android/app/src/main/res/raw/campus_demo_ca.crt"
echo "   私钥仅保留在本机，不要拷贝到任何仓库或开发机"
