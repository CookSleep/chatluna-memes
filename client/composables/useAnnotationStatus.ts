import { ref } from 'vue'
import { sendChatLunaMemes } from './rpc'
import type { AnnotationStatus } from '../../src/console-rpc'

export function useAnnotationStatus(
  showToast: (message: string, type: 'success' | 'error' | 'info') => void,
  confirmDialog: (options: { title: string; message?: string; confirmText?: string; danger?: boolean }) => Promise<boolean>,
) {
  const annotationStatus = ref<AnnotationStatus | null>(null)
  const annotationStatusBusy = ref(false)
  async function refreshAnnotationStatus() {
    try { annotationStatus.value = await sendChatLunaMemes('chatluna-memes/getAnnotationStatus') }
    catch (error) { showToast((error as Error).message, 'error') }
  }
  async function cancelAnnotationTasks() {
    if (!await confirmDialog({ title: '取消 AI 标注任务？', message: '正在处理和排队中的任务都会取消，已完成的标注会保留。', confirmText: '取消任务', danger: true })) return
    annotationStatusBusy.value = true
    try {
      await sendChatLunaMemes('chatluna-memes/cancelAnnotations')
      await refreshAnnotationStatus()
      showToast('已取消标注任务', 'success')
    } catch (error) { showToast((error as Error).message, 'error') }
    finally { annotationStatusBusy.value = false }
  }
  return { annotationStatus, annotationStatusBusy, refreshAnnotationStatus, cancelAnnotationTasks }
}
