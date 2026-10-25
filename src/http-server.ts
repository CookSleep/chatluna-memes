import fs from 'fs/promises'
import path from 'path'
import { Context } from 'koishi'
import type { Settings } from './settings'
import { renderInjectPrompt } from './chatluna-inject'
import { findByQuery } from './search'
import {
  isReservedPath,
  type ChatLunaMemesService,
} from './service'
import { toTrimmedString } from './utils'
import { getLocalBaseUrl, toAbsoluteBaseUrl } from './urls'
import formidable from 'formidable'
import { adminHttpGuard } from './admin-auth'
import { MAX_IMAGE_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_TOTAL_BYTES } from './constants'

async function applyDynamicForward(
  ctx: Context,
  config: Settings,
  service: ChatLunaMemesService,
  routeName: string,
  _query: Record<string, unknown>,
  requestOrigin?: string,
) {
  const endpoint = await service.getEndpointByName(routeName)
  const isCollection = await service.collectionExists(routeName)

  if (!endpoint && !isCollection) {
    return { notFound: true }
  }

  if (endpoint) {
    if (!endpoint.url) {
      return {
        status: 500,
        body: { error: 'Configuration URL missing' },
        contentType: 'application/json',
      }
    }

    return { redirectTo: endpoint.url }
  }

  const query = typeof _query?.q === 'string' ? _query.q.trim() : ''
  if (query && isCollection) {
    const queryResult = await findByQuery(ctx, config, service, query, requestOrigin, routeName)
    if (queryResult) return queryResult
  }

  const resource = await service.getRandomResource(routeName)
  if (!resource) {
    return { notFound: true }
  }

  if (resource.type === 'external') {
    return { redirectTo: resource.value }
  }

  const localUrl = `${getLocalBaseUrl(ctx, config, requestOrigin)}${config.backendPath}/api/collections/${encodeURIComponent(routeName)}/images/${encodeURIComponent(resource.filename || '')}`
  return { redirectTo: localUrl }
}

function setKoaResponse(koa: any, result: any) {
  if (result.redirectTo) {
    koa.redirect(result.redirectTo)
    return
  }

  if (result.notFound) {
    koa.status = 404
    koa.body = { error: 'Not Found' }
    return
  }

  koa.status = result.status ?? 200
  if (result.contentType) {
    koa.set('Content-Type', result.contentType)
  }
  koa.body = result.body
}

/** 图片响应统一禁止 MIME 嗅探，SVG 额外沙箱化，避免在 Console 同源下执行脚本。 */
function sendImage(koa: any, image: { buffer: Buffer; mime: string }) {
  koa.status = 200
  koa.set('Content-Type', image.mime)
  koa.set('X-Content-Type-Options', 'nosniff')
  if (image.mime === 'image/svg+xml') koa.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
  koa.body = image.buffer
}

/** Console 页面地址；console 是可选依赖，用 ctx.get 避免未声明注入的警告。 */
function getConsolePageUrl(ctx: Context): string {
  const uiPath: string = (ctx.get('console') as any)?.config?.uiPath ?? ''
  return `${uiPath.replace(/\/+$/, '')}/chatluna-memes`
}

