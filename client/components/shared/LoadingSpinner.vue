<template>
  <div class="cm-loading">
    <div class="cm-spinner"></div>
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
