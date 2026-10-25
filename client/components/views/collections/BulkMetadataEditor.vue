<template>
  <ModalShell :open="bulkTagEditorVisible" size="medium" label="批量编辑标注" :closable="!bulkTagEditorSaving" @close="bulkTagEditorVisible = false">
      <div class="ml-dialog-head is-split">
        <div>
          <h3>批量编辑标注</h3>
          <p class="ml-hint">将应用到选中的 {{ selectedLocalImages.length }} 张本地图片<template v-if="selectedLinks.length">，外链不支持标注，已跳过 {{ selectedLinks.length }} 个</template></p>
        </div>
        <button type="button" class="ml-icon-btn" title="关闭" :disabled="bulkTagEditorSaving" @click="bulkTagEditorVisible = false">
          <Icon name="x" />
        </button>
      </div>

      <div class="ml-field">
        <div class="ml-field-label"><span>应用方式</span></div>
        <div class="ml-segmented is-full">
          <button type="button" :class="{ 'is-active': bulkTagOperationMode === 'add' }" @click="bulkTagOperationMode = 'add'">追加到现有标注</button>
          <button type="button" :class="{ 'is-active': bulkTagOperationMode === 'replace' }" @click="bulkTagOperationMode = 'replace'">替换现有标注</button>
        </div>
      </div>

      <div class="ml-field">
        <div class="ml-field-label"><span>语义标签</span></div>
        <div class="ml-chip-box">
          <span v-for="tag in bulkTagEditorTags" :key="tag" class="ml-tag is-removable" :style="{ '--tag-hue': tagHue(tag) }">
            {{ tag }}
            <button type="button" :disabled="bulkTagEditorSaving" @click="removeTagFromBulkEditor(tag)">×</button>
          </span>
          <input v-model="bulkTagEditorInput" class="ml-chip-input" placeholder="输入后按回车添加" :disabled="bulkTagEditorSaving" @keydown.enter.prevent="$event.isComposing || addTagToBulkEditor()" />
        </div>
      </div>

      <div class="ml-field">
        <div class="ml-field-label"><span>检索别名</span></div>
        <div class="ml-chip-box">
          <span v-for="alias in bulkTagEditorAliases" :key="alias" class="ml-tag is-alias is-removable">
            {{ alias }}
            <button type="button" :disabled="bulkTagEditorSaving" @click="removeAliasFromBulkEditor(alias)">×</button>
          </span>
          <input v-model="bulkAliasEditorInput" class="ml-chip-input" placeholder="输入后按回车添加" :disabled="bulkTagEditorSaving" @keydown.enter.prevent="$event.isComposing || addAliasToBulkEditor()" />
        </div>
      </div>

      <p v-if="bulkTagOperationMode === 'replace'" class="ml-callout is-warning">替换会清空这些图片原有的标签和别名，只保留上面填写的内容。</p>

      <div class="ml-dialog-actions">
        <button type="button" class="ml-btn" :disabled="bulkTagEditorSaving" @click="bulkTagEditorVisible = false">取消</button>
        <button type="button" class="ml-btn is-primary" :disabled="bulkTagEditorSaving || (!bulkTagEditorTags.length && !bulkTagEditorAliases.length)" @click="saveBulkTagEditor">
          {{ bulkTagEditorSaving ? '保存中…' : '应用' }}
        </button>
      </div>
  </ModalShell>
</template>
<script lang="ts">
import Icon from '../../shared/Icon.vue'
import ModalShell from '../../shared/ModalShell.vue'
import { defineComponent } from 'vue'
import { useDashboardContext } from '../../../composables/dashboardContext'

export default defineComponent({
  name: 'BulkMetadataEditor',
  components: { ModalShell, Icon },
  setup() {
    return useDashboardContext()
  },
})
</script>
