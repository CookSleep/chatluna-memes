<template>
  <section class="cm-view">
    <header class="cm-view-head">
      <div class="cm-view-title">
        <h1 class="cm-title">外部图源</h1>
        <div class="cm-actions">
        <button type="button" class="cm-btn is-primary" @click="openEndpointEditor">
          <Icon name="plus" />
          添加图源
        </button>
        </div>
      </div>
      <p class="cm-subtitle">接入外部的随机图片 API。<br />访问 <code>{{ backendPath }}/名称</code> 时会 302 跳转到图源地址，ChatLuna 也能像使用表情包一样使用它。</p>
    </header>

    <div v-if="endpoints.length" class="cm-callout">
      <Icon name="info" />
      <span>缩略图由你的浏览器直接加载，显示「无法预览」不一定是图源坏了。<br />可能是防盗链、跨域限制、HTTPS 页面里的 HTTP 图片，或者只有服务器能访问的内网地址，请以机器人实际发图为准。</span>
    </div>

    <div v-if="!endpoints.length" class="cm-empty">
      <div class="cm-empty-icon">
        <Icon name="link" />
      </div>
      <h3>还没有外部图源</h3>
      <p>填写一个每次访问都返回随机图片的地址，比如 <code>https://example.com/random</code>。</p>
      <button type="button" class="cm-btn is-primary" @click="openEndpointEditor">添加图源</button>
    </div>

    <div v-else class="cm-source-list">
      <article v-for="item in endpoints" :key="item.name" class="cm-card cm-source-card">
        <a class="cm-source-thumb" :href="getBaseRedirectUrl(item.name)" target="_blank" rel="noopener" title="在新标签页打开">
          <img
            v-if="!brokenThumbs.has(item.name)"
            :src="thumbUrl(item.name)"
            loading="lazy"
            referrerpolicy="no-referrer"
            alt=""
            @error="markBroken(item.name)"
          />
          <span v-else class="cm-source-thumb-fallback" :title="crossOriginHint">
            <Icon name="image" />
            无法预览
          </span>
        </a>
        <div class="cm-source-main">
          <div class="cm-source-title">
            <h3>{{ item.name }}</h3>
            <span v-if="item.description" class="cm-source-desc">{{ item.description }}</span>
          </div>
          <div class="cm-source-row">
            <span class="cm-label">访问地址</span>
            <button type="button" class="cm-link-code" title="点击复制" @click="copyToClipboard(getBaseRedirectUrl(item.name))">{{ getDisplayPath(item.name) }}</button>
          </div>
          <div class="cm-source-row">
            <span class="cm-label">跳转到</span>
            <span class="cm-mono cm-truncate" :title="item.url">{{ item.url }}</span>
          </div>
        </div>
        <div class="cm-source-actions">
          <button type="button" class="cm-icon-btn" title="换一张" @click="reloadThumb(item.name)">
            <Icon name="refresh" />
          </button>
          <button type="button" class="cm-icon-btn" title="编辑" @click="editEndpoint(item)">
            <Icon name="edit" />
          </button>
          <button type="button" class="cm-icon-btn is-danger" title="删除" @click="deleteEndpoint(item.name)">
            <Icon name="trash" />
          </button>
        </div>
      </article>
    </div>

    <ModalShell :open="showEndpointEditor" as="form" size="medium" :label="editingEndpoint ? '编辑图源' : '添加图源'" @close="closeEndpointEditor" @submit="saveEndpoint">
        <div class="cm-dialog-head is-split">
          <h3>{{ editingEndpoint ? `编辑图源「${editingEndpoint.name}」` : '添加图源' }}</h3>
          <button type="button" class="cm-icon-btn" title="关闭" @click="closeEndpointEditor">
            <Icon name="x" />
          </button>
        </div>

        <label class="cm-field">
          <span class="cm-field-label"><span>名称</span><span class="cm-hint">{{ editingEndpoint ? '改名后访问地址会跟着变' : '用于访问地址' }}</span></span>
          <input v-model="endpointForm.name" class="cm-input" :class="{ 'is-invalid': endpointNameError }" placeholder="例如：werewolves" autofocus />
          <span v-if="endpointNameError" class="cm-field-error">{{ endpointNameError }}</span>
        </label>

        <label class="cm-field">
          <span class="cm-field-label"><span>描述</span><span class="cm-hint">会展示给 ChatLuna，帮助它判断什么时候用</span></span>
          <input v-model="endpointForm.description" class="cm-input" placeholder="例如：随机狼图" />
        </label>

        <label class="cm-field">
          <span class="cm-field-label"><span>图源地址</span><span class="cm-hint">每次访问返回一张随机图片的 URL</span></span>
          <div class="cm-input-group">
            <input v-model="endpointForm.url" class="cm-input" :class="{ 'is-invalid': endpointUrlError }" placeholder="https://example.com/random" @input="endpointTestState = 'idle'" />
            <button type="button" class="cm-btn" :disabled="!endpointForm.url.trim() || !!endpointUrlError || endpointTestState === 'loading'" @click="testEndpointTarget"><Icon :name="endpointTestState === 'idle' ? 'play' : 'shuffle'" />{{ endpointTestState === 'idle' ? '试一下' : '换一张' }}</button>
          </div>
          <span v-if="endpointUrlError" class="cm-field-error">{{ endpointUrlError }}</span>
        </label>

        <div v-if="endpointTestState !== 'idle'" class="cm-test-preview" :class="`is-${endpointTestState}`">
          <div class="cm-test-stage">
            <img
              :key="endpointTestKey"
              :src="withNonce(endpointForm.url.trim(), endpointTestKey)"
              alt="图源预览"
              referrerpolicy="no-referrer"
              @load="onTestLoad"
              @error="endpointTestState = 'error'"
            />
            <div v-if="endpointTestState === 'loading'" class="cm-test-overlay">
              <span class="cm-spinner"></span>
              <span>正在请求图源…</span>
            </div>
            <div v-else-if="endpointTestState === 'error'" class="cm-test-overlay">
              <Icon name="imageOff" />
              <span>浏览器没能加载这个图源</span>
            </div>
          </div>
          <div class="cm-test-meta">
            <template v-if="endpointTestState === 'ok'">
              <span class="cm-status-dot is-success"></span>
              <span>已取到图片{{ testImageSize ? ` · ${testImageSize}` : '' }}</span>
            </template>
            <template v-else-if="endpointTestState === 'error'">
              <span class="cm-status-dot is-warning"></span>
              <span>加载失败，不一定是地址错误，见下方说明</span>
            </template>
            <template v-else>
              <span class="cm-status-dot"></span>
              <span>加载中</span>
            </template>
          </div>
          <p v-if="endpointTestState === 'error'" class="cm-test-help">{{ crossOriginHint }}