export function applyServer(ctx: Context, config: Settings, service: ChatLunaMemesService) {
  if (!ctx.server) return

  const basePath = config.backendPath

  const guard = adminHttpGuard(ctx)
  const server = Object.fromEntries(['get', 'post'].map((method) => [method,
    (route: string, handler: (koa: any, next: () => Promise<void>) => Promise<void>) => {
      if (!route.startsWith(`${basePath}/api/admin/`)) {
        return (ctx.server as any)[method](route, handler)
      }
      // 管理路由只做鉴权；请求体（multipart）由各自处理器在鉴权后解析。
      return (ctx.server as any)[method](route, guard, async (koa: any, next: () => Promise<void>) => {
        await service.ready
        await handler(koa, next)
      })
    },
  ])) as Record<'get' | 'post', (route: string, handler: (koa: any, next: () => Promise<void>) => Promise<void>) => unknown>

  server.get(`${basePath}/api/homepage-data`, async (koa) => {
    const inventory = await service.buildRouteInventory(`${toAbsoluteBaseUrl(ctx, config)}${basePath}`)
    koa.body = { llmPrompt: renderInjectPrompt(config, inventory, toAbsoluteBaseUrl(ctx, config)), routeInventory: inventory }
  })

  server.get(`${basePath}/api/admin/staged-images/:id`, async (koa) => {
    const id = toTrimmedString(koa.params.id)
    const image = await service.getStagedImageBuffer(id)
    if (!image) {
      koa.status = 404
      koa.body = { error: 'Staged image not found' }
      return
    }

    sendImage(koa, image)
  })

  server.post(`${basePath}/api/admin/collections/:name/images`, async (koa) => {
    const collectionName = toTrimmedString(koa.params.name)
    if (!collectionName) {
      koa.status = 400
      koa.body = { error: 'Collection name is required' }
      return
    }

    if (!(koa.get('content-type') || '').toLowerCase().startsWith('multipart/form-data;')) {
      koa.status = 415
      koa.body = { error: 'multipart/form-data is required' }
      return
    }
    const storageRoot = path.resolve(ctx.baseDir, 'data/chatluna-memes')
    await fs.mkdir(storageRoot, { recursive: true })
    const tempDir = await fs.mkdtemp(path.join(storageRoot, '.temp_upload-'))
    const form = formidable({
      uploadDir: tempDir, keepExtensions: true, multiples: true,
      maxFileSize: MAX_IMAGE_BYTES, maxFiles: MAX_UPLOAD_FILES,
      maxTotalFileSize: MAX_UPLOAD_TOTAL_BYTES,
    })
    const uploaded: string[] = []
    const failed: Array<{ filename: string; error: string }> = []
    const rowsToAnnotate: any[] = []
    try {
      const files = await new Promise<formidable.Files>((resolve, reject) => {
        form.parse(koa.req, (error, _fields, files) => error ? reject(error) : resolve(files))
      })
      const field = files.images || files.file || files.files
      const fileList = Array.isArray(field) ? field : field ? [field] : []
      if (!fileList.length) throw new Error('No images provided')
      for (const file of fileList) {
        try {
          const buffer = await fs.readFile(file.filepath)
          const result = await service.addLocalImageBuffer(collectionName, buffer, file.originalFilename || undefined)
          uploaded.push(result.filename)
          rowsToAnnotate.push({ id: result.id, collection: collectionName, filename: result.filename })
        } catch (error) {
          failed.push({ filename: file.originalFilename || '', error: (error as Error).message })
        }
      }
      if (service.autoAnnotate && rowsToAnnotate.length) {
        void service.queueAnnotation(rowsToAnnotate).catch((error) => ctx.logger('chatluna-memes').warn(error))
      }
      koa.status = uploaded.length ? 200 : 400
      koa.body = { ok: failed.length === 0, uploaded, failed }
    } catch (error) {
      koa.status = 400
      koa.body = { error: (error as Error).message || 'Failed to parse upload stream' }
    } finally {
      // 包括解析失败、单张失败和剩余未处理文件，不清理其他请求的目录。
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  server.get(`${basePath}/api/collections/:name/images/:filename`, async (koa) => {
    const collectionName = toTrimmedString(koa.params.name)
    const filename = toTrimmedString(koa.params.filename)

    const image = await service.getLocalImageBuffer(collectionName, filename)
    if (!image) {
      koa.status = 404
      koa.body = { error: 'Image not found' }
      return
    }

    sendImage(koa, image)
  })

  // 不带结尾斜杠才能同时匹配 /prefix 和 /prefix/，提示词里给模型的搜索地址是前者。
  server.get(basePath, async (koa, next) => {
    const query = typeof koa.request.query?.q === 'string' ? koa.request.query.q.trim() : ''
    if (query) {
      const result = await findByQuery(ctx, config, service, query, koa.request.origin)
      setKoaResponse(koa, result || { notFound: true })
      return
    }

    // 默认前缀和 Console 页面路径相同，这时交给 Console，否则会跳转到自己。
    const consolePage = getConsolePageUrl(ctx)
    if (koa.path.replace(/\/+$/, '') === consolePage) return next()
    koa.redirect(consolePage)
  })

  server.get(`${basePath}/:name`, async (koa) => {
    const routeName = koa.params.name as string

    if (isReservedPath(routeName)) {
      koa.status = 404
      koa.body = { error: 'Not Found' }
      return
    }

    const query = koa.request.query as Record<string, unknown>
    const result = await applyDynamicForward(
      ctx,
      config,
      service,
      routeName,
      query,
      koa.request.origin,
    )

    setKoaResponse(koa, result)
  })

  server.get(`${basePath}/:name/:filename`, async (koa) => {
    const collectionName = toTrimmedString(koa.params.name)
    const filename = toTrimmedString(koa.params.filename)

    if (isReservedPath(collectionName)) {
      koa.status = 404
      koa.body = { error: 'Not Found' }
      return
    }

    const image = await service.getLocalImageBuffer(collectionName, filename)
    if (!image) {
      koa.status = 404
      koa.body = { error: 'Image not found' }
      return
    }

    sendImage(koa, image)
  })
}
