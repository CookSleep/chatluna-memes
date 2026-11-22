import type { Context } from 'cordis'
import type {} from '@cordisjs/plugin-timer'
import { AIAnnotator } from './aiAnnotator'
import { applyAutoCollect } from './auto-collect'
import { applyChatlunaVariables } from './chatluna-inject'
import { registerCommands } from './commands'
import { applyConsole } from './console-handlers'
import type { Config } from './config'
import { applyServer } from './http-server'
import { invalidateAllImagesCache } from './search'
import {
  CHATLUNA_MEMES_IMAGES_UPDATED,
  ChatLunaMemesService,
} from './service'
import type { Settings } from './settings'
import { SETTINGS_UPDATED, SettingsStore } from './settings-store'
import { applyStagingCleanup } from './staging-cleanup'

/** 依赖这些设置的功能在设置变化时重新挂载，其余设置在使用时直接读取最新值。 */
function reloadOn(ctx: Context, keys: (keyof Settings)[], plugin: (ctx: Context) => void) {
  const fork = ctx.plugin(plugin)
  ctx.on(SETTINGS_UPDATED, (previous: Settings, next: Settings) => {
    if (!keys.some((key) => previous[key] !== next[key])) return
    return fork.restart()
  })
}

export function apply(ctx: Context, config: Config) {
  const store = new SettingsStore(ctx, config.migrateMemesluna)
  const settings = store.value

  ctx.on(CHATLUNA_MEMES_IMAGES_UPDATED, invalidateAllImagesCache)
  ctx.plugin(ChatLunaMemesService, { settings, migrateLegacyData: config.migrateMemesluna })

  // 用到 ctx.chatluna_memes 的功能必须通过 inject 声明依赖。
  ctx.inject(['chatluna_memes', 'koishi'], (ctx) => registerCommands(ctx, settings))
  ctx.inject(['chatluna_memes', 'timer'], (ctx) => {
    reloadOn(ctx, ['autoCollect', 'emojiFrequencyWindowMinutes', 'emojiFrequencyThreshold', 'minEmojiSize', 'maxEmojiSize', 'groupAutoCollectLimit'],
      (ctx) => applyAutoCollect(ctx, settings))
    reloadOn(ctx, ['stagingRetentionDays'], (ctx) => applyStagingCleanup(ctx, settings))
  })

  ctx.inject(['chatluna_memes', 'server'], async (ctx) => {
    await ctx.chatluna_memes.ready
    reloadOn(ctx, ['backendPath'], (ctx) => applyServer(ctx, settings, ctx.chatluna_memes))
  })

  ctx.inject(['chatluna_memes', 'chatluna_webui', 'server', 'chatluna_server', 'database'], (ctx) => {
    applyConsole(ctx, settings, store, ctx.chatluna_memes)
  })

  ctx.inject(['chatluna_memes', 'ai'], (ctx) => {
    reloadOn(ctx, ['model'], (ctx) => {
      if (!settings.model) return
      const annotator = new AIAnnotator(ctx, settings)
      let disposed = false
      ctx.effect(() => () => { disposed = true; ctx.chatluna_memes.clearAnnotator(annotator) })

      // 服务商可能晚于插件就绪；初始化期间新增的服务商也要触发一次重试。
      let pending = false
      let retry = false
      const initialize = async () => {
        retry = true
        if (pending || disposed) return
        pending = true
        while (retry && !disposed) {
          retry = false
          if (await annotator.initialize() && !disposed) {
            ctx.chatluna_memes.setAnnotator(annotator)
            stopListening()
            break
          }
        }
        pending = false
      }
      const stopListening = ctx.on('ai/providers-change', initialize)
      void initialize()
    })
  })

  reloadOn(ctx, ['injectVariables'], (ctx) => {
    if (settings.injectVariables) applyChatlunaVariables(ctx, settings)
  })
}

export * from './config'
export * from './service'
export * from './settings'

export const inject = ['database']
