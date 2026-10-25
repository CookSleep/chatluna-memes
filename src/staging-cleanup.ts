import { Context } from 'koishi'
import type { Settings } from './settings'

export function applyStagingCleanup(ctx: Context, config: Settings) {
  const retentionDays = config.stagingRetentionDays || 0
  if (retentionDays <= 0) return

  const cleanup = async () => {
    try {
      const service = ctx.memesluna
      await service.ready
      const deleted = await service.deleteExpiredStagedImages(retentionDays)
      if (deleted > 0) {
        ctx.logger('memesluna').info(`Staging cleanup: removed ${deleted} expired images (retention: ${retentionDays} days)`)
      }
    } catch (error) {
      ctx.logger('memesluna').warn(`Staging cleanup failed: ${(error as Error).message}`)
    }
  }

  // 启动时先清理一次，否则频繁重启会让首次清理一直被推迟。
  void cleanup()
  ctx.setInterval(cleanup, Math.max(60 * 60 * 1000, retentionDays * 24 * 60 * 60 * 1000 / 4))
  ctx.logger('memesluna').info(`Staging auto-clean enabled: retention ${retentionDays} days`)
}
