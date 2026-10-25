import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useDashboard } from '../client/composables/useDashboard'

const mocks = vi.hoisted(() => ({ send: vi.fn(), cleanup: [] as Array<() => void> }))
vi.mock('@koishijs/client', () => ({ send: mocks.send, store: { user: { token: 'session' } } }))
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return { ...vue, onMounted: () => {}, onUnmounted: (callback: () => void) => mocks.cleanup.push(callback) }
})

beforeEach(() => {
  vi.useFakeTimers()
  mocks.send.mockReset()
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  vi.stubGlobal('window', { location: { origin: 'http://localhost', href: 'http://localhost/console' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  for (const callback of mocks.cleanup.splice(0)) callback()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const collection: any = { name: 'collection', description: '', totalCount: 50, localCount: 50, linkCount: 0, hasContent: true }

describe('Dashboard 分页及标注交互', () => {
  it('只加载当前页及其标注，翻页请求新页且保留完整合集数量', async () => {
    mocks.send.mockImplementation(async (event, _name, query) => {
      if (event !== 'chatluna-memes/getCollectionResources') throw new Error('Unexpected RPC')
      return {
        total: 50, offset: query.offset || 0, limit: query.limit,
        items: Array.from({ length: Math.min(query.limit, 50 - (query.offset || 0)) }, (_, index) => ({ id: String(index), type: 'local', filename: `image${(query.offset || 0) + index}.png`, value: '', tags: ['已加载标签'], aliases: ['别名'] })),
      }
    })
    const dashboard = useDashboard()
    await dashboard.enterCollectionDetail(collection)
    expect(dashboard.paginatedGalleryItems.value).toHaveLength(24)
    expect(dashboard.totalPages.value).toBe(3)
    expect(dashboard.currentCollectionTotalCount.value).toBe(50)
    expect(dashboard.getImageTags('image0.png')).toEqual(['已加载标签'])
    dashboard.currentPage.value = 2
    await nextTick()
    await vi.advanceTimersByTimeAsync(120)
    expect(dashboard.paginatedGalleryItems.value).toHaveLength(24)
    expect(dashboard.paginatedGalleryItems.value[0].value).toBe('image24.png')
    expect(mocks.send).toHaveBeenLastCalledWith('chatluna-memes/getCollectionResources', 'collection', expect.objectContaining({ offset: 24, limit: 24 }))
  })
  it('批量追加不依赖本地标注缓存，业务失败项保持选中供重试', async () => {
    mocks.send.mockImplementation(async (event, payload) => {
      if (event !== 'chatluna-memes/updateImageMetadata') throw new Error('Unexpected RPC')
      return payload.filename === 'b.png' ? { ok: false, error: '图片不存在' } : { ok: true, tags: ['已有标签', '新标签'], aliases: ['已有别名'] }
    })
    const dashboard = useDashboard()
    dashboard.currentCollection.value = collection
    dashboard.selectedImageSet.value = new Set(['a.png', 'b.png'])
    dashboard.bulkTagEditorTags.value = ['新标签']
    dashboard.bulkTagOperationMode.value = 'add'
    await dashboard.saveBulkTagEditor()
    expect(mocks.send).toHaveBeenCalledWith('chatluna-memes/updateImageMetadata', expect.objectContaining({ filename: 'a.png', tags: ['新标签'], mode: 'add' }))
    expect(dashboard.selectedImages.value).toEqual(['b.png'])
    expect(dashboard.imageTagsCache.value['collection/a.png']).toEqual(['已有标签', '新标签'])
    expect(dashboard.toast.message).toContain('成功 1 张，失败 1 张')
    expect(dashboard.imageTagsCache.value['collection/b.png']).toBeUndefined()
  })
  it('标注改为手动保存：编辑不发请求，保存时带上未回车的输入，保存中重复点击不重复提交', async () => {
    let finish: (value: any) => void
    mocks.send.mockResolvedValueOnce({ ok: true, tags: ['原有'], aliases: [] })
    const dashboard = useDashboard()
    await dashboard.openTagEditor('collection', 'a.png')
    expect(dashboard.tagEditorDirty.value).toBe(false)

    dashboard.tagEditorInput.value = '新增'
    dashboard.addTagFromEditor()
    dashboard.aliasEditorInput.value = '没按回车的别名'
    expect(dashboard.tagEditorDirty.value).toBe(true)
    expect(mocks.send).toHaveBeenCalledTimes(1)

    mocks.send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const saving = dashboard.saveTagEditor()
    void dashboard.saveTagEditor()
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send).toHaveBeenLastCalledWith('chatluna-memes/updateImageMetadata', expect.objectContaining({
      tags: ['原有', '新增'], aliases: ['没按回车的别名'],
    }))
    finish!({ ok: true, tags: ['原有', '新增'], aliases: ['没按回车的别名'] })
    await saving
    expect(dashboard.tagEditorVisible.value).toBe(false)
    expect(dashboard.tagEditorSaving.value).toBe(false)
  })
})
