<div align="center">

<img src="docs/icon.svg" alt="ChatLuna Memes" width="128" height="128">

# ChatLuna Memes

[![License](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)](LICENSE)
[![Koishi](https://img.shields.io/badge/Koishi-4.18-5546a3?style=flat-square)](https://koishi.chat/)
[![ChatLuna](https://img.shields.io/badge/ChatLuna-1.3-8b5cf6?style=flat-square)](https://github.com/ChatLunaLab/chatluna)

**让 ChatLuna 会发表情包的 Koishi 插件**

把本地表情包和外部随机图 API 整理成一组随机图地址，注入 ChatLuna 的预设，模型就能按语境挑一张发出去。<br>
用 AI 为每张图生成标签和别名，模型可以按关键词找图；群里反复出现的图会被收进暂缓区，确认后一键归档。<br>
所有管理和设置都在 Koishi 控制台里完成，保存后立即生效。

</div>

---

## ✨ 功能

### 🗂️ 表情包与外部图源
- **表情包**：上传本地图片或导入外链，每个表情包有自己的随机图地址，如 `/chatluna-memes/猫猫`。
- **外部图源**：把随机图 API 挂到同一个前缀下，访问时 302 跳转过去；添加前可以先试一下能不能取到图。
- **管理**：多选后批量移动、删除和标注，标签与别名跟着图片一起移动；重复上传会复用已有的图片和标注。

### 💬 ChatLuna 注入
- **两个变量**：`{chatluna_memes}` 是完整的使用说明，`{chatluna_memes_list}` 只有随机图清单，按需选一个填进预设。
- **提示词模板**：在「配置」里修改使用说明的模板，在「预览」里查看渲染后的完整文本。
- **自动更新**：增删表情包或外部图源后，变量内容随之更新，空表情包不会列出。

### 🏷️ AI 标注与搜索
- **自动标注**：用 ChatLuna 中的模型为上传、偷图和归档的图片生成标签与别名，也可以在编辑弹窗里手动识别。
- **按关键词找图**：随机图地址后加 `?q=关键词`，按别名、标签和文件名找最匹配的一张；不带表情包名时在全部表情包里搜索。
- **用量可控**：可以设置并发数、重试、超时和每日请求上限，在「预览」里查看任务进度并随时取消。

### 📥 自动收集与暂缓区
- **高频收集**：开启后，同一张图在群里一段时间内出现若干次，就会被收进暂缓区。体积范围和每群每日上限都可以调整。
- **相似分组**：按感知哈希把相似的图片归为一组，方便整组归档或删除。
- **过期清理**：暂缓区的图片超过保留天数后自动删除。

---

## ✅ 前置条件

- Koishi 4.18 及以上，并启用数据库插件。
- 需要发图和管理页时启用 `server` 和 `console`（Koishi 默认已启用）。
- ChatLuna 注入和 AI 标注需要 [ChatLuna](https://github.com/ChatLunaLab/chatluna)。AI 标注要选支持识图的模型。

## 🚀 使用

1. 启用插件后，在控制台侧栏打开 **ChatLuna Memes**。
2. 在「表情包」中新建表情包，上传图片；需要的话在「外部图源」中添加随机图 API。
3. 在「配置」中开启 ChatLuna 注入，把 `{chatluna_memes}` 填入 ChatLuna 预设中合适的位置（例如介绍可用能力的部分）。**变量只有填进预设才会生效**。
4. 机器人对外的地址和 Koishi 的 `selfUrl` 不同时（例如经过反向代理），在「配置」中填写对外地址，否则模型拿到的地址无法访问。

### 随机图地址

| 地址 | 作用 |
| --- | --- |
| `/chatluna-memes/表情包名` | 从表情包中随机返回一张；外部图源则 302 跳转 |
| `/chatluna-memes/表情包名?q=关键词` | 在该表情包里按关键词找图，找不到时随机返回 |
| `/chatluna-memes?q=关键词` | 在全部表情包里按关键词找图 |
| `/chatluna-memes/表情包名/文件名` | 返回指定的本地图片 |

前缀可以在「配置」中修改，修改后已经发出去的旧地址会失效。

### 命令

| 命令 | 作用 |
| --- | --- |
| `chatluna.memes.list` | 列出可用的表情包和外部图源 |
| `chatluna.memes.stole <表情包名>` | 引用带图片的消息后发送，把图片存进表情包；别名 `偷了` |
| `chatluna.memes.tagall [-f]` | 为还没有标注的图片排队标注，`-f` 重新标注全部图片 |
| `chatluna.memes.untagall [-c <表情包名>]` | 清空全部或指定表情包的标注 |

除 `list` 外的命令需要 5 级权限。

## 🔁 从 memesluna 迁移

本项目由 [memesluna](https://github.com/lumia1998/koishi-plugin-memesluna) 改名独立而来。首次启动时会自动迁移原插件的数据，只执行一次：

- **设置**：读取原插件在管理页保存的设置，没有则读取 koishi.yml 中原插件的配置。原来的默认前缀 `/memesluna` 改为 `/chatluna-memes`，自定义的前缀保留。
- **数据**：复制 `data/memesluna` 中的图片，以及 `memesluna_*` 数据表中的表情包、外部图源和暂缓区记录。
- **原数据**：不会删除，确认无误后可以手动删除 `data/memesluna` 和 `memesluna_*` 数据表。
- **停用原插件**：迁移不需要原插件在运行。请先停用原插件再启用本插件，两者同时启用时路由会冲突。
- **预设**：`{memesluna}` 改名为 `{chatluna_memes}`，`{endpoint}` 改名为 `{chatluna_memes_list}`，需要在预设中一并替换。

## 🔒 数据与安全

- 图片保存在 `data/chatluna-memes`，设置保存在其中的 `.settings.json`，记录保存在 `chatluna_memes_*` 数据表中。
- 启用了 auth 插件时，管理页的所有操作都需要登录有管理权限的控制台账号；没有启用时和控制台本身一样不设登录。
- 下载图片时拒绝直接指向内网 IP 的地址，并按文件内容判断真实格式，不信任扩展名。
- 管理页里的缩略图由浏览器直接加载。外链显示「无法预览」时，常见原因是防盗链、跨域限制或只有服务器能访问的内网地址，不代表机器人发图会失败。

## 📄 许可

本项目基于 [MIT License](LICENSE) 开源。

## 🙏 致谢

- [memesluna](https://github.com/lumia1998/koishi-plugin-memesluna)（lumia1998）：本项目的前身，表情包路由、外部图源、AI 标注和自动收集都源自它。
- [Koishi](https://koishi.chat/)：聊天机器人框架。
- [ChatLuna](https://github.com/ChatLunaLab/chatluna)：提供变量注入和标注用的模型。
- [Photon](https://github.com/silvia-odwyer/photon)：计算感知哈希，用于相似图片检测。
