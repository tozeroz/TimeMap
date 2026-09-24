<#
  下发 Nginx 配置并启用 HTTPS（M2 的最小 TLS 前置条件）。
  用法： & '.\tools\deploy-nginx-tls.ps1'

  做四件事：
    1. 在服务器上生成「临时私有 CA + IP SAN 叶子证书」（幂等：CA 已存在则复用）
    2. 下发 ops/nginx/campus-locations.inc 与 ops/nginx/campus.conf，nginx -t 后 reload
    3. 本地验证 http / https 两条路径
    4. 把 CA **公钥**证书取回仓库，供 APK 内置（私钥绝不取回）

  注意：不要用 M0 时代的 tools/push-ops.ps1 —— 那个脚本会把 campus-backend
  重新 disable 掉（M0 阶段后端本就应当不存在），现在跑会把已验证的服务停掉。
#>
param(
  [string]$Key = '',
  [string]$Target = 'root@8.148.156.146'
)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Key) { $Key = Join-Path $root 'TimeMap.pem' }

function Get-B64([string]$rel) {
  $p = Join-Path $root $rel
  if (-not (Test-Path -LiteralPath $p)) { Write-Error "缺少 $p"; exit 2 }
  return [Convert]::ToBase64String([IO.File]::ReadAllBytes($p))
}

# ---------- 1. 生成证书 ----------
Write-Output '=== 1. 生成/复用 临时私有 CA + IP SAN 叶子证书 ==='
$certScript = Get-B64 'ops\tls\gen-certs.sh'
& ssh -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes `
  $Target "echo '$certScript' | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { Write-Error '证书生成失败'; exit 1 }

# ---------- 2. 下发 nginx 配置 ----------
Write-Output ''
Write-Output '=== 2. 下发 Nginx 配置并 reload ==='
$sh = @'
set -euo pipefail
mkdir -p /etc/nginx/snippets

apply() {
  target="$1"; data="$2"; tmp="$(mktemp)"
  printf '%s' "$data" | base64 -d > "$tmp"
  if [ -f "$target" ] && cmp -s "$tmp" "$target"; then
    echo "  unchanged: $target"
  else
    install -m 0644 "$tmp" "$target"
    echo "  updated:   $target"
  fi
  rm -f "$tmp"
}

apply /etc/nginx/snippets/campus-locations.inc "__B64_LOC__"
apply /etc/nginx/sites-available/campus.conf   "__B64_NGINX__"

echo "  nginx -t:"
nginx -t 2>&1 | sed 's/^/    /'
systemctl reload nginx
echo "  reloaded"
'@
$sh = $sh.Replace('__B64_LOC__', (Get-B64 'ops\nginx\campus-locations.inc'))
$sh = $sh.Replace('__B64_NGINX__', (Get-B64 'ops\nginx\campus.conf'))
$enc = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh))
& ssh -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes $Target "echo '$enc' | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { Write-Error 'nginx 配置下发失败'; exit 1 }

# ---------- 3. 服务器侧验证 ----------
Write-Output ''
Write-Output '=== 3. 服务器侧验证（http 与 https 两条路径）==='
$verify = @'
set -uo pipefail
CA=/etc/ssl/campus/ca.crt
echo "-- 叶子证书 SAN（必须是 IP Address）"
openssl x509 -in /etc/ssl/campus/server.crt -noout -text | grep -A1 'Subject Alternative Name' | sed 's/^/   /'
echo "-- 监听端口"
ss -lntp | grep -E ':80 |:443 ' | sed 's/^/   /'
echo "-- http  /health        : $(curl -s -m 5 -w ' [%{http_code}]' http://127.0.0.1/health)"
echo "-- https /health        : $(curl -s -m 5 --cacert $CA -w ' [%{http_code}]' https://8.148.156.146/health)"
echo "-- https /api/health    : $(curl -s -m 5 --cacert $CA -w ' [%{http_code}]' https://8.148.156.146/api/health)"
echo "-- https /api/ready     : $(curl -s -m 5 --cacert $CA -w ' [%{http_code}]' https://8.148.156.146/api/ready)"
echo "-- https 用系统 CA 校验（应当失败，因为我们的 CA 不被公共信任）"
if curl -s -m 5 -o /dev/null https://8.148.156.146/health 2>/dev/null; then
  echo "   FAIL: 未内置 CA 也能通过校验，说明证书链有公共信任来源，不符合预期"
else
  echo "   PASS: 未内置 CA 时校验失败（符合预期：这是私有 CA）"
fi
echo "-- TLS 版本"
echo | openssl s_client -connect 127.0.0.1:443 -servername 8.148.156.146 2>/dev/null | grep -E 'Protocol|Cipher' | head -2 | sed 's/^/   /'
'@
$enc2 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($verify))
& ssh -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes $Target "echo '$enc2' | base64 -d | bash"

# ---------- 4. 取回 CA 公钥证书 ----------
Write-Output ''
Write-Output '=== 4. 取回 CA 公钥证书（供 APK 内置）==='
$rawDir = Join-Path $root 'app\android\app\src\main\res\raw'
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null
$caPath = Join-Path $rawDir 'campus_demo_ca.crt'
& scp -i $Key -o StrictHostKeyChecking=accept-new -o BatchMode=yes "${Target}:/etc/ssl/campus/ca.crt" $caPath
if ($LASTEXITCODE -ne 0) { Write-Error 'CA 证书取回失败'; exit 1 }
$ca = [IO.File]::ReadAllText($caPath, [Text.Encoding]::UTF8)
Write-Output "  已写入 app\android\app\src\main\res\raw\campus_demo_ca.crt（$($ca.Length) 字节）"
if ($ca -match 'PRIVATE KEY') { Write-Error '取回的文件里含私钥，必须中止'; exit 1 }
Write-Output '  确认：取回的是公钥证书，不含 PRIVATE KEY'

Write-Output ''
Write-Output 'done'
