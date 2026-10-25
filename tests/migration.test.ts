import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { migrateLegacyData, migrateLegacySettings } from '../src/migration'
import { DEFAULT_SETTINGS } from '../src/settings'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-memes-migration-'))
  roots.push(dir)
  return dir
}

function memoryDatabase(tables: Record<string, any[]>) {
  const matches = (row: any, query: any) => Object.entries(query).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)
  return {
    tables,
    extend: vi.fn((name: string) => { tables[name] ??= [] }),
    get: vi.fn(async (name: string, query: any) => (tables[name] ?? []).filter((row) => matches(row, query))),
    upsert: vi.fn(async (name: string, rows: any[]) => {
      const key = name === 'chatluna_memes_meta' ? 'key' : 'id'
      tables[name] ??= []
      for (const row of rows) {
        const existing = tables[name].find((item) => item[key] === row[key])
        if (existing) Object.assign(existing, row)
        else tables[name].push({ ...row })
      }
    }),
  }
}

function context(baseDir: string, database: ReturnType<typeof memoryDatabase>) {
  return { baseDir, database, logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } as any
}

describe('migrateLegacySettings', () => {
  it('prefers the settings file saved by the memesluna console page', async () => {
    const baseDir = await tempDir()
    await fs.mkdir(path.join(baseDir, 'data/memesluna'), { recursive: true })
    await fs.writeFile(path.join(baseDir, 'data/memesluna/.settings.json'), JSON.stringify({ injectVariables: false, backendPath: '/emoji' }))
    const settings = migrateLegacySettings(baseDir, { 'memesluna:abc': { autoCollect: true } })
    expect(settings).toMatchObject({ injectVariables: false, backendPath: '/emoji', autoCollect: false })
  })

  it('reads the memesluna entry in koishi.yml, including disabled and grouped ones', async () => {
    const baseDir = await tempDir()
    const settings = migrateLegacySettings(baseDir, {
      'group:basic': { 'echo:x': {} },
      'group:ai': { '~memesluna:abc': { autoCollect: true, aiRequestTimeoutMs: 30000, aiBackoffBase: 5000, injectVariablesPrompt: '清单：{endpoint}' } },
    })
    expect(settings).toMatchObject({ autoCollect: true, aiRequestTimeout: 30, aiRetryDelay: 5, injectVariablesPrompt: '清单：{chatluna_memes_list}' })
  })

  it('switches the old default route prefix to the new default', async () => {
    const baseDir = await tempDir()
    expect(migrateLegacySettings(baseDir, { 'memesluna:abc': {} })?.backendPath).toBe(DEFAULT_SETTINGS.backendPath)
    expect(migrateLegacySettings(baseDir, { 'memesluna:abc': { backendPath: '/memesluna' } })?.backendPath).toBe(DEFAULT_SETTINGS.backendPath)
  })

  it('returns null without memesluna settings', async () => {
    expect(migrateLegacySettings(await tempDir(), { 'echo:x': {} })).toBeNull()
  })
})

describe('migrateLegacyData', () => {
  it('copies files and rows once, keeps the legacy data, and records the state', async () => {
    const baseDir = await tempDir()
    const legacy = path.join(baseDir, 'data/memesluna')
    const root = path.join(baseDir, 'data/chatluna-memes')
    await fs.mkdir(path.join(legacy, '猫猫'), { recursive: true })
    await fs.mkdir(path.join(legacy, '.staging'))
    await fs.writeFile(path.join(legacy, '猫猫/1.png'), 'cat')
    await fs.writeFile(path.join(legacy, '.settings.json'), '{}')
    const database = memoryDatabase({
      memesluna_images: [{ id: 'a', collection: '猫猫', index: 1, filename: '1.png', tags: '["猫"]' }],
      memesluna_endpoints: [{ id: 'e', name: '一言' }],
      memesluna_staged_images: [],
    })
    const ctx = context(baseDir, database)

    const result = await migrateLegacyData(ctx, root)
    expect(result).toMatchObject({ state: 'done', counts: { memesluna_images: 1, memesluna_endpoints: 1, memesluna_staged_images: 0 } })
    expect(await fs.readFile(path.join(root, '猫猫/1.png'), 'utf8')).toBe('cat')
    await expect(fs.access(path.join(root, '.settings.json'))).rejects.toThrow()
    expect(database.tables.chatluna_memes_images).toEqual([expect.objectContaining({ id: 'a', tags: '["猫"]' })])
    expect(database.tables.chatluna_memes_endpoints).toEqual([expect.objectContaining({ id: 'e' })])
    expect(database.tables.memesluna_images).toHaveLength(1)
    expect(await fs.readFile(path.join(legacy, '猫猫/1.png'), 'utf8')).toBe('cat')

    database.tables.memesluna_images.push({ id: 'b', collection: '猫猫', index: 2 })
    expect(await migrateLegacyData(ctx, root)).toBeUndefined()
    expect(database.tables.chatluna_memes_images).toHaveLength(1)
  })

  it('does not overwrite files that already exist', async () => {
    const baseDir = await tempDir()
    const root = path.join(baseDir, 'data/chatluna-memes')
    await fs.mkdir(path.join(baseDir, 'data/memesluna/猫猫'), { recursive: true })
    await fs.mkdir(path.join(root, '猫猫'), { recursive: true })
    await fs.writeFile(path.join(baseDir, 'data/memesluna/猫猫/1.png'), 'old')
    await fs.writeFile(path.join(root, '猫猫/1.png'), 'new')
    await migrateLegacyData(context(baseDir, memoryDatabase({})), root)
    expect(await fs.readFile(path.join(root, '猫猫/1.png'), 'utf8')).toBe('new')
  })

  it('records that there is nothing to migrate', async () => {
    const baseDir = await tempDir()
    const database = memoryDatabase({})
    expect(await migrateLegacyData(context(baseDir, database), path.join(baseDir, 'data/chatluna-memes'))).toMatchObject({ state: 'no-legacy-data' })
    expect(database.extend).not.toHaveBeenCalled()
    expect(database.tables.chatluna_memes_meta).toHaveLength(1)
  })
})
