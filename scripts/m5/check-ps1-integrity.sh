#!/usr/bin/env bash
# 机械门禁：校验仓库里 PowerShell 脚本的**编码/换行/完整性**
#
# ## 为什么需要（2026-09-22 的真实事故）
#   我改了 `tools/deploy-server.ps1`（就绪轮询 /api/health → /api/ready），
#   结果**部署工具整个坏掉**，而且是**静默**的：输出正常、exit=0，
#   但服务器上的产物**根本没更新**。三层原因全是"看不见的"：
#     ① 写入**无 BOM** → Windows PowerShell 5.1 按 **ANSI(GBK)** 解码该文件，
#        UTF-8 中文注释被误读 → 令牌化破坏 → 解析失败（字节上看不出来）
#     ② 该文件的 bash 正文在**单引号 here-string** 里、原样发到 Linux 执行；
#        若文件是 **CRLF**，bash 收到 `pipefail\r` → `set: pipefail: invalid option name`
#     ③ 我的 PowerShell 字符串替换链某一步把内容变成空串 → 只写出了 BOM，
#        文件**被截断成 3 字节**；而 ParseFile 对 3 字节文件报 **0 错误、0 条语句**
#        （"空脚本"在解析器看来是完全合法的）
#
# ## ⚠️ 判据必须是**条件化的**（第一版写成"无 BOM 一律 FAIL、含 CRLF 一律 FAIL"，
#    结果 18 个文件里绝大多数被误判 —— 而它们解析正常、运行正常。
#    会误报的门禁比没有门禁更糟：它会训练人忽略红色。因此：
#
#   ① BOM：**仅当文件含非 ASCII 字节时**才要求 —— 因为只有那时 PS 5.1 才会按
#      ANSI 误读。纯 ASCII 的 .ps1 无 BOM 是**合法且常见**的。
#   ② CRLF：**仅当文件里有发往 Linux 的 bash here-string 正文时**才要求 LF。
#      判据：文件含 `@'`（单引号 here-string）且其中出现 bash 专属语法
#      （`set -e`/`#!/`/`pipefail` 之类）。普通的纯 PowerShell 文件用 CRLF 毫无问题。
#   ③ 顶层语句数 > 0 且体积下限 —— 这条**无条件**要求，因为它防的是"被截断成空脚本"
#      （而解析器对这种文件不报错，只能靠这条抓）。
#
# 用法（在工作站）：bash scripts/m5/check-ps1-integrity.sh [目录]
set -uo pipefail
DIR="${1:-G:/demo map/tools}"
FAIL=0
MIN_BYTES=200

ok()  { echo "  PASS $1"; }
bad() { echo "  FAIL $1"; FAIL=1; }

