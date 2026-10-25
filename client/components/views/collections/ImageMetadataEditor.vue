<template>
  <ModalShell :open="tagEditorVisible" as="form" size="wide" label="编辑标注" :closable="!tagEditorSaving" @close="closeTagEditor" @submit="saveTagEditor">
      <div class="cm-dialog-head is-split">
        <div>
          <h3>编辑标注</h3>
          <p class="cm-hint">{{ tagEditorImage }}</p>
        </div>
        <button type="button" class="cm-icon-btn" title="关闭" :disabled="tagEditorSaving" @click="closeTagEditor">
          <Icon name="x" />
        </button>
      </div>

      <div class="cm-editor">
        <div class="cm-editor-preview">
          <img :src="editorImageUrl" alt="" />
        </div>

        <div class="cm-editor-fields">
          <div class="cm-field">
            <div class="cm-field-label">
              <span>语义标签</span>
              <span class="cm-hint">情绪、动作、场景等，用于检索打分</span>
            </div>
            <div class="cm-chip-box">
              <span v-for="tag in tagEditorTags" :key="tag" class="cm-tag is-removable" :style="{ '--tag-hue': tagHue(tag) }">
                {{ tag }}
                <button type="button" :disabled="aiAnnotating" title="移除" @click="removeTagFromEditor(tag)">×</button>
              </span>
              <input
                v-model="tagEditorInput"
                class="cm-chip-input"
                :placeholder="tagEditorTags.length ? '继续添加…' : '输入后按回车添加，如：开心'"
                :disabled="aiAnnotating"
                @keydown.enter.prevent="$event.isComposing || addTagFromEditor()"
              />
            </div>
          </div>

          <div class="cm-field">
            <div class="cm-field-label">
              <span>检索别名</span>
              <span class="cm-hint">自然语言描述，用于 <code>?q=</code> 搜索</span>
            </div>
            <div class="cm-chip-box">
              <span v-for="alias in tagEditorAliases" :key="alias" class="cm-tag is-alias is-removable">
                {{ alias }}
                <button type="button" :disabled="aiAnnotating" title="移除" @click="removeAliasFromEditor(alias)">×</button>
              </span>
              <input
                v-model="aliasEditorInput"
                class="cm-chip-input"
                :placeholder="tagEditorAliases.length ? '继续添加…' : '输入后按回车添加，如：猫猫开心地跳起来'"
                :disabled="aiAnnotating"
                @keydown.enter.prevent="$event.isComposing || addAliasFromEditor()"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="cm-dialog-actions is-split">
        <div class="cm-ai-action">
          <button type="button" class="cm-btn is-soft" :disabled="aiAnnotating || tagEditorSaving" @click="triggerAIAnnotation">
            <span v-if="aiAnnotating" class="cm-spinner is-small"></span>
            <Icon v-else name="sparkles" />
            {{ aiAnnotating ? 'AI 识别中…' : (aiFilled ? '重新识别' : 'AI 自动标注') }}
          </button>
          <span v-if="aiFilled && !aiAnnotating" class="cm-hint">已填入 AI 结果，检查后保存</span>
        </div>
        <div class="cm-actions">
          <button type="button" class="cm-btn" :disabled="tagEditorSaving" @click="closeTagEditor">取消</button>
          <button type="submit" class="cm-btn is-primary" :disabled="!tagEditorDirty || tagEditorSaving || aiAnnotating">
            <span v-if="tagEditorSaving" class="cm-spinner is-small is-inverse"></span>
            保存
          </button>
        </div>
      </div>
  </ModalShell>
</template>
<script lang="ts">
import Icon from '../../shared/Icon.vue'
import ModalShell from '../../shared/ModalShell.vue'
import { computed, defineComponent } from 'vue'
import { useDashboardContext } from '../../../composables/dashboardContext'

export default defineComponent({
  name: 'ImageMetadataEditor',
  components: { ModalShell, Icon },
  setup() {
    const ctx = useDashboardContext()
    const editorImageUrl = computed(() => {
      if (!ctx.tagEditorCollection.value || !ctx.tagEditorImage.value) return ''
      const item = ctx.paginatedGalleryItems.value.find((entry) => entry.type === 'local' && entry.value === ctx.tagEditorImage.value)
      return item?.src || ''
    })
    return { ...ctx, editorImageUrl }
  },
})
</script>
