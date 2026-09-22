#!/usr/bin/env python3
# ⚠️ Windows 控制台默认是 GBK 代码页，直接 print 中文/emoji 会
#    `UnicodeEncodeError: 'gbk' codec can't encode character`。
#    本项目已多次栽在"编码/换行/BOM"这类环境问题上（PS1 BOM、CRLF、PS 输出转码…），
#    所以这里**显式**把 stdout/stderr 切到 UTF-8，而不是靠调用方设环境变量。
import sys as _sys
try:
    _sys.stdout.reconfigure(encoding="utf-8")
    _sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass
"""
自测：`analyze-baseline-pixels.py` 是否**真的**在正确测量？

## 为什么必须有它（本项目的一贯纪律）
   一个"永远给出一堆数字"的分析器，与该分析器**测错了**，在输出上**无法区分**。
   而这次我用它去支撑"基线里没有绿色族"这类**否定性结论** —— 属于门槛最高的那类断言。
   ⇒ 所以必须先证明这个工具在**已知答案**的输入上给出**正确**的读数。

## 做法：合成图（答案我们自己定）
   生成一张纯色背景 + 已知位置/颜色的方块，然后断言分析器：
     ① 找到的色块数 = 已知方块数（不多不少）
     ② 每个方块的平均色相落在**预期桶**里
     ③ 背景色（低饱和灰）**不**被当成高饱和色块
     ④ 关键的一条：**绿色方块能被找到** ——
        这正是"基线里没有绿色"这个否定结论所依赖的能力。
        若分析器对绿色不敏感，我就会**把"工具测不到绿"误读成"原图没有绿"**，
        那是一个**方向完全相反**的错误结论。

## 反向断言（防止"恒真"）
   再加一条：**故意放一个不该被找到的低饱和灰块**，断言它**不**出现在结果里。
   否则一个"把所有东西都当色块"的坏实现也能通过前三条。

用法（需要 PIL）：python3 selftest-pixel-analyzer.py
退出码：0 全通过；1 有失败；2 环境不满足。
"""
import json
import os
import subprocess
import sys
import tempfile

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("FATAL 需要 PIL（Pillow）", file=sys.stderr)
    sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
ANALYZER = os.path.join(HERE, "analyze-baseline-pixels.py")

# ---- 已知答案：方块 (颜色, 期望色相桶中心, bbox) ----
# 注意 bbox 用 (x, y, w, h)，方块面积都 >> MIN_BLOB_PX(30)
BLOCKS = [
    ((230, 40, 40), 0, (40, 40, 60, 60)),      # 红  → 色相≈0
    ((40, 200, 60), 120, (140, 40, 60, 60)),   # ⭐ 绿 → 色相≈120（关键：必须能测到）
    ((50, 90, 230), 220, (240, 40, 60, 60)),   # 蓝 → 色相≈220
    ((240, 200, 40), 45, (40, 160, 60, 60)),   # 黄 → 色相≈45~60
]
# 反向样本：低饱和灰块（S 远低于阈值 90）→ **不应**被算作色块
NEGATIVE = ((150, 148, 146), (140, 160, 60, 60))


def build(path):
    im = Image.new("RGB", (400, 300), (224, 224, 224))  # 低饱和浅灰背景
    d = ImageDraw.Draw(im)
    for color, _hue, (x, y, w, h) in BLOCKS:
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=color)
    nx, ny, nw, nh = NEGATIVE[1]
    d.rectangle([nx, ny, nx + nw - 1, ny + nh - 1], fill=NEGATIVE[0])
    im.save(path)


