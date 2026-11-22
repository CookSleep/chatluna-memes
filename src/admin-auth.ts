import type { Context } from 'cordis'
import type { Request, Response } from '@cordisjs/plugin-server'
import type {} from '@chatluna/server'

export function authorizeAdmin(ctx: Context, req: Request, res: Response): boolean {
  const auth = ctx.get('chatluna_server')
  if (auth) {
    try {
      auth.authenticate(req)
      return true
    } catch {
      // 会话过期和未登录使用同样的响应，客户端可重新登录。
    }
  }
  res.status = 401
  res.json({ error: '请先登录 ChatLuna 管理页' })
  return false
}
