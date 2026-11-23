import { createHash } from 'crypto'
import { loadPhoton, type PhotonImage } from './photon'

const STICKER_MAX_SIZE = 160

/** 缩略图缓存，容量上限 500 张；超过后整体清空，避免无界增长。 */
const cache = new Map<string, { buffer: Buffer; mime: string }>()

/**
 * 长边缩到 160px 的等比缩略图。
 * GIF 不缩放以保留动效；原图本来就不超过上限、photon 不可用或解码失败时原样返回。
 */
export function stickerImage(image: { buffer: Buffer; mime: string }): { buffer: Buffer; mime: string } {
  if (image.mime === 'image/gif') return image

  // 先按内容查缓存，命中时无需解码原图；换图或重新上传会得到新的内容哈希。
  const cacheKey = `${image.mime}:${createHash('sha1').update(image.buffer).digest('base64')}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const photon = loadPhoton()
  if (!photon) return image

  let source: PhotonImage | null = null
  let resized: PhotonImage | null = null
  try {
    source = photon.PhotonImage.new_from_byteslice(new Uint8Array(image.buffer))
    const width = source.get_width()
    const height = source.get_height()
    const scale = Math.min(1, STICKER_MAX_SIZE / Math.max(width, height))
    if (scale >= 1) return image

    resized = photon.resize(
      source,
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
      photon.SamplingFilter.Lanczos3,
    )
    const result = { buffer: Buffer.from(resized.get_bytes()), mime: 'image/png' }
    if (cache.size >= 500) cache.clear()
    cache.set(cacheKey, result)
    return result
  } catch {
    return image
  } finally {
    source?.free?.()
    resized?.free?.()
  }
}
