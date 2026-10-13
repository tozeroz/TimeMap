# UI → 数据源盘点 · **2026-09-22 刷新版**（机械生成 + 逐条取证）

> 本文件**取代**原 `UI-DATA-SOURCE-INVENTORY.md` 的 §二/§三（那两节写在"WO#8 之后"，**已严重过期**）。
> 原始文件的历史与维护规则保留；本文件给出**当前准确状态**与**证据**。

## 〇、为什么要重做（原清单已会误导决策）

原 §二 把 `MapScreen` / `FeedListScreen` / `UserProfileScreen` / `ProfileEditScreen` / `CommentsScreen`
列为"**纯 mock**"，而其中**前四个都已经在 WO#11/12/13/14/15 接完权威**。
原 §三 的优先级建议（P1=GroupChatScreen、P2=FeedListScreen…）**都已经做完**。

⭐ 原文件 §四 写了维护规则（"新增屏幕必须登记"），但那是**手动规则** ⇒ 必然漂移。
**这正是本会话反复吃到的同一个坑：引用了过期的来源。**
⇒ 处置：**改成机械生成 + 漂移检查**（见 §四）。

## 一、生成方式（可复现，取代原 §一 的 bash）

```bash
node scripts/m5/ui-data-source-inventory.mjs            # 打印当前状态
node scripts/m5/ui-data-source-inventory.mjs --check    # 与本文档快照比对（漂移即 FAIL）
node scripts/m5/ui-data-source-inventory.mjs --write    # 写回机器快照区块
```
它区分 **值导入** 与 **type-only 导入**，并**只匹配行首的 import**：
```
· type-only 不算"用假数据"（类型在运行时不存在）—— MapScreen 的 `import type { MapMarker }`、
  FeedListScreen / UserProfileScreen 的 `FeedPost` 都属此类
· 只认行首 import —— 因为**注释里**也写着 import（见 §三 我修的两个误报）
```

## 二、当前状态（25 个屏幕；`api-only=11 ／ mock+api=2 ／ mock-only=5 ／ none=7`）

### 2.1 仍渲染 **mock 数据**的屏（**这是真正要看的清单**）

| 屏幕 | mock 符号 | 用法与证据 | 可达性 | 基线有对应屏？ |
|---|---|---|---|---|
| **CommentsScreen** | `comments, posts` | ⚠️⚠️ 见 §三 头号发现 | 已挂载 `#/comments`，但**无任何 `navigate('comments')` 调用** | `comment-detail` 基线存在 |
| **MediaPreviewScreen** | `posts` | 图片预览取 mock 帖子 | 已挂载 `#/media-preview`，**无入口** | `media-preview` 基线存在（且是 `observed`，见补充） |
| **PoiSearchScreen** | `pois` | 地点搜索列表 | 已挂载 `#/poi`；**有入口**（MapScreen 地区名 / PublishScreen） | `poi-search` 基线存在 |
| **ScannerScreen** | `scannerHints` | 3 条静态提示文案，2.2s 轮播 | 已挂载 `#/scanner`，**无入口** | `scanner` 基线存在 |
| **UpgradeDialog** | `upgradeInfo` | 升级弹窗版本/更新点文案 | 已挂载 `#/upgrade`，**无入口** | `upgrade-alert` 基线存在 |
| **BoardScreen** | `boardEmojis, me` | ⚠️ `me.avatar`（**mock 自称身份**） | 有入口 | `message-board` 基线存在 |
| **CampusScreen** | `campusInfo, schools` | ⚠️ `schools` 含**编造成员数** | 有入口 | `trident-campus` 基线存在 |

**其余 18 屏**：`api-only` 11 ／ 静态无数据 7 ⇒ **不涉及假数据**。

### 2.2 ⚠️ 三个"路由可达但无入口"的屏（`scanner` / `media-preview` / `comments`）

