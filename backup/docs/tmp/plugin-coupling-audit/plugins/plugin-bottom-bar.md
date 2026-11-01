# plugin-bottom-bar

## 一句话

全画布共用的“节点底栏 + 任务执行器 + 结果写入器注册场”。它把动作从各节点插件里收出来，方向是对的；但它同时承担了执行、状态持久化、浮层、参考选择、媒体预览和默认皮，包内职责偏多，且注册糖被节点包直接 import。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-bottom-bar` |
| 身份 | builtin（`package.json:6-11`） |
| 源码文件 | 21 个实现文件 |
| 测试文件 | 14 个 |
| 包依赖的其他插件 | 无运行依赖；`@mini-canvas/plugin-theme-default` 只在 devDependencies，供测试装载真实主题（`package.json:34-41`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/canvas-base` | `Service`、`Context` | 是 | `src/nodeBarPlugin.ts:13` |
| `@mini-canvas/canvas-data` | `DocService` 类型 | 是 | `src/nodeBarPlugin.ts:15` |
| `@mini-canvas/canvas-render` | `useCanvasRender`、`useToolbarOffsets`、`RenderEvents` | 是 | `src/BottomBarHost.vue:10`，`src/NodeBottomBarOverlay.vue:35`，`src/NodeTaskOverlay.vue:30` |
| `@mini-canvas/kernel` | 工具词表、`PluginScope` | 是 | `src/barTypes.ts:13-21`，`src/toolActions.ts:15-17` |
| 其它插件生产源码 | 无 | — | 生产源码无指向其它插件包的 import |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc','nodeRegistry','themeRegistry']` | 硬 | `src/nodeBarPlugin.ts:229-230` |
| `node/bar` 注册场 | `registerBarAction` 走调用方 scope 落场；服务读全表 | 契约 | `src/nodeBarPlugin.ts:38,51-82,218-219` |
| `node/bar-applier` 注册场 | 每种节点类型一个写入器，重复注册抛错 | 契约 | `src/nodeBarPlugin.ts:39,222-227` |
| `nodeBar` 服务 | 列表 / 查动作 / 查写入器 / 读状态 | 契约 | `src/nodeBarPlugin.ts:51-91` |
| `nodeTask` 服务 | 启动、取消、刷新续查 | 契约 | `src/nodeBarPlugin.ts:118-216` |
| `tools` 服务 | `publishToolActions` 把工具表映射成动作，订阅安装/卸载同步 | 可选（没有工具就无动作） | `src/toolActions.ts:63-95` |
| `settings` | 读 `nodesDraggable` 判断抓手 | 可选 | `src/NodeBottomBarOverlay.vue:92-108` |
| `selection` | 只对“恰好选中一个”显示底栏 | 可选 | `src/NodeBottomBarOverlay.vue:49-76` |
| `ui` 目录 | 按名取 `select / toolParamField / toolParamGroup / mediaViewer` | 可选（缺目录则按钮/面板缺失） | `src/NodeBottomBar.vue:63-65`，`src/MediaPreviewOverlay.vue:24-28` |
| `overlay` 槽 | 注册底栏宿主、参考选择、媒体预览、任务覆盖层 | 契约 | `src/nodeBarPlugin.ts:238-270` |
| `bottomBar` 主题槽 | 注册默认底栏 `NodeBottomBar` | 契约 | `src/nodeBarPlugin.ts:251-252` |
| `ctx:ready` / `ctx:plugin-installed` | 刷新后恢复任务，避免空文档误判 | 契约 | `src/nodeBarPlugin.ts:284-300` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `.v2-card` DOM 类 | 测量选中节点卡片矩形，底栏跟着卡片摆放 | 高：主题换壳若改根类名，底栏位置全错 | `src/NodeBottomBarOverlay.vue:138-145` |
| `document.querySelector` | 仅通过 `flow.queryNodeEl` + 类名查节点 | 中：属于渲染层 DOM 契约 | 同上 |
| `requestAnimationFrame` | 跟随选中节点与视口逐帧测矩形 | 低：卸载时取消 | `src/NodeBottomBarOverlay.vue:150-173` |
| `setInterval` | 任务覆盖层刷新半径/计时 | 低：有清理 | `src/NodeTaskOverlay.vue:57,84,98-100` |
| `localStorage` / 固定 URL | 无 | — | 源码无命中 |

## 内部职责与风险

