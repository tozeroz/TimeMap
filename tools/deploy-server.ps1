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

# Resolve the REAL user temp dir. Do NOT just use $env:TEMP: inside the agent sandbox that
# variable points at a sandbox-private directory (...\Temp\dsh-XXXX), so a key staged by the
# user in their own terminal would never be found from here (and vice versa). Because the two
# environments disagree about temp, we simply SEARCH every candidate location for the file.
function Find-StagedKey {
  $candidates = @(
    $env:TMPDIR, $env:TEMP, $env:TMP,
    (Join-Path $env:USERPROFILE 'AppData\Local\Temp'),
    'C:\Users\Lenovo\AppData\Local\Temp'
  ) | Where-Object { $_ } | Select-Object -Unique
  foreach ($c in $candidates) {
    $p = Join-Path $c 'timemap-ssh\id_timemap.pem'
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}
$staged = Find-StagedKey

if (-not $PSBoundParameters.ContainsKey('Key')) {
  # ⭐ Prefer the hardened key staged OUTSIDE the workspace by tools/setup-deploy-key.ps1.
  #    Why this is needed: Windows OpenSSH refuses a private key that other accounts can read
  #    ("UNPROTECTED PRIVATE KEY FILE / bad permissions"), and every file under the workspace
  #    carries sandbox-group ACL entries. Those entries live ON THE FILE, so they follow it no
  #    matter who runs scp -- the user hit the same rejection in their own terminal, which is
  #    what proved this is not a "who is running" problem.
  #    A copy created OUTSIDE the workspace gets a clean, owner-only ACL (verify with
  #    tools/setup-deploy-key.ps1, which also prints the resulting ACL).
  if ($staged) {
    $Key = $staged
    Write-Output "使用已加固的部署密钥: $Key"
  } else {
    $Key = Join-Path $root 'TimeMap.pem'
    Write-Output "  ! 未找到加固密钥（已在各临时目录中查找 timemap-ssh\id_timemap.pem）"
    Write-Output "    回退到仓库内的 TimeMap.pem；若 ssh 报 UNPROTECTED PRIVATE KEY FILE，先跑："
    Write-Output "    & .\tools\setup-deploy-key.ps1"
  }
}

# IdentitiesOnly=yes: without it ssh may offer a DIFFERENT key from ~/.ssh first and either
# authenticate as the wrong identity or fail confusingly. We always mean the -Key key.
$SSH_OPTS = @('-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes')

if (-not $SkipBuild) {
  Write-Output '=== 1. 本地构建后端单文件包 ==='
  # ⭐ Prefer the official build (server/build.mjs). It is the reference implementation of the
  #    bundle options, and it also runs its own 5 load-smoke checks.
  #
  #    FALLBACK: esbuild's JS API spawns a long-lived service process with piped stdio. In a
  #    sandbox that forbids opening named pipes that call dies with `spawn EPERM` (inside
  #    esbuild's own main.js, so build.mjs cannot catch it). tools/tmp/build-server.ps1 drives
  #    the esbuild NATIVE CLI instead -- same options, same smoke checks run by hand afterwards.
  #    => try the official path first; only fall back if it actually fails. This keeps normal
  #       terminals on the reference path and still works in a restricted one.
  Push-Location (Join-Path $root 'server')
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $buildOut = & pnpm build 2>&1
    $buildCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
    Pop-Location
  }
  if ($buildCode -ne 0) {
    Write-Output "  pnpm build 失败（exit $buildCode）—— 回退到 tools/tmp/build-server.ps1（原生 esbuild CLI）"
    & (Join-Path $root 'tools\tmp\build-server.ps1')
    if ($LASTEXITCODE -ne 0) { Write-Error '后端构建失败（两条路径都失败）'; exit 1 }
  } else {
    $buildOut | Select-String -Pattern 'built|KB|冒烟|build\]' | Select-Object -Last 8 | ForEach-Object { Write-Output "  $($_.Line.Trim())" }
  }
}

# ⭐ 只在**上传之前**跑的一次机械校验：产物里的迁移字节必须与源文件一致。
#
# 为什么必须有（2026-09-26 真实事故，线上因此 503 了）：
#   本机 core.autocrlf=true ⇒ 工作区里的 .sql 是 CRLF；esbuild 把 CRLF 字节打进单文件包；
#   部署后服务端启动时算出的 checksum 与 schema_migrations 里存的对不上 ⇒
#   迁移校验**故意 fail-closed**（/api/ready 与所有 /api/* 一律 503）。
#   ⚠️ 这个陷阱最坏的地方是"只有 001 报错"——很容易被读成"只有一条要修"，
#      而真正要做的是把所有迁移固定成同一种换行。
#   ⇒ 把判据**编码成一步**，不再依赖"我记得检查换行"。
$probeBuilder = Join-Path $root 'tools\tmp\build-db-probe.ps1'
$checksumCheck = Join-Path $root 'tools\tmp\check-migration-checksums.mjs'
if ((Test-Path -LiteralPath $probeBuilder) -and (Test-Path -LiteralPath $checksumCheck)) {
  Write-Output '=== 1b. 迁移 checksum 预检（防 CRLF 事故）==='
  & $probeBuilder | ForEach-Object { Write-Output "  $_" }
  if ($LASTEXITCODE -ne 0) { Write-Error '探针构建失败，拒绝赓续部署'; exit 1 }
  $checkOut = & node $checksumCheck 2>&1
  $checkCode = $LASTEXITCODE
  $checkOut | Select-String -Pattern 'CRLF=|src=|MIGRATION_CHECKSUMS' | Select-Object -Last 4 | ForEach-Object { Write-Output "  $($_.Line.Trim())" }
  if ($checkCode -ne 0) {
    $checkOut | ForEach-Object { Write-Output "  $_" }
    Write-Error '迁移 checksum 预检失败 —— 传上去会让服务 fail-closed 503，已中止（服务器未改动）'
    exit 1
  }
} else {
  Write-Output '  ! 跳过迁移 checksum 预检（缺少 tools/tmp 下的检查脚本）'
}

