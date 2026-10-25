<template>
  <section class="ml-view">
    <header class="ml-view-head">
      <div class="ml-view-title">
        <h1 class="ml-title">预览</h1>
        <div class="ml-actions">
        <button type="button" class="ml-btn" @click="fetchSettingsPreview">
          <Icon name="refresh" />
          刷新
        </button>
        </div>
      </div>
      <p class="ml-subtitle">查看 ChatLuna 能用到的随机图清单、最终注入的提示词，以及 AI 标注的运行情况。</p>
    </header>

    <div class="ml-stat-grid">
      <div class="ml-card ml-stat">
        <span class="ml-label">表情包</span>
        <strong>{{ collections.length }}</strong>
        <span class="ml-hint">{{ totalLocalImages }} 张图片<template v-if="totalLinks"> · {{ totalLinks }} 个外链</template></span>
      </div>
      <div class="ml-card ml-stat">
        <span class="ml-label">外部图源</span>
        <strong>{{ endpoints.length }}</strong>
        <span class="ml-hint">302 跳转到外部 API</span>
      </div>
      <div class="ml-card ml-stat is-clickable" @click="switchMainMenu('staging')">
        <span class="ml-label">暂缓区</span>
        <strong :class="{ 'is-warning': stagedImages.length }">{{ stagedImages.length }}</strong>
        <span class="ml-hint">{{ stagedImages.length ? '张图片等待处理' : '没有待处理图片' }}</span>
      </div>
      <div class="ml-card ml-stat">
        <span class="ml-label">ChatLuna 注入</span>
        <strong :class="settings?.injectVariables ? 'is-success' : 'is-muted'">{{ settings?.injectVariables ? '已开启' : '未开启' }}</strong>
        <span class="ml-hint">{{ settings?.injectVariables ? '变量 {endpoint} 和 {memesluna}' : '可在「配置」中开启' }}</span>
      </div>
    </div>

    <div class="ml-card ml-section-card ml-annotation-card">
      <div class="ml-card-head">
        <div>
          <h3>AI 标注</h3>
          <p class="ml-hint" v-if="settings && !settings.annotatorReady">标注模型未就绪，可在<button type="button" class="ml-inline-link" @click="openConfig('ml-cfg-model')">「配置」</button>中选择模型。</p>
          <p class="ml-hint" v-else-if="settings && !settings.autoAnnotate">已关闭自动标注，新图片需要手动识别。</p>
          <p class="ml-hint" v-else>上传、偷图和归档时自动生成标签与别名。</p>
        </div>
        <div class="ml-actions">
          <button
            v-if="annotationStatus && (annotationStatus.pending || annotationStatus.active)"
            type="button"
            class="ml-btn is-small is-danger-soft"
            :disabled="annotationStatusBusy"
            @click="cancelAnnotationTasks"
          ><Icon name="x" />取消标注任务</button>
          <button type="button" class="ml-btn is-small" @click="refreshAnnotationStatus"><Icon name="refresh" />刷新</button>
        </div>
      </div>
      <template v-if="annotationStatus">
        <div class="ml-kv-grid is-strip">
          <div><span>排队</span><b>{{ annotationStatus.pending }}</b></div>
          <div><span>处理中</span><b>{{ annotationStatus.active }}</b></div>
          <div><span>成功</span><b class="is-success">{{ annotationStatus.success }}</b></div>
          <div><span>失败</span><b :class="{ 'is-danger': annotationStatus.fail }">{{ annotationStatus.fail }}</b></div>
          <div><span>跳过</span><b>{{ annotationStatus.skipped }}</b></div>
          <div><span>已取消</span><b>{{ annotationStatus.cancelled }}</b></div>
        </div>
        <div v-if="annotationStatus.usage" class="ml-usage">
          <div class="ml-usage-head">
            <span>今日请求</span>
            <span><b>{{ annotationStatus.usage.requests }}</b> / {{ annotationStatus.usage.dailyLimit || '不限' }}</span>
          </div>
          <div v-if="annotationStatus.usage.dailyLimit" class="ml-meter">
            <div :style="{ width: Math.min(100, annotationStatus.usage.requests / annotationStatus.usage.dailyLimit * 100) + '%' }"></div>
          </div>
          <p class="ml-hint">重试 {{ annotationStatus.usage.retries }} 次 · 成功 {{ annotationStatus.usage.successes }} · 失败 {{ annotationStatus.usage.failures }}（按 UTC 日期重置）</p>
        </div>
      </template>
      <div v-else class="ml-loading is-inline"><div class="ml-spinner is-small"></div><p>读取中…</p></div>
    </div>

    <div class="ml-card ml-section-card">
      <div class="ml-card-head">
        <div>
          <h3>随机图清单</h3>
          <p class="ml-hint">对应 <code>{endpoint}</code>，表情包和外部图源合在一张清单里，空表情包不列出。</p>
        </div>
        <button type="button" class="ml-btn is-small" :disabled="!routeInventoryText" @click="copyToClipboard(routeInventoryText, '随机图清单')"><Icon name="copy" />复制</button>
      </div>

      <div v-if="previewRouteRows.length" class="ml-route-list">
        <div v-for="row in previewRouteRows" :key="row.id" class="ml-route">
          <div class="ml-route-thumb" :class="`is-${row.type}`">
            <img v-if="row.previewImages.length" :src="row.previewImages[0]" loading="lazy" alt="" referrerpolicy="no-referrer" @error="handlePreviewImageError(row)" />
            <Icon v-else-if="row.type === 'endpoint'" name="link" />
            <Icon v-else name="smile" />
          </div>
          <div class="ml-route-main">
            <div class="ml-route-title">
              <span class="ml-route-name">{{ row.name }}</span>
              <span class="ml-badge" :class="row.type === 'endpoint' ? 'is-accent' : ''">{{ row.type === 'endpoint' ? '外部图源' : '表情包' }}</span>
            </div>
            <div class="ml-route-desc" :title="row.description">{{ row.description }}</div>
          </div>
          <button type="button" class="ml-link-code" title="点击复制" @click="copyToClipboard(row.fullUrl)">{{ getDisplayPath(row.name) }}</button>
          <a class="ml-icon-btn is-small" :href="row.fullUrl" target="_blank" rel="noopener" title="在新标签页打开">
            <Icon name="external" />
          </a>
        </div>
      </div>
      <div v-else class="ml-empty is-compact">
        <h3>还没有可用的路由</h3>
        <p>先去新建表情包并上传图片，或者添加外部图源。</p>
      </div>
    </div>

    <div class="ml-card ml-section-card">
      <div class="ml-card-head">
        <div>
          <h3>最终提示词</h3>
          <p class="ml-hint">对应 <code>{memesluna}</code>，即实际注入给模型的完整文本。</p>
        </div>
        <button type="button" class="ml-btn is-small" :disabled="!llmPromptPreview" @click="copyToClipboard(llmPromptPreview, '提示词')"><Icon name="copy" />复制</button>
      </div>
      <div v-if="settings && !settings.injectVariables" class="ml-callout is-warning">
        <Icon name="alert" />
        <span>当前没有开启 ChatLuna 变量注入，下面只是预览，模型实际看不到这段内容。<br />如需启用，请在<button type="button" class="ml-inline-link" @click="openConfig('ml-config-chatluna')">「配置」</button>中开启 ChatLuna 注入。</span>
      </div>
      <el-scrollbar max-height="420px" class="ml-code">
        <pre v-if="llmPromptPreview">{{ llmPromptPreview }}</pre>
        <pre v-else class="is-placeholder">正在生成…</pre>
      </el-scrollbar>
    </div>
  </section>
</template>
<script lang="ts">
import Icon from '../../shared/Icon.vue'
import { defineComponent } from 'vue'
import { useDashboardContext } from '../../../composables/dashboardContext'

export default defineComponent({
  name: 'PreviewView',
  components: { Icon },
  setup() {
    return useDashboardContext()
  },
})
</script>
