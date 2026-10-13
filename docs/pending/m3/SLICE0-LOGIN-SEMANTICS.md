# Slice 0A：原版登录语义观察与冻结

> 依据审核记录 07（P1-1）：Slice 0 必须先观察 login semantics，再实现 UI；
> 铁律：**M2 的 handle+password 是实现基础，不是原版 login semantics 的证据**。
> 观察时间：2026-09-21 10:39–10:41（Asia/Shanghai）
> 结论：**原版是「手机号 + 短信验证码」，没有密码，没有第三方 SNS 登录。**

## 一、观察到的完整链路

```
深链 campusx://login/select
   ↓  com.kairuotu.account.login.activity.CampusLoginActivity
CampusLoginActivity（登录入口）
   · id/cl_phone_cover_view        全屏封面
   · id/cl_phone_login  [154,1636][926,1720]  ← 唯一登录入口（clickable）
        id/iv_phone   手机图标
        id/tv_phone   「登录 Campus」
   · id/cl_agreement / id/cb_agreement(CheckBox) / id/tv_agreement
        「我已阅读并同意《用户协议》《隐私政策》《未成年人个人信息保护规则》」
   ↓ 未勾选协议时点「登录 Campus」
弹窗：请阅读并同意以下条款
      《用户协议》《隐私政策》《未成年人个人信息保护规则》
      id/btn_agree  [135,1748][945,1832]  「同意并继续」
   ↓ 点「同意并继续」
com.kairuotu.account.login.activity.CampusSnsLoginActivity（手机号页）
   · 「输入手机号」标题
   · 「+86」固定国家码
   · id/phone_number  (EditText) [225,449][1010,506]   ← 手机号输入框
   · id/next_step     「获取验证码」[347,618][732,702]
   · id/btnBack       返回
```

## 二、冻结的语义（实现登录 UI 时必须遵守）

| 项 | 观察结论 | 说明 |
|---|---|---|
| 身份体系 | **手机号 + 短信验证码** | Activity 类名虽是 `CampusSnsLoginActivity`，但页面上只有手机号输入 + 「获取验证码」，**没有任何第三方登录按钮** |
| 国家码 | 固定「+86」 | 中国手机号；本次未观察到国家码选择器 |
| 密码 | **不存在** | 页面上没有密码输入；M2 的 password 机制是**我们自己的实现选择**，不是原版语义 |
| 第三方 SNS | **不存在** | 全页只有 1 个 ImageView（手机图标），没有 QQ/微信/Apple 等入口 |
| 协议门槛 | **不是禁用按钮，而是弹窗** | 未勾选直接点登录 → 弹「请阅读并同意以下条款」+「同意并继续」（`id/btn_agree`） |
| 入口数量 | **1 个** | `id/cl_phone_login` 是全页唯一的登录入口 |

## 三、由此产生的实现结论（Slice 0B）

**不能**把登录 UI 做成"用户名 + 密码"表单 —— 那是把 M2 的实现倒推成原版语义（审核明确禁止）。
正确做法：

```
登录入口页：品牌 + 「登录 Campus」+ 协议勾选（未勾选 → 同样的同意弹窗）
手机号页：  「输入手机号」+ +86 + 手机号输入 + 「获取验证码」
验证码页：  （本轮未观察到，见第四节）
登录成功：  服务端签发 session（沿用 M2 已冻结的 token 机制）
```

**关于验证码通道的现实约束**（必须如实记录，不能假装）：
真实短信需要短信服务商与费用，本 demo 没有。可选做法：

- ~~固定万能验证码~~：不行 —— 这相当于在生产代码里留一个**永久有效凭证**，
  与审核记录 06 否掉 `dev-register` 的理由（"条件开启的能力不该存在于生产二进制"）是同一类问题。
- **采用**：服务端真实生成一次性验证码（随机、有有效期、限流、一次性消费），
  由于没有短信通道，投递方式降级为**服务端日志**。流程本身是真的，只有"送达渠道"是桩。
  这属于必须在报告里显式声明的限制（`SMS_GATEWAY_NOT_INTEGRATED`），不能算作"登录功能已完成"。

## 四、本轮**刻意没有观察**的部分（含理由）

1. **验证码页 / 登录成功后的行为**
   手机号输入框里预填着一个**真实手机号**。点「获取验证码」会给这个号码**真发短信**。
   对一个第三方号码触发真实短信是不应该做的事，因此本轮**主动停止**在这一步。
   → 记录为 `BLOCKED_BY_ETHICS`，不是"没做"。

2. **协议未勾选时弹窗的"取消/关闭"路径**
   弹窗是模态的；未进一步验证是否存在其它关闭方式。

## 五、隐私处理（重要）

- `login-sns` 的输入框预填了真实手机号。M0 已在 `normal.png` 上做过打码并登记
  `evidence_mask`（像素框 `196,448,420,62`）。
- **本轮新增的 `recovered-m3.png` 用同一像素框做了同样的打码**，并**用视觉模型复核确认号码不可读**。
- 新增的控件树 `recovered-m3-ui.xml` 里同样把号码替换为 `[redacted]`。
- 另外扫描了 `docs/original-baseline` 下全部 40 个文本证据文件，确认没有手机号残留
  （仅有的两处匹配位于 SHA256 十六进制串内部，属误报）。

## 六、证据

| 文件 | 内容 |
|---|---|
| `screens/login-select/recovered-m3.png` | 登录入口页（唯一入口 + 协议） |
| `screens/login-select/recovered-m3-ui.xml` | 控件树（含 id 与 bounds） |
| `screens/login-select/recovered-m3-agreement-dialog.png` | 未勾选点登录 → 同意弹窗 |
| `screens/login-select/recovered-m3-agreement-dialog-ui.xml` | 弹窗控件树（`id/btn_agree`） |
| `screens/login-sns/recovered-m3.png` | 手机号页（**手机号已打码**） |
| `screens/login-sns/recovered-m3-ui.xml` | 控件树（手机号已替换为 `[redacted]`） |

## 七、对 M2 认证契约的影响（需要审核确认的点）

M2 的认证契约（`docs/pending/m2/SPEC.md` 第二节）冻结的是 `handle + password`，
并且是**已通过审核的**。本轮的观察说明原版用的是手机号 + 验证码。

两者不是冲突关系，而是**两层**：
- **机制层**（token 签发、只存 hash、过期、撤销、限流、作者只能来自 session）—— M2 已冻结，继续沿用；
- **身份层**（用户用什么标识自己、如何证明）—— 原版是手机号 + 验证码。

因此 Slice 0B 的改动是：**在既有 session 机制之上，补一条手机号 + 一次性验证码的身份路径**，
而不是推翻 M2。这会新增：`users.phone`（唯一）、`login_codes`（手机号、码哈希、过期、已被消费、尝试次数）。
**这一条要不要做、以什么形式做，提交审核确认后再动手**（它是 M2 冻结面之外的扩展）。
