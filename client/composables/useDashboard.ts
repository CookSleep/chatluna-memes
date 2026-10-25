import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { sendMemesLuna } from './rpc'
import { adminFetch } from './adminFetch'
import { CollectionPageLoader } from './collectionResources'
import { settledBatch } from './batch'
import { useAnnotationStatus } from './useAnnotationStatus'
import { useDialog } from './useDialog'
import { useToast } from './useToast'
import { useStaging } from './useStaging'
import { useEndpoints } from './useEndpoints'
import { useMetadataEditor } from './useMetadataEditor'
import { applyClickSelection, type ClickModifiers } from '../utils/selection'
import { CROSS_ORIGIN_HINT, isLinkValue, formatDate, formatPercent, formatSize, getExternalLinkLabel, getImageExtension, humanizeSource, readSessionOption, tagHue } from '../utils/format'
import { MAX_IMAGE_BYTES } from '../../src/constants'
import type {
  ConsoleCollectionInfo as CollectionInfo,
  ConsoleEndpointInfo as EndpointInfo,
  ConsoleSettingsSummary,
} from '../../src/console-rpc'

interface CollectionPreviewState {
  loading: boolean
  images: string[]
}

interface AssetGalleryItem {
  id: string
  type: 'local' | 'external'
  label: string
  src: string
  value: string
}

interface PreviewRouteRow {
  id: string
  type: 'collection' | 'endpoint'
  typeLabel: string
  name: string
  description: string
  path: string
  fullUrl: string
  previewImages: string[]
}

type MainMenu = 'resources' | 'distribution' | 'staging' | 'settings'

