import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { MemesLunaService, hashImageBuffer } from '../src/service'

// Koishi 的 CJS loader 在 Vitest 的 ESM 转换中不兼容；使用生产入口。
vi.mock('koishi', async () => {
  const { createRequire } = await import('node:module')
  return createRequire(import.meta.url)('koishi')
})

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

function matches(row: any, query: any): boolean {
  return Object.entries(query).every(([key, value]: [string, any]) => {
    if (key === '$or') return value.some((part: any) => matches(row, part))
    if (key === '$and') return value.every((part: any) => matches(row, part))
    if (Array.isArray(value)) return value.includes(row[key])
    if (value?.$regex) return value.$regex.test(row[key] || '')
    return row[key] === value
  })
}

async function fixture() {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memesluna-test-'))
  roots.push(baseDir)
  const root = path.join(baseDir, 'data/memesluna')
  await fs.mkdir(path.join(root, 'source'), { recursive: true })
  await fs.mkdir(path.join(root, 'target'))
  await fs.mkdir(path.join(root, '.staging'))
  const tables: Record<string, any[]> = { memesluna_images: [], memesluna_staged_images: [], memesluna_endpoints: [] }
  const database = {
    get: vi.fn(async (table: string, query: any, options?: any) => {
      let rows = tables[table].filter((row) => matches(row, query))
      if (options?.sort) rows = [...rows].sort((a, b) => {
        for (const [key, direction] of Object.entries(options.sort)) {
          const delta = typeof a[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]))
          if (delta) return direction === 'desc' ? -delta : delta
        }
        return 0
      })
      return rows.slice(options?.offset || 0, options?.limit ? (options.offset || 0) + options.limit : undefined)
    }),
    eval: vi.fn(async (table: string, _expression: any, query: any) => tables[table].filter((row) => matches(row, query)).length),
    create: vi.fn(async (table: string, row: any) => {
      if (table === 'memesluna_images' && tables[table].some((item) => item.collection === row.collection && item.index === row.index)) throw new Error('Duplicate index')
      tables[table].push({ ...row })
      return row
    }),
    set: vi.fn(async (table: string, query: any, update: any) => { for (const row of tables[table]) if (matches(row, query)) Object.assign(row, update) }),
    remove: vi.fn(async (table: string, query: any) => { tables[table] = tables[table].filter((row) => !matches(row, query)) }),
  }
  const service = Object.create(MemesLunaService.prototype) as MemesLunaService
  Object.assign(service, {
    ctx: { baseDir, database, emit: vi.fn(), logger: () => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
    config: { similarityThreshold: 0.9 },
    getImageFingerprints: async (buffer: Buffer) => ({ hash: hashImageBuffer(buffer), perceptual_hash: '' }),
    backfillStagedFingerprints: async () => {},
  })
  return { service, root, tables, database }
}

