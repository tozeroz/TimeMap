# HTTPS 证书：Let's Encrypt **IP 地址证书**（免域名方案）

> 2026-09-23 落地。这是一次**方案级变更**：后端 HTTPS 从「自建私有 CA 自签」换成「Let's Encrypt 公共信任」。

## 一、为什么必须换

| | 自建私有 CA（原方案） | Let's Encrypt IP 证书（现方案） |
|---|---|---|
| App（APK）能用吗 | ✅ 能（APK 内置了那个 CA） | ✅ 能（配置里同时信任 `system`） |
| **浏览器能用吗** | ❌ **不能** —— 浏览器不认私有 CA | ✅ 能（链到 ISRG Root X1） |
| iOS Safari | ❌ | ✅ |
| 需要域名 | 不需要（用裸 IP） | **不需要** |
| 需要备案 | 不需要（无域名） | 不需要（无域名） |
| 成本 | ¥0 | ¥0 |
| 有效期 | 自制（我们设了 2 年） | **约 6 天（强制）** |

**触发原因**：要做网页端。私有 CA 下浏览器必然报证书错误 ⇒ 普通用户根本用不了。
实测证据：从服务器直连 `https://8.148.156.146/`（不带 `-k`）报
`curl: (60) unable to get local issuer certificate`。

## 二、为什么可以不用域名（关键调研结论）

- 阿里云备案文档明确：**「若域名仅解析至非中国内地的服务器，则无需进行备案」**，
  而备案的**要求一**是「域名后缀须获得**工信部批复**」⇒ 免费子域（duckdns.org / eu.org /
  github.io 等）**过不了备案**，在**大陆服务器**上用免费域名这条路是死的。
- Freenom 的免费 .tk/.ml/.ga/.cf **已全面失效**（2025-07-31 到期，须付费）。
- ⭐ **转机**：Let's Encrypt 自 **2026-01-15 起正式支持给纯 IP 签发公共信任证书**
  （[官方公告](https://www.abetterinternet.org/post/ip-and-6day-general-availability/)）。
  ⇒ **免域名、免备案、零成本**即可让浏览器信任。

## 三、技术要点（含踩到的坑）

### 3.1 环境前提（都已实测）
```
Ubuntu 26.04.1 / nginx 1.28.3（80+443 都在听）
acme-v02.api.letsencrypt.org 可达（http=200，TLS 0.50s）
公网 80 可达（http-01 需要 LE 来抓挑战文件）
```

### 3.2 ⚠️ 坑 1：apt 的 certbot **不支持 IP 证书**
Ubuntu 26.04 仓库里是 **certbot 4.0.0**，而 IP 证书需要 **≥ 5.4**
（5.3 才有 `--ip-address`，5.4 才支持 webroot 配 IP）。
⇒ 装在 **`/opt/certbot`（venv）**，实际版本 **5.8.0**。
（不用 snap：境内服务器拉 snap 常慢/不稳；venv 可控可复现。）

### 3.3 ⚠️ 坑 2：staging → production 会**静默不签发**
先用 `--staging` 验证流程（**强烈建议**，不消耗正式额度）。但 staging 与 production
用**同一个 cert-name**（就是 IP 地址）⇒ 第二次不带 `--staging` 申请时，certbot 看到该
lineage "还没到期"就**直接跳过**，输出 `Certificate not yet due for renewal`，
于是**配置里留下的还是 staging 证书（浏览器不信任）**。
⇒ 必须 `certbot delete --cert-name 8.148.156.146` 后再申请 production。

### 3.4 ⚠️ 坑 3：certbot **不会**把 IP 证书装进 web server
官方文档明确："Certbot only supports getting IP address certificates, not yet installing
them in your web server"，且 **nginx / apache 插件不支持 IP 证书**。
⇒ 必须：
- 用 **webroot** 模式（`--webroot -w /var/www/certbot`，不需要停 nginx）
- **手写** nginx 的证书路径（见 `ops/nginx/campus.conf`）
- **自己配 deploy-hook** 让续期后重载 nginx

### 3.5 ⚠️ 坑 4：6 天有效期 ⇒ 自动续期**是功能的一部分**
漏一次就是**全站证书错误**。已落地的方案：
```
/etc/letsencrypt/renewal/8.148.156.146.conf  → renew_hook = systemctl reload nginx
/etc/systemd/system/certbot-renew.timer      → 每天 00:17 / 12:17（±1h 随机）
/etc/systemd/system/certbot-renew.service    → /opt/certbot/bin/certbot renew --quiet
```
**已实测真实续期**（不是只配好就走）：
```
续期前 fingerprint C8:CE:85:…
续期后 fingerprint 27:AD:43:…      ← 确实换了
nginx 下发的指纹 == 新证书指纹      ← deploy-hook 生效
续期后公网信任仍通过（ssl_verify=0）
```

### 3.6 验证（都做过）
| 验证 | 结果 |
|---|---|
| 证书 SAN 是 iPAddress | ✅ `IP Address:8.148.156.146` |
| 证书链到公共根 | ✅ YE1 → Root YE → ISRG Root X2 → **ISRG Root X1** |
| 服务器连采 5 次 nginx 下发的证书 | ✅ 5/5 都是 LE（排除 reload 竞态误判） |
| **真实浏览器打开** | ✅ **无证书警告**（Chromium 直接渲染出响应） |
| App（APK）仍能连 | ✅ 门禁 PASS（它信任 `system` CA） |
| 自动续期真的能续 | ✅ 强制续期实测 + deploy-hook 生效 |

## 四、哪些东西**不要动**

- ⚠️ **`/etc/ssl/campus/` 那套私有 CA 文件保留**：可回滚；且 **APK 里内置的就是它**
  （删了会让已安装的旧 APK 无法连——虽然现在 LE 证书也认，但保留更安全）。
- ⚠️ `.well-known/acme-challenge/` 这个 location **不能删**，否则续期失败。
- ⚠️ **不要**用 `ops/nginx/` 之外的路径改证书：仓库是唯一真源（这条吃过亏）。

## 五、遗留与风险

1. **无域名 ⇒ 用户看到 IP**：不专业、不好传播；正式运营时仍需域名 + 备案。
2. **6 天证书的运维成本**：依赖 timer 正常工作。建议加一条**到期监控**
   （例如每天检查剩余天数，<2 天报警）—— 目前**没做**。
3. **速率限制**：LE 对同一组标识符有每周签发上限（生产环境 5 张/周）。
   我们每天两次 `renew` 由 certbot 自行判断是否到期，正常不会触及；但**频繁手动
   `--force-renewal` 有风险**。
4. **国内部分老设备/浏览器**可能不认 IP 证书（ISRG Root X1 需 Android ≥7.1.1）。
   现代机型无问题；**未逐机型实测**。
