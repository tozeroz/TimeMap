from pathlib import Path
import re, json, hashlib

source = Path(r'E:\大学\大三上实训项目\概要设计与详情设计文档 （飞书导出修改版）\概要设计与详情设计文档.md')
out = Path(r'E:\code\BJTUTimeMap\TimeMap\tmp\pdfs\feishu-revision')
out.mkdir(parents=True, exist_ok=True)
original = source.read_text(encoding='utf-8-sig')
text = original

def paragraph(prefix, replacement):
    global text
    pattern = r'^' + re.escape(prefix) + r'[^\n]*(?:\n(?!\n)[^\n]+)*'
    text, count = re.subn(pattern, lambda _: replacement, text, count=1, flags=re.M)
    assert count == 1, prefix

paragraph('本系统采用前后端分离的分层架构', '本系统采用前后端分离的分层架构，以校园地标组织地点资料、用户帖子与校园活动，并提供实训项目成果展示。系统划分为表现层、业务逻辑层和数据访问与存储层，通过HTTP接口交换JSON数据。用户端采用React与TypeScript实现，使用Vite构建，并通过Capacitor提供Android App；服务端采用Node.js、Fastify与TypeScript，数据库使用PostgreSQL。实训项目独立于地点内容，不要求关联地标。')
paragraph('表现层包括用户端和管理端。', '表现层包括用户端和管理端。用户端提供“地图、广场、活动、我的”四个一级入口，默认进入地图；活动入口内可切换“校园活动”和“实训项目”。地图支持地点面板及简介照片浏览，广场支持帖子浏览与发布，个人中心提供资料、发布、收藏和活动提交记录。管理端提供举报处理、帖子管理、活动管理、投稿审核、实训项目管理、地点维护和操作记录。前端通过统一接口客户端与服务端交互；相机、相册和定位由浏览器或Capacitor能力适配。')
paragraph('业务逻辑层负责处理系统的核心业务', '业务逻辑层负责身份认证与权限校验、地点查询、帖子发布与删除、图片文字与主体贴纸处理、评论点赞收藏、活动提交与审核、实训项目浏览与点赞以及举报处理。新帖子必须关联一个允许发帖的预设地点；帖子直接公开，活动投稿审核通过后公开，二者不混用审核规则。实训项目由管理员统一维护。服务端校验身份、权限、内容和幂等键，防止重复写入；匿名帖子保留真实作者归属，在公开读模型中隐藏身份。')
paragraph('数据访问与存储层负责业务数据的查询', '数据访问与存储层负责业务数据的查询、写入和维护。PostgreSQL存储用户、地点、帖子、活动、投稿版本与审核记录、实训项目及互动关系，通过主外键、唯一约束、检查约束和事务维护一致性。媒体文件与媒体元数据分开管理，通过media及关联表连接帖子、头像、活动封面和项目封面；支持公开与私有访问范围。帖子草稿保存在当前设备的IndexedDB中，按账号区分，不作为数据库帖子，也不承诺跨设备同步。语音及聊天等历史能力不作为本次核心设计范围。')
paragraph('系统运行时，用户在前端发起操作', '系统运行时，前端发起请求，服务端校验会话与权限后读取或更新数据，再返回结果。普通用户使用手机号验证码登录，管理员另有密码登录方式。写操作和私有记录访问均由服务端鉴权，不能仅隐藏前端按钮。读取失败、权限不足、上传或生成失败需明确反馈；管理操作通过审计记录追溯。下图保留原分层结构，实训项目、活动投稿及创作能力由上述文字补充；图中的服务划分表示逻辑职责，不表示项目采用微服务部署。')
paragraph('本系统围绕“以地图发现校园', '本系统围绕“以地图发现校园、以地点聚合内容、以共创记录记忆”的业务主线，保持校园地图、校园内容、校园活动、用户与个人中心、后台管理五类职责。为保持现有文档结构，实训项目在校园活动入口相关说明中补充，但其数据、点赞与管理逻辑独立于活动。后台管理作为跨模块职责说明，不另增章节。')
paragraph('校园地图模块是系统的主要浏览入口', '校园地图模块是系统主要浏览入口，支持拖动缩放、地标搜索、当前位置、按层级显示地标及关联帖子内容。地点类别为教学楼、食堂、运动场、休闲场所和校园地标，显示层级另分学校、区域和具体地点。点击或搜索地标后打开底部地点面板，可查看相关帖子、近期活动并进入地点简介和照片页；关闭面板保留地图位置与缩放。保留正常历史资料与照片浏览，取消新老照片对比制作，不维护由发帖生成的校园足迹。')
paragraph('校园内容模块负责校园记忆的发布', '校园内容模块提供纯文字、纯图片和图文发布、图片加字、主体贴纸、匿名发布、本地草稿及作者删除能力。帖子必须关联一个启用且允许发帖的预设地点，直接公开；正文最多500字，当前发布界面一次选择一张图片，图片文字最多50字。广场采用双列列表，支持热门/最新排序及地标搜索、多选筛选，互动包括点赞及取消、评论回复、删除自己的评论、收藏及取消、分享和举报。原帖在线编辑不作为当前已经完成的能力描述，重新发布也不等于修改原帖。')
paragraph('校园活动模块负责活动信息的发现', '校园活动模块包含校园活动和实训项目两种浏览模式。校园活动提供列表、详情、时间/状态/地点筛选、收藏、地图查看及用户提交；投稿由管理员审核，未通过可修改重提，作者在“我的提交”查看结果。实训项目提供全部项目、人气榜、项目名称与简介、团队信息、项目链接及体验网址，登录后可点赞和取消。项目由管理员新增、编辑、排序及上下架，不提供普通用户项目投稿，不要求项目具备活动时间或校园地点。')
paragraph('用户与个人中心模块负责身份识别', '用户与个人中心模块提供手机号验证码登录、退出、头像昵称简介等资料维护，以及“我的发布、我的收藏、我的提交”和活动收藏入口。学校、学院、入学年份为自填资料，不代表学籍认证。个人记录按账号隔离，本地草稿不向其他用户公开。管理员通过角色入口进入管理端，维护地点、活动及实训项目，审核活动投稿、处理举报并查看操作记录；普通用户不能执行管理请求。')
paragraph('说明用户、地标、帖子、活动、收藏之间的关系', '数据库设计说明用户、地点、帖子、活动、活动投稿、实训项目及互动关系。主要字段以当前迁移文件和业务校验为依据，区分数据库可空性与新建业务的必填要求；以下补充表仍置于原“主要物理表设计”小节，不改变章节层级。')
paragraph('本项目共 17 张表', '原ER图展示的是较早阶段的17张基础表，并非当前完整数据库清单。当前以users和places为关联锚点：schools/campuses/colleges提供资料归属；posts通过post_media和media关联图片，comments/likes/favorites维护互动；place_photos保存地点照片；activities和activity_favorites维护公开活动及收藏；activity_submissions、activity_submission_revisions、activity_submission_reviews、activity_submission_requests维护投稿、版本、审核与幂等请求；training_projects与training_project_likes维护实训项目及点赞。reports、audit_log及sessions等支撑治理和认证，cutout_jobs记录主体识别处理。下图保持原样，新增实体关系和字段以随后表格及文字补充；不把旧图的17张表认定为当前总表数。')

