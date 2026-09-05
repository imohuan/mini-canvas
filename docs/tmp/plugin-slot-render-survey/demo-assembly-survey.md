# Demo 装配与验证命令侦察报告（mini-canvas 仓库）

> 侦察日期：2026-09-05。仓库根：`D:/Code/Git/mini-canvas`（pnpm workspace）。
> 检索手段：codegraph MCP（index 已就绪，296 文件）+ 直接读 vite/package/tsconfig 配置。
> 结论均为源码/配置文件直接佐证，未跑命令，但命令与 script 一一对应。
> 本文档是侦察结论，**不含任何代码改动**。

---

## a. demo/示例页在哪、怎么装配宿主/插件

### 官方 demo（5199 端口要看的页面）

**入口文件**：`packages/canvas-core-v2/demo-web/index.html`（root 指向它）
→ `main.ts` → `CanvasDemo.vue`。

- `packages/canvas-core-v2/demo-web/index.html` — 页面骨架，`<script src="/main.ts">`。
- `packages/canvas-core-v2/demo-web/main.ts` — mount `CanvasDemo`（并引 VueFlow 全局 css）。
- **`packages/canvas-core-v2/demo-web/CanvasDemo.vue` — 主 demo（业务薄壳）**。

### CanvasDemo.vue 怎么装宿主 + 插件（关键代码）

- CanvasHost 是**组件化宿主**，demo 不再手写 VueFlow 装配 / provide / store↔flow 同步，全部收进 `CanvasHost` 内部（注释见 CanvasDemo.vue:2-8）。
- **导入与装配**（CanvasDemo.vue:14-19, 28-29）：
  ```ts
  import { CanvasHost, DEFAULT_EDGE_VISUAL, DEFAULT_HANDLE_VISUAL } from '@mini-canvas/canvas-render'
  import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
  import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
  import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
  import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'
  ...
  const plugins: PluginModule[] = [themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]
  const adapter: StorageAdapter = new LocalStorageAdapter()
  ```
- **模板**（CanvasDemo.vue:107-119）：把 `plugins` / `adapter` / `seed`(seedDefault) / 外观 cfg 等传给 `<CanvasHost ref="hostEl" :plugins="plugins" ... window-key="MiniCanvas" @ready=... @context-menu=... />`。
- **当前装了什么插件**（4 个，顺序即装载序）：
  1. `themeDefaultPlugin`（theme-default，提供 nodeShell/edge/background/edgeDefaultType）
  2. `nodeTextPlugin`（text 节点，content=TextContent.vue，`ctx.get('text')` 服务）
  3. `nodeImagePlugin`（image 节点）
  4. `canvasCommandsPlugin`（画布通用命令：删除/建节点/撤销/重做）
- 业务 UI：CanvasDemo 外层 toolbar（+文本/+图片/删除/撤销/重做）+ `SettingsPanel.vue`（调边/连接点外观）+ 右键菜单；画布由 CanvasHost 提供。

### CanvasHost（组件宿主）如何把 plugins 变成冷插件、暴露 host/api

- `packages/canvas-render/src/host/CanvasHost.vue`：
  - `props.plugins: PluginModule[]`（:58-61），setup 期自建 `NodeRegistry` 并 `provide(NODE_REGISTRY_KEY, registry)`（:102-103）、`provide(HOST_KEY, hostRef)`（:106）。
  - `onMounted`（:274-323）：`createMiniCanvasHost({ adapter, coldPlugins: props.plugins, nodeRegistry: registry, seedDefault: props.seed })` → 存 `hostRef`/`apiRef`；订阅 nodeStore 自动刷渲染态；订阅 `ctx:plugin-installed/uninstalled` 事件做 `applyTheme()` + bump `nodeEpoch` 触发 VueFlow 子树重挂。
  - 装配 `<VueFlow>`：themeRegistry 的 nodeShell/edge/background 经 `assembleTheme` 填进 nodeTypes/edgeTypes（:160-173, 366-388）。
  - `defineExpose`：`host` / `api` / `ready` / `bootErrorText`（:335-348）→ demo 经 `hostEl.value.host` 驱动命令。
- `packages/canvas-render/src/host/createMiniCanvasHost.ts`：
  - 唯一宿主门面，不 import 任何具体插件；`coldPlugins` 顺序装载（:122 `ctx.plugin(p)`）。
  - 注入内核服务：save/nodeStore/nodeRegistry/themeRegistry/selection/history/command/nodeFactory。
  - 返回 `{ host, api, exposeToWindow }`；`api` 面 = `installPlugin/uninstallPlugin/reloadPlugin/listPlugins/getContext/getRegistry/getNodeStore/getHost`（:148-160）。`reloadPlugin` = uninstall 旧 + install 新（:151-154）。

### 术语对应（PluginModule 不是函数，没有 `plugin()`）

