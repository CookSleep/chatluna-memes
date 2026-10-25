import { describe, expect, it } from 'vitest'
import { applySettingsPatch, DEFAULT_SETTINGS, diffFromDefaults, migrateLegacyConfig, resolveSettings } from '../src/settings'

describe('settings', () => {
  it('migrates legacy koishi.yml config', () => {
    const settings = migrateLegacyConfig({ injectVariables: false, aiRequestTimeoutMs: 30000, aiBackoffBase: 5000, maxEmojiSize: 80, backendPath: 'memes/' })
    expect(settings.injectVariables).toBe(false)
    expect(settings.aiRequestTimeout).toBe(30)
    expect(settings.maxEmojiSize).toBe(50)
    expect(settings.backendPath).toBe('/memes')
    expect(settings.aiRetryDelay).toBe(5)
    expect(settings).not.toHaveProperty('aiBackoffBase')
  })

  it('falls back to defaults for invalid saved values', () => {
    const settings = resolveSettings({ autoCollect: 'yes', similarityThreshold: 2, annotatePrompt: '  ', selfUrl: 'ftp://x' })
    expect(settings.autoCollect).toBe(false)
    expect(settings.similarityThreshold).toBe(1)
    expect(settings.annotatePrompt).toBe(DEFAULT_SETTINGS.annotatePrompt)
    expect(settings.selfUrl).toBe('')
  })

  it('keeps customized prompts', () => {
    const legacyStart = '你是"二次元表情检索标注助手"'
    const saved = resolveSettings({ annotatePrompt: `${legacyStart}。自定义`, injectVariablesPrompt: '自定义模板 {endpoint}' })
    expect(saved.annotatePrompt).toBe(`${legacyStart}。自定义`)
    expect(saved.injectVariablesPrompt).toBe('自定义模板 {endpoint}')
  })

  it('resets min size when it is not below max size', () => {
    expect(resolveSettings({ minEmojiSize: 1024, maxEmojiSize: 1 })).toMatchObject({ minEmojiSize: DEFAULT_SETTINGS.minEmojiSize, maxEmojiSize: 1 })
  })

  it('stores only values that differ from defaults', () => {
    expect(diffFromDefaults({ ...DEFAULT_SETTINGS, injectVariables: false })).toEqual({ injectVariables: false })
  })

  it('normalizes valid patches', () => {
    const result = applySettingsPatch(DEFAULT_SETTINGS, { selfUrl: 'https://bot.example.com/', backendPath: 'emoji', autoCollect: true })
    expect(result).toMatchObject({ ok: true, settings: { selfUrl: 'https://bot.example.com', backendPath: '/emoji', autoCollect: true } })
  })

  it.each([
    [{ unknown: 1 }, '未知的设置项'],
    [{ toString: 5 }, '未知的设置项'],
    [{ backendPath: '/a/..' }, '路由前缀'],
    [{ backendPath: '.' }, '路由前缀'],
    [{ aiConcurrency: 0 }, '需在 1 到 10 之间'],
    [{ aiConcurrency: 1.5 }, '需要是整数'],
    [{ autoCollect: 'true' }, '需要是开关'],
    [{ backendPath: '/a b' }, '路由前缀'],
    [{ selfUrl: 'bot.example.com' }, '对外地址'],
    [{ annotatePrompt: ' ' }, '不能为空'],
  ])('rejects invalid patch %o', (patch, message) => {
    const result = applySettingsPatch(DEFAULT_SETTINGS, patch)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(message)
  })
})

describe('legacy default prompts', () => {
  it('upgrades the previous built-in prompts', async () => {
    const old = await import('./fixtures/old-settings')
    const settings = resolveSettings({ annotatePrompt: old.DEFAULT_ANNOTATE_PROMPT, injectVariablesPrompt: old.DEFAULT_INJECT_PROMPT })
    expect(settings.annotatePrompt).toBe(DEFAULT_SETTINGS.annotatePrompt)
    expect(settings.injectVariablesPrompt).toBe(DEFAULT_SETTINGS.injectVariablesPrompt)
  })
})
