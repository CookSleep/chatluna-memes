import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { applyConsole } from '../src/console-handlers'
import { applyServer } from '../src/http-server'
import { isAdminToken } from '../src/admin-auth'

vi.mock('koishi', async () => {
  const { createRequire } = await import('node:module')
  return createRequire(import.meta.url)('koishi')
})

const require = createRequire(import.meta.url)
const Koa = require('koa')
const Router = require('@koa/router')
const { koaBody } = require('koa-body')
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const operation of cleanup.splice(0)) await operation() })

async function fixture() {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-memes-auth-'))
  cleanup.push(() => fs.rm(baseDir, { recursive: true, force: true }))
  const user = { authority: 1 }
  const token = { id: 7, token: 'test-session-token', expiredAt: Date.now() + 60_000 }
  let authEnabled = true
  let revoked = false
  const database = { get: vi.fn(async (table: string, query: any) => table === 'token' ? revoked || query.token !== token.token ? [] : [token] : [user]) }
  const listeners: Record<string, { callback: (...args: any[]) => any; options: any }> = {}
  const body = vi.fn(koaBody())
  const router = new Router()
  const server: any = { _body: body }
  for (const method of ['get', 'post', 'patch', 'delete']) {
    server[method] = (route: string, ...handlers: any[]) => {
      // 与实际 Server.register 相同的自动解析约定。
      if (!handlers[0][Symbol.for('noParseBody')]) handlers.unshift(body)
      router[method](route, ...handlers)
    }
  }
  const ctx: any = {
    baseDir, database, get: () => authEnabled ? {} : undefined, server,
    logger: () => ({ warn: vi.fn() }),
    console: { addEntry: vi.fn(), addListener: (name: string, callback: any, options: any) => { listeners[name] = { callback, options } } },
  }
  const service: any = {
    ready: Promise.resolve(), annotator: null,
    createCollection: vi.fn(async () => true), deleteCollection: vi.fn(async () => true),
    addLocalImageBuffer: vi.fn(async () => ({ id: 'image', filename: 'a.png' })),
    getLocalImageBuffer: vi.fn(async () => ({ buffer: Buffer.from('image'), mime: 'image/png' })),
    getStagedImageBuffer: vi.fn(async () => ({ buffer: Buffer.from('staged'), mime: 'image/png' })),
  }
  const config: any = { backendPath: '/chatluna-memes' }
  applyConsole(ctx, config, { update: async () => ({ ok: true }) } as any, service)
  applyServer(ctx, config, service)
  const app = new Koa()
  app.use(router.routes())
  const http = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => http.once('listening', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => { http.close((error: Error) => error ? reject(error) : resolve()); http.closeAllConnections?.() }))
  const origin = `http://127.0.0.1:${http.address().port}`
  const request = (route: string, init?: RequestInit) => fetch(origin + route, init)
  return { ctx, service, listeners, token, user, body, baseDir, request, setAuth: (value: boolean) => { authEnabled = value }, revoke: () => { revoked = true } }
}

