import type { Context } from 'cordis'
import type {} from '@chatluna/prompt'
import type { Settings } from './settings'
import { CHATLUNA_MEMES_IMAGES_UPDATED } from './service'
import { SETTINGS_UPDATED } from './settings-store'
import { toAbsoluteBaseUrl } from './urls'

/** 渲染注入 ChatLuna 的提示词；Console 预览与实际注入共用同一份逻辑。 */
export function renderInjectPrompt(config: Pick<Settings, 'backendPath' | 'injectVariablesPrompt'>, inventory: string, baseUrl: string): string {
  return (config.injectVariablesPrompt || '')
    .replaceAll('{chatluna_memes_list}', inventory || '（暂时没有可用的表情包）')
    .replaceAll('{base_url}', baseUrl)
    .replaceAll('{backend_path}', config.backendPath)
}

export function applyChatlunaVariables(ctx: Context, config: Settings) {
  ctx.inject(['chatluna_memes', 'prompt'], (ctx) => {
    const service = ctx.chatluna_memes
    let inventory: { prefix: string; loading: Promise<string> } | undefined
    function readInventory(prefix: string) {
      if (inventory?.prefix === prefix) return inventory.loading
      const loading = service.ready.then(() => service.buildRouteInventory(prefix))
      inventory = { prefix, loading }
      void loading.catch(() => { if (inventory?.loading === loading) inventory = undefined })
      return loading
    }
    const invalidate = () => { inventory = undefined }
    ctx.on(CHATLUNA_MEMES_IMAGES_UPDATED, invalidate)
    ctx.on(SETTINGS_UPDATED, invalidate)

    // 两个变量都可以写进预设的系统提示词，图库、设置或宿主公开地址变化后重新读取。
    ctx.prompt.variable({ name: 'chatluna_memes_list', description: '可用表情包与外部随机图地址', mutable: false },
      async () => await readInventory(toAbsoluteBaseUrl(ctx, config) + config.backendPath) || '（暂时没有可用的表情包）')
    ctx.prompt.variable({ name: 'chatluna_memes', description: '包含图库清单的表情包提示词', mutable: false },
      async () => {
        const baseUrl = toAbsoluteBaseUrl(ctx, config)
        const { backendPath, injectVariablesPrompt } = config
        return renderInjectPrompt({ backendPath, injectVariablesPrompt }, await readInventory(baseUrl + backendPath), baseUrl)
      })
  })
}
