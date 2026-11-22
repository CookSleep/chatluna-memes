import type { Settings } from './settings'
import {
  type ChatLunaMemesService,
} from './service'
import {
  parseJsonStringArray,
  toTrimmedString,
} from './utils'
import { managementPageUrl, toAbsoluteBaseUrl } from './urls'
import type { Context } from 'cordis'
import type {} from '@chatluna/ui-server'
import type {} from '@chatluna/ai-runtime'
import { formatModelAddress } from '@chatluna/utils/model-address'
import type { ImageMetadataPayload, CollectionPageQuery, ConsoleModelOption, ChatLunaMemesConsoleEvents } from './console-rpc'
import { authorizeAdmin } from './admin-auth'
import type { SettingsStore } from './settings-store'

export function applyConsole(ctx: Context, config: Settings, store: SettingsStore, service: ChatLunaMemesService) {
  const handlers = new Map<string, (args: unknown[]) => unknown>()
  const addListener = <K extends keyof ChatLunaMemesConsoleEvents>(
    event: K, handler: (...args: Parameters<ChatLunaMemesConsoleEvents[K]>) => unknown,
  ) => {
    handlers.set(event, (args) => handler(...args as Parameters<ChatLunaMemesConsoleEvents[K]>))
  }
  ctx.server.post('/api/memes/manage', async (req, res) => {
    if (!authorizeAdmin(ctx, req, res)) return
    const input = await req.json().catch(() => null)
    const handler = handlers.get(input?.event)
    if (!handler || !Array.isArray(input.args)) {
      res.status = 400
      res.json({ message: '无效的表情包管理操作' })
      return
    }
    try {
      const result = await handler(input.args)
      if (result === undefined) res.status = 204
      else res.json(result)
    } catch (error) {
      res.status = 400
      res.json({ message: error instanceof Error ? error.message : '表情包管理操作失败' })
    }
  })

  const withReady = <T extends unknown[], R>(handler: (...args: T) => Promise<R> | R) => {
    return async (...args: T): Promise<R> => {
      await service.ready
      return await handler(...args)
    }
  }

  ctx.chatluna_webui.state('memes.pagePath', { get: () => managementPageUrl(ctx) })
  ctx.chatluna_webui.addEntry({ baseUrl: import.meta.url, source: '../client/dev.js', bundle: '../dist/client.js' })

  addListener(
    'chatluna-memes/getState',
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
          autoAnnotate: config.autoAnnotate,
          stagingRetentionDays: config.stagingRetentionDays || 0,
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

  addListener('chatluna-memes/getSettings', async () => ({
    settings: { ...config },
    models: await listChatModels(ctx),
    chatlunaAvailable: !!ctx.get('ai'),
    annotatorReady: !!service.annotator,
    serverSelfUrl: (ctx.chatluna_webui.config.selfUrl || ctx.server.baseUrl).replace(/\/+$/, ''),
  }))

  addListener('chatluna-memes/updateSettings', (patch: unknown) => store.update(patch))

  addListener(
    'chatluna-memes/createCollection',
    withReady(async (name: string) => {
      return await service.createCollection(name)
    })
  )

  addListener(
    'chatluna-memes/deleteCollection',
    withReady(async (name: string) => {
      return await service.deleteCollection(name)
    })
  )

  addListener(
    'chatluna-memes/setCollectionDescription',
    withReady(async (name: string, description: string) => {
      return await service.setCollectionDescription(name, description)
    })
  )

  addListener(
    'chatluna-memes/renameCollection',
    withReady(async (name: string, newName: string) => {
      return await service.renameCollection(name, newName)
    })
  )

  addListener(
    'chatluna-memes/deleteLocalImage',
    withReady(async (collectionName: string, filename: string) => {
      return await service.deleteImageFromCollection(collectionName, filename)
    })
  )

  addListener(
    'chatluna-memes/moveLocalImage',
    withReady(async (sourceCollection: string, targetCollection: string, filename: string) => {
      return await service.moveImageToCollection(sourceCollection, targetCollection, filename)
    })
  )

  addListener(
    'chatluna-memes/addLinks',
    withReady(async (collectionName: string, linksText: string) => {
      const links = linksText
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
      return await service.addLinksToCollection(collectionName, links)
    })
  )

  addListener(
    'chatluna-memes/moveLink',
    withReady(async (sourceCollection: string, targetCollection: string, link: string) => {
      return await service.moveLinkToCollection(sourceCollection, targetCollection, link)
    })
  )

  addListener(
    'chatluna-memes/deleteLink',
    withReady(async (collectionName: string, link: string) => {
      return await service.removeLinkFromCollection(collectionName, link)
    })
  )

  addListener(
    'chatluna-memes/createEndpoint',
    withReady(async (payload: any) => {
      return await service.addEndpoint(payload)
    })
  )

  addListener(
    'chatluna-memes/updateEndpoint',
    withReady(async (name: string, payload: any) => {
      return await service.updateEndpoint(name, payload)
    })
  )

  addListener(
    'chatluna-memes/deleteEndpoint',
    withReady(async (name: string) => {
      return await service.deleteEndpoint(name)
    })
  )

  addListener(
    'chatluna-memes/getStagedImages',
    withReady(async () => {
      return await service.getStagedImages()
    })
  )
  addListener(
    'chatluna-memes/getSimilarStagedImages',
    withReady(async () => {
      return await service.getSimilarStagedImages(config.similarityThreshold)
    })
  )

  addListener(
    'chatluna-memes/addStagedImage',
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
    'chatluna-memes/deleteStagedImage',
    withReady(async (id: string) => {
      return await service.deleteStagedImage(id)
    })
  )

  addListener(
    'chatluna-memes/promoteStagedImage',
    withReady(async (id: string, collectionName: string) => {
      return await service.promoteStagedImage(id, collectionName)
    })
  )
  addListener('chatluna-memes/getBaseUrl', async () => {
    return `${toAbsoluteBaseUrl(ctx, config)}${config.backendPath}`
  })

  addListener('chatluna-memes/deleteAllStagedImages', withReady(async () => {
    return await service.deleteAllStagedImages()
  }))

  addListener(
    'chatluna-memes/annotateImage',
    withReady(async (collectionName: string, filename: string, options?: { preview?: boolean }) => {
      if (!service.annotator) return { ok: false, error: 'AI 标注器未就绪' }
      const rows = await ctx.database.get('chatluna_memes_images', { collection: collectionName, filename })
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
    'chatluna-memes/updateImageMetadata',
    withReady((payload: ImageMetadataPayload) => service.updateImageMetadata(payload))
  )

  addListener('chatluna-memes/getAnnotationStatus', withReady(() => service.getAnnotationStatus()))
  addListener('chatluna-memes/cancelAnnotations', withReady(() => service.cancelAnnotations()))

  addListener('chatluna-memes/getCollectionResources', withReady((name: string, query?: CollectionPageQuery) => {
    return service.getCollectionResourcePage(name, query)
  }))

  addListener(
    'chatluna-memes/getImageMetadata',
    withReady(async (collectionName: string, filename: string) => {
      const rows = await ctx.database.get('chatluna_memes_images', { collection: collectionName, filename })
      if (!rows.length) return { ok: false, error: '图片不存在' }
      return { ok: true, aliases: parseJsonStringArray(rows[0].aliases), tags: parseJsonStringArray(rows[0].tags) }
    })
  )

}

async function listChatModels(ctx: Context): Promise<ConsoleModelOption[]> {
  const ai = ctx.get('ai')
  if (!ai) return []
  const models = await Promise.all(ai.providers().map(async (provider) => {
    try {
      return (await ai.models(provider.id, 'chat')).map((model) => ({
        name: formatModelAddress({ provider: provider.id, model: model.id }),
        vision: model.inputModalities?.includes('image') ?? false,
      }))
    } catch (error) {
      ctx.logger.warn(`读取 ${provider.id} 的模型列表失败：`, error)
      return []
    }
  }))
  return models.flat()
}
