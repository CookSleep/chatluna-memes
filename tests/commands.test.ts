import { describe, expect, it, vi } from 'vitest'
import { registerCommands } from '../src/commands'

vi.mock('koishi', async () => {
  const { createRequire } = await import('node:module')
  return createRequire(import.meta.url)('koishi')
})

describe('批量标注命令取消', () => {
  it('整批只入队一次，取消后不会继续创建后续分块任务', async () => {
    const actions = new Map<string, Function>()
    const command = (name: string): any => ({
      subcommand: (child: string) => command(child), alias() { return this }, option() { return this },
      action(handler: Function) { actions.set(name, handler); return this },
    })
    const rows = Array.from({ length: 50 }, (_, id) => ({ id: String(id), type: 'local', tags: '[]' }))
    const queueAnnotation = vi.fn(async () => ({ success: 2, fail: 0, skipped: 0, cancelled: 48 }))
    const ctx: any = { command, database: { get: async () => rows }, chatluna_memes: { ready: Promise.resolve(), annotator: {}, queueAnnotation } }
    registerCommands(ctx, {} as any)
    const result = await actions.get('.tagall')!({ session: { send: vi.fn() }, options: {} })
    expect(queueAnnotation).toHaveBeenCalledTimes(1)
    expect(queueAnnotation).toHaveBeenCalledWith(rows, expect.objectContaining({ force: true }))
    expect(result).toContain('已取消')
    expect(result).toContain('取消：48 张')
  })
})
