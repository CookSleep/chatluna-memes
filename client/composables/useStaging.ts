import { computed, ref, type Ref } from 'vue'
import { sendChatLunaMemes } from './rpc'
import { settledBatch } from './batch'
import { fileToBase64 } from '../utils/format'
import { applyClickSelection, type ClickModifiers } from '../utils/selection'
import type { ShowToast } from './useToast'
import type { DialogOptions } from './useDialog'
import type {
  ConsoleCollectionInfo as CollectionInfo,
  ConsoleSimilarStagedImageGroup as SimilarStagedImageGroup,
  ConsoleStagedImageInfo as StagedImageInfo,
} from '../../src/console-rpc'

interface SimilarStagedImageGroupView extends SimilarStagedImageGroup {
  label: string
}

interface StagingDeps {
  loading: Ref<boolean>
  currentCollection: Ref<CollectionInfo | null>
  showToast: ShowToast
  confirmDialog: (options: Omit<DialogOptions, 'input' | 'choices'>) => Promise<boolean>
  pickCollection: (title: string, message?: string, exclude?: string) => Promise<string | null>
  fetchState: () => Promise<void>
  loadCollectionResources: (name: string) => Promise<void>
}

/** 暂缓区：列表、相似分组、多选以及归档和删除。 */
export function useStaging({ loading, currentCollection, showToast, confirmDialog, pickCollection, fetchState, loadCollectionResources }: StagingDeps) {
  const stagedImages = ref<StagedImageInfo[]>([])
  const stagingSearch = ref('')
  const stagingTargetCollection = ref<Record<string, string>>({})
  const stagingBusyId = ref('')
  const stagingViewMode = ref<'all' | 'similar'>('all')
  const similarGroups = ref<SimilarStagedImageGroup[]>([])
  const similarLoading = ref(false)
  const similarMessage = ref('')
  const selectedStagedIds = ref<Set<string>>(new Set())

  const filteredStagedImages = computed(() => {
    const query = stagingSearch.value.trim().toLowerCase()
    if (!query) return stagedImages.value
    return stagedImages.value.filter((item) => {
      return item.filename.toLowerCase().includes(query)
        || item.originalName.toLowerCase().includes(query)
        || item.source.toLowerCase().includes(query)
        || item.reason.toLowerCase().includes(query)
    })
  })
  const filteredSimilarGroups = computed<SimilarStagedImageGroupView[]>(() => {
    const visibleIds = new Set(filteredStagedImages.value.map((item) => item.id))
    return similarGroups.value
      .map((group, index) => ({
        ...group,
        label: String(index + 1),
        items: group.items.filter((item) => visibleIds.has(item.id)),
      }))
      .filter((group) => group.items.length > 1)
  })

  const similarStagedImages = computed(() => {
    const map = new Map<string, StagedImageInfo>()
    for (const group of filteredSimilarGroups.value) {
      for (const item of group.items) map.set(item.id, item)
    }
    return Array.from(map.values())
  })

  const selectedStagedImages = computed(() => Array.from(selectedStagedIds.value))
  const areAllCurrentPageStagedSelected = computed(() => {
    const items = filteredStagedImages.value
    return items.length > 0 && items.every((item) => selectedStagedIds.value.has(item.id))
  })

  function isStagedSelected(id: string): boolean {
    return selectedStagedIds.value.has(id)
  }

  const stagedSelectionOrder = computed(() => new Map(Array.from(selectedStagedIds.value, (id, index) => [id, index + 1])))
  function getStagedSelectionIndex(id: string): number {
    return stagedSelectionOrder.value.get(id) || 0
  }

  let stagedSelectionAnchor: string | null = null

  /** 已有选中项或按住修饰键时点击图片只做选择，否则打开原图。 */
  function handleStagedClick(item: StagedImageInfo, orderedIds: string[], event: ClickModifiers, open: () => void) {
    const result = applyClickSelection(selectedStagedIds.value, item.id, orderedIds, stagedSelectionAnchor, event)
    if (!result) return open()
    selectedStagedIds.value = result.next
    stagedSelectionAnchor = result.anchor
  }

  function selectAllStaged() {
    selectedStagedIds.value = new Set([...selectedStagedIds.value, ...filteredStagedImages.value.map((item) => item.id)])
  }

  function toggleStagedSelection(id: string) {
    stagedSelectionAnchor = id
    const next = new Set(selectedStagedIds.value)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    selectedStagedIds.value = next
  }

  function toggleSelectAllStaged() {
    const next = new Set(selectedStagedIds.value)
    if (areAllCurrentPageStagedSelected.value) {
      filteredStagedImages.value.forEach((item) => next.delete(item.id))
    } else {
      filteredStagedImages.value.forEach((item) => next.add(item.id))
    }
    selectedStagedIds.value = next
  }

  function clearSelectedStaged() {
    selectedStagedIds.value = new Set()
  }

  async function batchDeleteStagedImages() {
    const ids = selectedStagedImages.value
    if (!ids.length) return
    if (!await confirmDialog({ title: `删除 ${ids.length} 张待审核图片？`, message: '删除后无法恢复。', confirmText: '删除', danger: true })) return

    try {
      loading.value = true
      const results = await settledBatch(ids, async (id) => {
        if (!await sendChatLunaMemes('chatluna-memes/deleteStagedImage', id)) throw new Error('删除失败')
      })
      const failed = ids.filter((_, index) => results[index].status === 'rejected')
      showToast(failed.length ? `已删除 ${ids.length - failed.length} 张，${failed.length} 张失败` : `已删除 ${ids.length} 张`, failed.length ? 'error' : 'success')
      selectedStagedIds.value = new Set(failed)
      await refreshStagedImages()
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '批量删除暂缓图片失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function confirmDeleteAllStagedImages() {
    if (!stagedImages.value.length) return
    if (!await confirmDialog({ title: '清空暂缓区？', message: `将删除全部 ${stagedImages.value.length} 张待审核图片，无法恢复。`, confirmText: '全部删除', danger: true })) return

    try {
      loading.value = true
      const deleted = await sendChatLunaMemes('chatluna-memes/deleteAllStagedImages')
      showToast(`已清空，共删除 ${deleted} 张`, 'success')
      clearSelectedStaged()
      await refreshStagedImages()
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '清空暂缓区失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function refreshStagedImages() {
    try {
      const list = await sendChatLunaMemes('chatluna-memes/getStagedImages')
      stagedImages.value = Array.isArray(list) ? list : []
      // 相似分组随列表自动计算，用户不需要先切换模式才能看到或处理。
      if (stagedImages.value.length >= 2) {
        await loadSimilarStagedImages()
      } else {
        similarGroups.value = []
        similarMessage.value = ''
        stagingViewMode.value = 'all'
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '刷新暂缓区失败', 'error')
    }
  }
  async function loadSimilarStagedImages() {
    similarLoading.value = true
    try {
      const result = await sendChatLunaMemes('chatluna-memes/getSimilarStagedImages')
      similarGroups.value = Array.isArray(result?.groups) ? result.groups : []
      similarMessage.value = result?.message || ''

    } catch (err) {
      similarGroups.value = []
      similarMessage.value = ''
      similarMessage.value = err instanceof Error ? err.message : '相似图片分组失败'
    } finally {
      similarLoading.value = false
    }
  }

  function setStagingViewMode(mode: 'all' | 'similar') {
    stagingViewMode.value = mode
  }

  /** 图片 id → 相似组编号，用于在全部视图中标记。 */
  const similarGroupLabelById = computed(() => {
    const map = new Map<string, { label: string; size: number }>()
    similarGroups.value.forEach((group, index) => {
      if (group.items.length < 2) return
      for (const item of group.items) map.set(item.id, { label: String(index + 1), size: group.items.length })
    })
    return map
  })

  function getSimilarBadge(id: string) {
    return similarGroupLabelById.value.get(id)
  }

  async function promoteStagedImage(item: StagedImageInfo, targetCollection?: string) {
    const target = (targetCollection || stagingTargetCollection.value[item.id] || '').trim()
      || await pickCollection('归档到表情包', item.originalName || item.filename) || ''
    if (!target) return
    stagingBusyId.value = item.id
    try {
      const filename = await sendChatLunaMemes('chatluna-memes/promoteStagedImage', item.id, target)
      if (filename) {
        showToast(`已归档到「${target}」`, 'success')
        delete stagingTargetCollection.value[item.id]
        selectedStagedIds.value = new Set([...selectedStagedIds.value].filter((id) => id !== item.id))
      } else {
        showToast('暂缓图片不存在或已被处理', 'error')
      }
      await refreshStagedImages()
      await fetchState()
      if (currentCollection.value?.name === target) {
        await loadCollectionResources(target)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '归档暂缓图片失败', 'error')
    } finally {
      stagingBusyId.value = ''
    }
  }

  async function batchPromoteStagedImages(ids = selectedStagedImages.value) {
    if (!ids.length) return
    const target = await pickCollection(`归档 ${ids.length} 张图片`, '选择要归档到的表情包')
    if (!target) return
    try {
      loading.value = true
      const results = await settledBatch(ids, async (id) => {
        if (!await sendChatLunaMemes('chatluna-memes/promoteStagedImage', id, target)) throw new Error('归档失败')
      }, 2)
      const failed = ids.filter((_, index) => results[index].status === 'rejected')
      const reason = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
      showToast(failed.length
        ? `已归档 ${ids.length - failed.length} 张到「${target}」，${failed.length} 张失败${reason instanceof Error ? `：${reason.message}` : ''}`
        : `已归档 ${ids.length} 张到「${target}」`, failed.length ? 'error' : 'success')
      selectedStagedIds.value = new Set(failed)
      await refreshStagedImages()
      await fetchState()
      if (currentCollection.value?.name === target) await loadCollectionResources(target)
    } finally {
      loading.value = false
    }
  }

  /** 相似组只保留一张（默认第一张），删除其余。 */
  async function keepOneInGroup(group: SimilarStagedImageGroup, keepId = group.items[0]?.id) {
    const ids = group.items.map((item) => item.id).filter((id) => id !== keepId)
    if (!ids.length) return
    if (!await confirmDialog({ title: `删除本组其余 ${ids.length} 张？`, message: '保留第一张，其余相似图片会被删除，无法恢复。', confirmText: '删除其余', danger: true })) return
    try {
      loading.value = true
      const results = await settledBatch(ids, async (id) => {
        if (!await sendChatLunaMemes('chatluna-memes/deleteStagedImage', id)) throw new Error('删除失败')
      })
      const failed = results.filter((result) => result.status === 'rejected').length
      showToast(failed ? `已删除 ${ids.length - failed} 张，${failed} 张失败` : `已删除 ${ids.length} 张相似图片`, failed ? 'error' : 'success')
      selectedStagedIds.value = new Set([...selectedStagedIds.value].filter((id) => !ids.includes(id)))
      await refreshStagedImages()
      await fetchState()
    } finally {
      loading.value = false
    }
  }

  function selectGroup(group: SimilarStagedImageGroup) {
    const next = new Set(selectedStagedIds.value)
    const all = group.items.every((item) => next.has(item.id))
    for (const item of group.items) all ? next.delete(item.id) : next.add(item.id)
    selectedStagedIds.value = next
  }

  async function deleteStagedImage(item: StagedImageInfo) {
    if (!await confirmDialog({ title: '删除这张图片？', message: item.originalName || item.filename, confirmText: '删除', danger: true })) return

    stagingBusyId.value = item.id
    try {
      const deleted = await sendChatLunaMemes('chatluna-memes/deleteStagedImage', item.id)
      if (deleted) {
        showToast('已删除', 'success')
        delete stagingTargetCollection.value[item.id]
      } else {
        showToast('暂缓图片不存在或已被处理', 'error')
      }
      await refreshStagedImages()
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除暂缓图片失败', 'error')
    } finally {
      stagingBusyId.value = ''
    }
  }

  async function stageFilteredFiles(items: Array<{ file: File; reason: string }>): Promise<number> {
    let saved = 0
    for (const item of items) {
      try {
        const base64 = await fileToBase64(item.file)
        await sendChatLunaMemes('chatluna-memes/addStagedImage', {
          base64,
          originalName: item.file.name,
          source: currentCollection.value ? `upload:${currentCollection.value.name}` : 'upload-filter',
          reason: item.reason,
        })
        saved++
      } catch (err) {
        console.error('Failed to stage filtered image:', item.file.name, err)
      }
    }
    if (saved) {
      await refreshStagedImages()
    }
    return saved
  }

  return {
    stagedImages, stagingSearch, stagingBusyId, stagingViewMode, similarGroups, similarLoading, similarMessage,
    selectedStagedIds, filteredStagedImages, filteredSimilarGroups, similarStagedImages,
    areAllCurrentPageStagedSelected, isStagedSelected, getStagedSelectionIndex, toggleStagedSelection,
    toggleSelectAllStaged, selectAllStaged, handleStagedClick, clearSelectedStaged, batchDeleteStagedImages, confirmDeleteAllStagedImages,
    refreshStagedImages, setStagingViewMode, getSimilarBadge, promoteStagedImage, batchPromoteStagedImages,
    keepOneInGroup, selectGroup, deleteStagedImage, stageFilteredFiles,
  }
}
