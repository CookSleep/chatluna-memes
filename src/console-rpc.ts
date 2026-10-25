import type { Settings, SettingsPatchResult } from './settings'
import type {} from '@koishijs/plugin-console'

export type ConsoleDate = string | Date

export interface ConsoleEndpointInfo {
  id: string
  name: string
  group: string
  description: string
  url: string
  method: 'redirect'
  createdAt?: ConsoleDate
  updatedAt?: ConsoleDate
}

export interface ConsoleEndpointInput {
  name: string
  group?: string
  description?: string
  url: string
  method?: 'redirect'
}

export interface ConsoleCollectionInfo {
  name: string
  description: string
  totalCount: number
  localCount: number
  linkCount: number
  hasContent: boolean
  createdAt?: ConsoleDate
  updatedAt?: ConsoleDate
  apiCallCount?: number
  cover?: string
}

export interface ConsoleStagedImageInfo {
  id: string
  filename: string
  originalName: string
  source: string
  reason: string
  mime: string
  size: number
  createdAt: ConsoleDate
  hash?: string
  perceptualHash?: string
}

export interface ConsoleSimilarStagedImageGroup {
  id: string
  items: ConsoleStagedImageInfo[]
  similarity: number
}

export interface ConsoleSimilarStagedImagesResult {
  available: boolean
  threshold: number
  groups: ConsoleSimilarStagedImageGroup[]
  message: string
}

export interface ConsoleAutoCollectSettings {
  enabled: boolean
  windowMinutes: number
  threshold: number
  minSizeKB: number
  maxSizeMB: number
  dailyLimit: number
}

/** 管理页展示用的配置摘要，只读。 */
export interface ConsoleSettingsSummary {
  injectVariables: boolean
  annotatorReady: boolean
  autoAnnotate: boolean
  stagingRetentionDays: number
  autoCollect: ConsoleAutoCollectSettings
}

export interface ConsoleModelOption {
  name: string
  /** 模型声明了图片输入能力。 */
  vision: boolean
}

export interface ConsoleSettingsPayload {
  settings: Settings
  models: ConsoleModelOption[]
  chatlunaAvailable: boolean
  annotatorReady: boolean
  /** Koishi server 插件推导出的地址，selfUrl 留空时使用。 */
  serverSelfUrl: string
}

export interface ConsoleState {
  backendPath: string
  endpoints: ConsoleEndpointInfo[]
  collections: ConsoleCollectionInfo[]
  stagedImages: ConsoleStagedImageInfo[]
  settings?: ConsoleSettingsSummary
}

export interface AddStagedImagePayload {
  base64: string
  originalName?: string
  source?: string
  reason?: string
}

export interface ImageMetadataPayload {
  collectionName: string
  filename: string
  aliases?: string[]
  tags?: string[]
  mode?: 'add' | 'replace'
}

export interface CollectionPageQuery {
  offset?: number
  limit?: number
  type?: 'all' | 'local' | 'external'
  search?: string
  sort?: 'name' | 'nameDesc'
  selected?: string[]
}

export interface CollectionResourceItem {
  id: string
  type: 'local' | 'external'
  filename: string
  value: string
  tags: string[]
  aliases: string[]
}

export interface CollectionResourcePage {
  items: CollectionResourceItem[]
  total: number
  offset: number
  limit: number
}

export interface AnnotationStatus {
  pending: number
  active: number
  success: number
  fail: number
  skipped: number
  cancelled: number
  requests?: { active: number; pending: number }
  usage?: { dailyCount: number; dailyLimit: number; remaining: number; requests: number; retries: number; successes: number; failures: number }
}

export interface ImageMetadataResult {
  ok: boolean
  error?: string
  aliases?: string[]
  tags?: string[]
}

export interface MemesLunaConsoleEvents {
  'memesluna/getState'(): Promise<ConsoleState>
  'memesluna/getSettings'(): Promise<ConsoleSettingsPayload>
  'memesluna/updateSettings'(patch: Partial<Settings>): Promise<SettingsPatchResult>
  'memesluna/createCollection'(name: string): Promise<boolean>
  'memesluna/deleteCollection'(name: string): Promise<boolean>
  'memesluna/setCollectionDescription'(name: string, description: string): Promise<boolean>
  'memesluna/renameCollection'(name: string, newName: string): Promise<boolean>
  'memesluna/deleteLocalImage'(collectionName: string, filename: string): Promise<boolean>
  'memesluna/moveLocalImage'(sourceCollection: string, targetCollection: string, filename: string): Promise<string | null>
  'memesluna/addLinks'(collectionName: string, linksText: string): Promise<number>
  'memesluna/moveLink'(sourceCollection: string, targetCollection: string, link: string): Promise<boolean>
  'memesluna/deleteLink'(collectionName: string, link: string): Promise<boolean>
  'memesluna/createEndpoint'(payload: ConsoleEndpointInput): Promise<string>
  'memesluna/updateEndpoint'(name: string, payload: ConsoleEndpointInput): Promise<boolean>
  'memesluna/deleteEndpoint'(name: string): Promise<boolean>
  'memesluna/getStagedImages'(): Promise<ConsoleStagedImageInfo[]>
  'memesluna/getSimilarStagedImages'(): Promise<ConsoleSimilarStagedImagesResult>
  'memesluna/addStagedImage'(payload: AddStagedImagePayload): Promise<ConsoleStagedImageInfo>
  'memesluna/deleteStagedImage'(id: string): Promise<boolean>
  'memesluna/promoteStagedImage'(id: string, collectionName: string): Promise<string | null>
  'memesluna/getBaseUrl'(): Promise<string>
  'memesluna/deleteAllStagedImages'(): Promise<number>
  'memesluna/annotateImage'(collectionName: string, filename: string, options?: { preview?: boolean }): Promise<ImageMetadataResult>
  'memesluna/updateImageMetadata'(payload: ImageMetadataPayload): Promise<ImageMetadataResult>
  'memesluna/getImageMetadata'(collectionName: string, filename: string): Promise<ImageMetadataResult>
  'memesluna/getCollectionResources'(collectionName: string, query?: CollectionPageQuery): Promise<CollectionResourcePage>
  'memesluna/getAnnotationStatus'(): Promise<AnnotationStatus>
  'memesluna/cancelAnnotations'(): Promise<boolean>
}

declare module '@koishijs/plugin-console' {
  interface Events extends MemesLunaConsoleEvents {}
}
