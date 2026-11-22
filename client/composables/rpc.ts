import { request } from '@chatluna/ui-client/client'
import type { ChatLunaMemesConsoleEvents } from '../../src/console-rpc'

type RpcResult<K extends keyof ChatLunaMemesConsoleEvents> = Awaited<ReturnType<ChatLunaMemesConsoleEvents[K]>>

export function sendChatLunaMemes<K extends keyof ChatLunaMemesConsoleEvents>(
  type: K,
  ...args: Parameters<ChatLunaMemesConsoleEvents[K]>
): Promise<RpcResult<K>> {
  return request<RpcResult<K>>('/api/memes/manage', { method: 'POST', body: { event: type, args } })
}
