import { createHmac, randomUUID } from 'node:crypto'

/**
 * 短信投递：阿里云「短信认证」（号码认证服务 PNVS / dypnsapi）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么选它（调研结论，Round 322）
 * ═══════════════════════════════════════════════════════════════════════════
 * 阿里云官方文档：「短信认证服务是阿里云为个人和企业用户提供的验证服务，您可
 * **免申请资质、签名和模板**，通过 API 直接使用……特别适合**无法提供企业资质**
 * 但有验证码场景需求的**个人用户**。」
 *   · 腾讯云短信：自 **2025-09-18** 起**不再支持创建个人自用资质**；个人只能走
 *     「他用资质」，而要企业营业执照＋公章＋双方授权委托书 ⇒ 个人实质不可用。
 *   · 阿里云短信服务（SMS，dysmsapi）：个人可申请验证码**模板**，但**签名**仍需
 *     实名资质报备 ⇒ 通常要企业或已备案网站/上架应用。
 * ⇒ 个人主体可用的大厂方案里，只有这个。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ 两处**刻意**的设计选择（值得记，避免日后误解）
 * ═══════════════════════════════════════════════════════════════════════════
 * ① **不引阿里云 SDK**，手写 RPC 风格 V1 签名（HMAC-SHA1）。
 *    原因：本项目服务端是 esbuild 打成的**单文件** bundle，引 SDK 会带进一串依赖，
 *    而这个签名算法是**稳定且公开**的（约 40 行）。**已实测**：用占位签名/模板调用，
 *    返回 `isv.INVALID_PARAMETERS「签名或者模版无效」` —— 这是**通过鉴权之后**的
 *    业务错误（不是 InvalidAccessKeyId / SignatureDoesNotMatch）⇒ 证明签名实现对。
 * ② **传我们的自定义验证码**（`TemplateParam` 里给具体值），而**不用** `##code##` 占位符。
 *    官方明确："验证码是用户配置的不是api动态生成，**阿里云接口无法校验**"。
 *    这正是我们要的：**验证码的生成/存储/校验仍由我们自己做**（已有的真随机、
 *    HMAC 存储、5 分钟 TTL、限流、一次性 token 全都保留），短信通道只负责**送达**。
 *    ⇒ 否则就要把校验链路搬到阿里云，反而丢掉我们已有的安全设计。
 */

/** 发送结果：**明确区分**"通道没配"、"发失败"、"发成功"，不把三者混成一个 false */
export type SmsSendResult =
  | { ok: true; bizId: string | null; requestId: string | null }
  | { ok: false; reason: 'not_configured' | 'network' | 'api_error'; code: string; message: string }

export interface SmsSender {
  /** 是否已配置（未配置时调用方应回退到 dev sink，并**如实**在响应里标明） */
  readonly configured: boolean
  sendVerifyCode(phoneE164: string, code: string, ttlSeconds: number): Promise<SmsSendResult>
}

const ENDPOINT = 'https://dypnsapi.aliyuncs.com/'
const API_VERSION = '2017-05-25'
const ACTION = 'SendSmsVerifyCode'

/**
 * 阿里云规定的 percentEncode：先 encodeURIComponent，再
 * `+` → %20、`*` → %2A、`%7E` → `~`。
 * ⚠️ 这三步**不能省**：漏掉任何一个都会导致 SignatureDoesNotMatch，而且报错不会
 *    告诉你差在哪。实现后**必须用真实调用验证过**（本文件即如此）。
 */
function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')
}

