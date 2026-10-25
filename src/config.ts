import { Schema } from 'koishi'

/** 旧版写在 koishi.yml 里的配置项，只在首次启动时迁移到管理页的设置，之后不再读取。 */
const LEGACY_KEYS = [
  'backendPath', 'selfUrl', 'injectVariables', 'variableRefreshIntervalMs', 'injectVariablesPrompt',
  'autoCollect', 'emojiFrequencyWindowMinutes', 'emojiFrequencyThreshold', 'minEmojiSize', 'maxEmojiSize',
  'groupAutoCollectLimit', 'similarityThreshold', 'stagingRetentionDays', 'model', 'annotatePrompt',
  'aiConcurrency', 'aiBatchDelay', 'aiMaxAttempts', 'aiBackoffBase', 'aiDailyLimit', 'aiWarnThreshold', 'aiRequestTimeoutMs',
] as const

export type Config = Partial<Record<typeof LEGACY_KEYS[number], unknown>>

export const Config: Schema<Config> = Schema.object(
  Object.fromEntries(LEGACY_KEYS.map((key) => [key, Schema.any().hidden()])),
).description('所有设置都已移到控制台的 MemesLuna 页面，在「配置」标签页中修改，保存后立即生效。') as Schema<Config>

export const name = 'memesluna'
