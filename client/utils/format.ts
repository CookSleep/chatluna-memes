// 与 Vue 状态无关的展示和转换函数。

/** 浏览器里加载外部图片失败时的统一说明。 */
export const CROSS_ORIGIN_HINT = '浏览器没能加载这张图片，这不代表机器人发图一定失败。\n常见原因：图源开启了防盗链或跨域限制、HTTPS 页面加载 HTTP 图片被拦截，或者是只有服务器能访问的内网地址。'

export function readSessionOption<T extends string>(key: string, fallback: T, options: readonly T[]): T {
  const value = sessionStorage.getItem(key)
  return options.includes(value as T) ? value as T : fallback
}

/** 标签颜色只按名称决定色相，明暗由样式按主题处理。 */
export function tagHue(tag: string): number {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash) + tag.charCodeAt(i)
  return Math.abs(hash) % 360
}

export function formatDate(value?: string | Date): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return String(Math.round(value * 100)) + '%'
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function getImageExtension(filename: string): string {
  const ext = filename.split('.').pop()
  return ext ? ext.toUpperCase() : 'IMG'
}

export function getExternalLinkLabel(link: string): string {
  try {
    const url = new URL(link)
    const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname)
    return filename || url.hostname
  } catch {
    return link
  }
}

export function humanizeSource(source: string): string {
  if (!source || source === 'filter' || source === 'upload-filter') return '上传时拦截'
  if (source.startsWith('auto:')) return `群 ${source.slice(5)} 自动收集`
  if (source.startsWith('upload:')) return `上传到「${source.slice(7)}」时拦截`
  return source
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      const result = reader.result as string
      const base64Content = result.split(',')[1]
      resolve(base64Content)
    }
    reader.onerror = error => reject(error)
  })
}

/** 图库选择集合里外链以地址存储，本地图片以文件名存储。 */
export function isLinkValue(value: string): boolean {
  return /^https?:\/\//i.test(value)
}
