import { onMounted, onUnmounted } from 'vue'

export interface ClickModifiers {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/**
 * 按桌面文件管理器的习惯处理点击选择：
 * Shift 连选，Ctrl / ⌘ 切换；已有选中项时普通点击也只切换选择。
 * 返回新的选择集合；返回 null 表示这次点击不是选择操作，由调用方执行默认动作。
 */
export function applyClickSelection(
  selected: Set<string>,
  id: string,
  orderedIds: string[],
  anchor: string | null,
  event?: ClickModifiers,
): { next: Set<string>; anchor: string } | null {
  if (event?.shiftKey && anchor && orderedIds.includes(anchor)) {
    const [from, to] = [orderedIds.indexOf(anchor), orderedIds.indexOf(id)].sort((a, b) => a - b)
    const next = new Set(selected)
    for (const key of orderedIds.slice(from, to + 1)) next.add(key)
    return { next, anchor }
  }
  if (!event?.ctrlKey && !event?.metaKey && !selected.size) return null
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return { next, anchor: id }
}

/**
 * Ctrl / ⌘ + A 全选当前页，Esc 清除选择。
 * 焦点在输入框或有弹窗打开时不拦截，以免影响正常编辑。
 */
export function useSelectionShortcuts(options: { selectAll: () => void; clear: () => boolean }) {
  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"], .cm-overlay, .el-select-dropdown')) return
    if (document.querySelector('.cm-overlay')) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      options.selectAll()
    } else if (event.key === 'Escape' && options.clear()) {
      event.preventDefault()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))
}
