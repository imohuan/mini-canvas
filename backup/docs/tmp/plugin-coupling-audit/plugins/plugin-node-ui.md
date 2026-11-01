# plugin-node-ui

## 一句话

可视化节点让 Agent 把一段 HTML 写进节点里渲染，并同时提供前端节点、后台任务脚本、调试通道和节点包导入导出。它是本组里职责最重的插件：一个包同时跨前端、后台、路由、存储和浏览器沙箱。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-node-ui` |
| 身份 | builtin（`package.json:6-11`） |
| 源码文件 | 36 个实现文件（含前端、后台、task、debug） |
| 测试文件 | 27 个 |
| 包依赖的其他插件 | `@mini-canvas/plugin-bottom-bar` 在 dependencies（`package.json:35`），但前端源码没有 import 它；`@mini-canvas/plugin-theme-default` 只在 devDependencies（`package.json:44-45`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/canvas-base` | `Service / PluginModule / bindTypeDefaultSize` | 是 | `src/nodeUiPlugin.ts:28` |
| `@mini-canvas/canvas-data` | `DocService` 类型 | 是 | `src/nodeUiPlugin.ts:29` |
| `@mini-canvas/canvas-render` | 渲染上下文、主题 token、UI 目录 | 是 | `src/UiContent.vue:30-32` |
| `@mini-canvas/plugin-bottom-bar` | package.json 依赖，但前端源码无 import；后台 `server.ts` 也未 import | **声明了未使用的依赖** | `package.json:35`；源码无命中 |
| `node:fs / node:path / node:child_process` | 后台任务脚本、打包、导入、调试文档 | 宿主能力，非插件 | `src/server.ts:63`，`src/task/*` |
| `esbuild` | 只用于构建后台单文件 | 构建工具 | `package.json:22-25`，`scripts/build-server.mjs:41-42` |
| 其它插件内部路径 | 无 | — | 无命中 |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬 | `src/nodeUiPlugin.ts:145-146` |
| `uiNode` 服务 | 本插件上架，`addNode/setHtml/htmlOf/inputsOf/clear` | 硬（本包） | `src/nodeUiPlugin.ts:63-143` |
| `settings` | 读 `uiNodeBaseUrl / uiNodeAllowNetwork / uiNodeDefaultWidth/Height / uiNodeRaster*` | 可选（缺则默认） | `src/uiConfig.ts:24-40`，`src/nodeUiPlugin.ts:155-170`，`src/rasterTier.ts:84-94` |
| `command` | 注册 `ui.getContext / ui.setHtml / ui.clear`，并通过事件回传上下文 | 契约 | `src/nodeUiPlugin.ts:237-271` |
| `ui/context` 事件 | `ctx.emit` + `registerEventName` | 契约 | `src/nodeUiPlugin.ts:247,271-277` |
| `canvasStore` | 后台路由读写多画布、资源目录 | 可选（缺则只操作默认画布） | `src/server.ts:217-251,353-367,416,488-515,1485-1532` |
| `assetStore` | 后台打包/导出取资产文件 | 可选 | `src/server.ts:888-944` |
| `selection` | 调试邀请时选中节点 | 可选 | `src/UiContent.vue:420` |
| `command` | 聚焦节点，调 `auto-layout:focus-selected` | 可选（命令不存在则 log） | `src/UiContent.vue:424-429` |
| `ui` 目录 | 无按名取件；包内调试徽标是本地组件 | — | 无命中 |
| 底栏 | 无动作、无面板；本插件明确不参与底栏 | — | `src/nodeUiPlugin.ts:13-25,145` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `location.href` / URL 查询参数 | 解析当前画布 id 与后台地址 | 中：与 `plugin-cloud-client` 的 `canvasId()` 规则重复实现 | `src/uiConfig.ts:63-80`；对照 `packages/plugins/plugin-cloud-client/src/keys.ts:24-40` |
| `sessionStorage` | 保存调试凭据（每标签页一份） | 中：固定键 `mc-ui-debug-credential` | `src/debugSession.ts:22-30`，`src/DebugBadge.vue:30` |
| `window.postMessage` / `message` | 宿主与 iframe/调试窗口通信 | 中：消息协议是字符串契约 | `src/uiData.ts:516-592`，`src/UiContent.vue:846-874,912-936` |
| `iframe srcdoc` + CSP | 沙箱渲染生成 HTML | 高：安全边界，CSP 与 allow-same-origin 是红线 | `src/UiContent.vue:20-26`，`src/uiData.ts:695`，`src/__tests__/uiContentRender.test.ts:61` |
| `/api/node-ui/*` | 后台信息、调试接受/轮询/结果、资源调试 | 中：固定路由 | `src/server.ts:463,1270-1301,1359-1388,1528` |
| `/api/task/*` | 任务脚本调用 | 中：固定路由 + 授权 | `src/task/routes.ts`；`src/server.ts:471` |
| `/api/canvases/:id/resources` | 生成物落地 | 中：与 cloud-server 契约 | `src/UiContent.vue:818-820`，`src/task/runner.ts:139,159` |
| `setInterval` | 调试徽标刷新、调试轮询、SSE ping | 低：有清理 | `src/DebugBadge.vue:37,55-58`，`src/debugSession.ts:214`，`src/server.ts:1342-1343` |

