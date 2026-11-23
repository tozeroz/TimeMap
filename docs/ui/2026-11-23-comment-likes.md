# 评论点赞与消息中心同步（048）

日期：2026-11-23。范围：评论点赞、评论点赞的消息中心通知，以及校园活动与管理端筛选的体检记录。

## 1. 本次做的事

| 需求 | 结果 |
| --- | --- |
| 评论可以点赞 | 新增 `comment_likes` 表与 `POST/DELETE /api/comments/:id/like`；评论列表逐条返回点赞态 |
| 评论点赞同步到消息中心 | 消息中心「点赞」分类下新增事件源，文案为「赞了你的评论」，**不新增入口** |
| 维护校园活动 | 体检：学生侧列表/详情/收藏 + 管理端录入/修改全跑通，**未发现功能缺陷** |
| 拍照打卡/校园故事由管理员按用户帖子筛选 | 核对：代码已实现（047、`curationRoutes.ts`、`AdminCuration.tsx`），边界全部正确，**未发现缺口**；补了自动化测试 |

## 2. 为什么单独建 `comment_likes` 而不复用 `likes`

`likes.post_id` 是 `NOT NULL` 且外键指向 `posts(id)`。把评论点赞塞进 `likes` 只有两条路，都有代价：

- 把 `post_id` 改成可空 → 所有「帖子被赞了几次」的查询都要补 `where post_id is not null`，
  漏一处就把评论赞算成帖子赞；
- 伪造 `post_id` → 直接串数据。

分表后两边聚合口径各自命中索引（帖子 `where post_id=$1`、评论按 `comment_id` 分组），
唯一约束照旧保证「重复点赞不重复计数」。

## 3. 数据与接口

迁移 `048_comment_likes.sql`：`comment_likes(id, comment_id → comments ON DELETE CASCADE,
user_id → users ON DELETE CASCADE, created_at, unique(user_id, comment_id))`，
另有 `comment_likes_comment_idx(comment_id)`（消息中心按 `comments.author_id` 反查）。

接口与帖子点赞**同型**（幂等、返回服务端权威计数）：

- `POST /api/comments/:id/like` → `{liked:true, likeCount, likedByMe}`
- `DELETE /api/comments/:id/like` → `{liked:false, likeCount, likedByMe}`

读模型 `GET /api/posts/:id/comments` 的每条评论（含 `replies`）新增 `likeCount` 与 `likedByMe`。
未登录时 `likedByMe` 恒 `false`，不额外发查询（与帖子 `likeStateFor` 同型）。
新建评论直接返回 `likeCount: 0, likedByMe: false`，前端无需区分「字段缺失」与「0」。

## 4. 准入规则（刻意与帖子点赞一致）

- 评论自身必须 `status='published'`：评论是**软删**，否则「给已删除的评论点赞」会不断成功，
  留下指向空气的互动并污染对方的消息中心。
- 所属帖子必须 `published`：下架帖下面不再产生互动（F07 同理）。
- **不拦自赞**：帖子点赞也没有这条规则；自赞只是**不发通知**（`l.user_id <> 收件人`）。
- **允许收回**：已删除评论的点赞仍可取消，否则那个赞永远撤不掉。

## 5. 消息中心

`INBOX_EVENTS_SQL` 增加一个 `union all` 分支：

```sql
select 'comment-like:'||cl.id, 'likes', u.display_name, u.avatar_media_id, p.id, null::uuid,
       '赞了你的评论', left(c.body,160), cl.created_at
  from comment_likes cl join comments c on c.id=cl.comment_id
  join posts p on p.id=c.post_id join users u on u.id=cl.user_id
 where c.author_id=$1 and cl.user_id<>$1 and c.status='published' and p.status='published'
```

- 归属 `likes` 分类 ⇒ 一个入口、一个未读计数，靠 `action` 文案区分「赞了你的帖子 / 赞了你的评论」。
- `post_id` 用于点击后跳转原帖；`thread_id` 恒空。
- 通知的收件人由 `comments.author_id` 决定，与评论是否匿名无关：匿名只是**展示层遮罩**，
  真实 `author_id` 不变，所以匿名作者照样收到自己的通知，且不会因此暴露身份。
- 软删评论、下架帖的点赞自动消失（两个 `status` 条件）。

