import { createHash, randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { Context, Service, Eval } from 'koishi'
import type { Settings } from './settings'
import type { AIAnnotator } from './aiAnnotator'
import {
  BACKFILL_CONCURRENCY,
  DHASH_BITS,
  DHASH_WIDTH,
  DHASH_HEIGHT,
} from './constants'
import { sanitizeFilename } from './filename'
import { mimeFromFilename } from './image-format'
import { parseJsonStringArray, normalizeMetadataList } from './utils'
import { withStorageLock, removeWithRollback, unusedFilename } from './storage'
import { groupSimilarImages } from './similarity'
import { AnnotationQueue } from './annotation-queue'
import { defineMetaTable, migrateLegacyData } from './migration'
import { MAX_IMAGE_BYTES, MAX_METADATA_ALIASES, MAX_METADATA_TAGS, MAX_METADATA_ITEM_LENGTH } from './constants'
import type { ImageMetadataPayload, ImageMetadataResult, CollectionPageQuery, CollectionResourcePage } from './console-rpc'

/** 有限并发池，按顺序领取任务执行。 */
async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  if (!items.length) return
  let i = 0
  const workers = Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (i < items.length) {
      const item = items[i++]
      await fn(item)
    }
  })
  const results = await Promise.allSettled(workers)
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
}

export const CHATLUNA_MEMES_IMAGES_UPDATED = 'chatluna-memes/images-updated'

export { sanitizeFilename } from './filename'

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.tif',
  '.tiff',
  '.psd',
])

export function hashImageBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

let cachedSharp: any = undefined
let cachedPhoton: any = undefined

export function loadOptionalSharp(): any | null {
  if (cachedSharp !== undefined) return cachedSharp
  try {
    const packageName = 'sharp'
    const sharpModule = require(packageName)
    cachedSharp = sharpModule.default || sharpModule
  } catch {
    cachedSharp = null
  }
  return cachedSharp
}

export function loadPhoton(): any | null {
  if (cachedPhoton !== undefined) return cachedPhoton
  try {
    const packageName = '@cf-wasm/photon/node'
    cachedPhoton = require(packageName)
  } catch {
    cachedPhoton = null
  }
  return cachedPhoton
}

function lumaFromRgba(data: Buffer | Uint8Array, offset: number): number {
  const alpha = data[offset + 3] / 255
  const r = data[offset] * alpha + 255 * (1 - alpha)
  const g = data[offset + 1] * alpha + 255 * (1 - alpha)
  const b = data[offset + 2] * alpha + 255 * (1 - alpha)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function buildDhashFromRgbaPixels(raw: Buffer | Uint8Array): string {
  if (raw.length < DHASH_WIDTH * DHASH_HEIGHT * 4) return ''

  let bits = ''
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    const row = y * DHASH_WIDTH * 4
    for (let x = 0; x < DHASH_WIDTH - 1; x++) {
      const left = lumaFromRgba(raw, row + x * 4)
      const right = lumaFromRgba(raw, row + (x + 1) * 4)
      bits += left > right ? '1' : '0'
    }
  }

  let hex = ''
  for (let i = 0; i < bits.length; i += 4) {
    hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16)
  }
  return hex
}

const RESERVED_PATHS = new Set([
  'config',
  'admin',
  'admin-login',
  'admin-logout',
  'api',
  'css',
  'js',
  'picture',
  'view',
  'project_bg',
  'static',
  'favicon.ico',
])

export function isReservedPath(name: string): boolean {
  return RESERVED_PATHS.has(name) || name.includes('.')
}

