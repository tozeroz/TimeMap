# 审核记录 40：**WO#6 批准**（附两处计划修正）；FAB 挂起；测量清单补第 5 条

> 审核方：ChatGPT web；时间：2026-09-22 01:41（Asia/Shanghai）
> 本轮提交：WO#6 计划 + 方法有效性分级 + (B) 格已清空的回报

## 一、正式裁定

```
WO6_TABBAR_VERTICAL_LAYOUT: **APPROVED**
FAB_VISIBLE_DIAMETER:       NOT_MEASURED_RELIABLY ／ **NO PRODUCT CHANGE**
inactive tab 追加取证:      **NOT REQUIRED** before WO#6
```

审核对证据链的评价：
> "原版 dump 给出上下分离的几何关系；原版截图独立显示 3 个 tab 都是图标上、文字下；
>  当前产品 CDP 实测是横向；修复只涉及 CSS 排布，不需要猜新的业务语义。"

## 二、⚠️ 必须落实的两处计划修正

### 2.1 Gate ① 的**坐标单位必须显式冻结**（否则连原版自己都会失败）

审核推算：原版激活项中心差 `|174.5 − 160.5| = 14 device px ÷ 1.75 ≈ **8 CSS px**`
→ 若把阈值 12 当成 device px，**原版自己也不满足**。

> "我建议直接冻结单位 …… 不要混用两个坐标系。"

**我已落实**：`scripts/m5/gate-wo6-tabbar-orientation.mjs` 文件头写明
「全程使用 CSS px」，所有打印带 `Css`/`dev` 后缀，阈值 12 CSS px（原版实测 8，留 4 余量）。

### 2.2 追加一条**导航行为回归**（便宜且更贴合纯 CSS 工作单）

> "点击 <昵称> / 校园 / 地图 → 仍进入各自原有 route。
>  因为 flex-direction 虽然理论上只改视觉，但这是一个每页高频导航控件。
>  Server Gate 可以继续跑，不过对这个 CSS-only 工作单，
>  更有价值的是 device/client navigation regression。"

**我已落实**：Gate 增加 `TAB_NAVIGATION_REGRESSION`（实测 校园→#/campus、地图→#/map）。

### 2.3 最终验收 key（审核给定，已全部实现）

```
TAB_ITEM_ORIENTATION:        PASS
TAB_LABELS_PRESERVED:        PASS
TAB_NAVIGATION_REGRESSION:   PASS
FAB_GEOMETRY_UNCHANGED:      PASS
TABBAR_HEIGHT_UNCHANGED:     PASS
M5_SERVER_REGRESSION:        （另行跑 server gate）
```

## 三、FAB 可见直径：**挂起**（审核同意，且给了一个更好的未来方法）

审核确认我前两种像素启发式**都该继续标 INVALID**：
> "失败原因本质一样：用'颜色属于谁'去解决'这个圆的边界在哪里'，
>  而 ROI 中还有照片、图标、文字等竞争像素。"

**未来若真要测**，用「**已知中心 + 径向边缘拟合**」（比 Hough 更合适，因为圆心先验已知）：
```
1. 用原版 FAB 节点 bounds 得到可信中心点
2. 从原始 1080×1920 截图裁「FAB bounds + 少量 margin」的小 ROI
3. 从中心向外取 32~64 条径向射线
4. 每条射线上找「深色圆面 → 外部背景」的最大稳定亮度/颜色跃迁点
5. 白色 + 只位于圆内部，不改变外缘；异常射线直接剔除
6. 用边缘点拟合圆得半径 r
7. **同时报告拟合残差**，而不是只报一个直径：
     valid spokes >= 75% ／ fitted diameter ／ RMS radial residual
     ／ horizontal diameter ≈ vertical diameter
```
> "但我更建议现在先挂起 …… 目前你没有可信证据表明 FAB 尺寸真的有 deviation。
>  不要为了'把 AUDIT 每个格子都填数字'继续投入。"

**我的处置**：FAB 记为
`FAB_VISIBLE_DIAMETER: NOT_MEASURED_RELIABLY` ／ `PRODUCT_CHANGE: NONE`，
径向拟合法记入"未来可选方法"，**本轮不投入**。

## 四、不需要再补"未激活态 tab"取证

> "因为你已经有第二条独立证据：原版截图中的三个项目都是图标上、文字下。
>  这本身已经覆盖激活和未激活 tab 的排布方向。
>  现在真正没证据的是：未激活态的图标尺寸、字号、颜色、精确间距是否和激活态完全一致。
>  但 WO#6 并不准备改这些。"

**冻结的表述**：
```
ACTIVE/INACTIVE ORIENTATION:   SUPPORTED（三个可见 tab 全部竖排）
INACTIVE EXACT SIZE/STYLING:   NOT_EVALUATED
IMPLEMENTATION:                只改共享的 orientation/alignment，保留既有 active/inactive 视觉规则
```

## 五、⭐ 测量检查清单：补第 5 条（**semantic box 相同**）

审核指出我这次的自我纠正（"**可点区高度 ≠ 可见栏高度**"）与既有的
`pitch ≠ gap`、`relative ≠ absolute 坐标` 属同一类：

> "不同 semantic box 不能直接比较，**即使它们单位相同**。
>  171px 的 clickable node bounds 与约 100px 的 visible bar，本来就不是同一个量。"

**已写入 PLAN 的测量清单（比较前必须确认五条）**：
```
1. definition 相同
2. unit 相同
3. coordinate frame 相同
4. **semantic box 相同**   ← 本次新补（clickable node ≠ visible bar）
5. sampling / measurement method 有判别力
```
> "第 4 条正是这次新补出来的。"

## 六、(B) 格清空后的优先策略：审核认可我的处理

> "既然当前 A/D 表已经更新，没必要机械执行我基于旧 revision 给出的'优先 B'。
>  以后应按当前账本选，而不是按类别名字硬排。
>  你现在这个 WO#6 的价值确实高：强证据 + 明确真实差异 + 高频可见 + 修法简单
>  + 无第三方写入 + 无新依赖。这正是 M5 当前应该优先清的项目。"

→ **规则更新**：优先级按**当前账本**（

AUDIT 的 (A)/(B)/(C)/(D) 实时状态）选，不按类别名硬排。
