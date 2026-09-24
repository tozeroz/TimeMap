#!/usr/bin/env bash
# 跨层常量一致性检查 —— 落实审核记录 20 提出的通则
#
# 审核原话：
#   "建议以后凡是跨 shell↔application、frontend↔backend、migration↔runtime、
#    backup↔service 共享 magic value / protocol constant 的地方，都优先做这种
#    双方值机械一致性检查，不要只靠复制粘贴和代码审查。"
#
# 起因：我把 advisory lock 的键手算错（0x4D344241 → 1295258177），
# 两侧用了不同的锁 → **屏障在生产里完全不生效**，而机制层测试照样 PASS。
# 教训：**共享常量必须机械核对，不能靠人记、也不能靠代码审查**。
#
# 本脚本**纯本地静态检查**（只读仓库文件），可在 CI / 提交前跑，不需要服务器。
# 检查项：
#   C1 purpose → scope 映射：前端发送的 purpose 取值必须 ⊆ 服务端接受的取值
#   C2 图片 mime 白名单：imageProbe / nginx types / 任何 DB 约束 三方必须一致
#   C3 cleanup 退出码语义：文档声明的码位必须在代码里真实出现
#   C4 advisory lock 键：脚本用值与 TS 常量必须相等（这条已在 gate 里，这里本地也查一遍）
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
SERVER_SRC='server/src/index.ts'
PROBE='server/src/imageProbe.ts'
NGINX='deploy/nginx/campus-locations.inc'
CLEANUP='server/src/cleanup-entry.ts'
BARRIER='server/src/mutationBarrier.ts'
BARRIER_SH='scripts/m4/backup-with-barrier.sh'

echo "=== C1 purpose 取值：前端发出的必须被服务端接受 ==="
# 服务端接受什么（从映射分支里取）
SRV_PURPOSES="$(grep -oE "purpose === '[a-z]+'" "$SERVER_SRC" | sed "s/.*'\([a-z]*\)'/\1/" | sort -u | tr '\n' ' ')"
echo "  服务端接受: ${SRV_PURPOSES:-（未解析到）}"
# 前端发送什么（app/ 下所有 purpose 的赋值）
APP_PURPOSES="$(grep -rhoE "purpose: '[a-z]+'|purpose=[a-z]+" app/src 2>/dev/null | grep -oE "'[a-z]+'|[a-z]+$" | tr -d "'" | sort -u | tr '\n' ' ')"
echo "  前端发送:   ${APP_PURPOSES:-（未解析到）}"
C1_BAD=0
for p in $APP_PURPOSES; do
  case " $SRV_PURPOSES " in *" $p "*) ;; *) echo "    前端发送了服务端不接受的 purpose: $p"; C1_BAD=1 ;; esac
done
if [ -z "$APP_PURPOSES" ]; then
  # **这条不能算通过，但要分清是"检查方式失效"还是"覆盖缺口"**：
  # 实测 app/ 里根本没有 purpose —— 说明**前端还没有上传调用**
  # （后端 POST /api/media 存在，但 App 侧未接入）。这属于**覆盖缺口**，
  # 不是"前后端不一致"。两者含义完全不同，所以措辞必须区分。
  bad "C1 前端目前没有任何上传调用（未发送 purpose）—— 这是**覆盖缺口**（App 侧未接入上传），不是一致性通过"
elif [ "$C1_BAD" = "0" ]; then
  ok "C1 前端发送的 purpose 全部被服务端接受（$APP_PURPOSES）"
else
  bad "C1 存在前后端不接受的 purpose 取值"
fi

echo
echo "=== C2 图片 mime 白名单三方一致 ==="
# imageProbe 返回的 mime
PROBE_MIMES="$(grep -oE "mime: 'image/[a-z]+'" "$PROBE" | sed "s/.*'\(image\/[a-z]*\)'/\1/" | sort -u | tr '\n' ' ')"
echo "  imageProbe 接受: ${PROBE_MIMES:-（未解析到）}"
# nginx types 块里的图片类型
NGINX_MIMES="$(grep -oE 'image/[a-z]+' "$NGINX" 2>/dev/null | sort -u | tr '\n' ' ')"
echo "  nginx 声明:      ${NGINX_MIMES:-（未解析到或文件不存在）}"
NG_BAD=0
for m in $PROBE_MIMES; do
  case " $NGINX_MIMES " in *" $m "*) ;; *) echo "    imageProbe 接受 $m 但 nginx 未声明该类型（下发时 Content-Type 可能不对）"; NG_BAD=1 ;; esac
done
if [ -z "$PROBE_MIMES" ]; then
  bad "C2 没能解析出 imageProbe 的 mime（检查方式失效）"
elif [ "$NG_BAD" = "0" ]; then
  ok "C2 imageProbe 的 mime 全部在 nginx 里声明（$PROBE_MIMES）"
else
  bad "C2 存在 imageProbe 接受但 nginx 未声明的 mime"
fi

echo
echo "=== C3 cleanup 退出码：文档声明 vs 代码实现 ==="
for code in 2 3; do
  if grep -qE "exitCode = $code|exit $code|process\.exit\($code\)" "$CLEANUP"; then
    ok "C3 退出码 $code 在代码里真实存在"
  else
    bad "C3 文档/约定提到退出码 $code，但代码里找不到"
  fi
done

echo
echo "=== C4 advisory lock 键：脚本 vs TS 常量 ==="
TS_HEX="$(grep -oE 'MEDIA_MUTATION_LOCK_KEY *= *0x[0-9a-fA-F_]+' "$BARRIER" | grep -oE '0x[0-9a-fA-F_]+' | tr -d '_')"
if [ -z "$TS_HEX" ]; then
  bad "C4 没能从 mutationBarrier.ts 解析出锁键（不能算通过）"
else
  TS_DEC=$((TS_HEX))
  echo "  TS 常量 = $TS_HEX = $TS_DEC"
  SHELL_KEY="$(grep -oE '^KEY=[0-9]+' "$BARRIER_SH" | head -1 | cut -d= -f2)"
  echo "  备份脚本 KEY = ${SHELL_KEY:-（未解析到）}"
  if [ "$SHELL_KEY" = "$TS_DEC" ]; then
    ok "C4 备份脚本与业务侧使用**同一把锁**"
  else
    bad "C4 **锁键不一致**（脚本 $SHELL_KEY ≠ TS $TS_DEC）—— 屏障会在生产中失效"
  fi
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "CROSS_LAYER_CONSTANTS_RESULT PASS"; else echo "CROSS_LAYER_CONSTANTS_RESULT FAIL"; fi
exit "$FAILED"
