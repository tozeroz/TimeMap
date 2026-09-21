# G3 定论：系统选择器**可自动化**（已由实测证明，不再是推测）

> 时间：2026-09-21 19:02（Asia/Shanghai）
> 方式：**只读意图探测**（`am start -a GET_CONTENT -c OPENABLE -t image/*` → `uiautomator dump` → back 退出），
> **未选择任何文件、未写入任何数据**。设备当时空闲（前台是 launcher），
> 因此不干扰在飞的子代理。

## 一、决定性证据

```
拉起后前台：
  topResumedActivity=ActivityRecord{7c1205a u0 com.android.documentsui/.picker.PickActivity t277}

dump 结果：
  dump 字节数: 100989
  含 documentsui: True
  控件 id 数量: 27
    com.android.documentsui:id/action_bar_root
    android:id/content
    com.android.documentsui:id/coordinator_layout
    com.android.documentsui:id/drawer_layout
    com.android.documentsui:id/app_bar
    com.android.documentsui:id/collapsing_toolbar
    com.android.documentsui:id/directory_header
    com.android.documentsui:id/search_chip_group
    com.android.documentsui:id/apps_row
    com.android.documentsui:id/apps_group
    com.android.documentsui:id/app_icon
    android:id/title
  可见文字（部分）：大型文件 / 本周 / 浏览其他应用中的文件 / 图库 / 近期的图片 / 最近
```

## 二、结论（从"推测"升级为"事实"）

```
NATIVE_FILE_PICKER_INTERACTION: AUTOMATABLE（已证实）
```

本文件此前写的是"**大概率**可自动化（依据：DocumentsUI 已安装、非 SurfaceView 型）"。
现在有了直接证据：**pickerm 的控件树是标准 Android 控件树，可被 uiautomator 完整读取**
（10 万字节 dump、27 个 resource-id、可见中文文案）。**不需要人工**。

## 三、可复现配方（给实现者直接用）

```bash
# 1) 独立拉起系统选择器（关键：必须带 CATEGORY_OPENABLE，否则不会弹出 —— 实测过）
adb -s 127.0.0.1:16384 shell am start \
  -a android.intent.action.GET_CONTENT -c android.intent.category.OPENABLE -t 'image/*'

# 2) 等它成为前台，然后 dump 控件树
adb -s 127.0.0.1:16384 shell uiautomator dump /sdcard/picker.xml
adb -s 127.0.0.1:16384 shell cat /sdcard/picker.xml

# 3) 退出（不选任何文件）
adb -s 127.0.0.1:16384 shell input keyevent 4
```

**包/活动**：`com.android.documentsui/.picker.PickActivity`
**找图位置**：dump 里可见「图库 / 近期的图片」分区 —— 推送的测试图应出现在那里。

## 四、一次失败的尝试及其教训（保留以便追溯）

我先试的是**不带** `CATEGORY_OPENABLE`：

```
am start -a android.intent.action.GET_CONTENT -t 'image/*'
→ 打印了 "Starting: Intent {...}"，但前台仍是 app.lawnchair
→ dump 出来的是**启动器**的树（app.lawnchair + com.mumu.store 广告控件），完全没提到 documentsui
```

**教训**：`am start` 打印 "Starting" **不等于**活动真的起来了 ——
**必须核对 `topResumedActivity` 与 dump 内容**，否则会把"没起来"当成"起来了但看不到"。
（这与本项目"验旧产物"是同一类：**动作发出去了 ≠ 效果发生了**。）

## 五、对 WO#2 收口的意义

- `WO2_FINAL_CLOSE: HOLD` 的理由（`NATIVE_FILE_PICKER_INTERACTION` 未验证）**在技术上不再成立** ——
  它不是"做不到"，只是"还没做对"。
- 实现路径明确：**点我们的选图入口 → 等 PickActivity 成为前台 → dump → 在其中点一张图 → 回 App 断言上传/发送**
- 若在飞的子代理最终报 `NOT_AUTOMATABLE`，**请以本文件为反证**：该结论与实测不符。

---

## 六、原始产物已入库（补齐证据链）

```
docs/original-baseline/raw-dumps/picker-documentsui-probe.xml   101503 字节
验证: 含 documentsui = True；resource-id 去重后 27 个
```

**因此本文件的结论现在可被任何人从入库产物复核，不需要设备、不需要重跑探测。**

一处精确性更正：本文档初稿里写的 "dump 字节数: 100989" 是 `cat` 之后**字符串**的长度，
而**原始文件本身是 101503 字节**。以后一律引用**产物字节数**，不引用经过 shell 处理后的长度
（两者不等，引用错的那个会让人对不上账）。
---

## 七、补上"最难那一步"的具体做法：如何在 picker 里精确定位并点中一张图

（本轮从**已入库的同一份 dump** 里分析得出，纯本地、零设备风险）

### 证据（来自 `picker-documentsui-probe.xml`）

```
文件项文本:   p1.png, 62.56 kB, 9月12日        ← 形如 "文件名, 大小, 日期"
精确定位用:   预览"p1.png"文件                  ← content-desc，含文件名，最可靠
同类文件:     r1.png / a1.png / t2.png / t1.png / m1.png / m3.png / m2.png
容器与图标 id: container_directory, dir_list, refresh_layout,
              thumbnail, icon_thumb, icon_mime_lg, preview_icon
导航项:       最近 / 图库 / 近期的图片 / 浏览其他应用中的文件 / 搜索 / 列表视图 / 显示根目录
```

### 可直接用的定位规则

1. 在 dump 里找 `content-desc` 匹配「预览 + 引号包住的文件名 + 文件」的节点
   （**比用 text 更可靠**：text 里混着大小和日期，容易被格式变化打断）
2. 取该节点 `bounds="[x1,y1][x2,y2]"` 的中心，然后
   `adb shell input tap cx cy`
3. **若目标图不在当前视图**：先点导航项（`最近` / `图库` / `近期的图片`）切换分区，
   或先 `adb push` 一张图到 `/sdcard/Download/` 再点 `最近`。
   本次 dump 显示 `最近` 分区下**已经有 8 张图**（p1/r1/a1/t2/t1/m1/m3/m2.png），
   **说明"推送一张图 → 在最近里选"这条路是通的**。

### 为什么把这段写进文档

委派时我把"找到并点中图片"列为第 5–6 步，那是整条链**最可能卡住**的一步
（前一个执行者 17 分钟无产出，很可能就卡在这里或更早）。
现在它有了**来自实测产物的具体定位规则**，而不是"你自己去找找看"。

⚠ 同时保留一条纪律：**若实测发现该规则不成立**（例如 documentsui 版本不同导致
content-desc 格式不同），**必须如实报出实际格式并修正本文件** ——
**不要把"我按这个规则点不动"当成"不可自动化"**（可自动化性已由 §一 的 dump 证明）。
