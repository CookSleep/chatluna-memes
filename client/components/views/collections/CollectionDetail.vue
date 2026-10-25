<template>
  <section class="ml-view" @dragenter.prevent="dragOver = true" @dragover.prevent="dragOver = true">
    <div class="ml-detail-top">
      <button type="button" class="ml-btn is-ghost" @click="exitCollectionDetail">
        <Icon name="back" />全部表情包
      </button>
      <div class="ml-actions">
        <button type="button" class="ml-btn" title="重新读取图片列表" @click="refreshCollectionResources"><Icon name="refresh" />刷新</button>
        <button type="button" class="ml-btn" @click="showImportLinks = true"><Icon name="link" />导入外链</button>
        <button type="button" class="ml-btn is-primary" :disabled="!!uploadProgress" @click="triggerFileInput">
          <span v-if="uploadProgress" class="ml-spinner is-small is-inverse"></span>
          <Icon v-else name="upload" />
          {{ uploadProgress ? `上传中 ${uploadProgress.done}/${uploadProgress.total}` : '上传图片' }}
        </button>
        <button type="button" class="ml-icon-btn is-danger" title="删除表情包" @click="confirmDeleteCollection(currentCollection.name)"><Icon name="trash" /></button>
        <input ref="fileInput" type="file" multiple accept="image/*" class="ml-hidden" @change="onFileSelected" />
      </div>
    </div>

    <div class="ml-detail-hero">
      <div class="ml-card ml-identity">
        <div class="ml-avatar">
          <img v-if="currentCollectionCoverUrl" :src="currentCollectionCoverUrl" alt="" referrerpolicy="no-referrer" />
          <Icon v-else name="smile" />
        </div>
        <div class="ml-identity-text">
          <div class="ml-identity-head">
            <h1 class="ml-title" :title="currentCollection.name">{{ currentCollection.name }}</h1>
            <button type="button" class="ml-icon-btn is-small" title="编辑信息" @click="openCollectionEditor(currentCollection)"><Icon name="edit" /></button>
          </div>
          <p class="ml-identity-desc" :class="{ 'is-empty': !currentCollection.description }" :title="currentCollection.description">
            {{ currentCollection.description || '还没有描述，点右上角的笔可以添加，帮助 ChatLuna 判断什么时候用这个表情包。' }}
          </p>
          <div class="ml-meta-line">
            <span>{{ currentCollection.localCount }} 张图片</span>
            <span v-if="currentCollection.linkCount">{{ currentCollection.linkCount }} 个外链</span>
            <span>更新于 {{ formatDate(currentCollection.updatedAt) }}</span>
          </div>
        </div>
      </div>

      <div class="ml-card ml-api-card">
        <div class="ml-api-text">
          <div class="ml-label">随机图地址</div>
          <div class="ml-copy-field" title="点击复制" @click="copyToClipboard(currentCollectionApiUrl, '随机图地址')">
            <code>{{ decodeURI(currentCollectionApiUrl) }}</code>
            <Icon name="copy" />
          </div>
          <p class="ml-hint">每次访问随机返回一张图片。<br />点右边可以试一下效果。</p>
        </div>
        <button
          type="button"
          class="ml-api-preview"
          :class="{ 'is-empty': !apiPreviewUrl, 'is-loading': apiPreviewLoading }"
          :disabled="apiPreviewLoading"
          :title="apiPreviewUrl ? '换一张' : '试一下'"
          @click="testCurrentCollectionApi"
        >
          <img v-if="apiPreviewUrl" :src="apiPreviewUrl" alt="随机图预览" referrerpolicy="no-referrer" @load="onApiPreviewLoad" @error="onApiPreviewError" />
          <span v-if="apiPreviewLoading" class="ml-api-preview-state"><span class="ml-spinner is-small"></span></span>
          <span v-else-if="!apiPreviewUrl" class="ml-api-preview-state"><Icon name="shuffle" />试一下</span>
          <span v-else class="ml-api-preview-state is-overlay"><Icon name="shuffle" />换一张</span>
        </button>
      </div>
    </div>

    <ModalShell :open="showImportLinks" as="form" size="medium" label="导入外链" @close="showImportLinks = false" @submit="addExternalLinks">
        <div class="ml-dialog-head is-split">
          <div>
            <h3>导入外链</h3>
            <p class="ml-hint">导入到「{{ currentCollection.name }}」，外链图片不会下载到本地。</p>
          </div>
          <button type="button" class="ml-icon-btn" title="关闭" @click="showImportLinks = false"><Icon name="x" /></button>
        </div>
        <label class="ml-field">
          <span class="ml-field-label"><span>图片地址</span><span class="ml-hint">每行一个，以 http:// 或 https:// 开头</span></span>
          <textarea id="ml-import-links" v-model="externalLinksText" rows="7" class="ml-textarea" placeholder="https://example.com/a.png&#10;https://example.com/b.gif" autofocus></textarea>
        </label>
        <p class="ml-hint">对方开启防盗链时，管理页里可能无法预览，但不影响机器人使用。</p>
        <div class="ml-dialog-actions">
          <button type="button" class="ml-btn" @click="showImportLinks = false">取消</button>
          <button type="submit" class="ml-btn is-primary" :disabled="!externalLinksText.trim()"><Icon name="link" />导入</button>
        </div>
    </ModalShell>

    <ImageGallery />
    <ImageMetadataEditor />
    <BulkMetadataEditor />

    <Transition name="ml-fade">
      <div
        v-show="dragOver"
        class="ml-drop-overlay"
        @dragover.prevent="dragOver = true"
        @dragleave.self.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div class="ml-drop-box">
          <Icon name="upload" />
          <p>松开即可上传到「{{ currentCollection.name }}」</p>
        </div>
      </div>
    </Transition>
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useDashboardContext } from '../../../composables/dashboardContext'
import Icon from '../../shared/Icon.vue'
import ModalShell from '../../shared/ModalShell.vue'
import ImageMetadataEditor from './ImageMetadataEditor.vue'
import BulkMetadataEditor from './BulkMetadataEditor.vue'
import ImageGallery from './ImageGallery.vue'

export default defineComponent({
  name: 'CollectionDetail',
  components: {
    ModalShell,
    Icon,
    ImageMetadataEditor,
    BulkMetadataEditor,
    ImageGallery,
  },
  setup() {
    return useDashboardContext()
  },
})
</script>