1. **注册糖是跨插件公共 API，但入口是插件包根。** 文本、图片、视频三个节点包直接 `import { registerBarAction, ... } from '@mini-canvas/plugin-bottom-bar'`（见对应节点页），`web2api-tools` 也直接 import 底栏类型（`packages/plugins/plugin-web2api-tools/src/web2apiPlugin.ts:29-30`）。这使底栏从“可选插件”变成编译期依赖。包注释本身也说“插件之间不互相 import，统一经 `ctx.get('nodeBar')`”（`src/nodeBarPlugin.ts:91-97`），现状与注释不一致。
2. **一个包六件事**：动作注册、任务运行时、运行状态、参考选择、全屏媒体预览、默认底栏皮。证据：`src/nodeBarPlugin.ts:233-270` 连续注册四条 overlay/主题；`src/NodeTaskOverlay.vue` 527 行；`src/ReferenceSelectOverlay.vue` 534 行；`src/NodeBottomBar.vue` 1486 行。底栏还把 `barPrompt / barValues / refOrder` 三个展示态字段写进各节点 data（`src/NodeBottomBar.vue:252,292-306,345-389`），这让“底栏状态”成为跨插件的数据契约。
3. **`publishToolActions` 的同步逻辑在包内直接改注册场**：安装/卸载事件都订阅（`src/toolActions.ts:95-96`），没有看到对返回函数的显式 dispose 约定。热装/卸载频繁时需验证是否会重复注册同 id（同 id 是替换，风险可控，但需测试）。
4. **`registerBarApplier` 同 kind 抛错**（`src/nodeBarPlugin.ts:223-226`）。好处是防止两支笔写同一节点；坏处是任何两个插件想给同一个 kind 写结果都会让后装插件直接失败，没有降级。
5. **默认底栏皮和底栏机制同包**。换皮虽然支持 `ctx.theme.add('bottomBar', ...)`，但默认实现、注册场、执行器在同一个包里，第三方只换皮也得依赖整个包。

## 单独装卸判断

- **不装底栏**：文本、图片、视频三个节点包会把动作注册整段跳过（`tryGet('nodeBar')` 为假），节点本身仍能显示、上传、裁剪；只是没有底部生成栏和任务进度。音频、3D、图片对比本来就不参与底栏，不受影响。
- **只装底栏、不装节点**：底栏宿主仍挂 overlay，但没有选中节点/没有动作，界面基本不出现；任务恢复扫到空文档，不报错（`src/nodeBarPlugin.ts:284-292`）。
- **卸载底栏**：动作与写入器随调用方 scope 回收；`nodeBar`/`nodeTask` 服务随底栏 scope 回收。节点包里的 `registerBar` 闭包仍会在后续安装事件里调用 `ctx.tryGet('nodeBar')`，返回空后继续等待；未看到泄漏证据，但属于“常驻监听”。
- **热装底栏**：节点包在 `ctx:plugin-installed` 里补注册（三个节点包同款）。这条路径有代码，缺测试。

## 建议改法

1. **最小改动：把注册糖与动作类型搬到 `canvas-base`（或独立 `canvas-bar-contract`）。** 节点包只 import 契约包；底栏实现注册场。这样不装底栏也能编译，`tryGet` 才真正是可选。验证：临时移除节点包对底栏的 dependency 后 typecheck 仍过。
2. **补一条跨插件生命周期测试。** 装节点 → 装底栏 → 断言动作出现；卸底栏 → 断言动作消失；再装底栏 → 断言只注册一次。现有测试覆盖同 id 替换与卸载（`src/__tests__/barRegistry.test.ts:37-95`），但没有真实节点包参与。
3. **拆出“媒体预览 + 参考选择”两个可选子插件。** 它们与底栏动作无直接关系，只是共用 overlay 槽。拆走后底栏包能显著变小。验证：不装子插件时底栏功能完整。
4. **给 `.v2-card` 定一个共享常量或 data 属性。** 主题生产、底栏消费，不要靠类名字符串。验证：换一个不叫 `.v2-card` 的主题壳时底栏仍能定位。

## 待验证

- `publishToolActions` 返回的同步函数在插件卸载时是否真的停止订阅；代码只看到 `ctx.on` 没有显式 `dispose` 收集。
- `registerBarApplier` 同 kind 抛错在“两个主题都提供 image applier”时会不会让热装失败；未构造实验。
- 底栏 overlay 的 order 40/41/42 与视频包 order 43 的层叠顺序只在代码里，未做真机遮挡验证。
