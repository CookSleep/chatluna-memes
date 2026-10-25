<template>
  <div class="ml-loading">
    <div class="ml-spinner"></div>
    <p>{{ message }}</p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'LoadingSpinner',
  props: {
    message: {
      type: String,
      default: '加载中…',
    },
  },
})
</script>