# Update existing rows in place, preserving the original five table positions.
def row(section, key, replacement):
    global text
    start = text.index(section)
    pos = text.index('|'+key+'|', start)
    end = text.index('\n', pos)
    text = text[:pos] + replacement + text[end:]

row('1\\.users', 'password\\_hash', '|password\\_hash|text|NULL|—|CHECK NULL或符合scrypt编码格式|管理员密码凭据；普通用户走手机号验证码，限制由业务鉴权落实|')
row('2\\.places', 'name', '|name|text|NOT NULL|—|CHECK 非空|允许重名，关联及跳转使用id区分|')
row('2\\.places', 'category', "|category|text|NOT NULL|'校园地标'|CHECK ∈ {教学楼,食堂,运动场,休闲场所,校园地标}|地点类别，与地图展示层级分别维护|")
row('2\\.places', 'enabled', '|enabled|boolean|NOT NULL|true|—|停用地点不得用于新发帖；活动地点还需核验坐标及实际可用性|')
row('3\\.posts', 'body', '|body|text|NOT NULL|—|CHECK length ≤ 500；允许空字符串|纯图片帖可无正文，发布事务校验文字与图片不能同时为空|')
row('3\\.posts', 'author\\_id', '|author\\_id|uuid|NULL|—|FK → users(id) ON DELETE SET NULL|历史数据允许空；新发帖需登录，匿名不清空真实作者id|')
row('3\\.posts', 'place\\_id', '|place\\_id|uuid|NULL|—|FK → places(id) ON DELETE SET NULL|历史记录可空；新发帖业务必须关联一个可发布的预设地点|')
row('3\\.posts', 'client\\_request\\_id', '|client\\_request\\_id|uuid|NULL|—|非空时具有唯一索引|发布幂等标识；重复请求不能重复创建帖子，冲突请求须校验归属与内容|')
row('5\\.activities', 'ends\\_at', '|ends\\_at|timestamptz|NULL|—|CHECK NULL或晚于starts_at|为空仅表示结束时间未知；当前有效状态查询按开始后2小时兜底，并非开始时间未知|')
row('5\\.activities', 'status', "|status|text|NOT NULL|'scheduled'|CHECK ∈ {scheduled,cancelled}|存储排期/人工取消；即将开始、进行中、已结束由时间推导，不是审核状态|")
row('5\\.activities', 'created\\_by', '|created\\_by|uuid|NULL|—|FK → users(id) ON DELETE SET NULL|兼容历史或用户删除；不能因此绕过管理员身份校验|')