## 6. 前端

- `api/client.ts`：`ApiComment` 增加可选 `likeCount` / `likedByMe`；新增 `likeComment` / `unlikeComment`。
- `PostReader.tsx`：评论元信息行右侧加一颗小红心。沿用帖子点赞的展示规则——
  **0 赞时只留图标、不渲染计数**；已赞用 `--orange`，`aria-pressed` 与 `aria-label` 随状态变化。
- `FeedDetailScreen.tsx`：`toggleCommentLike` 先乐观更新做即时反馈，**再用服务端计数校正**，
  失败**回滚**并给出提示（写操作绝不本地假成功）。
- 并发用 `commentLikeBusy` 按**评论 id** 单独锁，而不是复用全局 `busy`：
  否则点一下评论的小红心会把「发送」按钮一起锁住，看起来像面板卡了。
- 未登录点赞：提示并跳转登录选择页（与帖子点赞一致）。

## 7. 校园活动体检结论

跑通了学生侧与管理端链路，**没有发现功能缺陷**，因此**没有改**活动相关代码。体检覆盖：

- 默认列表只给「即将开始 + 进行中」，按开始时间升序；
- 「已结束」「已取消」「全部」筛选都能查到对应条目（历史上「已结束恒为空」的缺陷已修好：
  服务端默认窗口不再混入近期结束的活动，前端也不再二次过滤）；
- 缺 `ends_at` 时按 2 小时推导展示态（1 小时前开始→进行中；121 分钟前开始→已结束）；
- `window=today/week` 只保留与北京时区自然日/周相交的活动；
- 地点筛选为等值过滤；非法 uuid/status/window → 400；
- 收藏幂等、未登录 401、未登录也能看列表与详情、取消收藏幂等；
- 管理端录入校验（标题必填、外链必须是无凭证 http(s)）、非管理员 403、
  改成 `cancelled` 后立刻退出默认列表。

## 8. 管理端筛选（拍照打卡 / 校园故事）核对结论

公开侧与数据链路都已接通，**未发现缺口**：

- 校园故事：`filter=stories` 要求 `post_story_labels.enabled`，且帖子 `published`、地点 `enabled`；
- 拍照打卡：`filter=checkins` 要求 `place_checkins.active` 且至少一张精选照片有效
  （`VALID_CHECKIN_PHOTO`：帖子公开、同地点、`purpose='post'`、`scope='public'`、`mime like 'image/%'`）；
- 管理端入口：`AdminStoriesPanel`（管理 → 内容管理）、`AdminCheckinsPanel`（地点管理 → 拍照打卡维护）；
- 公开入口：地图页「拍照打卡 / 校园故事」筛选按钮。

补的测试把几个「看起来能过、实际会串数据」的边界钉死：给已下架帖设故事必须 409、
打卡照片用了别的地点必须 409、版本冲突必须 409、地点停用不能设 active、帖子下架后精选照片自动失效、
每次写操作都留审计记录。

## 9. 验证

服务端 12 条测试全绿（`cd server`）：

```powershell
$env:PROFILE_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:15432/postgres'
npm run test:inbox; npm run test:comment-likes; npm run test:curation; npm run test:activities
npm run test:anonymous; npm run test:feed-avatar; npm run test:direct; npm run test:profile
npm run test:cors; npm run test:media
```

新增：`tests/comment-likes.test.ts`（接口契约）、`tests/curation.test.ts`（047 真实迁移 + 准入边界）、
`tests/activities.test.ts`（活动全链路体检）。
同步更新了 `tests/inbox.test.ts` 与 `tests/comment-anonymous.test.ts` 的夹具
（新增表后，这两个夹具必须建 `comment_likes`，否则评论列表接口直接 500）。

构建：`server` 的 `tsc --noEmit` 与 `node build.mjs` 通过；`app` 的 `tsc -b && vite build` 通过。

**未做**：本环境没有安装 Playwright，所以评论小红心没有做真实浏览器点击验证；
其正确性目前由类型检查、生产构建与服务端接口测试保证。

## 10. 部署注意

上线需要**应用新增迁移 `048_comment_likes`**。未应用时服务端会停在 `NOT_READY`
（`/api/ready` 返回 pending），而不是半坏状态。本次改动**尚未部署**到远程环境。