echo "=== 扫描 $DIR 下的 .ps1 ==="
shopt -s nullglob
FILES=("$DIR"/*.ps1)
if [ ${#FILES[@]} -eq 0 ]; then
  echo "  FATAL 没找到 .ps1 —— 路径错了吗？（属于"检查范围没覆盖到"，故记 FAIL）"
  echo "PS1_INTEGRITY: FAIL"
  exit 2
fi
echo "  找到 ${#FILES[@]} 个文件"
echo
printf '  %-34s %-6s %-6s %-7s %-8s %s\n' "文件" "非ASCII" "BOM" "CRLF" "bash体" "判定"
printf '  %s\n' "--------------------------------------------------------------------------"

DETAIL=""
for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  size=$(stat -c %s "$f" 2>/dev/null || echo 0)
  b0=$(od -An -tu1 -N1 "$f" | tr -d ' ')
  b1=$(od -An -tu1 -j1 -N1 "$f" | tr -d ' ')
  b2=$(od -An -tu1 -j2 -N1 "$f" | tr -d ' ')
  has_bom=no
  [ "$b0" = "239" ] && [ "$b1" = "187" ] && [ "$b2" = "191" ] && has_bom=yes

  # 非 ASCII：用 LC_ALL=C 逐字节找 >= 0x80
  nonascii=$(LC_ALL=C grep -c $'[\x80-\xff]' "$f" 2>/dev/null || echo 0)
  [ "$nonascii" -gt 0 ] 2>/dev/null && has_nonascii=yes || has_nonascii=no

  # ⚠️ 用**字节级**统计 CR，不用 grep：
  #    我第一版写的是 `cr=$(grep -c $'\r' "$f" || echo 0)`，
  #    而 grep 在"0 匹配"时**退出码为 1**，`|| echo 0` 于是又追加一个 0，
  #    使 $cr 变成 "0\n0" → `[ "$cr" -gt 0 ]` 报错 → 分支落到 else……
  #    结果是**所有文件都被判成"含 CRLF"**（字节核对明明是 CR=0）。
  #    那是"检测本身出错"，会训练人忽略红色 —— 必须用不依赖退出码语义的写法。
  cr=$(tr -cd '\r' < "$f" | wc -c | tr -d ' ')
  has_cr=no
  [ "${cr:-0}" -gt 0 ] 2>/dev/null && has_cr=yes

  # 是否含"发往 Linux 的 bash here-string 正文"
  has_bash=no
  if grep -q "@'" "$f" 2>/dev/null; then
    if grep -qE "set -e|set -[a-z]*u|pipefail|#!/|^install -o" "$f" 2>/dev/null; then has_bash=yes; fi
  fi

  verdict=OK
  msgs=""

  # ③ 无条件：体积 + 顶层语句（防截断成空脚本）
  if [ "$size" -lt "$MIN_BYTES" ]; then
    verdict=FAIL; msgs="$msgs 体积 $size<$MIN_BYTES（疑似截断）；"
  fi
  # ① 条件：含非 ASCII 才要求 BOM
  if [ "$has_nonascii" = "yes" ] && [ "$has_bom" = "no" ]; then
    verdict=FAIL; msgs="$msgs 含非ASCII但缺BOM（PS5.1会按ANSI误读）；"
  fi
  # ② 条件：含 bash here-string 才要求 LF
  if [ "$has_bash" = "yes" ] && [ "$has_cr" = "yes" ]; then
    verdict=FAIL; msgs="$msgs 含 bash here-string 但有 CRLF（bash 会收到 \\r）；"
  fi

  printf '  %-34s %-6s %-6s %-7s %-8s %s\n' "$name" "$has_nonascii" "$has_bom" "$has_cr" "$has_bash" "$verdict"
  if [ "$verdict" = "FAIL" ]; then
    bad "$name :$msgs"
  fi
  DETAIL="$DETAIL$name|$has_nonascii|$has_bom|$has_cr|$has_bash|$verdict\n"
done

echo
echo "=== 解析检查（唯一能抓"被截断成空脚本"的办法：解析器对空文件报 0 错误）==="
if command -v powershell.exe >/dev/null 2>&1; then
  for f in "${FILES[@]}"; do
    name="$(basename "$f")"
    win=$(cygpath -w "$f" 2>/dev/null || echo "$f")
    res=$(powershell.exe -NoProfile -Command "
      \$e=\$null
      \$a=[System.Management.Automation.Language.Parser]::ParseFile('$win',[ref]\$null,[ref]\$e)
      Write-Output ('' + \$a.EndBlock.Statements.Count + '|' + \$e.Count)
    " 2>/dev/null | tr -d '\r' | head -1)
    stmts=$(echo "$res" | cut -d'|' -f1)
    errs=$(echo "$res" | cut -d'|' -f2)
    if [ "${stmts:-0}" -gt 0 ] 2>/dev/null; then
      [ "${errs:-1}" = "0" ] && ok "$name：$stmts 条顶层语句、解析无错误" \
                             || bad "$name：解析有 $errs 个错误"
    else
      bad "$name：**顶层语句为 0** —— 文件可能被截断成"只有 BOM"的空脚本（解析器不报错！）"
    fi
  done
else
  echo "  info 找不到 powershell.exe —— **这会让"空脚本"漏检**，故记 FAIL"
  FAIL=1
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "PS1_INTEGRITY: PASS（无条件的只有"非空且可解析"；BOM/换行按条件要求）"
else
  echo "PS1_INTEGRITY: FAIL"
fi
exit "$FAIL"
