# Clean reinstall of app/ and server/ node_modules.
#
# WHY THIS IS NEEDED (real breakage, 2026-09-26):
#   The agent session ran `pnpm install`, which decided the modules directory had to be
#   recreated. Recreating it requires putting SYMLINKS back in node_modules/ (pnpm's layout
#   links each top-level package into .pnpm/...). The agent sandbox forbids creating symlinks
#   AND forbids deleting the old files, so the result was a half-built tree:
#     - app/node_modules/@rolldown        <- MISSING (verified), so vite cannot load
#                                            @rolldown/binding-win32-x64-msvc
#     - app/node_modules/.pnpm/...        <- present but pnpm refuses to touch it (os error 5)
#   Same story was possible for server/node_modules (also reinstalled by the agent).
#   => the only reliable repair is to delete the tree OUTSIDE the sandbox and reinstall.
#
# This does NOT touch source code, git state, dist/ or any backup.
#
# NOTE: ASCII only (see tools/deploy-server.ps1 for the PowerShell 5.1 encoding story).
param(
  [ValidateSet('all', 'app', 'server')][string]$Target = 'all',
  [switch]$SkipInstall,
  # 追加跑一次真正的 vite build（几十秒）——比 --help 更强，但默认不开以免拖慢修依赖
  [switch]$RunBuildCheck
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Repair-One {
  param([string]$Name, [string]$PackageDir)
  # NOTE: $PackageDir is the PACKAGE directory (app/ or server/), not node_modules.
  # An earlier version passed node_modules and then tried to `cd` into it AFTER deleting it,
  # which failed with PathNotFound. pnpm install must run in the package dir.
  $ModulesDir = Join-Path $PackageDir 'node_modules'
  Write-Host "=== $Name : $ModulesDir ===" -ForegroundColor Cyan
  if (Test-Path -LiteralPath $ModulesDir) {
    Write-Host '  removing node_modules ...'
    # A leftover vite/node process holding a native .node file causes "access denied";
    # clearing the read-only attribute first avoids that being the cause.
    Get-ChildItem -LiteralPath $ModulesDir -Recurse -Force -ErrorAction SilentlyContinue |
      ForEach-Object { try { $_.Attributes = 'Normal' } catch { } }
    try {
      Remove-Item -LiteralPath $ModulesDir -Recurse -Force -ErrorAction Stop
      Write-Host '  removed'
    } catch {
      Write-Host "  remove failed: $($_.Exception.Message)" -ForegroundColor Yellow
      Write-Host '  retrying via cmd rmdir (handles some locked/deep paths better)' -ForegroundColor Yellow
      & cmd /c "rmdir /s /q `"$ModulesDir`"" 2>&1 | ForEach-Object { "    $_" }
      if (Test-Path -LiteralPath $ModulesDir) {
        Write-Host '  ! still present -- close any running vite/node/editor holding it and rerun' -ForegroundColor Red
        return $false
      }
      Write-Host '  removed (via rmdir)'
    }
  } else {
    Write-Host '  node_modules not present (nothing to remove)'
  }

  if ($SkipInstall) { Write-Host '  (skipped install)'; return $true }

  Write-Host '  pnpm install --force ...'
  Push-Location $PackageDir
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & pnpm install --force 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
    Pop-Location
  }
  if ($code -ne 0) {
    $out | ForEach-Object { Write-Host "    $_" }
    Write-Host "  ! pnpm install failed (exit $code)" -ForegroundColor Red
    return $false
  }
  $out | Select-String -Pattern 'Done|Progress: resolved|Ignored build' | Select-Object -Last 4 | ForEach-Object { Write-Host "    $($_.Line.Trim())" }
  return $true
}

# Preflight: a running vite/node holding files under node_modules is the #1 cause of the
# "access denied" we already hit once. Report it up front instead of failing mid-repair.
Write-Host '=== 0) preflight: 占用检查 ===' -ForegroundColor Cyan
foreach ($port in @(5174, 3001)) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    Write-Host "  ! port $port 仍被占用（pid $($conn[0].OwningProcess)）—— 先停掉对应的 vite/node 再继续" -ForegroundColor Yellow
  } else {
    Write-Host "  OK port $port 空闲"
  }
}
Write-Host ''

$ok = $true
if ($Target -eq 'all' -or $Target -eq 'app') {
  if (-not (Repair-One -Name 'app' -PackageDir (Join-Path $root 'app'))) { $ok = $false }
  Write-Host ''
}
if ($Target -eq 'all' -or $Target -eq 'server') {
  if (-not (Repair-One -Name 'server' -PackageDir (Join-Path $root 'server'))) { $ok = $false }
  Write-Host ''
}

# ⭐ The REAL proof is "can vite load its native binding and run?" -- not "does some directory exist".
#
# WHY WE NO LONGER CHECK app/node_modules/@rolldown/...:
#   An earlier version did exactly that and reported a FALSE FAILURE after a perfectly good
#   install. Reason: @rolldown/binding-win32-x64-msvc is NOT a direct dependency, so pnpm
#   correctly never creates a top-level link for it -- it is referenced indirectly via
#   `rolldown` (which lives in .pnpm/.../vite@.../node_modules/rolldown). The original error
#   message ("Cannot find module '@rolldown/binding-win32-x64-msvc'") was about Node trying
#   that *relative* resolution path from inside rolldown, not about a top-level package.
#   => ask vite itself. A green check has to be evidence, not a guess about layout.
Write-Host '=== verify: vite 能否加载原生绑定（跑 vite build --help）===' -ForegroundColor Cyan
$viteOk = $false
Push-Location (Join-Path $root 'app')
$prevV = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $vo = & node 'node_modules\vite\bin\vite.js' build --help 2>&1
  $vcode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $prevV
  Pop-Location
}
if ($vcode -eq 0) {
  Write-Host '  OK   vite 已加载（原生绑定可用）' -ForegroundColor Green
  $viteOk = $true
} else {
  $vo | Select-Object -First 6 | ForEach-Object { Write-Host "    $_" }
  Write-Host '  FAIL vite 无法加载原生绑定' -ForegroundColor Red
  $ok = $false
}

# esbuild 同样按"产物在不在"判断，而不是按 pnpm 的退出码。
Write-Host '=== verify: esbuild 原生二进制 ===' -ForegroundColor Cyan
$eb = Join-Path $root 'server\node_modules\.pnpm\@esbuild+win32-x64@0.25.9\node_modules\@esbuild\win32-x64\esbuild.exe'
if (Test-Path -LiteralPath $eb) {
  Write-Host '  OK   esbuild.exe 存在' -ForegroundColor Green
} else {
  Write-Host "  FAIL 缺少 $eb" -ForegroundColor Red
  $ok = $false
}

# 最后再确认一次 vite 真的能**跑完一次构建**（比 --help 更强的判据）——只在用户要求时跑，
# 因为要几十秒；默认用 --help 已经足够覆盖"绑定能否加载"。
if ($viteOk -and $RunBuildCheck) {
  Write-Host '=== verify: vite build 真跑一次 ===' -ForegroundColor Cyan
  Push-Location (Join-Path $root 'app')
  $prevB = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $bo = & node 'node_modules\vite\bin\vite.js' build 2>&1
    $bcode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevB
    Pop-Location
  }
  if ($bcode -eq 0) {
    $bo | Select-String -Pattern 'built in|dist/assets' | ForEach-Object { Write-Host "    $($_.Line.Trim())" }
    Write-Host '  OK   构建通过' -ForegroundColor Green
  } else {
    $bo | Select-Object -First 8 | ForEach-Object { Write-Host "    $_" }
    Write-Host '  FAIL 构建失败' -ForegroundColor Red
    $ok = $false
  }
}
Write-Host ''

if ($ok) {
  Write-Host 'REPAIR_NODE_MODULES: OK' -ForegroundColor Green
  Write-Host '  next:  & .\tools\deploy-server.ps1      (backend, fixes the live 503)' -ForegroundColor Green
  Write-Host '         & .\tools\deploy-web.ps1         (frontend)' -ForegroundColor Green
  exit 0
} else {
  Write-Host 'REPAIR_NODE_MODULES: FAILED -- see messages above' -ForegroundColor Red
  exit 1
}
