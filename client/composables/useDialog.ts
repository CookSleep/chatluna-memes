import { reactive } from 'vue'

export interface DialogChoice {
  label: string
  value: string
  description?: string
  disabled?: boolean
}

export interface DialogOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作使用红色确认按钮。 */
  danger?: boolean
  /** 风险提示，标题旁显示黄色警告图标，确认按钮不变红。 */
  warning?: boolean
  /** 提供后显示输入框，确认时返回输入内容。 */
  input?: {
    value?: string
    placeholder?: string
    maxlength?: number
    validate?: (value: string) => string | void
  }
  /** 提供后显示选项列表，确认时返回选中的值。 */
  choices?: DialogChoice[]
}

interface DialogState {
  visible: boolean
  options: DialogOptions
  value: string
  error: string
}

type DialogResult = boolean | string | null

/** 替代浏览器原生 confirm / prompt，同一时间只显示一个对话框。 */
export function useDialog() {
  const dialog = reactive<DialogState>({
    visible: false,
    options: { title: '' },
    value: '',
    error: '',
  })
  let resolver: ((result: DialogResult) => void) | null = null

  function open(options: DialogOptions): Promise<DialogResult> {
    // 新对话框打开时，旧的按取消处理，避免 Promise 永远悬空。
    resolver?.(options.input || options.choices ? null : false)
    dialog.options = options
    dialog.value = options.input?.value ?? options.choices?.find((choice) => !choice.disabled)?.value ?? ''
    dialog.error = ''
    dialog.visible = true
    return new Promise((resolve) => { resolver = resolve })
  }

  function settle(result: DialogResult) {
    const resolve = resolver
    resolver = null
    dialog.visible = false
    resolve?.(result)
  }

  function submitDialog() {
    const { input, choices } = dialog.options
    if (input) {
      const value = dialog.value.trim()
      const error = input.validate?.(value)
      if (error) {
        dialog.error = error
        return
      }
      settle(value)
    } else if (choices) {
      if (!dialog.value) {
        dialog.error = '请先选择一项'
        return
      }
      settle(dialog.value)
    } else {
      settle(true)
    }
  }

  function cancelDialog() {
    const { input, choices } = dialog.options
    settle(input || choices ? null : false)
  }

  async function confirmDialog(options: Omit<DialogOptions, 'input' | 'choices'>): Promise<boolean> {
    return await open(options) === true
  }

  async function promptDialog(options: DialogOptions & { input: NonNullable<DialogOptions['input']> }): Promise<string | null> {
    const result = await open(options)
    return typeof result === 'string' ? result : null
  }

  async function chooseDialog(options: DialogOptions & { choices: DialogChoice[] }): Promise<string | null> {
    const result = await open(options)
    return typeof result === 'string' ? result : null
  }

  return { dialog, submitDialog, cancelDialog, confirmDialog, promptDialog, chooseDialog }
}
