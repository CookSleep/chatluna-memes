import { onUnmounted, reactive } from 'vue'

export type ToastType = 'info' | 'success' | 'error'
export type ShowToast = (message: string, type?: ToastType) => void

export function useToast() {
  const toast = reactive({
    show: false,
    message: '',
    type: 'info' as ToastType
  })
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function showToast(message: string, type: ToastType = 'info') {
    if (toastTimer) clearTimeout(toastTimer)
    toast.message = message
    toast.type = type
    toast.show = true
    // 长消息停留更久，方便读完。
    toastTimer = setTimeout(() => {
      toast.show = false
    }, Math.min(8000, 2200 + message.length * 60))
  }

  onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer) })

  return { toast, showToast }
}
