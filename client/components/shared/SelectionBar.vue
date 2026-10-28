<template>
  <Transition name="cm-bar">
    <div v-if="count" class="cm-selection-bar" role="toolbar" :aria-label="`已选 ${count} 项`">
      <div class="cm-selection-head">
        <button type="button" class="cm-selection-close" title="取消选择（Esc）" @click="$emit('clear')"><Icon name="x" /></button>
        <span class="cm-selection-count">已选 <b>{{ count }}</b> 张</span>
        <button type="button" class="cm-selection-close cm-selection-help" title="快捷键" @click="helpOpen = true"><Icon name="keyboard" /></button>
      </div>
      <span class="cm-selection-sep"></span>
      <div class="cm-selection-actions">
        <slot></slot>
      </div>
    </div>
  </Transition>

  <ModalShell :open="helpOpen" label="多选快捷键" @close="helpOpen = false">
    <header class="cm-dialog-head is-split">
      <h3>多选快捷键</h3>
      <button type="button" class="cm-icon-btn" title="关闭" @click="helpOpen = false"><Icon name="x" /></button>
    </header>
    <dl class="cm-shortcuts">
      <div><dt><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + 点击</dt><dd>选择或取消一张</dd></div>
      <div><dt><kbd>Shift</kbd> + 点击</dt><dd>连续选择一段</dd></div>
      <div><dt><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>A</kbd></dt><dd>全选当前页</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>取消全部选择</dd></div>
      <div><dt>点击左上角圆圈</dt><dd>选择或取消一张（手机上也可用）</dd></div>
    </dl>
    <p class="cm-hint">已经有选中项时，直接点击卡片也只会切换选择，不会打开原图。</p>
  </ModalShell>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
import Icon from './Icon.vue'
import ModalShell from './ModalShell.vue'

/** 多选后固定在列表底部的操作栏，图库和待审区共用。 */
export default defineComponent({
  name: 'SelectionBar',
  components: { Icon, ModalShell },
  props: { count: { type: Number, required: true } },
  emits: ['clear'],
  setup() {
    return { helpOpen: ref(false) }
  },
})
</script>
