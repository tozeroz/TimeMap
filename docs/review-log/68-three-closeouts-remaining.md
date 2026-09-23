# 审核 68：只剩**三个具体 closeout**，其余不再考古

> 时间：2026-09-23 09:27（Round 319）｜我提交：WO#22 + WO#23（附 5 个具体问题）

## 一、总裁定

```
WO22_SCANNER_REAL_QR:      **HOLD**
WO23_UPDATE_CHECK:         **PASS**
WO23_APP_SELF_UPDATE:      **HOLD**
WO21_PUBLISH_MEDIA_ATTACH: **STILL HOLD**
M5_EXPERIENCE_COMPLETION:  **HOLD**
```
> "这次 HOLD 已经不是继续扩方法学，而是只剩 **3 个非常具体的能力闭环**。"
> "**不要再进行『全项目找新问题』**。只做这三个 closeout。"

## 二、⭐⭐ 三个必须销项的点

### ① WO#21 —— **audio typed persistence / readback**（这条是我的**真实缺陷**）

> "当时唯一的 P0 是：audio upload → post_media → GET post →
>  **audio still represented as audio** → **audio NOT in images**"
> "上一版 API 的 read model 是 `images: [{ id, width, height }]`，
>  所以在没有看到新证据之前，我不能假定这个问题已经自己消失。"

要求销项时给出：
```
上传 audio → media id = X
→ POST 含 X
→ post_media row exists
→ GET post
→ **X appears under audio/attachments**
→ **X absent from images**
以及对应 schema / 实际响应
```
⚠️ 另需明确：如果当前 Feed **根本无法播放**这个 audio ⇒ 必须写
```
VOICE_CONSUMPTION: **NOT_IMPLEMENTED**
```

**我的自查（确认这是真缺陷）**：我的 `POST /api/posts` 把传入的**所有** mediaId
一律写进 `post_media`（`media_scope='public'`）；而 `GET` 的读模型把
`post_media` 里**所有**行都放进 `images: [{id,width,height}]`
⇒ **一条语音帖会把 audio 也报成 image**（width/height 为 null）。
⇒ 必须把读模型按 mime 分流，并让"语音"成为一个**独立的附件类型**。

### ② WO#22 —— 一次**真实 QR 端到端**解码

> "`SCANNER_DECODES_ACTUAL_QR: NOT_EVALUATED` 恰好就是 Owner 要求实现的**核心能力本身**，
>  因此这一个 NOT_EVALUATED **不能**和视觉类 NOT_EVALUATED 一样放过。"
```
做法（最简单即可，不用再写 Gate 框架）：
  生成内容固定的 QR，例如 campus-scanner-e2e-20260923
  → 放到另一块真实屏幕/手机上
  → MuMu 当前摄像头对准
  → 页面应实际进入 found
  → **decoded payload 必须逐字等于预期值**
  → 不触发任何业务动作
完成一次即可：SCANNER_REAL_QR_E2E: **PASS** ⇒ WO#22 可以 CLOSED
```
⚠️ "若这条环境路线确实做不到，也可以拿实际 Android 真机做一次。"
⚠️ `SCANNER_TARGET_SCAN_FLOW` 继续 NOT_EVALUATED **没关系**；
   当前"中性显示真实 payload"的处理**被接受**；**不要猜**入群/签到/网页跳转。

### ③ WO#23 —— Owner 要的是"自更新"，当前只有"更新检查"

> "**real update check ≠ app self-update**"
```
现在可以判：APP_UPDATE_CHECK: PASS ／ WO23_UPDATE_CHECK: CLOSED
但不能判 APP_SELF_UPDATE: PASS。准确状态：
  UPDATE_DISCOVERY: PASS ／ VERSION_COMPARISON: PASS ／ NO_FAKE_UPDATE: PASS
  APK_DOWNLOAD:        NOT IMPLEMENTED
  INSTALL_HANDOFF:     NOT IMPLEMENTED
  END_TO_END_UPDATE:   NOT IMPLEMENTED
```
两条合法出路：
```
A. Owner 把目标明确缩为"真实版本检查" ⇒ 当前 WO23 可以 CLOSED
B. 保持 Owner 原裁定"App 自更新" ⇒ 还必须至少完成一次：
     newer release → actual APK available → 用户点击更新 → **下载/打开 Android 安装流程**
   "这不是我要求像应用商店一样做复杂 OTA；至少要让『立即更新』真的能把用户带入
    一个可安装的新 APK 流程，而不是只有检查能力。"
⇒ 按我报告的 Owner 决策，目前应采用 **B**，除非 Owner 重新改 scope。
```

## 三、审核明确**不再需要考古**的（避免我重新扩张）

```
ORIGINAL_UPDATE_FLOW ／ SCANNER_TARGET_SCAN_FLOW ／ 原版视觉细节 ／
emoji 精确字符 ／ 学院列表是否完整
  + WO10.9 / WO14.6（若只是历史关账措辞、既有语义记录，不要无理由重开）
  + I3（属后续视觉设计/发布事项，**不应**重新成为 Experience M5 blocker）
```

## 四、已获认可的（本轮我的判断被确认的部分）

```
· liveCamera + jsQR 路线**认可**（"比此阶段引入新的原生 MLKit 插件更合适"）
· jsQR 依赖**认可**（"符合当前『最小实现面』的要求"）
  ⚠️ 只需把它纳入 I1 的第三方依赖/license inventory，**不要因此再开专项**
· 两条 Gate 修正**认可**：
    SCANNER_STATE_IS_EXPLICIT 语义正确
    SCANNER_VIEWFINDER_BACKED_BY_REAL_VIDEO **尤其好** ——
      "真正需要禁止的从来不是『取景框这个 DOM』，而是
       **没有真实 camera stream，却画一个装饰取景框冒充扫码**"
· 固定 sleep → 轮询终态**正确**（"15 秒仍未终态时 INCONCLUSIVE 比误判 PASS/FAIL 合理"）
· 那次被污染的回归**已被正确废弃**（"最终只能使用后来的 clean rerun"）
```

## 五、销掉这三项之后

> "这三项销掉后，再**做一次最终干净 regression**，如果仍全绿，
>  我就认为已经具备真正关账 M5 的条件。"
