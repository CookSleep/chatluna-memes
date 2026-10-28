import type {} from '@koishijs/plugin-console'
import type {} from 'koishi-plugin-chatluna'

import { Context, ForkScope } from 'koishi'
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
  let fork: ForkScope = ctx.plugin(plugin)
  ;(ctx as any).on(SETTINGS_UPDATED, (previous: Settings, next: Settings) => {
    if (!keys.some((key) => previous[key] !== next[key])) return
    fork.dispose()
    fork = ctx.plugin(plugin)
  })
}

export function apply(ctx: Context, config: Config) {
  const store = new SettingsStore(ctx, config.migrateMemesluna)
  const settings = store.value

  ;(ctx as any).on(CHATLUNA_MEMES_IMAGES_UPDATED, invalidateAllImagesCache)
  ctx.plugin(ChatLunaMemesService, { settings, migrateLegacyData: config.migrateMemesluna })

  // 用到 ctx.chatluna_memes 的功能必须通过 inject 声明依赖。
  ctx.inject(['chatluna_memes'], (ctx) => {
    registerCommands(ctx, settings)
    reloadOn(ctx, ['autoCollect', 'emojiFrequencyWindowMinutes', 'emojiFrequencyThreshold', 'minEmojiSize', 'maxEmojiSize', 'groupAutoCollectLimit'],
      (ctx) => applyAutoCollect(ctx, settings))
    reloadOn(ctx, ['stagingRetentionDays'], (ctx) => applyStagingCleanup(ctx, settings))
  })

  ctx.inject(['chatluna_memes', 'server'], async (ctx) => {
    await ctx.chatluna_memes.ready
    reloadOn(ctx, ['backendPath'], (ctx) => applyServer(ctx, settings, ctx.chatluna_memes))
  })

  ctx.inject(['chatluna_memes', 'console'], async (ctx) => {
    applyConsole(ctx, settings, store, ctx.chatluna_memes)
  })

  ctx.inject(['chatluna_memes', 'chatluna'], (ctx) => {
    reloadOn(ctx, ['model'], (ctx) => {
      if (!settings.model) return
      const annotator = new AIAnnotator(ctx, settings)
      let disposed = false
      ctx.on('dispose', () => { disposed = true; ctx.chatluna_memes.clearAnnotator(annotator) })
      // 换模型时旧的初始化可能晚于 dispose 才完成，此时不能再挂上去。
      void annotator.initialize().then((ready) => {
        if (ready && !disposed) ctx.chatluna_memes.setAnnotator(annotator)
      })
    })
  })

  reloadOn(ctx, ['injectVariables'], (ctx) => {
    if (settings.injectVariables) applyChatlunaVariables(ctx, settings)
  })
}

export * from './config'
export * from './service'
export * from './settings'

export const inject = {
  required: ['database'],
  optional: ['server', 'console', 'auth', 'chatluna'],
}