请求里提到 “PluginModule plugin()/installPlugin”。实际代码形态是 **`PluginModule` 对象** `{ name, deps?, setup(ctx) }`（例 `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts`），不是 `plugin()` 函数。装配方式有二：
1. **冷启动**：`createMiniCanvasHost({ coldPlugins })` / `<CanvasHost :plugins>` → 内部 `ctx.plugin(p)`。
2. **运行时热装**：`window.MiniCanvas.installPlugin(mod)`（包一层 `uninstallPlugin`/`reloadPlugin`）。

### 两个专门的"插件运行时加载"实验页（非主 demo，各有独立 html 入口）

它们验证插件动态/热更链路，改造后想验证插件机制可参考：

- `packages/canvas-core-v2/demo-web/plugin-load.html` → `plugin-load.ts`：宿主运行时用 `<script>` 载入**打包好的 UMD js**（`demo-web/plugins/plugin-node-text.js`，构建产物目录，已 gitignore）→ `installPlugin` → 建节点。
- `packages/canvas-core-v2/demo-web/plugin-load-dev.html` → `plugin-load-dev.ts` + `plugin-load-dev-app.vue`：宿主(5199) **跨端口热拉 text 插件 dev server 源码模块** `import('http://localhost:5311/src/index.ts')`，改插件源码靠 vite 原生 HMR → `reloadPlugin` 实时更新。`state` + `epoch` 驱动 `.vue` 重建节点。

> 这些 demo 的 entry html 都不在 vite `root` 的默认 `/`，需手动 URL：`http://localhost:5199/plugin-load.html`、`.../plugin-load-dev.html`。

---

## b. dev 服务器配置（哪个 vite config 在 5199、npm script）

- **`packages/canvas-core-v2/vite.config.ts` 就是 5199 端口那个**：
  ```ts
  root: 'demo-web',
  server: { port: 5199, strictPort: false },
  plugins: [vue()],
  optimizeDeps: { include: ['vue', '@vue-flow/core', 'pinia'] },
  ```
  root 指向 `demo-web/`，所以 `/` = `index.html`（主 demo）。
- **npm/pnpm script**：`packages/canvas-core-v2/package.json` → `"dev": "vite"`。
  启动命令：`cd packages/canvas-core-v2 && pnpm dev`（STATUS.md 也用它）。
- 根 `vite.config.ts`（仓库顶）+ 根 `package.json` `"dev": "vite"` 跑的是**老版 web app**（`src/`，旧 canvas-core 宿主），端口未设=默认 5173，**不是** 5199。

---

## c. canvas-render / plugin-* 各包 dev/vite config 与端口、HMR

| 包 | config 文件 | 端口 / 模式 | 说明 |
|---|---|---|---|
| `canvas-render` | 无 vite.config，仅 `vitest.config.ts` | **无 dev server** | 是库包，只 `typecheck`/`test`；CanvasHost 等 `.vue` 只被宿主消费 |
| `plugin-theme-default` | `vite.config.ts`（command 分支双模式） | **dev: 5310**（`root:'demo-web'`, strictPort, open） | `pnpm dev` = serve 独立预览（root=demo-web）；`pnpm build` = UMD lib。optimizeDeps.exclude 几个源码插件 |
| `plugin-node-text` | `vite.config.ts`（UMD build）＋ **`vite.dev.config.ts`（dev/HMR）** | **dev:hmr 5311**（strictPort, cors） | `dev`=`vite`(用 build config，serve 意义弱)；**`dev:hmr`=`vite --config vite.dev.config.ts`** 才是跨端口热更用的真 dev server。内置自定义插件 `forcePluginEntryHotUpdate`：任一 `plugin-node-text/src/*` 变更即把入口 index.ts 塞进热更集合 → 触发 `import.meta.hot.accept(self)` → `reloadPlugin` |
| `plugin-node-image` | `vite.config.ts` | **仅 build**（UMD） | 无 dev script，无 dev server |
| `plugin-canvas-commands` | — | 无 | 纯命令插件，仅 typecheck |

**HMR 机制（改插件源码即热更的关键）**：
- 插件包 `src/index.ts` 内 `import.meta.hot.accept(...)` → 经 `window.MiniCanvas.reloadPlugin` 卸旧装新（plugin-node-text `index.ts`、plugin-node-image `index.ts` 都有此代码，仅 dev 生效）。
- 宿主侧 `CanvasHost`/`createMiniCanvasHost` 监听 `ctx:plugin-installed/uninstalled` → `applyTheme()` + bump `nodeEpoch` 让 VueFlow 重挂（CanvasHost.vue:296-306）。
- 跨端口拓扑：宿主(5199) `import('http://localhost:5311/src/index.ts')`；插件模块自带 5311 的 `/@vite/client` token → 宿主页面自动成为 5311 的 HMR 客户端（见 `demo-web/plugin-load-dev.ts` 注释）。
- vue 单例核心：宿主与插件都 resolve `vue` 到 pnpm workspace 同一真实路径，浏览器 ES module 同 URL → 只有一份 vue。

---

## d. 全仓 typecheck（怎么对 .ts/.vue 全量 vue-tsc；各包 typecheck script）

