import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { aborted } from 'node:util'
import { isBlockedAddress } from '@chatluna/search'
import type { Context } from 'cordis'
import type { Http } from '@cordisjs/plugin-http'
import {
  MAX_IMAGE_BYTES,
  IMAGE_DOWNLOAD_MAX_RETRIES,
  IMAGE_DOWNLOAD_TIMEOUT,
  IMAGE_DOWNLOAD_RETRY_DELAY,
} from './constants'
import { sleep } from './utils'

async function publicAddress(host: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const resolution = lookup(host, { all: true, order: 'ipv4first' })
  const addresses = await Promise.race([
    resolution,
    aborted(signal, resolution).then((): never => { throw signal.reason })
  ])
  if (!addresses.length || addresses.some(entry => isBlockedAddress(entry.address))) {
    throw new Error('请使用公网图片 URL。')
  }
  return addresses[0]!.address
}

async function fetchImage(http: Http, source: string, maxBytes: number) {
  const signal = AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT)
  const proxy = http.resolveConfig({}).proxyAgent
  let url = new URL(source)
  for (let hop = 0; hop <= 5; hop++) {
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请使用公网图片 URL。')
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const address = await publicAddress(host, signal)
    // 连接已核验的地址，同时保留域名供虚拟主机和证书校验使用。
    const target = new URL(url)
    target.hostname = isIP(address) === 6 ? '[' + address + ']' : address
    const tls = isIP(host) ? {} : { servername: host }
    const dispatcher = proxy ? new http.undici.ProxyAgent({ uri: proxy, requestTls: tls })
      : new http.undici.Agent({ connect: tls })
    try {
      const response = await dispatcher.request({
        origin: target.origin, path: target.pathname + target.search, method: 'GET',
        headers: { host: url.host, accept: 'image/*' }, signal
      })
      const location = response.headers['location']
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && typeof location === 'string') {
        url = new URL(location, url)
        continue
      }
      if (response.statusCode < 200 || response.statusCode >= 300) throw Object.assign(new Error('获取图片失败，HTTP ' + response.statusCode), { status: response.statusCode })
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > maxBytes) throw new Error(`Downloaded image size exceeds maximum limit of ${maxBytes} bytes`)
        chunks.push(chunk)
      }
      if (!size) throw new Error('图片内容为空。')
      return Buffer.concat(chunks)
    } finally { await dispatcher.destroy() }
  }
  throw new Error('图片链接重定向次数过多。')
}

export function isPrivateIP(rawHostname: string): boolean {
  // URL.hostname 对 IPv6 保留方括号，统一去掉后再判断。
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return hostname === 'localhost' || hostname.endsWith('.localhost') || (isIP(hostname) !== 0 && isBlockedAddress(hostname))
}

export async function downloadImage(ctx: Context, url: string, maxBytes = MAX_IMAGE_BYTES): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(url)
    if (!match) {
      throw new Error('Invalid data URL format')
    }
    if (match[2].length > 4 * Math.ceil(maxBytes / 3)) {
      throw new Error(`Data URL size exceeds maximum limit of ${maxBytes} bytes`)
    }
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length > maxBytes) {
      throw new Error(`Data URL size exceeds maximum limit of ${maxBytes} bytes`)
    }
    return buffer
  }

  // 防 SSRF：只允许 http(s)，并拒绝直接指向内网的地址。
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Invalid URL format')
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Protocol ${parsedUrl.protocol} is not allowed`)
  }

  const hostname = parsedUrl.hostname
  if (isPrivateIP(hostname)) {
    throw new Error('Access to private IP addresses is not allowed')
  }

  const http = ctx.get('http')
  if (!http) throw new Error('下载外部图片需要启用 HTTP 服务')
  let lastError: Error | null = null
  for (let i = 0; i < IMAGE_DOWNLOAD_MAX_RETRIES; i++) {
    try {
      return await fetchImage(http, url, maxBytes)
    } catch (err) {
      lastError = err as Error
      // 4xx 与超出大小限制都是确定性失败，重试无意义。
      const status = (err as { status?: number })?.status
      if ((status >= 400 && status < 500) || /exceeds maximum|公网图片 URL/.test(lastError.message)) break
      if (i < IMAGE_DOWNLOAD_MAX_RETRIES - 1) await sleep(IMAGE_DOWNLOAD_RETRY_DELAY)
    }
  }
  throw new Error(`Failed to download image: ${lastError?.message}`)
}
