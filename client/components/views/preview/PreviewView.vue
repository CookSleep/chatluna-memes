<template>
  <section class="cm-view">
    <header class="cm-view-head">
      <div class="cm-view-title">
        <h1 class="cm-title">预览</h1>
        <div class="cm-actions">
        <button type="button" class="cm-btn" @click="fetchSettingsPreview">
          <Icon name="refresh" />
          刷新
        </button>
        </div>
      </div>
      <p class="cm-subtitle">查看 ChatLuna 能用到的随机图清单、最终注入的提示词，以及 AI 标注的运行情况。</p>
    </header>

    <div class="cm-stat-grid">
      <div class="cm-card cm-stat">
        <span class="cm-label">表情包</span>
        <strong>{{ collections.length }}</strong>
        <span class="cm-hint">{{ totalLocalImages }} 张图片<template v-if="totalLinks"> · {{ totalLinks }} 个外链</template></span>
      </div>
      <div class="cm-card cm-stat">
        <span class="cm-label">外部图源</span>
        <strong>{{ endpoints.length }}</strong>
        <span class="cm-hint">302 跳转到外部 API</span>
      </div>
      <div class="cm-card cm-stat is-clickable" @click="switchMainMenu('staging')">
        <span class="cm-label">暂缓区</span>
        <strong :class="{ 'is-warning': stagedImages.length }">{{ stagedImages.length }}</strong>
        <span class="cm-hint">{{ stagedImages.length ? '张图片等待处理' : '没有待处理图片' }}</span>
      </div>
      <div class="cm-card cm-stat">
        <span class="cm-label">ChatLuna 注入</span>
        <strong :class="settings?.injectVariables ? 'is-success' : 'is-muted'">{{ settings?.injectVariables ? '已开启' : '未开启' }}</strong>
        <span class="cm-hint">{{ settings?.injectVariables ? '变量需填入预设后才生效' : '可在「配置」中开启' }}</span>
      </div>
    </div>

    <div class="cm-card cm-section-card cm-annotation-card">
      <div class="cm-card-head">
        <div>
          <h3>AI 标注</h3>
          <p class="cm-hint" v-if="settings && !settings.annotatorReady">标注模型未就绪，可在<button type="button" class="cm-inline-link" @click="openConfig('cm-cfg-model')">「配置」</button>中选择模型。</p>
          <p class="cm-hint" v-else-if="settings && !settings.autoAnnotate">已关闭自动标注，新图片需要手动识别。</p>
          <p class="cm-hint" v-else>上传、偷图和归档时自动生成标签与别名。</p>
        </div>
        <div class="cm-actions">
          <button
            v-if="annotationStatus && (annotationStatus.pending || annotationStatus.active)"
            type="button"
            class="cm-btn is-small is-danger-soft"
            :disabled="annotationStatusBusy"
            @click="cancelAnnotationTasks"
          ><Icon name="x" />取消标注任务</button>
          <button type="button" class="cm-btn is-small" @click="refreshAnnotationStatus"><Icon name="refresh" />刷新</button>
        </div>
      </div>
      <template v-if="annotationStatus">
        <div class="cm-kv-grid is-strip">
          <div><span>排队</span><b>{{ annotationStatus.pending }}</b></div>
          <div><span>处理中</span><b>{{ annotationStatus.active }}</b></div>
          <div><span>成功</span><b class="is-success">{{ annotationStatus.success }}</b></div>
          <div><span>失败</span><b :class="{ 'is-danger': annotationStatus.fail }">{{ annotationStatus.fail }}</b></div>
          <div><span>跳过</span><b>{{ annotationStatus.skipped }}</b></div>
          <div><span>已取消</span><b>{{ annotationStatus.cancelled }}</b></div>
        </div>
        <div v-if="annotationStatus.usage" class="cm-usage">
          <div class="cm-usage-head">
            <span>今日请求</span>
            <span><b>{{ annotationStatus.usage.requests }}</b> / {{ annotationStatus.usage.dailyLimit || '不限' }}</span>
          </div>
          <div v-if="annotationStatus.usage.dailyLimit" class="cm-meter">
            <div :style="{ width: Math.min(100, annotationStatus.usage.requests / annotationStatus.usage.dailyLimit * 100) + '%' }"></div>
          </div>
          <p class="cm-hint">重试 {{ annotationStatus.usage.retries }} 次 · 成功 {{ annotationStatus.usage.successes }} · 失败 {{ annotationStatus.usage.failures }}（按 UTC 日期重置）</p>
        </div>
      </template>
      <div v-else class="cm-loading is-inline"><div class="cm-spinner is-small"></div><p>读取中…</p></div>
    </div>

    <div class="cm-card cm-section-card">
      <div class="cm-card-head">
        <div>
          <h3>随机图清单</h3>
          <p class="cm-hint">对应 <code>{chatluna_memes_list}</code>，空表情包不列出。需要把变量填入 ChatLuna 预设中合适的位置才能生效。</p>
        </div>
        <button type="button" class="cm-btn is-small" :disabled="!routeInventoryText" @click="copyToClipboard(routeInventoryText, '随机图清单')"><Icon name="copy" />复制</button>
      </div>

      <div v-if="previewRouteRows.length" class="cm-route-list">
        <div v-for="row in previewRouteRows" :key="row.id" class="cm-route">
          <div class="cm-route-thumb" :class="`is-${row.type}`">
            <img v-if="row.previewImages.length" :src="row.previewImages[0]" loading="lazy" alt="" referrerpolicy="no-referrer" @error="handlePreviewImageError(row)" />
            <Icon v-else-if="row.type === 'endpoint'" name="link" />
            <Icon v-else name="smile" />
          </div>
          <div class="cm-route-main">
            <div class="cm-route-title">
              <span class="cm-route-name">{{ row.name }}</span>
              <span class="cm-badge" :class="row.type === 'endpoint' ? 'is-accent' : ''">{{ row.type === 'endpoint' ? '外部图源' : '表情包' }}</span>
            </div>
            <div class="cm-route-desc" :title="row.description">{{ row.description }}</div>
          </div>
          <button type="button" class="cm-link-code" title="点击复制" @click="copyToClipboard(row.fullUrl)">{{ getDisplayPath(row.name) }}</button>
          <a class="cm-icon-btn is-small" :href="row.fullUrl" target="_blank" rel="noopener" title="在新标签页打开">
            <Icon name="external" />
          </a>
        </div>
      </div>
      <div v-else class="cm-empty is-compact">
        <h3>还没有可用的路由</h3>
        <p>先去新建表情包并上传图片，或者添加外部图源。</p>
      </div>
    </div>

    <div id="cm-preview-prompt" class="cm-card cm-section-card">
      <div class="cm-card-head">
        <div>
          <h3>最终提示词</h3>
          <p class="cm-hint">对应 <code>{chatluna_memes}</code>。把变量填入 ChatLuna 预设中合适的位置后，模型看到的就是这段文本。</p>
        </div>
        <button type="button" class="cm-btn is-small" :disabled="!llmPromptPreview" @click="copyToClipboard(llmPromptPreview, '提示词')"><Icon name="copy" />复制</button>
      </div>
      <div v-if="settings && !settings.injectVariables" class="cm-callout is-warning">
        <Icon name="alert" />
        <span>当前没有开启 ChatLuna 变量注入，下面只是预览，模型实际看不到这段内容。<br />如需启用，请在<button type="button" class="cm-inline-link" @click="openConfig('cm-config-chatluna')">「配置」</button>中开启 ChatLuna 注入。</span>
      </div>
      <el-scrollbar max-height="420px" class="cm-code">
        <pre v-if="llmPromptPreview">{{ llmPromptPreview }}</pre>
        <pre v-else class="is-placeholder">正在生成…</pre>
      </el-scrollbar>
    </div>
  </section>
</template>
<script lang="ts">
import Icon from '../../shared/Icon.vue'
import { defineComponent, nextTick, watch } from 'vue'
import { useDashboardContext } from '../../../composables/dashboardContext'
import { scrollAndFlash } from '../../../utils/highlight'

export default defineComponent({
  name: 'PreviewView',
  components: { Icon },
  setup() {
    const ctx = useDashboardContext()
    watch(ctx.previewTarget, (target) => {
      if (!target) return
      ctx.previewTarget.value = null
      void nextTick(() => {
        const el = document.getElementById(target)
        const head = el?.querySelector<HTMLElement>('.cm-card-head')
        if (el && head) scrollAndFlash(el, head, 'start')
      })
    }, { immediate: true })
    return ctx
  },
})
</script>
