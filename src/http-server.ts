import fs from 'fs/promises'
import path from 'path'
import type { Context } from 'cordis'
import type { Response } from '@cordisjs/plugin-server'
import type {} from '@chatluna/ui-server'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { Settings } from './settings'
import { renderInjectPrompt } from './chatluna-inject'
import { findByQuery } from './search'
import {
  isReservedPath,
  type ChatLunaMemesService,
} from './service'
import { toTrimmedString } from './utils'
import { getLocalBaseUrl, managementPageUrl, toAbsoluteBaseUrl } from './urls'
import formidable from 'formidable'
import { authorizeAdmin } from './admin-auth'
import { MAX_IMAGE_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_TOTAL_BYTES } from './constants'

async function applyDynamicForward(
  ctx: Context,
  config: Settings,
  service: ChatLunaMemesService,
  routeName: string,
  _query: Record<string, unknown>,
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
      }
    }

    return { redirectTo: endpoint.url }
  }

  const query = typeof _query?.q === 'string' ? _query.q.trim() : ''
  if (query && isCollection) {
    const queryResult = await findByQuery(ctx, config, service, query, routeName)
    if (queryResult) return queryResult
  }

  const resource = await service.getRandomResource(routeName)
  if (!resource) {
    return { notFound: true }
  }

  if (resource.type === 'external') {
    return { redirectTo: resource.value }
  }

  const localUrl = `${getLocalBaseUrl(ctx, config)}${config.backendPath}/api/collections/${encodeURIComponent(routeName)}/images/${encodeURIComponent(resource.filename || '')}`
  return { redirectTo: localUrl }
}

function redirect(res: Response, url: string) {
  res.status = 302
  res.headers.set('location', url)
  res.text('')
}

function sendImage(res: Response, image: { buffer: Buffer; mime: string }) {
  res.headers.set('Content-Type', image.mime)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  if (image.mime === 'image/svg+xml') res.headers.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
  res.body = new Uint8Array(image.buffer)
}

export function applyServer(ctx: Context, config: Settings, service: ChatLunaMemesService) {
  const server = ctx.server
  const basePath = config.backendPath
  ctx.inject(['chatluna_webui'], (uiCtx) => { uiCtx.chatluna_webui.exclude(basePath) })

  server.get(`${basePath}/api/homepage-data`, async (_req, res) => {
    await service.ready
    const inventory = await service.buildRouteInventory(`${toAbsoluteBaseUrl(ctx, config)}${basePath}`)
    res.json({ llmPrompt: renderInjectPrompt(config, inventory, toAbsoluteBaseUrl(ctx, config)), routeInventory: inventory })
  })

  server.get(`${basePath}/api/admin/staged-images/:id`, async (req, res) => {
    if (!authorizeAdmin(ctx, req, res)) return
    await service.ready
    const id = toTrimmedString(req.params.id)
    const image = await service.getStagedImageBuffer(id)
    if (!image) {
      res.status = 404
      res.json({ error: 'Staged image not found' })
      return
    }

    sendImage(res, image)
  })

  server.post(`${basePath}/api/admin/collections/:name/images`, async (req, res) => {
    if (!authorizeAdmin(ctx, req, res)) return
    await service.ready
    const collectionName = toTrimmedString(req.params.name)
    if (!collectionName) {
      res.status = 400
      res.json({ error: 'Collection name is required' })
      return
    }

    if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('multipart/form-data;')) {
      res.status = 415
      res.json({ error: 'multipart/form-data is required' })
      return
    }
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'chatluna-memes-upload-'))
    const form = formidable({
      uploadDir: tempDir, keepExtensions: true, multiples: true,
      maxFileSize: MAX_IMAGE_BYTES, maxFiles: MAX_UPLOAD_FILES,
      maxTotalFileSize: MAX_UPLOAD_TOTAL_BYTES,
    })
    const uploaded: string[] = []
    const failed: Array<{ filename: string; error: string }> = []
    const rowsToAnnotate: any[] = []
    try {
      if (!req.body) throw new Error('上传内容为空')
      // Cordis 已把原始请求转成 Web 流；从这份流读取，避免丢失已缓存的首块。
      const input = Object.assign(Readable.fromWeb(req.body), { headers: req._req.headers })
      const [, files] = await form.parse(input as IncomingMessage)

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
        void service.queueAnnotation(rowsToAnnotate).catch((error) => ctx.logger.warn(error))
      }
      res.status = uploaded.length ? 200 : 400
      res.json({ ok: failed.length === 0, uploaded, failed })
    } catch (error) {
      res.status = 400
      res.json({ error: (error as Error).message || 'Failed to parse upload stream' })
    } finally {
      // 包括解析失败、单张失败和剩余未处理文件，不清理其他请求的目录。
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  server.get(`${basePath}/api/collections/:name/images/:filename`, async (req, res) => {
    await service.ready
    const collectionName = toTrimmedString(req.params.name)
    const filename = toTrimmedString(req.params.filename)

    const image = await service.getLocalImageBuffer(collectionName, filename)
    if (!image) {
      res.status = 404
      res.json({ error: 'Image not found' })
      return
    }

    sendImage(res, image)
  })

  // 不带结尾斜杠才能同时匹配 /prefix 和 /prefix/，提示词里给模型的搜索地址是前者。
  server.get(basePath, async (req, res) => {
    await service.ready
    const query = req.query.get('q')?.trim()
    if (query) {
      const result = await findByQuery(ctx, config, service, query)
      if (result?.redirectTo) redirect(res, result.redirectTo)
      else { res.status = 404; res.json({ error: 'Not Found' }) }
      return
    }

    const ui = ctx.get('chatluna_webui')
    const page = managementPageUrl(ctx)
    if (ui && basePath === page) {
      // 此前缀已从外壳的兜底路由排除；同址无查询时直接交付原生 WebUI 首页。
      res.headers.set('cache-control', 'no-store')
      res.headers.set('content-type', 'text/html; charset=utf-8')
      res.body = await ui.transformHtml(await fs.readFile(path.join(ui.root, 'index.html'), 'utf8'))
      return
    }
    redirect(res, page)
  })

  server.get(`${basePath}/:name`, async (req, res) => {
    await service.ready
    const routeName = req.params.name

    if (isReservedPath(routeName)) {
      res.status = 404
      res.json({ error: 'Not Found' })
      return
    }

    const query = Object.fromEntries(req.query)
    const result = await applyDynamicForward(
      ctx,
      config,
      service,
      routeName,
      query,
    )

    if ('redirectTo' in result) redirect(res, result.redirectTo)
    else {
      res.status = result.status ?? 404
      res.json(result.body ?? { error: 'Not Found' })
    }
  })

  server.get(`${basePath}/:name/:filename`, async (req, res) => {
    await service.ready
    const collectionName = toTrimmedString(req.params.name)
    const filename = toTrimmedString(req.params.filename)

    if (isReservedPath(collectionName)) {
      res.status = 404
      res.json({ error: 'Not Found' })
      return
    }

    const image = await service.getLocalImageBuffer(collectionName, filename)
    if (!image) {
      res.status = 404
      res.json({ error: 'Image not found' })
      return
    }

    sendImage(res, image)
  })
}
