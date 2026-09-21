<#
  M1 部署：把本地打好的后端单文件包推上服务器并切换 systemd。
  用法： & '.\tools\deploy-server.ps1'

  步骤：构建 → 传单文件 → 生成 server.env（用服务器上的口令） → 下发 ops → 启服务 → 冒烟测试
  幂等：重复执行只是替换文件并 restart。
#>
param(
  [switch]$SkipBuild,
  [string]$Key = '',
  [string]$Target = 'root@8.148.156.146'
)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Key) { $Key = Join-Path $root 'TimeMap.pem' }

if (-not $SkipBuild) {
  Write-Output '=== 1. 本地构建后端单文件包 ==='
  Push-Location (Join-Path $root 'server')
  pnpm build 2>&1 | Select-Object -Last 2
  Pop-Location
}

$bundle = Join-Path $root 'server\dist\index.mjs'
$seedBundle = Join-Path $root 'server\dist\seed.mjs'
$adminBundle = Join-Path $root 'server\dist\admin.mjs'
if (-not (Test-Path -LiteralPath $bundle)) { Write-Error "缺少构建产物: $bundle"; exit 2 }
if (-not (Test-Path -LiteralPath $seedBundle)) { Write-Error "缺少构建产物: $seedBundle"; exit 2 }
if (-not (Test-Path -LiteralPath $adminBundle)) { Write-Error "缺少构建产物: $adminBundle"; exit 2 }
Write-Output ("=== 2. 上传 index/seed/admin 三个包：{0:N1} / {1:N1} / {2:N1} KB ===" -f ((Get-Item $bundle).Length / 1KB), ((Get-Item $seedBundle).Length / 1KB), ((Get-Item $adminBundle).Length / 1KB))
Write-Output '    用 scp 传文件而不是命令行 base64：1.6MB 包编码后约 2MB，超过 Windows 32767 字符的命令行上限'
& scp -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes $bundle "${Target}:/tmp/campus-backend-index.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp 失败（index bundle）'; exit 1 }
& scp -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes $seedBundle "${Target}:/tmp/campus-seed.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp 失败（seed bundle）'; exit 1 }
& scp -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes $adminBundle "${Target}:/tmp/campus-admin.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp 失败（admin bundle）'; exit 1 }

$sh = @'
set -euo pipefail
echo "== 安装后端包 =="
install -o campus -g campus -m 0750 /tmp/campus-backend-index.mjs /srv/campus/server/dist/index.mjs
install -o campus -g campus -m 0750 /tmp/campus-seed.mjs /srv/campus/server/dist/seed.mjs
install -o campus -g campus -m 0750 /tmp/campus-admin.mjs /srv/campus/server/dist/admin.mjs
rm -f /tmp/campus-backend-index.mjs /tmp/campus-seed.mjs /tmp/campus-admin.mjs
ls -l /srv/campus/server/dist/

echo "== 生成 server.env（口令与密钥来自服务器本地，不进 git）=="
DB_PASS="$(cat /srv/campus/.db_password)"
umask 077

# 验证码 HMAC 密钥：首次部署时生成，之后复用（换了密钥会让已发出的验证码全部失效，
# 但更重要的是避免每次部署都轮换 —— 轮换应当是一次有意识的运维动作）。
KEY_FILE=/srv/campus/.login_code_hmac_key
if [ ! -s "$KEY_FILE" ]; then
  # 用 /dev/urandom，不用 pwgen/openssl 之类的外部命令
  head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-64 > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "  已生成新的 LOGIN_CODE_HMAC_KEY（$KEY_FILE）"
else
  echo "  复用已有 LOGIN_CODE_HMAC_KEY"
fi
H_KEY="$(cat "$KEY_FILE")"

# dev sink：优先 /run（tmpfs，重启即清）。**验证码只投递到这里，绝不进日志。**
SINK_DIR=/run/campus/login-codes
mkdir -p "$SINK_DIR"
chown campus:campus /run/campus /run/campus/login-codes
chmod 700 /run/campus/login-codes

