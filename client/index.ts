import type { Context, Disposable } from 'cordis'
import { subscribeLive } from '@chatluna/ui-client/client'
import type {} from '../src/console-rpc'

export default function apply(ctx: Context) {
  let current: string | undefined
  let remove: Disposable | undefined
  ctx.effect(() => subscribeLive('memes.pagePath', undefined, ({ data, status }) => {
    if (status !== 'ready' || data === current) return
    remove?.()
    current = data
    if (!data) return
    remove = ctx.slots.route({
      path: data,
      title: '表情包',
      icon: 'sticker',
      group: 'capabilities',
      groupOrder: 35,
      order: 50,
      page: async () => (await import('./page')).MemesPage,
    })
  }))
}
