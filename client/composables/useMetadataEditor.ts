import { computed, ref, type Ref, type ComputedRef } from 'vue'
import { sendChatLunaMemes } from './rpc'
import { settledBatch } from './batch'
import type { ShowToast } from './useToast'
import type { DialogOptions } from './useDialog'
import type { ConsoleCollectionInfo as CollectionInfo } from '../../src/console-rpc'

interface MetadataEditorDeps {
  currentCollection: Ref<CollectionInfo | null>
  selectedImages: ComputedRef<string[]>
  selectedImageSet: Ref<Set<string>>
  showToast: ShowToast
  confirmDialog: (options: Omit<DialogOptions, 'input' | 'choices'>) => Promise<boolean>
}

/** 单张与批量的标签、别名编辑，以及当前页图片的标注缓存。 */
export function useMetadataEditor({ currentCollection, selectedImages, selectedImageSet, showToast, confirmDialog }: MetadataEditorDeps) {
  // 单张编辑
  const tagEditorVisible = ref(false)
  const tagEditorImage = ref('')
  const tagEditorCollection = ref('')
  const tagEditorTags = ref<string[]>([])
  const tagEditorAliases = ref<string[]>([])
  const tagEditorInput = ref('')
  const aliasEditorInput = ref('')
  const tagEditorSaving = ref(false)
  const aiAnnotating = ref(false)
  const imageTagsCache = ref<Record<string, string[]>>({})
  const imageAliasesCache = ref<Record<string, string[]>>({})
  // 打开时的标注，用来判断有没有未保存的修改。
  const tagEditorOriginal = ref({ tags: [] as string[], aliases: [] as string[] })
  const aiFilled = ref(false)
  const tagEditorDirty = computed(() => {
    const { tags, aliases } = tagEditorOriginal.value
    return tagEditorTags.value.join('\n') !== tags.join('\n')
      || tagEditorAliases.value.join('\n') !== aliases.join('\n')
      || !!tagEditorInput.value.trim() || !!aliasEditorInput.value.trim()
  })
  let tagEditorLoad = 0

  // 批量编辑
  const bulkTagEditorVisible = ref(false)
  const bulkTagEditorTags = ref<string[]>([])
  const bulkTagEditorAliases = ref<string[]>([])
  const bulkTagEditorInput = ref('')
  const bulkAliasEditorInput = ref('')
  const bulkTagEditorSaving = ref(false)
  const bulkTagOperationMode = ref<'add' | 'replace'>('add')

  function openBulkTagEditor() {
    bulkTagEditorTags.value = []
    bulkTagEditorAliases.value = []
    bulkTagEditorInput.value = ''
    bulkAliasEditorInput.value = ''
    bulkTagOperationMode.value = 'add'
    bulkTagEditorVisible.value = true
  }

  function addTagToBulkEditor() {
    const tag = bulkTagEditorInput.value.trim()
    if (!tag) return
    if (bulkTagEditorTags.value.includes(tag)) return
    bulkTagEditorTags.value = [...bulkTagEditorTags.value, tag]
    bulkTagEditorInput.value = ''
  }

  function removeTagFromBulkEditor(tag: string) {
    bulkTagEditorTags.value = bulkTagEditorTags.value.filter(t => t !== tag)
  }

  function addAliasToBulkEditor() {
    const alias = bulkAliasEditorInput.value.trim()
    if (!alias || bulkTagEditorAliases.value.includes(alias)) return
    bulkTagEditorAliases.value = [...bulkTagEditorAliases.value, alias]
    bulkAliasEditorInput.value = ''
  }

  function removeAliasFromBulkEditor(alias: string) {
    bulkTagEditorAliases.value = bulkTagEditorAliases.value.filter(a => a !== alias)
  }

  async function saveBulkTagEditor() {
    if (!currentCollection.value || !selectedImages.value.length) return
    bulkTagEditorSaving.value = true

    const filenames = [...selectedImages.value]
    const collectionName = currentCollection.value.name
    const tags = [...bulkTagEditorTags.value]
    const aliases = [...bulkTagEditorAliases.value]
    const mode = bulkTagOperationMode.value

    try {
      const results = await settledBatch(filenames, async (filename) => {
        const result = await sendChatLunaMemes('chatluna-memes/updateImageMetadata', {
          collectionName, filename, tags, aliases, mode,
        })
        if (!result?.ok) throw new Error(result?.error || '标注保存失败')
        const key = getImageCacheKey(collectionName, filename)
        imageTagsCache.value[key] = result.tags || []
        imageAliasesCache.value[key] = result.aliases || []
      })
      const failedNames = filenames.filter((_, index) => results[index].status === 'rejected')
      // 只处理了本地图片，选中的外链保持选中。
      if (currentCollection.value?.name === collectionName) {
        selectedImageSet.value = new Set([...Array.from(selectedImageSet.value).filter((value) => !filenames.includes(value)), ...failedNames])
      }
      showToast(`批量编辑完成：成功 ${filenames.length - failedNames.length} 张，失败 ${failedNames.length} 张`, failedNames.length ? 'error' : 'success')
      if (!failedNames.length) bulkTagEditorVisible.value = false

    } catch (err) {
      console.error('Failed to save bulk tags:', err)
      showToast('批量编辑标注失败', 'error')
    } finally {
      bulkTagEditorSaving.value = false
    }
  }

  function getImageCacheKey(collection: string, filename: string): string {
    return `${collection}/${filename}`
  }

  function getImageTags(filename: string): string[] {
    if (!currentCollection.value) return []
    return imageTagsCache.value[getImageCacheKey(currentCollection.value.name, filename)] || []
  }

  async function openTagEditor(collection: string, filename: string) {
    const generation = ++tagEditorLoad
    tagEditorCollection.value = collection
    tagEditorImage.value = filename
    tagEditorInput.value = ''
    aliasEditorInput.value = ''
    aiAnnotating.value = false
    aiFilled.value = false
    let tags: string[] = []
    let aliases: string[] = []
    try {
      const result = await sendChatLunaMemes('chatluna-memes/getImageMetadata', collection, filename)
      if (generation !== tagEditorLoad) return
      if (result?.ok) {
        tags = result.tags || []
        aliases = result.aliases || []
      }
    } catch {
      if (generation !== tagEditorLoad) return
    }
    tagEditorOriginal.value = { tags, aliases }
    tagEditorTags.value = [...tags]
    tagEditorAliases.value = [...aliases]
    tagEditorVisible.value = true
  }

  function addTagFromEditor() {
    const tag = tagEditorInput.value.trim()
    if (!tag) return
    if (!tagEditorTags.value.includes(tag)) tagEditorTags.value = [...tagEditorTags.value, tag]
    tagEditorInput.value = ''
  }

  function removeTagFromEditor(tag: string) {
    tagEditorTags.value = tagEditorTags.value.filter((t) => t !== tag)
  }

  function addAliasFromEditor() {
    const alias = aliasEditorInput.value.trim()
    if (!alias) return
    if (!tagEditorAliases.value.includes(alias)) tagEditorAliases.value = [...tagEditorAliases.value, alias]
    aliasEditorInput.value = ''
  }

  function removeAliasFromEditor(alias: string) {
    tagEditorAliases.value = tagEditorAliases.value.filter((a) => a !== alias)
  }

  /** AI 结果只填进表单，由用户确认后再保存。 */
  async function triggerAIAnnotation() {
    if (aiAnnotating.value || tagEditorSaving.value) return
    aiAnnotating.value = true
    const generation = tagEditorLoad
    try {
      const result = await sendChatLunaMemes('chatluna-memes/annotateImage', tagEditorCollection.value, tagEditorImage.value, { preview: true })
      if (generation !== tagEditorLoad) return
      if (result?.ok) {
        tagEditorTags.value = result.tags || []
        tagEditorAliases.value = result.aliases || []
        aiFilled.value = true
      } else {
        showToast(result?.error || 'AI 标注失败，请检查模型配置', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 标注失败', 'error')
    } finally {
      if (generation === tagEditorLoad) aiAnnotating.value = false
    }
  }

  async function saveTagEditor() {
    if (tagEditorSaving.value || aiAnnotating.value) return
    // 输入框里还没按回车的内容也一起保存，免得用户以为已经加上了。
    addTagFromEditor()
    addAliasFromEditor()
    const collection = tagEditorCollection.value
    const filename = tagEditorImage.value
    tagEditorSaving.value = true
    try {
      const result = await sendChatLunaMemes('chatluna-memes/updateImageMetadata', {
        collectionName: collection, filename, tags: [...tagEditorTags.value], aliases: [...tagEditorAliases.value],
      })
      if (!result?.ok) throw new Error(result?.error || '标注保存失败')
      const key = getImageCacheKey(collection, filename)
      imageTagsCache.value[key] = result.tags || []
      imageAliasesCache.value[key] = result.aliases || []
      showToast('已保存标注', 'success')
      resetTagEditor()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '标注保存失败', 'error')
    } finally {
      tagEditorSaving.value = false
    }
  }

  function resetTagEditor() {
    tagEditorLoad++
    tagEditorVisible.value = false
    tagEditorImage.value = ''
    tagEditorTags.value = []
    tagEditorAliases.value = []
    tagEditorInput.value = ''
    aliasEditorInput.value = ''
    aiAnnotating.value = false
    aiFilled.value = false
  }

  async function closeTagEditor() {
    if (tagEditorSaving.value) return
    if (tagEditorDirty.value && !await confirmDialog({ title: '放弃未保存的修改？', message: '关闭后，这次对标签和别名的修改不会保存。', confirmText: '放弃修改', danger: true })) return
    resetTagEditor()
  }

  return {
    tagEditorVisible, tagEditorImage, tagEditorCollection, tagEditorTags, tagEditorAliases,
    tagEditorInput, aliasEditorInput, tagEditorSaving, aiAnnotating, aiFilled, tagEditorDirty,
    imageTagsCache, imageAliasesCache, getImageCacheKey, getImageTags,
    openTagEditor, closeTagEditor, saveTagEditor, triggerAIAnnotation,
    addTagFromEditor, removeTagFromEditor, addAliasFromEditor, removeAliasFromEditor,
    bulkTagEditorVisible, bulkTagEditorTags, bulkTagEditorAliases, bulkTagEditorInput,
    bulkAliasEditorInput, bulkTagEditorSaving, bulkTagOperationMode,
    openBulkTagEditor, addTagToBulkEditor, removeTagFromBulkEditor,
    addAliasToBulkEditor, removeAliasFromBulkEditor, saveBulkTagEditor,
  }
}
