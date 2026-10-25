<template>
  <ModalShell :open="collectionEditor.open" as="form" size="medium" label="编辑表情包信息" :closable="!collectionEditor.saving" @close="collectionEditor.open = false" @submit="saveCollectionEditor">
    <div class="ml-dialog-head is-split">
      <h3>编辑表情包信息</h3>
      <button type="button" class="ml-icon-btn" title="关闭" :disabled="collectionEditor.saving" @click="collectionEditor.open = false"><Icon name="x" /></button>
    </div>

    <label class="ml-field">
      <span class="ml-field-label"><span>名称</span><span class="ml-hint">也是随机图地址的最后一段</span></span>
      <input v-model="collectionEditor.name" class="ml-input" :class="{ 'is-invalid': collectionEditorNameError }" maxlength="64" autofocus />
      <span v-if="collectionEditorNameError" class="ml-field-error">{{ collectionEditorNameError }}</span>
    </label>

    <label class="ml-field">
      <span class="ml-field-label"><span>描述</span><span class="ml-hint">会展示给 ChatLuna，帮助它判断什么时候用</span></span>
      <textarea v-model="collectionEditor.description" rows="3" class="ml-textarea" placeholder="例如：经典熊猫头，适合吐槽和阴阳怪气"></textarea>
    </label>

    <div class="ml-preview-line">
      <span class="ml-label">随机图地址</span>
      <code>{{ collectionEditor.name.trim() ? getDisplayPath(collectionEditor.name.trim()) : '填写名称后生成' }}</code>
    </div>
    <p v-if="renamed" class="ml-callout is-warning is-compact"><Icon name="alert" /><span>改名后旧地址会失效，用到旧地址的地方需要一起改。</span></p>

    <div class="ml-dialog-actions">
      <button type="button" class="ml-btn" :disabled="collectionEditor.saving" @click="collectionEditor.open = false">取消</button>
      <button type="submit" class="ml-btn is-primary" :disabled="collectionEditor.saving || !collectionEditor.name.trim() || !!collectionEditorNameError">
        <span v-if="collectionEditor.saving" class="ml-spinner is-small is-inverse"></span>
        保存
      </button>
    </div>
  </ModalShell>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useDashboardContext } from '../../../composables/dashboardContext'
import Icon from '../../shared/Icon.vue'
import ModalShell from '../../shared/ModalShell.vue'

export default defineComponent({
  name: 'CollectionInfoEditor',
  components: { ModalShell, Icon },
  setup() {
    const ctx = useDashboardContext()
    const renamed = computed(() => {
      const name = ctx.collectionEditor.name.trim()
      return !!name && name !== ctx.collectionEditor.original
    })
    return { ...ctx, renamed }
  },
})
</script>
