import { existsSync, readFileSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import type { Context } from 'koishi'
import { DEFAULT_SETTINGS, resolveSettings, type Settings } from './settings'

/** 原 koishi-plugin-memesluna 的数据，迁移后原样保留，确认无误后可以手动删除。 */
export const LEGACY_ROOT = 'data/memesluna'
const LEGACY_SETTINGS_FILE = '.settings.json'
const LEGACY_TABLES = {
  memesluna_endpoints: 'chatluna_memes_endpoints',
  memesluna_images: 'chatluna_memes_images',
  memesluna_staged_images: 'chatluna_memes_staged_images',
} as const
const MIGRATION_META_KEY = 'memesluna_migration'

declare module 'koishi' {
  interface Tables {
    chatluna_memes_meta: { key: string; value: string }
  }
}

export interface DataMigrationResult {
  state: 'done' | 'no-legacy-data' | 'skipped'
  finishedAt: string
  counts?: Record<string, number>
}

function findLegacyPluginConfig(plugins: unknown): Record<string, unknown> | undefined {
  if (!plugins || typeof plugins !== 'object') return
  for (const [key, value] of Object.entries(plugins)) {
    if (/^~?memesluna(:|$)/.test(key)) return value && typeof value === 'object' ? value as Record<string, unknown> : {}
    if (/^~?group(:|$)/.test(key)) {
      const found = findLegacyPluginConfig(value)
      if (found) return found
    }
  }
}

/**
 * 首次启动时的设置：优先读原插件管理页保存的设置文件，没有就读 koishi.yml 里原插件的配置。
 * 原来的默认路由前缀 /memesluna 换成新的默认值，自定义的前缀保留。
 */
export function migrateLegacySettings(baseDir: string, loaderPlugins: unknown): Settings | null {
  let source: Record<string, unknown> | undefined
  try {
    source = JSON.parse(readFileSync(path.resolve(baseDir, LEGACY_ROOT, LEGACY_SETTINGS_FILE), 'utf8'))
  } catch {
    source = findLegacyPluginConfig(loaderPlugins)
    if (source) {
      source = { ...source }
      if (typeof source.aiRequestTimeoutMs === 'number') source.aiRequestTimeout = Math.round(source.aiRequestTimeoutMs / 1000)
      if (typeof source.aiBackoffBase === 'number') source.aiRetryDelay = Math.round(source.aiBackoffBase / 1000)
    }
  }
  if (!source || typeof source !== 'object') return null
  const settings = resolveSettings(source)
  if (settings.backendPath === '/memesluna') settings.backendPath = DEFAULT_SETTINGS.backendPath
  // {tag_routes}、{tags} 是 memesluna 更早版本的占位符，已经没有对应内容。
  settings.injectVariablesPrompt = settings.injectVariablesPrompt
    .replaceAll('{endpoint}', '{chatluna_memes_list}')
    .replaceAll('{tag_routes}', '')
    .replaceAll('{tags}', '')
  return settings
}

function defineLegacyTables(ctx: Context) {
  const database = ctx.database as any
  database.extend('memesluna_endpoints', {
    id: 'string', name: 'string', group: 'string', description: 'string', url: 'string', method: 'string',
    url_construction: 'string', model_name: 'string', query_params: 'string', proxy_settings: 'string',
    created_at: 'timestamp', updated_at: 'timestamp',
  }, { primary: 'id', unique: ['name'] })
  database.extend('memesluna_images', {
    id: 'string', collection: 'string', index: 'integer', filename: 'string', type: 'string', value: 'string',
    public_url: 'string', mime: 'string', hash: 'string', perceptual_hash: 'string',
    aliases: { type: 'string', initial: '[]' }, tags: { type: 'string', initial: '[]' }, created_at: 'timestamp',
  }, { primary: 'id', unique: [['collection', 'index']], indexes: ['hash', 'collection', 'perceptual_hash'] })
  database.extend('memesluna_staged_images', {
    id: 'string', filename: 'string', original_name: 'string', source: 'string', reason: 'string', mime: 'string',
    size: 'integer', hash: 'string', perceptual_hash: 'string', created_at: 'timestamp',
  }, { primary: 'id', unique: ['filename'], indexes: ['hash'] })
}

export function defineMetaTable(ctx: Context) {
  ctx.database.extend('chatluna_memes_meta', { key: 'string', value: 'text' }, { primary: 'key' })
}

async function readMigrationState(ctx: Context): Promise<DataMigrationResult | undefined> {
  const [row] = await ctx.database.get('chatluna_memes_meta', { key: MIGRATION_META_KEY })
  return row ? JSON.parse(row.value) : undefined
}

async function writeMigrationState(ctx: Context, result: DataMigrationResult) {
  await ctx.database.upsert('chatluna_memes_meta', [{ key: MIGRATION_META_KEY, value: JSON.stringify(result) }])
}

/**
 * 把原插件的数据库记录和图片文件复制过来，完成后记录状态，以后不再迁移。
 * 中途失败时不记录状态，下次启动重新执行；复制不覆盖已有文件，记录按主键 upsert，重复执行不会产生重复数据。
 * 关闭迁移时记为 skipped，之后再开启也不补做：那时本插件已有自己的数据，再迁移会和原记录冲突。
 */
export async function migrateLegacyData(ctx: Context, root: string, enabled = true): Promise<DataMigrationResult | undefined> {
  if (await readMigrationState(ctx)) return
  const logger = ctx.logger('chatluna-memes')
  const legacyRoot = path.resolve(ctx.baseDir, LEGACY_ROOT)
  if (existsSync(legacyRoot) && !enabled) {
    // 上次迁移中断时已写入部分记录，这时跳过会让同步目录给已复制的图片另建记录，之后无法再补全。
    for (const table of Object.values(LEGACY_TABLES)) {
      const [partial] = await (ctx.database as any).get(table, {}, { limit: 1, fields: ['id'] })
      if (partial) throw new Error('上次迁移 memesluna 的数据时中断，已写入部分记录，不能跳过。请开启 migrateMemesluna 后重启 Koishi 完成迁移')
    }
    const result: DataMigrationResult = { state: 'skipped', finishedAt: new Date().toISOString() }
    await writeMigrationState(ctx, result)
    logger.info('已按配置跳过 memesluna 数据的迁移，之后不会再迁移')
    return result
  }
  if (!existsSync(legacyRoot)) {
    const result: DataMigrationResult = { state: 'no-legacy-data', finishedAt: new Date().toISOString() }
    await writeMigrationState(ctx, result)
    return result
  }

  logger.info('检测到 memesluna 的数据，开始迁移')
  await fs.mkdir(root, { recursive: true })
  await fs.cp(legacyRoot, root, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => path.relative(legacyRoot, source) !== LEGACY_SETTINGS_FILE,
  })

  defineLegacyTables(ctx)
  const counts: Record<string, number> = {}
  for (const [legacyTable, table] of Object.entries(LEGACY_TABLES)) {
    const rows = await (ctx.database as any).get(legacyTable, {})
    if (rows.length) await (ctx.database as any).upsert(table, rows)
    // 不按 id 用 IN 查询：SQLite 驱动（sql.js）遇到上千项的 IN 会在 wasm 里越界崩溃。
    const existing = new Set((await (ctx.database as any).get(table, {}, ['id'])).map((row: any) => row.id))
    const migrated = rows.filter((row: any) => existing.has(row.id)).length
    if (migrated !== rows.length) throw new Error(`迁移 ${legacyTable} 后记录数不一致：${rows.length} → ${migrated}`)
    counts[legacyTable] = rows.length
  }

  const result: DataMigrationResult = { state: 'done', finishedAt: new Date().toISOString(), counts }
  await writeMigrationState(ctx, result)
  logger.info(
    `迁移完成：${counts.memesluna_images} 张图片和外链、${counts.memesluna_endpoints} 个外部图源、${counts.memesluna_staged_images} 张暂缓区图片。`
    + `原数据仍保留在 ${LEGACY_ROOT} 和 memesluna_* 数据表中，确认无误后可以手动删除，之后不会再次迁移。`,
  )
  return result
}
