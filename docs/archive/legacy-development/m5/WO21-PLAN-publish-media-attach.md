# WO#21 计划：「发帖媒体附件」——让发布页的**图片与语音**真正进服务器

> 依据：Owner 的 scope 裁定（2026-09-23）
> ```
> 只排除 ② 认证「下一步」流程
> ① 扫码实际扫码 / ③ App 自更新 / ④ 发布页语音真实录音 ⇒ **必须实现体验等价**
> ```
> 时间：2026-09-23 07:34（Round 319）

---

## 〇、先说一个**查证中发现的更大缺口**（决定本 WO 的真实范围）

```
我在准备 ④ 时查了后端，发现：
  · `POST /api/posts` 是**严格 schema**：只接受 body/place，多一个字段就 400
  · `post_media` 表**存在**，但服务端对它的三处引用**全是 select**（行 742/748/1003）
    ⇒ **没有任何接口能把媒体挂到帖子上**
  · 客户端 `createPost({ body, place })` **根本不传图片**
  · `PublishScreen.doPublish` 的注释自己写着：
      "M1 只同步文本（图片上传是 M4）。带图的帖子：**图片留在本地**，文字部分同样会进服务器。"
    ⇒ 而 M4 做了媒体上传（uploadMedia / media 表），**却从未接上 post_media**
⇒ 所以真实的缺口不是"语音不能录"，而是：
    **发布页的图片与语音都只存在于本机，从未随帖子进入服务器。**
  ⇒ ④ 的正确最小实现 = 打通 **发帖媒体附件**（语音与图片**共用**同一机制）
     —— 只做语音而不修图片，会让"发帖带图"这一核心体验继续不一致。
```

## 一、目标（可验收的形态）

```
① 后端：`POST /api/posts` 接受可选 `mediaIds: string[]`
   · 只接受 **public** scope 的媒体（`post_media` 的复合外键本来就钉死 scope='public'）
   · 校验：id 存在、scope=public、**属于当前会话用户**（不能把别人的图挂到自己帖子上）
   · 事务内插入 post_media（position 递增）
   · 响应里带回 `images`（与 `GET /api/posts/:id` 口径一致）
② 客户端：`createPost({ body, place, mediaIds })`
③ 发布页：
   · 拍摄模式：照片 → `uploadMedia(f, 'post')` → mediaIds → 随帖提交
   · 语音模式：**真实录音**（复用 `native/recorder.ts`）→ `uploadMedia(blob, 'post', durationMs)`
     → mediaIds → 随帖提交
   · 删除「（录音功能尚未接入真实麦克风）」这句说明（它不再成立）
   · 保持既有原则：**上传失败绝不本地假成功**；失败要明确报错并保留草稿
④ 门禁 + 敏感度（每键可复算）
```

## 二、⚠️ 明确**不做**的（避免扩张）

```
· 不改 `media` 表结构、不改 scope 语义、不改 cleanup-unattached
· 不实现"编辑已发布帖子的媒体"（原版是否支持**未观察**）
· 不改拍摄/语音的**视觉样式**（审核 67：纯视觉属 non-blocking backlog）
· 语音的**实际交互形态**（按住在哪、松手后如何预览）：
    基线 `publish` 的 `known_unknowns` 明确写着"**语音模式的真实录音交互**"**未观察**
    ⇒ 我采用**与 ChatScreen 语音一致**的交互（按一下开始/再按一下发送？保持与该屏一致）
      —— 这属 **OUR_DESIGN_CHOICE**，**不声称**与原版一致
· 原版「语音」录完之后的**去向**（是否入草稿、是否发帖）**未观察** ⇒ 记 NOT_EVALUATED
```

## 三、术语口径（防夸大）

```
POST_MEDIA_ATTACH_ENDPOINT:      新增（本 WO）
PUBLISH_IMAGE_ATTACH:            从"仅本地" → **真的进服务器**
PUBLISH_VOICE_RECORDING:         从"占位波形" → **真实录音 + 真实上传**
ORIGINAL_PUBLISH_VOICE_EXPERIENCE: **NOT_EVALUATED**（基线自己写的是 known_unknown）
PUBLISH_MEDIA_LAYOUT:            **NOT_EVALUATED**（原版帖子里图片/语音怎么排布未观察）
```
⚠️ 依审核 67：本 WO 完成后仍需区分 `TRUTHFULNESS: PASS` 与 `FEATURE_PARITY`
   —— 我会分别报，不会因为"不再假"就算等效。

## 四、风险与回滚

```
· 风险：改动 `POST /api/posts` 的 schema ⇒ 既有 Gate 可能因"多字段"而受影响
  ⇒ 应对：mediaIds 是**可选**的；不传时行为与现在**完全一致**（向后兼容）
· 风险：上传后发帖失败会留下**未被引用的 media** ⇒ 服务端已有 cleanup-unattached 回收
  （脚本 scripts/m5/verify-cleanup-unattached.sh）
· 回滚：三处改动各自独立可回（后端字段 / 客户端参数 / 发布页逻辑）
```

## 五、验证计划

```
1. 后端：新增 gate-media-attach（服务器侧）：
   · 无 mediaIds 时行为与旧版一致（回归）
   · 带 public mediaIds ⇒ 帖子的 images 里出现该媒体
   · 带**别人的** mediaId ⇒ 拒绝（归属校验）
   · 带不存在的 mediaId ⇒ 拒绝
   · 带 private（chat）mediaId ⇒ 拒绝
2. 前端：gate-publish-media（设备侧）：
   · 语音模式：有"开始录音"入口、真实计时、录完产生可上传的媒体
   · 不出现「录音功能尚未接入真实麦克风」
   · 上传失败 ⇒ 明确报错、**不**本地假成功（保持既有原则）
   · 图片：选图后发布 ⇒ 服务器帖子带上 images
   ⚠️ 语音的真实录音需要**麦克风权限**——真机上 Gate 需处理权限弹窗
3. 敏感度：把"只本地"和"占位波形"两个旧形态分别注入 ⇒ 断言必须变红
```
