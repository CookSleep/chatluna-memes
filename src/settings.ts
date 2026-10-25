// 插件设置的定义、默认值与校验。后端和管理页共用，这里不要引入 koishi 或 Node 模块。

export const DEFAULT_ANNOTATE_PROMPT = `你是表情包检索标注助手。看图后为这张表情包生成检索用的标签和别名，只输出一个 JSON 对象，不要解释，不要代码块。

参考信息（可能不准确，以图片内容为准）：
- 文件名：{{filename}}
- 所在表情包：{{collection_name}}

输出格式：{"tags": ["…"], "aliases": ["…"]}

tags：3~5 个，每个 2~6 字
- 概括图片表达的情绪、动作或态度，如「无语」「开心」「嘲讽」「求饶」「震惊」
- 有明确的角色或梗时也加上，如「熊猫头」「猫猫」
- 不要堆砌近义词

aliases：6~10 个，每个不超过 12 字
- 写成聊天时想发这张图的人会怎么描述它，如「无语到说不出话」「我裂开了」「谢谢老板」
- 图里有文字时，把文字原样作为一条别名，太长就截取最关键的部分
- 覆盖口语、网络用语和不同的说法

要求：
- 以画面和图中文字的真实含义为准，注意反讽和阴阳怪气，不要把无奈标成开心
- 只输出合法 JSON`

export const DEFAULT_INJECT_PROMPT = `你可以发送表情包来表达情绪或回应别人。下面每一项都是一个随机图地址，每次访问会随机返回一张对应的图片：

{chatluna_memes_list}

使用方式：
- 根据语境挑最合适的一项，把地址原样作为图片发出；不要改写地址，也不要编造列表里没有的地址
- 想要更具体的画面时，在地址后加 ?q=关键词，例如 ?q=开心；找不到匹配时会随机返回一张
- 拿不准选哪一项时，用 {base_url}{backend_path}?q=关键词 在全部表情包里搜索
- 不必每次都发，合适的时候再发`

export interface Settings {
  /** 对外地址，留空时使用 Koishi 的 server.selfUrl。 */
  selfUrl: string
  /** HTTP 路由前缀。 */
  backendPath: string
  injectVariables: boolean
  injectVariablesPrompt: string
  autoCollect: boolean
  emojiFrequencyWindowMinutes: number
  emojiFrequencyThreshold: number
  /** KB */
  minEmojiSize: number
  /** MB */
  maxEmojiSize: number
  groupAutoCollectLimit: number
  similarityThreshold: number
  /** 0 表示不自动清理。 */
  stagingRetentionDays: number
  /** ChatLuna 模型全名，如 openai/gpt-4o；留空表示不启用 AI 标注。 */
  model: string
  /** 上传、偷图和归档后是否自动排队标注。 */
  autoAnnotate: boolean
  annotatePrompt: string
  /** 0 表示不限制。 */
  aiDailyLimit: number
  aiConcurrency: number
  aiMaxAttempts: number
  /** 秒，第一次重试前的等待，之后每次翻倍，最多等 MAX_RETRY_DELAY 秒。 */
  aiRetryDelay: number
  /** 秒 */
  aiRequestTimeout: number
}

export const DEFAULT_SETTINGS: Settings = {
  selfUrl: '',
  backendPath: '/chatluna-memes',
  injectVariables: true,
  injectVariablesPrompt: DEFAULT_INJECT_PROMPT,
  autoCollect: false,
  emojiFrequencyWindowMinutes: 10,
  emojiFrequencyThreshold: 3,
  minEmojiSize: 4,
  maxEmojiSize: 15,
  groupAutoCollectLimit: 300,
  similarityThreshold: 0.9,
  stagingRetentionDays: 0,
  model: '',
  autoAnnotate: true,
  annotatePrompt: DEFAULT_ANNOTATE_PROMPT,
  aiDailyLimit: 1000,
  aiConcurrency: 3,
  aiMaxAttempts: 2,
  aiRetryDelay: 2,
  aiRequestTimeout: 60,
}

type KeysOfType<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings]
export type NumericSettingKey = KeysOfType<number>

/** 重试等待翻倍后的上限（秒）。 */
export const MAX_RETRY_DELAY = 30

export interface NumberRule { label: string; min: number; max: number; integer: boolean }

export const NUMBER_RULES: Record<NumericSettingKey, NumberRule> = {
  emojiFrequencyWindowMinutes: { label: '统计窗口', min: 1, max: 1440, integer: true },
  emojiFrequencyThreshold: { label: '出现次数', min: 1, max: 50, integer: true },
  minEmojiSize: { label: '最小体积', min: 0, max: 1024, integer: true },
  maxEmojiSize: { label: '最大体积', min: 1, max: 50, integer: true },
  groupAutoCollectLimit: { label: '每群每日上限', min: 1, max: 5000, integer: true },
  similarityThreshold: { label: '相似度阈值', min: 0.5, max: 1, integer: false },
  stagingRetentionDays: { label: '保留天数', min: 0, max: 365, integer: true },
  aiDailyLimit: { label: '每日请求上限', min: 0, max: 100000, integer: true },
  aiConcurrency: { label: '并发请求数', min: 1, max: 10, integer: true },
  aiMaxAttempts: { label: '最多尝试次数', min: 1, max: 10, integer: true },
  aiRetryDelay: { label: '重试等待', min: 1, max: 30, integer: true },
  aiRequestTimeout: { label: '请求超时', min: 5, max: 300, integer: true },
}

