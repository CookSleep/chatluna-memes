<template>
  <nav class="cm-crumbs" aria-label="当前位置">
    <span class="cm-crumb" :class="{ 'is-link': currentCollection }" @click="currentCollection && exitCollectionDetail()">ChatLuna Memes</span>
    <template v-if="currentCollection">
      <span class="cm-crumb-sep">/</span>
      <span class="cm-crumb is-link" @click="exitCollectionDetail()">表情包</span>
      <span class="cm-crumb-sep">/</span>
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
