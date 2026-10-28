# 部署缺口（子代理发现，已核验）：`.tmp` 目录依赖人工创建

> 时间：2026-09-21 18:25（Asia/Shanghai）
> 发现者：WO#2 后端子代理（`be94e420`），我在服务器上核验。

## 一、缺口内容

`POST /api/media` 的写入流程是 `.tmp` → rename 到 `public/` 或 `private/`，
即它需要写 `UPLOAD_ROOT/.tmp/<uuid>.<ext>`。但**代码从不创建 `.tmp` 目录**。

- 子代理在 Windows 上实测：目录不存在时上传直接 **500（ENOENT）**
- 服务器核验：

```
drwxr-xr-x 5 campus campus /srv/campus/uploads
drwxr-x--- 2 campus campus /srv/campus/uploads/.tmp      ← 存在，但 mtime 18:22
drwxr-x--- 3 campus campus /srv/campus/uploads/private
drwxr-xr-x 3 campus campus /srv/campus/uploads/public
```

**`.tmp` 存在，但是我在 M4 阶段用 `install -d` 手工建的**，而不是部署流程或代码建的。

## 二、为什么现在没暴露

- 服务器上的目录是我手工建的，所以**在现有机器上一切正常**
- 因此**只有在全新机器/重建环境时才会暴露** —— 这类缺口在"当前机器一切正常"的假象下最容易被漏掉

## 三、性质

```
分类: DEPLOYMENT_GAP（不是产品逻辑缺陷，也不是测试缺陷）
影响: 全新部署（或 `.tmp` 被清理）后，上传功能整体 500，直到有人手工建目录
严重度: 中高 —— 功能级不可用，但只在特定条件下触发
```

## 四、两种修法（择一，需审核/用户定）

**方案 A：代码启动时创建（自愈）**
在服务启动阶段 `mkdir -p UPLOAD_ROOT/{public,private,.tmp}`（含权限）。
- 优点：任何环境自愈，不依赖部署脚本；与"不跑构建/不跑建目录脚本"的部署形态兼容
- 缺点：服务需要对 `UPLOAD_ROOT` 有写权限（现在有：都属于 `campus`）

**方案 B：部署脚本负责 + 文档写明**
在 `tools/deploy-server.ps1` 里加一步建目录，并在部署文档里作为前置条件写明。
- 优点：服务不需要自愈逻辑（更"纯洁"）
- 缺点：**依赖人记得跑部署脚本**；且与我们"服务端零 node_modules、单文件产物"的部署形态相比，
  这属于额外的人工步骤，容易在新机器上漏掉

**我的倾向：A**。理由是本项目已有先例——M4 的孤儿清扫、备份屏障等都倾向"让系统自己能兜住"，
而不是"要求人按步骤做对"。但这条涉及部署形态，**需审核/用户确认后再改**。

## 五、顺带记录：子代理报的另外两件事

1. **它顺手修了一个既有的 Windows-only bug**：`index.ts` 入口判断手拼 `file://${argv[1]}`
   在 Windows 上恒为 false，导致 `node dist/index.mjs` **静默退出 0**；改用 `pathToFileURL`。
   （Linux 行为不变；它是为了在本地起服务做端到端验证才改的，**已如实报备越界**。）
2. **它发现 `POST /api/media` 缺 `.tmp` 目录会 500**（本文件的缺口）。

**两件都属"如实汇报自己越界/发现的问题"，符合本项目对代理的要求。**

## 六、待办

- [ ] 与审核/用户确认采用方案 A 还是 B
- [ ] 若采用 A：在服务启动阶段 mkdir（并加断言：启动后 `.tmp` 可写）
- [ ] 在 `docs/archive/legacy-development/RESUME-POINT.md` 里登记该缺口，避免新环境部署时踩到