## 内部职责与风险

1. **前端 + 后台 + 调试三合一**：前端节点 `nodeUiPlugin.ts` 319 行；后台 `server.ts` 1480 行；调试 `debugSession/debugDocServer/UiContent` 另有三套。后台半要单独打成 `dist/server.js` 外挂到 cloud-server（`scripts/build-server.mjs:2-4,41-42`；`scripts/deploy-server.mjs:31-33`）。这条发布链与前端插件生命周期完全分离，是最大的结构风险。
2. **package.json 声明了未使用的底栏依赖**：`@mini-canvas/plugin-bottom-bar` 在 dependencies（`package.json:35`），但前端源码与后台源码都没有 import；注释还明确说“不需要底栏”（`src/nodeUiPlugin.ts:145`）。这会让装 node-ui 时被迫带上底栏包，和“可单独安装”目标冲突（待验证 pnpm 是否 hoist）。
3. **画布 id 规则重复实现**：`uiConfig.currentCanvasId` 明确说“与 plugin-cloud-client 同一套判据，就地照同一套规则读一次”（`src/uiConfig.ts:63-68`），没有 import 对方。两份规则已经存在，未来改路由会漂移。
4. **上游素材收集与底栏重复**：`buildNodeContext` 自己扫边、取 `imageUrl/videoUrl/audioUrl/panoUrl/text`（`src/nodeUiPlugin.ts:306-330`），注释说“与底栏 collectUpstreamMaterials 的既有语义一致”。底栏版还支持 `refOrder`、音频，两份已经不同。
5. **后台路由直接依赖 `canvasStore/assetStore/selfOrigin` 等宿主服务名**：这些不是 canvas-base 的公开类型，而是 cloud-server 的注入形状（`src/server.ts:217-251`）。后台插件与宿主服务名是硬契约，换宿主就断。
6. **安全边界测试较实**：`uiContentRender.test.ts` 断言 iframe 沙箱不给 `allow-same-origin`、遮罩不带 `nodrag/nopan`（`src/__tests__/uiContentRender.test.ts:45-68`）；`uiData.test.ts` 断言 CSP、`</script>` 转义、U+2028/U+2029（`src/__tests__/uiData.test.ts:204-219,254-293`）。这是本组里跨边界测试最充分的一包。
7. **调试通道有固定存储键与固定路由**：`sessionStorage` 键、`/api/node-ui/debug-*`、SSE ping 20s、15 分钟超时（`src/server.ts:1315-1343`）。这些是产品功能，不是坏味道，但属于 L1 宿主/全局粘连，换域名/换后台要一起改。

## 单独装卸判断

- **单独装 node-ui、不装底栏**：完全正常；本插件不参与底栏。package.json 的底栏依赖是多余的。
- **单独卸 node-ui**：前端节点、服务、命令、事件随 scope 回收；后台 `dist/server.js` **不会**随前端卸载自动移除，需要在 cloud-server 侧单独卸载（`scripts/deploy-server.mjs:7-14`）。这是“前端卸载 ≠ 后台卸载”的双生命周期。
- **只装后台、不装前端**：MCP 工具仍可调 `canvas_ui_*`，但没有 `ui` 节点类型可写；后台 `uiNodeOf` 对 `node.type !== 'ui'` 明确报错（`src/server.ts:314-326`）。
- **只装前端、不装后台**：节点可显示、可写 HTML，但 `/api/node-ui/info`、任务脚本、调试、打包路由都不存在；生成页面只能同源且功能降级。

## 建议改法

1. **最小改动：删掉未使用的 `@mini-canvas/plugin-bottom-bar` 依赖。** 源码没有 import，注释也说不参与底栏。验证：`pnpm -C packages/plugins/plugin-node-ui typecheck` 与 build。
2. **把画布 id 解析收成共享函数。** 与 `plugin-cloud-client` 共用一份；当前两份规则注释都承认是同一条。验证：两包各自测试同一组 URL。
3. **把上游素材收集收成共享纯函数。** 与底栏、3D、对比共用；统一 `refOrder`、音频、`panoUrl` 规则。
4. **拆出后台半为独立包或独立生命周期。** 现在同一个包既有前端 UMD 又有 `dist/server.js`，安装/卸载/版本完全不同步。拆成 `plugin-node-ui-server` 后，前端卸载不会留下后台孤儿。验证：前端卸载后后台路由消失。
5. **把固定路由/存储键收成常量并加契约测试。** `/api/node-ui/*`、`mc-ui-debug-credential`、SSE ping 周期都应集中声明，前后端共用。

## 待验证

- package.json 的底栏依赖是否真的让安装 node-ui 时拉入底栏包；pnpm workspace 的 hoist 行为未实测。
- 前端卸载后后台 `dist/server.js` 的实际残留行为；只从脚本注释推断，未在 cloud-server 运行时验证。
- `canvas_ui_*` MCP 工具与前端节点类型的对应关系在卸载后的报错路径；未构造实验。
- `sessionStorage` 固定键在多个画布/多个标签页下的隔离边界；代码有 canvasId 校验，未做多标签页真机测试。
