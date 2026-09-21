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