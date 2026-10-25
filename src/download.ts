import type { Context } from 'koishi'
import {
  IMAGE_DOWNLOAD_MAX_RETRIES,
  IMAGE_DOWNLOAD_TIMEOUT,
  IMAGE_DOWNLOAD_RETRY_DELAY,
} from './constants'
import { sleep } from './utils'

export function isPrivateIP(rawHostname: string): boolean {
  // URL.hostname 对 IPv6 保留方括号，统一去掉后再判断。
  let hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  // IPv4 映射的 IPv6（::ffff:127.0.0.1 / ::ffff:7f00:1）按 IPv4 处理。
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(hostname)
  if (mapped) {
    hostname = mapped[1] || [parseInt(mapped[2], 16) >> 8, parseInt(mapped[2], 16) & 255, parseInt(mapped[3], 16) >> 8, parseInt(mapped[3], 16) & 255].join('.')
  }

  // IPv4 私有地址检测
  if (/^0\./.test(hostname)) return true // 0.0.0.0/8
  if (/^127\./.test(hostname)) return true // 127.0.0.0/8
  if (/^10\./.test(hostname)) return true // 10.0.0.0/8
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true // 172.16.0.0/12
  if (/^192\.168\./.test(hostname)) return true // 192.168.0.0/16
  if (/^169\.254\./.test(hostname)) return true // 169.254.0.0/16 (链路本地)
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)) return true // 100.64.0.0/10 (CGNAT)
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true

  // IPv6 私有地址检测
  if (hostname === '::' || hostname === '::1') return true // 未指定 / 回环
  if (/^fe[89ab][0-9a-f]:/.test(hostname)) return true // 链路本地 fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(hostname)) return true // 唯一本地地址 fc00::/7

  return false
}

export async function downloadImage(ctx: Context, url: string, maxBytes?: number): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(url)
    if (!match) {
      throw new Error('Invalid data URL format')
    }
    const buffer = Buffer.from(match[2], 'base64')
    if (maxBytes && buffer.length > maxBytes) {
      throw new Error(`Data URL size exceeds maximum limit of ${maxBytes} bytes`)
    }
    return buffer
  }

  // SSRF 防护：检查 URL 合法性
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Invalid URL format')
  }

  // 只允许 http 和 https 协议
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Protocol ${parsedUrl.protocol} is not allowed`)
  }

  // 禁止访问私有 IP 地址
  const hostname = parsedUrl.hostname
  if (isPrivateIP(hostname)) {
    throw new Error('Access to private IP addresses is not allowed')
  }

  let lastError: Error | null = null
  for (let i = 0; i < IMAGE_DOWNLOAD_MAX_RETRIES; i++) {
    try {
      const data = await ctx.http.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: IMAGE_DOWNLOAD_TIMEOUT,
        maxContentLength: maxBytes,
      } as any)
      const buffer = Buffer.from(data)
      if (maxBytes && buffer.length > maxBytes) {
        throw new Error(`Downloaded image size exceeds maximum limit of ${maxBytes} bytes`)
      }
      return buffer
    } catch (err) {
      lastError = err as Error
      // 4xx 与超出大小限制都是确定性失败，重试无意义。
      const status = (err as any)?.response?.status
      if ((status >= 400 && status < 500) || /exceeds maximum/.test(lastError.message)) break
      if (i < IMAGE_DOWNLOAD_MAX_RETRIES - 1) await sleep(IMAGE_DOWNLOAD_RETRY_DELAY)
    }
  }
  throw new Error(`Failed to download image: ${lastError?.message}`)
}
