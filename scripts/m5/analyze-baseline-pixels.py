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
机械像素分析：从**原版基线截图**里提取客观事实（不依赖视觉模型）

## 为什么要这个（一次真实的证据通道缺口）
   本项目里 `MAP_PIN_COLOR_SEMANTICS_CONFORMANCE`、`ORIGINAL_MAP_MARKER_CONFORMANCE`、
   `OFFLINE_MAP_PROJECTION_CONFORMANCE` 三项一直记 `NOT_EVALUATED`，
   原因不是"我没查"，而是 **唯一的视觉通道不可用**：我是纯文本模型，
   而 `vision` 工具在本会话**两次调用都返回空**（疑似未配置）。

   ⇒ 但"看图"并不只有"让模型描述"这一条路。**很多断言需要的只是可测量的量**：
       某区域的主色分布、有几个高饱和色块、各色块的位置与大小……
     这些都可以**机械地**从 PNG 像素里算出来 —— 而且是**可复现、可复核、无主观性**的，
     比"模型说它看到红色图钉"其实更硬。

## 它做什么（只测量，不解释）
   ① 读 PNG（PIL），输出尺寸与模式
   ② 全局**高饱和像素**的色相直方图 —— 图钉/标记通常是图上最饱和的东西
      （地图底图多为灰/米/浅绿，饱和度低）
   ③ 连通域分析：找出"高饱和色块"的**个数、位置、尺寸、平均色**
   ④ 可选：裁剪指定区域并输出其主色（用于"顶部/右下角/地图主体"这类分区问题）
   ⑤ 输出 JSON，便于后续脚本/Gate 引用

## ⚠️ 边界（必须声明，避免把测量当解释）
   · 它**只测量颜色与几何**，**不解释语义**。
     "图上有 3 个高饱和色块，色相分别约 0°/45°/140°" 是**测量**；
     "红色代表某类动态" 是**解释**，本脚本**不**给。
   · 它**不认字**：无法读出图钉上的地名文字（那需要 OCR 或视觉模型）。
   · 阈值（饱和度/亮度）是**本脚本的选择**，属于方法学参数，已在输出里写明，
     换阈值结果可能变化 —— 所以结论要带上阈值一起引用。

用法：
  python3 analyze-baseline-pixels.py <png> [--json out.json] [--crop x,y,w,h]
"""
import json
import os
import sys
from collections import Counter

try:
    from PIL import Image
except ImportError:
    print("FATAL 需要 PIL（Pillow）", file=sys.stderr)
    sys.exit(2)

# ---- 方法学参数（写在输出里，换值结果可能不同）----
SAT_MIN = 90          # 饱和度阈值（0-255，HSV 的 S）
VAL_MIN = 60          # 亮度下限：排除接近黑的像素（阴影/文字）
VAL_MAX = 250         # 亮度上限：排除接近白的像素（高光/白底）
MIN_BLOB_PX = 30      # 连通域最小像素数：滤掉噪点
HUE_BUCKET = 15       # 色相分桶宽度（度）


def hsv(p):
    """返回 (h 0-360, s 0-255, v 0-255)"""
    r, g, b = p[:3]
    mx, mn = max(r, g, b), min(r, g, b)
    v = mx
    d = mx - mn
    s = 0 if mx == 0 else int(255 * d / mx)
    if d == 0:
        return 0, 0, v
    if mx == r:
        h = (60 * ((g - b) / d)) % 360
    elif mx == g:
        h = 60 * ((b - r) / d) + 120
    else:
        h = 60 * ((r - g) / d) + 240
    return int(h), s, v


def analyze(path, crop=None):
    im = Image.open(path).convert("RGB")
    full_size = im.size
    if crop:
        im = im.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
    w, h = im.size
    px = im.load()

    hue_hist = Counter()
    sat_pixels = []          # (x, y, rgb)
    total = w * h
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            _, s, v = hsv((r, g, b))
            if s >= SAT_MIN and VAL_MIN <= v <= VAL_MAX:
                hue, _, _ = hsv((r, g, b))
                hue_hist[(hue // HUE_BUCKET) * HUE_BUCKET] += 1
                sat_pixels.append((x, y, (r, g, b)))

    # ---- 连通域（4 邻接，基于高饱和像素集合）----
    coords = {(x, y) for x, y, _ in sat_pixels}
    color_of = {(x, y): c for x, y, c in sat_pixels}
    seen = set()
    blobs = []
    for start in coords:
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        comp = []
        while stack:
            cx, cy = stack.pop()
            comp.append((cx, cy))
            for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if (nx, ny) in coords and (nx, ny) not in seen:
                    seen.add((nx, ny))
                    stack.append((nx, ny))
        if len(comp) < MIN_BLOB_PX:
            continue
        xs = [c[0] for c in comp]
        ys = [c[1] for c in comp]
        cols = [color_of[c] for c in comp]
        avg = tuple(int(sum(c[i] for c in cols) / len(cols)) for i in range(3))
        ah, asat, av = hsv(avg)
        blobs.append(
            {
                "px": len(comp),
                "bbox": [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1],
                "center": [int(sum(xs) / len(xs)), int(sum(ys) / len(ys))],
                "avg_rgb": list(avg),
                "avg_hsv": [ah, asat, av],
            }
        )
    blobs.sort(key=lambda b: -b["px"])

    return {
        "file": os.path.basename(path),
        "full_size": list(full_size),
        "analyzed_region": list(crop) if crop else [0, 0, w, h],
        "method": {
            "SAT_MIN": SAT_MIN,
            "VAL_MIN": VAL_MIN,
            "VAL_MAX": VAL_MAX,
            "MIN_BLOB_PX": MIN_BLOB_PX,
            "HUE_BUCKET_DEG": HUE_BUCKET,
            "note": "阈值是方法学选择，换值结果可能不同；引用结论时必须带上阈值",
        },
        "saturated_pixel_count": len(sat_pixels),
        "saturated_pixel_ratio": round(len(sat_pixels) / total, 5),
        "hue_histogram_deg": {str(k): v for k, v in sorted(hue_hist.items(), key=lambda kv: -kv[1])},
        "blob_count": len(blobs),
        "blobs_top20": blobs[:20],
        "limitations": [
            "只测量颜色与几何，不解释语义（哪种颜色代表什么，本脚本不给）",
            "不认字：无法读图钉上的地名文本",
            "阈值可调，结论须与阈值一起引用",
        ],
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    path = sys.argv[1]
    out = None
    crop = None
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--json":
            out = args[i + 1]
            i += 2
        elif args[i] == "--crop":
            crop = [int(v) for v in args[i + 1].split(",")]
            i += 2
        else:
            i += 1
    if not os.path.exists(path):
        print(f"FATAL 找不到 {path}", file=sys.stderr)
        return 2
    res = analyze(path, crop)
    text = json.dumps(res, ensure_ascii=False, indent=2)
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"已写出 {out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