$bundle = Join-Path $root 'server\dist\index.mjs'
$seedBundle = Join-Path $root 'server\dist\seed.mjs'
$adminBundle = Join-Path $root 'server\dist\admin.mjs'
$cleanupBundle = Join-Path $root 'server\dist\cleanup.mjs'
$cleanupAuthBundle = Join-Path $root 'server\dist\cleanup-auth.mjs'
if (-not (Test-Path -LiteralPath $bundle)) { Write-Error "缺少构建产物: $bundle"; exit 2 }
if (-not (Test-Path -LiteralPath $seedBundle)) { Write-Error "缺少构建产物: $seedBundle"; exit 2 }
if (-not (Test-Path -LiteralPath $adminBundle)) { Write-Error "缺少构建产物: $adminBundle"; exit 2 }
if (-not (Test-Path -LiteralPath $cleanupBundle)) { Write-Error "缺少构建产物: $cleanupBundle"; exit 2 }
if (-not (Test-Path -LiteralPath $cleanupAuthBundle)) { Write-Error "缺少构建产物: $cleanupAuthBundle"; exit 2 }
Write-Output ("=== 2. 上传 index/seed/admin/cleanup/cleanup-auth 五个包：{0:N1} / {1:N1} / {2:N1} / {3:N1} / {4:N1} KB ===" -f ((Get-Item $bundle).Length / 1KB), ((Get-Item $seedBundle).Length / 1KB), ((Get-Item $adminBundle).Length / 1KB), ((Get-Item $cleanupBundle).Length / 1KB), ((Get-Item $cleanupAuthBundle).Length / 1KB))
Write-Output '    用 scp 传文件而不是命令行 base64：1.6MB 包编码后约 2MB，超过 Windows 32767 字符的命令行上限'
& scp -i $Key @SSH_OPTS $bundle "${Target}:/tmp/campus-backend-index.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp 失败（index bundle）'; exit 1 }
& scp -i $Key @SSH_OPTS $seedBundle "${Target}:/tmp/campus-seed.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp 失败（seed bundle）'; exit 1 }
& scp -i $Key @SSH_OPTS $adminBundle "${Target}:/tmp/campus-admin.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp 失败（admin bundle）'; exit 1 }
& scp -i $Key @SSH_OPTS $cleanupBundle "${Target}:/tmp/campus-cleanup.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp 失败（cleanup bundle）'; exit 1 }
& scp -i $Key @SSH_OPTS $cleanupAuthBundle "${Target}:/tmp/campus-cleanup-auth.mjs"
if ($LASTEXITCODE -ne 0) { Write-Error 'scp 失败（cleanup-auth bundle）'; exit 1 }

$sh = @'
set -euo pipefail
echo "== 安装后端包 =="
install -o campus -g campus -m 0750 /tmp/campus-backend-index.mjs /srv/campus/server/dist/index.mjs
install -o campus -g campus -m 0750 /tmp/campus-seed.mjs /srv/campus/server/dist/seed.mjs
install -o campus -g campus -m 0750 /tmp/campus-admin.mjs /srv/campus/server/dist/admin.mjs
install -o campus -g campus -m 0750 /tmp/campus-cleanup.mjs /srv/campus/server/dist/cleanup.mjs
install -o campus -g campus -m 0750 /tmp/campus-cleanup-auth.mjs /srv/campus/server/dist/cleanup-auth.mjs
rm -f /tmp/campus-backend-index.mjs /tmp/campus-seed.mjs /tmp/campus-admin.mjs /tmp/campus-cleanup.mjs /tmp/campus-cleanup-auth.mjs
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
# 所以改成轮询等待，最长 240 秒（实测这台机器重启后最长约 176 秒才 ready）。
# 审核记录 04 对轮询的要求：明确 timeout、非无限等待、失败时打印最后状态并输出 journal/systemctl 诊断。
for i in $(seq 1 240); do
  if curl -sf -m 2 http://127.0.0.1:3001/api/ready >/dev/null 2>&1; then
    echo "  就绪耗时: ${i}s（/api/ready 200）"
    break
  fi
  if [ "$i" = 240 ]; then
    echo "  等待 240s 仍未 ready（/api/ready 未返回 200）—— 现场信息如下"
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
& ssh -i $Key @SSH_OPTS $Target "echo '$enc' | base64 -d | bash"
exit $LASTEXITCODE
