import { computed, reactive, ref, type Ref } from 'vue'
import { sendChatLunaMemes } from './rpc'
import type { ShowToast } from './useToast'
import type { DialogOptions } from './useDialog'
import type { ConsoleEndpointInfo as EndpointInfo, ConsoleEndpointInput } from '../../src/console-rpc'

interface EndpointDeps {
  loading: Ref<boolean>
  showToast: ShowToast
  confirmDialog: (options: Omit<DialogOptions, 'input' | 'choices'>) => Promise<boolean>
  fetchState: () => Promise<void>
  validateRouteName: (value: string) => string | void
  getBaseRedirectUrl: (name: string) => string
}

/** 外部图源：编辑表单、地址校验与试加载。 */
export function useEndpoints({ loading, showToast, confirmDialog, fetchState, validateRouteName, getBaseRedirectUrl }: EndpointDeps) {
  // 编辑表单
  const showEndpointEditor = ref(false)
  const editingEndpoint = ref<EndpointInfo | null>(null)
  const endpointForm = reactive<ConsoleEndpointInput>({
    name: '',
    group: '',
    description: '',
    url: '',
  })
  const endpointPreviewUrl = computed(() => {
    const name = endpointForm.name.trim()
    return name ? getBaseRedirectUrl(name) : ''
  })
  const endpointNameError = computed(() => {
    const name = endpointForm.name.trim()
    if (!name || name === editingEndpoint.value?.name) return ''
    return validateRouteName(name) || ''
  })
  const endpointUrlError = computed(() => {
    const url = endpointForm.url.trim()
    if (!url) return ''
    return /^https?:\/\/[^\s]+$/i.test(url) ? '' : '请输入以 http:// 或 https:// 开头的地址'
  })
  const endpointTestKey = ref(0)
  const endpointTestState = ref<'idle' | 'loading' | 'ok' | 'error'>('idle')
  function testEndpointTarget() {
    if (!endpointForm.url.trim() || endpointUrlError.value) return
    endpointTestKey.value++
    endpointTestState.value = 'loading'
  }

  function openEndpointEditor() {
    resetEndpointForm()
    showEndpointEditor.value = true
  }

  function closeEndpointEditor() {
    resetEndpointForm()
    showEndpointEditor.value = false
  }

  function resetEndpointForm() {
    editingEndpoint.value = null
    endpointTestState.value = 'idle'
    endpointForm.name = ''
    endpointForm.group = ''
    endpointForm.description = ''
    endpointForm.url = ''
  }

  function editEndpoint(item: EndpointInfo) {
    editingEndpoint.value = item
    showEndpointEditor.value = true
    endpointForm.name = item.name || ''
    endpointForm.group = item.group || ''
    endpointForm.description = item.description || ''
    endpointForm.url = item.url || ''
  }

  async function saveEndpoint() {
    const name = endpointForm.name.trim()
    const url = endpointForm.url.trim()

    if (!name || !url) {
      showToast('请填写名称和图源地址', 'error')
      return
    }
    if (endpointNameError.value || endpointUrlError.value) {
      showToast(endpointNameError.value || endpointUrlError.value, 'error')
      return
    }

    const payload: ConsoleEndpointInput = {
      name,
      group: (endpointForm.group || '').trim() || '默认分组',
      description: (endpointForm.description || '').trim(),
      url,
      method: 'redirect' as const,
    }

    try {
      loading.value = true
      if (editingEndpoint.value) {
        const oldName = editingEndpoint.value.name
        if (name !== oldName && !await confirmDialog({
          title: `把「${oldName}」改名为「${name}」？`,
          message: `访问地址会变成 ${getBaseRedirectUrl(name)}，\n旧地址将无法访问，用到旧地址的地方需要一起改。`,
          confirmText: '改名并保存',
        })) return
        await sendChatLunaMemes('chatluna-memes/updateEndpoint', oldName, payload)
        showToast('已保存图源', 'success')
      } else {
        await sendChatLunaMemes('chatluna-memes/createEndpoint', payload)
        showToast('已添加图源', 'success')
      }
      await fetchState()
      resetEndpointForm()
      showEndpointEditor.value = false
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存图源失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function deleteEndpoint(name: string) {
    if (!await confirmDialog({ title: `删除图源「${name}」？`, message: '删除后该路由将无法访问，ChatLuna 也不会再看到它。', confirmText: '删除', danger: true })) return

    try {
      loading.value = true
      await sendChatLunaMemes('chatluna-memes/deleteEndpoint', name)
      showToast('已删除图源', 'success')
      await fetchState()
      if (editingEndpoint.value && editingEndpoint.value.name === name) {
        resetEndpointForm()
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除图源失败', 'error')
    } finally {
      loading.value = false
    }
  }

  return {
    showEndpointEditor, editingEndpoint, endpointForm, endpointPreviewUrl,
    endpointNameError, endpointUrlError, endpointTestKey, endpointTestState, testEndpointTarget,
    openEndpointEditor, closeEndpointEditor, editEndpoint, saveEndpoint, deleteEndpoint,
  }
}