def add_rows(section, rows):
    global text
    start = text.index(section)
    header = text.index('|**字段**|', start)
    end = text.find('\n\n', header)
    text = text[:end] + '\n' + rows.strip() + text[end:]

add_rows('1\\.users', '''|bio|text|NOT NULL|空字符串|CHECK 长度≤160|个人简介|
|avatar_media_id|uuid|NULL|—|与avatar_media_scope组合FK → media(id,scope)|头像媒体，可不设置|
|avatar_media_scope|text|NOT NULL|'public'|CHECK = public|头像为公开媒体|
|profile_school_id|uuid|NULL|—|FK → schools(id)|自填学校资料，不代表认证|
|college_id|uuid|NULL|—|与profile_school_id组合FK → colleges(id,school_id)|学院须属于所选学校|
|enrollment_year|integer|NULL|—|CHECK 1900至2100|自填入学年份，不是出生年份|''')
add_rows('2\\.places', '''|display_level|text|NOT NULL|'place'|CHECK ∈ {school,area,place}|学校、区域、具体地点的地图层级|
|min_display_zoom|double precision|NULL|—|CHECK 4至18|最小显示缩放级别|
|display_priority|integer|NOT NULL|0|CHECK -1000至1000|显示优先级|
|parent_place_id|uuid|NULL|—|FK → places(id) ON DELETE RESTRICT；触发器禁止成环|父级地点，与业务类别独立|''')
add_rows('3\\.posts', '''|image_mode|text|NOT NULL|'photo'|CHECK ∈ {photo,sticker}|普通图片或透明主体贴纸|
|is_anonymous|boolean|NOT NULL|false|—|用户主动选择匿名；公开读模型遮罩作者，保留真实归属|''')
add_rows('5\\.activities', '''|activity_type|text|NULL|—|无固定枚举约束|预留活动类型；当前不承诺类别筛选|
|organizer|text|NULL|—|—|主办方|
|external_link|text|NULL|—|接口校验外部链接|参与方式链接，不是站内报名|
|cover_image_id|uuid|NULL|—|FK → media(id) ON DELETE SET NULL|封面媒体，缺失时显示占位|''')

