<template>
  <section class="ml-view">
    <header class="ml-view-head">
      <div class="ml-view-title">
        <h1 class="ml-title">暂缓区</h1>
        <div class="ml-actions">
          <button type="button" class="ml-btn" @click="refreshStagedImages"><Icon name="refresh" />刷新</button>
          <button v-if="stagedImages.length" type="button" class="ml-btn is-danger-soft" @click="confirmDeleteAllStagedImages"><Icon name="trash" />全部清空</button>
        </div>
      </div>
      <p class="ml-subtitle">群聊里自动收集的高频图片，以及上传时被拦下的超大图片，会先放在这里。<br />归档到表情包后才会被使用，不需要的直接删除。</p>
    </header>

    <div class="ml-callout" :class="{ 'is-info': autoCollect?.enabled }">
      <Icon name="info" />
      <span v-if="!autoCollect">正在读取自动收集配置…</span>
      <span v-else-if="autoCollect.enabled">
        自动收集已开启：同一个群 {{ autoCollect.windowMinutes }} 分钟内同一张图出现 {{ autoCollect.threshold }} 次就会收进来。<br />
        只收集 {{ autoCollect.minSizeKB }} KB ~ {{ autoCollect.maxSizeMB }} MB 的图片，每群每天最多 {{ autoCollect.dailyLimit }} 张；已在表情包或暂缓区里的图片不会重复收集。
      </span>
      <span v-else>
        自动收集未开启，群聊里的图片不会进入暂缓区。<br />
        目前只有一种情况会进来：在管理页上传图片时，超过 10 MB 的会先放在这里等你确认。<br />
        想收集群聊里的高频表情，可以在<button type="button" class="ml-inline-link" @click="openConfig('ml-config-collect')">「配置」</button>中开启自动收集。
      </span>
    </div>

    <div v-if="!stagedImages.length" class="ml-empty">
      <div class="ml-empty-icon">
        <Icon name="inbox" />
      </div>
      <h3>暂缓区是空的</h3>
      <p>有新图片进来时会显示在这里。</p>
    </div>

    <template v-else>
      <div class="ml-toolbar">
        <div class="ml-segmented is-filter">
          <button type="button" :class="{ 'is-active': stagingViewMode === 'all' }" @click="setStagingViewMode('all')">
            全部 <span>{{ filteredStagedImages.length }}</span>
          </button>
          <button type="button" :class="{ 'is-active': stagingViewMode === 'similar' }" @click="setStagingViewMode('similar')">
            按相似分组 <span>{{ similarLoading ? '…' : filteredSimilarGroups.length }}</span>
          </button>
        </div>
        <label class="ml-search">
          <Icon name="search" />
          <input v-model="stagingSearch" placeholder="搜索文件名、来源或原因" />
        </label>
        <div class="ml-toolbar-end is-compact">
          <button type="button" class="ml-btn" @click="toggleSelectAllStaged">
            <Icon name="selectAll" />{{ areAllCurrentPageStagedSelected ? '取消全选' : '全选' }}
          </button>
        </div>
      </div>

      <template v-if="stagingViewMode === 'all'">
        <div v-if="!filteredStagedImages.length" class="ml-empty is-compact">
          <h3>没有匹配的图片</h3>
        </div>
        <div v-else class="ml-image-grid">
          <StagedCard
            v-for="item in filteredStagedImages"
            :key="item.id"
            v-bind="cardProps(item)"
            @pick="onPick(item, filteredStagedImages, $event)"
            @promote="promoteStagedImage(item)"
            @remove="deleteStagedImage(item)"
          />
        </div>
      </template>

      <template v-else>
        <div v-if="similarLoading" class="ml-loading is-inline"><div class="ml-spinner is-small"></div><p>正在比对相似图片…</p></div>
        <div v-else-if="!filteredSimilarGroups.length" class="ml-empty is-compact">
          <h3>没有发现相似图片</h3>
          <p>{{ similarMessage || '每张图都不一样，直接在「全部」里处理即可。' }}</p>
        </div>
        <template v-else>
        <section v-for="group in filteredSimilarGroups" :key="group.id" class="ml-group">
          <header class="ml-group-head">
            <div>
              <h3>相似 {{ group.label }}</h3>
              <p class="ml-hint">{{ group.items.length }} 张，相似度不低于 {{ formatPercent(group.similarity) }}</p>
            </div>
            <div class="ml-actions">
              <button type="button" class="ml-btn is-small" @click="selectGroup(group)">
                <Icon name="selectAll" />{{ group.items.every((item) => isStagedSelected(item.id)) ? '取消选择本组' : '选择本组' }}
              </button>
              <button type="button" class="ml-btn is-small" @click="keepOneInGroup(group)"><Icon name="keep" />只保留第一张</button>
            </div>
          </header>
          <div class="ml-image-grid">
            <StagedCard
              v-for="item in group.items"
              :key="item.id"
              v-bind="cardProps(item)"
              :badge="undefined"
              @pick="onPick(item, group.items, $event)"
              @promote="promoteStagedImage(item)"
              @remove="deleteStagedImage(item)"
            />
          </div>
        </section>
        </template>
      </template>
    </template>

    <SelectionBar :count="selectedStagedIds.size" @clear="clearSelectedStaged">
      <button type="button" class="ml-bar-btn" @click="toggleSelectAllStaged"><Icon name="selectAll" />{{ areAllCurrentPageStagedSelected ? '取消全选' : '全选' }}</button>
      <button type="button" class="ml-bar-btn is-primary" @click="batchPromoteStagedImages()"><Icon name="archive" />归档到…</button>
      <button type="button" class="ml-bar-btn is-danger" @click="batchDeleteStagedImages"><Icon name="trash" />删除</button>
    </SelectionBar>
  </section>
</template>
<script lang="ts">
import { computed, defineComponent } from 'vue'
import StagedCard from './StagedCard.vue'
import Icon from '../../shared/Icon.vue'
import SelectionBar from '../../shared/SelectionBar.vue'
import { useDashboardContext } from '../../../composables/dashboardContext'
import { useSelectionShortcuts, type ClickModifiers } from '../../../utils/selection'
import type { ConsoleStagedImageInfo } from '../../../../src/console-rpc'

export default defineComponent({
  name: 'StagingView',
  components: { StagedCard, Icon, SelectionBar },
  setup() {
    const ctx = useDashboardContext()
    const autoCollect = computed(() => ctx.settings.value?.autoCollect)

    function cardProps(item: ConsoleStagedImageInfo) {
      return {
        item,
        src: ctx.getStagedImageUrl(item.id),
        selected: ctx.isStagedSelected(item.id),
        selecting: ctx.selectedStagedIds.value.size > 0,
        index: ctx.getStagedSelectionIndex(item.id),
        busy: ctx.stagingBusyId.value === item.id,
        badge: ctx.getSimilarBadge(item.id),
        source: ctx.humanizeSource(item.source),
        size: ctx.formatSize(item.size),
        date: ctx.formatDate(item.createdAt),
      }
    }

    function onPick(item: ConsoleStagedImageInfo, list: ConsoleStagedImageInfo[], event: ClickModifiers) {
      ctx.handleStagedClick(item, list.map((entry) => entry.id), event, () => ctx.openImage(ctx.getStagedImageUrl(item.id)))
    }

    useSelectionShortcuts({
      selectAll: ctx.selectAllStaged,
      clear: () => {
        if (!ctx.selectedStagedIds.value.size) return false
        ctx.clearSelectedStaged()
        return true
      },
    })

    return { ...ctx, autoCollect, cardProps, onPick }
  },
})
</script>
