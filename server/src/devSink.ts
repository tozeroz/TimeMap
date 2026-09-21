import { mkdirSync, writeFileSync, chmodSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 开发用验证码投递通道（dev sink）。
 *
 * 审核记录 08 第 2 点明确要求：开发投递要用**独立 dev sink**，
 * 优先 `/run`（tmpfs，重启即清，不落盘持久化），并且**不要进入普通日志**。
 *
 * 为什么不能写日志：日志会被 `journalctl`、日志收集器、以及各种"把日志贴给别人看"的场景带走；
 * 一次性验证码出现在日志里，等于把一次登录凭证散播到多个地方。
 * 为什么用 /run 而不是 /tmp：/run 是 tmpfs，权限可控、重启自动清空，
 * 不会像 /tmp 那样被别的进程读到或留下长期残留。
 *
 * **这是 demo 的降级通道**：本项目没有短信服务商。流程本身是真的
 * （真随机码、有有效期、限流、一次性消费、失败计数），只有"送达方式"是桩。
 * 报告里必须显式标注 `SMS_GATEWAY_NOT_INTEGRATED`，不得据此宣称登录功能已完成。
 */
export interface DevSink {
  /** 投递一次验证码；返回落盘路径（便于运维取用） */
  deliver(phoneE164: string, code: string, expiresAt: Date): string
  /** 目录是否可用（不可用时上层应当明确失败，而不是假装发出去了） */
  available(): boolean
}

export function createDevSink(dir: string): DevSink {
  function ensureDir(): boolean {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      chmodSync(dir, 0o700)
      return true
    } catch {
      return false
    }
  }

  return {
    available: () => {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        return true
      } catch {
        return false
      }
    },

    deliver(phoneE164, code, expiresAt) {
      if (!ensureDir()) {
        throw new Error(`dev sink 不可写: ${dir}（请检查 LOGIN_CODE_SINK 指向的目录与权限）`)
      }
      const payload = JSON.stringify(
        {
          phone_e164: phoneE164,
          code,
          created_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          note: '仅 demo 使用：本项目未接入短信通道，验证码由此目录投递',
        },
        null,
        2,
      )
      // 文件名用号码（去掉 +），运维一眼能找到；权限 0600，只有本用户可读
      const safe = phoneE164.replace(/[^0-9]/g, '')
      const path = join(dir, `${safe}.json`)
      writeFileSync(path, `${payload}\n`, { mode: 0o600 })
      // 另写一份 latest，方便"最近一次验证码"的运维取用
      writeFileSync(join(dir, 'latest.json'), `${payload}\n`, { mode: 0o600 })
      return path
    },
  }
}

/** 读最近一次投递的验证码（给运维 CLI 用；仅供本地/服务器上的人工操作） */
export function readLatestCode(dir: string): { phone_e164: string; code: string; expires_at: string } | null {
  const p = join(dir, 'latest.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** 列出 sink 目录里的投递记录（号码列表） */
export function listDelivered(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'latest.json')
  } catch {
    return []
  }
}
