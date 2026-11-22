import { authFetch } from '@chatluna/ui-client/client'

export function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const target = new URL(url, window.location.href)
  if (target.origin !== window.location.origin) {
    return Promise.reject(new Error('管理请求必须与 ChatLuna 同源'))
  }
  return authFetch(target.pathname + target.search, options)
}
