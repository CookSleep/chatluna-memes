import { inject, type InjectionKey } from 'vue'
import type { useDashboard } from './useDashboard'

export type DashboardContext = ReturnType<typeof useDashboard>

export const dashboardContextKey: InjectionKey<DashboardContext> = Symbol('ChatLunaMemesDashboardContext')

export function useDashboardContext(): DashboardContext {
  const context = inject(dashboardContextKey)
  if (!context) {
    throw new Error('ChatLuna Memes dashboard context is not available.')
  }
  return context
}
