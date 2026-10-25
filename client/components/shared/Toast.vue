<template>
  <Teleport to="body">
    <div class="cm-theme cm-toast-layer">
      <Transition name="cm-toast">
        <div v-if="toast.show" :class="['cm-toast', `is-${toast.type}`]" role="status">
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
  name: 'ChatLunaMemesToast',
  components: { Icon },
  setup() {
    return useDashboardContext()
  },
})
</script>
