# 打包 BJTU TimeMap 的 debug APK。
#
# 为什么需要脚本：这台机器上打包依赖三个不显然的前提，散在命令行里很容易漏：
#   1) JDK 21   —— Capacitor 8 的 Android 模块用 Java 21 源级，JDK 17 会在
#                  :capacitor-android:compileDebugJavaWithJavac 直接失败；
#   2) Android SDK —— 系统里没有，由 tools/fetch-android-sdk.mjs 下到工作区 .android-sdk；
#   3) 工作目录含中文（"测试实训"），AGP 默认拒绝，需 android.overridePathCheck=true。
#
# 用法：
#   pwsh -File tools/build-apk.ps1                 # 若 SDK 缺失，先自动下载
#   pwsh -File tools/build-apk.ps1 -SkipWebBuild   # 跳过 Web 构建，只重打 APK
param(
    [string]$Jdk = '',
    [switch]$SkipWebBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root 'app'
$androidDir = Join-Path $appDir 'android'
$sdkDir = Join-Path $root '.android-sdk'

# --- 1. JDK 21 ---
if (-not $Jdk) {
    $candidates = @(
        'C:\Program Files\Java\jdk-21.0.10',
        'C:\Program Files\Java\latest'
    ) + (Get-ChildItem 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^jdk-2[1-9]' } | Select-Object -ExpandProperty FullName)
    $Jdk = $candidates | Where-Object { Test-Path (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1
}
if (-not $Jdk) { throw '找不到 JDK 21+，请用 -Jdk 指定路径' }
$env:JAVA_HOME = $Jdk
Write-Host "JAVA_HOME = $Jdk"

# --- 2. Android SDK ---
if (-not (Test-Path (Join-Path $sdkDir 'platforms\android-36\android.jar'))) {
    Write-Host '未检测到 Android SDK，开始下载（约 130 MB）…'
    Push-Location $root
    node tools/fetch-android-sdk.mjs
    Pop-Location
    Write-Host '注意：下载后需按 README/实施记录里的说明解压到 .android-sdk/{platform-tools,platforms,build-tools}'
}
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
Write-Host "ANDROID_HOME = $sdkDir"

# --- 3. Web 构建 + 同步到原生工程 ---
Push-Location $appDir
if (-not $SkipWebBuild) {
    Write-Host '构建 Web 产物…'
    pnpm run build
}
Write-Host 'cap sync android…'
pnpm exec cap sync android

# --- 4. Gradle 打包 ---
Push-Location $androidDir
& (Join-Path $androidDir 'gradlew.bat') assembleDebug --console=plain
$code = $LASTEXITCODE
Pop-Location
Pop-Location
if ($code -ne 0) { throw "Gradle 构建失败（退出码 $code）" }

# --- 5. 产物落盘到固定路径 ---
$built = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
$version = (Select-String -Path (Join-Path $androidDir 'app\build.gradle') -Pattern 'versionName "([^"]+)"').Matches[0].Groups[1].Value
$dest = Join-Path $root "TimeMap-$version-debug.apk"
Copy-Item $built $dest -Force
Write-Host ''
Write-Host "APK 已生成：$dest"
Write-Host ("大小：{0} MB" -f [math]::Round((Get-Item $dest).Length / 1MB, 2))
