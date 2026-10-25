<template>
  <CollectionList v-if="!currentCollection" />
  <CollectionDetail v-else />
  <CollectionInfoEditor />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useDashboardContext } from '../../../composables/dashboardContext'
import CollectionList from './CollectionList.vue'
import CollectionDetail from './CollectionDetail.vue'
import CollectionInfoEditor from './CollectionInfoEditor.vue'

export default defineComponent({
  name: 'CollectionsView',
  components: {
    CollectionList,
    CollectionDetail,
    CollectionInfoEditor,
  },
  setup() {
    return useDashboardContext()
  },
})
</script>
