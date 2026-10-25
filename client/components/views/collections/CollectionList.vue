<template>
  <section class="cm-view">
    <header class="cm-view-head">
      <div class="cm-view-title">
        <h1 class="cm-title">表情包</h1>
        <div class="cm-actions">
          <button type="button" class="cm-btn is-primary" @click="createCollection()">
            <Icon name="plus" />新建表情包
          </button>
        </div>
      </div>
      <p class="cm-subtitle">每个表情包对应一个随机图地址，机器人访问时从中随机挑一张发出去。</p>
    </header>

    <div v-if="collections.length" class="cm-toolbar">
      <div class="cm-segmented is-filter" role="radiogroup" aria-label="筛选表情包">
        <button v-for="option in filterOptions" :key="option.value" type="button" role="radio" :aria-checked="collectionFilter === option.value" :class="{ 'is-active': collectionFilter === option.value }" @click="collectionFilter = option.value">
          {{ option.label }} <span>{{ filterCounts[option.value] }}</span>
        </button>
      </div>
      <label class="cm-search">
        <Icon name="search" />
        <input v-model="collectionSearchQuery" placeholder="搜索名称或描述" />
      </label>
    </div>

    <div v-if="!collections.length" class="cm-empty">
      <div class="cm-empty-icon"><Icon name="smile" /></div>
      <h3>还没有表情包</h3>
      <p>新建一个表情包，然后上传图片或导入外链。</p>
      <button type="button" class="cm-btn is-primary" @click="createCollection()"><Icon name="plus" />新建表情包</button>
    </div>

    <div v-else-if="!filteredCollections.length" class="cm-empty is-compact">
      <h3>没有匹配的表情包</h3>
      <p>换个关键词或筛选条件试试。</p>
    </div>

    <div v-else class="cm-collection-grid">
      <article
        v-for="item in filteredCollections"
        :key="item.name"
        class="cm-collection-card"
        :class="{ 'is-menu-open': activeCollectionMenu === item.name }"
        tabindex="0"
        @click="enterCollectionDetail(item)"
        @keydown.enter="enterCollectionDetail(item)"
      >
        <div class="cm-collection-cover" :data-count="Math.min(getCollectionCardPreviewImages(item.name).length, 4)">
          <img
            v-for="src in getCollectionCardPreviewImages(item.name).slice(0, 4)"
            :key="src"
            :src="src"
            loading="lazy"
            alt=""
            referrerpolicy="no-referrer"
          />
          <div v-if="!getCollectionCardPreviewImages(item.name).length" class="cm-cover-empty">
            <span v-if="getCollectionPreviewState(item.name)?.loading" class="cm-spinner is-small"></span>
            <template v-else>暂无图片</template>
          </div>
        </div>
        <div class="cm-collection-body">
          <div class="cm-collection-title">
            <h3 :title="item.name">{{ item.name }}</h3>
            <div class="cm-menu-anchor" @click.stop>
              <button type="button" class="cm-icon-btn is-small" title="更多操作" :aria-expanded="activeCollectionMenu === item.name" @click="toggleCollectionMenu(item.name)">
                <Icon name="more" />
              </button>
              <div v-if="activeCollectionMenu === item.name" class="cm-menu" role="menu">
                <button type="button" role="menuitem" @click="copyToClipboard(getBaseRedirectUrl(item.name), '随机图地址'); toggleCollectionMenu(item.name)"><Icon name="copy" />复制随机图地址</button>
                <button type="button" role="menuitem" @click="openCollectionEditor(item)"><Icon name="edit" />编辑信息</button>
                <div class="cm-menu-sep"></div>
                <button type="button" role="menuitem" class="is-danger" @click="confirmDeleteCollection(item.name)"><Icon name="trash" />删除表情包</button>
              </div>
            </div>
          </div>
          <p class="cm-collection-desc" :class="{ 'is-placeholder': !item.description }" :title="item.description">{{ item.description || '未填写描述' }}</p>
          <div class="cm-collection-meta">
            <span>{{ item.localCount }} 张图片</span>
            <span v-if="item.linkCount">{{ item.linkCount }} 个外链</span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
<script lang="ts">
import { computed, defineComponent } from 'vue'
import Icon from '../../shared/Icon.vue'
import { useDashboardContext } from '../../../composables/dashboardContext'

const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'local', label: '仅本地' },
  { value: 'external', label: '含外链' },
] as const

export default defineComponent({
  name: 'CollectionList',
  components: { Icon },
  setup() {
    const ctx = useDashboardContext()
    // 与 useDashboard 里的筛选条件保持一致。
    const filterCounts = computed(() => ({
      all: ctx.collections.value.length,
      local: ctx.collections.value.filter((item) => item.localCount > 0 && item.linkCount === 0).length,
      external: ctx.collections.value.filter((item) => item.linkCount > 0).length,
    }))
    return { ...ctx, filterOptions, filterCounts }
  },
})
</script>
