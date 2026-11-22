import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import Server from '@cordisjs/plugin-server'
import { applyServer } from '../src/http-server'
import { applyConsole } from '../src/console-handlers'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { ChatLunaMemesService } from '../src/service'
import type { SettingsStore } from '../src/settings-store'

const cleanup: Context[] = []
const directories: string[] = []
afterEach(async () => {
  for (const ctx of cleanup.splice(0)) {
    ctx.server._http.closeAllConnections()
    await ctx.fiber.dispose()
  }
  vi.unstubAllEnvs()
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true })
})

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'memes-auth-'))
  directories.push(dir)
  vi.stubEnv('CHATLUNA_DATA', dir)
  const ctx = new Context()
  cleanup.push(ctx)
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(await import('@chatluna/server'), { token: 'Temporary-Admin123!' })
  const origin = ctx.server.baseUrl
  const login = await fetch(origin + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'Temporary-Admin123!' }),
  })
  const { session } = await login.json()
  const headers = { Authorization: `Bearer ${session}` }
  const service = {
    ready: Promise.resolve(),
    createCollection: vi.fn(async () => true),
    getStagedImageBuffer: vi.fn(async () => ({ buffer: Buffer.from('staged'), mime: 'image/png' })),
    getLocalImageBuffer: vi.fn(async () => ({ buffer: Buffer.from('public'), mime: 'image/png' })),
    addLocalImageBuffer: vi.fn(async () => ({ id: 'image', filename: 'a.png' })),
  }
  const pluginCtx = ctx.extend({ chatluna_webui: { addEntry: vi.fn(), exclude: vi.fn(), state: vi.fn() } })
  const settings = { ...DEFAULT_SETTINGS }
  applyConsole(pluginCtx, settings, {} as SettingsStore, service as unknown as ChatLunaMemesService)
  applyServer(pluginCtx, settings, service as unknown as ChatLunaMemesService)
  const uploadUrl = origin + settings.backendPath + '/api/admin/collections/a/images'
  const form = new FormData()
  form.append('images', new Blob(['image'], { type: 'image/png' }), 'a.png')
  const create = (authorization?: typeof headers) => fetch(origin + '/api/memes/manage', {
    method: 'POST', headers: { 'content-type': 'application/json', ...authorization },
    body: JSON.stringify({ event: 'chatluna-memes/createCollection', args: ['a'] }),
  })
  return { origin, settings, service, headers, form, create, uploadUrl }
}

describe('V2 管理接口', () => {
  it('匿名请求可读公开图库，管理操作和待审图片需要登录', async () => {
    const f = await fixture()
    expect((await f.create()).status).toBe(401)
    expect((await fetch(f.uploadUrl, { method: 'POST', body: f.form })).status).toBe(401)
    expect(f.service.createCollection).not.toHaveBeenCalled()
    expect(f.service.addLocalImageBuffer).not.toHaveBeenCalled()
    const base = f.origin + f.settings.backendPath + '/api'
    expect((await fetch(base + '/admin/staged-images/id')).status).toBe(401)
    expect(f.service.getStagedImageBuffer).not.toHaveBeenCalled()
    expect(await (await fetch(base + '/collections/a/images/a.png')).text()).toBe('public')
  })

  it('已登录用户可管理、上传、读取待审图，上传失败可见', async () => {
    const f = await fixture()
    expect(await (await f.create(f.headers)).json()).toBe(true)
    const upload = () => fetch(f.uploadUrl, { method: 'POST', headers: f.headers, body: f.form })
    expect(await (await upload()).json()).toMatchObject({ ok: true, uploaded: ['a.png'] })
    expect(f.service.addLocalImageBuffer).toHaveBeenCalledWith('a', Buffer.from('image'), 'a.png')
    expect(await (await fetch(f.origin + f.settings.backendPath + '/api/admin/staged-images/id', { headers: f.headers })).text()).toBe('staged')
    f.service.addLocalImageBuffer.mockRejectedValueOnce(new Error('写入失败'))
    const failed = await upload()
    expect(failed.status).toBe(400)
    expect((await failed.json()).failed).toEqual([{ filename: 'a.png', error: '写入失败' }])
    const invalid = await fetch(f.uploadUrl, {
      method: 'POST', headers: { ...f.headers, 'content-type': 'application/json' }, body: '{}',
    })
    expect(invalid.status).toBe(415)
  })
})
