<template>
  <Teleport to="body">
    <Transition name="ml-dialog">
      <div v-if="open" ref="overlay" class="ml-theme ml-overlay" @mousedown.self="requestClose">
        <component
          :is="as"
          class="ml-dialog"
          :class="size && `is-${size}`"
          role="dialog"
          aria-modal="true"
          :aria-label="label"
          @submit.prevent="$emit('submit')"
        >
          <slot></slot>
        </component>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
import { defineComponent, nextTick, onUnmounted, ref, watch, type PropType } from 'vue'

/**
 * 弹窗外壳：负责遮罩、动画、Esc 关闭和打开时聚焦第一个输入框。
 * 多个弹窗叠加时只有最上层响应 Esc；确认框带 is-top，始终压在普通弹窗之上。
 */
export default defineComponent({
  name: 'ModalShell',
  props: {
    open: Boolean,
    label: { type: String, default: '' },
    size: { type: String as PropType<'' | 'medium' | 'wide'>, default: '' },
    as: { type: String as PropType<'div' | 'form'>, default: 'div' },
    closable: { type: Boolean, default: true },
  },
  emits: ['close', 'submit'],
  setup(props, { emit }) {
    const overlay = ref<HTMLElement>()

    function requestClose() {
      if (props.closable) emit('close')
    }

    function onKeydown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !overlay.value) return
      // 确认框（is-top）总在最上层，其余按 DOM 顺序取最后一个。
      const overlays = document.querySelectorAll('.ml-overlay')
      const top = document.querySelector('.ml-overlay.is-top') || overlays[overlays.length - 1]
      if (top !== overlay.value) return
      event.stopPropagation()
      requestClose()
    }

    watch(() => props.open, async (open) => {
      if (!open) {
        window.removeEventListener('keydown', onKeydown, true)
        return
      }
      window.addEventListener('keydown', onKeydown, true)
      await nextTick()
      const target = overlay.value?.querySelector<HTMLElement>('[autofocus], input:not([disabled]), textarea:not([disabled])')
      target?.focus()
    }, { immediate: true })

    onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

    return { overlay, requestClose }
  },
})
</script>
