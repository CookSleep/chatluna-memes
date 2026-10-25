<template>
  <section class="ml-gallery">
    <div class="ml-toolbar">
      <div class="ml-segmented is-filter">
        <button type="button" :class="{ 'is-active': currentGalleryTab === 'all' }" @click="currentGalleryTab = 'all'">
          全部 <span>{{ currentCollectionTotalCount }}</span>
        </button>
        <button type="button" :class="{ 'is-active': currentGalleryTab === 'local' }" @click="currentGalleryTab = 'local'">
          本地 <span>{{ currentCollection.localCount }}</span>
        </button>
        <button type="button" :class="{ 'is-active': currentGalleryTab === 'external' }" @click="currentGalleryTab = 'external'">
          外链 <span>{{ currentCollection.linkCount }}</span>
        </button>
      </div>
      <label class="ml-search">
        <Icon name="search" />
        <input v-model="gallerySearch" placeholder="搜索文件名、标签或别名" />
      </label>
      <div class="ml-toolbar-end">
        <el-select v-model="galleryFilter" class="ml-select is-narrow" aria-label="筛选">
          <el-option value="all" label="全部图片" />
          <el-option value="selected" label="只看已选" />
        </el-select>
        <el-select v-model="gallerySort" class="ml-select is-narrow" aria-label="排序">
          <el-option value="name" label="文件名 A→Z" />
          <el-option value="nameDesc" label="文件名 Z→A" />
        </el-select>
        <div class="ml-segmented is-icon">
          <button type="button" :class="{ 'is-active': galleryViewMode === 'grid' }" title="网格" @click="galleryViewMode = 'grid'"><Icon name="grid" /></button>
          <button type="button" :class="{ 'is-active': galleryViewMode === 'list' }" title="列表" @click="galleryViewMode = 'list'"><Icon name="list" /></button>
        </div>
      </div>
    </div>

    <div v-if="!currentCollection.totalCount" class="ml-empty is-dashed" @click="triggerFileInput">
      <div class="ml-empty-icon"><Icon name="upload" /></div>
      <h3>这个表情包还是空的</h3>
      <p>点击这里选择图片，或者直接把图片拖进页面。</p>
    </div>
    <div v-else-if="!filteredGalleryItems.length" class="ml-empty is-compact">
      <h3>没有匹配的图片</h3>
      <p>换个关键词或筛选条件试试。</p>
    </div>

    <template v-else>
      <div :class="['ml-image-grid', { 'is-list': galleryViewMode === 'list', 'is-selecting': selectedImages.length }]">
        <article
          v-for="item in paginatedGalleryItems"
          :key="item.id"
          class="ml-image-card"
          :class="{
            'is-selected': isImageSelected(item.value),
            'is-menu-open': activeCardMenu === item.value,
          }"
          @click="handleGalleryItemClick(item, $event)"
        >
          <div class="ml-image-thumb" :title="selectedImages.length ? '点击切换选择' : '点击查看原图'">
            <img v-if="!brokenImages.has(item.id)" :src="item.src" loading="lazy" alt="" referrerpolicy="no-referrer" @error="brokenImages.add(item.id)" />
            <span v-else class="ml-thumb-fallback" :title="crossOriginHint"><Icon name="imageOff" />无法预览</span>
            <span class="ml-badge is-floating">{{ item.type === 'external' ? '外链' : getImageExtension(item.value) }}</span>
          </div>
          <button
            type="button"
            class="ml-check"
            :class="{ 'is-checked': isImageSelected(item.value) }"
            :aria-pressed="isImageSelected(item.value)"
            :title="isImageSelected(item.value) ? '取消选择' : '选择（也可以 Ctrl / ⌘ + 点击图片）'"
            @click.stop="handleGalleryItemClick(item, { ctrlKey: true, shiftKey: $event.shiftKey })"
          >
            <span v-if="getImageSelectionIndex(item.value)">{{ getImageSelectionIndex(item.value) }}</span>
            <Icon v-else name="check" />
          </button>
          <div class="ml-image-info">
            <div class="ml-image-name" :title="item.label">{{ item.label }}</div>
            <div v-if="item.type === 'local' && getImageTags(item.value).length" class="ml-tag-row">
              <span v-for="tag in getImageTags(item.value).slice(0, 3)" :key="tag" class="ml-tag" :style="{ '--tag-hue': tagHue(tag) }">{{ tag }}</span>
              <span v-if="getImageTags(item.value).length > 3" class="ml-tag is-more">+{{ getImageTags(item.value).length - 3 }}</span>
            </div>
            <div v-else-if="item.type === 'local'" class="ml-image-sub">未标注</div>
            <div v-else class="ml-image-sub" :title="item.value">{{ item.value }}</div>
            <div class="ml-menu-anchor ml-image-menu" @click.stop>
              <button type="button" class="ml-icon-btn is-small" title="更多操作" :aria-expanded="activeCardMenu === item.value" @click="toggleCardMenu(item.value)"><Icon name="more" /></button>
              <div v-if="activeCardMenu === item.value" class="ml-menu" role="menu">
                <template v-if="item.type === 'local'">
                  <button type="button" role="menuitem" @click="openTagEditor(currentCollection.name, item.value); closeCardMenu()"><Icon name="tag" />编辑标注</button>
                  <button type="button" role="menuitem" @click="closeCardMenu(); toggleImageSelection(item.value)"><Icon name="selectAll" />{{ isImageSelected(item.value) ? '取消选择' : '选择' }}</button>
                  <button type="button" role="menuitem" :disabled="collections.length < 2" @click="closeCardMenu(); moveImage(currentCollection.name, null, item.value)"><Icon name="move" />移动到…</button>
                  <button type="button" role="menuitem" @click="openImage(item.src); closeCardMenu()"><Icon name="external" />查看原图</button>
                  <div class="ml-menu-sep"></div>
                  <button type="button" role="menuitem" class="is-danger" @click="closeCardMenu(); confirmDeleteImage(currentCollection.name, item.value)"><Icon name="trash" />删除</button>
                </template>
                <template v-else>
                  <button type="button" role="menuitem" @click="closeCardMenu(); toggleImageSelection(item.value)"><Icon name="selectAll" />{{ isImageSelected(item.value) ? '取消选择' : '选择' }}</button>
                  <button type="button" role="menuitem" @click="copyToClipboard(item.value); closeCardMenu()"><Icon name="copy" />复制链接</button>
                  <button type="button" role="menuitem" @click="openImage(item.src); closeCardMenu()"><Icon name="external" />查看原图</button>
                  <div class="ml-menu-sep"></div>
                  <button type="button" role="menuitem" class="is-danger" @click="closeCardMenu(); deleteExternalLink(currentCollection.name, item.value)"><Icon name="trash" />删除</button>
                </template>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div v-if="totalPages > 1" class="ml-pagination">
        <button type="button" class="ml-btn is-small" :disabled="currentPage === 1" @click="currentPage--"><Icon name="prev" />上一页</button>
        <span>第 <b>{{ currentPage }}</b> / {{ totalPages }} 页</span>
        <button type="button" class="ml-btn is-small" :disabled="currentPage === totalPages" @click="currentPage++">下一页<Icon name="next" /></button>
      </div>
    </template>

    <SelectionBar :count="selectedImages.length" @clear="clearSelectedImages">
      <button type="button" class="ml-bar-btn" @click="toggleSelectCurrentPage"><Icon name="selectAll" />{{ areAllCurrentPageImagesSelected ? '取消本页' : '全选本页' }}</button>
      <button type="button" class="ml-bar-btn" :disabled="!selectedLocalImages.length" :title="selectedLocalImages.length ? '' : '外链不支持标注'" @click="openBulkTagEditor"><Icon name="tag" />编辑标注</button>
      <button type="button" class="ml-bar-btn" :disabled="collections.length < 2" @click="moveSelectedImages"><Icon name="move" />移动</button>
      <button type="button" class="ml-bar-btn is-danger" @click="deleteSelectedImages"><Icon name="trash" />删除</button>
    </SelectionBar>
  </section>
</template>
<script lang="ts">
import { defineComponent, reactive } from 'vue'
import Icon from '../../shared/Icon.vue'
import SelectionBar from '../../shared/SelectionBar.vue'
import { useDashboardContext } from '../../../composables/dashboardContext'
import { useSelectionShortcuts } from '../../../utils/selection'

export default defineComponent({
  name: 'ImageGallery',
  components: { Icon, SelectionBar },
  setup() {
    const ctx = useDashboardContext()
    const brokenImages = reactive(new Set<string>())
    useSelectionShortcuts({
      selectAll: ctx.selectAllCurrentPageImages,
      clear: () => {
        if (ctx.activeCardMenu.value) {
          ctx.closeCardMenu()
          return true
        }
        if (!ctx.selectedImages.value.length) return false
        ctx.clearSelectedImages()
        return true
      },
    })
    return { ...ctx, brokenImages }
  },
})
</script>