describe('图片存储一致性', () => {
  it('启动时规范化文件名不覆盖已有文件并保留标注', async () => {
    const { service, root, tables } = await fixture()
    await fs.writeFile(path.join(root, 'source/a b.png'), 'legacy')
    await fs.writeFile(path.join(root, 'source/a_b.png'), 'existing')
    tables.memesluna_images.push({ id: 'legacy', index: 1, collection: 'source', filename: 'a b.png', value: 'a b.png', type: 'local', tags: '["旧标注"]' })
    await (service as any).syncExistingFilesToDatabase()
    expect(await fs.readFile(path.join(root, 'source/a_b.png'), 'utf8')).toBe('existing')
    expect(await fs.readFile(path.join(root, 'source/a_b_1.png'), 'utf8')).toBe('legacy')
    expect(tables.memesluna_images.find((row) => row.id === 'legacy')).toMatchObject({ filename: 'a_b_1.png', tags: '["旧标注"]' })
  })
  it('重复上传保留原 id、文件名和标注；不合法后缀不删除原图', async () => {
    const { service, root, tables } = await fixture()
    const buffer = Buffer.from('same image')
    const first = await service.addLocalImageBuffer('source', buffer, 'old.png')
    tables.memesluna_images[0].aliases = '["已有别名"]'
    await expect(service.addLocalImageBuffer('source', buffer, 'bad.avif')).rejects.toThrow('Unsupported')
    const duplicate = await service.addLocalImageBuffer('source', buffer, 'new.png')
    expect(duplicate.id).toBe(first.id)
    expect(duplicate.filename).toBe('old.png')
    expect(tables.memesluna_images).toHaveLength(1)
    expect(tables.memesluna_images[0].aliases).toBe('["已有别名"]')
    expect(await fs.readFile(path.join(root, 'source/old.png'))).toEqual(buffer)
  })

  it('数据库插入失败时移除新文件', async () => {
    const { service, root, database } = await fixture()
    database.create.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(service.addLocalImageBuffer('source', Buffer.from('a'), 'a.png')).rejects.toThrow('database unavailable')
    expect(await fs.readdir(path.join(root, 'source'))).toEqual([])
  })
  it('读取权限错误不能被当作文件丢失删除已有记录', async () => {
    const { service, database, tables } = await fixture()
    await service.addLocalImageBuffer('source', Buffer.from('image'), 'a.png')
    const access = vi.spyOn(fs, 'access').mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
    try {
      await expect(service.addLocalImageBuffer('source', Buffer.from('image'), 'a.png')).rejects.toThrow('permission denied')
      expect(database.remove).not.toHaveBeenCalled()
      expect(tables.memesluna_images).toHaveLength(1)
    } finally { access.mockRestore() }
  })

  it('并发上传同名图片不会覆盖文件或分配重复 index', async () => {
    const { service, root, tables } = await fixture()
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => service.addLocalImageBuffer('source', Buffer.from(String(index)), 'a.png')))
    expect(new Set(results.map((row) => row.filename)).size).toBe(8)
    expect(new Set(tables.memesluna_images.map((row) => row.index)).size).toBe(8)
    for (let i = 0; i < results.length; i++) expect(await fs.readFile(path.join(root, 'source', results[i].filename), 'utf8')).toBe(String(i))
  })

  it('移动保留目标同名文件，包括未登记的磁盘文件', async () => {
    const { service, root } = await fixture()
    await service.addLocalImageBuffer('source', Buffer.from('source'), '2.png')
    await fs.writeFile(path.join(root, 'target/2.png'), 'existing')
    const moved = await service.moveImageToCollection('source', 'target', '2.png')
    expect(moved).toBe('2_1.png')
    expect(await fs.readFile(path.join(root, 'target/2.png'), 'utf8')).toBe('existing')
    expect(await fs.readFile(path.join(root, 'target/2_1.png'), 'utf8')).toBe('source')
  })

  it('移动数据库更新失败时恢复源文件并移除目标副本', async () => {
    const { service, root, database, tables } = await fixture()
    await service.addLocalImageBuffer('source', Buffer.from('source'), 'a.png')
    database.set.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(service.moveImageToCollection('source', 'target', 'a.png')).rejects.toThrow('database unavailable')
    expect(await fs.readFile(path.join(root, 'source/a.png'), 'utf8')).toBe('source')
    expect(await fs.readdir(path.join(root, 'target'))).toEqual([])
    expect(tables.memesluna_images[0].collection).toBe('source')
  })

  it('合集改名同步目录、外链清单和数据库，失败时回滚', async () => {
    const { service, root, database, tables } = await fixture()
    await service.addLocalImageBuffer('source', Buffer.from('source'), 'a.png')
    await fs.writeFile(path.join(root, 'source/source.txt'), 'https://example.com/a.png')
    await expect(service.renameCollection('source', 'target')).rejects.toThrow('已经有叫「target」的表情包了')

    database.set.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(service.renameCollection('source', 'renamed')).rejects.toThrow('database unavailable')
    expect(await fs.readFile(path.join(root, 'source/source.txt'), 'utf8')).toBe('https://example.com/a.png')
    expect(tables.memesluna_images[0].collection).toBe('source')

    expect(await service.renameCollection('source', 'renamed')).toBe(true)
    expect(await fs.readFile(path.join(root, 'renamed/a.png'), 'utf8')).toBe('source')
    expect(await fs.readFile(path.join(root, 'renamed/renamed.txt'), 'utf8')).toBe('https://example.com/a.png')
    expect(tables.memesluna_images[0].collection).toBe('renamed')
    await expect(fs.stat(path.join(root, 'source'))).rejects.toThrow()
  })

  it('删除数据库失败时恢复原文件', async () => {
    const { service, root, database } = await fixture()
    await service.addLocalImageBuffer('source', Buffer.from('source'), 'a.png')
    database.remove.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(service.deleteImageFromCollection('source', 'a.png')).rejects.toThrow('database unavailable')
    expect(await fs.readFile(path.join(root, 'source/a.png'), 'utf8')).toBe('source')
  })

  it('归档暂缓区删除失败时撤销新图片，暂缓区保持可用', async () => {
    const { service, root, database, tables } = await fixture()
    const staged = await service.addStagedImageBuffer(Buffer.from('source'), 'a.png')
    database.remove.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(service.promoteStagedImage(staged.id, 'source')).rejects.toThrow('database unavailable')
    expect(tables.memesluna_images).toHaveLength(0)
    expect(tables.memesluna_staged_images).toHaveLength(1)
    expect(await fs.readFile(path.join(root, '.staging', staged.filename), 'utf8')).toBe('source')
  })

  it('追加标注从服务端现有数据合并，返回规范化结果', async () => {
    const { service, tables } = await fixture()
    await service.addLocalImageBuffer('source', Buffer.from('image'), 'a.png')
    tables.memesluna_images[0].tags = '["已有标签"]'
    const results = await Promise.all(['新标签一', '新标签二'].map((tag) => service.updateImageMetadata({ collectionName: 'source', filename: 'a.png', tags: [tag], mode: 'add' })))
    expect(results.every((result) => result.ok)).toBe(true)
    expect(JSON.parse(tables.memesluna_images[0].tags)).toEqual(['已有标签', '新标签一', '新标签二'])
    expect(await service.updateImageMetadata({ collectionName: 'source', filename: 'missing.png', tags: [] })).toMatchObject({ ok: false })
  })

  it('分页返回当前页的标注、总数，支持筛选及特殊字符搜索', async () => {
    const { service } = await fixture()
    await service.addLocalImageBuffer('source', Buffer.from('a'), 'a.png')
    await service.addLocalImageBuffer('source', Buffer.from('b'), 'b.png')
    await service.addLinksToCollection('source', ['https://example.com/c.png'])
    await service.updateImageMetadata({ collectionName: 'source', filename: 'b.png', tags: ['标签'] })
    expect(await service.getCollectionResourcePage('source', { type: 'local', offset: 1, limit: 1 })).toMatchObject({ total: 2, items: [{ filename: 'b.png', tags: ['标签'] }] })
    expect(await service.getCollectionResourcePage('source', { search: 'a.' })).toMatchObject({ total: 1, items: [{ filename: 'a.png' }] })
    expect(await service.getCollectionResourcePage('source', { selected: [] })).toMatchObject({ total: 0, items: [] })
    expect(await service.getCollectionResourcePage('source', { selected: ['b.png', 'https://example.com/c.png'] })).toMatchObject({
      total: 2, items: [{ filename: 'b.png' }, { type: 'external', value: 'https://example.com/c.png' }],
    })
    expect(await service.getCollectionResourcePage('source', { selected: ['a.png', 'https://example.com/c.png'], search: 'example' })).toMatchObject({
      total: 1, items: [{ value: 'https://example.com/c.png' }],
    })
  })
})
