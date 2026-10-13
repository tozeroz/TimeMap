# LICENSING-NOTES —— 第三方资产来源与使用边界登记

> 建立于 2026-09-22（审核记录 43 第 3 点要求：把"原样复制第三方图形资产"
> 单独做一次 licensing/IP 清查，且**不要让它只存在于 review-log 里而被忘掉**）
>
> ## 本项目的定位（决定本文件的性质）
>
> ```
> 当前：**私有复刻 demo** —— 对照学习某第三方 App（com.kairuotu.campus）做 1:1 复现，
>       用于演示与工程验证。不是公开项目、不做商业发布。
> ```
> 在这个定位下，本文件**不阻塞**任何开发工作；它的作用是：
> **一旦将来决定公开或商业发布，能立刻知道哪些资产必须先处理。**

## 一、逐字复制自第三方 APK 的资产（**发布前必须处理**）

| # | 路径 | 内容 | 来源 | 发布前处置 |
|---|---|---|---|---|
| 1 | `app/src/components/icons-send.tsx` | 发送按钮的两条 `pathData`（黑色胶囊 + 白色纸飞机） | 原版 APK `drawable/ic_send_msg_btn` → `res/JA.xml`（矢量 XML，**逐字复制**） | 需**自绘视觉等价**图标；该文件已有 `ASSET_ORIGIN` 标记 |
| 2 | `docs/test/original-baseline/supplements/original-emoji-table.txt`<br>`docs/test/original-baseline/supplements/original-emoji-path-map.tsv` | 154 个表情的拼音名 / 中文名 / 资源引用 | 原版 APK 资源表（`array/xhs_theme_xhs_emoji_res_v2`） | 仅作**证据**使用；如发布需评估（这些是**名称与路径**，非图形本体） |
| 3 | `docs/test/original-baseline/screens/**`、`docs/test/original-baseline/raw-dumps/**` | 原版界面截图、控件树 dump | 只读观察第三方 App | 仅作**证据**；发布前评估是否包含可识别内容 |
| 4 | `.mumu-capture/apk/target.apk` | 原版 APK 副本（172MB，sha256 `3373B6B2…D6C294`） | 从设备取出的第三方应用包 | **不在仓库里**（已核实：未被 git 跟踪；`.gitignore:31` 的 `.mumu-capture/` 命中，另有全局 `*.apk` 规则；仓库中无任何被跟踪的 `.apk`）。仅本地取证用 |
| 5 | `app/src/**` 其它"按原版截图/资源复刻"的图标与样式 | 各 `Icon*` 组件、颜色/尺寸 token | 多为**按观感重绘**（非逐字复制），少数形状接近 | 逐个核对来源；见下面 §三 的检索方法 |

## 二、明确**不**受本文件影响的资产

```
· 我们自己写的代码（React/TS/Fastify/SQL）—— 归本项目
· 我们自己的截图与 dump（对**我方 demo** 的观察产物）
· 开源依赖（React / Fastify / pg / Capacitor …）—— 各自许可证，常规合规即可
```

## 三、检索方法（怎么找出"还有哪些文件源自第三方"）

```bash
# 1) 找显式标记的文件
rg -n "ASSET_ORIGIN|PUBLICATION_BLOCKER" app/ docs/ scripts/

# 2) 找引用了原版资源路径/资源名的文件
rg -n "res/[A-Za-z0-9_-]+\.(xml|webp|png)|ic_send_msg_btn|im_chat_|xhs_theme" app/ docs/ | head -50

# 3) 找"按原版复刻"的注释线索
rg -n "原版|复刻|照抄|逐字" app/src/components/ app/src/screens/
```

## 四、标记格式（约定，供检索）

写在文件的注释里（代码）或正文里（文档）：

```
ASSET_ORIGIN:        COPIED_FROM_THIRD_PARTY_APK        # 逐字复制
ASSET_ORIGIN:        DERIVED_FROM_OBSERVATION           # 按观察重绘（较弱）
PUBLICATION_BLOCKER: LICENSE_REVIEW_REQUIRED            # 公开发布前必须先处理
```

## 五、发布前的动作清单（对应 NEXT-ACTIONS I 区）

```
I1  逐项清查上表，决定 保留 / 替换为自绘等价物 / 移除
I2  本文件（已完成 ✅）
I3  若公开：为图标做"视觉等价但非直接复制"的重绘，并保留 ASSET_ORIGIN 注释以便溯源
```

⚠️ **诚实说明**：本文件由我在审核提醒后建立，**不是法律意见**；
真正的公开发布决策前应由项目所有者做一次正式的许可/合规判断。
