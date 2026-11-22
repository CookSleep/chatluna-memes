<template>
  <nav class="cm-crumbs" aria-label="当前位置">
    <h1 v-if="!currentCollection" class="cm-crumb">表情包管理</h1>
    <template v-else>
      <button class="cm-crumb is-link" type="button" @click="exitCollectionDetail()">表情包管理</button>
      <span class="cm-crumb-sep" aria-hidden="true">/</span>
      <span class="cm-crumb is-current">{{ currentCollection.name }}</span>
    </template>
  </nav>
</template>
<script lang="ts">
import { defineComponent } from 'vue'
import { useDashboardContext } from '../../composables/dashboardContext'

export default defineComponent({
  name: 'AppHeader',
  setup() {
    return useDashboardContext()
  },
})
</script>
