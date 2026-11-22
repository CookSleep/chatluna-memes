import { createElement, useEffect, useRef } from 'react'
import { createApp } from 'vue'
import { ElOption, ElScrollbar, ElSelect } from 'element-plus'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/scrollbar/style/css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import Dashboard from './Dashboard.vue'

export function MemesPage() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!root.current) return
    const app = createApp(Dashboard)
    app.use(ElOption).use(ElScrollbar).use(ElSelect)
    app.mount(root.current)
    return () => app.unmount()
  }, [])
  return createElement('div', { ref: root, className: 'cm-webui-root' })
}
