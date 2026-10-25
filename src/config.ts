import { Schema } from 'koishi'

export const DEFAULT_ANNOTATE_PROMPT = `你是"二次元表情检索标注助手"。请为表情图/反应图生成高命中检索标注。
只输出 JSON 对象，不要输出任何解释，不要代码块。

上下文：
- 文件名: {{filename}}
- 所在合集: {{collection_name}}
- 图片直链: {{image_url}}

字段要求：

tags: 字符串数组（自由语义标签）
- 1~5 项，每项 1~8 字
- 用于概括图片的核心情绪、动作、场景或梗点
- 不需要从固定候选中选择，不要堆砌近义词

aliases: 字符串数组（辅助检索）
- 至少 6 项检索短语，每项 2~10 字
- 用于 /memesluna?q=关键词 或 合集路由 ?q=关键词 的直接关键字搜索
- 包含口语说法、情绪短语、动作短语

约束：
- 以图像事实为准，不要把"幸福"标给明显"无奈/委屈"的图
- 只返回合法 JSON，格式：{"aliases": [...], "tags": [...]}`

export interface Config {
  backendPath: string
  selfUrl: string
  injectVariables: boolean
  variableRefreshIntervalMs: number
  injectVariablesPrompt: string
  autoCollect: boolean
  emojiFrequencyWindowMinutes: number
  emojiFrequencyThreshold: number
  minEmojiSize: number
  maxEmojiSize: number
  groupAutoCollectLimit: number
  similarityThreshold: number
  stagingRetentionDays: number
  model: string
  annotatePrompt: string
  aiConcurrency: number
  aiBatchDelay: number
  aiMaxAttempts: number
  aiBackoffBase: number
  aiDailyLimit: number
  aiWarnThreshold: number
  aiRequestTimeoutMs: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    backendPath: Schema.string()
      .default('/memesluna')
      .description('插件 HTTP 路由的前缀路径，默认 /memesluna，修改后需重启'),
    selfUrl: Schema.string()
      .default('')
      .description('插件对外暴露的完整地址（含协议和端口），留空则自动使用 Koishi server.selfUrl'),
    injectVariables: Schema.boolean()
      .default(true)
      .description('开启后向 ChatLuna 注入 {{endpoint}} 路由列表和 {{memesluna}} 使用说明，让 AI 能发图'),
    variableRefreshIntervalMs: Schema.number()
      .min(30 * 1000)
      .max(60 * 60 * 1000)
      .default(5 * 60 * 1000)
      .description('ChatLuna 变量自动刷新间隔（毫秒），新增合集或路由后最多等待这么久才生效'),
    injectVariablesPrompt: Schema.string()
      .role('textarea')
      .default(`你可以根据需要选择合适的表情包合集或端点发送图片。

可用的路由如下：

{endpoint}

使用规则：
- 合集和端点都可以直接访问：{base_url}{backend_path}/合集名 或 {base_url}{backend_path}/端点名
- 只使用上面列出的合集名或端点名，不要自己编造路径
- 合集路由会在指定合集内随机返回图片，端点路由会转发到外部图源
- 需要按语义找图时，再使用搜索参数：
  - 跨合集搜索：{base_url}{backend_path}?q=关键词
  - 合集搜索：{base_url}{backend_path}/合集名?q=关键词`)
      .description('注入 ChatLuna 的提示词模板，支持占位符：{endpoint}（合集/端点路由）、{base_url}（服务地址）、{backend_path}（插件路由前缀）；兼容旧占位符 {tag_routes}、{tags}，当前会渲染为空'),
  }).description('基础配置'),

  Schema.object({
    autoCollect: Schema.boolean()
      .default(false)
      .description('开启后自动监听群聊消息，高频出现的图片会自动进入暂缓区等待审核'),
    emojiFrequencyWindowMinutes: Schema.number()
      .min(1)
      .max(1440)
      .default(10)
      .description('高频统计的时间窗口（分钟），窗口内同一张图出现次数超过阈值才触发暂存'),
    emojiFrequencyThreshold: Schema.number()
      .min(1)
      .max(50)
      .default(3)
      .description('同一张图在统计窗口内出现几次后放入暂缓区'),
    minEmojiSize: Schema.number()
      .min(0)
      .max(1024)
      .default(4)
      .description('自动暂存的图片最小体积（KB），低于此大小的图片会被忽略。QQ 表情多在 5~40 KB，设得太高会漏掉大部分表情'),
    maxEmojiSize: Schema.number()
      .min(1)
      .max(100)
      .default(15)
      .description('自动暂存的图片最大体积（MB），超过此大小的图片会被忽略'),
    groupAutoCollectLimit: Schema.number()
      .min(1)
      .max(5000)
      .default(300)
      .description('每个群每天最多触发自动暂存的图片数量上限，防止刷屏导致暂缓区过大'),
  }).description('自动暂存配置'),

  Schema.object({
    similarityThreshold: Schema.number()
      .min(0.5)
      .max(1)
      .step(0.01)
      .role('slider')
      .default(0.9)
      .description('暂缓区相似图片聚合阈值（0~1），越高越严格，仅用于管理界面分组展示，不会自动删除'),
    stagingRetentionDays: Schema.number()
      .min(0)
      .max(365)
      .default(0)
      .description('暂缓区图片自动过期天数，0 表示永久保留不自动清理'),
  }).description('暂缓区配置'),

  Schema.object({
    model: Schema.dynamic('model')
      .description('AI 标注使用的模型，配置后上传、偷图和暂缓区归档会自动触发标注'),
    annotatePrompt: Schema.string()
      .role('textarea')
      .default(DEFAULT_ANNOTATE_PROMPT)
      .description('AI 标注的 System 提示词，要求模型输出 { aliases: string[], tags: string[] } 格式 JSON'),
    aiConcurrency: Schema.number()
      .min(1).max(10).default(2)
      .description('AI 标注的并发请求数，越大速度越快但对模型负载更高'),
    aiBatchDelay: Schema.number()
      .min(0).max(5000).default(500)
      .description('批量标注时每张图之间的等待时间（毫秒），用于避免触发模型限流'),
    aiMaxAttempts: Schema.number()
      .min(1).max(10).default(3)
      .description('AI 标注失败后的最大重试次数'),
    aiBackoffBase: Schema.number()
      .min(100).max(10000).default(1000)
      .description('重试退避基数（毫秒），使用指数退避'),
    aiDailyLimit: Schema.number()
      .min(0).max(10000).default(1000)
      .description('每日 AI 请求次数上限，包含失败和重试，计数持久化；按 UTC 日期重置，0 表示不限制'),
    aiRequestTimeoutMs: Schema.number()
      .min(1000).max(300000).default(60000)
      .description('单次 AI 请求超时（毫秒），超时后取消请求'),
    aiWarnThreshold: Schema.number()
      .min(0).max(1).step(0.1).default(0.8)
      .description('AI 标注用量警告阈值（0-1），达到此比例时发出警告'),
  }).description('AI 标注配置'),
]) as Schema<Config>

export const name = 'memesluna'