supplement = r'''
**补充数据关系与物理表（续列于本小节）**

`users.school_campus_id`与`profile_school_id`还受组合外键约束，保证校区属于所选学校。`post_media.purpose`区分`post`（详情成图）与`map`（地图专用图），每帖最多一张purpose为map的图片，避免把图片文案与地图文字叠加。地点照片继续使用`place_photos`，保留标题、年代、来源和媒体关联；历史机位/年份字段可兼容保留，但不据此提供新老照片对比制作。以下为新增业务的主要字段摘要；未在ER图画出的关系由本表补充，完整DDL以迁移文件为准。

**activity_favorites（活动收藏）**

|字段|类型|可空|默认|键/约束|说明|
|---|---|---|---|---|---|
|id|uuid|NOT NULL|—|PK|收藏记录|
|activity_id|uuid|NOT NULL|—|FK → activities(id) ON DELETE CASCADE|活动|
|user_id|uuid|NOT NULL|—|FK → users(id) ON DELETE CASCADE；UNIQUE(user_id,activity_id)|重复收藏不新增记录|
|created_at|timestamptz|NOT NULL|now()|—|收藏时间；取消活动仍可标注状态展示|

**activity_submissions（投稿主记录）**

|字段|类型|可空|默认|键/约束|说明|
|---|---|---|---|---|---|
|id|uuid|NOT NULL|—|PK|投稿标识，未通过重提沿用|
|submitter_id|uuid|NOT NULL|—|FK → users(id) ON DELETE CASCADE|投稿作者|
|status|text|NOT NULL|'pending'|CHECK ∈ {pending,approved,rejected}|待审核、已通过、未通过|
|current_revision|integer|NOT NULL|1|CHECK ≥1|当前提交版本|
|published_activity_id|uuid|NULL|—|FK → activities(id) ON DELETE SET NULL；非空唯一|通过后关联公开活动|
|published_cover_media_id|uuid|NULL|—|FK → media(id) ON DELETE SET NULL|公开封面副本|
|created_at / updated_at|timestamptz|NOT NULL|now()|—|创建/更新时刻|

**activity_submission_revisions（投稿版本快照）**

|字段|类型|可空|默认|键/约束|说明|
|---|---|---|---|---|---|
|submission_id|uuid|NOT NULL|—|FK → activity_submissions(id) ON DELETE CASCADE；与revision组成PK|所属投稿|
|revision|integer|NOT NULL|—|CHECK ≥1|重提新增版本，保留旧快照|
|title|text|NOT NULL|—|CHECK 去空格后长度1至60|活动标题|
|place_id|uuid|NOT NULL|—|FK → places(id) ON DELETE RESTRICT|举办地点|
|starts_at|timestamptz|NOT NULL|—|—|开始时刻|
|ends_at|timestamptz|NULL|—|CHECK NULL或晚于starts_at|结束时刻|
|description / organizer / source / external_link / activity_type|text|NULL|—|业务层校验|介绍、主办方、来源、外部链接、类型|
|cover_image_id|uuid|NULL|—|FK → media(id) ON DELETE SET NULL|审核前私有封面，仅作者/管理员可读|
|submitted_at|timestamptz|NOT NULL|now()|—|本版本提交时刻|

**activity_submission_reviews（审核记录）**

|字段|类型|可空|默认|键/约束|说明|
|---|---|---|---|---|---|
|id|uuid|NOT NULL|—|PK|审核标识|
|submission_id / revision|uuid / integer|NOT NULL|—|组合FK → activity_submission_revisions；组合UNIQUE|同一投稿版本最多一次终审|
|reviewer_id|uuid|NOT NULL|—|FK → users(id) ON DELETE RESTRICT|审核管理员|
|decision|text|NOT NULL|—|CHECK ∈ {approved,rejected}|审核结论|
|reason|text|NULL|—|rejected时必须非空|未通过原因|
|reviewed_at|timestamptz|NOT NULL|now()|—|审核时刻|

**activity_submission_requests（投稿请求幂等记录）**

|字段|类型|可空|默认|键/约束|说明|
|---|---|---|---|---|---|
|actor_id|uuid|NOT NULL|—|FK → users(id) ON DELETE CASCADE；与client_request_id组成PK|请求发起者|
|client_request_id|uuid|NOT NULL|—|组合主键|同一用户同一请求只处理一次|
|submission_id|uuid|NOT NULL|—|FK → activity_submissions(id) ON DELETE CASCADE|对应投稿|
|revision|integer|NOT NULL|—|—|对应版本|
|payload_sha256|text|NOT NULL|—|—|相同键不同内容拒绝，防止错误复用|
|created_at|timestamptz|NOT NULL|now()|—|请求记录时刻|

**training_projects（实训项目）**

|字段|类型|可空|默认|键/约束|说明|
|---|---|---|---|---|---|
|id|uuid|NOT NULL|—|PK|项目标识，不关联地标|
|name|text|NOT NULL|—|CHECK 长度1至80；接口去首尾空白|项目名称|
|summary|text|NOT NULL|—|CHECK 长度1至160；接口去首尾空白|一句话简介|
|group_name|text|NULL|—|CHECK 非空值长度1至60|小组名称，资料未知时留空|
|member_count|integer|NULL|—|CHECK 非空值1至100|人数，不编造缺失资料|
|project_url|text|NULL|—|数据库HTTP/HTTPS前缀检查；接口验证URL|代码仓库或介绍页|
|experience_url|text|NULL|—|数据库HTTP/HTTPS前缀检查；接口验证URL|可体验产品的链接，与项目链接区分|
|cover_image_id|uuid|NULL|—|FK → media(id) ON DELETE SET NULL|项目封面|
|position|integer|NOT NULL|0|CHECK 0至10000|全部项目人工排序|
|published|boolean|NOT NULL|false|—|上架状态；公众仅看true|
|created_at / updated_at|timestamptz|NOT NULL|now()|—|创建/更新时间|

**training_project_likes（项目点赞）**

|字段|类型|可空|默认|键/约束|说明|
|---|---|---|---|---|---|
|project_id|uuid|NOT NULL|—|FK → training_projects(id) ON DELETE CASCADE；与user_id组成PK|被点赞项目|
|user_id|uuid|NOT NULL|—|FK → users(id) ON DELETE CASCADE|同一用户同一项目最多一个有效点赞|
|created_at|timestamptz|NOT NULL|now()|—|点赞时刻，取消时删除关系|

以上状态字段不互相替代：帖子使用published/removed，公开活动存scheduled/cancelled并推导展示状态，投稿使用pending/approved/rejected，实训项目使用published布尔值。

'''
text = text.replace('# 2 详细设计', supplement + '# 2 详细设计', 1)

