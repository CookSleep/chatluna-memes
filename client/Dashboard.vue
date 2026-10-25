<template>
  <AppLayout />
</template>

<script lang="ts">
import { defineComponent, provide } from 'vue'
import { useDashboard } from './composables/useDashboard'
import { dashboardContextKey } from './composables/dashboardContext'
import AppLayout from './components/layout/AppLayout.vue'

export default defineComponent({
  name: 'ChatLunaMemesDashboard',
  components: {
    AppLayout,
  },
  setup() {
    const dashboard = useDashboard()
    provide(dashboardContextKey, dashboard)
    return {}
  },
})
</script>

<style src="./styles/dashboard.css"></style>
