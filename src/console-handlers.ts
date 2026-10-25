import { existsSync } from 'fs'
import path from 'path'
import { Context } from 'koishi'
import type { Config } from './config'
import {
  type MemesLunaService,
} from './service'
import {
  parseJsonStringArray,
  toTrimmedString,
} from './utils'
import { toAbsoluteBaseUrl } from './urls'
import { ADMIN_AUTHORITY, requireConsoleAdmin } from './admin-auth'
import type { ImageMetadataPayload, CollectionPageQuery } from './console-rpc'

export function applyConsole(ctx: Context, config: Config, service: MemesLunaService) {
  if (!ctx.console) {
    return
  }

  const consoleService = ctx.console as any

  const packageBase = path.resolve(__dirname, '..')
  const installedBase = path.resolve(ctx.baseDir, 'node_modules', 'koishi-plugin-memesluna')
  const consoleBase = existsSync(installedBase) ? installedBase : packageBase
  const devPath = path.resolve(consoleBase, 'client/index.ts')
  const prodPath = path.resolve(consoleBase, 'dist')

  const addListener = (event: string, handler: (...args: any[]) => any) => {
    consoleService.addListener(event, async function (this: any, ...args: any[]) {
      await requireConsoleAdmin(ctx, this)
      return handler(...args)
    }, { authority: ADMIN_AUTHORITY })
  }

  const withReady = <T extends unknown[], R>(handler: (...args: T) => Promise<R> | R) => {
    return async (...args: T): Promise<R> => {
      await service.ready
      return await handler(...args)
    }
  }

  consoleService.addEntry({
    dev: devPath,
    prod: prodPath,
  })

  addListener(
    'memesluna/getState',
    withReady(async () => {
      const endpoints = await service.getEndpoints()
      const detailedCollections = await service.getCollectionInfos()

      const stagedImages = await service.getStagedImages()
      return {
        backendPath: config.backendPath,
        endpoints,
        collections: detailedCollections.filter(Boolean),
        stagedImages,
        settings: {
          injectVariables: !!config.injectVariables,
          annotatorReady: !!service.annotator,
          stagingRetentionDays: config.stagingRetentionDays || 0,
          // 与 auto-collect.ts 中的默认值保持一致。
          autoCollect: {
            enabled: !!config.autoCollect,
            windowMinutes: Math.max(1, config.emojiFrequencyWindowMinutes || 10),
            threshold: Math.max(1, config.emojiFrequencyThreshold || 3),
            minSizeKB: Math.max(0, config.minEmojiSize ?? 4),
            maxSizeMB: Math.max(1, config.maxEmojiSize || 15),
            dailyLimit: Math.max(1, config.groupAutoCollectLimit || 300),
          },
        },
      }
    })
  )

  addListener(
    'memesluna/createCollection',
    withReady(async (name: string) => {
      return await service.createCollection(name)
    })
  )

  addListener(
    'memesluna/deleteCollection',
    withReady(async (name: string) => {
      return await service.deleteCollection(name)
    })
  )

  addListener(
    'memesluna/setCollectionDescription',
    withReady(async (name: string, description: string) => {
      return await service.setCollectionDescription(name, description)
    })
  )

  addListener(
    'memesluna/renameCollection',
    withReady(async (name: string, newName: string) => {
      return await service.renameCollection(name, newName)
    })
  )

  addListener(
    'memesluna/deleteLocalImage',
    withReady(async (collectionName: string, filename: string) => {
      return await service.deleteImageFromCollection(collectionName, filename)
    })
  )

  addListener(
    'memesluna/moveLocalImage',
    withReady(async (sourceCollection: string, targetCollection: string, filename: string) => {
      return await service.moveImageToCollection(sourceCollection, targetCollection, filename)
    })
  )

  addListener(
    'memesluna/addLinks',
    withReady(async (collectionName: string, linksText: string) => {
      const links = linksText
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
      return await service.addLinksToCollection(collectionName, links)
    })
  )

  addListener(
    'memesluna/deleteLink',
    withReady(async (collectionName: string, link: string) => {
      return await service.removeLinkFromCollection(collectionName, link)
    })
  )

  addListener(
    'memesluna/createEndpoint',
    withReady(async (payload: any) => {
      return await service.addEndpoint(payload)
    })
  )

  addListener(
    'memesluna/updateEndpoint',
    withReady(async (name: string, payload: any) => {
      return await service.updateEndpoint(name, payload)
    })
  )

  addListener(
    'memesluna/deleteEndpoint',
    withReady(async (name: string) => {
      return await service.deleteEndpoint(name)
    })
  )

  addListener(
    'memesluna/getStagedImages',
    withReady(async () => {
      return await service.getStagedImages()
    })
  )
  addListener(
    'memesluna/getSimilarStagedImages',
    withReady(async () => {
      return await service.getSimilarStagedImages(config.similarityThreshold)
    })
  )

  addListener(
    'memesluna/addStagedImage',
    withReady(async (payload: any) => {
      return await service.addStagedImageBase64(
        toTrimmedString(payload?.base64),
        toTrimmedString(payload?.originalName) || undefined,
        toTrimmedString(payload?.source) || 'filter',
        toTrimmedString(payload?.reason)
      )
    })
  )

  addListener(
    'memesluna/deleteStagedImage',
    withReady(async (id: string) => {
      return await service.deleteStagedImage(id)
    })
  )

  addListener(
    'memesluna/promoteStagedImage',
    withReady(async (id: string, collectionName: string) => {
      return await service.promoteStagedImage(id, collectionName)
    })
  )
  addListener('memesluna/getBaseUrl', async () => {
    return `${toAbsoluteBaseUrl(ctx, config)}${config.backendPath}`
  })

  addListener('memesluna/deleteAllStagedImages', withReady(async () => {
    return await service.deleteAllStagedImages()
  }))

  addListener(
    'memesluna/annotateImage',
    withReady(async (collectionName: string, filename: string, options?: { preview?: boolean }) => {
      if (!service.annotator) return { ok: false, error: 'AI 标注器未就绪' }
      const rows = await ctx.database.get('memesluna_images', { collection: collectionName, filename })
      if (!rows.length) return { ok: false, error: '图片不存在' }
      let preview: { aliases: string[]; tags: string[] } | undefined
      // 手动单张标注不排在后台批量任务之后。
      const outcome = await service.queueAnnotation(rows, {
        force: true,
        immediate: true,
        onPreview: options?.preview ? (result) => { preview = result } : undefined,
      })
      if (!outcome.success) return { ok: false, error: 'AI 标注失败或任务已取消' }
      if (preview) return { ok: true, ...preview }
      const updated = await service.getImageById(rows[0].id)
      if (!updated) return { ok: false, error: '图片已删除' }
      return { ok: true, aliases: parseJsonStringArray(updated.aliases), tags: parseJsonStringArray(updated.tags) }
    })
  )

  addListener(
    'memesluna/updateImageMetadata',
    withReady((payload: ImageMetadataPayload) => service.updateImageMetadata(payload))
  )

  addListener('memesluna/getAnnotationStatus', withReady(() => service.getAnnotationStatus()))
  addListener('memesluna/cancelAnnotations', withReady(() => service.cancelAnnotations()))

  addListener('memesluna/getCollectionResources', withReady((name: string, query?: CollectionPageQuery) => {
    return service.getCollectionResourcePage(name, query)
  }))

  addListener(
    'memesluna/getImageMetadata',
    withReady(async (collectionName: string, filename: string) => {
      const rows = await ctx.database.get('memesluna_images', { collection: collectionName, filename })
      if (!rows.length) return { ok: false, error: '图片不存在' }
      return { ok: true, aliases: parseJsonStringArray(rows[0].aliases), tags: parseJsonStringArray(rows[0].tags) }
    })
  )

}