{
  printf 'DATABASE_URL=postgresql://campus:%s@127.0.0.1:5432/campus\n' "$DB_PASS"
  printf 'LOGIN_CODE_HMAC_KEY=%s\n' "$H_KEY"
  printf 'LOGIN_CODE_SINK=%s\n' "$SINK_DIR"
} > /srv/campus/server.env
chown campus:campus /srv/campus/server.env
chmod 600 /srv/campus/server.env
echo "  server.env 已写入（内容不外显）；dev sink: $SINK_DIR"

echo "== 下发 systemd unit =="
cat > /etc/systemd/system/campus-backend.service <<'UNIT'
__UNIT__
UNIT
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/campus-backend.service && echo "  verify PASS"

echo "== 启用并启动 =="
systemctl enable campus-backend.service
systemctl restart campus-backend.service
# 固定 sleep 是不可靠的：实测这台机器上从 restart 到 listen 需要约 4-8 秒，
# sleep 3 会让后面的 curl 打到还没监听的端口，set -e 直接把脚本打断。
# 所以改成轮询等待，最长 60 秒。
# 审核记录 04 对轮询的要求：明确 timeout、非无限等待、失败时打印最后状态并输出 journal/systemctl 诊断。
for i in $(seq 1 60); do
  if curl -sf -m 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "  就绪耗时: ${i}s"
    break
  fi
  if [ "$i" = 60 ]; then
    echo "  等待 60s 仍未就绪 —— 现场信息如下"
    echo "  is-enabled: $(systemctl is-enabled campus-backend.service 2>&1)"
    echo "  is-active:  $(systemctl is-active campus-backend.service 2>&1)"
    echo "  --- systemctl status ---"
    systemctl status campus-backend.service --no-pager -n 15 2>&1 || true
    echo "  --- journalctl (last 40) ---"
    journalctl -u campus-backend.service -n 40 --no-pager 2>&1 || true
    exit 1
  fi
  sleep 1
done
echo "  is-enabled: $(systemctl is-enabled campus-backend.service)"
echo "  is-active:  $(systemctl is-active campus-backend.service)"

echo "== 冒烟测试 =="
# 每行都带 || 兜底：set -e 下任何一次 curl 非零退出都会静默中断整个脚本，
# 之前就是这样把冒烟测试截断成只剩一行输出的。
printf 'liveness  /api/health : '; curl -s -m 5 http://127.0.0.1:3001/api/health || echo -n '(失败)'; echo
printf 'readiness /api/ready  : '; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1:3001/api/ready || echo -n '(失败)'; echo
printf 'edge      /health     : '; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1/health || echo -n '(失败)'; echo
printf 'via nginx /api/health : '; curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1/api/health || echo -n '(失败)'; echo
printf 'list      /api/posts  : '; curl -s -m 5 http://127.0.0.1/api/posts || echo -n '(失败)'; echo
echo "== CORS（APK WebView 来源 https://localhost）=="
curl -s -m 5 -D - -o /dev/null -H 'Origin: https://localhost' http://127.0.0.1/api/health 2>/dev/null | grep -iE 'access-control|vary' || echo '  (未返回 CORS 头)'
echo "== CORS 负例（非白名单来源不应回显 allow-origin）=="
if curl -s -m 5 -D - -o /dev/null -H 'Origin: https://evil.example' http://127.0.0.1/api/health 2>/dev/null | grep -qi 'access-control-allow-origin'; then
  echo '  FAIL: 非白名单来源拿到了 allow-origin'
else
  echo '  PASS: 非白名单来源没有 allow-origin'
fi
echo "== 监听端口 =="
ss -lntp | grep -E ':80|:3001' || true
echo "== 最近日志 =="
journalctl -u campus-backend.service -n 15 --no-pager
'@

# 必须按 UTF-8 读：PS 5.1 的 Get-Content 默认按 ANSI 解码，中文注释会被读坏并可能吃掉换行，
# 把 "[Unit]" 并进上一行注释，导致整个 section 头消失（线上表现为 systemd 报
# "Assignment outside of section"）。这个坑已经踩过一次。
$unit = [IO.File]::ReadAllText((Join-Path $root 'ops\systemd\campus-backend.service'), [Text.Encoding]::UTF8)
$sh = $sh.Replace('__UNIT__', $unit.TrimEnd())

$enc = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh))
& ssh -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes $Target "echo '$enc' | base64 -d | bash"
exit $LASTEXITCODE
