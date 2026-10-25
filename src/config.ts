import { Schema } from 'koishi'

export const name = 'chatluna-memes'

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export const usage = `## chatluna-memes
为 ChatLuna 提供表情包：管理本地表情包和外部随机图源，让模型按语境发表情。

### 设置
所有设置都在控制台侧栏的 **ChatLuna Memes** 页面，在「配置」标签页中修改，保存后立即生效，这里没有配置项。

### ChatLuna 注入
在「配置」中开启 ChatLuna 注入后，插件提供两个变量：
- \`{chatluna_memes}\`：完整的使用说明，包含随机图清单。
- \`{chatluna_memes_list}\`：只有随机图清单。

需要把其中一个变量填入 ChatLuna 预设中合适的位置，模型才能看到。

### 从 memesluna 迁移
首次启动时会自动迁移 [**memesluna**](https://github.com/lumia1998/koishi-plugin-memesluna) 的数据，只执行一次：
- 设置：读取原插件在管理页保存的设置，没有则读取 koishi.yml 中原插件的配置。原默认路由前缀 \`/memesluna\` 改为 \`/chatluna-memes\`，自定义的前缀保留。
- 数据：复制 \`data/memesluna\` 中的图片和 \`memesluna_*\` 数据表中的记录，原数据不删除。
- 预设：变量 \`{memesluna}\` 改名为 \`{chatluna_memes}\`，\`{endpoint}\` 改名为 \`{chatluna_memes_list}\`，需要在预设中一并替换。

迁移不需要原插件在运行。请停用原插件后再启用本插件，两者同时启用时路由会冲突。确认数据无误后，可以手动删除 \`data/memesluna\` 和 \`memesluna_*\` 数据表。
`
