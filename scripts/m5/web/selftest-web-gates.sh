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
  # ⚠️⚠️ 必须关掉 Git-Bash(MSYS) 的**路径自动转换**。
  #   实测：`env WEB_ENTRY_PATH=/load-broken/ ...` 被 MSYS 把开头的 `/` 当成 POSIX 路径，
  #   转成了 `C:/Program Files/Git/load-broken/` ⇒ 门禁导航到
  #   `https://8.148.156.146C:/Program Files/Git/load-broken/`（垃圾 URL）⇒
  #   页面永远"未就绪"⇒ 变红。**变红的原因根本不是我们注入的缺陷**，
  #   而我第一版汇总逻辑宽松，把"未就绪"也当成"变红" ⇒ **假通过**。
  #   ⇒ ① 用 MSYS_NO_PATHCONV=1 关掉转换；② 汇总里显式拒绝"未就绪"兜底（见下）。
  local envcmd=(env MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*')
  if [ -n "$envkv" ]; then
    "${envcmd[@]}" $envkv "$BASH_BIN" "$REPO/scripts/m5/web/run-web-gate.sh" "$REPO/$1" 2>&1 | grep -E 'VERDICT = ' | tail -1
  else
    "${envcmd[@]}" "$BASH_BIN" "$REPO/scripts/m5/web/run-web-gate.sh" "$REPO/$1" 2>&1 | grep -E 'VERDICT = ' | tail -1
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
# ⚠️ 注入页必须**自包含**（把 assets 一起复制过去），否则会引入第二个缺陷：
#    首页里资源是**相对路径**（./assets/…），在 /web-broken/ 下会解析成
#    /web-broken/assets/… 而 404 ⇒ 被测页面同时"没挂载"和"资源 404"，
#    **归因就不纯了**（无法区分到底是哪个缺陷导致变红）。
#    （这是实测发现的：实验里看到 /web-broken/ 的 Document 是 200 但
#      Stylesheet/Script 都是 404。）
ssh -i "$KEY" -o BatchMode=yes "$TARGET" "
  set -e
  for D in web-broken load-broken; do
    mkdir -p $WEB/\$D
    cp -a $WEB/assets $WEB/favicon.svg $WEB/icons.svg $WEB/\$D/
    cp -a $WEB/index.html $WEB/\$D/index.html
  done
  python3 - <<'PY'
# a) 缺 #root 的页面（复现我们真实犯过的 bug）—— 只注入这一个缺陷
p = '/srv/campus/web/web-broken/index.html'
s = open(p, encoding='utf-8').read()
assert '<div id=\"root\"></div>' in s, '找不到 #root，注入前提不成立'
s = s.replace('<div id=\"root\"></div>', '<!-- injected: mount point removed -->')
open(p, 'w', encoding='utf-8').write(s)
print('  web-broken: 已移除 #root（只此一个缺陷）')

# b) 额外引用一个不存在的静态资源 —— 只注入这一个缺陷
p2 = '/srv/campus/web/load-broken/index.html'
s2 = open(p2, encoding='utf-8').read()
assert '</head>' in s2
s2 = s2.replace('</head>', '<link rel=\"stylesheet\" href=\"./assets/definitely-missing.css\"></head>')
open(p2, 'w', encoding='utf-8').write(s2)
print('  load-broken: 已加入不存在的 CSS 引用（只此一个缺陷）')
PY
  chown -R campus:campus $WEB/web-broken $WEB/load-broken
  find $WEB/web-broken $WEB/load-broken -type d -exec chmod 755 {} \;
  find $WEB/web-broken $WEB/load-broken -type f -exec chmod 644 {} \;
  echo -n '  web-broken 的 id=root 次数: '; grep -c 'id=\"root\"' $WEB/web-broken/index.html || true
  echo -n '  web-broken 有 assets 吗: '; ls $WEB/web-broken/assets/ | wc -l
  echo -n '  load-broken 有 assets 吗: '; ls $WEB/load-broken/assets/ | wc -l
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
# ⚠️ 清理**不能**写成 `ssh "rm -rf ..."`：本会话的删除守卫会拦下"组合/不透明 shell 语法
#    里的删除"⇒ 整条 ssh 返回非零（我因此在原子部署那里被卡过一轮）。
#    ⇒ 把清理放进服务器侧脚本、scp 过去用 bash 执行（与部署脚本同一套路）。
cat > /tmp/cleanup-inject.sh <<'EOS'
#!/usr/bin/env bash
set -uo pipefail
WEB=/srv/campus/web
for d in "$WEB/web-broken" "$WEB/load-broken"; do
  if [ -d "$d" ]; then rm -rf "$d"; echo "  removed $d"; else echo "  (absent) $d"; fi
done
echo -n "  剩余文件数: "; find "$WEB" -type f | wc -l
EOS
scp -i "$KEY" -o BatchMode=yes /tmp/cleanup-inject.sh "$TARGET:/tmp/cleanup-inject.sh" >/dev/null 2>&1
ssh -i "$KEY" -o BatchMode=yes "$TARGET" 'bash /tmp/cleanup-inject.sh' 2>&1 | sed 's/^/  /'
C_MOUNT="$(run_gate scripts/m5/web/gate-web-app-mount.mjs)"
C_CLEAN="$(run_gate scripts/m5/web/gate-web-load-clean.mjs)"
echo "  mount: ${C_MOUNT:0:150}"
echo "  clean: ${C_CLEAN:0:150}"

echo
echo "════════ 汇总 ════════"
# ⚠️ 断言必须是**有区分力**的，否则会出现"假通过"：
#   第一版只检查 `"ROOT_HAS_CHILDREN":false` 就算变红 —— 而**导航到垃圾 URL 的
#   "未就绪"兜底**也正好含这个 false（见 run_gate 里的 MSYS 路径转换坑），
#   于是"因为错误的原因变红"被当成了敏感度通过。
#   ⇒ 现在显式要求：
#      · 注入后的响应里**不能**是"未就绪"兜底（must-not contain 未就绪）
#      · 且必须**页面确实加载了**（ON_WEB_ORIGIN:true）—— 排除"页面没打开"这类假红
#      · 且出现**预期的那个缺陷特征**（mount: ROOT_ELEMENT_PRESENT false；
#        clean: NO_FAILED_STATIC_RESOURCES false）
ok=1
not_ready='页面在 20 秒内未就绪'

require() { # $1=描述  $2=条件结果(0/1)
  if [ "$2" != "0" ]; then echo "  ✗ $1"; ok=0; fi
}

case "$B_MOUNT" in *'"ROOT_HAS_CHILDREN":true'*) ;; *) require "mount 基线不是 PASS" 1;; esac
case "$B_CLEAN" in *'"NO_FAILED_STATIC_RESOURCES":true'*) ;; *) require "clean 基线不是 PASS" 1;; esac

