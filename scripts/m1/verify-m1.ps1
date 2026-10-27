<#
  M1 Gate（对应 docs/archive/legacy-development/m1/SPEC.md 第六节）。

  口径：M1 PASS = M0 invariants PASS + M1 new invariants PASS。
  任一必需项失败 → 退出码非 0、打印 M1_GATE_RESULT FAIL。

  用法：
    & '.\scripts\m1\verify-m1.ps1'                    # 全量
    & '.\scripts\m1\verify-m1.ps1' -SkipDevice        # 跳过设备组（没开模拟器时）
    & '.\scripts\m1\verify-m1.ps1' -Phase pre         # 重启 Gate 第一阶段：记 boot_id
    & '.\scripts\m1\verify-m1.ps1' -Phase post        # 重启 Gate 第二阶段：断言已重启且服务自恢复

  证据落在 docs/archive/legacy-development/m1/evidence/gate-<phase>-<时间戳>.txt
#>
param(
  [ValidateSet('assert', 'pre', 'post')][string]$Phase = 'assert',
  [switch]$SkipM0,
  [switch]$SkipDevice,
  [switch]$SkipServer
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$evidenceDir = Join-Path $repo 'docs\archive\legacy-development\m1\evidence'
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidencePath = Join-Path $evidenceDir "gate-$Phase-$stamp.txt"

$script:failed = 0
$script:lines = New-Object System.Collections.ArrayList

function Say($m) {
  Write-Output $m
  [void]$script:lines.Add([string]$m)
}
function Ok($m) { Say "PASS $m" }
function Bad($m) { Say "FAIL $m"; $script:failed = 1 }
function Head($m) { Say ''; Say "=== $m ===" }
function Expect($name, $actual, $expected) {
  if ("$actual" -eq "$expected") { Ok "$name ($actual)" } else { Bad "$name 期望 $expected，实际 $actual" }
}
function Run-Remote([string]$ScriptPath) {
  $bytes = [IO.File]::ReadAllBytes($ScriptPath)
  $b64 = [Convert]::ToBase64String($bytes)
  $key = Join-Path $repo 'TimeMap.pem'
  & ssh -i $key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes `
    root@8.148.156.146 "echo '$b64' | base64 -d | bash" 2>&1
}

# 临时脚本文本版：需要把变量（比如标记）插进远端脚本时用它。
# 一律走 base64，不要试图把带引号的命令直接拼进 ssh 命令行 ——
# PowerShell 与 ssh 会各吃一层引号，最后远端收到的是被拆散的词
# （已经踩过：psql 报 "extra command-line argument ... ignored"）。
function Run-RemoteText([string]$Text) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text))
  $key = Join-Path $repo 'TimeMap.pem'
  & ssh -i $key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes `
    root@8.148.156.146 "echo '$b64' | base64 -d | bash" 2>&1
}

Say "M1 Gate  阶段=$Phase  时间=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Say "仓库=$repo"

# ===========================================================================
if ($Phase -eq 'pre') {
  Head 'REBOOT 第一阶段：记录 boot_id'
  $out = & (Join-Path $repo 'scripts\m0\verify-m0.ps1') -Phase pre -Stage M1 2>&1
  $out | ForEach-Object { Say "  $_" }
  $ok = ($out | Select-String -Pattern 'boot_id_before recorded' -Quiet)
  if ($ok) { Ok 'boot_id 已记录（可以重启服务器了）' } else { Bad 'boot_id 记录失败' }
  Say ''
  if ($script:failed -eq 0) { Say 'M1_REBOOT_PRE READY' } else { Say 'M1_REBOOT_PRE FAIL' }
  $script:lines | Set-Content -LiteralPath $evidencePath -Encoding UTF8
  exit $script:failed
}

# ===========================================================================
if ($Phase -eq 'post') {
  Head '0) M0 regression（重启后第二阶段）'
  $out = & (Join-Path $repo 'scripts\m0\verify-m0.ps1') -Phase post -Stage M1 2>&1
  $out | ForEach-Object { Say "  $_" }
  if ($out | Select-String -Pattern 'M0_GATE_RESULT PASS' -Quiet) { Ok '重启后 M0 invariants 仍 PASS' }
  else { Bad '重启后 M0 invariants FAIL' }

  if (-not $SkipServer) {
    Head '5) [SYSTEMD] 重启后后端自恢复 + 垂直切片仍可用'
    $out = Run-Remote (Join-Path $repo 'scripts\m1\verify-backend.sh')
    $out | ForEach-Object {
      $line = "$_".Trim()
      if ($line -match '^(PASS|FAIL) ') { Say "  $line" }
      elseif ($line -match '^(===|标记|BACKEND_RESULT)') { Say "  $line" }
    }
    if ($out | Select-String -Pattern 'BACKEND_RESULT PASS' -Quiet) { Ok '重启后端到端断言 PASS' }
    else { Bad '重启后端到端断言 FAIL' }
  }

  Say ''
  if ($script:failed -eq 0) { Say 'M1_GATE_RESULT PASS' } else { Say 'M1_GATE_RESULT FAIL' }
  $script:lines | Set-Content -LiteralPath $evidencePath -Encoding UTF8
  exit $script:failed
}

# ===========================================================================
# 默认 assert 阶段
# ===========================================================================

# ---------- 0) M0 regression ----------
if (-not $SkipM0) {
  Head '0) M0 regression（必须仍然 PASS）'
  $out = & (Join-Path $repo 'scripts\m0\verify-m0.ps1') -Stage M1 2>&1
  $out | ForEach-Object {
    $line = "$_".Trim()
    if ($line -match '^(PASS|FAIL) ') { Say "  $line" }
    elseif ($line -match '^(===|---|REBOOT|SAMPLE|NOTE)') { Say "  $line" }
  }
  if ($out | Select-String -Pattern 'M0_GATE_RESULT PASS' -Quiet) { Ok 'M0 invariants 仍全部 PASS' }
  else { Bad 'M0 invariants 出现回归' }
} else {
  Say ''
  Say 'NOTE 已按参数跳过 M0 regression（不可作为最终验收依据）'
}

# ---------- ENC) PowerShell 编码守卫 ----------
Head 'ENC) 带中文的 .ps1 必须有 UTF-8 BOM'
# 为什么加这条：PS 5.1 按 ANSI 读 .ps1，一旦 BOM 丢了，中文注释会被解码成乱码，
# 而乱码里可能凑出 ' 或 @ 把 here-string 提前截断 —— 整个脚本结构被破坏，
# 而且失败现象离原因很远（表现为"某个函数没执行"）。已经因此搞坏过一次线上 unit 文件。
$ps1 = Get-ChildItem -Path $repo -Recurse -Filter *.ps1 -File |
  Where-Object { $_.FullName -notmatch 'node_modules' }
$badEnc = @()
foreach ($f in $ps1) {
  $b = [IO.File]::ReadAllBytes($f.FullName)
  $hasBom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
  $nonAscii = $false
  foreach ($x in $b) { if ($x -gt 0x7F) { $nonAscii = $true; break } }
  if ($nonAscii -and -not $hasBom) { $badEnc += $f.FullName.Replace("$repo\", '') }
}
if ($badEnc.Count -eq 0) { Ok "所有含非 ASCII 的 .ps1 都有 BOM（检查 $($ps1.Count) 个文件）" }
else { Bad "缺 BOM: $($badEnc -join ', ')" }

# ---------- SCOPE) 改动范围 ----------
Head '8) [SCOPE] 改动范围必须落在 M1 允许清单内'
$anchor = 'da10163'
$changed = @(& git -C $repo diff --name-only $anchor -- . 2>$null)
$untracked = @(& git -C $repo ls-files --others --exclude-standard 2>$null)
$all = @($changed + $untracked) | Where-Object { $_ } | ForEach-Object { ($_ -replace '\\', '/') } | Sort-Object -Unique

$allow = @(
  '^PLAN\.md$',
  '^docs/',
  '^ops/',
  '^scripts/m1/',
  # M0 Gate 基础设施（已披露的两处必要改动，无可选空间）：
  #   1) verify-m0.ps1 补 UTF-8 BOM（缺 BOM 会让 PS 5.1 按 GBK 误读，脚本结构被破坏）
  #   2) 两个 M0 脚本加 stage 维度：M0 那几条断言的是"业务库/后端尚不存在"，
  #      与 M1 目标直接冲突，按 stage 反转是让"M0 ∧ M1"可满足的唯一办法
  '^scripts/m0/',
  '^tools/',
  '^server/',
  '^app/src/api/',
  '^app/src/screens/CampusScreen\.tsx$',
  '^app/src/screens/PublishScreen\.tsx$',
  '^app/src/data/store\.ts$',
  '^app/capacitor\.config\.ts$',          # 配置文件
  '^app/\.env\.example$',                 # 配置文件
  '^app/android/app/src/main/AndroidManifest\.xml$',
  '^app/android/app/src/main/res/xml/network_security_config\.xml$',
  '^\.gitignore$'
)
$violations = @()
foreach ($f in $all) {
  $hit = $false
  foreach ($p in $allow) { if ($f -match $p) { $hit = $true; break } }
  if (-not $hit) { $violations += $f }
}
Say "  改动文件数: $($all.Count)"
$all | ForEach-Object { Say "    $_" }
if ($violations.Count -eq 0) { Ok '所有改动都在允许清单内' }
else { Bad "越界改动: $($violations -join ', ')" }

if (-not $SkipServer) {
  Head '8b) [SCOPE] 库里不得新增业务表'
  $tbl = Run-Remote (Join-Path $repo 'scripts\m1\check-tables.sh')
  $tblList = @($tbl | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
  Say "  表: $($tblList -join ', ')"
  $unexpected = @($tblList | Where-Object { $_ -notin @('posts', 'schema_migrations') })
  if ($tblList.Count -lt 2) { Bad "表列表异常（只拿到 $($tblList.Count) 项）" }
  elseif ($unexpected.Count -eq 0) { Ok '只有 posts / schema_migrations 两张表' }
  else { Bad "出现了预期外的表: $($unexpected -join ', ')" }
}

# ---------- SERVER) 后端 1/2/3/5/6/7 组 ----------
if (-not $SkipServer) {
  Head '1/2/3/5/6/7) [MIGRATION][API][VERTICAL_SLICE][SYSTEMD][NGINX][RESOURCE] 后端现场断言'
  $out = Run-Remote (Join-Path $repo 'scripts\m1\verify-backend.sh')
  $out | ForEach-Object {
    $line = "$_".Trim()
    if ($line -match '^(PASS|FAIL) ') { Say "  $line" }
    elseif ($line -match '^(=== |标记|  )') { Say "$_" }
    elseif ($line -match '^(BACKEND_RESULT)') { Say "  $line" }
  }
  if ($out | Select-String -Pattern 'BACKEND_RESULT PASS' -Quiet) { Ok '后端现场断言 PASS（写读/落库/重启后仍在/readiness 503/端口/CORS/资源）' }
  else { Bad '后端现场断言 FAIL' }
}

# ---------- FRONTEND) 构建产物 ----------
Head '4a) [FRONTEND] 构建产物里确实带上了 API 地址'
$bundle = Get-ChildItem (Join-Path $repo 'app\dist\assets') -Filter 'index-*.js' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $bundle) { Bad '找不到前端构建产物 app/dist/assets/index-*.js' }
else {
  $txt = [IO.File]::ReadAllText($bundle.FullName, [Text.Encoding]::UTF8)
  if ($txt.Contains('8.148.156.146')) { Ok "构建产物含 API base 8.148.156.146（$($bundle.Name)）" }
  else { Bad "构建产物里没有 API base（$($bundle.Name)）" }
  if ($txt.Contains('/api/posts')) { Ok '构建产物含 /api/posts 调用' } else { Bad '构建产物里没有 /api/posts' }
  $androidAsset = Join-Path $repo "app\android\app\src\main\assets\public\assets\$($bundle.Name)"
  if (Test-Path -LiteralPath $androidAsset) { Ok 'cap sync 已把该产物同步进 android 工程' }
  else { Bad 'android 工程里没有这个产物（忘了 cap sync?）' }
}

# ---------- DEVICE) 设备真实路径 ----------
if ($SkipDevice) {
  Say ''
  Say 'NOTE 已按参数跳过设备组（不可作为最终验收依据）'
} else {
  Head '4b) [FRONTEND] 设备真实 UI 路径：发帖 → 校园页出现 → 清空本地后仍在'

  $adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
  $serial = '127.0.0.1:16384'
  $pkg = 'com.campusx.demo'

  $dev = (& $adb devices 2>&1 | Out-String)
  if ($dev -notmatch [regex]::Escape($serial)) {
    Bad "模拟器未连接（$serial）"
  } else {
    Ok "模拟器在线（$serial）"

    # 确保 App 在前台且 CDP 可用
    & $adb -s $serial shell am start -n "$pkg/.MainActivity" 2>&1 | Out-Null
    Start-Sleep -Milliseconds 4000
    & $adb -s $serial forward --remove-all 2>&1 | Out-Null
    $appPid = (& $adb -s $serial shell pidof $pkg 2>&1 | Out-String).Trim()
    if ($appPid) {
      & $adb -s $serial forward tcp:9222 "localabstract:webview_devtools_remote_$appPid" 2>&1 | Out-Null
    }

    $marker = "M1-真机GATE-$(Get-Date -Format 'MMddHHmmss')"
    $e2e = & node (Join-Path $repo 'scripts\m1\device-e2e.mjs') $marker 2>&1
    $e2e | ForEach-Object { Say "  $_" }
    if ($e2e | Select-String -Pattern 'DEVICE_E2E PASS' -Quiet) { Ok '设备端真实触摸发帖并出现在信息流' }
    else { Bad '设备端发帖 E2E 失败' }

    # 该标记必须真的在 PostgreSQL 里（证明不是只写了 localStorage）
    $q = @"
export PGPASSWORD="`$(cat /srv/campus/.db_password)"
psql -h 127.0.0.1 -U campus -d campus -Atc "select count(*) from posts where body like '$marker%'"
"@
    $cnt = (Run-RemoteText $q | Out-String).Trim()
    if ($cnt -eq '1') { Ok "该帖在 PostgreSQL 中确有 1 行" } else { Bad "该帖在 PostgreSQL 中行数异常: $cnt" }

    # 清空本地数据后仍在（M1 最关键的一条）
    $persist = & (Join-Path $repo 'scripts\m1\device-persistence.ps1') -Marker $marker 2>&1
    $persist | ForEach-Object { Say "  $_" }
    if ($persist | Select-String -Pattern 'DEVICE_PERSIST PASS' -Quiet) { Ok '清空 localStorage 后帖子仍在（数据来自服务器）' }
    else { Bad '清空本地数据后帖子消失' }
  }
}

# ---------- 阶段报告口径 ----------
Head '阶段报告口径（审核强制，绝不允许写成 19/19）'
Say 'total original screens: 22'
Say 'observed baseline:      19'
Say 'evidence-blocked:        3   (poi-detail / media-preview / at-panel，M3 从真实入口恢复)'
Say 'out-of-scope:            0'

Say ''
if ($script:failed -eq 0) { Say 'M1_GATE_RESULT PASS' } else { Say 'M1_GATE_RESULT FAIL' }
$script:lines | Set-Content -LiteralPath $evidencePath -Encoding UTF8
Say "证据: $evidencePath"
exit $script:failed

