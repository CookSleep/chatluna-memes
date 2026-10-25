/** 至少需要一次强相关命中（短语命中别名或标签、分词命中别名或标签）才进入候选。 */
export const SEARCH_SCORE_THRESHOLD = 6

/** 图片数超过此值时先用倒排索引筛候选，再对候选完整评分。 */
export const SEARCH_INVERTED_INDEX_THRESHOLD = 500

export const SEARCH_SCORING = {
  PHRASE_ALIAS: 12,
  PHRASE_TAG: 8,
  PHRASE_FILENAME: 4,
  TERM_ALIAS: 6,
  TERM_TAG: 6,
  TERM_FILENAME: 2,
  BONUS_TWO_TERMS: 2,
  BONUS_THREE_TERMS: 2,
} as const

/** 跨表情包搜索共享的全表缓存有效期，写操作后会主动失效。 */
export const ALL_IMAGES_CACHE_TTL = 5 * 60 * 1000

/** 频率记录超过此条数时清理最老的一部分，防止内存无限增长。 */
export const MAX_FREQUENCY_TRACKER_SIZE = 50000
export const FREQUENCY_TRACKER_CLEANUP_RATIO = 0.25

export const MAX_ALIASES_COUNT = 15
export const MAX_TAGS_COUNT = 5
export const MAX_ANNOTATION_ITEM_LENGTH = 12

export const MAX_METADATA_ALIASES = 30
export const MAX_METADATA_TAGS = 5
export const MAX_METADATA_ITEM_LENGTH = 24

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024
export const MAX_UPLOAD_FILES = 32
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024

/** 超过此大小的图片先压缩再发给模型，减少请求体积并避开大图报错。 */
export const AI_IMAGE_COMPRESSION_THRESHOLD = 30 * 1024
export const AI_IMAGE_TARGET_SIZE = 512
export const AI_IMAGE_JPEG_QUALITY = 75

export const BACKFILL_CONCURRENCY = 4

export const DHASH_BITS = 64
export const DHASH_WIDTH = 9
export const DHASH_HEIGHT = 8

export const IMAGE_DOWNLOAD_MAX_RETRIES = 3
export const IMAGE_DOWNLOAD_TIMEOUT = 10000
export const IMAGE_DOWNLOAD_RETRY_DELAY = 1000
