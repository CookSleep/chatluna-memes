<template>
  <section class="ml-view ml-config">
    <header class="ml-view-head">
      <div class="ml-view-title">
        <h1 class="ml-title">配置</h1>
      </div>
      <p class="ml-subtitle">插件的全部设置都在这里。保存后立即生效，不需要重启 Koishi。</p>
    </header>

    <LoadingSpinner v-if="!configDraft || !configData" message="正在读取配置…" />

    <div v-else class="ml-config-layout">
      <nav class="ml-config-nav" aria-label="配置分区">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          :class="{ 'is-active': activeSection === section.id }"
          @click="scrollToSection(section.id)"
        >
          <Icon :name="section.icon" />
          <span>{{ section.label }}</span>
          <span v-if="sectionChanged(section.keys)" class="ml-config-dot" title="有未保存的修改"></span>
        </button>
      </nav>

      <div class="ml-config-main">
        <!-- 访问地址 -->
        <section id="ml-config-access" class="ml-card ml-config-section">
          <header class="ml-config-head">
            <span class="ml-config-icon"><Icon name="globe" /></span>
            <div class="ml-config-heading">
              <h3>访问地址</h3>
              <p class="ml-hint">随机图、搜索结果和注入提示词里的地址都从这里拼出来。</p>
            </div>
          </header>

          <div class="ml-setting">
            <div class="ml-setting-text">
              <label for="ml-cfg-self-url">对外地址</label>
              <p>机器人发图时使用的地址，需要包含协议和端口。留空则使用 Koishi 的地址<template v-if="configData.serverSelfUrl"> <code>{{ configData.serverSelfUrl }}</code></template>。</p>
            </div>
            <div class="ml-setting-control">
              <input
                id="ml-cfg-self-url"
                v-model.trim="configDraft.selfUrl"
                class="ml-input"
                :class="{ 'is-invalid': configErrors.selfUrl }"
                :placeholder="configData.serverSelfUrl || 'https://bot.example.com'"
                spellcheck="false"
                autocomplete="off"
              />
              <p v-if="configErrors.selfUrl" class="ml-field-error">{{ configErrors.selfUrl }}</p>
            </div>
          </div>

          <div class="ml-setting">
            <div class="ml-setting-text">
              <label for="ml-cfg-backend-path">路由前缀</label>
              <p>所有随机图地址的开头部分。修改后，已经发出去的旧地址会失效。</p>
            </div>
            <div class="ml-setting-control">
              <input
                id="ml-cfg-backend-path"
                v-model.trim="configDraft.backendPath"
                class="ml-input ml-mono"
                :class="{ 'is-invalid': configErrors.backendPath }"
                placeholder="/memesluna"
                spellcheck="false"
                autocomplete="off"
              />
              <p v-if="configErrors.backendPath" class="ml-field-error">{{ configErrors.backendPath }}</p>
              <p v-else class="ml-setting-preview" :title="examplePrefix + '/表情包名'"><span>{{ examplePrefix }}</span>/表情包名</p>
            </div>
          </div>
        </section>

        <!-- ChatLuna -->
        <section id="ml-config-chatluna" class="ml-card ml-config-section">
          <header class="ml-config-head">
            <span class="ml-config-icon"><Icon name="message" /></span>
            <div class="ml-config-heading">
              <h3>ChatLuna 注入</h3>
              <p class="ml-hint">向 ChatLuna 提供变量 <code>{endpoint}</code>（路由清单）和 <code>{memesluna}</code>（使用说明），让模型能发表情包。</p>
            </div>
            <SwitchToggle v-model="configDraft.injectVariables" label="注入 ChatLuna 变量" />
          </header>

          <div class="ml-config-body" :class="{ 'is-off': !configDraft.injectVariables }">
            <div class="ml-setting is-block">
              <div class="ml-setting-text">
                <label for="ml-cfg-inject-prompt">提示词模板</label>
                <p>渲染后成为 <code>{memesluna}</code> 的内容。<code>{endpoint}</code> 会替换成随机图清单，表情包和外部图源用法相同，不再分开列。点占位符可以插入到光标处。</p>
              </div>
              <div class="ml-setting-control">
                <div class="ml-prompt-tools">
                  <div class="ml-token-list">
                    <button v-for="token in injectTokens" :key="token.value" type="button" class="ml-token" :title="token.description" @click="insertToken('injectVariablesPrompt', token.value)">{{ token.value }}</button>
                  </div>
                  <div class="ml-actions">
                    <button type="button" class="ml-btn is-small is-ghost" @click="switchMainMenu('settings')"><Icon name="eye" />预览效果</button>
                    <button type="button" class="ml-btn is-small is-ghost" :disabled="configDraft.injectVariablesPrompt === defaults.injectVariablesPrompt" @click="restoreConfigDefault('injectVariablesPrompt')"><Icon name="undo" />恢复默认</button>
                  </div>
                </div>
                <textarea
                  id="ml-cfg-inject-prompt"
                  ref="injectVariablesPrompt"
                  v-model="configDraft.injectVariablesPrompt"
                  class="ml-textarea"
                  :class="{ 'is-invalid': configErrors.injectVariablesPrompt }"
                  rows="12"
                  spellcheck="false"
                ></textarea>
                <p v-if="configErrors.injectVariablesPrompt" class="ml-field-error">{{ configErrors.injectVariablesPrompt }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 自动收集 -->
        <section id="ml-config-collect" class="ml-card ml-config-section">
          <header class="ml-config-head">
            <span class="ml-config-icon"><Icon name="inbox" /></span>
            <div class="ml-config-heading">
              <h3>自动收集</h3>
              <p class="ml-hint">监听群聊图片，同一张图短时间内反复出现时放进暂缓区，由你确认后再归档。</p>
            </div>
            <SwitchToggle v-model="configDraft.autoCollect" label="自动收集群聊图片" />
          </header>

          <div class="ml-config-body" :class="{ 'is-off': !configDraft.autoCollect }">
            <div class="ml-setting">
              <div class="ml-setting-text">
                <label>触发条件</label>
                <p>在同一个群里统计，已经在表情包或暂缓区里的图片不会重复收集。</p>
              </div>
              <div class="ml-setting-control">
                <div class="ml-setting-inline">
                  <SettingNumber v-model="configDraft.emojiFrequencyWindowMinutes" unit="分钟内" label="统计窗口（分钟）" :min="rules.emojiFrequencyWindowMinutes.min" :max="rules.emojiFrequencyWindowMinutes.max" :error="configErrors.emojiFrequencyWindowMinutes" />
                  <span>出现</span>
                  <SettingNumber v-model="configDraft.emojiFrequencyThreshold" unit="次" label="出现次数" :min="rules.emojiFrequencyThreshold.min" :max="rules.emojiFrequencyThreshold.max" :error="configErrors.emojiFrequencyThreshold" />
                </div>
                <p v-if="configErrors.emojiFrequencyWindowMinutes || configErrors.emojiFrequencyThreshold" class="ml-field-error">
                  {{ configErrors.emojiFrequencyWindowMinutes ? `统计窗口${configErrors.emojiFrequencyWindowMinutes}` : `出现次数${configErrors.emojiFrequencyThreshold}` }}
                </p>
              </div>
            </div>

            <div class="ml-setting">
              <div class="ml-setting-text">
                <label>图片体积</label>
                <p>QQ 表情多在 5~40 KB，下限设得太高会漏掉大部分表情。</p>
              </div>
              <div class="ml-setting-control">
                <div class="ml-setting-inline">
                  <SettingNumber v-model="configDraft.minEmojiSize" unit="KB" label="最小体积（KB）" :min="rules.minEmojiSize.min" :max="rules.minEmojiSize.max" :error="configErrors.minEmojiSize" />
                  <span>到</span>
                  <SettingNumber v-model="configDraft.maxEmojiSize" unit="MB" label="最大体积（MB）" :min="rules.maxEmojiSize.min" :max="rules.maxEmojiSize.max" :error="configErrors.maxEmojiSize" />
                </div>
                <p v-if="configErrors.minEmojiSize || configErrors.maxEmojiSize" class="ml-field-error">
                  {{ configErrors.minEmojiSize ? `最小体积${configErrors.minEmojiSize} KB` : `最大体积${configErrors.maxEmojiSize} MB` }}
                </p>
              </div>
            </div>

            <div class="ml-setting">
              <div class="ml-setting-text">
                <label>每群每日上限</label>
                <p>防止刷屏时暂缓区被塞满，按自然日计数。</p>
              </div>
              <div class="ml-setting-control">
                <SettingNumber v-model="configDraft.groupAutoCollectLimit" unit="张" label="每群每日上限" :min="rules.groupAutoCollectLimit.min" :max="rules.groupAutoCollectLimit.max" :error="configErrors.groupAutoCollectLimit" />
                <p v-if="configErrors.groupAutoCollectLimit" class="ml-field-error">{{ configErrors.groupAutoCollectLimit }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 暂缓区 -->
        <section id="ml-config-staging" class="ml-card ml-config-section">
          <header class="ml-config-head">
            <span class="ml-config-icon"><Icon name="layers" /></span>
            <div class="ml-config-heading">
              <h3>暂缓区</h3>
              <p class="ml-hint">待确认的图片不参与随机发图，归档到表情包后才会生效。</p>
            </div>
          </header>

          <div class="ml-setting">
            <div class="ml-setting-text">
              <label for="ml-cfg-similarity">相似分组阈值</label>
              <p>只影响「按相似分组」的展示，越高越严格，不会自动删除图片。</p>
            </div>
            <div class="ml-setting-control">
              <div class="ml-range">
                <input
                  id="ml-cfg-similarity"
                  v-model.number="configDraft.similarityThreshold"
                  type="range"
                  :min="rules.similarityThreshold.min"
                  :max="rules.similarityThreshold.max"
                  step="0.01"
                  :style="{ '--ml-range-fill': rangeFill }"
                />
                <output for="ml-cfg-similarity">{{ Math.round(configDraft.similarityThreshold * 100) }}%</output>
              </div>
            </div>
          </div>

          <div class="ml-setting">
            <div class="ml-setting-text">
              <label>自动清理</label>
              <p>从图片进入暂缓区开始计算，过期后直接删除。</p>
            </div>
            <div class="ml-setting-control">
              <div class="ml-setting-inline">
                <SwitchToggle :model-value="configDraft.stagingRetentionDays > 0" label="自动清理过期图片" @update:model-value="toggleRetention" />
                <template v-if="configDraft.stagingRetentionDays !== 0">
                  <SettingNumber v-model="configDraft.stagingRetentionDays" unit="天后删除" label="保留天数" :min="1" :max="rules.stagingRetentionDays.max" :error="configErrors.stagingRetentionDays" />
                </template>
                <span v-else class="ml-hint">一直保留</span>
              </div>
              <p v-if="configErrors.stagingRetentionDays" class="ml-field-error">保留天数{{ configErrors.stagingRetentionDays }}</p>
            </div>
          </div>
        </section>

        <!-- AI 标注 -->
        <section id="ml-config-ai" class="ml-card ml-config-section">
          <header class="ml-config-head">
            <span class="ml-config-icon"><Icon name="sparkles" /></span>
            <div class="ml-config-heading">
              <h3>AI 标注</h3>
              <p class="ml-hint">用 ChatLuna 的视觉模型为图片生成标签和别名，用于 <code>?q=</code> 搜索。</p>
            </div>
            <span class="ml-config-status" :class="`is-${annotatorState.tone}`">
              <span class="ml-status-dot" :class="`is-${annotatorState.tone}`"></span>{{ annotatorState.label }}
            </span>
          </header>

          <div v-if="!configData.chatlunaAvailable" class="ml-callout is-warning is-compact">
            <Icon name="alert" />
            <span>没有检测到 ChatLuna，AI 标注不可用。安装并启用 ChatLuna 后刷新本页。</span>
          </div>
          <div v-else-if="annotatorState.tone === 'warning'" class="ml-callout is-warning is-compact">
            <Icon name="alert" />
            <span>模型 <code>{{ configData.settings.model }}</code> 没有加载成功，请检查 ChatLuna 里对应的平台是否正常，或换一个模型。</span>
          </div>

          <div id="ml-cfg-model" class="ml-setting">
            <div class="ml-setting-text">
              <label>标注模型</label>
              <p>需要支持图片输入。标有「识图」的模型声明了这项能力。</p>
            </div>
            <div class="ml-setting-control">
              <el-select
                v-model="configDraft.model"
                class="ml-select is-block"
                filterable
                :disabled="!configData.chatlunaAvailable"
                placeholder="不启用 AI 标注"
                no-match-text="没有匹配的模型"
              >
                <el-option label="不启用 AI 标注" value="" />
                <el-option v-for="model in modelOptions" :key="model.name" :label="model.name" :value="model.name">
                  <span class="ml-model-option">
                    <span class="ml-truncate">{{ model.name }}</span>
                    <span v-if="model.missing" class="ml-badge is-warning">未加载</span>
                    <span v-else-if="model.vision" class="ml-badge is-accent">识图</span>
                  </span>
                </el-option>
              </el-select>
            </div>
          </div>

          <div class="ml-config-body" :class="{ 'is-off': !configDraft.model }">
            <div class="ml-setting is-switch">
              <div class="ml-setting-text">
                <label>自动标注</label>
                <p>上传、偷图和从暂缓区归档后自动排队标注。关闭后仍可在图片的编辑弹窗里手动识别，或使用 <code>memesluna.tagall</code>。</p>
              </div>
              <div class="ml-setting-control">
                <SwitchToggle v-model="configDraft.autoAnnotate" label="自动标注新图片" />
              </div>
            </div>

            <div class="ml-setting">
              <div class="ml-setting-text">
                <label>每日请求上限</label>
                <p>失败和重试也计入，按 UTC 日期重置。填 0 不限制。</p>
              </div>
              <div class="ml-setting-control">
                <SettingNumber v-model="configDraft.aiDailyLimit" unit="次" label="每日请求上限" :min="0" :max="rules.aiDailyLimit.max" :error="configErrors.aiDailyLimit" wide />
                <p v-if="configErrors.aiDailyLimit" class="ml-field-error">{{ configErrors.aiDailyLimit }}</p>
              </div>
            </div>

            <div class="ml-setting is-block">
              <div class="ml-setting-text">
                <label for="ml-cfg-annotate-prompt">标注提示词</label>
                <p>作为 System 提示词发送，模型需要返回 <code>{"aliases": [...], "tags": [...]}</code> 格式的 JSON。</p>
              </div>
              <div class="ml-setting-control">
                <div class="ml-prompt-tools">
                  <div class="ml-token-list">
                    <button v-for="token in annotateTokens" :key="token.value" type="button" class="ml-token" :title="token.description" @click="insertToken('annotatePrompt', token.value)">{{ token.value }}</button>
                  </div>
                  <button type="button" class="ml-btn is-small is-ghost" :disabled="configDraft.annotatePrompt === defaults.annotatePrompt" @click="restoreConfigDefault('annotatePrompt')"><Icon name="undo" />恢复默认</button>
                </div>
                <textarea
                  id="ml-cfg-annotate-prompt"
                  ref="annotatePrompt"
                  v-model="configDraft.annotatePrompt"
                  class="ml-textarea"
                  :class="{ 'is-invalid': configErrors.annotatePrompt }"
                  rows="12"
                  spellcheck="false"
                ></textarea>
                <p v-if="configErrors.annotatePrompt" class="ml-field-error">{{ configErrors.annotatePrompt }}</p>
              </div>
            </div>

            <details class="ml-config-advanced" :open="advancedOpen" @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open">
              <summary>
                <Icon name="chevron" />
                <span>请求控制</span>
                <span class="ml-hint">遇到限流或超时再调整</span>
                <span v-if="sectionChanged(advancedKeys)" class="ml-config-dot" title="有未保存的修改"></span>
              </summary>
              <div class="ml-config-grid">
                <div v-for="field in advancedFields" :key="field.key" class="ml-config-cell">
                  <label>{{ field.label }}</label>
                  <SettingNumber v-model="configDraft[field.key]" :unit="field.unit" :label="field.label" :min="rules[field.key].min" :max="rules[field.key].max" :error="configErrors[field.key]" wide />
                  <p v-if="configErrors[field.key]" class="ml-field-error">{{ configErrors[field.key] }}</p>
                  <p v-else class="ml-hint">{{ field.hint }}</p>
                </div>
              </div>
            </details>
          </div>
        </section>

        <Transition name="ml-bar">
          <div v-if="configDirty" class="ml-config-savebar" role="status">
            <span class="ml-config-savebar-text">
              <span class="ml-config-dot"></span>
              有 {{ configChangedKeys.length }} 项修改未保存
            </span>
            <div class="ml-actions">
              <button type="button" class="ml-btn" :disabled="configSaving" @click="resetConfigDraft">撤销</button>
              <button type="button" class="ml-btn is-primary" :disabled="!configValid || configSaving" :title="configValid ? 'Ctrl/⌘ + S' : '有设置项填写不正确'" @click="saveConfig">
                <span v-if="configSaving" class="ml-spinner is-small is-inverse"></span>
                保存
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </section>
</template>
<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import Icon from '../../shared/Icon.vue'
import LoadingSpinner from '../../shared/LoadingSpinner.vue'
import SwitchToggle from '../../shared/SwitchToggle.vue'
import SettingNumber from './SettingNumber.vue'
import { useDashboardContext } from '../../../composables/dashboardContext'
import { DEFAULT_SETTINGS, MAX_RETRY_DELAY, NUMBER_RULES, type NumericSettingKey, type Settings } from '../../../../src/settings'

const sections = [
  { id: 'ml-config-access', label: '访问地址', icon: 'globe', keys: ['selfUrl', 'backendPath'] },
  { id: 'ml-config-chatluna', label: 'ChatLuna 注入', icon: 'message', keys: ['injectVariables', 'injectVariablesPrompt'] },
  { id: 'ml-config-collect', label: '自动收集', icon: 'inbox', keys: ['autoCollect', 'emojiFrequencyWindowMinutes', 'emojiFrequencyThreshold', 'minEmojiSize', 'maxEmojiSize', 'groupAutoCollectLimit'] },
  { id: 'ml-config-staging', label: '暂缓区', icon: 'layers', keys: ['similarityThreshold', 'stagingRetentionDays'] },
  { id: 'ml-config-ai', label: 'AI 标注', icon: 'sparkles', keys: ['model', 'autoAnnotate', 'aiDailyLimit', 'annotatePrompt', 'aiConcurrency', 'aiMaxAttempts', 'aiRetryDelay', 'aiRequestTimeout'] },
] as const

const advancedFields: { key: NumericSettingKey; label: string; unit: string; hint: string }[] = [
  { key: 'aiConcurrency', label: '并发请求数', unit: '个', hint: '同时发给模型的请求数' },
  { key: 'aiMaxAttempts', label: '最多尝试次数', unit: '次', hint: '含首次请求，超时、报错或格式不对时重试' },
  { key: 'aiRetryDelay', label: '重试等待', unit: '秒', hint: `第一次重试前等待，之后每次翻倍，最多 ${MAX_RETRY_DELAY} 秒` },
  { key: 'aiRequestTimeout', label: '请求超时', unit: '秒', hint: '超时的请求会被取消' },
]
const advancedKeys = advancedFields.map((field) => field.key)

const injectTokens = [
  { value: '{endpoint}', description: '可用的随机图清单，每项带完整地址' },
  { value: '{base_url}', description: '对外地址' },
  { value: '{backend_path}', description: '路由前缀' },
]
const annotateTokens = [
  { value: '{{filename}}', description: '图片文件名' },
  { value: '{{collection_name}}', description: '所在表情包' },
]

export default defineComponent({
  name: 'ConfigView',
  components: { Icon, LoadingSpinner, SwitchToggle, SettingNumber },
  setup() {
    const ctx = useDashboardContext()
    const { configData, configDraft, configChangedKeys, configDirty, configTarget, saveConfig } = ctx
    const activeSection = ref<string>(sections[0].id)
    const injectVariablesPrompt = ref<HTMLTextAreaElement | null>(null)
    const annotatePrompt = ref<HTMLTextAreaElement | null>(null)
    const advancedOpen = ref(false)

    const examplePrefix = computed(() => {
      const base = configDraft.value?.selfUrl || configData.value?.serverSelfUrl || ''
      const raw = (configDraft.value?.backendPath || '').replace(/\/+$/, '')
      return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`
    })

    const rangeFill = computed(() => {
      const { min, max } = NUMBER_RULES.similarityThreshold
      const value = configDraft.value?.similarityThreshold ?? min
      return `${((value - min) / (max - min)) * 100}%`
    })

    const modelOptions = computed(() => {
      const models = (configData.value?.models || []).map((model) => ({ ...model, missing: false }))
      const current = configDraft.value?.model
      if (current && !models.some((model) => model.name === current)) models.unshift({ name: current, vision: false, missing: true })
      return models
    })

    const annotatorState = computed(() => {
      const data = configData.value
      if (!data?.chatlunaAvailable) return { tone: 'muted', label: '不可用' }
      if (!data.settings.model) return { tone: 'muted', label: '未启用' }
      if (data.annotatorReady) return { tone: 'success', label: '运行中' }
      return { tone: 'warning', label: '模型未加载' }
    })

    function sectionChanged(keys: readonly string[]) {
      return configChangedKeys.value.some((key) => keys.includes(key))
    }

    function scrollToSection(id: string) {
      activeSection.value = id
      const el = document.getElementById(id)
      // 第一个分区直接回到页面顶部，连同标题一起露出来。
      if (id === sections[0].id) el?.closest('.el-scrollbar__wrap')?.scrollTo({ top: 0, behavior: 'smooth' })
      else el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    function toggleRetention(on: boolean) {
      if (!configDraft.value) return
      const saved = configData.value?.settings.stagingRetentionDays || 0
      configDraft.value.stagingRetentionDays = on ? (saved > 0 ? saved : 30) : 0
    }

    const textareas = { injectVariablesPrompt, annotatePrompt }
    function insertToken(key: 'injectVariablesPrompt' | 'annotatePrompt', token: string) {
      const draft = configDraft.value
      const el = textareas[key].value
      if (!draft) return
      const text = draft[key]
      const start = el ? el.selectionStart : text.length
      const end = el ? el.selectionEnd : text.length
      draft[key] = text.slice(0, start) + token + text.slice(end)
      void nextTick(() => {
        if (!el) return
        el.focus()
        el.setSelectionRange(start + token.length, start + token.length)
      })
    }

    // 请求控制里有改动时（比如撤销后重新打开）保持展开，免得改动藏起来。
    watch(configChangedKeys, (keys) => {
      if (keys.some((key) => (advancedKeys as string[]).includes(key))) advancedOpen.value = true
    })

    function onKeydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (configDirty.value) void saveConfig()
      }
    }

    let observer: IntersectionObserver | undefined
    function observeSections() {
      observer?.disconnect()
      observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) activeSection.value = visible[0].target.id
      }, { rootMargin: '-15% 0px -60% 0px' })
      for (const section of sections) {
        const el = document.getElementById(section.id)
        if (el) observer.observe(el)
      }
    }
    watch(() => !!configDraft.value, (ready) => { if (ready) void nextTick(observeSections) }, { immediate: true })

    // 从其他页面的「配置」链接跳过来：滚到对应位置并闪一下。分区高亮标题行，设置项高亮整行。
    watch([() => !!configDraft.value, configTarget], ([ready, target]) => {
      if (!ready || !target) return
      configTarget.value = null
      void nextTick(() => {
        const el = document.getElementById(target)
        if (!el) return
        const highlight = el.classList.contains('ml-config-section') ? el.querySelector<HTMLElement>('.ml-config-head') : el
        el.scrollIntoView({ behavior: 'smooth', block: highlight === el ? 'center' : 'start' })
        highlight?.classList.remove('is-highlight')
        void highlight?.offsetWidth
        highlight?.classList.add('is-highlight')
        setTimeout(() => highlight?.classList.remove('is-highlight'), 2000)
      })
    }, { immediate: true })

    // 刷新或关闭浏览器标签页前提醒未保存的修改。
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!configDirty.value) return
      event.preventDefault()
      event.returnValue = ''
    }

    onMounted(() => {
      window.addEventListener('keydown', onKeydown)
      window.addEventListener('beforeunload', onBeforeUnload)
    })
    onUnmounted(() => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('beforeunload', onBeforeUnload)
      observer?.disconnect()
    })

    return {
      ...ctx,
      sections, advancedFields, advancedKeys, injectTokens, annotateTokens,
      rules: NUMBER_RULES, defaults: DEFAULT_SETTINGS as Settings,
      activeSection, advancedOpen, examplePrefix, rangeFill, modelOptions, annotatorState,
      injectVariablesPrompt, annotatePrompt,
      sectionChanged, scrollToSection, toggleRetention, insertToken,
    }
  },
})
</script>
