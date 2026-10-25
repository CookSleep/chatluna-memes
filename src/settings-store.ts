import type { Context } from 'koishi'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { withStorageLock } from './storage'
import { applySettingsPatch, diffFromDefaults, migrateLegacyConfig, resolveSettings, type Settings, type SettingsPatchResult } from './settings'

export const SETTINGS_UPDATED = 'memesluna/settings-updated'

/**
 * 设置保存在 data/memesluna/.settings.json，只记录和默认值不同的项。
 * value 是全插件共享的同一个对象，保存时原地更新，读取方总能拿到最新值。
 */
export class SettingsStore {
  readonly value: Settings
  readonly filename: string

  constructor(private ctx: Context, legacy: unknown) {
    this.filename = path.resolve(ctx.baseDir, 'data/memesluna/.settings.json')
    this.value = this.load(legacy)
  }

  // 插件启动时同步读取，保证各功能挂载前设置已就绪。
  private load(legacy: unknown): Settings {
    let raw: string
    try {
      raw = readFileSync(this.filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const migrated = migrateLegacyConfig(legacy)
      try {
        mkdirSync(path.dirname(this.filename), { recursive: true })
        writeFileSync(this.filename, JSON.stringify(diffFromDefaults(migrated), null, 2), { flag: 'wx', mode: 0o600 })
        this.ctx.logger('memesluna').info('已把插件配置迁移到管理页的「配置」中')
      } catch (writeError) {
        this.ctx.logger('memesluna').warn('保存迁移后的设置失败:', writeError)
      }
      return migrated
    }
    try {
      return resolveSettings(JSON.parse(raw))
    } catch {
      // 不覆盖损坏的文件，留给用户排查；下次在管理页保存时才会写入新内容。
      this.ctx.logger('memesluna').warn(`设置文件 ${this.filename} 无法解析，暂时使用默认设置`)
      return resolveSettings({})
    }
  }

  async update(patch: unknown): Promise<SettingsPatchResult> {
    return withStorageLock(this.filename, async () => {
      const result = applySettingsPatch(this.value, patch)
      if (!result.ok) return result
      const temp = `${this.filename}.${randomUUID()}.tmp`
      try {
        await fs.mkdir(path.dirname(this.filename), { recursive: true })
        await fs.writeFile(temp, JSON.stringify(diffFromDefaults(result.settings), null, 2), { flag: 'wx', mode: 0o600 })
        await fs.rename(temp, this.filename)
      } finally {
        await fs.rm(temp, { force: true })
      }
      const previous = { ...this.value }
      Object.assign(this.value, result.settings)
      ;(this.ctx as any).emit(SETTINGS_UPDATED, previous, this.value)
      return { ok: true, settings: { ...this.value } }
    })
  }
}
