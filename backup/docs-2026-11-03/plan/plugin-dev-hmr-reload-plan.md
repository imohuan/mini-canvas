# 插件 dev 热重载：宿主监听插件文件变更 → reloadPlugin（可跑演示）

> 目标：让"插件在它自己的 vite dev server 上开发 → 改文件 → 运行中的宿主画布实时热更"，页面不刷新。
> 前置：跨端口连 vite dev 的 SSE/hmr 调研已完成（docs/tmp/vite-hmr-probe/）。本文档把其中"方案A（自定义 vite 插件 + server.watcher + SSE 端点）"落地成可跑演示。

## 0. 一句话方案

给插件加一个自定义 vite 插件 `fileChangeFeed`：用 vite 自己的 `server.watcher`（chokidar）监听插件 src 文件变更 → 经一个 SSE 端点（`/__plugin_changed`）推给宿主；宿主 `EventSource` 收到变化 → 重新拉插件模块 → `window.MiniCanvas.reloadPlugin(name, newMod)`。

绕开三坎：vite HMR 模块图（watcher 直出，不需 import 进图）、token（SSE 端点，非 vite ws 通道）、update 内部格式（我们只关心"文件绝对路径变了"）。

## 1. 关键难点：vue 单例（dev 跨端口场景）

这是本方案唯一的硬骨头，必须在实现前定死。

### 背景
- 已跑通的"打包 UMD"场景：宿主把 `window.Vue`/`window.MiniCanvasCore` 喂全局，UMD 插件 external 掉 vue/内核、运行时取全局 → 浏览器只有一份 vue。**这与 dev 无关，是打包后的事。**
- dev 场景（本次要做的）：插件自己 `vite`（独立 dev server），`.vue` SFC 由**插件 dev server 编译**。若 SFC 里 `import 'vue'` 落在插件自己的 node_modules，浏览器会有第二份 vue → vue 警告、组件挂不上宿主画布。

### 解法（二选一，倾向 A）
**方案A：插件 dev server 把 vue/@vue-flow/内核 alias 到宿主的实例。**
插件 vite.config 里 `resolve.alias` 把 `vue` 指到宿主项目同一份（同 workspace 内路径），`@vue-flow/core`/`@mini-canvas/canvas-core-v2` 同理。于是插件 dev 编译的 `.vue` `import 'vue'` 实际拿到宿主的 vue。宿主不刷新、插件改文件 → 重拉新模块即真热更，无双 vue。

**方案B：仍走 UMD 打包 + 宿主喂全局**，dev 改文件后宿主重新 `loadScript` UMD 产物再 reloadPlugin。缺点：每次要重打包（vite build 不可接受地慢于 dev 编辑）——所以用户要 dev 就是为了跳过打包，方案B 背离初衷。**弃。**

> 定案：**方案A**。vue 单例靠"插件 dev alias 宿主 vue"保证，这与 UMD 场景"external + 全局取"是同一哲学（宿主是唯一 vue 拥有者），只是换到 dev 用 alias 而非 external+global。

## 2. 落地文件与步骤

### Step 1：抽出共享的 `fileChangeFeed` vite 插件
新文件放哪：三插件各自用。为最小化，先做成一个**源码小模块**放 theme 插件 devDeps 引用或直接内联。倾向：先在各插件 `vite.demo/dev` config 里内联同一个函数（几十行），不搞包级共享，避免引入新 workspace 包。若发现重复多了再抽。

（实现见调研 doc 02 的示例：`configureServer` 里 `server.watcher.on('change/add/unlink')` → SSE 端点 `/__plugin_changed`，响应带 CORS 头。）

### Step 2：给 `plugin-node-text` 加一个真正 dev server 用的 config
- 建 `vite.dev.config.ts`（区别于 `vite.config.ts` 的 build）：`root`/入口做成宿主可 import 的模块 URL（无需 html，供宿主 `import('http://localhost:531x/src/index.ts')`）。
- 加 `fileChangeFeed()` 插件。
- `resolve.alias`: `vue`/`@vue-flow/core`/`@mini-canvas/canvas-core-v2` 指宿主同一份。
- port 固定，如 5311（避开 5310/5199）。
- pkg script：`dev:hmr`: `vite --config vite.dev.config.ts`。

### Step 3：宿主新演示页 `plugin-load-dev.html` / 逻辑
在 canvas-core-v2 demo-web 加一个页面（或在 plugin-load.ts 里新增逻辑，倾向独立页避免污染既有 UMD 演示）：
1. 宿主把 `window.Vue`/`window.MiniCanvasCore` 喂全局（与 UMD 一致，防万一）。
2. 建空宿主，`installPlugin` 首次拉 dev 模块。
3. `EventSource('http://localhost:5311/__plugin_changed')` → 收到 `changed` → `import('http://localhost:5311/src/index.ts?t='+Date.now())` 拿新 `nodeTextPlugin` → `api.reloadPlugin('text', newMod)`。
4. 页面上放一个文本节点；把"改了什么 → 宿主已热更"打到 #result。

> 注意：因为 Step 2 alias 了 vue，宿主直接 `import` 插件 dev 模块 URL 时，该模块里所有 vue 引用都 resolve 到宿主同一 vue（靠浏览器端模块图 + vite 转换后的 import 路径都指向宿主那份）。**需在 Step 3 实测确认无双 vue 警告。**

### Step 4：主题插件 dev 也接上（可选，二期）
theme 已有独立 dev 预览页（自建 host 自看主题），与本需求"宿主驱动热更"不同——那个是预览不是宿主装载。先只做 text 插件端到端，theme 若需再补（theme 是 UI 外壳，热更价值最大，但涉及 VueFlow Handle 组件，链路更长）。先保证 text 闭环跑通，机制通用可复制。

## 3. 验证
1. 起 text 插件 dev（5311）、宿主 dev（5199）两 server。
2. 打开宿主演示页：能看到文本节点（dev 模块已装上）。
3. **改插件源码**（如 TextContent.vue 文案 / nodeTextPlugin.ts 默认 text），保存。
4. 看宿主页 #result：出现"已热更 → reloadPlugin"；画布节点外观/行为更新，**页面未刷新、控制台无第二份 vue 警告**。
5. 跑既有测试（vitest run）+ tsc 干净，确认没碰坏 UMD/源 import 路径。

## 4. 风险
- alias vue 到宿主同源：若宿主与插件 dev server 目录层级导致 vite 把 alias 解析出不同实文件路径（symlink 差异），可能仍双 vue → 用真实绝对路径而非 workspace 别名。
- `import(模块?t=ts)` 二次拉会重新执行整个模块图：插件 setup 里若有不幂等副作用（addEventListener 到 window 等）会重复。当前插件副作用都走 ctx（Scope 回收），reloadPlugin=uninstall+install 已覆盖。
- SSE 跨源：本机不同端口默认 CORS 宽松，必要时显式加 `Access-Control-Allow-Origin`。
- 浏览器缓存 `?t=` 时间戳已绕开，但 ES 模块 import 同 URL 不同 query 是否真重新执行需 Chrome 实测。

## 5. 不做的事
- 不碰 vite 原生 HMR ws / token / 模块图语义。
- 不改插件打包路径（build 仍 UMD）。
- 不动既有 UMD plugin-load 演示与 121 测试。
