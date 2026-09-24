<#
  把仓库里 ops/ 下的 expected state 下发到服务器（唯一真源 = 仓库）。
  用法： & '.\tools\push-ops.ps1'

  实现要点：bash 脚本用**单引号 here-string** 写，避免 PowerShell 插值/转义互相打架；
  三份配置以 base64 占位符替换进去，保证字节精确。
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

$sh = @'
set -euo pipefail

apply() {
  target="$1"; data="$2"; changed=1
  tmp="$(mktemp)"
  printf '%s' "$data" | base64 -d > "$tmp"
  if [ -f "$target" ] && cmp -s "$tmp" "$target"; then
    echo "  unchanged: $target"
  else
    install -m 0644 "$tmp" "$target"
    echo "  updated:   $target"
    changed=0
  fi
  rm -f "$tmp"
  return $changed
}

echo "== 下发 ops/ 到服务器（仓库为唯一真源）=="
set +e
apply /etc/nginx/sites-available/campus.conf "__B64_NGINX__"; nginxChanged=$?
apply /etc/postgresql/18/main/conf.d-campus-freeze.conf "__B64_PG__"; pgChanged=$?
apply /etc/systemd/system/campus-backend.service "__B64_UNIT__"; unitChanged=$?
set -e

if [ "$pgChanged" -eq 0 ]; then echo "  -> 重启 postgresql"; systemctl restart postgresql; sleep 2; fi
if [ "$nginxChanged" -eq 0 ]; then echo "  -> nginx -t + restart"; nginx -t; systemctl restart nginx; fi
if [ "$unitChanged" -eq 0 ]; then
  echo "  -> daemon-reload + 保持 disabled"
  systemctl daemon-reload
  systemctl disable campus-backend.service >/dev/null 2>&1 || true
fi

echo
echo "== 验证 =="
printf 'health       : '; curl -s -m 5 http://127.0.0.1/health; echo
printf 'nginx        : %s / %s\n' "$(systemctl is-active nginx)" "$(systemctl is-enabled nginx)"
printf 'postgresql   : %s / %s\n' "$(systemctl is-active postgresql)" "$(systemctl is-enabled postgresql)"
printf 'backend unit : %s / %s\n' "$(systemctl is-active campus-backend.service)" "$(systemctl is-enabled campus-backend.service)"
printf 'shared_buffers: '; sudo -u postgres psql -Atc "select setting from pg_settings where name='shared_buffers'"
printf 'listen_addr   : '; sudo -u postgres psql -Atc "select setting from pg_settings where name='listen_addresses'"
echo "listen sockets:"; ss -lntp | grep -E ':80|:5432'
'@

$sh = $sh.Replace('__B64_NGINX__', (Get-B64 'ops\nginx\campus.conf'))
$sh = $sh.Replace('__B64_PG__', (Get-B64 'ops\postgresql\expected-settings.conf'))
$sh = $sh.Replace('__B64_UNIT__', (Get-B64 'ops\systemd\campus-backend.service'))

$enc = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sh))
& ssh -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes $Target "echo '$enc' | base64 -d | bash"
exit $LASTEXITCODE
