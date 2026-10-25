<template>
  <article class="ml-image-card ml-staged-card" :class="{ 'is-selected': selected }" @click="$emit('pick', $event)">
    <div class="ml-image-thumb" :title="selecting ? '点击切换选择' : '点击查看原图'">
      <AuthenticatedImage :src="src" alt="" />
      <span v-if="badge" class="ml-badge is-floating is-accent" :title="`与另外 ${badge.size - 1} 张相似`">相似 {{ badge.label }}</span>
    </div>
    <button
      type="button"
      class="ml-check"
      :class="{ 'is-checked': selected }"
      :aria-pressed="selected"
      :title="selected ? '取消选择' : '选择（也可以 Ctrl / ⌘ + 点击图片）'"
      @click.stop="$emit('pick', { ctrlKey: true, shiftKey: $event.shiftKey })"
    >
      <span v-if="index">{{ index }}</span>
      <Icon v-else name="check" />
    </button>
    <div class="ml-image-info">
      <div class="ml-image-name" :title="item.originalName || item.filename">{{ item.originalName || item.filename }}</div>
      <div class="ml-image-sub" :title="source">{{ source }}</div>
      <div class="ml-image-sub" :title="item.reason">{{ item.reason || '待人工确认' }}</div>
      <div class="ml-image-sub">{{ size }} · {{ date }}</div>
      <div class="ml-staged-actions" @click.stop>
        <button type="button" class="ml-btn is-small" :disabled="busy" @click="$emit('promote')"><Icon name="archive" />归档到…</button>
        <button type="button" class="ml-icon-btn is-small is-danger" title="删除" :disabled="busy" @click="$emit('remove')"><Icon name="trash" /></button>
      </div>
    </div>
  </article>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import AuthenticatedImage from '../../shared/AuthenticatedImage.vue'
import Icon from '../../shared/Icon.vue'
import type { ConsoleStagedImageInfo } from '../../../../src/console-rpc'

export default defineComponent({
  name: 'StagedCard',
  components: { AuthenticatedImage, Icon },
  props: {
    item: { type: Object as PropType<ConsoleStagedImageInfo>, required: true },
    src: { type: String, required: true },
    selected: Boolean,
    selecting: Boolean,
    index: { type: Number, default: 0 },
    busy: Boolean,
    badge: { type: Object as PropType<{ label: string; size: number } | undefined>, default: undefined },
    source: { type: String, default: '' },
    size: { type: String, default: '' },
    date: { type: String, default: '' },
  },
  emits: ['pick', 'promote', 'remove'],
})
</script>
