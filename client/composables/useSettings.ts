import { computed, ref } from 'vue'
import { sendChatLunaMemes } from './rpc'
import type { ShowToast } from './useToast'
import type { DialogOptions } from './useDialog'
import type { ConsoleSettingsPayload } from '../../src/console-rpc'
import { DEFAULT_SETTINGS, NUMBER_RULES, normalizeBackendPath, type NumericSettingKey, type Settings } from '../../src/settings'

interface SettingsDeps {
  showToast: ShowToast
  confirmDialog: (options: Omit<DialogOptions, 'input' | 'choices'>) => Promise<boolean>
  /** 保存成功后刷新依赖设置的页面数据。 */
  onSaved: () => Promise<void> | void
}

const settingKeys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

/** 「配置」页：读取设置、编辑草稿并整体保存。 */
export function useSettings({ showToast, confirmDialog, onSaved }: SettingsDeps) {
  const configData = ref<ConsoleSettingsPayload | null>(null)
  const configDraft = ref<Settings | null>(null)
  const configLoading = ref(false)
  const configSaving = ref(false)
  /** 从其他页面跳过来时要定位的分区或设置项 id，「配置」页处理后清空。 */
  const configTarget = ref<string | null>(null)
  let annotatorPoll: ReturnType<typeof setTimeout> | undefined

  const configChangedKeys = computed(() => {
    const saved = configData.value?.settings
    const draft = configDraft.value
    if (!saved || !draft) return []
    return settingKeys.filter((key) => draft[key] !== saved[key])
  })
  const configDirty = computed(() => configChangedKeys.value.length > 0)

  /** 与后端 applySettingsPatch 的数字规则一致，提前提示，省一次往返。 */
  const configErrors = computed(() => {
    const errors: Partial<Record<keyof Settings, string>> = {}
    const draft = configDraft.value
    if (!draft) return errors
    for (const key of Object.keys(NUMBER_RULES) as NumericSettingKey[]) {
      const rule = NUMBER_RULES[key]
      const value = draft[key] as unknown
      if (typeof value !== 'number' || !Number.isFinite(value)) errors[key] = '请填写数字'
      else if (rule.integer && !Number.isInteger(value)) errors[key] = '需要是整数'
      else if (value < rule.min || value > rule.max) errors[key] = `范围 ${rule.min}~${rule.max}`
    }
    if (draft.selfUrl.trim() && !/^https?:\/\/[^\s/?#]+/i.test(draft.selfUrl.trim())) errors.selfUrl = '需以 http:// 或 https:// 开头'
    if (!normalizeBackendPath(draft.backendPath)) errors.backendPath = '只能包含字母、数字和 . _ ~ -，且不能有 . 或 .. 段'
    if (!draft.injectVariablesPrompt.trim()) errors.injectVariablesPrompt = '提示词不能为空'
    if (!draft.annotatePrompt.trim()) errors.annotatePrompt = '提示词不能为空'
    return errors
  })
  const configValid = computed(() => Object.keys(configErrors.value).length === 0)

  function applyPayload(payload: ConsoleSettingsPayload) {
    configData.value = payload
    configDraft.value = { ...payload.settings }
  }

  async function loadConfig() {
    configLoading.value = true
    try {
      applyPayload(await sendChatLunaMemes('chatluna-memes/getSettings'))
    } catch (err) {
      showToast(err instanceof Error ? err.message : '读取配置失败', 'error')
    } finally {
      configLoading.value = false
    }
  }

  // 只刷新只读部分（模型列表、标注器状态），不覆盖正在编辑的草稿。
  async function refreshConfigStatus() {
    try {
      const payload = await sendChatLunaMemes('chatluna-memes/getSettings')
      if (configData.value) configData.value = { ...payload, settings: configData.value.settings }
    } catch {}
  }

  function pollAnnotator(remaining: number) {
    clearTimeout(annotatorPoll)
    annotatorPoll = setTimeout(async () => {
      await refreshConfigStatus()
      await onSaved()
      const payload = configData.value
      if (payload?.settings.model && !payload.annotatorReady && remaining > 1) pollAnnotator(remaining - 1)
    }, 2000)
  }

  function resetConfigDraft() {
    if (configData.value) configDraft.value = { ...configData.value.settings }
  }

  function restoreConfigDefault(key: keyof Settings) {
    if (configDraft.value) (configDraft.value as any)[key] = DEFAULT_SETTINGS[key]
  }

  async function saveConfig() {
    const draft = configDraft.value
    if (!draft || !configDirty.value || configSaving.value) return
    if (!configValid.value) { showToast('有设置项填写不正确，请先修改', 'error'); return }
    const changed = configChangedKeys.value
    if (changed.includes('backendPath') && !await confirmDialog({
      title: '修改路由前缀？',
      message: '所有随机图地址都会换成新前缀，已经发出去或写进其他地方的旧地址将无法访问。',
      confirmText: '修改并保存',
      danger: true,
    })) return
    const patch = Object.fromEntries(changed.map((key) => [key, draft[key]])) as Partial<Settings>
    configSaving.value = true
    try {
      const result = await sendChatLunaMemes('chatluna-memes/updateSettings', patch)
      if (!result.ok) { showToast(result.error, 'error'); return }
      configData.value = { ...configData.value!, settings: result.settings }
      configDraft.value = { ...result.settings }
      showToast('已保存配置', 'success')
      await onSaved()
      // 换模型后标注器在后台加载，每 2 秒看一次状态，就绪或约 30 秒后停止。
      if (changed.includes('model')) pollAnnotator(15)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存配置失败', 'error')
    } finally {
      configSaving.value = false
    }
  }

  /** 离开「配置」页前确认是否放弃未保存的修改；返回 false 表示留在原页。 */
  async function confirmLeaveConfig(): Promise<boolean> {
    if (!configDirty.value) return true
    const discard = await confirmDialog({
      title: '放弃未保存的配置？',
      message: `还有 ${configChangedKeys.value.length} 项修改没有保存，离开后这些修改会丢失。`,
      confirmText: '放弃修改',
      danger: true,
    })
    if (discard) resetConfigDraft()
    return discard
  }

  return {
    configData, configDraft, configLoading, configSaving, configTarget, configChangedKeys, configDirty, configErrors, configValid,
    loadConfig, refreshConfigStatus, resetConfigDraft, restoreConfigDefault, saveConfig, confirmLeaveConfig,
  }
}
