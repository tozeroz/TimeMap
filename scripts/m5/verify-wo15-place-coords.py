#!/usr/bin/env python3
"""
WO#15 服务端增量验证（Python 部分）—— 检查帖子响应里的地点坐标

## 为什么要单独一个 .py 文件，而不是塞进 bash 的 `python3 -c '...'`
   我在 bash 里写 `python3 -c '...'` 时连续踩了两次引号问题：
     ① `printf | python3 - <<'PY'` —— **heredoc 会接管 stdin**，
        于是 python 既要从 stdin 读脚本、又指望 stdin 里有 JSON → JSONDecodeError；
     ② 在**单引号**包里写 `\"` —— 单引号内不转义，Python 实际收到的是 `\"` → SyntaxError。
   ⇒ 教训：**跨语言的引号层数一旦超过 1 层，就该拆成独立文件**，而不是继续加转义。
      这与本项目"换一个不参与 shell 转义的通道"的既有做法一致。

用法：
  python3 verify-wo15-place-coords.py <posts.json> [<detail.json>]
退出码：0 全部通过；1 有失败。
"""
import json
import sys


def kind(v):
    return "null" if v is None else type(v).__name__


def check_items(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    items = d.get("items", [])
    print("  items=%d" % len(items))
    bad = 0
    null_coord_items = 0
    for it in items:
        has_lat = "placeLat" in it
        has_lng = "placeLng" in it
        lat, lng = it.get("placeLat"), it.get("placeLng")
        place = it.get("place")
        print(
            "    place=%r placeLat=%r(%s) placeLng=%r(%s) 字段存在=%s"
            % (place, lat, kind(lat), lng, kind(lng), has_lat and has_lng)
        )
        if not (has_lat and has_lng):
            bad += 1
            print("      **FAIL** 字段缺失")
        if isinstance(lat, str) or isinstance(lng, str):
            bad += 1
            print("      **FAIL** 坐标是**字符串**（地图 SDK 的 LatLng 需要 number）")
        if (lat is None) != (lng is None):
            bad += 1
            print("      **FAIL** 只有一维为 null（两维应当同生同灭）")
        if lat is not None and lat == 0 and lng == 0:
            bad += 1
            print("      **FAIL** 坐标是 0,0（伪造的默认位置，不是真实地点）")
        if lat is None:
            null_coord_items += 1
    print("  坐标为 null 的条数=%d" % null_coord_items)
    print("  RESULT: %s" % ("PASS" if bad == 0 else "FAIL(%d)" % bad))
    return bad


def check_detail(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    lat, lng = d.get("placeLat"), d.get("placeLng")
    print("    place=%r placeLat=%r(%s) placeLng=%r(%s)" % (d.get("place"), lat, kind(lat), lng, kind(lng)))
    bad = 0
    if "placeLat" not in d or "placeLng" not in d:
        bad += 1
        print("      **FAIL** 详情缺少坐标字段")
    if isinstance(lat, str) or isinstance(lng, str):
        bad += 1
        print("      **FAIL** 详情坐标是字符串")
    print("  RESULT: %s" % ("PASS" if bad == 0 else "FAIL"))
    return bad


def main():
    if len(sys.argv) < 2:
        print("用法: python3 verify-wo15-place-coords.py <posts.json> [<detail.json>]", file=sys.stderr)
        return 2
    bad = check_items(sys.argv[1])
    if len(sys.argv) >= 3:
        bad += check_detail(sys.argv[2])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
