import { send } from '@koishijs/client'
import type { ChatLunaMemesConsoleEvents } from '../../src/console-rpc'

type RpcResult<K extends keyof ChatLunaMemesConsoleEvents> = Awaited<ReturnType<ChatLunaMemesConsoleEvents[K]>>

export function sendChatLunaMemes<K extends keyof ChatLunaMemesConsoleEvents>(
  type: K,
  ...args: Parameters<ChatLunaMemesConsoleEvents[K]>
): Promise<RpcResult<K>> {
  const response = send(type, ...args)
  if (!response) return Promise.reject(new Error('Koishi Console 尚未连接'))
  return response as Promise<RpcResult<K>>
}
