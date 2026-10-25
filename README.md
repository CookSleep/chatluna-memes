# koishi-plugin-memesluna

MemesLuna 是 Koishi 的表情图片路由与管理插件。它把本地表情合集、外部随机图片 API（外部图源）与 ChatLuna 提示词变量连在一起，让机器人按固定 HTTP 路由发图。

[![npm](https://img.shields.io/npm/v/koishi-plugin-memesluna.svg)](https://www.npmjs.com/package/koishi-plugin-memesluna)
[![license](https://img.shields.io/npm/l/koishi-plugin-memesluna.svg)](./LICENSE)

## 功能概览

- **表情包合集**：本地图 / 外链、描述、移动、删除、批量上传
- **外部图源**：把外部随机图片 API 挂到自定义路由下，访问时 302 跳转
- **Console 管理页**：合集、图片、外部图源、暂缓区、语义标签与检索别名，适配深色模式和移动端
- **ChatLuna 注入**：`{endpoint}` 路由清单 + `{memesluna}` 使用说明
- **关键词搜索**：`/memesluna?q=关键词`（aliases / tags / 文件名打分，非向量检索）
- **AI 标注**：用 ChatLuna 视觉模型生成 `tags` 与 `aliases`
- **暂缓区**：过滤或自动收集的候选图，人工复核后归档
- **高频自动收集**：群聊高频图片进入暂缓区（可配窗口、阈值、大小与每日上限）

## 安装

```bash
npm i koishi-plugin-memesluna
```

依赖服务：`database`（必需）；`server` 提供 HTTP 路由，`chatluna` 提供变量注入与 AI 标注。Console 页面需要 `@koishijs/plugin-console`。

聊天命令 `memesluna.stole`、`memesluna.tagall`、`memesluna.untagall` 需要权限等级 5。

管理操作还需要启用 Koishi `auth` 插件，并登录权限等级至少为 1 的 Console 账号。没有有效登录凭据时，管理 HTTP 接口和 Console RPC 会拒绝请求；公开图片、合集搜索与外部图源跳转仍可匿名访问。

自定义客户端调用 `/memesluna/api/admin/*` 时，使用 Console 登录得到的凭据发送 `Authorization: Bearer <token>`。不要把凭据放在 URL 中。内置 Console 已自动处理上传和暂缓区图片预览的鉴权。

## 配置

所有设置都在 Console 的 MemesLuna 页面第一个标签「配置」里修改，保存后立即生效，不需要重启 Koishi。Koishi 插件配置页不再显示配置项。

| 分区 | 内容 |
|------|------|
| 访问地址 | 对外地址（留空则用 `server.selfUrl`）、路由前缀（默认 `/memesluna`） |
| ChatLuna 注入 | 是否注入变量、`{memesluna}` 提示词模板 |
| 自动收集 | 开关、统计窗口与出现次数、图片体积范围、每群每日上限 |
| 暂缓区 | 相似分组阈值、自动清理天数 |
| AI 标注 | 标注模型、是否自动标注新图片、每日请求上限、标注提示词，以及并发、请求间隔、尝试次数、超时 |

设置保存在 `data/memesluna/.settings.json`。从旧版本升级时，首次启动会把 `koishi.yml` 里原有的配置迁移过来，之后只读这个文件。以下旧配置项已移除：`variableRefreshIntervalMs`（路由或设置变化时会立即刷新 ChatLuna 变量）、`aiBatchDelay`（限流时降低并发即可）、`aiWarnThreshold`（用量达到 80% 时在日志提醒一次）。`aiRequestTimeoutMs` 改为以秒为单位；`aiBackoffBase` 改为「重试等待」，以秒为单位，每次重试翻倍，最多等 30 秒。

本地合集固定在 Koishi 数据目录 `data/memesluna`。合集名与外部图源名共用路由命名空间，不能重名。

## Console 用法

启用插件后，控制台会出现 **MemesLuna** 页面：

1. 在「配置」调整访问地址、ChatLuna 注入、自动收集和 AI 标注  
2. 在「表情包」新建合集，上传本地图片或导入外链  
3. 在「外部图源」添加随机图片 API，可以先点「试一下」确认能取到图  
4. 在「暂缓区」处理自动收集或被拦下的图片：直接归档到表情包，或者删除；相似图片会自动标出并可按组处理  
5. 在「预览」查看注入给 ChatLuna 的路由、提示词和 AI 标注状态  

管理页里的缩略图由浏览器直接加载。外链或外部图源显示「无法预览」时，常见原因是防盗链、跨域限制、HTTPS 页面里的 HTTP 图片，或者只有服务器能访问的内网地址（例如 Docker 容器名）。这不代表机器人发图一定失败。

图片可维护：

- `tags`：语义标签（情绪、动作、场景等）
- `aliases`：自然语言检索别名（用于 `?q=`）

合集详情按页加载，每页同时返回图片和标注。批量追加标注由服务端合并已有数据，部分失败时会显示成功/失败数量，并保留失败项供重试。

重复上传同一合集中已有的图片会复用原记录、文件名和标注。移动图片保留原文件名，发生重名时添加数字后缀；文件操作或数据库操作失败时会撤销未完成的操作。

单张图片最大 50MB。HTTP 单次上传最多 32 个文件、总计不超过 100MB；内置 Console 将选择的文件逐张上传，单次选择最多 500 张。解析失败及上传失败都会清理该请求的临时文件。

## 路由说明

默认前缀 `/memesluna`：

| 路径 | 作用 |
|------|------|
| `/memesluna/` | 跳转 Console |
| `/memesluna/:name` | 合集随机图，或外部图源 302 |
| `/memesluna?q=关键词` | 跨合集关键词搜索 |
| `/memesluna/合集名?q=关键词` | 合集内搜索（无匹配时退回随机） |
| `/memesluna/:collection/:filename` | 本地图直链 |

### 搜索评分（摘要）

- 短语命中 aliases / tags / 文件名：`+12` / `+8` / `+4`
- 分词命中 aliases / tags / 文件名：`+6` / `+6` / `+2`
- 多词命中额外加分；总分 ≥ `6` 才进入候选

## ChatLuna

在「配置」开启 ChatLuna 注入后提供：

- `{endpoint}`：可用合集与外部图源清单  
- `{memesluna}`：由提示词模板渲染的使用说明  

模板占位符：`{endpoint}`、`{base_url}`、`{backend_path}`。

## AI 标注

在「配置」选择 ChatLuna 标注模型后，上传 / 偷图 / 归档本地图会异步生成 `tags` 与 `aliases`；关闭「自动标注」则只在手动识别或执行 `tagall` 时标注。

```text
memesluna.tagall
memesluna.tagall -f
memesluna.untagall
memesluna.untagall -c 合集名
```

手动标注、上传后标注、归档和 `tagall` 使用同一任务队列及请求并发上限。Console 的「预览」页可以查看任务状态、每日用量并取消任务；取消会保留已完成的标注。

每日请求上限按实际请求次数计数，失败请求和重试也占用配额。请求次数、重试、成功与失败结果保存在 `data/memesluna/.ai-usage.json`，重启后继续使用，按 UTC 日期重置。请求超时默认 60 秒；底层模型应支持取消信号，超时请求实际结束前仍占用并发槽位，后续等待也有超时限制。

## 自动收集与暂缓区

开启自动收集后监听群聊图片；窗口内出现次数达到阈值则进入暂缓区。该选项默认关闭，关闭时暂缓区只会收到上传时超过 10 MB 的图片。

图片体积下限默认 4 KB。QQ 表情大多在 5~40 KB，设得太高会让大部分表情直接被忽略。

相似图片分组使用精确汉明距离候选检索，每个组成员都需要与该组代表图达到阈值。管理页显示成员与代表图的最低相似度；不会因为暂缓区超过 200 张而切换成会漏检的前缀分桶规则。

暂缓区图片不参与随机路由，需在 Console 归档到合集后才生效。

## 命令

```text
memesluna.list          # 列出可用合集与外部图源
memesluna.stole <合集>  # 引用图片写入合集（需先创建合集）
```

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
```

新增回归测试覆盖并发上传、移动和删除失败回滚、启动文件名冲突、搜索规模边界、相似分组、管理鉴权、上传清理、前端分页和连续标注编辑，以及 AI 配额持久化与任务取消。

发布物：`lib/**/*.js`、`lib/**/*.d.ts`、`dist`（Console 前端）。

## License

MIT