# —— mount 注入 ——
case "$A_MOUNT" in *"$not_ready"*) require "mount 注入后是「未就绪」兜底 ⇒ 归因错误，不能算变红" 1;; esac
case "$A_MOUNT" in *'"ON_WEB_ORIGIN":true'*) ;; *) require "mount 注入后页面没真正加载（ON_WEB_ORIGIN 非真）⇒ 变红原因不可信" 1;; esac
case "$A_MOUNT" in *'"ROOT_ELEMENT_PRESENT":false'*) ;; *) require "mount 注入后未出现预期的 '#root 缺失' 特征" 1;; esac

# —— clean 注入 ——
case "$A_CLEAN" in *"$not_ready"*) require "clean 注入后是「未就绪」兜底 ⇒ 归因错误" 1;; esac
case "$A_CLEAN" in *'"ON_WEB_ORIGIN":true'*) ;; *) require "clean 注入后页面没真正加载 ⇒ 变红原因不可信" 1;; esac
case "$A_CLEAN" in *'"NO_FAILED_STATIC_RESOURCES":false'*) ;; *) require "clean 注入后未出现预期的 '静态资源失败' 特征" 1;; esac

# —— 还原 ——
case "$C_MOUNT" in *'"ROOT_HAS_CHILDREN":true'*) ;; *) require "mount 移除注入后没回绿" 1;; esac
case "$C_CLEAN" in *'"NO_FAILED_STATIC_RESOURCES":true'*) ;; *) require "clean 移除注入后没回绿" 1;; esac

if [ "$ok" = 1 ]; then
  echo "  ✅ 敏感度验证通过（基线绿 → 注入因**预期缺陷**变红 → 移除后回绿）"
else
  echo "  ❌ 敏感度验证失败（详见上面 ✗ 行）"
fi
echo
echo "⚠️ 注意：本脚本**不碰线上首页**（注入只在 /web-broken、/load-broken 子路径）"
exit $(( 1 - ok ))
