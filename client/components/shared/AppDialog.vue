<template>
  <Teleport to="body">
    <Transition name="ml-dialog">
      <div v-if="dialog.visible" class="ml-theme ml-overlay is-top" @mousedown.self="cancelDialog" @keydown.esc.stop="cancelDialog">
        <div
          class="ml-dialog"
          :class="{ 'is-danger': dialog.options.danger }"
          role="dialog"
          aria-modal="true"
          :aria-label="dialog.options.title"
        >
          <div class="ml-dialog-head">
            <span v-if="dialog.options.danger" class="ml-dialog-icon">
              <Icon name="alert" />
            </span>
            <h3>{{ dialog.options.title }}</h3>
          </div>
          <p v-if="dialog.options.message" class="ml-dialog-message">{{ dialog.options.message }}</p>

          <div v-if="dialog.options.input" class="ml-dialog-field">
            <input
              ref="inputEl"
              v-model="dialog.value"
              class="ml-input"
              :class="{ 'is-invalid': dialog.error }"
              :placeholder="dialog.options.input.placeholder"
              :maxlength="dialog.options.input.maxlength"
              @input="dialog.error = ''"
              @keydown.enter.prevent="$event.isComposing || submitDialog()"
            />
          </div>

          <div v-else-if="dialog.options.choices" class="ml-dialog-choices">
            <el-scrollbar max-height="280px">
              <button
                v-for="choice in dialog.options.choices"
                :key="choice.value"
                type="button"
                class="ml-choice"
                :class="{ 'is-active': dialog.value === choice.value }"
                :disabled="choice.disabled"
                @click="dialog.value = choice.value; dialog.error = ''"
                @dblclick="!choice.disabled && submitDialog()"
              >
                <span class="ml-choice-radio"></span>
                <span class="ml-choice-text">
                  <span class="ml-choice-label">{{ choice.label }}</span>
                  <span v-if="choice.description" class="ml-choice-desc">{{ choice.description }}</span>
                </span>
              </button>
            </el-scrollbar>
          </div>

          <p v-if="dialog.error" class="ml-dialog-error">{{ dialog.error }}</p>

          <div class="ml-dialog-actions">
            <button ref="cancelEl" type="button" class="ml-btn" @click="cancelDialog">{{ dialog.options.cancelText || '取消' }}</button>
            <button
              ref="confirmEl"
              type="button"
              class="ml-btn"
              :class="dialog.options.danger ? 'is-danger' : 'is-primary'"
              @click="submitDialog"
            >{{ dialog.options.confirmText || '确定' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
import Icon from './Icon.vue'
import { defineComponent, nextTick, ref, watch } from 'vue'
import { useDashboardContext } from '../../composables/dashboardContext'

export default defineComponent({
  name: 'AppDialog',
  components: { Icon },
  setup() {
    const { dialog, submitDialog, cancelDialog } = useDashboardContext()
    const inputEl = ref<HTMLInputElement>()
    const confirmEl = ref<HTMLButtonElement>()
    const cancelEl = ref<HTMLButtonElement>()

    watch(() => dialog.visible, async (visible) => {
      if (!visible) return
      await nextTick()
      if (inputEl.value) {
        inputEl.value.focus()
        inputEl.value.select()
      } else if (dialog.options.danger) {
        // 危险操作默认聚焦取消，避免误按回车。
        cancelEl.value?.focus()
      } else {
        confirmEl.value?.focus()
      }
    })

    return { dialog, submitDialog, cancelDialog, inputEl, confirmEl, cancelEl }
  },
})
</script>
