import { Screen, TopBar } from '../components/Shell'
import { IconClose } from '../components/icons'
import { goBack } from '../router'
import './scanner.css'

/**
 * 扫码（对应原版 `campusx://scanner`；入口 = 抽屉里的「扫一扫」）。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ Round 319：这里**删掉了一个 fake-success surface**（如实记录）
 * ════════════════════════════════════════════════════════════════════
 * 改前本屏是**伪造的**（其文档注释自己就写明"扫描几秒后「识别成功」"）：
 * ```
 *   const t2 = window.setTimeout(() => setDone(true), 5200)   ← 5.2 秒后**无条件**"识别成功"
 *   {done && <span className="scan__ok">识别成功</span>}        ← **假成功**
 *   {done ? '查看扫描结果' : '正在识别…'}                       ← **假"正在识别"**
 *   取景框 + 扫描线动画                                          ← 假取景
 *   scannerHints（mock 提示文案，见 app/src/data/mock.ts）
 * ```
 * ⇒ 它同时违反两条已冻结的原则：
 *   ① "写操作/操作失败**绝不本地假成功**"（这里是"根本没有任何识别，却报识别成功"）
 *   ② 审核 66 对 scanner 的明确约束：
 *      > "点击后明确提示『扫码功能尚未实现』→ **不打开假 scanner** →
 *      >  **不假装扫码成功** → 不触发任何业务写入"
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐ 现在的处置：如实呈现"能力缺口"，**不描绘一个能工作的扫码器**
 * ════════════════════════════════════════════════════════════════════
 *   我们**没有**摄像头扫码能力（Capacitor 里未接入扫码插件，也没有权威的扫码后端），
 *   而原版扫码页的**真实形态未观察**（我 Round 318 有意**没有点开它**：打开相机会
 *   涉及相机用途/权限，且"扫码"可能触发业务写入，属只读约束下的高风险路径）。
 *   ⇒ 所以这里**不发明**一个仿真的取景界面，而是明确说明当前不可用。
 *
 * ⚠️ 术语口径（审核 66 要求"必须准确描述它完成了什么"，不可写成"扫码体验已完成"）：
 * ```
 *   SCANNER_ENTRY_IN_ORIGINAL:  OBSERVED（原版抽屉里有「扫一扫」）
 *   SCANNER_ENTRY_CURRENT:      **MATCH**（我们抽屉里**本来就有**，无需"恢复"）
 *   SCANNER_TARGET / SCAN_FLOW: NOT_EVALUATED（原版扫码后的目标页未观察）
 *   SCANNER_FUNCTIONALITY:      **NOT_IMPLEMENTED**（无摄像头扫码能力）
 *   SCANNER_EXPERIENCE:         **不可写 PASS**
 * ```
 */
export function ScannerScreen() {
  return (
    <Screen className="scan" scroll={false}>
      <TopBar
        variant="plain"
        left={
          <button className="iconbtn scan__btn" onClick={() => goBack('campus')} aria-label="关闭">
            <IconClose size={22} />
          </button>
        }
      />

      <div className="scan__stage">
        {/*
          ⚠️ 这里**刻意不画取景框/扫描线**：那会让人以为"这个 app 能扫码"。
             当前能力就是没有 ⇒ 如实说。
        */}
        <p className="scan__unavailable" data-scanner-unavailable>
          扫码功能尚未实现
        </p>
        <p className="scan__unavailableHint" data-scanner-note>
          本 demo 未接入摄像头扫码能力；原版扫码后的结果页也尚未观察。
        </p>
      </div>
    </Screen>
  )
}