const COLLECTION_NAME_REGEXP = /^[^\/\\?%*:|"<>.]+$/
const ENDPOINT_NAME_REGEXP = /^[^\/\\?%*:|"<>.]+$/

export interface ApiEndpoint {
  id: string
  name: string
  group: string
  description: string
  url: string
  method: 'redirect'
  createdAt: Date
  updatedAt: Date
}

export interface ApiEndpointInput {
  name: string
  group?: string
  description?: string
  url: string
  method?: 'redirect'
}

export interface CollectionInfo {
  name: string
  description: string
  totalCount: number
  localCount: number
  linkCount: number
  hasContent: boolean
  createdAt?: Date
  updatedAt?: Date
  cover?: string
}

export interface CollectionResource {
  type: 'local' | 'external'
  filename?: string
  value: string
  public_url?: string
}

export interface StagedImageInfo {
  id: string
  filename: string
  originalName: string
  source: string
  reason: string
  mime: string
  size: number
  createdAt: Date
  hash: string
  perceptualHash: string
}

export interface SimilarStagedImageGroup {
  id: string
  items: StagedImageInfo[]
  similarity: number
}

export interface SimilarStagedImagesResult {
  available: boolean
  threshold: number
  groups: SimilarStagedImageGroup[]
  message: string
}

interface ChatLunaMemesEndpointRow {
  id: string
  name: string
  group: string
  description: string
  url: string
  method: string
  url_construction: string
  model_name: string
  query_params: string
  proxy_settings: string
  created_at: Date
  updated_at: Date
}

interface ChatLunaMemesStagedImageRow {
  id: string
  filename: string
  original_name: string
  source: string
  reason: string
  mime: string
  size: number
  created_at: Date
  hash: string
  perceptual_hash: string
}

const REMOVE_BATCH_SIZE = 500

export interface ChatLunaMemesServiceOptions {
  settings: Settings
  /** 首次启动时是否迁移 memesluna 的数据，见 migrateLegacyData。 */
  migrateLegacyData: boolean
}

export class ChatLunaMemesService extends Service {
  declare config: Settings
  private _readyPromise: Promise<void>
  private _readyResolve: () => void
  private _readyReject: (error: unknown) => void
  private _annotator: AIAnnotator | null = null
  private _disposed = false
  /** 批量和手动标注共享生命周期及进度统计。 */
  private _annotationQueue = new AnnotationQueue()

  constructor(ctx: Context, options: ChatLunaMemesServiceOptions) {
    super(ctx, 'chatluna_memes', true)
    this.config = options.settings
    this.defineDatabase()

    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve
      this._readyReject = reject
    })
    void this._readyPromise.catch(() => {})

    ctx.on('ready', async () => {
      try {
        await withStorageLock(this.getStorageRoot(), async () => {
          // 迁移失败时不继续启动：同步目录会给已复制的图片另建记录，下次重试时就和原记录冲突了。
          await migrateLegacyData(ctx, this.getStorageRoot(), options.migrateLegacyData).catch((error) => {
            ctx.logger('chatluna-memes').error('迁移 memesluna 的数据失败，插件没有启动，排查后重启 Koishi 会重新迁移:', error)
            throw error
          })
          await this.ensureStorage()
        })
        this._readyResolve()
      } catch (error) { this._readyReject(error); throw error }
    })
    ctx.on('dispose', () => { this._disposed = true; this._annotationQueue.dispose(); this._annotator?.dispose() })
  }

  static inject = ['database']

  get ready() {
    return this._readyPromise
  }

  private notifyImagesChanged() {
    ;(this.ctx as any).emit(CHATLUNA_MEMES_IMAGES_UPDATED)
  }

  setAnnotator(annotator: AIAnnotator): void {
    if (this._disposed) { annotator.dispose(); return }
    this._annotator = annotator
  }

  clearAnnotator(annotator: AIAnnotator): void {
    if (this._annotator === annotator) this._annotator = null
  }

  get annotator(): AIAnnotator | null {
    return this._annotator
  }

  /** 上传、偷图和归档后是否自动排队标注。 */
  get autoAnnotate(): boolean {
    return !!this._annotator && this.config.autoAnnotate
  }

  getAnnotationStatus() {
    return { ...this._annotationQueue.stats, requests: this._annotator?.taskStats, usage: this._annotator?.getUsageStats() }
  }

  cancelAnnotations() {
    this._annotationQueue.cancel()
    this._annotator?.cancelPending()
    return true
  }

  async queueAnnotation(rows: any[], options?: {
    force?: boolean
    /** 手动单张标注不等待已排队的批量任务。 */
    immediate?: boolean
    /** 只生成标注交给调用方，不写入数据库（编辑弹窗里由用户确认后再保存）。 */
    onPreview?: (result: { aliases: string[]; tags: string[] }) => void
    onProgress?: (success: number, fail: number) => void | Promise<void>
  }): Promise<{ success: number; fail: number; skipped: number; cancelled: number }> {
    if (!this._annotator || !rows.length) return { success: 0, fail: 0, skipped: 0, cancelled: 0 }
    return this._annotationQueue.enqueue(rows, this.config.aiConcurrency || 2, async (row, signal) => {
      // 排队期间图片可能已移动/删除；始终读取当前记录。
      const stored = row.id ? await this.getImageById(row.id) : null
      if (!stored || stored.type !== 'local') return 'skipped'
      if (!options?.force && (parseJsonStringArray(stored.aliases).length || parseJsonStringArray(stored.tags).length)) return 'skipped'
      if (signal.aborted) return 'cancelled'
      const image = await this.getLocalImageBuffer(stored.collection, stored.filename)
      if (!image) return 'fail'
      if (signal.aborted) return 'cancelled'
      const result = await this._annotator!.annotate(image.buffer, {
        filename: stored.filename, collectionName: stored.collection,
        imageUrl: `${this.config.backendPath}/${encodeURIComponent(stored.collection)}/${encodeURIComponent(stored.filename)}`,
      })
      if (signal.aborted) return 'cancelled'
      if (!result) return 'fail'
      if (options?.onPreview) {
        options.onPreview(result)
        return 'success'
      }
      return await this.updateImageAnnotation(stored.id, result.aliases, result.tags) ? 'success' : 'skipped'
    }, options?.onProgress, (error) => this.ctx.logger('chatluna-memes').warn('Annotation task failed:', error), options?.immediate)
  }


  private defineDatabase() {
    defineMetaTable(this.ctx)
    this.ctx.database.extend(
      'chatluna_memes_endpoints',
      {
        id: 'string',
        name: 'string',
        group: 'string',
        description: 'string',
        url: 'string',
        method: 'string',
        url_construction: 'string',
        model_name: 'string',
        query_params: 'string',
        proxy_settings: 'string',
        created_at: 'timestamp',
        updated_at: 'timestamp',
      },
      {
        primary: 'id',
        unique: ['name'],
      }
    )

    this.ctx.database.extend(
      'chatluna_memes_images',
      {
        id: 'string',
        collection: 'string',
        index: 'integer',
        filename: 'string',
        type: 'string',
        value: 'string',
        public_url: 'string',
        mime: 'string',
        hash: 'string',
        perceptual_hash: 'string',
        aliases: { type: 'string', initial: '[]' },
        tags: { type: 'string', initial: '[]' },
        created_at: 'timestamp',
      },
      {
        primary: 'id',
        unique: [['collection', 'index']],
        indexes: ['hash', 'collection', 'perceptual_hash'],
      }
    )



    this.ctx.database.extend(
      'chatluna_memes_staged_images',
      {
        id: 'string',
        filename: 'string',
        original_name: 'string',
        source: 'string',
        reason: 'string',
        mime: 'string',
        size: 'integer',
        hash: 'string',
        perceptual_hash: 'string',
        created_at: 'timestamp',
      },
      {
        primary: 'id',
        unique: ['filename'],
        indexes: ['hash'],
      }
    )
  }

  private getStorageRoot() {
    return path.resolve(this.ctx.baseDir, 'data/chatluna-memes')
  }

  private getStagingDir() {
    return path.join(this.getStorageRoot(), '.staging')
  }

  private async syncExistingFilesToDatabase() {
    const root = this.getStorageRoot()
    let folders: string[] = []
    try {
      const entries = await fs.readdir(root, { withFileTypes: true })
      folders = entries.filter((e) => e.isDirectory() && this.isValidCollectionName(e.name)).map((e) => e.name)
    } catch {
      return
    }

    const foldersSet = new Set(folders)
    try {
      const allDbImages = await this.ctx.database.get('chatluna_memes_images', {}, ['collection'])
      const dbCollections = new Set(allDbImages.map((img) => img.collection))
      const missingCollections = Array.from(dbCollections).filter((col) => !foldersSet.has(col))
      if (missingCollections.length > 0) {
        await this.ctx.database.remove('chatluna_memes_images', { collection: missingCollections })
      }
    } catch (err) {
      this.ctx.logger('chatluna-memes').warn('Failed to cleanup missing collections from database:', err)
    }

    await mapPool(folders, BACKFILL_CONCURRENCY, async (colName) => {
      const colDir = this.getCollectionDir(colName)
      let files: string[] = []
      try {
        const entries = await fs.readdir(colDir, { withFileTypes: true })
        files = entries.filter((e) => e.isFile() && this.isImageFile(e.name)).map((e) => e.name)
      } catch {
        return
      }

      const existingImages = await this.ctx.database.get('chatluna_memes_images', { collection: colName })
      const existingFilenames = new Set(existingImages.map((img) => img.filename))
      const existingExternalValues = new Set(
        existingImages.filter((img) => img.type === 'external').map((img) => img.value)
      )
      const existingIndices = new Set(existingImages.map((img) => img.index))
      let maxIndex = existingImages.reduce((max, img) => Math.max(max, img.index), 0)

      const physicalFilenames = new Set<string>()
      for (const filename of files) {
        const safeName = sanitizeFilename(filename)
        let currentName = filename

        // 初始化重命名也必须避免覆盖已经存在的文件，并保留原记录标注。
        const legacy = existingImages.find((img) => img.type !== 'external' && img.filename === filename)
        if (safeName !== filename) {
          const availableName = await unusedFilename(colDir, safeName, async (candidate) => existingFilenames.has(candidate))
          const oldPath = path.join(colDir, filename)
          const newPath = path.join(colDir, availableName)
          await fs.copyFile(oldPath, newPath, (await import('fs')).constants.COPYFILE_EXCL)
          try {
            await removeWithRollback(root, oldPath, async () => {
              if (legacy) await this.ctx.database.set('chatluna_memes_images', { id: legacy.id }, { filename: availableName, value: availableName, type: 'local' })
            })
          } catch (error) { await fs.unlink(newPath); throw error }
          currentName = availableName
          if (legacy) { existingFilenames.delete(filename); Object.assign(legacy, { filename: currentName, value: currentName, type: 'local' }); existingFilenames.add(currentName) }
        }
        physicalFilenames.add(currentName)

        // 更早版本的记录 type 可能不是 local，有本地文件时修正，否则 tagall 等只处理本地图片的操作会漏掉它们。
        const existing = existingImages.find((img) => img.filename === currentName)
        if (existing) {
          if (existing.type !== 'external' && (existing.type !== 'local' || existing.value !== currentName)) {
            try {
              await this.ctx.database.set('chatluna_memes_images', { id: existing.id }, {
                type: 'local',
                value: currentName,
                mime: this.getMimeByFilename(currentName),
              })
            } catch {}
          }
          continue
        }

        if (!existingFilenames.has(currentName)) {
          const index = ++maxIndex
          try {
            await this.ctx.database.create('chatluna_memes_images', {
              id: randomUUID(),
              collection: colName,
              index,
              filename: currentName,
              type: 'local',
              value: currentName,
              mime: this.getMimeByFilename(currentName),
              hash: '',
              perceptual_hash: '',
              created_at: new Date(),
            })
            existingFilenames.add(currentName)
          } catch {}
        }
      }

      const filesSet = physicalFilenames
      const missingLocalImages = existingImages.filter(
        (img) => img.type === 'local' && !filesSet.has(img.value || img.filename)
      )
      // SQLite 驱动（sql.js）遇到上千项的 IN 查询会在 wasm 里越界崩溃，所以分批删除。
      for (let i = 0; i < missingLocalImages.length; i += REMOVE_BATCH_SIZE) {
        await this.ctx.database.remove('chatluna_memes_images', {
          id: missingLocalImages.slice(i, i + REMOVE_BATCH_SIZE).map((img) => img.id),
        })
      }

      // 更早版本把外链存在表情包目录的清单文件里，导入数据库后删除该文件。
      const linksFile = this.getCollectionLinksFile(colName)
      try {
        const text = await fs.readFile(linksFile, 'utf8')
        const links = text
          .split(/\r?\n/g)
          .map((line) => line.trim())
          .filter((line) => line.startsWith('http://') || line.startsWith('https://'))

        for (const link of links) {
          if (!existingExternalValues.has(link)) {
            const index = ++maxIndex
            await this.ctx.database.create('chatluna_memes_images', {
              id: randomUUID(),
              collection: colName,
              index,
              filename: `link_${index}`,
              type: 'external',
              value: link,
              mime: 'image/jpeg',
              hash: '',
              perceptual_hash: '',
              created_at: new Date(),
            })
            existingExternalValues.add(link)
            existingIndices.add(index)
          }
        }
        await fs.rm(linksFile, { force: true })
      } catch {}
    })
  }

  private async ensureStorage() {
    await fs.mkdir(this.getStorageRoot(), { recursive: true })
    await fs.mkdir(this.getStagingDir(), { recursive: true })
    await this.syncExistingFilesToDatabase()
    Promise.all([
      this.backfillImagesFingerprints(),
      this.backfillStagedFingerprints()
    ]).catch((err) => {
      this.ctx.logger('chatluna-memes').warn('Failed to backfill image fingerprints in background:', err)
    })
  }

  private async getImagePerceptualHash(buffer: Buffer): Promise<string> {
    const photon = loadPhoton()
    if (photon) {
      let inputImage: any | null = null
      let resizedImage: any | null = null
      try {
        inputImage = photon.PhotonImage.new_from_byteslice(new Uint8Array(buffer))
        resizedImage = photon.resize(inputImage, DHASH_WIDTH, DHASH_HEIGHT, photon.SamplingFilter.Nearest)
        const hash = buildDhashFromRgbaPixels(resizedImage.get_raw_pixels())
        if (hash) return hash
      } catch (error) {
        this.ctx.logger('chatluna-memes').debug(`Failed to calculate perceptual hash with photon: ${(error as Error).message}`)
      } finally {
        try {
          resizedImage?.free?.()
        } catch {}
        try {
          inputImage?.free?.()
        } catch {}
      }
    }

    const sharp = loadOptionalSharp()
    if (!sharp) return ''

    try {
      const raw = await sharp(buffer, { animated: false, failOn: 'none' })
        .resize(9, 8, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer()

      if (raw.length < 72) return ''

      let bits = ''
      for (let y = 0; y < 8; y++) {
        const row = y * 9
        for (let x = 0; x < 8; x++) {
          bits += raw[row + x] > raw[row + x + 1] ? '1' : '0'
        }
      }

      let hex = ''
      for (let i = 0; i < bits.length; i += 4) {
        hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16)
      }
      return hex
    } catch (error) {
      this.ctx.logger('chatluna-memes').debug(`Failed to calculate perceptual hash: ${(error as Error).message}`)
      return ''
    }
  }

  private async getImageFingerprints(buffer: Buffer): Promise<{ hash: string; perceptual_hash: string }> {
    return {
      hash: hashImageBuffer(buffer),
      perceptual_hash: await this.getImagePerceptualHash(buffer),
    }
  }

  private async getImageRowBuffer(row: any): Promise<Buffer | null> {
    if (row.type === 'local') {
      try {
        return await fs.readFile(path.join(this.getCollectionDir(row.collection), row.value || row.filename))
      } catch {
        return null
      }
    }

    return null
  }

  private async backfillImagesFingerprints() {
    const images = await this.ctx.database.get('chatluna_memes_images', {
      $or: [
        { hash: '' },
        { hash: { $exists: false } },
        { perceptual_hash: '' },
        { perceptual_hash: { $exists: false } }
      ]
    })
    let updated = 0
    await mapPool(images, BACKFILL_CONCURRENCY, async (row) => {
      if (row.hash && row.perceptual_hash) return
      const buffer = await this.getImageRowBuffer(row)
      if (!buffer) {
        if (!row.hash || row.perceptual_hash === undefined) {
          await this.ctx.database.set('chatluna_memes_images', { id: row.id }, {
            hash: row.hash || '',
            perceptual_hash: row.perceptual_hash || '',
          })
          updated++
        }
        return
      }
      await this.ctx.database.set('chatluna_memes_images', { id: row.id }, await this.getImageFingerprints(buffer))
      updated++
    })
    if (updated > 0) {
      this.ctx.logger('chatluna-memes').debug(`backfillImagesFingerprints updated ${updated} rows`)
    }
  }

  private async backfillStagedFingerprints() {
    const stagedRows = await this.ctx.database.get('chatluna_memes_staged_images', {
      $or: [
        { hash: '' },
        { hash: { $exists: false } },
        { perceptual_hash: '' },
        { perceptual_hash: { $exists: false } }
      ]
    })
    let updated = 0
    await mapPool(stagedRows, BACKFILL_CONCURRENCY, async (row) => {
      if (row.hash && row.perceptual_hash) return
      try {
        const buffer = await fs.readFile(this.resolveStagedImagePath(row.filename))
        await this.ctx.database.set('chatluna_memes_staged_images', { id: row.id }, await this.getImageFingerprints(buffer))
        updated++
      } catch {
        await this.ctx.database.set('chatluna_memes_staged_images', { id: row.id }, {
          hash: row.hash || '',
          perceptual_hash: row.perceptual_hash || '',
        })
        updated++
      }
    })
    if (updated > 0) {
      this.ctx.logger('chatluna-memes').debug(`backfillStagedFingerprints updated ${updated} rows`)
    }
  }

  async getDuplicateImageByHash(
    hash: string,
    options: { includeStaged?: boolean; includeImages?: boolean; ignoreStagedId?: string; collection?: string } = {}
  ): Promise<string | null> {
    if (!hash) return null

    const includeStaged = options.includeStaged ?? true
    const includeImages = options.includeImages ?? true

    if (includeStaged) {
      const stagedRows = await this.ctx.database.get('chatluna_memes_staged_images', { hash })
      for (const staged of stagedRows) {
        if (staged.id === options.ignoreStagedId) continue
        try {
          const fullPath = this.resolveStagedImagePath(staged.filename)
          await fs.access(fullPath)
          return `待审区/${staged.original_name || staged.filename}`
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await this.ctx.database.remove('chatluna_memes_staged_images', { id: staged.id })
        }
      }
    }

    if (includeImages) {
      const query: any = { hash }
      if (options.collection) {
        query.collection = options.collection
      }
      const imageRows = await this.ctx.database.get('chatluna_memes_images', query)
      for (const image of imageRows) {
        if (image.type === 'local') {
          try {
            const fullPath = this.resolveLocalImagePath(image.collection, image.value)
            await fs.access(fullPath)
            return `${image.collection}/${image.filename}`
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            await this.ctx.database.remove('chatluna_memes_images', { id: image.id })
            this.notifyImagesChanged()
          }
        } else {
          return `${image.collection}/${image.filename}`
        }
      }
    }

    return null
  }

  private async getExistingImageRowByHash(hash: string, collectionName: string): Promise<any | null> {
    if (!hash) return null

    const rows = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName, hash })
    for (const row of rows) {
      if (row.type === 'local') {
        try {
          await fs.access(this.resolveLocalImagePath(row.collection, row.value || row.filename))
          return row
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await this.ctx.database.remove('chatluna_memes_images', { id: row.id })
          this.notifyImagesChanged()
        }
      } else {
        return row
      }
    }

    return null
  }

  async getSimilarStagedImages(threshold = this.config.similarityThreshold || 0.9): Promise<SimilarStagedImagesResult> {
    const normalizedThreshold = Math.min(1, Math.max(0.5, Number(threshold) || 0.9))
    await this.backfillStagedFingerprints()
    const rows = await this.ctx.database.get('chatluna_memes_staged_images', {})
    const items = rows
      .map((row) => this.mapStagedImage(row as ChatLunaMemesStagedImageRow))
      .filter((item) => item.perceptualHash)

    if (!items.length) {
      return {
        available: true,
        threshold: normalizedThreshold,
        groups: [],
        message: rows.length ? '待审区图片暂未生成可比较的感知哈希' : '待审区暂无图片',
      }
    }

    const groups = groupSimilarImages(items, normalizedThreshold)
      .map((group) => ({
        id: `similar-${group.items[0].id}`,
        ...group,
      }))
      .sort((a, b) => b.items.length - a.items.length || b.similarity - a.similarity)

    return {
      available: true,
      threshold: normalizedThreshold,
      groups,
      message: groups.length ? `找到 ${groups.length} 组相似图片` : '待审区没有达到阈值的相似图片',
    }
  }
  private isValidCollectionName(name: string): boolean {
    return !!name && COLLECTION_NAME_REGEXP.test(name) && !isReservedPath(name)
  }

  private ensureCollectionName(name: string) {
    if (!this.isValidCollectionName(name)) {
      throw new Error('Invalid collection name: special characters like /\\?%*:|"<>. are not allowed.')
    }
  }

  private ensureEndpointName(name: string) {
    if (!name || !ENDPOINT_NAME_REGEXP.test(name)) {
      throw new Error('Invalid endpoint name: special characters like /\\?%*:|"<>. are not allowed.')
    }
    if (isReservedPath(name)) {
      throw new Error('Endpoint name is a reserved path.')
    }
  }

  private getCollectionDir(collectionName: string) {
    return path.join(this.getStorageRoot(), collectionName)
  }

  private getCollectionLinksFile(collectionName: string) {
    return path.join(this.getCollectionDir(collectionName), `${collectionName}.txt`)
  }

  private getCollectionDescriptionFile(collectionName: string) {
    return path.join(this.getCollectionDir(collectionName), '.description')
  }

  async getCollectionDescription(collectionName: string): Promise<string> {
    if (!this.isValidCollectionName(collectionName)) {
      return ''
    }
    try {
      return (await fs.readFile(this.getCollectionDescriptionFile(collectionName), 'utf8')).trim()
    } catch {
      return ''
    }
  }

  async setCollectionDescription(collectionName: string, description: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.setCollectionDescriptionUnlocked(collectionName, description))
  }

  private async setCollectionDescriptionUnlocked(collectionName: string, description: string): Promise<boolean> {
    this.ensureCollectionName(collectionName)
    if (!(await this.collectionExists(collectionName))) {
      return false
    }
    await fs.writeFile(this.getCollectionDescriptionFile(collectionName), description.trim(), 'utf8')
    this.notifyImagesChanged()
    return true
  }

  async renameCollection(collectionName: string, newName: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.renameCollectionUnlocked(collectionName, newName))
  }

  private async renameCollectionUnlocked(collectionName: string, newName: string): Promise<boolean> {
    this.ensureCollectionName(collectionName)
    this.ensureCollectionName(newName)
    if (collectionName === newName) return true
    if (!(await this.collectionExists(collectionName))) return false
    if (await this.collectionExists(newName)) throw new Error(`已经有叫「${newName}」的表情包了`)
    if (await this.getEndpointByName(newName)) throw new Error(`「${newName}」已被外部图源占用`)

    const oldDir = this.getCollectionDir(collectionName)
    const newDir = this.getCollectionDir(newName)
    await fs.rename(oldDir, newDir)
    // 尚未导入的旧版外链清单文件以表情包名命名，需要跟着改名。
    const oldLinksFile = path.join(newDir, `${collectionName}.txt`)
    const linksRenamed = await fs.rename(oldLinksFile, this.getCollectionLinksFile(newName)).then(() => true, () => false)
    try {
      await this.ctx.database.set('chatluna_memes_images', { collection: collectionName }, { collection: newName })
    } catch (error) {
      if (linksRenamed) await fs.rename(this.getCollectionLinksFile(newName), oldLinksFile)
      await fs.rename(newDir, oldDir)
      throw error
    }
    this.notifyImagesChanged()
    return true
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    if (!this.isValidCollectionName(collectionName)) {
      return false
    }
    const dir = this.getCollectionDir(collectionName)
    try {
      const stat = await fs.stat(dir)
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  async getCollections(): Promise<string[]> {
    const root = this.getStorageRoot()
    try {
      const entries = await fs.readdir(root, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory() && this.isValidCollectionName(e.name))
        .map((e) => e.name)
        .sort()
    } catch {
      return []
    }
  }

  async createCollection(collectionName: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.createCollectionUnlocked(collectionName))
  }

  private async createCollectionUnlocked(collectionName: string): Promise<boolean> {
    this.ensureCollectionName(collectionName)
    if (await this.getEndpointByName(collectionName)) {
      throw new Error(`Collection name conflicts with existing endpoint: ${collectionName}`)
    }
    const dir = this.getCollectionDir(collectionName)
    try {
      await fs.mkdir(dir)
      this.notifyImagesChanged()
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false
      }
      throw error
    }
  }

  async deleteCollection(collectionName: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.deleteCollectionUnlocked(collectionName))
  }

  private async deleteCollectionUnlocked(collectionName: string): Promise<boolean> {
    this.ensureCollectionName(collectionName)
    if (!(await this.collectionExists(collectionName))) return false
    // 文件或数据库失败需要让调用方看到真实错误，而不是当作“不存在”。
    await removeWithRollback(this.getStorageRoot(), this.getCollectionDir(collectionName),
      () => this.ctx.database.remove('chatluna_memes_images', { collection: collectionName }))
    this.notifyImagesChanged()
    return true
  }

  private isImageFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase()
    return IMAGE_EXTENSIONS.has(ext)
  }

  private ensureSafeImageFilename(filename: string): string {
    const normalized = path.basename(filename || '')
    if (!filename || normalized !== filename || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid image filename')
    }
    if (!this.isImageFile(normalized)) {
      throw new Error('Invalid image filename')
    }
    return normalized
  }

  private getMimeByFilename(filename: string): string {
    return mimeFromFilename(filename)
  }

  private mapStagedImage(row: ChatLunaMemesStagedImageRow): StagedImageInfo {
    return {
      id: row.id,
      filename: row.filename,
      originalName: row.original_name || '',
      source: row.source || '',
      reason: row.reason || '',
      mime: row.mime || this.getMimeByFilename(row.filename),
      size: row.size || 0,
      createdAt: row.created_at,
      hash: row.hash || '',
      perceptualHash: row.perceptual_hash || '',
    }
  }

  private resolveLocalImagePath(collectionName: string, filename: string): string {
    const safeName = this.ensureSafeImageFilename(filename)
    return path.join(this.getCollectionDir(collectionName), safeName)
  }

  async getLocalImageBuffer(
    collectionName: string,
    filename: string
  ): Promise<{ buffer: Buffer; mime: string } | null> {
    if (!(await this.collectionExists(collectionName))) {
      return null
    }

    const rows = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName, filename })
    if (!rows.length) {
      return null
    }

    const image = rows[0]
    if (image.type === 'external') {
      try {
        const buffer = await this.ctx.http.get<ArrayBuffer>(image.value, { responseType: 'arraybuffer' })
        return { buffer: Buffer.from(buffer), mime: image.mime }
      } catch {
        return null
      }
    }

    let fullPath: string
    try {
      fullPath = this.resolveLocalImagePath(collectionName, image.value)
    } catch {
      return null
    }

    try {
      const buffer = await fs.readFile(fullPath)
      return {
        buffer,
        mime: image.mime,
      }
    } catch {
      return null
    }
  }

  async addLinksToCollection(collectionName: string, links: string[]): Promise<number> {
    return withStorageLock(this.getStorageRoot(), () => this.addLinksToCollectionUnlocked(collectionName, links))
  }

  private async addLinksToCollectionUnlocked(collectionName: string, links: string[]): Promise<number> {
    this.ensureCollectionName(collectionName)
    if (!(await this.collectionExists(collectionName))) {
      throw new Error(`Collection not found: ${collectionName}`)
    }

    const normalized = links
      .map((link) => link.trim())
      .filter((link) => link.startsWith('http://') || link.startsWith('https://'))

    if (!normalized.length) {
      return 0
    }

    const existingImages = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName })
    const existingExternalValues = new Set(
      existingImages.filter((img) => img.type === 'external').map((img) => img.value)
    )
    let maxIndex = existingImages.reduce((max, img) => Math.max(max, img.index), 0)

    let addedCount = 0
    for (const link of normalized) {
      if (!existingExternalValues.has(link)) {
        const index = ++maxIndex
        await this.ctx.database.create('chatluna_memes_images', {
          id: randomUUID(),
          collection: collectionName,
          index,
          filename: `link_${index}`,
          type: 'external',
          value: link,
          mime: 'image/jpeg',
          hash: '',
          perceptual_hash: '',
          created_at: new Date(),
        })
        existingExternalValues.add(link)
        addedCount++
      }
    }
    if (addedCount > 0) this.notifyImagesChanged()
    return addedCount
  }

  async removeLinkFromCollection(collectionName: string, link: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.removeLinkFromCollectionUnlocked(collectionName, link))
  }

  private async removeLinkFromCollectionUnlocked(collectionName: string, link: string): Promise<boolean> {
    this.ensureCollectionName(collectionName)
    if (!(await this.collectionExists(collectionName))) {
      return false
    }

    const existing = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName, value: link, type: 'external' })
    if (!existing.length) {
      return false
    }

    await this.ctx.database.remove('chatluna_memes_images', { collection: collectionName, value: link, type: 'external' })
    this.notifyImagesChanged()
    return true
  }

  /** 把外链连同标注移到另一个表情包；目标已有同一外链时合并两边的标注。 */
  async moveLinkToCollection(sourceCollection: string, targetCollection: string, link: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), async () => {
      this.ensureCollectionName(sourceCollection)
      this.ensureCollectionName(targetCollection)
      if (sourceCollection === targetCollection) return false
      if (!(await this.collectionExists(sourceCollection)) || !(await this.collectionExists(targetCollection))) return false
      const [row] = await this.ctx.database.get('chatluna_memes_images', { collection: sourceCollection, value: link, type: 'external' })
      if (!row) return false
      const [existing] = await this.ctx.database.get('chatluna_memes_images', { collection: targetCollection, value: link, type: 'external' })
      if (existing) {
        const merge = (a: string, b: string, max: number) => JSON.stringify(normalizeMetadataList(
          [...parseJsonStringArray(a), ...parseJsonStringArray(b)], max, MAX_METADATA_ITEM_LENGTH,
        ))
        await this.ctx.database.set('chatluna_memes_images', { id: existing.id }, {
          aliases: merge(existing.aliases, row.aliases, MAX_METADATA_ALIASES),
          tags: merge(existing.tags, row.tags, MAX_METADATA_TAGS),
        })
        await this.ctx.database.remove('chatluna_memes_images', { id: row.id })
      } else {
        const [last] = await this.ctx.database.get('chatluna_memes_images', { collection: targetCollection }, { limit: 1, sort: { index: 'desc' } })
        const index = (last?.index ?? 0) + 1
        await this.ctx.database.set('chatluna_memes_images', { id: row.id }, {
          collection: targetCollection,
          index,
          filename: await this.deduplicateDatabaseFilename(targetCollection, `link_${index}`),
        })
      }
      this.notifyImagesChanged()
      return true
    })
  }

  private detectExtFromDataUrl(dataUrl: string): string {
    const matched = /^data:image\/([a-zA-Z0-9+.-]+);base64,/i.exec(dataUrl)
    const ext = matched?.[1]?.toLowerCase()
    if (!ext) return 'png'
    if (ext === 'jpeg') return 'jpg'
    return ext
  }

  private normalizeBase64(input: string): { base64: string; extHint?: string } {
    const trimmed = input.trim()
    if (trimmed.startsWith('data:')) {
      const extHint = this.detectExtFromDataUrl(trimmed)
      const index = trimmed.indexOf(',')
      return {
        base64: index >= 0 ? trimmed.slice(index + 1) : trimmed,
        extHint,
      }
    }
    return { base64: trimmed }
  }

  private isAvifBuffer(buffer: Buffer): boolean {
    return buffer.length >= 12 && buffer.toString('ascii', 4, 12) === 'ftypavif'
  }

  private buildStagedFilename(originalName: string | undefined, extHint: string | undefined): string {
    const src = (originalName ?? '').trim()
    const rawExt = (path.parse(src).ext || (extHint ? `.${extHint}` : '') || '.png').toLowerCase()
    const normalizedExt = rawExt === '.jpeg' ? '.jpg' : rawExt
    const finalExt = IMAGE_EXTENSIONS.has(normalizedExt) ? normalizedExt : '.png'
    return `${Date.now()}-${randomUUID()}${finalExt}`
  }

  private resolveStagedImagePath(filename: string): string {
    return path.join(this.getStagingDir(), this.ensureSafeImageFilename(filename))
  }

  private async deduplicateDatabaseFilename(collectionName: string, filename: string): Promise<string> {
    return unusedFilename(this.getCollectionDir(collectionName), filename, async (candidate) => {
      const rows = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName, filename: candidate })
      return rows.length > 0
    })
  }


  async addLocalImageBuffer(collectionName: string, buffer: Buffer, originalName?: string, extHint?: string): Promise<{ id: string; filename: string; created?: boolean }> {
    return withStorageLock(this.getStorageRoot(), () => this.addLocalImageBufferUnlocked(collectionName, buffer, originalName, extHint))
  }

  private async addLocalImageBufferUnlocked(
    collectionName: string,
    buffer: Buffer,
    originalName?: string,
    extHint?: string
  ): Promise<{ id: string; filename: string; created?: boolean }> {
    this.ensureCollectionName(collectionName)
    if (!(await this.collectionExists(collectionName))) {
      throw new Error(`Collection not found: ${collectionName}`)
    }

    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('Invalid image payload: maximum size is 50MB')
    }

    const rawExt = (path.parse(originalName ?? '').ext || (extHint ? `.${extHint}` : '') || '.png').toLowerCase()
    const finalExt = rawExt === '.jpeg' ? '.jpg' : rawExt
    if (!IMAGE_EXTENSIONS.has(finalExt)) throw new Error('Unsupported image format')

    const fingerprints = await this.getImageFingerprints(buffer)
    const duplicate = await this.getExistingImageRowByHash(fingerprints.hash, collectionName)
    if (duplicate) return { id: duplicate.id, filename: duplicate.filename, created: false }
    const maxImg = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName }, { limit: 1, sort: { index: 'desc' } })
    const index = maxImg.length ? maxImg[0].index + 1 : 1

    const baseName = originalName ? path.basename(originalName, path.extname(originalName)) : `image-${Date.now()}`
    const safeBase = sanitizeFilename(`${baseName}${finalExt}`)
    const finalName = await this.deduplicateDatabaseFilename(collectionName, safeBase)

    const id = randomUUID()
    const dir = this.getCollectionDir(collectionName)
    const destination = path.join(dir, finalName)
    await fs.writeFile(destination, buffer, { flag: 'wx' })
    try {
      await this.ctx.database.create('chatluna_memes_images', {
      id,
      collection: collectionName,
      index,
      filename: finalName,
      type: 'local',
      value: finalName,
      mime: this.getMimeByFilename(finalName),
      ...fingerprints,
      aliases: '[]',
      tags: '[]',
      created_at: new Date(),
    })
    } catch (error) {
      await fs.unlink(destination)
      throw error
    }
    this.notifyImagesChanged()

    return { id, filename: finalName, created: true }
  }



  async getCollectionResourcePage(collectionName: string, input: CollectionPageQuery = {}): Promise<CollectionResourcePage> {
    this.ensureCollectionName(collectionName)
    const limit = Math.max(1, Math.min(100, Math.floor(Number(input.limit) || 24)))
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
    if (!Number.isFinite(offset)) throw new Error('Invalid page offset')
    const query: any = { collection: collectionName }
    if (input.type === 'local' || input.type === 'external') query.type = input.type
    const conditions: any[] = []
    if (input.selected !== undefined) {
      if (!Array.isArray(input.selected) || input.selected.length > 5000 || input.selected.some((item) => typeof item !== 'string')) throw new Error('Invalid selection')
      if (!input.selected.length) return { items: [], total: 0, offset, limit }
      // 前端用本地图片的文件名、外链的地址作为选择标识。
      conditions.push({ $or: [{ type: 'local', filename: input.selected }, { type: 'external', value: input.selected }] })
    }
    const search = typeof input.search === 'string' ? input.search.trim().slice(0, 200) : ''
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      conditions.push({ $or: [{ filename: { $regex: pattern } }, { value: { $regex: pattern } }] })
    }
    if (conditions.length === 1) Object.assign(query, conditions[0])
    else if (conditions.length) query.$and = conditions
    const total = await this.ctx.database.eval('chatluna_memes_images', (row) => Eval.count(row.id), query)
    const rows = await this.ctx.database.get('chatluna_memes_images', query, {
      limit, offset, sort: { filename: input.sort === 'nameDesc' ? 'desc' : 'asc', id: 'asc' },
    })
    return {
      total, offset, limit,
      items: rows.map((row) => ({
        id: row.id, type: row.type === 'external' ? 'external' : 'local', filename: row.filename,
        value: row.type === 'external' ? row.value : row.filename,
        tags: parseJsonStringArray(row.tags), aliases: parseJsonStringArray(row.aliases),
      })),
    }
  }

  async updateImageMetadata(payload: ImageMetadataPayload): Promise<ImageMetadataResult> {
    return withStorageLock(this.getStorageRoot(), async () => {
      const { collectionName, filename, mode = 'replace' } = payload
      this.ensureCollectionName(collectionName)
      if (!filename || !['replace', 'add'].includes(mode)) return { ok: false, error: '参数不完整' }
      for (const list of [payload.aliases, payload.tags]) {
        if (list !== undefined && (!Array.isArray(list) || list.some((item) => typeof item !== 'string'))) return { ok: false, error: '标注必须为字符串数组' }
      }
      const rows = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName, filename })
      if (!rows.length) return { ok: false, error: '图片不存在' }
      const row = rows[0]
      const merge = (existing: string, incoming: string[] | undefined, max: number) => normalizeMetadataList(
        incoming === undefined ? parseJsonStringArray(existing)
          : mode === 'add' ? [...parseJsonStringArray(existing), ...incoming] : incoming,
        max, MAX_METADATA_ITEM_LENGTH,
      )
      const aliases = merge(row.aliases, payload.aliases, MAX_METADATA_ALIASES)
      const tags = merge(row.tags, payload.tags, MAX_METADATA_TAGS)
      await this.ctx.database.set('chatluna_memes_images', { id: row.id }, { aliases: JSON.stringify(aliases), tags: JSON.stringify(tags) })
      this.notifyImagesChanged()
      return { ok: true, aliases, tags }
    })
  }

  async getImageById(id: string) {
    const rows = await this.ctx.database.get('chatluna_memes_images', { id })
    return rows[0] ?? null
  }

  async updateImageAnnotation(id: string, aliases?: string[], tags?: string[]): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.updateImageAnnotationUnlocked(id, aliases, tags))
  }

  private async updateImageAnnotationUnlocked(id: string, aliases?: string[], tags?: string[]): Promise<boolean> {
    const row = await this.getImageById(id)
    if (!row) return false
    const update: any = {}
    if (aliases !== undefined) update.aliases = JSON.stringify(aliases)
    if (tags !== undefined) update.tags = JSON.stringify(tags)
    await this.ctx.database.set('chatluna_memes_images', { id }, update)
    this.notifyImagesChanged()
    return true
  }


  async addStagedImageBuffer(buffer: Buffer, originalName?: string, source = 'filter', reason = ''): Promise<StagedImageInfo> {
    return withStorageLock(this.getStorageRoot(), () => this.addStagedImageBufferUnlocked(buffer, originalName, source, reason))
  }

  private async addStagedImageBufferUnlocked(
    buffer: Buffer,
    originalName?: string,
    source = 'filter',
    reason = ''
  ): Promise<StagedImageInfo> {
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('Invalid image payload: maximum size is 50MB')
    }

    if (this.isAvifBuffer(buffer) || path.extname(originalName ?? '').toLowerCase() === '.avif') {
      throw new Error('AVIF images are not staged. Convert to JPG/PNG/GIF/WEBP first.')
    }

    const fingerprints = await this.getImageFingerprints(buffer)
    const duplicate = await this.getDuplicateImageByHash(fingerprints.hash, { includeStaged: true, includeImages: true })
    if (duplicate) {
      throw new Error('Duplicate image already exists: ' + duplicate)
    }

    const extHint = path.parse(originalName ?? '').ext.replace('.', '') || undefined
    const filename = this.buildStagedFilename(originalName, extHint)
    const mime = this.getMimeByFilename(filename)
    const targetPath = this.resolveStagedImagePath(filename)
    const now = new Date()

    await fs.mkdir(this.getStagingDir(), { recursive: true })
    await fs.writeFile(targetPath, buffer, { flag: 'wx' })

    const row = {
      id: randomUUID(),
      filename,
      original_name: originalName || filename,
      source: source || 'filter',
      reason: reason || '',
      mime,
      size: buffer.length,
      ...fingerprints,
      created_at: now,
    }

    try {
      await this.ctx.database.create('chatluna_memes_staged_images', row)
    } catch (error) {
      await fs.unlink(targetPath)
      throw error
    }
    return this.mapStagedImage(row)
  }

  async addStagedImageBase64(
    base64Data: string,
    originalName?: string,
    source = 'filter',
    reason = ''
  ): Promise<StagedImageInfo> {
    const { base64, extHint } = this.normalizeBase64(base64Data)
    if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('Image exceeds 50MB limit')
    const buffer = Buffer.from(base64, 'base64')
    const name = originalName || (extHint ? `filtered.${extHint}` : undefined)
    return this.addStagedImageBuffer(buffer, name, source, reason)
  }

  async getStagedImages(): Promise<StagedImageInfo[]> {
    const rows = await this.ctx.database.get('chatluna_memes_staged_images', {})
    return rows
      .map((row) => this.mapStagedImage(row as ChatLunaMemesStagedImageRow))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  async getStagedImageBuffer(id: string): Promise<{ buffer: Buffer; mime: string; filename: string } | null> {
    const rows = await this.ctx.database.get('chatluna_memes_staged_images', { id })
    if (!rows.length) return null
    const row = rows[0] as ChatLunaMemesStagedImageRow

    try {
      const buffer = await fs.readFile(this.resolveStagedImagePath(row.filename))
      return { buffer, mime: row.mime || this.getMimeByFilename(row.filename), filename: row.filename }
    } catch {
      return null
    }
  }

  async deleteStagedImage(id: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.deleteStagedImageUnlocked(id))
  }

  private async deleteStagedImageUnlocked(id: string): Promise<boolean> {
    const rows = await this.ctx.database.get('chatluna_memes_staged_images', { id })
    if (!rows.length) return false
    const row = rows[0] as ChatLunaMemesStagedImageRow

    await removeWithRollback(this.getStorageRoot(), this.resolveStagedImagePath(row.filename),
      () => this.ctx.database.remove('chatluna_memes_staged_images', { id }))
    return true
  }

  async deleteExpiredStagedImages(retentionDays: number): Promise<number> {
    return withStorageLock(this.getStorageRoot(), () => this.deleteExpiredStagedImagesUnlocked(retentionDays))
  }

  private async deleteExpiredStagedImagesUnlocked(retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const rows = await this.ctx.database.get('chatluna_memes_staged_images', {})
    const expired = rows.filter((row) => new Date(row.created_at).getTime() < cutoff.getTime())
    if (!expired.length) return 0

    let deleted = 0
    for (const row of expired) if (await this.deleteStagedImageUnlocked(row.id)) deleted++
    return deleted
  }


  async deleteAllStagedImages(): Promise<number> {
    return withStorageLock(this.getStorageRoot(), () => this.deleteAllStagedImagesUnlocked())
  }

  private async deleteAllStagedImagesUnlocked(): Promise<number> {
    const rows = await this.ctx.database.get('chatluna_memes_staged_images', {})
    if (!rows.length) return 0

    let deleted = 0
    for (const row of rows) if (await this.deleteStagedImageUnlocked(row.id)) deleted++
    return deleted
  }


  async promoteStagedImage(id: string, collectionName: string): Promise<string | null> {
    return withStorageLock(this.getStorageRoot(), () => this.promoteStagedImageUnlocked(id, collectionName))
  }

  private async promoteStagedImageUnlocked(id: string, collectionName: string): Promise<string | null> {
    this.ensureCollectionName(collectionName)
    if (!(await this.collectionExists(collectionName))) {
      throw new Error(`Collection not found: ${collectionName}`)
    }

    const rows = await this.ctx.database.get('chatluna_memes_staged_images', { id })
    if (!rows.length) return null
    const row = rows[0] as ChatLunaMemesStagedImageRow
    const staged = await this.getStagedImageBuffer(id)
    if (!staged) return null

    // 写入表情包成功后才删除待审区图片；中途失败则撤销本次新建的图片。
    let savedResult: any
    try {
      const originalName = this.isImageFile(row.original_name) ? row.original_name : row.filename
      savedResult = await this.addLocalImageBufferUnlocked(collectionName, staged.buffer, originalName)

      await this.deleteStagedImageUnlocked(id)
    } catch (error) {
      if (savedResult?.created) {
        await this.deleteImageFromCollectionUnlocked(collectionName, savedResult.filename)
      }
      this.ctx.logger('chatluna-memes').error(`Failed to promote staged image ${id}:`, error)
      throw error
    }

    const saved = savedResult.filename

    if (this.autoAnnotate) {
      void this.queueAnnotation([{
        id: savedResult.id,
        collection: collectionName,
        filename: saved,
      }])
    }

    return saved
  }
  async deleteImageFromCollection(collectionName: string, filename: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.deleteImageFromCollectionUnlocked(collectionName, filename))
  }

  private async deleteImageFromCollectionUnlocked(collectionName: string, filename: string): Promise<boolean> {
    this.ensureCollectionName(collectionName)
    if (!(await this.collectionExists(collectionName))) {
      return false
    }

    let safeName: string
    try {
      safeName = this.ensureSafeImageFilename(filename)
    } catch {
      return false
    }

    const rows = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName, filename: safeName })
    if (!rows.length) {
      return false
    }

    const image = rows[0]
    if (image.type === 'local') {
      const fullPath = path.join(this.getCollectionDir(collectionName), safeName)
      await removeWithRollback(this.getStorageRoot(), fullPath,
        () => this.ctx.database.remove('chatluna_memes_images', { id: image.id }))
    } else {
      await this.ctx.database.remove('chatluna_memes_images', { id: image.id })
    }
    this.notifyImagesChanged()
    return true
  }

  async moveImageToCollection(sourceCollection: string, targetCollection: string, filename: string): Promise<string | null> {
    return withStorageLock(this.getStorageRoot(), () => this.moveImageToCollectionUnlocked(sourceCollection, targetCollection, filename))
  }

  private async moveImageToCollectionUnlocked(
    sourceCollection: string,
    targetCollection: string,
    filename: string
  ): Promise<string | null> {
    this.ensureCollectionName(sourceCollection)
    this.ensureCollectionName(targetCollection)
    if (!(await this.collectionExists(sourceCollection)) || !(await this.collectionExists(targetCollection))) {
      return null
    }

    let safeName: string
    try {
      safeName = this.ensureSafeImageFilename(filename)
    } catch {
      return null
    }

    const rows = await this.ctx.database.get('chatluna_memes_images', { collection: sourceCollection, filename: safeName })
    if (!rows.length) {
      return null
    }

    const image = rows[0]

    if (sourceCollection === targetCollection) return safeName
    if (image.type !== 'local') return null
    const maxImg = await this.ctx.database.get('chatluna_memes_images', { collection: targetCollection }, { limit: 1, sort: { index: 'desc' } })
    const targetIndex = maxImg.length ? maxImg[0].index + 1 : 1
    const targetFilename = await this.deduplicateDatabaseFilename(targetCollection, safeName)
    const sourcePath = path.join(this.getCollectionDir(sourceCollection), safeName)
    const targetPath = path.join(this.getCollectionDir(targetCollection), targetFilename)
    await fs.copyFile(sourcePath, targetPath, (await import('fs')).constants.COPYFILE_EXCL)
    try {
      await removeWithRollback(this.getStorageRoot(), sourcePath, () => this.ctx.database.set('chatluna_memes_images', { id: image.id }, {
        collection: targetCollection,
        index: targetIndex,
        filename: targetFilename,
        value: targetFilename,
      }))
    } catch (error) {
      await fs.unlink(targetPath)
      throw error
    }
    this.notifyImagesChanged()
    return targetFilename
  }


  async getCollectionInfos(names?: string[]): Promise<CollectionInfo[]> {
    const collections = names || await this.getCollections()
    if (!collections.length) return []
    const rows = await this.ctx.database.get('chatluna_memes_images', { collection: collections }, ['collection', 'filename', 'type', 'created_at'])
    const summaries = new Map<string, { local: number; external: number; cover?: string; first: number; last: number }>()
    for (const row of rows) {
      const summary = summaries.get(row.collection) || { local: 0, external: 0, first: Infinity, last: 0 }
      if (row.type === 'external') summary.external++
      else { summary.local++; summary.cover ||= row.filename }
      const time = new Date(row.created_at).getTime()
      if (Number.isFinite(time)) { summary.first = Math.min(summary.first, time); summary.last = Math.max(summary.last, time) }
      summaries.set(row.collection, summary)
    }
    const result = new Map<string, CollectionInfo>()
    await mapPool(collections, BACKFILL_CONCURRENCY, async (name) => {
      const summary = summaries.get(name) || { local: 0, external: 0, first: Infinity, last: 0 }
      // 表情包可能在列举后被并发删除，跳过即可，不应让整个列表失败。
      const stat = await fs.stat(this.getCollectionDir(name)).catch(() => null)
      if (!stat) return
      result.set(name, {
        name, description: await this.getCollectionDescription(name),
        localCount: summary.local, linkCount: summary.external, totalCount: summary.local + summary.external,
        hasContent: summary.local + summary.external > 0, cover: summary.cover,
        createdAt: new Date(Math.min(summary.first, stat.birthtimeMs)), updatedAt: new Date(Math.max(summary.last, stat.mtimeMs)),
      })
    })
    return collections.map((name) => result.get(name)).filter((info): info is CollectionInfo => !!info)
  }


  async getRandomResource(collectionName: string): Promise<CollectionResource | null> {
    if (!this.isValidCollectionName(collectionName)) {
      return null
    }
    if (!(await this.collectionExists(collectionName))) {
      return null
    }

    const count = await this.ctx.database.eval('chatluna_memes_images', (row) => Eval.count(row.id), { collection: collectionName })
    if (count === 0) {
      return null
    }

    const offset = Math.floor(Math.random() * count)
    const rows = await this.ctx.database.get('chatluna_memes_images', { collection: collectionName }, { limit: 1, offset })
    if (!rows.length) {
      return null
    }

    const image = rows[0]
    if (image.type === 'external') {
      return { type: 'external', value: image.value }
    } else {
      return {
        type: 'local',
        filename: image.filename,
        value: path.join(this.getCollectionDir(collectionName), image.filename),
      }
    }
  }

  async getResourceByRow(image: any): Promise<CollectionResource | null> {
    if (image.type === 'external') {
      return { type: 'external', value: image.value }
    } else {
      return {
        type: 'local',
        filename: image.filename,
        value: path.join(this.getCollectionDir(image.collection), image.filename),
      }
    }
  }

  private mapEndpoint(row: ChatLunaMemesEndpointRow): ApiEndpoint {
    return {
      id: row.id,
      name: row.name,
      group: row.group || '默认分组',
      description: row.description || '',
      url: row.url,
      method: 'redirect',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async getEndpoints(): Promise<ApiEndpoint[]> {
    const rows = await this.ctx.database.get('chatluna_memes_endpoints', {})
    return rows.map((row) => this.mapEndpoint(row)).sort((a, b) => a.name.localeCompare(b.name))
  }

  async getEndpointByName(name: string): Promise<ApiEndpoint | null> {
    const rows = await this.ctx.database.get('chatluna_memes_endpoints', { name })
    if (!rows.length) return null
    return this.mapEndpoint(rows[0])
  }

  async addEndpoint(input: ApiEndpointInput): Promise<string> {
    return withStorageLock(this.getStorageRoot(), () => this.addEndpointUnlocked(input))
  }

  private async addEndpointUnlocked(input: ApiEndpointInput): Promise<string> {
    this.ensureEndpointName(input.name)
    if (!input.url) {
      throw new Error('Endpoint URL is required.')
    }
    if (await this.getEndpointByName(input.name)) {
      throw new Error(`Endpoint already exists: ${input.name}`)
    }
    if (await this.collectionExists(input.name)) {
      throw new Error(`Endpoint name conflicts with existing collection: ${input.name}`)
    }

    const id = randomUUID()
    const now = new Date()
    await this.ctx.database.create('chatluna_memes_endpoints', {
      id,
      name: input.name,
      group: input.group || '默认分组',
      description: input.description || '',
      url: input.url,
      method: 'redirect',
      url_construction: 'normal',
      model_name: '',
      query_params: JSON.stringify([]),
      proxy_settings: JSON.stringify({}),
      created_at: now,
      updated_at: now,
    })
    this.notifyImagesChanged()
    return id
  }

  async updateEndpoint(name: string, input: Partial<ApiEndpointInput>): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.updateEndpointUnlocked(name, input))
  }

  private async updateEndpointUnlocked(name: string, input: Partial<ApiEndpointInput>): Promise<boolean> {
    const current = await this.getEndpointByName(name)
    if (!current) {
      return false
    }

    const payload: Partial<ChatLunaMemesEndpointRow> = {
      updated_at: new Date(),
    }

    if (input.name !== undefined && input.name !== name) {
      this.ensureEndpointName(input.name)
      if (await this.getEndpointByName(input.name)) throw new Error(`已经有叫「${input.name}」的外部图源了`)
      if (await this.collectionExists(input.name)) throw new Error(`「${input.name}」已被表情包占用`)
      payload.name = input.name
    }
    if (input.group !== undefined) payload.group = input.group || '默认分组'
    if (input.description !== undefined) payload.description = input.description || ''
    if (input.url !== undefined) payload.url = input.url
    payload.method = 'redirect'
    payload.url_construction = 'normal'
    payload.model_name = ''
    payload.query_params = JSON.stringify([])
    payload.proxy_settings = JSON.stringify({})

    await this.ctx.database.set('chatluna_memes_endpoints', { name }, payload)
    this.notifyImagesChanged()
    return true
  }

  async deleteEndpoint(name: string): Promise<boolean> {
    return withStorageLock(this.getStorageRoot(), () => this.deleteEndpointUnlocked(name))
  }

  private async deleteEndpointUnlocked(name: string): Promise<boolean> {
    const before = await this.ctx.database.get('chatluna_memes_endpoints', { name })
    if (!before.length) {
      return false
    }
    await this.ctx.database.remove('chatluna_memes_endpoints', { name })
    this.notifyImagesChanged()
    return true
  }

  /** 给 ChatLuna 的随机图清单：表情包和外部图源合成一张列表，每项给出完整地址。 */
  async buildRouteInventory(routeBaseUrl: string): Promise<string> {
    const [collections, endpoints] = await Promise.all([this.getCollectionInfos(), this.getEndpoints()])
    const routes = [
      ...collections.filter((info) => info.hasContent).map((info) => ({ name: info.name, description: info.description })),
      ...endpoints.map((endpoint) => ({ name: endpoint.name, description: endpoint.description })),
    ]
    return routes
      .map(({ name, description }) => `- ${description ? `${name}：${description}` : name}\n  ${routeBaseUrl}/${encodeURIComponent(name)}`)
      .join('\n')
  }
}

declare module 'koishi' {
  interface Context {
    chatluna_memes: ChatLunaMemesService
  }

  interface Tables {
    chatluna_memes_endpoints: {
      id: string
      name: string
      group: string
      description: string
      url: string
      method: string
      url_construction: string
      model_name: string
      query_params: string
      proxy_settings: string
      created_at: Date
      updated_at: Date
    }
    chatluna_memes_images: {
      id: string
      collection: string
      index: number
      filename: string
      type: string
      value: string
      public_url: string
      mime: string
      hash: string
      perceptual_hash: string
      aliases: string
      tags: string
      created_at: Date
    }

    chatluna_memes_staged_images: {
      id: string
      filename: string
      original_name: string
      source: string
      reason: string
      mime: string
      size: number
      hash: string
      perceptual_hash: string
      created_at: Date
    }
  }
}
