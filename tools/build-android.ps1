<#
  一键构建并安装 demo APK 到 MuMu 模拟器。
  前置：web 已 build、cap sync 已执行。
#>
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$serial = '127.0.0.1:16384'
$appDir = 'G:\demo map\app'
$apkPath = 'G:\demo map\app\android\app\build\outputs\apk\debug\app-debug.apk'

if (-not $SkipBuild) {
  Set-Location "$appDir\android"
  $env:ANDROID_HOME = 'G:\android-sdk'
  $env:ANDROID_SDK_ROOT = 'G:\android-sdk'
  $env:JAVA_HOME = 'C:\Program Files\Java\jdk-21'
  Write-Output '[1/3] gradle assembleDebug ...'
  & "$appDir\android\gradlew.bat" assembleDebug --no-daemon 2>&1 | Select-Object -Last 6
}

if (-not (Test-Path $apkPath)) {
  Write-Output "APK NOT FOUND: $apkPath"
  exit 1
}
Write-Output "[2/3] APK: $((Get-Item $apkPath).Length) bytes"

& $adb connect $serial | Out-Null
Write-Output '[3/3] installing ...'
& $adb -s $serial install -r $apkPath 2>&1 | Select-Object -Last 3

& $adb -s $serial shell am start -n com.campusx.demo/.MainActivity 2>&1 | Select-Object -First 2
Start-Sleep -Milliseconds 3500
& $adb -s $serial shell dumpsys window | Select-String 'mCurrentFocus'
Write-Output 'done'
