import { Context, h } from 'koishi'
import type { Config } from './config'
import { downloadImage } from './download'
import { getExtFromMagicBytes } from './image-format'
import { parseJsonStringArray } from './utils'

/** 会写入或批量修改图库的命令所需权限。 */
const MANAGE_AUTHORITY = 5

export function registerCommands(ctx: Context, config: Config) {
  const root = ctx.command('memesluna', 'MemesLuna 命令')

  root
    .subcommand('.list', '查看当前可用表情路由')
    .action(async ({ session }) => {
      const service = ctx.memesluna
      await service.ready

      const [collections, endpoints] = await Promise.all([
        service.getCollectionInfos(), service.getEndpoints(),
      ])
      const collectionInfos = collections.filter((info) => info.hasContent)

      const lines: string[] = collectionInfos
        .map((info) => `${info.name} ${info.name}表情包`)

      for (const endpoint of endpoints) {
        const endpointLabel = endpoint.description || `${endpoint.name}端点`
        lines.push(`${endpoint.name} ${endpointLabel}`)
      }

      if (!lines.length) {
        return '暂无可用表情路由'
      }

      return lines.join('\n')
    })

  const stoleAction = async (session: any, name: string) => {
    if (!session) return
    if (!name) {
      return '使用方式：引用图片并回复 "偷了 [表情包名称]" 或 "memesluna stole [表情包名称]"'
    }

    const service = ctx.memesluna
    await service.ready

    try {
      if (!(await service.collectionExists(name))) {
        return `表情包合集 "${name}" 不存在，请先在 Koishi Console 的 MemesLuna 页面创建。`
      }
    } catch (err) {
      return `检查表情包失败: ${(err as Error).message}`
    }

    // OneBot 等适配器产出 img 元素，部分适配器仍使用 image，两者都要选。
    const source = session.quote
      ? (session.quote.elements ?? h.parse(session.quote.content || ''))
      : (session.elements || [])
    const imageUrls: string[] = [...h.select(source, 'img'), ...h.select(source, 'image')]
      .map((img) => img.attrs.url || img.attrs.src)
      .filter(Boolean)

    if (!imageUrls.length) {
      return '没有找到要偷的图片。请引用包含图片的聊天记录，或者在发送图片的同时回复 "偷了 [表情包名称]"'
    }

    let successCount = 0
    let incompatibleCount = 0
    let failedCount = 0
    const savedFilenames: string[] = []
    const rowsToAnnotate: any[] = []

    for (const url of imageUrls) {
      try {
        const buffer = await downloadImage(ctx, url, 50 * 1024 * 1024)
        const ext = getExtFromMagicBytes(buffer)
        if (!ext) {
          incompatibleCount++
          continue
        }

        const result = await service.addLocalImageBuffer(name, buffer, `stole${ext}`)
        savedFilenames.push(result.filename)
        rowsToAnnotate.push({
          id: result.id,
          collection: name,
          filename: result.filename,
        })
        successCount++
      } catch (err) {
        failedCount++
        ctx.logger('memesluna').error(`Failed to steal image from URL: ${url}`, err)
      }
    }

    if (successCount === 0) {
      if (incompatibleCount > 0 && failedCount === 0) {
        return '偷表情包失败，图片格式不兼容。仅支持 JPG/PNG/GIF/WEBP/BMP 格式图片（已拒绝 AVIF，且不会放入暂缓区）。'
      }
      return '偷表情包失败，下载图片或上传保存时发生错误。'
    }

    if (service.annotator && rowsToAnnotate.length > 0) {
      void service.queueAnnotation(rowsToAnnotate)
    }

    const skippedHints = [
      incompatibleCount ? `跳过 ${incompatibleCount} 张格式不兼容图片` : '',
      failedCount ? `${failedCount} 张下载或保存失败` : '',
    ].filter(Boolean)
    const skippedText = skippedHints.length ? `（${skippedHints.join('，')}）` : ''

    return `成功偷了 ${successCount} 张表情包存入表情包 "${name}"！${skippedText}新文件名：${savedFilenames.join(', ')}`
  }

  root
    .subcommand('.stole <name:string>', '偷取引用消息中的图片并存入指定表情包', { authority: MANAGE_AUTHORITY })
    .action(async ({ session }, name) => {
      return await stoleAction(session, name)
    })

  root
    .subcommand('.tagall', '批量为以往的图片自动进行 AI 语义打标', { authority: MANAGE_AUTHORITY })
    .option('force', '-f 强制为已打标的图片重新进行 AI 标注')
    .action(async ({ session, options }) => {
      const service = ctx.memesluna
      await service.ready
      const annotator = service.annotator
      if (!annotator) return 'AI 标注器未就绪，请先在配置中指定模型（model）。'

      const images = await ctx.database.get('memesluna_images', {})
      const force = !!options?.force
      // 批量 AI 标注只处理实际保存在本地合集目录中的图片。
      // 外链图片仍可用于路由分发，但不应计入 tagall 的处理数量。
      const localImages = images.filter((img) => img.type === 'local')
      const taggedLocalCount = localImages.filter((img) => parseJsonStringArray(img.tags).length > 0).length
      const targets = force ? localImages : localImages.filter((img) => parseJsonStringArray(img.tags).length === 0)

      if (targets.length === 0) {
        return localImages.length > 0
          ? `本地图片共 ${localImages.length} 张，已完成标注 ${taggedLocalCount} 张，没有发现需要标注的本地图片。`
          : '没有发现需要标注的本地图片（外链图片不会参与批量 AI 标注）。'
      }

      if (session) {
        await session.send(`开始批量为 ${targets.length} 张图片进行 AI 自动标注，这可能需要一些时间，请稍候...`)
      }

      let lastProgress = 0
      // 整批只入队一次，取消后不会由后续分块重新创建任务。
      const result = await service.queueAnnotation(targets, {
        force: true,
        onProgress: async (success, fail) => {
          const completed = success + fail
          if (session && completed >= lastProgress + 20) {
            lastProgress = completed
            await session.send(`已处理 ${completed}/${targets.length} 张图片（成功：${success}，失败：${fail}）...`)
          }
        },
      })
      return `批量 AI 标注${result.cancelled ? '已取消' : '已结束'}！\n成功：${result.success} 张\n失败：${result.fail} 张\n跳过：${result.skipped} 张\n取消：${result.cancelled} 张`

    })

  root
    .subcommand('.untagall', '一键清空表情图片的标签', { authority: MANAGE_AUTHORITY })
    .alias('.cleartags')
    .option('collection', '-c <collection:string> 仅清空指定合集的图片标签')
    .action(async ({ session, options }) => {
      const service = ctx.memesluna
      await service.ready

      const filter: any = {}
      if (options?.collection) {
        const hasCol = await service.collectionExists(options.collection)
        if (!hasCol) {
          return `表情包合集 "${options.collection}" 不存在。`
        }
        filter.collection = options.collection
      }

      const images = await ctx.database.get('memesluna_images', filter)
      const targets = images.filter((img) => parseJsonStringArray(img.tags).length > 0)

      if (targets.length === 0) {
        return '没有发现需要清空标签的图片。'
      }

      if (session) {
        await session.send(`开始清空 ${targets.length} 张表情图片的标签，请稍候...`)
      }

      let successCount = 0
      for (const row of targets) {
        try {
          await service.updateImageAnnotation(row.id, undefined, [])
          successCount++
        } catch (err) {
          ctx.logger('memesluna').error(`Failed clearing tag for ${row.filename}:`, err)
        }
      }

      return `已成功清空 ${successCount} 张表情图片的标签！`
    })
}
