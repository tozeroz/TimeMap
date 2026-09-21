# M4 Final regression 第 3 次运行：FAIL 1 已修好，暴露"用例间状态污染"

> 时间：2026-09-21 15:53（Asia/Shanghai）

## 一、本次运行结果

```
M3_PRECONDITION_RESULT: PASS
M3_SLICE0B_GATE_RESULT: PASS      ← FAIL 1（迁移数硬编码）已修好，本组恢复 PASS
M3_SLICE1_GATE_RESULT:  FAIL
  FAIL 设备端 composer → FAIL（未产出 SLICE1_COMPOSER_RESULT）
  FAIL 设备端 authgate → FAIL（未产出 SLICE1_AUTHGATE_RESULT）
M3_SLICE2/3/4: PASS
M3_FINAL_GATE_LAYERS:
  PERSISTENT: PASS
  STAGE:      FAIL
  REGRESSION: PASS
```

**没有出现 FAIL 1** → 迁移断言改为派生（applied == expected 且 > 0）有效。

## 二、新现象与判断（尚未最终确证）

- **composer 单独跑是 PASS**（上一轮 c2b0249 已证），**在 gate 里与其它用例同批跑就 FAIL**；
- authgate 也 FAIL，而它在更早的运行里是 PASS 的；
- 两个都是"**未产出 RESULT 标记**"（不是断言 FAIL），说明脚本**中途异常退出**，不是断言不成立。

最可能的原因（**待确证，不作为结论**）：**用例间状态污染**。
本项目此前就记录过同一类问题：composer 用例留下的回复弹层是**全屏遮罩 + autoFocus**，
会把后续 authgate 的"点底部评论框"变成"点到遮罩"，于是那个用例的文字进了回复框。
现在 composer 的断言从"固定等待"改成"轮询等弹层出现"之后，
**弹层被留下的可能性更大**（以前可能还没渲染出来就断言完了，反而"顺手"没留下覆盖层）。
也就是说：修好一个脆弱点，暴露出另一个被它掩盖的脆弱点 —— 这在测试里很常见。

## 三、修法方向（下一步执行）

**每个设备用例开始前先重置到干净状态**，而不是假设上一个用例留下了什么：

```
进入用例 → 先关掉可能的覆盖层（点遮罩 / 调 close()）
        → 或直接 location.reload() 等稳定
        → 再导航到目标路由 → 断言
```

更彻底的方案是在 device 驱动里提供一个 `resetTo(route)`：
reload → 等待稳定 → 设 hash → 等待目标元素出现（轮询）。
所有用例统一走它，替代"各自写一遍导航 + sleep"。

## 四、纪律

这次仍然**不下"已修"的结论**：目前只确证
「FAIL 1 已修」+「两个设备用例在同批运行时异常退出」。
根因（状态污染 vs 其它）要靠一次**带完整输出的单独复跑**来确认，
不能靠"看起来很像"就宣称修好。
