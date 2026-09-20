# M2 数据模型 V0.1：表 ↔ 原版基线追溯表

> 依据审核记录 05 的 scope gate：**每张表都必须能追溯到 22 页 observed baseline 中
> 实际观察到的实体/关系；"以后可能用得上"的表现在不建。**
> 本文件是这份追溯的**证据**，DDL 见 `server/src/migrations/003_data_model_v01.sql`。
> 基线原文在 `docs/original-baseline/screens/<id>/baseline.json`（`interactions` / `navigation` 字段）。

## 一、追溯表

| 表 | 来源页面 | 观察到的依据（baseline 原文要点） |
|---|---|---|
| `users` | login-select / login-sns / onboarding / message | 登录与引导流程；聊天列表里每个同学都有「昵称 + 相同学校标签 + MBTI/星座 + 学院-专业 + 年级」 |
| `sessions` | login-select / login-sns | 存在登录态（否则登录页/引导页没有意义）；M2.1 认证契约的载体 |
| `posts` | trident-campus / feed-list / feed-detail | 「双列瀑布流：图片 + 文案 + 作者头像/昵称 + 点赞数/评论数」 |
| `media` | trident-campus / publish / media-preview | 瀑布流卡片带图；publish「快门 → 拍摄并入草稿」；存在独立的图片预览页 |
| `places` | poi-search / publish / trident-map | poi-search 列表项为「地点名 + 地址（如 北京交通大学 / 西直门外上园村3号）」，首项「不添加地点」；publish 顶部有「📍<地点名> ×」胶囊；map 顶部有地区选择 |
| `comments` | comment-detail / trident-campus / feed-detail | 存在评论详情页；卡片上直接显示评论数 |
| `likes` | trident-campus | 卡片上显示点赞数（且是可数的整数） |
| `message_threads` | message | 「点会话 → 单聊」「右上加号 → 新建会话」——存在"会话"这个容器 |
| `thread_members` | message / chat | 会话有参与者（单聊页顶部显示对方昵称） |
| `messages` | chat | 单聊页底部「发消息...」输入框 |
| `board_notes` | **message-board** | 「留言 / **仅双方可见** / 彩色便签式留言列表」——语义与会话消息不同，见第二节 |
| `groups` | group | 存在群聊页（顶部昵称 + 返回 + 更多） |
| `group_members` | group / announce | 群成员概念（群公告的可见范围就是群成员） |
| `announcements` | announce | 「群公告」页，标题为「校园活动」 |

14 张表全部有对应观察来源，无"预留表"。

## 二、两个需要解释的判断（不是随手加的）

### 1. 为什么 `board_notes` 不复用 `messages`

`message-board` 的原文是「**仅双方可见**」「彩色便签式留言列表」——
它是"给某个同学留一条便签"，没有会话列表、没有未读、没有群成员这些概念。
把它硬塞进 `message_threads/messages` 会让"会话"这个模型变形（要么到处加
`kind='note'` 分支，要么让 thread 出现"只有两条留言却没有会话语义"的脏数据）。
所以独立成表，并在迁移里写了 `COMMENT ON TABLE` 说明原因。

### 2. `comments.parent_id` 是**未被观察到的**能力，标注为待定

`comment-detail` 在 baseline 里是**空白页**（当时未登录/缺参数），
所以评论的**嵌套结构没有被观察到**。这里保留一个可空自引用，
只是为了让 M3 用真实 UI 校验结构时不必改表；迁移文件里明确写了
"如果 M3 确认没有回复层级，应删掉这一列"。
**不把它当作已完成的设计**。

## 三、明确"不建"的表（同样重要）

| 候选 | 为什么不建 |
|---|---|
| `schools`（学校表） | trident-campus 只观察到副标题「校园广场 ▼」，**切换器的内容没有被观察到**；message 里的"相同学校标签"是用户属性。V0.1 把学校作为 `users.school_name` 文本字段即可；等 M3 从真实入口打开切换器、看清它的字段与关系，再决定要不要独立成表 |
| `notifications` / 未读 | 没有任何页面观察到未读计数或通知列表 |
| `follows` / 好友关系 | 没有观察到关注/好友列表 |
| 全文检索、软删除框架、多租户、读写分离、分库分表 | 明确超出 V0.1（`docs/m2/SPEC.md` 第九节） |

## 四、约束的"业务含义"（审核要求：不是套模板）

```sql
likes          UNIQUE (user_id, post_id)      -- 一人对一帖只有一个赞（重复点赞应被拒绝）
thread_members UNIQUE (thread_id, user_id)    -- 不重复进同一个会话
group_members  UNIQUE (group_id, user_id)     -- 不重复入群
media          UNIQUE (post_id, position)     -- 同一帖内图片顺序不重复
board_notes    CHECK  (from_user_id <> to_user_id)   -- 不能给自己留言
media          CHECK  (mime IN (jpeg/png/webp))      -- 只允许这三种图片格式
places         CHECK  (latitude/longitude 在合法范围)
group_members  CHECK  (role IN ('member','admin','owner'))
```

这些约束在 M2 Gate 的 `[CONSTRAINTS]` 组里用**故意非法的插入**逐条验证，
而不是只看建表语句成功。
