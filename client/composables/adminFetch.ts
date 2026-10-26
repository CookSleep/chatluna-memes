import { store } from '@koishijs/client'

export function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // 没有启用 auth 插件时没有 token，服务端也不要求。
  const token = (store as any).user?.token
  // 凭据仅发送到承载 Console 的同源服务。
  if (new URL(url, window.location.href).origin !== window.location.origin) {
    return Promise.reject(new Error('管理请求必须与 Console 同源'))
  }
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...options, headers })
}
