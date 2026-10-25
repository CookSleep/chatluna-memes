<template>
  <div class="cm-tabs" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      role="tab"
      :aria-selected="activeMenu === tab.key"
      :class="['cm-tab', { 'is-active': activeMenu === tab.key }]"
      @click="switchMainMenu(tab.key)"
    >
      <Icon :name="tab.icon" />
      <span>{{ tab.label }}</span>
      <span v-if="tab.count !== undefined" class="cm-tab-count" :class="{ 'is-alert': tab.alert }">{{ tab.count }}</span>
    </button>
  </div>
</template>
<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useDashboardContext } from '../../composables/dashboardContext'
import Icon from '../shared/Icon.vue'

export default defineComponent({
  name: 'MenuSwitcher',
  components: { Icon },
  setup() {
    const ctx = useDashboardContext()
    const tabs = computed(() => [
      { key: 'config' as const, label: '配置', count: undefined, alert: false, icon: 'sliders' as const },
      { key: 'resources' as const, label: '表情包', count: ctx.collections.value.length, icon: 'smile' as const },
      { key: 'distribution' as const, label: '外部图源', count: ctx.endpoints.value.length, icon: 'link' as const },
      { key: 'staging' as const, label: '暂缓区', count: ctx.stagedImages.value.length, alert: ctx.stagedImages.value.length > 0, icon: 'inbox' as const },
      { key: 'preview' as const, label: '预览', count: undefined, alert: false, icon: 'eye' as const },
    ])
    return { ...ctx, tabs }
  },
})
</script>
