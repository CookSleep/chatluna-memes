import { createElement, useEffect, useRef } from 'react'
import { createApp } from 'vue'
import Dashboard from './Dashboard.vue'

export function MemesPage() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!root.current) return
    const app = createApp(Dashboard)
    app.mount(root.current)
    return () => app.unmount()
  }, [])
  return createElement('div', { ref: root, className: 'cm-webui-root' })
}
