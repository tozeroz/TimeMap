# M4 CLOSE 的五条 storage closeout：逐条核实结果（**五条都需要补**）

> 时间：2026-09-21 16:16（Asia/Shanghai）
> 依据：审核记录 18 —— "如果它们已经实际进入最终 Gate，只需在 M4 Final Report 中明确销项即可；
> 如果没有，先补完再正式切换阶段。"
> 方法：**读实际代码与脚本**核对，不凭印象。下面是核实时用的具体依据（文件与行号）。

## ① backup consistency barrier —— 未覆盖

**现状**：`scripts/m4/backup-restore-joint.sh:99-119` 只做两件事：
生成 `manifest.json`（记录两侧计数与 sha256），然后断言"文件存在"。
**没有任何"两侧不一致就拒绝 / 判失败"的屏障**。

**要补**：把"屏障"变成可执行断言 —— 备份生成后立即**用 manifest 校验两侧一致**
（DB 的 media 行数与盘上文件数、manifest 里记的 sha256 与实际文件 sha256），
不一致就 FAIL。这才是 barrier，而不是"记录下来了"。

## ② file→row **双向**恢复 —— 只覆盖了正向

**现状**（`backup-restore-joint.sh:193-205`）：
- 正向（DB 行 → 文件）：不匹配就 `bad()` ✅ 是断言
- 反向（文件 → DB 行）：`if [ "$ORPHAN" = "0" ]; then ok ...; else echo "  ⚠ ... 不影响本次联合恢复判定"`

**即反向只是"提示"，不参与判定** —— 而且脚本自己写明"不影响判定"。
审核要的是**双向**都作为断言。

**要补**：反向也判 FAIL（恢复出来的媒体存储里若有 DB 查不到的文件，说明备份/恢复不完整）。
注意：这会让"当前库里本来就有 orphan"的情况直接失败 —— 而这正是应该的
（先用清扫工具把库里清干净，再跑演练；否则演练在掩盖问题）。

## ③ restore 后私有权限 —— 未覆盖

**现状**：`backup-restore-joint.sh:137` 只检查恢复库里
`can_read_message` / `can_read_media` **两个函数是否存在**。

**没有**在恢复后验证授权行为本身。

**要补**：恢复完成后，用恢复库跑一组授权断言：
- 会话成员 → `can_read_media` = true
- 非成员 → false
- 撤回消息后 → false
即"**恢复了 schema 不等于恢复了安全语义**"。

## ④ cleanup 在 DB down 时 fail-closed —— 未覆盖（只有"缺 DATABASE_URL"这一半）

**现状**：`cleanup-entry.ts` 在**缺少 `DATABASE_URL`** 时拒绝执行（退出码 2），
build.mjs 里有对应冒烟。这一半是覆盖的。

**但"DB down"（URL 存在、连不上库）没有验证**：代码路径是查询抛错 → 走到
`main().catch()` → exit 1。**看起来**是 fail-closed（没删任何文件），但没有断言证明。

**要补**：一条机械断言 —— 停掉 PG（或指向不可达端口）跑 cleanup，
断言 ① 退出码非 0 ② **磁盘文件数不变**。第二条才是"fail-closed"的实质。

## ⑤ pixel/decode bounds —— 只覆盖了"单边尺寸"

**现状**（`server/src/imageProbe.ts:59, 95`）：只检查
`width > 20000 || height > 20000`。

**没有**像素总量上限（`width × height`）：一张 20000×20000 的图能通过尺寸检查，
但那是 4 亿像素 —— **解压炸弹的典型形态**。

**也没有** decode bound 的说明与测试。

**要补**：
1. 加像素总量上限（例如 `width * height <= 40_000_000`，并说明取值依据）
2. 在单测里加一条"超大像素但单边不超限"的用例
3. 明确写下强度边界：**这是结构校验，不是完整解码**（已写在模块注释里，但要进入 Gate 口径）

## 下一步

上述五条**都需要补**（不是"列出来就行"）。建议排成一个 Slice：
`M4 CLOSEOUT`（五条各一组断言），做完再重跑 M4 Final Report 并正式销项，
之后才切换 M5 的正式阶段。
