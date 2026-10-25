# koishi-plugin-memesluna

[![npm](https://img.shields.io/npm/v/koishi-plugin-memesluna?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-memesluna)
[![License](https://img.shields.io/github/license/lumia1998/koishi-plugin-memesluna?style=flat-square)](https://github.com/lumia1998/koishi-plugin-memesluna/blob/main/LICENSE)

MemesLuna 是一个用于 Koishi 的表情图片路由与管理插件。它可以把本地表情包、外部随机图片 API（外部图源）和 ChatLuna 提示词变量连接起来，让机器人按固定路由发送表情图，并支持 AI 自动语义标注。

## 功能特性

### 核心功能

- 📦 **表情包合集管理**：支持本地图片、外链图片、描述、移动、删除和批量上传
- 🌐 **外部图源**：将自定义路由 302 跳转到外部随机图片 API
- 🎨 **Console 管理页**：在 Koishi 控制台中可视化管理所有资源
- 🤖 **ChatLuna 变量注入**：注入 `{endpoint}` 和 `{memesluna}`，让 AI 知道可用图片路由
- 🔍 **跨合集语义搜索**：支持 `/memesluna?q=关键词` 按别名、标签或文件名检索
- 🏷️ **AI 自动标注**：使用 ChatLuna 模型自动生成 `tags` 和 `aliases`
- 🕓 **暂缓区**：暂存被过滤或自动收集的候选图片，人工复核后归档
- 📊 **高频图片自动收集**：监听群聊中高频出现的图片并放入暂缓区

### 安全特性

- 🔒 **SSRF 防护**：防止访问私有 IP 地址
- 📝 **文件名安全化**：自动处理危险字符和 Windows 保留名
- 🚫 **格式验证**：基于魔数检测文件真实类型，防止扩展名欺骗
- 💾 **数据库索引优化**：高效查询性能

## 安装

```bash
npm i koishi-plugin-memesluna
```

**依赖**：
- `@koishijs/plugin-server`：HTTP 服务器（必需）
- `@koishijs/plugin-console`：管理界面（可选但推荐）
- `koishi-plugin-chatluna`：AI 集成（必需）
- `database`：数据持久化（必需）

## 快速开始

### 1. 基础配置

```yaml
plugins:
  memesluna:
    # HTTP 路由前缀
    backendPath: /memesluna

    # 对外访问地址（留空自动使用 server.selfUrl）
    selfUrl: https://your-bot.example.com

    # 启用 ChatLuna 变量注入
    injectVariables: true
```

### 2. 创建表情包合集

在 Koishi Console 的 MemesLuna 页面创建合集。

### 3. 上传表情图片

- **方式一**：Console 上传（支持拖拽和批量）
- **方式二**：命令行偷图
  ```bash
  # 引用包含图片的消息后
  memesluna.stole doro
  ```

### 4. 使用路由

合集创建后，自动生成路由：
```
/memesluna/doro  # 随机返回一张图片
```

ChatLuna 会自动获知这个路由并在需要时发送表情。

## 详细配置

### 基础配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `backendPath` | string | `/memesluna` | HTTP 路由前缀 |
| `selfUrl` | string | `''` | 对外公开地址，留空使用 `server.selfUrl` |
| `injectVariables` | boolean | `true` | 向 ChatLuna 注入变量 |
| `variableRefreshIntervalMs` | number | `300000` | 变量刷新间隔（毫秒） |
| `injectVariablesPrompt` | string | 见下文 | 注入到 `{memesluna}` 的提示词模板 |

#### 提示词模板示例

```yaml
injectVariablesPrompt: |
  你可以根据需要选择合适的表情包合集或端点发送图片。

  可用的路由如下：
  {endpoint}

  使用规则：
  - 合集和端点都可以直接访问：{base_url}{backend_path}/合集名 或 {base_url}{backend_path}/端点名
  - 只使用上面列出的合集名或端点名，不要自己编造路径
  - 合集路由会在指定合集内随机返回图片，端点路由会转发到外部图源
  - 需要按语义找图时，再使用搜索参数：
    - 跨合集搜索：{base_url}{backend_path}?q=关键词
    - 合集搜索：{base_url}{backend_path}/合集名?q=关键词
```

**可用占位符**：
- `{endpoint}`：合集和端点路由清单
- `{base_url}`：服务公开地址
- `{backend_path}`：插件路由前缀

### 自动收集配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `autoCollect` | boolean | `false` | 启用高频图片自动暂存 |
| `emojiFrequencyWindowMinutes` | number | `10` | 统计时间窗口（分钟） |
| `emojiFrequencyThreshold` | number | `3` | 触发暂存所需出现次数 |
| `minEmojiSize` | number | `4` | 最小图片大小（KB），QQ 表情多在 5~40 KB |
| `maxEmojiSize` | number | `15` | 最大图片大小（MB） |
| `groupAutoCollectLimit` | number | `300` | 每群每日暂存上限 |

**示例**：
```yaml
plugins:
  memesluna:
    autoCollect: true
    emojiFrequencyThreshold: 5  # 5次才收集
```

### 暂缓区配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `similarityThreshold` | number | `0.9` | 相似图片聚合阈值（0-1） |
| `stagingRetentionDays` | number | `0` | 自动过期天数（0=永久） |

### AI 标注配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `model` | string | `''` | ChatLuna 模型名称；配置后自动标注新入库图片 |
| `annotatePrompt` | string | 见下文 | AI 标注提示词 |
| `aiConcurrency` | number | `2` | 并发请求数 |
| `aiBatchDelay` | number | `500` | 批量标注间隔（毫秒） |
| `aiMaxAttempts` | number | `3` | 失败重试次数 |
| `aiBackoffBase` | number | `1000` | 重试退避基数（毫秒） |
| `aiDailyLimit` | number | `1000` | 每日标注次数上限（0=不限） |
| `aiWarnThreshold` | number | `0.8` | 用量警告阈值（0-1） |

**成本控制示例**：
```yaml
plugins:
  memesluna:
    model: gpt-4o-mini  # 使用便宜的模型
    aiDailyLimit: 500   # 每天最多标注 500 张
    aiWarnThreshold: 0.8  # 达到 80% 时警告
```

## 使用指南

### Console 管理

启用插件后，访问 Koishi Console 的 **MemesLuna** 页面：

1. **表情包管理**
   - 新建/删除合集
   - 上传本地图片（支持拖拽）
   - 导入外链图片
   - 编辑图片标签和别名
   - 批量标注（AI）

2. **外部图源**
   - 添加、编辑、删除外部随机图片 API
   - 保存前可以「试一下」，在浏览器里预览一张

3. **暂缓区**
   - 查看自动收集或上传时被拦下的图片
   - 每张图片可直接归档到表情包或删除，也支持多选批量处理
   - 相似图片自动标记，可按组查看、只保留一张

4. **预览**
   - 查看当前路由清单
   - 预览注入给 ChatLuna 的提示词

### 命令行操作

#### 查看可用路由

```bash
memesluna.list
```

输出示例：
```
doro Doro 表情包
ycy 杨超越端点
```

#### 偷图

引用包含图片的消息后：
```bash
memesluna.stole <合集名>

# 示例
memesluna.stole doro
```

- 自动检测图片格式（JPG/PNG/GIF/WEBP/BMP）
- 自动去重（基于 SHA256 哈希）
- 支持批量偷图
- 目标合集需要先在 Console 中创建
- 配置 `model` 后会自动标注

#### 批量标注

```bash
# 标注所有未标注的图片
memesluna.tagall

# 强制重新标注所有图片
memesluna.tagall -f
```

#### 清空标签

```bash
# 清空所有图片标签
memesluna.untagall

# 只清空指定合集
memesluna.untagall -c doro
```

### 路由说明

#### 合集路由

```
/memesluna/{合集名}
```

随机返回合集中的一张图片（本地或外链）。

**示例**：
```
/memesluna/doro  # 随机返回 doro 合集中的图片
```

#### 端点路由

```
/memesluna/{端点名}
```

302 重定向到配置的外部 URL。

**示例**：
```
# 创建端点：ycy -> https://t.alcy.cc/ycy
/memesluna/ycy  # 重定向到 https://t.alcy.cc/ycy
```

#### 跨合集搜索

```
/memesluna?q={关键词}
```

跨所有合集搜索并返回最匹配的图片。

**评分规则**：
- 完整短语命中 `aliases`：+12
- 完整短语命中 `tags`：+8
- 完整短语命中文件名：+4
- 分词命中 `aliases`：+6
- 分词命中 `tags`：+6
- 分词命中文件名：+2
- 命中词数 ≥2：+2
- 命中词数 ≥3：再+2

**示例**：
```
/memesluna?q=开心  # 搜索所有包含"开心"的图片
/memesluna?q=哭泣  # 搜索所有包含"哭泣"的图片
```

#### 合集内搜索

```
/memesluna/{合集名}?q={关键词}
```

在指定合集内搜索。如无匹配，退回随机返图。

**示例**：
```
/memesluna/doro?q=无奈  # 在 doro 合集中搜索"无奈"
```

#### 直接访问

```
/memesluna/{合集名}/{文件名}
```

直接访问指定的本地图片。

## 语义标注指南

### 什么是标签和别名？

- **tags（标签）**：图片的核心语义（情绪、动作、场景），1-5个
  - 示例：`["无奈", "摊手", "苦笑"]`

- **aliases（别名）**：自然语言检索短语，至少6个
  - 示例：`["没办法", "我也很无奈", "这能怎么办", "摊手表示无奈"]`

### 手动标注

在 Console 的合集详情中：
1. 点击图片卡片的菜单
2. 选择"编辑标签"
3. 输入标签和别名

支持批量编辑：选中多张图片后，点击"批量设置标签"。

### AI 标注

**单张标注**（Console）：
1. 在图片卡片菜单中选择"AI 标注"
2. 等待标注完成
3. 可手动调整结果

**批量标注**（命令行）：
```bash
# 标注所有未标注的图片
memesluna.tagall

# 重新标注所有图片（覆盖现有标签）
memesluna.tagall -f
```

**自动标注**（配置）：
```yaml
plugins:
  memesluna:
    model: gpt-4o-mini
```

配置模型后，每次上传、偷图或暂缓区归档都会自动标注。

### 标注最佳实践

1. **标签要精准**：基于图片实际内容，不要猜测
2. **别名要口语化**：按用户可能搜索的方式写
3. **避免重复**：同义词选一个最常用的
4. **考虑场景**：想想这张图在什么情况下会被用到

**好的示例**：
```json
{
  "tags": ["无奈", "摊手"],
  "aliases": ["没办法", "我也很无奈", "这能怎么办", "无能为力", "只能这样了", "我也不想啊"]
}
```

**不好的示例**：
```json
{
  "tags": ["无奈", "无助", "无力", "没办法", "摊手"],
  "aliases": ["无奈", "摊手"]
}
```

## 故障排查

### ChatLuna 看不到路由

**检查清单**：
1. 确认 `injectVariables` 为 `true`
2. 等待变量刷新（默认 5 分钟）
3. 重启 Koishi 强制刷新
4. 查看日志是否有错误

### AI 标注不工作

**检查清单**：
1. 确认 `model` 已配置且在 ChatLuna 中可用
2. 检查是否达到 `aiDailyLimit`
3. 查看日志中的错误信息

### 搜索匹配不准

**优化建议**：
1. 丰富 `aliases`（至少 6 个）
2. 使用口语化短语
3. 包含多种说法（"开心"、"高兴"、"快乐"）
4. 重新标注效果不佳的图片

### 上传失败

**常见原因**：
- 文件过大（检查 `maxEmojiSize` 配置）
- 格式不支持（仅支持 JPG/PNG/GIF/WEBP/BMP）
- 磁盘空间不足
- 文件名包含特殊字符（会自动清理）

## 性能优化

### 数据库优化

插件已自动添加索引：
- `hash`：去重查询
- `collection`：合集查询
- `perceptual_hash`：相似图片查询

对于大型部署（10000+ 图片），建议：
1. 使用 PostgreSQL 或 MySQL（而非 SQLite）
2. 定期清理暂缓区过期图片
3. 限制单个合集大小（建议 < 1000 张）

### 缓存策略

- 全表查询缓存：5 分钟 TTL
- 手动失效：任何写操作后自动清理

### AI 标注优化

- 图片自动压缩（> 30KB）
- 目标尺寸：512px
- JPEG 质量：75
- 并发控制：默认 2

## 安全性

### SSRF 防护

自动拦截私有 IP 地址：
- `127.0.0.0/8`（回环）
- `10.0.0.0/8`（私有）
- `172.16.0.0/12`（私有）
- `192.168.0.0/16`（私有）
- `169.254.0.0/16`（链路本地）
- `localhost` 和 IPv6 私有地址

### 文件名安全

自动处理：
- 危险字符替换为下划线
- Windows 保留名（CON、PRN 等）
- 长度限制（200 字节）
- 前导/尾随特殊字符

### 格式验证

基于魔数检测真实文件类型，防止扩展名欺骗。

## 开发

### 环境要求

- Node.js >= 18.0.0
- TypeScript >= 5.0.0
- Koishi >= 4.18.9

### 构建

```bash
npm install
npm run typecheck
npx yakumo build
```

### 测试

```bash
npm test
npm run test:coverage
```

### 发布结构

```
lib/          # TypeScript 编译输出
dist/         # 前端构建产物
package.json
```

## 许可证

[MIT](LICENSE)

## 致谢

- [Koishi](https://koishi.chat/)：强大的聊天机器人框架
- [ChatLuna](https://github.com/ChatLunaLab/chatluna)：多平台 LLM 集成
- [@cf-wasm/photon](https://github.com/silvia-odwyer/photon)：图片处理
