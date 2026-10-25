<template>
  <Teleport to="body">
    <div class="ml-theme ml-toast-layer">
      <Transition name="ml-toast">
        <div v-if="toast.show" :class="['ml-toast', `is-${toast.type}`]" role="status">
          <Icon v-if="toast.type === 'success'" name="check" />
          <Icon v-else-if="toast.type === 'error'" name="alert" />
          <Icon v-else name="info" />
          <span>{{ toast.message }}</span>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
<script lang="ts">
import Icon from './Icon.vue'
import { defineComponent } from 'vue'
import { useDashboardContext } from '../../composables/dashboardContext'

export default defineComponent({
  name: 'MemesLunaToast',
  components: { Icon },
  setup() {
    return useDashboardContext()
  },
})
</script>