paragraph('以校园地图为入口，展示地标位置', '以校园地图为默认入口，按层级展示地点名称及地点关联帖子内容，支持拖动、缩放、地标搜索和当前位置。地点资料、相关帖子、近期活动与发布入口通过地点底部面板连接，简介和照片可单独浏览；不提供路线导航、由发帖形成的个人足迹或新老照片对比制作。地图读取失败或定位权限拒绝时给出提示，不妨碍其他公开内容浏览。')
paragraph('展示地标名称、图片、简介及历史资料', '点击或搜索地标后打开地点底部面板，展示地点名称、资料入口、相关帖子和近期活动；“查看全部”进入相应列表并带入地点筛选，“在此发布”进入帖子编辑并预选地点。地点简介页展示封面、简介、地址及相关照片，支持大图预览；历史资料和照片缺失时如实显示，不要求所有地点都有老照片。关闭面板保留地图位置和缩放。\n\n+图示适用说明：以下三图保留原稿。图中的PoiDetailScreen及navigate(\'poidetail\')是旧页面组织方式，当前主要入口为地图地点面板及PlaceIntroScreen；图中的“地标/食堂”旧分类以1.3.2的五类定义为准。照片节点表示资料浏览，不包含已取消的新老照片对比功能。'.replace('\n+', '\n'))
paragraph('在地图上展示校园地标，支持地图缩放', '地图按display_level、min_display_zoom和display_priority控制学校、区域和具体地点的显示，业务分类与显示层级独立。支持拖动、缩放、地标搜索、设备定位及帖子图片/透明贴纸浏览；文字弹幕可关闭，内容与地点关联。点击内容进入对应帖子，点击地标打开地点面板；帖子下架后退出公开地图展示。\n\n图示适用说明：以下三图保留原稿，旧图中地图直接跳转地点详情的步骤，当前按“打开地点底部面板”理解；公开内容仍由服务端查询和状态过滤，不把地图卡片偏移当作地点坐标变化。')
paragraph('支持用户发布和浏览与校园地点关联的帖子', '支持用户以文字、图片、图片加字和主体贴纸发布校园内容，提供匿名选项、本地草稿、作者删除以及帖子浏览互动。每帖关联一个可发布地点，直接公开并接受举报；广场支持双列列表、热门/最新、地标筛选。评论直接附着于帖子详情，不新增独立一级入口。')
paragraph('支持用户填写帖子内容、上传图片并关联校园地标', '用户登录后填写正文或选择一张图片，关联允许发帖的预设地点；正文最多500字，文字与图片不能同时为空。用户可给图片添加最多50字文案，调整颜色、样式、位置、缩放和旋转，也可主动生成透明主体贴纸、选择描边并确认采用，或直接使用原图。匿名默认关闭，启用后公开展示“匿名同学”及系统头像，真实作者归属仍供本人管理和服务端治理。\n\n退出未发布编辑时可保存本地草稿、放弃或继续；草稿在当前设备按账号保存，恢复时若贴纸需重新生成应提示。上传/生成失败不能提示发布成功，发布使用幂等标识防止重复创建。作者可以删除自己的帖子；原帖在线编辑不作为已实现能力，历史本地内容的重新发布不等于编辑服务器原帖。\n\n图示适用说明：以下三图保持不变。图中的“修改内容并提交”表示旧稿设计，当前不据此承诺原帖编辑；草稿和未提交编辑与公开帖子状态分别维护。图片保存、草稿保存和创作预览均不自动创建帖子或校园足迹。多主体选择等工作区开发中的能力以专项验证为准，不将尚未验证功能记为完成。')
paragraph('展示帖子列表及详情，支持按关联地标等条件筛选内容', '广场使用双列帖子列表，首次默认热门，可切换最新，按地标搜索和单选/多选筛选；多选匹配所选任一地点，并与排序同时生效。最新按发布时间倒序。近期热门按近7天公开帖子计算：点赞×2＋有效评论×3＋收藏－max(0,距发布小时数－24)，同分优先较新内容，完整同分稳定顺序以服务端查询为准。地点面板进入列表时带入地点筛选。\n\n帖子详情支持点赞/取消、评论与回复、删除自己的评论、收藏/取消、分享和举报，写操作需登录。收藏使用用户与帖子唯一关系避免重复计数，可在“我的收藏”回顾；不存在、删除或下架的帖子应明确反馈，不替换为其他帖子。匿名帖在地图、列表、详情、收藏等公开入口统一遮罩作者。\n\n图示适用说明：以下三图保持原样，Controller、ServiceImpl和Repository作为逻辑职责表示；当前对应React组件、统一API客户端及Fastify路由和数据库访问，不代表存在同名Java类。原图的单地标参数需结合当前多地标筛选理解，收藏流程同时支持取消。')
paragraph('提供校园活动信息的展示、提交和审核功能', '活动一级入口支持“校园活动/实训项目”切换。校园活动包含浏览筛选、收藏、地图查看、用户投稿及管理员审核；实训项目提供成果浏览与体验跳转，两者数据和状态分别维护。游客可浏览公开内容，收藏、投稿和项目点赞等写操作需登录。\n\n实训项目的全部列表按position升序，人气榜按点赞数降序，同值按中文名称、唯一标识依次稳定排序。列表仅展示已上架项目，团队信息和封面缺失时使用合理提示，项目链接与体验网址分别显示，未配置时隐藏。项目点赞可取消，同一账号对同一项目最多一个有效点赞；管理员可新增、编辑、设置顺序及上下架，普通用户不能维护。\n\n图示适用说明：本节图保留校园活动原流程，未覆盖实训项目；实训项目以上述文字及1.3.2补充表为准。公开活动有效状态为upcoming/ongoing/ended/cancelled，投稿审核状态为pending/approved/rejected，两者不能混用。')
paragraph('展示活动列表及详情，包括活动时间、地点和介绍', '校园活动默认展示即将开始与进行中的活动，按开始时间由近到远排列；支持全部/今天/本周时间、活动状态及地点筛选，结束或取消活动可通过筛选查看。时间筛选按北京时间处理。详情包括标题、封面或占位、介绍、时间、举办地点、主办方、来源及参与方式；外部链接不等于站内报名，不提供支付。当前保留activity_type字段，但未确定类别枚举，不将类别筛选写作已交付能力。\n\n登录用户可收藏及取消，活动收藏由activity_favorites独立维护，个人中心“活动收藏”入口可查看；取消活动保留状态标识。“地图查看”返回地图定位并打开对应地点面板；地点停用或无有效坐标时显示不可定位。\n\n图示适用说明：以下图中的category、timeWindow等为旧抽象命名，当前筛选以时间window、状态status、地点placeId为准；navigate(\'poidetail\')按当前“地图定位地点面板”流程理解。图中收藏操作需结合取消收藏和登录失败反馈，不能将帖子收藏与活动收藏当作同一张表。')
paragraph('支持用户填写活动名称、时间、地点及介绍并提交审核', '登录用户提交活动名称、开始时间、地点及相关介绍，可附封面、结束时间、主办方、来源与外部链接等资料；结束时间若填写，必须晚于开始时间。提交创建投稿记录与不可变版本快照，状态为pending，审核前仅本人和授权管理员可查看，私有封面不得提前公开。重复请求由用户与请求幂等键约束，同键不同内容拒绝。\n\n管理员通过或驳回指定投稿版本，驳回必须填写原因，同一版本最多一条终审结论。通过时在事务中创建对应公开活动、关联投稿并处理公开封面；未通过可修改重提，沿用投稿标识、增加版本并保留旧审核记录。作者在“我的提交”查看pending/approved/rejected及原因和公开活动入口；过期版本或重复审核返回冲突并刷新状态。\n\n图示适用说明：以下三图不变。原类图中的DRAFT、WITHDRAWN、updateSubmission、withdrawSubmission、batchApprove等不属于当前投稿状态及已交付流程，不能据图承诺草稿投稿、撤回、任意修改或批量审核。当前接口主要为POST /api/activity-submissions、POST /api/me/activity-submissions/:id/resubmit、POST /api/admin/activity-submissions/:id/review。投稿状态与活动按时间推导的展示状态分别维护。')