如果是 Docker 容器名这类内网地址，只要机器人和图源在同一网络里，发图仍然可以正常工作。</p>
        </div>

        <div class="cm-preview-line">
          <span class="cm-label">访问地址</span>
          <code>{{ endpointForm.name.trim() ? getDisplayPath(endpointForm.name.trim()) : '填写名称后生成' }}</code>
        </div>

        <div class="cm-dialog-actions">
          <button type="button" class="cm-btn" @click="closeEndpointEditor">取消</button>
          <button type="submit" class="cm-btn is-primary" :disabled="!endpointForm.name.trim() || !endpointForm.url.trim() || !!endpointNameError || !!endpointUrlError">
            {{ editingEndpoint ? '保存' : '添加' }}
          </button>
        </div>
    </ModalShell>
  </section>
</template>
<script lang="ts">
import Icon from '../../shared/Icon.vue'
import ModalShell from '../../shared/ModalShell.vue'
import { defineComponent, reactive, ref } from 'vue'
import { useDashboardContext } from '../../../composables/dashboardContext'

export default defineComponent({
  name: 'EndpointsView',
  components: { ModalShell, Icon },
  setup() {
    const ctx = useDashboardContext()
    const brokenThumbs = ref(new Set<string>())
    const testImageSize = ref('')

    function onTestLoad(event: Event) {
      const img = event.target as HTMLImageElement
      testImageSize.value = img.naturalWidth ? `${img.naturalWidth} × ${img.naturalHeight}` : ''
      ctx.endpointTestState.value = 'ok'
    }
    const thumbNonce = reactive<Record<string, number>>({})

    function withNonce(url: string, nonce: number) {
      if (!nonce) return url
      return url + (url.includes('?') ? '&' : '?') + '_ml=' + nonce
    }
    function thumbUrl(name: string) {
      return withNonce(ctx.getBaseRedirectUrl(name), thumbNonce[name] || 0)
    }
    function markBroken(name: string) {
      brokenThumbs.value = new Set(brokenThumbs.value).add(name)
    }
    function reloadThumb(name: string) {
      const next = new Set(brokenThumbs.value)
      next.delete(name)
      brokenThumbs.value = next
      thumbNonce[name] = Date.now()
    }

    return { ...ctx, brokenThumbs, thumbUrl, markBroken, reloadThumb, withNonce, testImageSize, onTestLoad }
  },
})
</script>
