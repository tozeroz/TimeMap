WO#2 前端已提交（2da713f）；跨层常量检查 C1 覆盖缺口**已关闭**（我独立复跑确认）

【提交内容（2da713f，4 文件 +814/−32）】
  app/src/api/client.ts                   +135   上传函数（FormData: file/purpose/uploadRequestId）
  app/src/screens/ChatScreen.tsx          +160   选图 → 上传 → 发消息 → 重拉列表
  app/src/screens/chat.css                 +53   相册入口与上传中/失败态样式
  scripts/m5/device-chat-image-check.mjs  +498   设备端验证脚本（子代理自写）

【我做的独立核验（不是采信汇报）】
1. 前端确实发出 purpose：
     client.ts:189  form.append('purpose', purpose)
     client.ts:185  purpose: 'post' | 'chat'
2. **跨层常量检查由 FAIL 转 PASS**（我本地复跑 scripts/m4/verify-cross-layer-constants.sh）：
     PASS C2 imageProbe 的 mime 全部在 nginx 里声明
     PASS C3 退出码 2 / 3 在代码里真实存在
     PASS C4 备份脚本与业务侧使用同一把锁
     CROSS_LAYER_CONSTANTS_RESULT PASS
   → **存在已久的 C1 覆盖缺口（"app 从不发送 purpose"）就此关闭**，
     它同时是 WO#2 的收口判据之一。

【纪律注记：容器清理被工具策略拦下（记录而非硬绕）】
子代理遗留的 docker 容器 wo2-pg（已 Exited 0）无法由我清理：
本会话的命令守卫对 `docker rm` 与 `rm -rf` 一律返回
"cannot statically verify deletion inside opaque shell syntax"。
子代理也遇到同一拦截并如实报备过。
→ **处置：不改写绕道、不换命令硬试**（那正是本项目禁止的"绕道"），
  如实记为"需运维/用户在会话外执行一次容器清理"。
  影响面：容器已退出、不监听端口，仅占磁盘与一个容器名，**不影响任何功能或验证**。
  另注：`--format '{{.Names}}'` 这类 Go 模板的**花括号**也会触发同一守卫
  （被误判为 brace expansion），写命令时避免使用。

【当前 WO#2 状态】
  WO2_BACKEND:  ACCEPTED
  WO2_FRONTEND: 已提交，待子代理汇报其真机验证结论后，由我核验
  WO2_OVERALL:  IN_PROGRESS（等前端真机证据；不能只凭"代码写了"就记完成）
  M5 服务器侧 Gate: PASS（全键）
  C1 跨层缺口: 已关闭

---

## 补充更正（2026-09-21 18:57）：按审核记录 25 的要求**永久分列两层证据**

本文档上面写的是笼统的"真机 PASS"。**这违反了审核记录 25 的明确要求**：

> 这份证据可以证明：**WebView 已经获得 File 对象之后的完整产品链路**。
> 所以不是 mock，也不是无效测试。**但不能把它写成"真实用户完整选图 E2E"。**
> 建议永久分成：
> ```
> FILE_INPUT_POST_SELECTION_E2E:  PASS
> NATIVE_FILE_PICKER_INTERACTION: NOT_YET_VERIFIED
> ```
> 这样以后不会有人把两层混在一起。

**因此本文档的说法更正为**：

```
FILE_INPUT_POST_SELECTION_E2E:  PASS
  证据: DOM.setFileInputFiles 把文件交给 input（走浏览器自己的 file-chooser 管线），
        之后的 上传 → 发消息 → 重拉列表 → blob 渲染 → 重载后仍在 全链路真实、无桩。
        真机断言: 上传 201 / 发消息 201 / 图片 naturalWidth>0 / 气泡数 3→4 / 重载后仍在。
        失败路径: 非图片 → 界面红字「发送失败」、气泡数不变（无幽灵消息）。

NATIVE_FILE_PICKER_INTERACTION: NOT_YET_VERIFIED
  缺口: 未证明"用户点击选图入口 → Android 系统 picker 真的出现 → 在 picker 里选了一张图
        → WebView 真的收到 File"。
  状态: WO2_FINAL_CLOSE = HOLD（审核记录 25）；正在由子代理自动化这一步
        （脚本 scripts/m5/device-native-picker-check.mjs，用 uiautomator + adb input
         驱动真实系统选择器，不引入人工）。
```

**为什么这个更正重要**：笼统写"真机 PASS"会让后来者（包括我自己）以为
"用户从真实入口选图"这条路径已被验证过 —— 而它没有。
这与本项目反复出现的主题一致：**措辞的精确性就是证据的精确性**
（前面已有两例：把 pitch 写成 gap、把"功能闭环"写成"页面一致性已收敛"）。
