import { Context } from 'koishi'
import { MAX_RETRY_DELAY, type Settings } from './settings'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { loadOptionalSharp, loadPhoton } from './service'
import { AIUsageTracker } from './aiUsageTracker'
import {
  MAX_ALIASES_COUNT,
  MAX_TAGS_COUNT,
  MAX_ANNOTATION_ITEM_LENGTH,
  AI_IMAGE_COMPRESSION_THRESHOLD,
  AI_IMAGE_TARGET_SIZE,
  AI_IMAGE_JPEG_QUALITY,
} from './constants'
import { getImageMimeFromBytes } from './image-format'
import { normalizeMetadataList, getDailyKey } from './utils'
import { AnnotationScheduler, abortableDelay } from './annotation-scheduler'

const tryParse = <T>(text: string): T | null => {
    try {
        return JSON.parse(text.trim())
    } catch {
        return null
    }
}

const extractors = [
    (text: string) => text.trim(),
    (text: string) =>
        text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```\s*$/g, ''),
    (text: string) => {
        const start = text.indexOf('{'),
            end = text.lastIndexOf('}')
        return start !== -1 && end !== -1 && start < end
            ? text.substring(start, end + 1)
            : text
    },
    (text: string) => {
        const start = text.indexOf('{')
        if (start === -1) return text
        let count = 0,
            end = -1
        for (let i = start; i < text.length; i++) {
            if (text[i] === '{') count++
            else if (text[i] === '}' && --count === 0) {
                end = i
                break
            }
        }
        return end !== -1 ? text.substring(start, end + 1) : text
    }
]

export interface AnnotateResult {
    aliases: string[]
    tags: string[]
}

export interface AnnotateContext {
    filename?: string
    collectionName?: string
    imageUrl?: string
}

function normalizeAnnotationList(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value)) return []
    return normalizeMetadataList(
        value.filter((item): item is string => typeof item === 'string'),
        maxItems,
        maxLength
    )
}

async function compressImageForAI(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
    const originalMime = getImageMimeFromBytes(buffer)
    // GIF 不论大小都转成 JPEG 再发送。
    if (buffer.length < AI_IMAGE_COMPRESSION_THRESHOLD && originalMime !== 'image/gif') {
        return { buffer, mimeType: originalMime }
    }

    const sharp = loadOptionalSharp()
    if (sharp) {
        try {
            const compressed = await sharp(buffer)
                .resize(AI_IMAGE_TARGET_SIZE, AI_IMAGE_TARGET_SIZE, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: AI_IMAGE_JPEG_QUALITY })
                .toBuffer()
            return { buffer: compressed, mimeType: 'image/jpeg' }
        } catch {
            // sharp 不可用时改用 photon。
        }
    }

    const photon = loadPhoton()
    if (photon) {
        let img: any = null
        try {
            img = photon.PhotonImage.new_from_byteslice(new Uint8Array(buffer))
            const w = img.get_width()
            const h = img.get_height()
            if (w > AI_IMAGE_TARGET_SIZE || h > AI_IMAGE_TARGET_SIZE) {
                const ratio = Math.min(AI_IMAGE_TARGET_SIZE / w, AI_IMAGE_TARGET_SIZE / h)
                const newW = Math.round(w * ratio)
                const newH = Math.round(h * ratio)
                const resized = photon.resize(img, newW, newH, photon.SamplingFilter.Nearest)
                img.free()
                img = resized
            }
            const jpegBytes = img.get_bytes_jpeg(AI_IMAGE_JPEG_QUALITY)
            img.free()
            return { buffer: Buffer.from(jpegBytes), mimeType: 'image/jpeg' }
        } catch (err) {
            if (img) {
                try { img.free() } catch {}
            }
        }
    }

    return { buffer, mimeType: originalMime }
}

export class AIAnnotator {
    private _model: ComputedRef<ChatLunaChatModel> | null = null
    private usageTracker: AIUsageTracker
    private cancellation = new AbortController()
    private disposed = false
    private scheduler = new AnnotationScheduler(() => this.config.aiConcurrency || 2)

    get taskStats() { return this.scheduler.stats }

    cancelPending() { this.cancellation.abort(); if (!this.disposed) this.cancellation = new AbortController() }
    dispose() { this.disposed = true; this.cancellation.abort() }

    constructor(
        private ctx: Context,
        private config: Settings
    ) {
        ctx.on('dispose', () => this.dispose())
        this.usageTracker = new AIUsageTracker(ctx, () => config.aiDailyLimit)
    }

    get model() {
        return this._model
    }

    getUsageStats() {
        return this.usageTracker.getStats()
    }

    /** 返回模型是否加载成功；失败时调用方不应挂载标注器。 */
    async initialize(): Promise<boolean> {
        await this.usageTracker.initialize()
        if (!this.config.model) return false

        try {
            const [platform] = parseRawModelName(this.config.model)
            await this.ctx.chatluna.awaitLoadPlatform(platform)
            this._model = await this.ctx.chatluna.createChatModel(
                this.config.model
            )
            this.ctx.logger.success('AI标注模型加载成功')
            return true
        } catch (error) {
            this.ctx.logger.error('AI标注模型加载失败:', error)
            return false
        }
    }

    private parseResult(text: string): AnnotateResult | null {
        for (const extractor of extractors) {
            const extracted = extractor(text)
            const parsed = tryParse<AnnotateResult>(extracted)
            if (
                parsed &&
                Array.isArray(parsed.aliases) &&
                Array.isArray(parsed.tags)
            ) {
                const aliases = normalizeAnnotationList(parsed.aliases, MAX_ALIASES_COUNT, MAX_ANNOTATION_ITEM_LENGTH)
                const tags = normalizeAnnotationList(parsed.tags, MAX_TAGS_COUNT, MAX_ANNOTATION_ITEM_LENGTH)
                return { aliases, tags }
            }
        }
        this.ctx.logger.error(`AI标注结果解析失败: ${text}`)
        return null
    }

    async annotate(buffer: Buffer, context?: AnnotateContext): Promise<AnnotateResult | null> {
        if (!this._model?.value) return null
        if (buffer.length === 0) return null

        const signal = this.cancellation.signal
        if (signal.aborted) return null

        let prompt = this.config.annotatePrompt

        if (context) {
            prompt = prompt
                .replaceAll('{{filename}}', context.filename || '')
                .replaceAll('{{collection_name}}', context.collectionName || '')
                .replaceAll('{{image_url}}', context.imageUrl || '')
        }

        const humanText = '请为这张表情包生成标注。'

        const compressed = await compressImageForAI(buffer)

        for (let attempt = 0; attempt < this.config.aiMaxAttempts; attempt++) {
            if (signal.aborted) return null
            if (attempt > 0) {
                const delay =
                    Math.min(this.config.aiRetryDelay * Math.pow(2, attempt - 1), MAX_RETRY_DELAY) * 1000
                try { await abortableDelay(delay, signal) } catch { return null }
            }

            try {
                const images = [{ data: compressed.buffer.toString('base64'), mimeType: compressed.mimeType }]
                let reserved = false
                let day = getDailyKey()
                const result = await this.scheduler.run(async (requestSignal) => {
                    if (requestSignal.aborted) throw new Error('Annotation cancelled')
                    if (!await this.usageTracker.reserveRequest(attempt > 0, (reservedDay) => { day = reservedDay })) throw new Error('AI daily request limit reached')
                    reserved = true
                    if (requestSignal.aborted) throw new Error('Annotation cancelled')
                    return this._model!.value.invoke([
                    new SystemMessage(prompt),
                    new HumanMessage({
                        content: [
                            { type: 'text', text: humanText },
                            ...images.map((image) => ({
                                type: 'image_url' as const,
                                image_url: {
                                    url: `data:${image.mimeType};base64,${image.data}`,
                                    detail: 'low' as const
                                }
                            }))
                        ]
                    })
                ], { signal: requestSignal, timeout: this.config.aiRequestTimeout * 1000 })

                }, signal, this.config.aiRequestTimeout * 1000).catch(async (error) => {
                    if (reserved) await this.usageTracker.recordResult(false, day)
                    throw error
                })

                const parsed = this.parseResult(
                    getMessageContent(result.content)
                )
                await this.usageTracker.recordResult(!!parsed, day)
                if (parsed && !signal.aborted) return parsed
            } catch (error) {
                if (signal.aborted || (error as Error).message === 'AI daily request limit reached') return null
                this.ctx.logger.warn(
                    `AI标注失败 (attempt ${attempt + 1}/${this.config.aiMaxAttempts}):`,
                    error
                )
            }
        }

        return null
    }
}
