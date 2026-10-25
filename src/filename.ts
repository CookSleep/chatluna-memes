import path from 'path'

export function sanitizeFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  let base = ext ? filename.slice(0, filename.length - ext.length) : filename
  base = base.replace(/[\s/\\?%*:|"<>,;=@]+/g, '_')
  base = base.replace(/^[._]+|[._]+$/g, '')
  if (!base) {
    base = `file_${Date.now()}`
  }

  // Windows 不允许这些保留名作为文件名。
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
  if (reserved.test(base)) {
    base = `_${base}`
  }

  // 多数文件系统限制文件名 255 字节，留出扩展名和去重后缀的余量。
  const maxLen = 200 - ext.length
  if (Buffer.byteLength(base, 'utf8') > maxLen) {
    while (Buffer.byteLength(base, 'utf8') > maxLen && base.length > 1) {
      base = base.slice(0, -1)
    }
  }

  return `${base}${ext}`
}
