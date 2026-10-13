# G3：`(D)` 类的定性收口 + 静态扫描**意外浮现**的候选缺口

> 时间：2026-09-22 01:56｜依据：审核记录 40「按当前账本选」+ 记录 41 的下一步顺序
> 方法：**静态 APK 分析**（零设备交互、零写入风险），APK sha256 已核验与基线一致

## 一、`PER_USER_QUOTA`：如实记为"现有方法取不到"

```
PER_USER_QUOTA_CONFORMANCE = EVIDENCE_NOT_OBTAINABLE_BY_CURRENT_METHODS
```

**取证尝试（可复现）**：`scripts/m5/probe-original-quota.sh`
扫描原版 APK 资源表 51874 行，关键词：quota / limit / maxcount / storage / capacity /
exceed / overflow / insufficient / too_large / oversize / remain_count / daily_limit / month_limit
+ 中文：配额 / 上限 / 达到 / 限制 / 不足 / 超出 / 已满 / 剩余 …

**结果**：
```
"配额/按用户累计量"类资源与文案: **未命中**
  （"quota" 只命中 ic_quotation_mark —— 那是"引号"图标，与配额无关）
```

⚠️ **声明强度（不许夸大）**：
- 未命中只说明"**没有这些明显命名的资源/文案**"
- **不等于**原版没有 per-user 配额（可能是服务端策略、无 UI 文案、或命名不可猜测）
- → 所以结论只能是"**现有方法取不到**"，**不能**写成"原版没有配额"

## 二、⭐ 扫描**意外浮现**的真实候选缺口（原版自己的字符串资源）

同一个扫描把原版 chat 的**自身文案**（`im_chat_*` / `capa_*`）暴露出来了，
它们直接说明**原版有、而我方没有**的东西：

| 原版资源 | 中文文案 | 我方现状 | 性质 |
|---|---|---|---|
| `string/im_image_size_exceed` | **该图片尺寸超过最大限制** | **无尺寸上限**（只有体积 5MB） | 候选缺口（需渲染证据定阈值） |
| `string/im_chat_video_duration_exceeded` | 视频时长超限 | **完全没有视频消息** | 候选缺口（大件，另立） |
| `string/im_chat_media_pause` / `_resume` / `_seek` / `_progress` | 暂停视频 / 继续播放视频 / 视频播放进度 / `%1$d%%` | 无 | 同上（视频播放器 UI） |
| `string/im_chat_media_saving` / `_save_success` / `_save_failed` / `_save` | 正在保存至相册 / 保存成功 / 保存失败 / 保存 | **无"保存到相册"** | 候选缺口 |
| `string/im_chat_media_retry_unavailable` | **本地媒体已失效，无法重新发送** | 无（我方失败只提示原因） | 候选缺口（重试语义） |
| `string/im_chat_media_storage_insufficient` | 存储空间不足，无法发送所选媒体 | 我方有 507 但文案不同 | 文案差异 |
| `string/im_chat_record_error` | **语音录制失败，请重试** | 我方："录音失败：…" | **文案差异**（WO#5 相关，可低成本对齐） |
| `string/im_chat_send_msg` | 发消息… | 我方 placeholder 相同 ✓ | **一致** |
| `string/im_chat_media_network_error` | 网络错误，请重试 | 我方文案不同 | 文案差异 |

**最值得注意的一条**：`im_image_size_exceed` = **"该图片尺寸超过最大限制"**
→ 原版对图片有**像素尺寸**上限（不只是体积），而我方**只有体积上限**。
这与 AUDIT 里 `(D)` 的"图片压缩/重编码"是**不同**的一条：
- 压缩 = 上传前重编码（证据取不到）
- **尺寸上限** = 一条**拒绝规则**，原版明确有文案 → 更可能可得证据（但阈值需取证）

## 三、我方当前的上限（对照）

```
server/src/index.ts:
  const MEDIA_MAX_BYTES = 5 * 1024 * 1024   // 单图 ≤ 5MB（唯一的上限）
  → 用在 upload 的 fileSize limit 与 buf.length 检查
全仓搜索 maxWidth / maxHeight / maxDuration / 尺寸上限 / 时长上限: **无**
```
→ 我方上限 = **只有体积**；**无尺寸、无时长**。

## 四、这些候选缺口**为什么现在不报 WO**

按既有纪律（避免"凭资源名驱动实现"）：
```
1. 这些都是**资源/文案**证据 —— 与"用 id 名推断行为"是同一类风险的近亲
   （本项目已 4 次栽在 id 名上：ivClose / tvTotalComment / emotion_image / collageView）
2. 尤其"尺寸上限"：我知道**有这条规则**，但**不知道阈值是多少**
   —— 不知道阈值的实现必然是编的
3. 视频消息是**大件**（播放器 UI + 上传 + 渲染 + 进度），需单独立单
4. 文案差异（语音录制失败 / 网络错误）是**低风险、可低成本对齐**的一类，
   但仍应先确认"是否要求逐字一致"（属 Conformance 口径问题，需审核裁定）
```