它们**在 App.tsx 里挂着**，但全仓库**没有任何 `navigate('<route>')`**：
```
⇔ 与 WO#13 删掉的"编造孤儿路由"形态相同（那次的 route 是我自己造的）。
但**这次不同**：这三条**都有原版基线屏**，所以**不能**直接删 —— 需要判断
"原版里它们由什么入口进入"（`known_unknowns` 或另一次只读观察才能定）。
⇒ 本轮只记录，**不删不改**；列入待裁定。
```

## 三、⭐⭐ 本轮的两处**关键发现**（都有硬证据）

### 3.1 同一条动态的评论：**两个页面，一个真实一个纯假**
```
CommentsScreen   ：import { comments, posts } from '../data/mock'
                   const post = posts.find((p) => p.id === id) ?? **posts[0]**   ← 兜底到**第一条 mock 帖子**
                   const [list, setList] = useState(comments)                    ← **纯 mock 评论**
FeedDetailScreen ：const [pr, cr] = await Promise.all([getPost(id), **getComments(id)**])  ← **真实**评论
```
⇒ ① **同一数据两处呈现、真假不一**（用户从动态详情看是真评论，直接进 `#/comments` 看到的是假的）
⇒ ② `?? posts[0]` 是**静默兜底到错误内容**，与 WO#12 修掉的 `?? 'u1'`、WO#13 的"假成功"**同型**
⇒ ③ 且 `CommentsScreen` **无任何入口** ⇒ 当前只有直接改 hash 才看得到（但仍是可交付的假数据）

### 3.2 `BoardScreen` 仍在渲染 **mock 自称身份**
```
BoardScreen.tsx:5   import { boardEmojis, me } from '../data/mock'
BoardScreen.tsx:149 <img className="note__avatar" src={**me.avatar**} alt="" />
mock.ts             export const me: User = { id:'u_me', name:'**自定义名称6**', avatar: avatar('我','#6b7cff'), … }
```
⇒ 与 **WO#14 在 MeScreen 修掉的是同一个编造身份**。留言板把"我"的头像渲染成 **mock 生成的 SVG**，
   而 WO#12/#14 已冻结的处置是"**首字占位**"（`users` 表没有 avatar 列）。
⇒ 同一类问题**第二次出现在另一个屏** —— 说明"修一个屏"不足以覆盖它，需要**按类排查**
   （这正是本节存在的意义）。

## 四、维护方式改为**机械可查**（取代原 §四 的手动规则）

```
1. 本文档的"机器快照区块"由脚本生成；`--check` 与源码不一致即 **FAIL**
2. 建议接入常规检查（与 baseline-inventory --check 同列），使"清单过期"不再靠人记得
3. 原 §四 的实质纪律**保留不变**：
   · 新增屏幕必须登记；从 mock 接成真实时更新本表并在 WO 里记录
   · 若某区块仍以真实业务数据的样子暴露给用户：必须二选一（隐藏/禁用 或 另立接线单），
     **不允许**只写一句"这是 mock"就放过去
   · **不要**为了过 Gate 在正式 UI 到处加"这是 mock"的可见标签（那本身制造新的 1:1 偏差）
```

## 五、证据边界（不夸大）
```
· 本盘点只做**静态 import 分析**，**不判断"这个符号是不是业务数据"**。
  例如 ScannerScreen 的 `scannerHints` 是 3 条静态文案、**不是业务数据**，
  它出现在 mock-only 里只表示"它从 mock 取值"，**不等于"它在冒充真实用户数据"**。
  ⇒ 准确表述：本表是**线索排序**依据，逐屏定性仍需读用法（本轮已对 2 屏做了定性）。
· 扫描范围：`app/src/screens/*`（25 个）。**不含** `components/`（组件也可能 import mock）。
  需要全量时用 `--all`。
· 本轮**未重新采集原版**；"基线有对应屏"依据的是 `docs/test/original-baseline/`（且按新纪律
  以 `manifest.json` 权威索引为准，不是各屏旧快照）。
```