describe('管理权限边界', () => {
  it('所有 RPC 声明权限且匿名请求无法调用业务服务', async () => {
    const { listeners, service } = await fixture()
    expect(Object.keys(listeners).length).toBeGreaterThan(20)
    for (const listener of Object.values(listeners)) {
      expect(listener.options.authority).toBe(1)
      await expect(listener.callback.call({}, 'collection')).rejects.toThrow('请登录有管理权限的 Console 账号')
    }
    expect(service.createCollection).not.toHaveBeenCalled()
  })
  it('未启用 auth 插件时放行 RPC 和 HTTP 管理请求', async () => {
    const f = await fixture()
    f.setAuth(false)
    await expect(f.listeners['chatluna-memes/createCollection'].callback.call({}, 'a')).resolves.toBe(true)
    const image = await f.request('/chatluna-memes/api/admin/staged-images/id')
    expect(image.status).toBe(200)
    expect(await image.text()).toBe('staged')
  })
  it.each(['expired', 'revoked', 'low-authority', 'invalid-expiry', 'wrong-token'])('拒绝 %s 的 HTTP 和 RPC 请求', async (mode) => {
    const f = await fixture()
    if (mode === 'expired') f.token.expiredAt = Date.now() - 1
    if (mode === 'invalid-expiry') f.token.expiredAt = NaN
    if (mode === 'revoked') f.revoke()
    if (mode === 'low-authority') f.user.authority = 0
    if (mode === 'wrong-token') f.token.token = 'stored-token'
    const suppliedToken = mode === 'wrong-token' ? 'wrong-token' : f.token.token
    expect(await isAdminToken(f.ctx, suppliedToken)).toBe(false)
    const response = await f.request('/chatluna-memes/api/admin/staged-images/id', { headers: { Authorization: `Bearer ${suppliedToken}` } })
    expect(response.status).toBe(401)
    expect(f.service.getStagedImageBuffer).not.toHaveBeenCalled()
    await expect(f.listeners['chatluna-memes/createCollection'].callback.call({ auth: { ...f.token, token: suppliedToken } }, 'a')).rejects.toThrow('请登录有管理权限的 Console 账号')
    expect(f.service.deleteCollection).not.toHaveBeenCalled()
  })
  it('匿名上传在解析前拒绝，公开图片路由仍可访问', async () => {
    const f = await fixture()
    const form = new FormData()
    form.append('images', new Blob(['image']), 'a.png')
    expect((await f.request('/chatluna-memes/api/admin/collections/a/images', { method: 'POST', body: form })).status).toBe(401)
    expect(f.body).not.toHaveBeenCalled()
    expect(f.service.addLocalImageBuffer).not.toHaveBeenCalled()
    const image = await f.request('/chatluna-memes/api/collections/a/images/a.png')
    expect(image.status).toBe(200)
    expect(await image.text()).toBe('image')
  })
  it('合法用户可通过 RPC 管理、HTTP 上传及读取暂缓区预览', async () => {
    const f = await fixture()
    await expect(f.listeners['chatluna-memes/createCollection'].callback.call({ auth: f.token }, 'a')).resolves.toBe(true)
    const headers = { Authorization: `Bearer ${f.token.token}` }
    const form = new FormData()
    form.append('images', new Blob(['image']), 'a.png')
    const upload = await f.request('/chatluna-memes/api/admin/collections/a/images', { method: 'POST', headers, body: form })
    expect(upload.status).toBe(200)
    expect(await upload.json()).toMatchObject({ ok: true, uploaded: ['a.png'] })
    expect(f.service.addLocalImageBuffer).toHaveBeenCalledWith('a', Buffer.from('image'), 'a.png')
    expect((await fs.readdir(path.join(f.baseDir, 'data/chatluna-memes'))).some((name) => name.startsWith('.temp_upload'))).toBe(false)
    const image = await f.request('/chatluna-memes/api/admin/staged-images/id', { headers })
    expect(await image.text()).toBe('staged')
  })
  it('上传失败也清理文件，并拒绝伪造 JSON 文件路径', async () => {
    const f = await fixture()
    f.service.addLocalImageBuffer.mockRejectedValueOnce(new Error('database unavailable'))
    const headers = { Authorization: `Bearer ${f.token.token}` }
    const form = new FormData()
    form.append('images', new Blob(['image']), 'a.png')
    const upload = await f.request('/chatluna-memes/api/admin/collections/a/images', { method: 'POST', headers, body: form })
    expect(upload.status).toBe(400)
    expect((await upload.json()).failed).toHaveLength(1)
    expect(await fs.readdir(path.join(f.baseDir, 'data/chatluna-memes'))).toEqual([])
    const invalid = await f.request('/chatluna-memes/api/admin/collections/a/images', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [{ path: '/etc/passwd' }] }),
    })
    expect(invalid.status).toBe(415)
    expect(f.service.addLocalImageBuffer).toHaveBeenCalledTimes(1)
  })
})