### 现状：根 build 只管老版 `src/`，**不覆盖 packages 包**

- 根 `package.json`：`"build": "vue-tsc -b && vite build"`。`tsconfig.json` 只 references `tsconfig.app.json`(include `src/**/*.{ts,tsx,vue}`) + `tsconfig.node.json`(vite.config.ts)。→ 老版 web 应用用。**packages/ 下的内核/render/插件不在其范围。**
- 各包**各自**有 `typecheck` script（均为 `tsc --noEmit`，canvas-core-v2/canvas-render/所有 plugin 包）：见各 `package.json`。
  - canvas-core-v2 `tsconfig.json` include `["src"]`（不含 demo-web 的 `.vue`，lib ES2022 无 DOM）。
  - canvas-render 同理 include `["src"]`；其**`.vue` 宿主组件另用 `tsconfig.vue.json`**（注释明确）：`node ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.vue.json`，include `src/host/*.vue` 等。
- 内核测试：`vitest.config.ts`（canvas-core-v2 / canvas-render）include `src/**/*.test.ts`，environment `node`。

### 推荐"跑全绿"命令组合（从 package.json + STATUS.md 的权威验证法推导）

monorepo 用 pnpm；根有 `pnpm -r` 能力（各包在 `packages/*`、`packages/plugins/*`）：

```bash
# 1) 全部 workspace 包的 typecheck（tsc --noEmit）
pnpm -r typecheck

# 2) canvas-render 的 .vue 宿主组件额外 vue-tsc 类型检查（CanvasHost 等）
cd packages/canvas-render && node ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.vue.json

# 3) 各包单测（vitest run）
pnpm -r test          # 或针对单包：cd packages/canvas-core-v2 && pnpm test

# 4) 顶层构建/老版 .ts/.vue 全量 vue-tsc -b（含 src/ 老版 web）
pnpm build            # = vue-tsc -b && vite build
```

STATUS.md 里给出的**官方"每次改完"最小闭环验证**（针对 canvas-core-v2 主闭环）：
```bash
cd packages/canvas-core-v2
node ./node_modules/vitest/vitest.mjs run       # 测试
node ../../node_modules/typescript/bin/tsc --noEmit  # 类型
pnpm dev                                        # 起 5199 看画面
```
> 说明：各包 typecheck 的 `tsc --noEmit` 用的是包内 `typescript`（`tsc`），实测直接 `pnpm -r typecheck` 即可；STATUS 用 node_modules 绝对路径是为了绕过脚本/别名差异，两种等效。根 `pnpm build`(vue-tsc -b) 含老版 `src/` 的 `.vue/.ts` 全量检查。

---

## e. docs/STATUS.md 现在写了什么

文件：`docs/STATUS.md`（项目"当前该干什么"指挥入口，非里程碑表格，是 runbook 式状态页）。要点：

- **当前主线（2026-09-04）**：canvas-core-v2 重构开发测试期最小闭环；红线=不碰老版 `src/`、不把 M6 复杂件带进当前闭环。
- **进度**：M0（Cordis 内核 83 绿）→ M1 浏览器最小闭环 → M2 NodeRenderer/BaseNode/slot → M3 命令收敛 → M4 Save 层 → M5 连接内核（共 83 测试绿）→ **M1~M5 全达成**；插件抽独立包(dsh) 样板跑通（101 测试全绿）。M6（image 复杂件/云/交互）为**另开任务**，当前不碰。
- **现在立刻该做**：M1~M5 完成、插件独立包样板跑通、101 测试全绿；下一步 M6 由用户定。在此之前让用户 `cd packages/canvas-core-v2 && pnpm dev` 目验画面。
- **验证命令**：见上 d 节三条（vitest run / tsc --noEmit / pnpm dev），"测试是唯一裁判"。
- **契约锚点**：runbook / ctx API / 核心节点件契约金标准 / architecture / ADR 等（改动前必读，禁止自己发明接口）。
- **铁律 8 条**：测试是唯一裁判、契约不自己发明、单文件单 owner、Do not change the tests、卡住停下、绿了才 commit、高危模块动前确认测试网、架构/契约决策不下发并行子代理。

---

## 附：改造后要在 demo 验证插件，最可能的操作路径

1. 跑主 demo：`cd packages/canvas-core-v2 && pnpm dev` → `http://localhost:5199/`（index.html，CanvasDemo，装了 theme-default/text/image/canvas-commands 四插件）。
2. 验证插件动态加载：另开 plugin 打包 js 场景 → `http://localhost:5199/plugin-load.html`。
3. 验证插件开发热更：`cd packages/plugins/plugin-node-text && pnpm dev:hmr`（起 5311）→ `http://localhost:5199/plugin-load-dev.html`，改插件源码即热更。
4. 若改动涉及 canvas-render 的 CanvasHost 装配，验证命令：canvas-render `pnpm typecheck` + `pnpm test`，再回 canvas-core-v2 起 demo 目验；`.vue` 类型走 `vue-tsc -p tsconfig.vue.json`。
