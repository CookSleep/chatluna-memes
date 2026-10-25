// 仅供 client 类型检查使用：@koishijs/client 以 TS 源码发布，直接检查会报出其内部错误。
declare module '@koishijs/client' {
  import type { Component } from 'vue'
  export function send(type: string, ...args: any[]): Promise<any> | undefined
  export const store: { user?: { token?: string } } & Record<string, any>
  export const icons: { register(name: string, component: Component): void }
}