const BOOLEAN_KEYS = ['injectVariables', 'autoCollect', 'autoAnnotate'] as const
const PROMPT_KEYS = { injectVariablesPrompt: 'ChatLuna 提示词', annotatePrompt: '标注提示词' } as const

function normalizeSelfUrl(value: string): string | null {
  const url = value.trim().replace(/\/+$/, '')
  if (!url) return ''
  return /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url) ? url : null
}

/** 规范成 /a/b 形式；. 和 .. 段会被浏览器和路由折叠掉，不允许。 */
export function normalizeBackendPath(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '')
  const pathname = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(pathname)) return null
  return pathname.split('/').some((segment) => segment === '.' || segment === '..') ? null : pathname
}

function checkNumber(key: NumericSettingKey, value: unknown): string | null {
  const rule = NUMBER_RULES[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return `「${rule.label}」需要填写数字`
  if (rule.integer && !Number.isInteger(value)) return `「${rule.label}」需要是整数`
  if (value < rule.min || value > rule.max) return `「${rule.label}」需在 ${rule.min} 到 ${rule.max} 之间`
  return null
}

export type SettingsPatchResult = { ok: true; settings: Settings } | { ok: false; error: string }

/** 严格校验管理页提交的修改，任何一项不合法都整体拒绝。 */
export function applySettingsPatch(current: Settings, patch: unknown): SettingsPatchResult {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: '设置格式不正确' }
  const next: Settings = { ...current }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!hasOwn(DEFAULT_SETTINGS, key)) return { ok: false, error: `未知的设置项：${key}` }
    if (hasOwn(NUMBER_RULES, key)) {
      const error = checkNumber(key as NumericSettingKey, value)
      if (error) return { ok: false, error }
      ;(next as any)[key] = value
    } else if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') return { ok: false, error: `设置项 ${key} 需要是开关` }
      ;(next as any)[key] = value
    } else {
      if (typeof value !== 'string') return { ok: false, error: `设置项 ${key} 需要是文本` }
      if (key === 'selfUrl') {
        const url = normalizeSelfUrl(value)
        if (url === null) return { ok: false, error: '对外地址需以 http:// 或 https:// 开头，例如 https://bot.example.com' }
        next.selfUrl = url
      } else if (key === 'backendPath') {
        const pathname = normalizeBackendPath(value)
        if (pathname === null) return { ok: false, error: '路由前缀只能包含字母、数字和 . _ ~ -，例如 /chatluna-memes' }
        next.backendPath = pathname
      } else if (key in PROMPT_KEYS) {
        if (!value.trim()) return { ok: false, error: `${PROMPT_KEYS[key as keyof typeof PROMPT_KEYS]}不能为空` }
        ;(next as any)[key] = value
      } else {
        ;(next as any)[key] = value.trim()
      }
    }
  }
  if (next.minEmojiSize * 1024 >= next.maxEmojiSize * 1024 * 1024) return { ok: false, error: '最小体积需要小于最大体积' }
  return { ok: true, settings: next }
}

/** in 会匹配到 toString、constructor 等原型上的键。 */
function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key)
}

/** 宽松读取已保存或迁移来的设置：不合法的项退回默认值，数字夹到允许范围内。 */
export function resolveSettings(input: unknown): Settings {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const result: Settings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = source[key]
    if (value === undefined || value === null) continue
    if (key in NUMBER_RULES) {
      const rule = NUMBER_RULES[key as NumericSettingKey]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const clamped = Math.min(rule.max, Math.max(rule.min, value))
      ;(result as any)[key] = rule.integer ? Math.round(clamped) : clamped
    } else if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value === 'boolean') (result as any)[key] = value
    } else if (typeof value === 'string') {
      if (key === 'selfUrl') result.selfUrl = normalizeSelfUrl(value) ?? ''
      else if (key === 'backendPath') result.backendPath = normalizeBackendPath(value) ?? DEFAULT_SETTINGS.backendPath
      else if (key === 'annotatePrompt') { if (value.trim()) result.annotatePrompt = value }
      else if (key === 'injectVariablesPrompt') { if (value.trim()) result.injectVariablesPrompt = value }
      else (result as any)[key] = value.trim()
    }
  }
  // 各项单独夹到范围内后仍可能出现最小体积不小于最大体积，这时最小体积退回默认值。
  if (result.minEmojiSize * 1024 >= result.maxEmojiSize * 1024 * 1024) result.minEmojiSize = DEFAULT_SETTINGS.minEmojiSize
  return result
}

/** 只保存和默认值不同的项，以后调整默认值时没改过的设置能跟着更新。 */
export function diffFromDefaults(settings: Settings): Partial<Settings> {
  return Object.fromEntries(Object.entries(settings).filter(([key, value]) => DEFAULT_SETTINGS[key as keyof Settings] !== value)) as Partial<Settings>
}
