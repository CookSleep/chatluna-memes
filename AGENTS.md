# ChatLuna Memes Agent 指南

本文件规定 AI 编程工具在本仓库中的工作方式，适用于仓库根目录下的全部内容。

- 能并行的工具调用尽量并行。
- 需求明确时直接动手，只有缺少关键信息、操作不可逆或有安全风险时才停下来确认。
- 用简体中文写注释、提交信息、PR 描述和文档，中文句子使用中文标点。

## 仓库与分支

- 单包 Koishi 插件：`koishi-plugin-chatluna-memes`，TypeScript ESM。由 [memesluna](https://github.com/lumia1998/koishi-plugin-memesluna) 改名独立而来。
- 默认分支是 `main`，diff 以 `main` 或 `origin/main` 为准。
- 后端源码在 `src/`，构建到 `lib/`；Console 前端在 `client/`，构建到 `dist/`。
- `lib/`、`dist/` 是构建产物，不要手动修改，也不要提交。

## 工具与命令

- Node.js >= 18，使用 npm（仓库带 `package-lock.json`）。
- 安装依赖：`npm install`
- 构建：`npm run build`（yakumo：`tsc` 生成声明 → `esbuild` 打包后端 → Vite 打包 `client/`）
- 类型检查：`npm run typecheck`（同时检查 `src/` 和 `client/`）
- 测试：`npm test`（Vitest，用例在 `tests/`）
- 提交前至少跑一遍 `npm run typecheck` 和 `npm test`；改了前端还要 `npm run build`，确认 Vite 能编译 `.vue`。
- 不要新增 linter、formatter 或测试框架，除非被明确要求。

## 项目结构

```
src/
  index.ts              插件入口：注册服务，并按依赖用 ctx.inject 挂载各功能
  config.ts             Koishi 配置 Schema（为空）和插件配置页上的说明
  settings.ts           设置的类型、默认值和校验，前后端共用，不要引入 koishi
  settings-store.ts     设置的读写（data/chatluna-memes/.settings.json），保存后发出 chatluna-memes/settings-updated
  migration.ts          首次启动时迁移 memesluna 的设置、数据表和图片，状态记在 chatluna_memes_meta 表
  service.ts            ChatLunaMemesService：合集、图片、外部图源、暂缓区的存储与数据库读写
  http-server.ts        HTTP 路由：随机图、302 跳转、上传、管理接口
  console-handlers.ts   Console RPC 监听器（全部经过 requireConsoleAdmin 鉴权）
  console-rpc.ts        前后端共享的 RPC 类型，前端直接 import
  auto-collect.ts       群聊高频图片自动收集到暂缓区
  commands.ts           聊天命令（偷图、批量标注等）
  aiAnnotator.ts / annotation-*.ts / aiUsageTracker.ts   AI 标注队列、调度与用量统计
  search.ts / similarity.ts                               关键词检索与感知哈希相似度
  download.ts           外部图片下载（含 SSRF 防护）
client/
  index.ts              注册 Console 页面
  Dashboard.vue         根组件，provide 整个 dashboard 上下文
  composables/
    useDashboard.ts     组合入口：基础状态、表情包与图库、上传、预览页，并汇总下列模块
    useStaging.ts       暂缓区
    useEndpoints.ts     外部图源
    useMetadataEditor.ts 标签与别名编辑
    useDialog.ts        自定义确认、输入、选择对话框
    useToast.ts         轻提示
    rpc.ts / adminFetch.ts  RPC 与带鉴权的 HTTP 请求
  utils/format.ts       与 Vue 状态无关的格式化和转换函数
  components/           layout / shared / views，按页面拆分
  styles/dashboard.css  全部样式，基于 Koishi 主题变量的 token
tests/                  Vitest 用例
```

术语统一使用：**表情包**（合集，collection）、**外部图源**（endpoint，外部随机图片 API）、**暂缓区**（staging）、**预览**。代码标识符保持英文原名，界面和文档使用中文术语，不要再使用「分发管理」「端点」等旧说法。

## 代码风格（必须遵守）

### 先求简单

- 写能工作的最简单代码：更少的抽象、更少的函数、更少的中间变量。
- 不要写 `resolveXXX`、`normalizeXXX`、`ensureXXX`、`toSafeXXX` 这类包装函数；简单转换直接写在调用处。
- 只有被多处调用且逻辑不平凡（超过约 5 行）时才抽函数。
- 不要写推测性的防御代码。类型声明为必填就直接用，不要层层 `??` 兜底；确实可能为空的值做一次简单检查即可。
- 只有重复使用、含义不直观或属于调参项的值才提取为常量。

### 完整实现

- 不留 `TODO`、占位实现或 `// ...` 省略；每个分支都写完整。
- 不确定的细节先按最合理的方式完整实现，再由人审查修正。

### TypeScript

- 2 空格缩进、单引号、不加分号，与现有代码一致。
- 优先 `const`，提前返回，避免深层嵌套。
- 前后端共享的类型放在 `src/console-rpc.ts`，前端不要重复定义。
- `any` 只用于和 Koishi 内部交互的局部位置。

### 注释

- 注释说明「为什么」，不复述代码在做什么。
- 只用中文注释；不要写 `// Actions`、`// State` 这类英文分节注释。

## 前端约定

- 页面运行在 Koishi Console 内，外层使用 `<k-layout>` 和 `<el-scrollbar>`，不要让页面本身产生原生滚动条。
- **颜色只能使用 `dashboard.css` 顶部的 `--cm-*` token**，token 映射到 Koishi 主题变量，深浅色只在 token 层区分（`html.dark .cm-theme`）。组件里不要写死颜色，也不要在 JS 里判断深色模式。
- 所有类名使用 `cm-` 前缀；状态用 `is-xxx` 修饰类。
- 禁止使用 `window.alert` / `confirm` / `prompt`：确认、输入和选择用 `useDialog` 的 `confirmDialog`、`promptDialog`、`chooseDialog`，结果提示用 `showToast`。
- 下拉选择用 `el-select`，不要用原生 `<select>`（原生弹出层不跟随主题）。
- 通过 `Teleport` 渲染到 `body` 的弹层必须带 `cm-theme` 类，否则拿不到 token。
- 弹窗、菜单、代码块、标签输入框等可能变长的区域都要限制最大高度并允许滚动。
- 必须同时适配桌面端和移动端（720px 以下），不能出现横向滚动；改动样式后在深色、浅色、手机宽度下都看一遍。
- 浏览器加载外部图片可能被防盗链、跨域或混合内容拦截：外部图片加 `referrerpolicy="no-referrer"`，失败时显示「无法预览」并给出 `CROSS_ORIGIN_HINT` 说明，不要用 `fetch` 跟随可能跳到外站的 302。
- 文案要自然、简短，像在跟用户说话；说明文字按句子换行，不要堆在一行里。
- 长耗时操作只显示顶部进度条（`loading`），不要卸载页面内容；整页加载只用于首次进入（`initialized`）。

## Koishi 插件约定

- 用到 `ctx.chatluna_memes` 的功能必须放在 `ctx.inject(['chatluna_memes', ...])` 回调里。
- `console`、`server`、`chatluna`、`auth` 是可选依赖；需要读取可选服务时用 `ctx.get('xxx')`，避免未声明注入的警告。
- 新的 Console RPC 统一用 `addListener` 注册，自动带管理员鉴权；同时在 `console-rpc.ts` 的 `ChatLunaMemesConsoleEvents` 中补类型。
- 写文件和数据库的操作走 `withStorageLock`，失败时回滚，参考 `service.ts` 里的现有写法。
- 消息元素同时选择 `img` 和 `image`：OneBot 等适配器产出的是 `img`。
- 用户设置不进 Koishi 配置 Schema。新增设置项时同步修改 `settings.ts`（类型、默认值、校验）和「配置」页 `ConfigView.vue`；运行时直接读共享的设置对象，只在挂载时读取设置的功能要在 `index.ts` 里用 `reloadOn` 声明依赖的键。

## 错误处理与日志

- 预期内的情况（重复图片、名称冲突）返回明确结果或抛出可读错误，由前端用中文提示。
- 后台任务（自动收集、标注、清理）的非预期失败用 `warn` 记录，不要只记 `debug`，否则排查时看不到。
- 下载外部资源必须经过 `downloadImage`，不要绕过 SSRF 检查。

## 本地联调

- 在 Koishi 实例里测试时，把 `lib/`、`dist/`、`package.json` 同步到实例的 `node_modules/koishi-plugin-chatluna-memes/`，然后重启 Koishi。构建、同步、重启三步按顺序执行。
- 改动界面后截图核对深色、浅色和手机宽度三种情况。