text = text.replace('同分优先较新内容，完整同分稳定顺序以服务端查询为准。', '小时数按实际时间差计算，同分按发布时间倒序，再按帖子id倒序稳定排序。')
text = text.replace('当前接口主要为POST /api/activity-submissions', '活动编辑表单另有当前会话sessionStorage暂存，按账号和投稿区分，不等于数据库投稿具有DRAFT审核状态，也不承诺跨设备恢复。当前接口主要为POST /api/activity-submissions')
headings = lambda s: re.findall(r'^#{1,6}[^\n]*', s, re.M)
images = lambda s: re.findall(r'!\[[^\]]*\]\([^\n]+\)', s)
assert headings(original) == headings(text), 'Heading structure changed'
assert images(original) == images(text), 'Image references changed'
for block in re.findall(r'(?:^\|[^\n]*\|\n?)+', text, re.M):
    lines = block.strip().splitlines()
    count = len(lines[0].split('|'))
    assert all(len(line.split('|')) == count for line in lines), 'Malformed table'
for ref in re.findall(r'!\[[^\]]*\]\(([^\n]+)\)', text):
    from urllib.parse import unquote
    assert (source.parent / unquote(ref)).exists(), ref

(out / source.name).write_text(text, encoding='utf-8')
(out / '原稿备份.md').write_bytes(source.read_bytes())
manifest = {
    'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'heading_count': len(headings(text)), 'image_count': len(images(text)),
    'table_count': len(re.findall(r'^\|---\|', text, re.M)),
    'images': {str(p.relative_to(source.parent)): hashlib.sha256(p.read_bytes()).hexdigest() for p in (source.parent/'图片和附件').rglob('*') if p.is_file()},
}
(out / 'verification.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in manifest.items() if k != 'images'},ensure_ascii=True))
