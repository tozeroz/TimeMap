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
