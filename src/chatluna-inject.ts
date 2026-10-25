import { Context } from 'koishi'
import type { Settings } from './settings'
import type { MemesLunaService } from './service'
import { MEMESLUNA_IMAGES_UPDATED } from './service'
import { SETTINGS_UPDATED } from './settings-store'
import { toAbsoluteBaseUrl } from './urls'

/** 渲染注入 ChatLuna 的提示词；Console 预览与实际注入共用同一份逻辑。 */
export function renderInjectPrompt(config: Settings, inventory: string, baseUrl: string): string {
  return (config.injectVariablesPrompt || '')
    .replaceAll('{endpoint}', inventory || '（暂时没有可用的表情包）')
    .replaceAll('{base_url}', baseUrl)
    .replaceAll('{backend_path}', config.backendPath)
    // 兼容旧模板中已废弃的标签路由占位符。
    .replaceAll('{tag_routes}', '')
    .replaceAll('{tags}', '')
}

async function updateMemesVariable(ctx: Context, config: Settings, service: MemesLunaService) {
  const inventory = await service.buildRouteInventory(`${toAbsoluteBaseUrl(ctx, config)}${config.backendPath}`)
  ;(ctx as any).chatluna.promptRenderer.setVariable('endpoint', inventory || '（暂时没有可用的表情包）')
  ;(ctx as any).chatluna.promptRenderer.setVariable('memesluna', renderInjectPrompt(config, inventory, toAbsoluteBaseUrl(ctx, config)))
}

export function applyChatlunaVariables(ctx: Context, config: Settings) {
  ctx.inject(['memesluna', 'chatluna'], async (ctx) => {
    const service = ctx.memesluna
    await service.ready

    let pending: Promise<void> | undefined
    let dirty = false
    const refresh = () => {
      dirty = true
      if (pending) return pending
      pending = (async () => {
        while (dirty) {
          dirty = false
          await updateMemesVariable(ctx, config, service)
        }
      })().catch((error) => {
        ctx.logger('memesluna').warn('Failed to refresh ChatLuna variables:', error)
      }).finally(() => { pending = undefined })
      return pending
    }

    await refresh()
    // 合集、外部图源或相关设置一变就刷新，不再需要定时轮询。
    let cancelRefresh: (() => void) | undefined
    const scheduleRefresh = () => {
      cancelRefresh?.()
      cancelRefresh = ctx.setTimeout(() => { void refresh() }, 250)
    }
    ;(ctx as any).on(MEMESLUNA_IMAGES_UPDATED, scheduleRefresh)
    ;(ctx as any).on(SETTINGS_UPDATED, scheduleRefresh)

    ctx.effect(() => () => {
      ;(ctx as any).chatluna.promptRenderer.removeVariable('endpoint')
      ;(ctx as any).chatluna.promptRenderer.removeVariable('memesluna')
    })
  })
}
