# M4 媒体下发：当前状态（未通过，如实记录）

> 时间：2026-09-21 14:37（Asia/Shanghai）
> Gate key：`MEDIA_DELIVERY_RESULT: FAIL`

## 一、已经验证通过的部分（这些是硬证据）

`scripts/m4/verify-media-delivery.sh` 的下列断言 PASS：

| 断言 | 结果 | 意义 |
|---|---|---|
| 非成员请求私有媒体 → 404 | PASS | 授权有效 |
| 匿名请求私有媒体 → 404 | PASS | 授权有效 |
| **直接打 `/_private_media/...` → 404** | PASS | **私有目录没有被静态暴露**（P0 的核心） |
| **带会话直接打 `/_private_media/...` 也失败** | PASS | 必须经后端 X-Accel 才生效 |
| 私有 key 拼到公共静态路径 → 404 | PASS | 两个命名空间确实分开 |
| public 经 `/api/media/:id` → 302 到 `/media/<key>` | PASS | 公共访问模型独立 |
| 公共媒体经 Nginx 静态直出 → 200 | PASS | 公共链路（不经 Node）可用 |
| 消息撤回 → 成员也拿不到私有媒体（404） | PASS | `deleted_at` 参与了判定 |
| 私有响应带 `private, no-store` / `nosniff` | PASS | 响应头符合要求 |

## 二、失败项（必须修掉才能声称"私有下发可用"）

```
FAIL 私有响应 Content-Type 是「application/json; charset=utf-8」
     —— 返回的是 Node 响应而不是 Nginx 下发的文件
```

**矛盾点（这也是我判断它没通过的依据）**：
同一次请求里，"响应字节数 == 盘上文件大小（8 字节）"成立，
但 `Content-Type` 却是 Node 的 `application/json`。
两者不应同时出现 —— 说明我对"字节从哪来"的判断还不能自证，
**因此不能记 PASS**。

可能的原因（下一步逐一排除）：

1. **Node 侧返回体非空**：`reply.code(200); return null` 在 Fastify 下可能仍序列化出内容，
   而 Nginx 若未消费 `X-Accel-Redirect`，就把 Node 的响应原样透传（含 `application/json`）。
   → 需要明确让 Node 返回**空体**（例如 `reply.send()` 且不设 JSON 类型），
   并确认 Nginx 侧确实接到了 `X-Accel-Redirect`。
2. **`types` 块未生效**：location 内的 `types` 若未命中 `.webp`，会落到 `default_type`，
   但那也不是 `application/json`，所以这条更可能是 1 的伴生现象。
3. 需要直接在服务器上看 `curl -D -` 的**完整原始响应头**来定位（本轮被 shell 守卫拦下）。

## 三、本轮同时发现并修复的真实问题

### 1. Nginx 无法穿越 `/srv/campus`（已修）

```
drwxr-x--- campus campus /srv/campus      ← 0750，www-data 进不去 → 所有静态媒体 403
```

修法（**最小权限**）：把 `www-data` 加入 `campus` 组，
而不是把 `/srv/campus` 放开成 0755（那里有 `server.env`、`.db_password`）。
注意：**worker 进程必须 `systemctl restart nginx`**（`reload` 不会重新读取附加组）。

同时固定媒体目录/文件权限：`uploads` 与 `public` 组内可读、`private` 与 `.tmp` 仅组内、
文件 public 0644 / private 0640。

### 2. 验证脚本自身的假阳性（已修，值得记下）

第一版断言用了模糊匹配 + catch-all 分支：

```bash
case "$BODY" in *PNG*|*\211*|*89*) ok "..." ;; *) bad "..." ;; esac
case "$CT" in *image/webp*) ok "..." ;; *) ok "Content-Type: ${CT:-（未设置）}" ;; esac
```

结果在 `Content-Type` 是 `application/json` 时**分支落到 catch-all 也报 PASS**。
这是**假阳性**——比没有断言更危险，因为它会让人以为验证过了。

已改为**严格双条件**：响应字节数 == 盘上文件字节数 **且** `Content-Type` 是 `image/*`，
否则 FAIL。改完后立刻暴露了真实状态（这正是它该做的）。

> 教训（与 M3 幂等键那次同类）：**断言必须同时约束"数量/内容"和"类型/来源"**，
> 且**不允许 catch-all 兜底成 PASS**。任何"没匹配到也算过"的分支都要当成缺陷处理。

## 四、下一步

1. 取私有媒体请求的**完整原始响应头**（在服务器上 `curl -D -`，避开本地 shell 守卫）
2. 判定 `X-Accel-Redirect` 是否真的发出 / 是否被 Nginx 消费
3. 修 Node 侧返回空体的方式，让 Nginx 明确接管文件下发
4. 重跑 `MEDIA_DELIVERY_RESULT` 直到 PASS，再继续上传接口