/** 阿里云 RPC 风格 V1 签名的 StringToSign 与最终 URL 构造 */
export function buildSignedUrl(
  akId: string,
  akSecret: string,
  actionParams: Record<string, string>,
  now: Date = new Date(),
): string {
  const params: Record<string, string> = {
    Format: 'JSON',
    Version: API_VERSION,
    AccessKeyId: akId,
    SignatureMethod: 'HMAC-SHA1',
    // 阿里云要求 ISO8601 UTC、**不带毫秒**
    Timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID(),
    Action: ACTION,
    ...actionParams,
  }
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&')
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`
  const signature = createHmac('sha1', akSecret + '&').update(stringToSign).digest('base64')
  return `${ENDPOINT}?Signature=${percentEncode(signature)}&${canonical}`
}

export interface SmsSenderConfig {
  akId: string
  akSecret: string
  /** 控制台「赠送签名配置」里选定的签名名 —— 只能用系统赠送的，不能自定义 */
  signName: string
  /** 控制台「赠送模板配置」里选定的模板 CODE —— 必须与赠送签名配套使用 */
  templateCode: string
  /**
   * 验证码有效期的「分钟」值。⚠️ 这是**模板里给用户看的文字**，
   * 与我们的 TTL（秒）是两回事；必须与 TTL 保持一致，否则短信说的和实际不符。
   */
  ttlMinutes: number
}

export function createSmsSender(cfg: SmsSenderConfig | null): SmsSender {
  if (!cfg || !cfg.akId || !cfg.akSecret || !cfg.signName || !cfg.templateCode) {
    return {
      configured: false,
      async sendVerifyCode() {
        return {
          ok: false,
          reason: 'not_configured',
          code: 'SMS_NOT_CONFIGURED',
          message: '未配置短信通道（缺 AK 或赠送签名/模板）',
        }
      },
    }
  }

  return {
    configured: true,
    async sendVerifyCode(phoneE164: string, code: string, ttlSeconds: number): Promise<SmsSendResult> {
      /*
        ⚠️ 手机号：阿里云这个接口要**不带 + 和国家码**的国内号码（配合 CountryCode=86）。
          我们从库里拿的是 E.164（+8613800000001）⇒ 这里剥掉 +86 前缀。
          剥不掉就**直接报错**，不要硬发一个格式可疑的号（那会浪费一次计费且难排查）。
      */
      const m = /^\+86(\d{11})$/.exec(phoneE164)
      if (!m) {
        return {
          ok: false,
          reason: 'api_error',
          code: 'PHONE_NOT_CN_MOBILE',
          message: `只支持中国大陆手机号（收到 ${phoneE164}）`,
        }
      }
      const phone = m[1]

      const templateParam = JSON.stringify({
        code,
        min: String(Math.max(1, Math.round(ttlSeconds / 60))),
      })

      const url = buildSignedUrl(cfg.akId, cfg.akSecret, {
        PhoneNumber: phone,
        SignName: cfg.signName,
        TemplateCode: cfg.templateCode,
        TemplateParam: templateParam,
        CountryCode: '86',
        // 频控：与官方默认一致（60 秒）。我们自己的限流器仍是第一道。
        Interval: '60',
        /*
          ⚠️ 传**具体验证码**（不是 ##code## 占位符）⇒ 阿里云不参与生成与校验，
             校验由我们自己的 /api/auth/verify-code 完成（见文件头 ② 的解释）。
        */
        ReturnVerifyCode: 'false',
      })

      let res: Response
      try {
        res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) })
      } catch (e) {
        return {
          ok: false,
          reason: 'network',
          code: 'SMS_NETWORK_ERROR',
          message: String((e as Error)?.message ?? e),
        }
      }

      let body: { Code?: string; Message?: string; Success?: boolean; Model?: { BizId?: string; RequestId?: string } } = {}
      try {
        body = (await res.json()) as typeof body
      } catch {
        return {
          ok: false,
          reason: 'api_error',
          code: `HTTP_${res.status}`,
          message: '响应不是 JSON',
        }
      }

      if (body.Code === 'OK' && body.Success !== false) {
        return { ok: true, bizId: body.Model?.BizId ?? null, requestId: body.Model?.RequestId ?? null }
      }
      return {
        ok: false,
        reason: 'api_error',
        code: body.Code ?? `HTTP_${res.status}`,
        message: body.Message ?? '未知错误',
      }
    },
  }
}