def main():
    if not os.path.exists(ANALYZER):
        print(f"FATAL 找不到 {ANALYZER}", file=sys.stderr)
        return 2
    fail = 0
    with tempfile.TemporaryDirectory() as td:
        img = os.path.join(td, "synthetic.png")
        outj = os.path.join(td, "out.json")
        build(img)
        # ⚠️ `text=True` 会用**父进程的默认编码**（Windows 是 GBK）去解码子进程输出，
        #    而子进程已把 stdout 切成 UTF-8 → 父进程侧报
        #    `UnicodeDecodeError: 'gbk' codec can't decode byte 0xba`（在 reader 线程里）。
        #    ⇒ 必须**两侧都显式**指定 UTF-8，而不是只改子进程。
        r = subprocess.run(
            [sys.executable, ANALYZER, img, "--json", outj],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if r.returncode != 0:
            print("**FAIL** 分析器退出码", r.returncode, r.stderr[:300])
            return 1
        with open(outj, encoding="utf-8") as f:
            res = json.load(f)

        print(f"=== 合成图：{len(BLOCKS)} 个已知色块 + 1 个低饱和灰块（反向样本）===")
        print(f"  分析器报告色块数 = {res['blob_count']}")
        print(f"  阈值：SAT_MIN={res['method']['SAT_MIN']} MIN_BLOB_PX={res['method']['MIN_BLOB_PX']}")

        # ① 数量：应恰好 = 已知方块数（灰块不应计入）
        if res["blob_count"] == len(BLOCKS):
            print(f"  PASS 色块数 == {len(BLOCKS)}（低饱和灰块未被计入）")
        else:
            print(f"  **FAIL** 期望 {len(BLOCKS)}，实际 {res['blob_count']}")
            fail = 1

        # ② 逐个方块：能否在预期色相桶附近找到匹配的色块
        def hue_dist(a, b):
            d = abs(a - b) % 360
            return min(d, 360 - d)

        found = res["blobs_top20"]
        for color, exp_hue, (x, y, w, h) in BLOCKS:
            cx, cy = x + w // 2, y + h // 2
            # 找中心距离最近、且尺寸合理的色块
            cand = None
            for b in found:
                bx, by = b["center"]
                if abs(bx - cx) <= 8 and abs(by - cy) <= 8:
                    cand = b
                    break
            if not cand:
                print(f"  **FAIL** 位置 ({cx},{cy}) 的方块（色相≈{exp_hue}°）未被找到")
                fail = 1
                continue
            got = cand["avg_hsv"][0]
            ok = hue_dist(got, exp_hue) <= res["method"]["HUE_BUCKET_DEG"] * 2
            tag = "PASS" if ok else "**FAIL**"
            if not ok:
                fail = 1
            print(f"  {tag} 方块 RGB{color} 位置({cx},{cy})：测得色相 {got}°，期望≈{exp_hue}°")

        # ③ 反向断言：灰块不得出现
        nx, ny, nw, nh = NEGATIVE[1]
        ncx, ncy = nx + nw // 2, ny + nh // 2
        leaked = [b for b in found if abs(b["center"][0] - ncx) <= 8 and abs(b["center"][1] - ncy) <= 8]
        if leaked:
            print(f"  **FAIL** 低饱和灰块（更不该被计入）出现在了结果里")
            fail = 1
        else:
            print("  PASS 反向样本（低饱和灰块）未被计入")

        # ④ 关键能力：绿色必须可测（"基线无绿色"这个否定结论依赖它）
        green_ok = any(hue_dist(b["avg_hsv"][0], 120) <= 30 for b in found)
        if green_ok:
            print("  PASS ⭐ 绿色方块**能被测到**（'基线无绿色'这条否定结论才有依据）")
        else:
            print("  **FAIL** ⭐ 绿色测不到 —— 那么'基线里没有绿色'可能是**工具盲区**，不是事实")
            fail = 1

    print()
    if fail == 0:
        print("SELFTEST_PIXEL_ANALYZER: PASS（已知答案的合成图上读数正确，含反向样本与绿色灵敏度）")
    else:
        print("SELFTEST_PIXEL_ANALYZER: FAIL")
    return fail


if __name__ == "__main__":
    sys.exit(main())
