#!/usr/bin/env bash
# 网页端专属门禁的**敏感度验证**（修正版）
#
# ════════════════════════════════════════════════════════════════════════════
# ⚠️ 第一版有两个问题，都值得记：
#   ① **cd 层级算错**：脚本放在 tools/tmp/ 下，却沿用了
#      `cd "$(dirname "$0")/../../.."`（那是给 scripts/m5/web/ 下的脚本用的）
#      ⇒ 实际 cd 到了 **G:/** ⇒ 所有相对路径失效 ⇒
#        门禁一条都没跑起来，输出全空，而我一度以为是门禁坏了。
#      ⇒ 改为**绝对路径**（不再依赖 cwd），并且**校验 cd 结果**。
#   ② **注入方式设计得不好**：第一版为了测"应用能否挂载"，真的把**线上首页**替换成
#      缺 #root 的版本 —— 结果把站点搞坏了，而且还原依赖一个备份文件
#      （该备份本身也被污染，导致还原失败）。
#      ⇒ 改为**零风险注入**：把"故意坏的页面"放在**子路径**下
#        （/web-broken/、/load-broken/），门禁通过 WEB_ENTRY_PATH 指向它。
#        这样**完全不碰线上首页**，而且变红的原因只可能是"应用没挂载"。
#        ⚠️ 这也是为什么门禁要有 WEB_ENTRY_PATH 这个参数：若改用 WEB_ORIGIN 去指向
#           坏页面，origin 断言会一起失败 ⇒ 变红原因变成"origin 不对"，
#           那是**归因错误的假敏感度**。
#
# 判据：基线 PASS → 注入后 FAIL → 移除注入后 PASS
set -uo pipefail

REPO='G:/demo map'
KEY='G:\demo map\TimeMap.pem'
TARGET='root@8.148.156.146'
WEB=/srv/campus/web
BASH_BIN='/c/Program Files/Git/bin/bash.exe'

cd "$REPO" || { echo "FATAL 无法 cd 到 $REPO"; exit 1; }
[ -f "$REPO/scripts/m5/web/run-web-gate.sh" ] || { echo "FATAL 找不到 run-web-gate.sh（cwd 不对）"; exit 1; }
echo "=== cwd 校验：$(pwd) ==="

run_gate() { # $1=门禁路径  $2=额外环境（如 WEB_ENTRY_PATH=/web-broken/）
  local envkv="${2:-}"
  if [ -n "$envkv" ]; then
    env $envkv "$BASH_BIN" "$REPO/scripts/m5/web/run-web-gate.sh" "$REPO/$1" 2>&1 | grep -E 'VERDICT = ' | tail -1
  else
    "$BASH_BIN" "$REPO/scripts/m5/web/run-web-gate.sh" "$REPO/$1" 2>&1 | grep -E 'VERDICT = ' | tail -1
  fi
}

echo
echo "════ 0) 基线 ════"
B_MOUNT="$(run_gate scripts/m5/web/gate-web-app-mount.mjs)"
B_CLEAN="$(run_gate scripts/m5/web/gate-web-load-clean.mjs)"
echo "  mount: ${B_MOUNT:0:150}"
echo "  clean: ${B_CLEAN:0:150}"

echo
echo "════ 注入（零风险：只在子路径放坏页面，不碰线上首页）════"
ssh -i "$KEY" -o BatchMode=yes "$TARGET" "
  set -e
  mkdir -p $WEB/web-broken $WEB/load-broken
  # a) 缺 #root 的页面（复现我们真实犯过的 bug）
  python3 - <<'PY'
src = open('$WEB/index.html', encoding='utf-8').read()
broken = src.replace('<div id=\"root\"></div>', '<!-- 注入：故意去掉挂载点 -->')
open('$WEB/web-broken/index.html', 'w', encoding='utf-8').write(broken)
print('  已生成 web-broken/index.html（缺 #root）')
PY
  # b) 引用不存在静态资源的页面（应产生 404）
  python3 - <<'PY'
src = open('$WEB/index.html', encoding='utf-8').read()
b2 = src.replace('</head>', '<link rel=\"stylesheet\" href=\"/assets/definitely-missing.css\"></head>')
open('$WEB/load-broken/index.html', 'w', encoding='utf-8').write(b2)
print('  已生成 load-broken/index.html（引用不存在的 CSS）')
PY
  chown -R campus:campus $WEB/web-broken $WEB/load-broken
  find $WEB/web-broken $WEB/load-broken -type f -exec chmod 644 {} \;
  find $WEB/web-broken $WEB/load-broken -type d -exec chmod 755 {} \;
  echo -n '  web-broken 里 id=root 次数: '; grep -c 'id=\"root\"' $WEB/web-broken/index.html || true
" 2>&1 | sed 's/^/  /'

echo
echo "--- mount 门禁指向 /web-broken/ ⇒ 应**变红** ---"
A_MOUNT="$(run_gate scripts/m5/web/gate-web-app-mount.mjs 'WEB_ENTRY_PATH=/web-broken/')"
echo "  ${A_MOUNT:0:260}"

echo
echo "--- load-clean 门禁指向 /load-broken/ ⇒ 应**变红** ---"
A_CLEAN="$(run_gate scripts/m5/web/gate-web-load-clean.mjs 'WEB_ENTRY_PATH=/load-broken/')"
echo "  ${A_CLEAN:0:300}"

echo
echo "════ 移除注入并复核回绿 ════"
ssh -i "$KEY" -o BatchMode=yes "$TARGET" "rm -rf $WEB/web-broken $WEB/load-broken && echo '  已删除注入目录' && ls $WEB" 2>&1 | sed 's/^/  /'
C_MOUNT="$(run_gate scripts/m5/web/gate-web-app-mount.mjs)"
C_CLEAN="$(run_gate scripts/m5/web/gate-web-load-clean.mjs)"
echo "  mount: ${C_MOUNT:0:150}"
echo "  clean: ${C_CLEAN:0:150}"

echo
echo "════════ 汇总 ════════"
ok=1
case "$B_MOUNT" in *'"ROOT_HAS_CHILDREN":true'*) ;; *) ok=0; echo "  ✗ mount 基线不是 PASS";; esac
case "$A_MOUNT" in *'"ROOT_HAS_CHILDREN":false'*) ;; *) ok=0; echo "  ✗ mount 注入后**没有**变红（无判别力）";; esac
case "$C_MOUNT" in *'"ROOT_HAS_CHILDREN":true'*) ;; *) ok=0; echo "  ✗ mount 移除注入后没回绿";; esac
case "$B_CLEAN" in *'"NO_FAILED_STATIC_RESOURCES":true'*) ;; *) ok=0; echo "  ✗ clean 基线不是 PASS";; esac
case "$A_CLEAN" in *'"NO_FAILED_STATIC_RESOURCES":false'*) ;; *) ok=0; echo "  ✗ clean 注入后**没有**变红";; esac
case "$C_CLEAN" in *'"NO_FAILED_STATIC_RESOURCES":true'*) ;; *) ok=0; echo "  ✗ clean 移除注入后没回绿";; esac
[ "$ok" = 1 ] && echo "  ✅ 敏感度验证通过（三个状态都对）" || echo "  ❌ 敏感度验证失败"
echo
echo "⚠️ 注意：本脚本**不碰线上首页**（注入只在 /web-broken、/load-broken 子路径）"
exit $(( 1 - ok ))
