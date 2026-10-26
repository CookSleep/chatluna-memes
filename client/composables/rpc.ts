import { send } from '@koishijs/client'
import type { ChatLunaMemesConsoleEvents } from '../../src/console-rpc'

type RpcResult<K extends keyof ChatLunaMemesConsoleEvents> = Awaited<ReturnType<ChatLunaMemesConsoleEvents[K]>>

export function sendChatLunaMemes<K extends keyof ChatLunaMemesConsoleEvents>(
  type: K,
  ...args: Parameters<ChatLunaMemesConsoleEvents[K]>
): Promise<RpcResult<K>> {
  const response = send(type, ...args)
  if (!response) return Promise.reject(new Error('Koishi Console 尚未连接'))
  // Console 返回的错误是字符串（服务端抛出的错误会带上调用栈），只取第一行作为原因。
  return (response as Promise<RpcResult<K>>).catch((error) => {
    if (error instanceof Error) throw error
    const message = String(error).split('\n')[0].replace(/^\w*Error: /, '')
    throw new Error(message === 'unauthorized' ? '请登录有管理权限的 Console 账号' : message)
  })
}
