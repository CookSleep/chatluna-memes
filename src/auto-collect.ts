import { Context, h } from 'koishi'
import type { Settings } from './settings'
import {
  FREQUENCY_TRACKER_CLEANUP_RATIO,
  MAX_FREQUENCY_TRACKER_SIZE,
} from './constants'
import { downloadImage } from './download'
import { getExtFromMagicBytes } from './image-format'
import { hashImageBuffer } from './service'
import { getDailyKey } from './utils'

interface AutoCollectFrequencyRecord {
  timestamps: number[]
  staged: boolean
}

interface AutoCollectDailyLimitRecord {
  day: string
  count: number
}

/** 取出消息里的图片地址；不同适配器分别用 image 和 img 元素。 */
export function getMessageImages(elements: h[] = []): string[] {
  return h
    .select(elements, 'image')
    .concat(h.select(elements, 'img'))
    .map((img) => img.attrs.url || img.attrs.src)
    .filter(Boolean)
}

function getSessionGroupId(session: any): string {
  return session.guildId || session.channelId || ''
}

function hitDailyAutoCollectLimit(
  groupId: string, limit: number,
  autoCollectDailyLimits: Map<string, AutoCollectDailyLimitRecord>
): boolean {
  const day = getDailyKey()
  const current = autoCollectDailyLimits.get(groupId)
  if (!current || current.day !== day) {
    autoCollectDailyLimits.set(groupId, { day, count: 1 })
    return false
  }
  if (current.count >= limit) return true
  current.count++
  return false
}

function isDailyAutoCollectLimitReached(
  groupId: string, limit: number,
  autoCollectDailyLimits: Map<string, AutoCollectDailyLimitRecord>
): boolean {
  const day = getDailyKey()
  const current = autoCollectDailyLimits.get(groupId)
  if (!current || current.day !== day) return false
  return current.count >= limit
}

function trackImageFrequency(
  hash: string, groupId: string, windowMs: number,
  autoCollectFrequencyTracker: Map<string, AutoCollectFrequencyRecord>
): { count: number; alreadyStaged: boolean } {
  const now = Date.now()
  const key = `${groupId}:${hash}`
  const record = autoCollectFrequencyTracker.get(key) || { timestamps: [], staged: false }
  record.timestamps = record.timestamps.filter((timestamp) => now - timestamp <= windowMs)
  record.timestamps.push(now)
  autoCollectFrequencyTracker.set(key, record)
  return { count: record.timestamps.length, alreadyStaged: record.staged }
}

function markImageFrequencyStaged(
  hash: string, groupId: string,
  autoCollectFrequencyTracker: Map<string, AutoCollectFrequencyRecord>,
  staged = true
) {
  const key = `${groupId}:${hash}`
  const record = autoCollectFrequencyTracker.get(key)
  if (record) record.staged = staged
}

/** 清理过期时间戳；条目数仍超过上限时删除最老的一部分，防止内存无限增长。 */
function cleanupAutoCollectFrequency(
  windowMs: number,
  autoCollectFrequencyTracker: Map<string, AutoCollectFrequencyRecord>
) {
  const now = Date.now()
  for (const [key, record] of autoCollectFrequencyTracker.entries()) {
    record.timestamps = record.timestamps.filter((timestamp) => now - timestamp <= windowMs)
    if (!record.timestamps.length) {
      autoCollectFrequencyTracker.delete(key)
    }
  }

  if (autoCollectFrequencyTracker.size <= MAX_FREQUENCY_TRACKER_SIZE) return

  const removeCount = Math.max(
    1,
    Math.floor(autoCollectFrequencyTracker.size * FREQUENCY_TRACKER_CLEANUP_RATIO)
  )
  // 按最早时间戳排序，删掉最老的一批。
  const entries = [...autoCollectFrequencyTracker.entries()]
    .map(([key, record]) => {
      const earliest = record.timestamps.length
        ? Math.min(...record.timestamps)
        : 0
      return { key, earliest }
    })
    .sort((a, b) => a.earliest - b.earliest)

  for (let i = 0; i < removeCount && i < entries.length; i++) {
    autoCollectFrequencyTracker.delete(entries[i].key)
  }
}

export function applyAutoCollect(ctx: Context, config: Settings) {
  if (!config.autoCollect) return

  // 放在函数内，热重载时随插件一起销毁，不会累积。
  const autoCollectFrequencyTracker = new Map<string, AutoCollectFrequencyRecord>()
  const autoCollectDailyLimits = new Map<string, AutoCollectDailyLimitRecord>()

  const windowMinutes = Math.max(1, config.emojiFrequencyWindowMinutes || 10)
  const windowMs = windowMinutes * 60 * 1000
  const threshold = Math.max(1, config.emojiFrequencyThreshold || 3)
  const minBytes = Math.max(0, config.minEmojiSize ?? 4) * 1024
  const maxBytes = Math.max(1, config.maxEmojiSize || 15) * 1024 * 1024
  const dailyLimit = Math.max(1, config.groupAutoCollectLimit || 300)

  ctx.on('message', async (session) => {
    if (session.isDirect) return
    if (!ctx.chatluna_memes) return

    const groupId = getSessionGroupId(session)
    if (!groupId) return

    if (isDailyAutoCollectLimitReached(groupId, dailyLimit, autoCollectDailyLimits)) return

    const imageUrls = getMessageImages(session.elements)
    if (!imageUrls.length) return

    const service = ctx.chatluna_memes
    await service.ready

    for (const url of imageUrls) {
      try {
        const buffer = await downloadImage(ctx, url, maxBytes)
        const ext = getExtFromMagicBytes(buffer)
        if (!ext) continue
        if (buffer.length < minBytes || buffer.length > maxBytes) continue

        const hash = hashImageBuffer(buffer)
        const frequency = trackImageFrequency(hash, groupId, windowMs, autoCollectFrequencyTracker)
        if (frequency.alreadyStaged || frequency.count < threshold) continue
        // 在任何 await 之前标记，避免并发消息重复计入每日上限。
        markImageFrequencyStaged(hash, groupId, autoCollectFrequencyTracker)

        // 没收进待审区（达到上限或出错）就撤销标记，图片再次出现时还能收集。
        let collected = false
        try {
          if (await service.getDuplicateImageByHash(hash, { includeStaged: true, includeImages: true })) {
            collected = true
            continue
          }
          if (hitDailyAutoCollectLimit(groupId, dailyLimit, autoCollectDailyLimits)) {
            ctx.logger('chatluna-memes').debug(`Auto collect daily limit reached for group ${groupId}`)
            continue
          }
          await service.addStagedImageBuffer(
            buffer,
            `auto-${Date.now()}${ext}`,
            `auto:${groupId}`,
            `${windowMinutes} 分钟内出现 ${frequency.count} 次`
          )
          collected = true
        } finally {
          if (!collected) markImageFrequencyStaged(hash, groupId, autoCollectFrequencyTracker, false)
        }
      } catch (error) {
        const message = (error as Error).message
        // 重复图片属于正常情况；下载、写入等失败需要能在日志里看到。
        if (message.startsWith('Duplicate image')) continue
        ctx.logger('chatluna-memes').warn(`Auto collect image failed: ${message}`)
      }
    }
  })

  ctx.setInterval(() => cleanupAutoCollectFrequency(windowMs, autoCollectFrequencyTracker), Math.max(60 * 1000, windowMs))
  ctx.logger('chatluna-memes').info(`Auto collect started: ${windowMinutes}m/${threshold} times, ${config.minEmojiSize ?? 4}KB-${config.maxEmojiSize || 15}MB, ${dailyLimit}/day/group`)
}