## 五、处置

```
✅ 已完成（本轮）:
   · PER_USER_QUOTA → EVIDENCE_NOT_OBTAINABLE_BY_CURRENT_METHODS（含可复现脚本与强度声明）
   · 把上述候选缺口**登记在册**（本文件即登记），并写进 AUDIT 的 (D) 区
⏳ 需审核裁定后才动:
   · 图片尺寸上限：是否需要？阈值如何取证（只读手段能否拿到？）
   · 视频消息：是否在范围内（这是一个新的媒体类型，工作量远超"缺口修补"）
   · 文案逐字一致：Conformance 要求到什么程度
❌ 明确不做（无证据，不猜）:
   · 任何"按资源名推断出来的"上限阈值
```

## 六、可复现

```
C:\Program Files\Git\bin\bash.exe 'G:/demo map/scripts/m5/probe-original-quota.sh'
# 或手工：
aapt2 dump resources <apk> | grep -i -E 'quota|limit|exceed|too_large' | head
```

---

## 七、已核对归属的原版文案（**不凭印象归属**）

起因：我在 AUDIT 里一度把"该图片尺寸超过最大限制"归给 `string/im_image_size_exceed`，
但扫描输出显示那句话实际来自 `string/capa_import_too_large_image`。
**归属错文案 = 造出一个不存在的证据**，故用脚本把「资源名 ↔ 文案」严格对应起来核对
（`tools/tmp/verify-string-attribution.sh`，按 `resource 0x… string/<name>$` 精确匹配后读下一行）。

**核对结果（逐条，均已确认归属）**：

| 资源名 | 文案（原文） | 我方现状 |
|---|---|---|
| `string/im_chat_send_msg` | **发消息…** | placeholder 相同 ✓ **一致** |
| `string/im_image_size_exceed` | **图片尺寸超过限制（8000px）** | **无尺寸上限** → 候选缺口，**阈值明确=8000px** |
| `string/im_image_upload_failed` | 发送失败 | 我方文案不同 |
| `string/im_chat_video_duration_exceeded` | **视频时长超过2分钟，暂不支持发送** | 无视频 |
| `string/im_chat_media_storage_insufficient` | 存储空间不足，无法发送所选媒体 | 我方 507 文案不同 |
| `string/im_chat_record_error` | **语音录制失败，请重试** | 我方："录音失败：…"（WO#5 相关，可低成本对齐） |
| `string/im_chat_summary_image` | **[图片]** | 我方 `IMAGE_MESSAGE_BODY='[图片]'` ✓ **一致** |
| `string/capa_import_too_large_image` | 该图片尺寸超过最大限制 | （发布/相机模块，非 chat） |
| `string/capa_import_too_large_video` | 该视频尺寸超过最大限制 | 同上 |
| `string/capa_select_photo_limit` | 可选 %1$d 张图片 | 同上（选图数量上限） |
| `string/capa_post_video_size_over_limit` | 视频大小超过 200M，暂不支持发布 | 同上 |

### 7.1 ⭐ 本轮**最有价值的一条**：图片尺寸上限**阈值有证据**

```
string/im_image_size_exceed = "图片尺寸超过限制（8000px）"
  · 属 chat 模块（im_*），不是发布模块（capa_*）
  · **阈值 8000px 直接写在文案里** —— 这是少见的"规格自带数值"情形
  · 我方对照：只有体积上限 MEDIA_MAX_BYTES = 5MB，**没有任何尺寸上限**
```

**但仍有两点未确证，实现前必须解决**：
```
1. 8000 指的是"任一边 > 8000px"还是"总像素/面积"？文案只说"尺寸…（8000px）"
2. 是**客户端先拦**（选图时提示）还是**服务端拒绝**？原版文案出现在 im_* 命名空间，
   更像客户端提示；但**没有行为证据**
→ 因此本项仍**不能直接实现**：修法（在哪一层拦、按什么口径）还不明确。
```

### 7.2 另一条待查线索（登记，不扩散）

`string/im_chat_revoke` = **"撤回"**，且 APK 内有 `im_long_press_menu_layout` /
`im_layout_long_press_menu_item` 布局 → 原版有**长按菜单**与**撤回动作**。
我方：有撤回的**显示**（`bubble__revoked` + 服务端 `deleted_at`），
但**是否有撤回动作的入口**尚未核对 → 记为本批线索，待专项核对。
