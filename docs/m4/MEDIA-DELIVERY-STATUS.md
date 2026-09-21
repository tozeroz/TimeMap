# M4 媒体下发：状态（**已通过**）

> 时间：2026-09-21 14:39（Asia/Shanghai）
> Gate key：`MEDIA_DELIVERY_RESULT: PASS`（22 条断言）
> 上一版此文档记录为 FAIL（私有下发未验证）；本轮定位根因并修复，见 §二。

## 零、结论

```
MEDIA_DELIVERY_RESULT: PASS
```

**X-Accel-Redirect 其实一直是工作的**；真正的问题是 `Content-Type` 被上游覆盖。
上一轮我因为"字节数对上了、类型却是 JSON"这个矛盾而拒绝记 PASS —— 那个判断是对的，
它把问题逼到了正确的位置。

## 一、现在通过的全部断言

| 断言 | 结果 | 意义 |
|---|---|---|
| 非成员 / 匿名 请求私有媒体 → 404 | PASS | 授权有效，且不泄漏 id 是否存在 |
| **直接打 `/_private_media/...` → 404** | PASS | **私有目录没有被静态暴露**（P0 核心） |
| **带会话直接打 `/_private_media/...` 也失败** | PASS | 必须经后端 X-Accel 才生效 |
| 成员 → 200，且**响应字节数 == 盘上文件大小** | PASS | 字节确实是 Nginx 下发的文件 |
| 成员 → `Content-Type: image/webp` | PASS | 类型来自我们记录的白名单 mime |
| 私有响应带 `private, no-store` / `nosniff` | PASS | 响应头符合要求 |
| 私有 key 拼到公共静态路径 → 404 | PASS | 两个命名空间确实分开 |
| public 经 `/api/media/:id` → 302 → Nginx 静态 200 | PASS | 公共访问模型独立 |
| 消息撤回 → 成员也拿不到（404） | PASS | `deleted_at` 参与可见性判定 |
| 不存在 id / 非法 id → 404 | PASS | 不区分"格式错"与"不存在" |

## 二、根因：Nginx 会保留上游的 Content-Type

诊断脚本 `scripts/m4/diag-xaccel.sh` 打印的**直连后端**响应：

```
HTTP/1.1 200 OK
x-accel-redirect: /_private_media/2026/09/diag-prv.webp      ← Node 确实发了
content-type: application/json; charset=utf-8                ← Fastify 的默认类型
content-length: 4                                            ← body 是 null
```

**经 Nginx** 的响应：

```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8     ← 上游的 Content-Type 被保留了
Content-Length: 8                                 ← 文件的实际长度
Last-Modified / ETag / Accept-Ranges               ← 这些是 Nginx 静态文件头
body = REALBYT8                                    ← 文件内容
```

`Last-Modified` / `ETag` / `Accept-Ranges` + 真实文件字节 = **内部重定向确实发生了**，
文件是 Nginx 下发的；唯一缺陷是 `Content-Type` 沿用了 Node 的 JSON 类型。

**影响**：状态码 200、字节也对，但浏览器不会把 `application/json` 的响应当图片渲染 ——
这是"看着成功、实际不可用"的缺陷，只看状态码发现不了。

**修法**（`server/src/index.ts` private 分支）：显式
`reply.header('Content-Type', row.mime)`，类型来自 `media` 行记录的白名单 mime，
而不是框架默认值。修完断言立刻变绿。

## 三、诊断过程中踩到的两个坑（都不是产品问题）

1. **`UID` 是 bash 只读变量**：诊断脚本里我用 `UID=...` 存用户 id，
   赋值静默失败 → `user_id` 被写成 `'0'` → 成员插入会话失败 →
   接口正确返回 404，而我一度以为授权逻辑坏了。
   **教训**：脚本变量要避开 shell 内置（`UID`/`EUID`/`PPID`/`RANDOM`/`SECONDS`…），
   否则会得到"看起来像产品缺陷"的假象。
2. **断言不允许 catch-all 兜底**：上一版验证脚本写成
   `case "$CT" in *image/webp*) ok ;; *) ok ;; esac` —— 未匹配也 PASS，属假阳性。
   已改为严格双条件（字节数 **且** 类型）。

## 四、本轮同时修掉的真实部署问题

**Nginx 无法穿越 `/srv/campus`**：该目录是 `0750 campus:campus`，
`www-data` 进不去 → 所有静态媒体 403。修法用**最小权限**：
把 `www-data` 加入 `campus` 组，而**不是**把 `/srv/campus` 放开成 0755
（那里有 `server.env`、`.db_password`）。注意 worker 必须
`systemctl restart nginx`，`reload` 不会重新读取附加组。

媒体目录权限固定为：`uploads`/`public` 组内可读、`private` 与 `.tmp` 仅组内；
文件 public `0644` / private `0640`。

另外把 Nginx 站点片段纳入版本控制：`deploy/nginx/campus-locations.inc`
（此前只存在于服务器上，是 git 管理缺口）。

## 五、下一个可交付成果

上传接口 `POST /api/media`：multipart + 复用 `imageProbe` 做内容嗅探 + 5MB 上限 +
服务端生成 key + `tmp → rename` 同盘原子 + 幂等键复用 + ENOSPC → 507；
然后是孤儿清扫与联合备份（`MEDIA_STORE_RESTORE` / `CROSS_REFERENCE_INTEGRITY`）。
