import type { Context } from 'cordis'
import type { Settings } from './settings'

/** 没有配置对外地址时，HTTP 重定向使用站内相对路径，继承访问方的域名和协议。 */
export function getLocalBaseUrl(ctx: Context, config: Settings): string {
  const url = config.selfUrl || ctx.get('chatluna_webui')?.config.selfUrl || ctx.get('server')?.config.baseUrl || ''
  return url.replace(/\/+$/, '')
}

/** 提示词里的图片链接必须是绝对地址。 */
export function toAbsoluteBaseUrl(ctx: Context, config: Settings): string {
  return getLocalBaseUrl(ctx, config) || (ctx.get('server')?.baseUrl || '').replace(/\/+$/, '')
}

export function managementPageUrl(ctx: Context): string {
  return `${ctx.get('chatluna_webui')?.config.uiPath ?? ''}/manage-memes`
}
