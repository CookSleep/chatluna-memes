import type { Context } from 'koishi'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { withStorageLock } from './storage'
import { migrateLegacySettings } from './migration'
import { applySettingsPatch, diffFromDefaults, resolveSettings, type Settings, type SettingsPatchResult } from './settings'

export const SETTINGS_UPDATED = 'chatluna-memes/settings-updated'

/**
 * 设置保存在 data/chatluna-memes/.settings.json，只记录和默认值不同的项。
 * value 是全插件共享的同一个对象，保存时原地更新，读取方总能拿到最新值。
 */
export class SettingsStore {
  readonly value: Settings
  readonly filename: string

  constructor(private ctx: Context) {
    this.filename = path.resolve(ctx.baseDir, 'data/chatluna-memes/.settings.json')
    this.value = this.load()
  }

  // 插件启动时同步读取，保证各功能挂载前设置已就绪。
  private load(): Settings {
    let raw: string
    try {
      raw = readFileSync(this.filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // 只在第一次启动（数据目录还不存在）时迁移，之后删掉设置文件就是恢复默认。
      const firstRun = !existsSync(path.dirname(this.filename))
      const migrated = firstRun ? migrateLegacySettings(this.ctx.baseDir, (this.ctx as any).loader?.config?.plugins) : null
      const settings = migrated ?? resolveSettings({})
      try {
        mkdirSync(path.dirname(this.filename), { recursive: true })
        writeFileSync(this.filename, JSON.stringify(diffFromDefaults(settings), null, 2), { flag: 'wx', mode: 0o600 })
        if (migrated) this.ctx.logger('chatluna-memes').info('已迁移 memesluna 的设置')
      } catch (writeError) {
        this.ctx.logger('chatluna-memes').warn('保存设置失败:', writeError)
      }
      return settings
    }
    try {
      return resolveSettings(JSON.parse(raw))
    } catch {
      // 不覆盖损坏的文件，留给用户排查；下次在管理页保存时才会写入新内容。
      this.ctx.logger('chatluna-memes').warn(`设置文件 ${this.filename} 无法解析，暂时使用默认设置`)
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