export function useDashboard() {
  // 导航
  const activeMenu = ref<MainMenu>(readSessionOption('memesluna_active_menu', 'resources', ['resources', 'distribution', 'staging', 'settings']))

  const { toast, showToast } = useToast()
  const dialogApi = useDialog()
  const { confirmDialog, promptDialog, chooseDialog } = dialogApi
  const annotation = useAnnotationStatus(showToast, confirmDialog)
  const loading = ref(true)
  // 首次加载完成前显示整页加载；之后的操作只显示顶部进度条，不卸载页面。
  const initialized = ref(false)
  const settings = ref<ConsoleSettingsSummary | null>(null)

  // 基础数据
  const backendPath = ref('/memesluna')
  const baseUrl = ref('http://localhost:5140')
  const endpoints = ref<EndpointInfo[]>([])
  const collections = ref<CollectionInfo[]>([])
  const currentCollection = ref<CollectionInfo | null>(null)

  const staging = useStaging({ loading, currentCollection, showToast, confirmDialog, pickCollection, fetchState, loadCollectionResources })
  const { stagedImages, clearSelectedStaged, refreshStagedImages, stageFilteredFiles } = staging
  const endpointEditor = useEndpoints({ loading, showToast, confirmDialog, fetchState, validateRouteName, getBaseRedirectUrl })

  const failedEndpointPreviewIds = ref<Set<string>>(new Set())

  // 表情包与图库
  const newCollectionName = ref('')
  const collectionSearchQuery = ref('')
  const collectionFilter = ref<'all' | 'local' | 'external'>('all')
  const activeCollectionMenu = ref<string | null>(null)
  const externalLinksText = ref('')
  const detailResources = reactive({
    images: [] as string[],
    links: [] as string[]
  })
  const collectionPreviews = reactive<Record<string, CollectionPreviewState>>({})
  const galleryTotal = ref(0)
  const pageLoader = new CollectionPageLoader((name, query) => sendMemesLuna('memesluna/getCollectionResources', name, query))
  const currentGalleryTab = ref<'all' | 'local' | 'external'>('all')
  const showImportLinks = ref(false)
  const selectedImageSet = ref<Set<string>>(new Set())
  const bulkMoveTarget = ref('')
  const gallerySearch = ref('')
  const gallerySort = ref<'name' | 'nameDesc'>('name')
  const galleryFilter = ref<'all' | 'selected'>('all')
  const galleryViewMode = ref<'grid' | 'list'>('grid')
  const uploadProgress = ref<{ done: number; total: number } | null>(null)
  const apiPreviewUrl = ref('')
  const apiPreviewLoading = ref(false)

  const activeCardMenu = ref<string | null>(null)

  function toggleCardMenu(img: string) {
    if (activeCardMenu.value === img) {
      activeCardMenu.value = null
    } else {
      activeCardMenu.value = img
    }
  }

  function closeCardMenu() {
    activeCardMenu.value = null
  }

  function isImageSelected(img: string): boolean {
    return selectedImageSet.value.has(img)
  }

  // Set 保留插入顺序，序号即用户的选择顺序。
  const imageSelectionOrder = computed(() => new Map(Array.from(selectedImageSet.value, (name, index) => [name, index + 1])))
  function getImageSelectionIndex(img: string): number {
    return imageSelectionOrder.value.get(img) || 0
  }

  function toggleImageSelection(img: string) {
    imageSelectionAnchor = img
    const next = new Set(selectedImageSet.value)
    if (next.has(img)) {
      next.delete(img)
    } else {
      next.add(img)
    }
    selectedImageSet.value = next
  }

  function clearSelectedImages() {
    selectedImageSet.value = new Set()
    bulkMoveTarget.value = ''
  }

  function toggleSelectCurrentPage() {
    const next = new Set(selectedImageSet.value)
    const values = paginatedGalleryItems.value.map((item) => item.value)
    if (areAllCurrentPageImagesSelected.value) {
      values.forEach((value) => next.delete(value))
    } else {
      values.forEach((value) => next.add(value))
    }
    selectedImageSet.value = next
  }

  let imageSelectionAnchor: string | null = null

  function handleGalleryItemClick(item: AssetGalleryItem, event?: ClickModifiers) {
    const values = paginatedGalleryItems.value.map((entry) => entry.value)
    const result = applyClickSelection(selectedImageSet.value, item.value, values, imageSelectionAnchor, event)
    if (result) {
      selectedImageSet.value = result.next
      imageSelectionAnchor = result.anchor
      return
    }
    openImage(item.src)
  }

  function selectAllCurrentPageImages() {
    const next = new Set(selectedImageSet.value)
    for (const item of paginatedGalleryItems.value) next.add(item.value)
    selectedImageSet.value = next
  }

  // 图库分页
  const currentPage = ref(1)
  const pageSize = ref(24)
  const galleryItems = computed<AssetGalleryItem[]>(() => {
    const collection = currentCollection.value
    if (!collection) return []

    const localItems = detailResources.images.map((filename) => ({
      id: `local:${filename}`,
      type: 'local' as const,
      label: filename,
      src: getLocalImageApiUrl(collection.name, filename),
      value: filename
    }))
    const externalItems = detailResources.links.map((link) => ({
      id: `external:${link}`,
      type: 'external' as const,
      label: getExternalLinkLabel(link),
      src: link,
      value: link
    }))

    if (currentGalleryTab.value === 'local') return localItems
    if (currentGalleryTab.value === 'external') return externalItems
    return [...localItems, ...externalItems]
  })
  const filteredGalleryItems = computed(() => galleryItems.value)
  const totalPages = computed(() => Math.max(1, Math.ceil(galleryTotal.value / pageSize.value)))
  const paginatedGalleryItems = computed(() => filteredGalleryItems.value)
  // 选择集合里本地图片存文件名、外链存地址；文件名不含斜杠，两者不会混淆。
  const selectedImages = computed(() => Array.from(selectedImageSet.value))
  const selectedLocalImages = computed(() => selectedImages.value.filter((value) => !isLinkValue(value)))
  const selectedLinks = computed(() => selectedImages.value.filter(isLinkValue))
  const metadata = useMetadataEditor({ currentCollection, selectedImages: selectedLocalImages, selectedImageSet, showToast, confirmDialog })
  const { imageTagsCache, imageAliasesCache, getImageCacheKey } = metadata
  const areAllCurrentPageImagesSelected = computed(() => {
    const items = paginatedGalleryItems.value
    return items.length > 0 && items.every((item) => selectedImageSet.value.has(item.value))
  })
  const currentCollectionCoverUrl = computed(() => {
    if (!currentCollection.value) return ''
    const local = currentCollection.value.cover || detailResources.images[0]
    if (local) return getLocalImageApiUrl(currentCollection.value.name, local)
    return detailResources.links[0] || ''
  })
  const currentCollectionApiUrl = computed(() => {
    return currentCollection.value ? getBaseRedirectUrl(currentCollection.value.name) : ''
  })
  const currentCollectionTotalCount = computed(() => {
    return currentCollection.value?.totalCount || 0
  })
  const previewRouteRows = computed<PreviewRouteRow[]>(() => {
    const collectionRows = collections.value
      .filter((item) => item.hasContent)
      .map((item) => ({
        id: `collection:${item.name}`,
        type: 'collection' as const,
        typeLabel: '表情包',
        name: item.name,
        description: item.description || `${item.name} 表情包`,
        path: getRouteDisplayPath(item.name),
        fullUrl: getBaseRedirectUrl(item.name),
        previewImages: getCollectionPreviewImages(item.name).slice(0, 3)
      }))

    const endpointRows = endpoints.value.map((item) => {
      const fullUrl = getBaseRedirectUrl(item.name)
      const previewImages = failedEndpointPreviewIds.value.has(`endpoint:${item.name}`) ? [] : [fullUrl]
      return {
        id: `endpoint:${item.name}`,
        type: 'endpoint' as const,
        typeLabel: '重定向',
        name: item.name,
        description: item.description || '302 重定向',
        path: getRouteDisplayPath(item.name),
        fullUrl,
        previewImages,
      }
    })

    return [...collectionRows, ...endpointRows]
  })
  const totalLocalImages = computed(() => collections.value.reduce((sum, item) => sum + (item.localCount || 0), 0))
  const totalLinks = computed(() => collections.value.reduce((sum, item) => sum + (item.linkCount || 0), 0))
  const filteredCollections = computed(() => {
    const query = collectionSearchQuery.value.trim().toLowerCase()
    return collections.value.filter((item) => {
      const matchesQuery = !query
        || item.name.toLowerCase().includes(query)
        || (item.description || '').toLowerCase().includes(query)
      const matchesFilter = collectionFilter.value === 'all'
        || (collectionFilter.value === 'local' && item.localCount > 0 && item.linkCount === 0)
        || (collectionFilter.value === 'external' && item.linkCount > 0)
      return matchesQuery && matchesFilter
    })
  })

  // 预览页数据
  const routeInventoryText = ref('')
  const llmPromptPreview = ref('')

  // 拖拽上传
  const dragOver = ref(false)
  const fileInput = ref<HTMLInputElement | null>(null)

  // 切换顶部标签页
  function switchMainMenu(menu: MainMenu) {
    activeMenu.value = menu
    sessionStorage.setItem('memesluna_active_menu', menu)
    if (menu === 'settings') {
      fetchSettingsPreview()
    }
    if (menu === 'staging') {
      refreshStagedImages()
    } else {
      clearSelectedStaged()
    }
  }

  function getBackendBaseUrl(): string {
    const cleanBase = baseUrl.value.endsWith('/') ? baseUrl.value.slice(0, -1) : baseUrl.value
    const cleanPath = backendPath.value.startsWith('/') ? backendPath.value : `/${backendPath.value}`
    const formattedPath = cleanPath.endsWith('/') ? cleanPath.slice(0, -1) : cleanPath
    return `${cleanBase}${formattedPath}`
  }

  // 路由地址
  function getRouteDisplayPath(suffix: string): string {
    const cleanPath = backendPath.value.endsWith('/') ? backendPath.value.slice(0, -1) : backendPath.value
    return `${cleanPath}/${encodeURIComponent(suffix)}`
  }

  /** 展示用路径，不做百分号编码，便于阅读；复制时仍使用编码后的完整地址。 */
  function getDisplayPath(suffix: string): string {
    const cleanPath = backendPath.value.endsWith('/') ? backendPath.value.slice(0, -1) : backendPath.value
    return `${cleanPath}/${suffix}`
  }

  function validateRouteName(value: string): string | void {
    if (!value) return '名称不能为空'
    if (/[\/\\?%*:|"<>.]/.test(value)) return '不能包含 / \\ ? % * : | " < > . 等字符'
    if (['config', 'admin', 'admin-login', 'admin-logout', 'api', 'css', 'js', 'picture', 'view', 'project_bg', 'static'].includes(value)) return '这是保留名称，请换一个'
    if (collections.value.some((item) => item.name === value)) return '已有同名表情包'
    if (endpoints.value.some((item) => item.name === value)) return '已有同名外部图源'
  }

  function getBaseRedirectUrl(suffix: string): string {
    return `${getBackendBaseUrl()}/${encodeURIComponent(suffix)}`
  }

  function getLocalImageApiUrl(collection: string, filename: string): string {
    return `${getBackendBaseUrl()}/api/collections/${encodeURIComponent(collection)}/images/${encodeURIComponent(filename)}`
  }

  function getStagedImageUrl(id: string): string {
    return `${getBackendBaseUrl()}/api/admin/staged-images/${encodeURIComponent(id)}`
  }

  function handlePreviewImageError(row: PreviewRouteRow) {
    if (row.type !== 'endpoint') return
    const next = new Set(failedEndpointPreviewIds.value)
    next.add(row.id)
    failedEndpointPreviewIds.value = next
  }

  function getCollectionPreviewState(name: string): CollectionPreviewState | undefined {
    return collectionPreviews[name]
  }

  function getCollectionPreviewImages(name: string): string[] {
    return collectionPreviews[name]?.images || []
  }

  function getCollectionCardPreviewImages(name: string): string[] {
    return getCollectionPreviewImages(name).slice(0, 6)
  }

  async function loadCollectionPreview(collection: CollectionInfo) {
    if (!collection.hasContent || collectionPreviews[collection.name]?.images.length || collectionPreviews[collection.name]?.loading) return
    collectionPreviews[collection.name] = collectionPreviews[collection.name] || { loading: true, images: [] }
    collectionPreviews[collection.name].loading = true

    try {
      const data = await sendMemesLuna('memesluna/getCollectionResources', collection.name, { limit: 9 })
      collectionPreviews[collection.name].images = data.items.map((item) => item.type === 'local'
        ? getLocalImageApiUrl(collection.name, item.filename) : item.value)

    } catch {
      collectionPreviews[collection.name].images = []
    } finally {
      collectionPreviews[collection.name].loading = false
    }
  }

  async function warmCollectionPreviews() {
    await settledBatch(collections.value.filter((item) => item.hasContent).slice(0, 24), loadCollectionPreview)
  }

  // 从后端同步状态
  async function fetchState() {
    try {
      // WebUI 始终运行在 Koishi 内嵌服务器上，直接用 window.location.origin 作为 baseUrl
      // selfUrl 是机器人发图用的公网地址，不能用于 WebUI 的 HTTP 接口请求
      baseUrl.value = window.location.origin

      const state = await sendMemesLuna('memesluna/getState')
      if (state) {
        if (state.backendPath) backendPath.value = state.backendPath
        endpoints.value = Array.isArray(state.endpoints) ? state.endpoints : []
        collections.value = Array.isArray(state.collections) ? state.collections : []
        stagedImages.value = Array.isArray(state.stagedImages) ? state.stagedImages : []
        settings.value = state.settings || null
        if (currentCollection.value) {
          const match = collections.value.find((c) => c.name === currentCollection.value?.name)
          if (match) currentCollection.value = match
        }
        void warmCollectionPreviews()
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '获取插件状态同步失败', 'error')
    }
  }

  async function fetchSettingsPreview() {
    await annotation.refreshAnnotationStatus()
    try {
      const response = await fetch(`${getBackendBaseUrl()}/api/homepage-data`)
      if (response.ok) {
        const data = await response.json()
        routeInventoryText.value = data.routeInventory || ''
        llmPromptPreview.value = data.llmPrompt || ''
      }
    } catch (err) {
      console.error('Failed to sync settings variables preview:', err)
    }
  }

  function collectionChoices(exclude?: string) {
    return collections.value.map((item) => ({
      label: item.name,
      value: item.name,
      description: [item.description, `${item.totalCount} 张`].filter(Boolean).join(' · '),
      disabled: item.name === exclude,
    }))
  }

  async function pickCollection(title: string, message?: string, exclude?: string): Promise<string | null> {
    if (!collections.value.some((item) => item.name !== exclude)) {
      showToast('还没有可用的表情包，请先新建一个', 'error')
      return null
    }
    return chooseDialog({ title, message, confirmText: '确定', choices: collectionChoices(exclude) })
  }

  // 剪贴板
  async function copyToClipboard(text: string, label = '链接') {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`已复制${label}`, 'success')
    } catch (err) {
      showToast('复制失败', 'error')
    }
  }

  // 表情包操作
  async function createCollection() {
    const name = newCollectionName.value.trim() || await promptDialog({
      title: '新建表情包',
      message: '名称会出现在访问地址里，也会展示给 ChatLuna。',
      confirmText: '创建',
      input: { placeholder: '例如：猫猫', maxlength: 64, validate: validateRouteName },
    })
    if (!name) return

    try {
      loading.value = true
      const success = await sendMemesLuna('memesluna/createCollection', name)
      if (!success) {
        showToast(`已存在名为「${name}」的表情包`, 'error')
        return
      }
      showToast(`已创建「${name}」`, 'success')
      newCollectionName.value = ''
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function confirmDeleteCollection(name: string) {
    activeCollectionMenu.value = null
    if (!await confirmDialog({ title: `删除表情包「${name}」？`, message: '其中的本地图片文件和外链会一起删除，无法恢复。', confirmText: '删除', danger: true })) return

    try {
      loading.value = true
      await sendMemesLuna('memesluna/deleteCollection', name)
      showToast(`已删除「${name}」`, 'success')
      currentCollection.value = null
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function enterCollectionDetail(item: CollectionInfo) {
    activeCollectionMenu.value = null
    pageLoader.invalidate()
    detailResources.images = []
    detailResources.links = []
    galleryTotal.value = 0
    currentCollection.value = item
    sessionStorage.setItem('memesluna_active_collection', item.name)
    externalLinksText.value = ''
    gallerySearch.value = ''
    gallerySort.value = 'name'
    galleryFilter.value = 'all'
    galleryViewMode.value = 'grid'
    apiPreviewUrl.value = ''
    currentPage.value = 1
    clearSelectedImages()
    await loadCollectionResources(item.name)

  }

  function exitCollectionDetail() {
    pageLoader.invalidate()
    currentCollection.value = null
    detailResources.images = []
    detailResources.links = []
    galleryTotal.value = 0
    sessionStorage.removeItem('memesluna_active_collection')
    apiPreviewUrl.value = ''
    clearSelectedImages()
  }

  async function loadCollectionResources(name: string) {
    if (currentCollection.value?.name !== name) return
    try {
      const data = await pageLoader.load(name, {
        offset: (currentPage.value - 1) * pageSize.value, limit: pageSize.value,
        type: currentGalleryTab.value, search: gallerySearch.value, sort: gallerySort.value,
        selected: galleryFilter.value === 'selected' ? selectedImages.value : undefined,
      })
      if (!data || currentCollection.value?.name !== name) return
      galleryTotal.value = data.total
      if (currentPage.value > totalPages.value) {
        currentPage.value = totalPages.value
        return
      }
      detailResources.images = data.items.filter((item) => item.type === 'local').map((item) => item.filename)
      detailResources.links = data.items.filter((item) => item.type === 'external').map((item) => item.value)
      for (const item of data.items) {
        const key = getImageCacheKey(name, item.filename)
        imageTagsCache.value[key] = item.tags
        imageAliasesCache.value[key] = item.aliases
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载表情包图片失败', 'error')
    }
  }

  async function refreshCollectionResources() {
    if (!currentCollection.value) return
    loading.value = true
    await loadCollectionResources(currentCollection.value.name)
    await fetchState()
    const match = collections.value.find(c => c.name === currentCollection.value?.name)
    if (match) {
      currentCollection.value = match
    }
    loading.value = false
    showToast('已刷新', 'success')
  }

  /**
   * 随机预览直接交给 <img> 加载：随机结果可能 302 到外链，用 fetch 跟随会被跨域策略拦下。
   */
  function testCurrentCollectionApi() {
    if (!currentCollection.value) return
    apiPreviewLoading.value = true
    apiPreviewUrl.value = `${currentCollectionApiUrl.value}?_ml=${Date.now()}`
  }

  function onApiPreviewLoad() {
    apiPreviewLoading.value = false
  }

  function onApiPreviewError() {
    apiPreviewLoading.value = false
    apiPreviewUrl.value = ''
    showToast(CROSS_ORIGIN_HINT, 'error')
  }

  // 表情包信息编辑（名称与描述）
  const collectionEditor = reactive({ open: false, original: '', name: '', description: '', saving: false })
  const collectionEditorNameError = computed(() => {
    const name = collectionEditor.name.trim()
    if (!name || name === collectionEditor.original) return ''
    return validateRouteName(name) || ''
  })

  function openCollectionEditor(item: CollectionInfo) {
    activeCollectionMenu.value = null
    collectionEditor.original = item.name
    collectionEditor.name = item.name
    collectionEditor.description = item.description || ''
    collectionEditor.open = true
  }

  async function saveCollectionEditor() {
    const oldName = collectionEditor.original
    const name = collectionEditor.name.trim()
    const description = collectionEditor.description.trim()
    if (!name || collectionEditorNameError.value) return
    const renamed = name !== oldName
    if (renamed && !await confirmDialog({
      title: `把「${oldName}」改名为「${name}」？`,
      message: `随机图地址会变成 ${getBaseRedirectUrl(name)}，\n旧地址将无法访问，用到旧地址的地方需要一起改。`,
      confirmText: '改名并保存',
    })) return

    collectionEditor.saving = true
    try {
      if (renamed && !await sendMemesLuna('memesluna/renameCollection', oldName, name)) throw new Error('表情包不存在，可能已被删除')
      const previous = collections.value.find((item) => item.name === oldName)?.description || ''
      if (description !== previous) await sendMemesLuna('memesluna/setCollectionDescription', name, description)
      collectionEditor.open = false
      showToast('已保存表情包信息', 'success')
      await fetchState()
      if (currentCollection.value?.name === oldName) {
        const match = collections.value.find((item) => item.name === name)
        if (match) {
          currentCollection.value = match
          sessionStorage.setItem('memesluna_active_collection', name)
          if (renamed) await loadCollectionResources(name)
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存表情包信息失败', 'error')
    } finally {
      collectionEditor.saving = false
    }
  }

  // 上传
  function triggerFileInput() {
    if (fileInput.value) fileInput.value.click()
  }

  function onFileSelected(e: Event) {
    const input = e.target as HTMLInputElement
    if (input.files) {
      uploadFiles(input.files)
    }
  }

  function onDrop(e: DragEvent) {
    dragOver.value = false
    if (e.dataTransfer && e.dataTransfer.files) {
      uploadFiles(e.dataTransfer.files)
    }
  }

  async function uploadFiles(files: FileList) {
    if (!currentCollection.value) return

    const destinationCollection = currentCollection.value.name
    const maxSize = 10 * 1024 * 1024
    const fileList = Array.from(files)
    if (fileList.length > 500) { showToast('一次最多上传 500 张，请分批上传', 'error'); return }
    if (fileList.some((file) => file.size > MAX_IMAGE_BYTES)) { showToast('单张图片不能超过 50 MB', 'error'); return }
    const imageFiles = fileList.filter((file) => {
      const name = file.name.toLowerCase()
      return file.type.startsWith('image/') || /\.(jpe?g|png|gif|bmp|webp|svg|tiff?|psd|avif)$/.test(name)
    })

    if (!imageFiles.length) {
      showToast('没有可上传的图片文件', 'error')
      return
    }

    const avifFiles = imageFiles.filter((file) => file.name.toLowerCase().endsWith('.avif'))
    const compatibleImageFiles = imageFiles.filter((file) => !file.name.toLowerCase().endsWith('.avif'))
    const stagingMap = new Map<File, string>()

    for (const file of compatibleImageFiles) {
      if (file.size > maxSize) {
        stagingMap.set(file, '超过 10 MB，需人工确认')
      }
    }

    const stagingItems = Array.from(stagingMap, ([file, reason]) => ({ file, reason }))
    const uploadableFiles = compatibleImageFiles.filter((file) => !stagingMap.has(file))

    let stagedCount = 0
    if (stagingItems.length) {
      stagedCount = await stageFilteredFiles(stagingItems)
    }

    if (!uploadableFiles.length) {
      if (stagedCount > 0) {
        const avifHint = avifFiles.length ? `，${avifFiles.length} 张 AVIF 已直接拦截` : ''
        showToast(`${stagedCount} 张超大图片已放入暂缓区${avifHint}`, 'success')
      } else if (avifFiles.length) {
        showToast('暂不支持 AVIF，请先转成 JPG、PNG、GIF 或 WEBP', 'error')
      } else {
        showToast('超大图片放入暂缓区失败', 'error')
      }
      await fetchState()
      return
    }

    if (uploadableFiles.length > 500) {
      showToast('一次最多上传 500 张，请分批上传', 'error')
      if (stagedCount) await fetchState()
      return
    }

    
    let successCount = 0
    let failedCount = 0

    for (let i = 0; i < uploadableFiles.length; i++) {
      const file = uploadableFiles[i]
      uploadProgress.value = { done: i, total: uploadableFiles.length }

      try {
        const formData = new FormData()
        formData.append('images', file)

        const response = await adminFetch(`${getBackendBaseUrl()}/api/admin/collections/${encodeURIComponent(destinationCollection)}/images`, {
          method: 'POST',
          body: formData
        })

        if (response.ok) {
          const resData = await response.json()
          if (resData.ok && resData.uploaded && resData.uploaded.length > 0) {
            successCount++
          } else {
            failedCount++
          }
        } else {
          failedCount++
        }
      } catch (err) {
        failedCount++
      }
    }

    uploadProgress.value = null
    const stagedHint = stagedCount ? `，另有 ${stagedCount} 张进入暂缓区` : ''
    const avifHint = avifFiles.length ? `，${avifFiles.length} 张 AVIF 已直接拦截` : ''

    if (successCount > 0) {
      showToast(`已上传 ${successCount} 张${failedCount ? `，${failedCount} 张失败` : ''}${stagedHint}${avifHint}`, failedCount ? 'error' : 'success')
    } else {
      showToast(`上传失败${stagedHint}${avifHint}`, 'error')
    }

    await loadCollectionResources(destinationCollection)
    await fetchState()
  }

  // 外链
  async function addExternalLinks() {
    if (!currentCollection.value) return
    const text = externalLinksText.value.trim()
    if (!text) {
      showToast('请至少填写一个链接', 'error')
      return
    }

    try {
      loading.value = true
      const count = await sendMemesLuna('memesluna/addLinks', currentCollection.value.name, text)
      showToast(count ? `已导入 ${count} 个外链` : '没有新的外链（可能格式不对或已存在）', count ? 'success' : 'error')
      externalLinksText.value = ''
      if (count) showImportLinks.value = false
      await loadCollectionResources(currentCollection.value.name)
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function deleteExternalLink(collectionName: string, link: string) {
    if (!await confirmDialog({ title: '删除这个外链？', message: link, confirmText: '删除', danger: true })) return

    try {
      loading.value = true
      await sendMemesLuna('memesluna/deleteLink', collectionName, link)
      showToast('已删除外链', 'success')
      await loadCollectionResources(collectionName)
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除链接失败', 'error')
    } finally {
      loading.value = false
    }
  }

  // 本地图片删除与移动
  async function confirmDeleteImage(collectionName: string, filename: string) {
    if (!await confirmDialog({ title: '删除这张图片？', message: `${filename} 会从磁盘删除，无法恢复。`, confirmText: '删除', danger: true })) return

    try {
      loading.value = true
      await sendMemesLuna('memesluna/deleteLocalImage', collectionName, filename)
      showToast('已删除图片', 'success')
      await loadCollectionResources(collectionName)
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function deleteSelectedImages() {
    if (!currentCollection.value || !selectedImages.value.length) return
    const names = selectedImages.value
    const localCount = selectedLocalImages.value.length
    const linkCount = selectedLinks.value.length
    const message = [
      localCount && `${localCount} 张本地图片会从磁盘删除，无法恢复。`,
      linkCount && `${linkCount} 个外链会从表情包里移除。`,
    ].filter(Boolean).join('\n')
    if (!await confirmDialog({ title: `删除选中的 ${names.length} 项？`, message, confirmText: '删除', danger: true })) return

    try {
      loading.value = true
      const source = currentCollection.value.name
      const results = await settledBatch(names, async (value) => {
        const ok = isLinkValue(value)
          ? await sendMemesLuna('memesluna/deleteLink', source, value)
          : await sendMemesLuna('memesluna/deleteLocalImage', source, value)
        if (!ok) throw new Error('删除失败')
      })
      const failed = names.filter((_, index) => results[index].status === 'rejected')
      showToast(failed.length ? `已删除 ${names.length - failed.length} 张，${failed.length} 张失败` : `已删除 ${names.length} 张`, failed.length ? 'error' : 'success')
      if (currentCollection.value?.name === source) selectedImageSet.value = new Set(failed)
      await loadCollectionResources(source)
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '批量删除失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function moveImage(source: string, target: string | null, filename: string) {
    target = target || await pickCollection('移动到表情包', filename, source)
    if (!target) return
    try {
      loading.value = true
      const newFilename = await sendMemesLuna('memesluna/moveLocalImage', source, target, filename)
      if (newFilename) {
        showToast(`已移动到「${target}」`, 'success')
        await loadCollectionResources(source)
        await fetchState()
      } else {
        showToast('移动失败', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '移动失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function moveSelectedImages() {
    if (!currentCollection.value || !selectedImages.value.length) return
    const source = currentCollection.value.name
    const target = bulkMoveTarget.value || await pickCollection(`移动选中的 ${selectedImages.value.length} 项`, '选择目标表情包', source)
    bulkMoveTarget.value = ''
    if (!target) return
    if (target === source) {
      showToast('不能移动到当前表情包', 'error')
      return
    }

    const names = selectedImages.value
    try {
      loading.value = true
      const results = await settledBatch(names, async (value) => {
        if (isLinkValue(value)) {
          // 外链没有单独的移动接口：先加到目标（已存在会跳过），再从原表情包移除。
          await sendMemesLuna('memesluna/addLinks', target, value)
          if (!await sendMemesLuna('memesluna/deleteLink', source, value)) throw new Error('移动失败')
          return
        }
        if (!await sendMemesLuna('memesluna/moveLocalImage', source, target, value)) throw new Error('移动失败')
      })
      const failed = names.filter((_, index) => results[index].status === 'rejected')
      showToast(failed.length ? `已移动 ${names.length - failed.length} 张到「${target}」，${failed.length} 张失败` : `已移动 ${names.length} 张到「${target}」`, failed.length ? 'error' : 'success')
      if (currentCollection.value?.name === source) selectedImageSet.value = new Set(failed)
      await loadCollectionResources(source)
      await fetchState()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '批量移动失败', 'error')
    } finally {
      loading.value = false
    }
  }

  function openImage(url: string) {
    if (url.startsWith(`${getBackendBaseUrl()}/api/admin/`)) {
      const previewWindow = window.open('', '_blank')
      void adminFetch(url).then(async (response) => {
        if (!response.ok) throw new Error('原图加载失败')
        const objectUrl = URL.createObjectURL(await response.blob())
        if (previewWindow) previewWindow.location.href = objectUrl
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
      }).catch((error) => { previewWindow?.close(); showToast(error.message, 'error') })
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  function toggleCollectionMenu(name: string) {
    activeCollectionMenu.value = activeCollectionMenu.value === name ? null : name
  }

  const closeDropdowns = () => {
    activeCollectionMenu.value = null
    activeCardMenu.value = null
  }

  // 生命周期
  onMounted(async () => {
    window.addEventListener('click', closeDropdowns)
    loading.value = true
    await fetchState()

    // 恢复刷新前打开的表情包详情
    if (activeMenu.value === 'resources') {
      const savedCol = sessionStorage.getItem('memesluna_active_collection')
      if (savedCol) {
        const col = collections.value.find(c => c.name === savedCol)
        if (col) {
          await enterCollectionDetail(col)
        }
      }
    } else if (activeMenu.value === 'staging') {
      await refreshStagedImages()
    } else if (activeMenu.value === 'settings') {
      await fetchSettingsPreview()
    }

    loading.value = false
    initialized.value = true
  })

  onUnmounted(() => {
    pageLoader.invalidate()
    window.removeEventListener('click', closeDropdowns)
  })

  // 监听
  watch([gallerySearch, gallerySort, galleryFilter, currentGalleryTab], () => { currentPage.value = 1 })
  let galleryReloadTimer: ReturnType<typeof setTimeout> | undefined
  watch([gallerySearch, gallerySort, galleryFilter, currentGalleryTab, currentPage, pageSize], () => {
    pageLoader.invalidate()
    clearTimeout(galleryReloadTimer)
    galleryReloadTimer = setTimeout(() => {
      if (currentCollection.value) void loadCollectionResources(currentCollection.value.name)
    }, 120)
  })
  watch(selectedImages, () => {
    if (galleryFilter.value === 'selected' && currentCollection.value) void loadCollectionResources(currentCollection.value.name)
  })
  onUnmounted(() => clearTimeout(galleryReloadTimer))

  watch([collectionSearchQuery, collectionFilter], () => {
    activeCollectionMenu.value = null
  })

  return {
    ...annotation,
    ...dialogApi,
    ...staging,
    ...endpointEditor,
    ...metadata,
    toast,
    activeMenu,
    loading,
    initialized,
    settings,
    uploadProgress,
    tagHue,
    humanizeSource,
    getDisplayPath,
    totalLocalImages,
    totalLinks,
    backendPath,
    endpoints,
    collections,
    stagedImages,
    currentCollection,
    collectionSearchQuery,
    collectionFilter,
    activeCollectionMenu,
    externalLinksText,
    detailResources,
    currentGalleryTab,
    showImportLinks,
    selectedImageSet,
    selectedLocalImages,
    selectedLinks,
    bulkMoveTarget,
    gallerySearch,
    gallerySort,
    galleryFilter,
    galleryViewMode,
    apiPreviewUrl,
    apiPreviewLoading,
    imageTagsCache,
    activeCardMenu,
    toggleCardMenu,
    closeCardMenu,
    isImageSelected,
    getImageSelectionIndex,
    toggleImageSelection,
    clearSelectedImages,
    toggleSelectCurrentPage,
    handleGalleryItemClick,
    selectAllCurrentPageImages,
    currentPage,
    filteredGalleryItems,
    totalPages,
    paginatedGalleryItems,
    selectedImages,
    areAllCurrentPageImagesSelected,
    currentCollectionCoverUrl,
    currentCollectionApiUrl,
    currentCollectionTotalCount,
    previewRouteRows,
    filteredCollections,
    clearSelectedStaged,
    routeInventoryText,
    llmPromptPreview,
    dragOver,
    fileInput,
    switchMainMenu,
    getRouteDisplayPath,
    getBaseRedirectUrl,
    getStagedImageUrl,
    handlePreviewImageError,
    formatDate,
    formatPercent,
    formatSize,
    getImageExtension,
    getCollectionPreviewState,
    getCollectionCardPreviewImages,
    fetchSettingsPreview,
    refreshStagedImages,
    copyToClipboard,
    createCollection,
    confirmDeleteCollection,
    enterCollectionDetail,
    exitCollectionDetail,
    refreshCollectionResources,
    testCurrentCollectionApi,
    onApiPreviewLoad,
    onApiPreviewError,
    crossOriginHint: CROSS_ORIGIN_HINT,
    collectionEditor, collectionEditorNameError, openCollectionEditor, saveCollectionEditor,
    triggerFileInput,
    onFileSelected,
    onDrop,
    addExternalLinks,
    deleteExternalLink,
    confirmDeleteImage,
    deleteSelectedImages,
    moveImage,
    moveSelectedImages,
    openImage,
    toggleCollectionMenu,
  }
}
