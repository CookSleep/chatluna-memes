<template>
  <div ref="row" class="cm-tag-row" :title="tags.join('、')">
    <span v-for="(tag, index) in tags" v-show="index < visible" :key="tag" class="cm-tag" :style="{ '--tag-hue': tagHue(tag) }">{{ tag }}</span>
    <span v-if="visible < tags.length" class="cm-tag is-more">+{{ tags.length - visible }}</span>
  </div>
</template>

<script lang="ts">
import { defineComponent, nextTick, onMounted, onUnmounted, ref, watch, type PropType } from 'vue'
import { tagHue } from '../../utils/format'

// 单行显示标签：放得下几个就完整显示几个，其余计入「+N」；只有第一个标签本身过长时才截断。
export default defineComponent({
  name: 'TagRow',
  props: {
    tags: { type: Array as PropType<string[]>, required: true },
  },
  setup(props) {
    const row = ref<HTMLElement>()
    const visible = ref(props.tags.length)
    let run = 0

    // 逐个减少可见标签直到不溢出；全部在同一帧的微任务里完成，不会闪烁。
    async function fit() {
      const current = ++run
      visible.value = props.tags.length
      await nextTick()
      while (current === run && row.value && visible.value > 1) {
        const first = row.value.firstElementChild as HTMLElement
        if (row.value.scrollWidth <= row.value.clientWidth && first.scrollWidth <= first.clientWidth) break
        visible.value--
        await nextTick()
      }
    }

    const observer = new ResizeObserver(() => void fit())
    onMounted(() => observer.observe(row.value!))
    onUnmounted(() => observer.disconnect())
    watch(() => props.tags.join('\n'), () => void fit())

    return { row, visible, tagHue }
  },
})
</script>
