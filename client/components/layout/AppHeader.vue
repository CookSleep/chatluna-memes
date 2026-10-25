<template>
  <nav class="ml-crumbs" aria-label="当前位置">
    <span class="ml-crumb" :class="{ 'is-link': currentCollection }" @click="currentCollection && exitCollectionDetail()">MemesLuna</span>
    <template v-if="currentCollection">
      <span class="ml-crumb-sep">/</span>
      <span class="ml-crumb is-link" @click="exitCollectionDetail()">表情包</span>
      <span class="ml-crumb-sep">/</span>
      <span class="ml-crumb is-current">{{ currentCollection.name }}</span>
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
