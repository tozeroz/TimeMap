#!/usr/bin/env bash
# Android E2E 的 **artifact provenance** 机械检查
#
# ## 它防的是什么（审核记录 50 建议；本项目真实事故）
#
# 我改完前端后只跑了 `pnpm build` + `build-android.ps1`，**漏跑 `npx cap sync android`** ——
# 结果装机后跑的是**旧 bundle**，而设备 Gate 照样"有输出"，
# 差点让我把"新代码没生效"误读成"新代码没通过"。
#
# 本轮还发现过同类的另一例：服务器上的 gate 是**手工拷贝的旧副本**，
# 改仓库并不会让它自动生效。
#
# 两者是同一个问题：
#   **source changed ≠ executed artifact changed**
#
# 因此 Android E2E 在**引用设备 Gate 结论之前**，必须机械证明三者一致：
#   web build revision  →  Capacitor android asset revision  →  installed APK revision
#
# ## 怎么证（不靠"我 scp/cap sync 过了所以应该对"）
#   ① web 产物：app/dist/assets/index-*.js 的最新文件（含它的 sha256 前缀）
#   ② cap 产物：app/android/app/src/main/assets/public/assets/index-*.js（同上）
#      → 两者**必须同名**（cap sync 是把 dist 复制过去）
#   ③ 已装 APK：从设备上把 APK 拉下来，解出同一个 assets 路径，比对 sha256
#      `adb shell pm path <pkg>` 取 APK 路径 → `adb pull` → `unzip -p` 取该文件
#      （⚠️ 用 unzip -p 输出到文件，**不要**经 shell 文本重定向 —— 二进制会被破坏）
#
# ## 用法
#   bash scripts/m5/check-artifact-provenance.sh
# 退出码：0 = 三者一致；1 = 不一致（**此时不得引用设备 Gate 结论**）
set -uo pipefail
ADB='G:\Program Files\Netease\MuMu\nx_main\adb.exe'
SERIAL='127.0.0.1:16384'
PKG='com.campusx.demo'
ROOT='G:\demo map'
# 目录可用环境变量覆盖 —— 这是为了**敏感度自检**（见文件末尾说明），正常运行不要传。
DIST_DIR="${PROV_DIST_DIR:-$ROOT/app/dist/assets}"
CAP_DIR="${PROV_CAP_DIR:-$ROOT/app/android/app/src/main/assets/public/assets}"
TMP_APK="$ROOT/tools/tmp/installed.apk"
TMP_EXTRACT="$ROOT/tools/tmp/installed-index.js"

mkdir -p "$ROOT/tools/tmp"

echo "=== 1) web 产物（app/dist/assets）==="
DIST_JS="$(ls -1 "$DIST_DIR"/index-*.js 2>/dev/null | sort | tail -1)"
if [ -z "$DIST_JS" ]; then echo "  FAIL 找不到 dist 产物（先跑 pnpm build）"; exit 1; fi
echo "  $(basename "$DIST_JS")"

echo
echo "=== 2) Capacitor android asset（cap sync 的产物）==="
CAP_JS="$(ls -1 "$CAP_DIR"/index-*.js 2>/dev/null | sort | tail -1)"
if [ -z "$CAP_JS" ]; then echo "  FAIL 找不到 android asset（先跑 npx cap sync android）"; exit 1; fi
echo "  $(basename "$CAP_JS")"

FAIL=0
if [ "$(basename "$DIST_JS")" != "$(basename "$CAP_JS")" ]; then
  echo "  FAIL dist 与 android asset **不同名** → 说明 cap sync 没跑（或跑在 build 之前）"
  echo "       dist: $(basename "$DIST_JS")"
  echo "       cap : $(basename "$CAP_JS")"
  FAIL=1
else
  echo "  PASS 同名（cap sync 已把 dist 复制到 android assets）"
fi

echo
echo "=== 3) 已安装 APK 里的同一文件 ==="
APK_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" 2>/dev/null | tr -d '\r' | sed 's/^package://')"
if [ -z "$APK_PATH" ]; then echo "  FAIL 设备上找不到 $PKG（先装机）"; exit 1; fi
echo "  设备 APK: $APK_PATH"
"$ADB" -s "$SERIAL" pull "$APK_PATH" "$TMP_APK" >/dev/null 2>&1 || { echo "  FAIL adb pull 失败"; exit 1; }
ASSET_IN_APK="assets/public/assets/$(basename "$CAP_JS")"
# unzip -p 直接写出二进制（不经 shell 文本重定向）
unzip -p "$TMP_APK" "$ASSET_IN_APK" > "$TMP_EXTRACT" 2>/dev/null
if [ ! -s "$TMP_EXTRACT" ]; then
  echo "  FAIL APK 里找不到 $ASSET_IN_APK（装的不是这个 bundle → provenance 断裂）"
  FAIL=1
else
  SZ=$(wc -c < "$TMP_EXTRACT" | tr -d ' ')
  echo "  PASS APK 里存在 $ASSET_IN_APK（$SZ 字节）"
fi

echo
echo "=== 4) sha256 三方比对 ==="
SHA_DIST="$(sha256sum "$DIST_JS" | cut -d' ' -f1)"
SHA_CAP="$(sha256sum "$CAP_JS" | cut -d' ' -f1)"
SHA_APK="$(sha256sum "$TMP_EXTRACT" | cut -d' ' -f1)"
echo "  dist    : ${SHA_DIST:0:16}…"
echo "  cap     : ${SHA_CAP:0:16}…"
echo "  apk     : ${SHA_APK:0:16}…"
if [ "$SHA_DIST" = "$SHA_CAP" ] && [ "$SHA_CAP" = "$SHA_APK" ]; then
  echo "  PASS 三方 sha256 完全一致"
else
  echo "  FAIL 三方 sha256 不一致 → **不得引用由该 APK 得出的设备 Gate 结论**"
  FAIL=1
fi

echo
echo "=== 5) 新代码标记抽查（防止'同名的旧文件'这种极端情形）==="
for marker in data-at-panel-entry data-at-panel-failure chip--at; do
  if grep -q "$marker" "$TMP_EXTRACT" 2>/dev/null; then
    echo "  PASS APK 内 bundle 含标记 $marker"
  else
    echo "  warn APK 内 bundle 不含标记 $marker（若该标记本应存在，说明是旧 bundle）"
  fi
done

echo
if [ "$FAIL" -eq 0 ]; then
  echo "ARTIFACT_PROVENANCE: PASS（web → cap asset → installed APK 三者一致）"
  exit 0
else
  echo "ARTIFACT_PROVENANCE: FAIL（source changed ≠ executed artifact changed）"
  exit 1
fi
