# 渲染宿主层迁出 canvas-core-v2 —— 依赖拓扑实证

检索日期：2026-09-05。全部 import 证据取自工作区实际文件，非记忆。

---

## 一、canvas-core-v2 内待迁文件与内部依赖

### 1. `src/host/CanvasHost.vue`（整份读毕）

| 待迁文件 | import 来源 | 属内核纯逻辑(core/services)? | 依赖可否随迁/需留内核 |
|---|---|---|---|
| CanvasHost.vue | `vue`（markRaw/onBeforeUnmount/onMounted/provide/reactive/ref/shallowRef） | 否(框架) | 随迁 |
| | `@vue-flow/core`（`VueFlow`, `type Connection/NodeMouseEvent/NodeDragEvent`） | 否(vue-flow) | 随迁（新增依赖） |
| | `../core/registry/nodeRegistry`（`NodeRegistry`） | **是(core)** | 留内核，靠包依赖 |
| | `../core`（`type PluginModule/Disposable`） | **是(core)** | 留内核 |
| | `./createMiniCanvasHost`（createMiniCanvasHost, `type CanvasHostHandle/MiniCanvasApi`） | 内核逻辑门面(见下) | **若随迁则渲染包依赖内核** |
| | `../services/storage/types`(`StorageAdapter`)、`../services/storage/memoryAdapter`(`MemoryStorageAdapter`) | **是(services)** | 留内核 |
| | `../services/nodeStore`(`type CanvasNode`) | **是(services)** | 留内核 |
| | `../contracts/nodeRegistryKey`（`NodeWrite` type + NODE_REGISTRY_KEY/NODE_WRITE_KEY） | 令牌(可随迁) | 随迁(它本身值 import 用) |
| | `../contracts/canvasParamKey`（CANVAS_PARAMS_KEY, `type CanvasParams`） | 令牌 | 随迁 |
| | `../contracts/contentBridge`（HOST_KEY） | 令牌 | 随迁 |
| | `../contracts/edgeContext`（EDGE_VISUAL_KEY/EDGE_SELECTION_KEY, `type EdgeVisual`） | 令牌 | 随迁 |
| | `../services/connection`（validateConnection/typeConnectionDef） | **是(services)** | 留内核 |
| | `./canvasHostCore`（assembleTheme/edgeId/nodesFromStore/pruneDanglingEdges/DEFAULT_EDGE_VISUAL/DEFAULT_HANDLE_VISUAL） | 逻辑门面 | 随迁(与本组件同包) |

**结论：CanvasHost.vue 确实依赖 createMiniCanvasHost**（import 行 28-32）。它也大量依赖内核 runtime services（NodeRegistry、StorageAdapter/MemoryStorageAdapter、connection、nodeStore），因此渲染包**必须依赖内核包**。

### 2. `src/host/canvasHostCore.ts`

| 文件 | import | 属内核纯逻辑? |
|---|---|---|
| canvasHostCore.ts | `type NodeStoreService/CanvasNode` from `../services/nodeStore` | 是，**仅 type** |
| | `type ThemeRegistry` from `../core/registry/themeRegistry` | 是，**仅 type** |
| | `type EdgeVisual` from `../contracts/edgeContext`、`type CanvasParams` from `../contracts/canvasParamKey` | 令牌 type |

全部 **type-only**，不拉 vue-flow/vue 运行时。文件头注释自述"不 import @vue-flow/core、不 import Vue 运行时"。

### 3. `src/host/createMiniCanvasHost.ts`

| 文件 | import | 属内核纯逻辑? |
|---|---|---|
| createMiniCanvasHost.ts | `Context` + `type PluginModule` from `../core` | 是，**runtime**(new Context) |
| | `NodeRegistry` from `../core/registry/nodeRegistry` | 是，runtime |
| | `ThemeRegistry` from `../core/registry/themeRegistry` | 是，runtime |
| | `SaveServiceImpl` from `../services/storage/SaveService` | 是，runtime |
| | `NodeStore`, `type CanvasNode` from `../services/nodeStore` | 是，runtime |
| | `type StorageAdapter` from `../services/storage/types` | 是 type |
| | `Selection` from `../services/selection` | 是，runtime |
| | `History` from `../services/history` | 是，runtime |
| | `CommandRegistry` from `../services/command` | 是，runtime |
| | `NodeFactory` from `../services/nodeFactory` | 是，runtime |

**它是纯逻辑装配门面**：无 vue-flow、无 Vue 运行时 import，可 Node 单测。但它 runtime 依赖大量 core/services + core。若它随渲染包走，渲染包 runtime 依赖内核。

### 4. `src/contracts/*`

| 文件 | import | 依赖 |
|---|---|---|
| canvasParamKey.ts | `type InjectionKey` from `vue` | 仅 type；**不依赖内核** |
| contentBridge.ts | `type InjectionKey/Ref` from `vue` | 仅 type；不依赖内核；注释用 `any` 规避反向 import |
| edgeContext.ts | `type InjectionKey/Ref` from `vue` | 仅 type；不依赖内核 |
| edgeGeometry.ts | （无 import） | **零依赖纯函数** |
| nodeRegistryKey.ts | `type InjectionKey` from `vue`；`type NodeRegistry` from `../core/registry/nodeRegistry` | 仅 type 引用内核类型 |

**nodeRegistryKey.ts 是唯一 type 引用内核 contract**（`type NodeRegistry`）。5 个文件全为"仅 type 级 import vue"或零依赖，不把 vue 运行时拉进 Node 单测。

### 5. `src/vueFlowBridge.ts`
只 re-export：
- 值：`Handle, Position, getBezierPath, useVueFlow`（from `@vue-flow/core`）
- 类型：`EdgeProps, NodeProps`（from `@vue-flow/core`）

注释明确"精选 re-export，不 export *"。`@vue-flow/core` 是内核依赖。

### 6. `src/index.ts` 顶层导出
- `export * from './core'` / `'./services'` —— 纯逻辑面
- contracts 令牌：`HOST_KEY, NODE_REGISTRY_KEY, NODE_WRITE_KEY(type NodeWrite), CANVAS_PARAMS_KEY(type CanvasParams), EDGE_VISUAL_KEY/EDGE_SELECTION_KEY(type EdgeVisual/EdgeSelection)`
- `export * from './vueFlowBridge'`（vue-flow re-export）
- host：`createMiniCanvasHost` + types；`CanvasHost`；`type FlowNode/ThemeAssembly`（from canvasHostCore）

**内核内除 index.ts 自身外，没有任何 core/services/core 文件消费 host/contracts/vueFlowBridge**（grep 证实：反向引用只出现在 index.ts 的 re-export 行）。即这些可整块剥离，不形成内核反向耦合。

---

## 二、跨包消费点

### 1. 谁 import `@mini-canvas/canvas-core-v2/contracts/*`（尤其 edgeGeometry）
全仓唯一命中：
- `packages/plugins/plugin-theme-default/src/CustomEdge.vue`
  - import { Position, getSourcePosition, getTargetPosition, buildEdgePath, sampleEdgePath, findClosestPointOnPath, type EdgeType, type EdgeAppearance } from `@mini-canvas/canvas-core-v2/contracts/edgeGeometry`（**路径几何纯函数，运行时值 import**）
- theme-default **没有本地 edgeGeometry 副本**，完全复用内核那版。

### 2. plugin-theme-default 各文件 import 内核的符号

| 文件 | 从 `@mini-canvas/canvas-core-v2`(顶层) import | edgeGeometry? |
|---|---|---|
| BaseNode.vue | `useVueFlow, Position` + `resolveSegment, NODE_REGISTRY_KEY, NODE_WRITE_KEY, CANVAS_PARAMS_KEY`(行3-5) + `type NodeWrite` + `type CanvasParams` | 否 |
| MovingHandle.vue | `Handle, Position`（来自 vueFlowBridge re-export） | 否 |
| CustomEdge.vue | `useVueFlow` + `type EdgeProps` + `EDGE_VISUAL_KEY, EDGE_SELECTION_KEY, type EdgeVisual` | **是**（走 contracts/edgeGeometry 子路径） |
| DefaultBackground.vue | `useVueFlow` | 否 |
| index.ts | `registerThemeSlot` + `type PluginModule` | 否 |

**任何插件 src 都不直接 import `@vue-flow/core`**（grep 证实）——所有 vue-flow 原语都经内核 vueFlowBridge re-export 中转。theme-default 把 `@vue-flow/core`/`vue` 放 **peerDependencies**，把 `@mini-canvas/canvas-core-v2` 放 **devDependencies**。

### 3. plugin-node-text / node-image 的 content .vue 是否消费令牌
- `plugin-node-text/src/TextContent.vue`：`import { HOST_KEY } from '@mini-canvas/canvas-core-v2'`（唯一令牌，运行时值）。注释自述"只 import 内核 HOST_KEY，不反向依赖 demo-web"。
- `plugin-node-image/src/ImageContent.vue`：**只 defineProps 无任何 import**（零令牌依赖）。
- 两插件 setup 文件只 import 内核纯逻辑面：`registerNodeType` + `type PluginModule/NodeStoreService/SaveService/NodeFactoryService`。

### 4. 内核内除待迁文件外是否还有别处消费这些令牌/canvasHostCore
grep 反向结果：**无**。core/services 不触碰 host、contracts、vueFlowBridge。消费方全部在：
- 内核 `index.ts`（re-export 中枢）
- 插件包（theme-default / node-text）
- 各 demo-web（见下）

即这些令牌的唯一"真实提供者"是 `CanvasHost.vue`（provide），唯一"真实消费者"是插件渲染组件 + content 组件。挪进渲染包不会漏消费者。

### 5. demo 消费
- **plugin-theme-default/demo-web/App.vue**：`import { CanvasHost } from '@mini-canvas/canvas-core-v2'` + `type CanvasNode`；用 `:plugins=[themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]`。
- **canvas-core-v2/demo-web/CanvasDemo.vue**：`import CanvasHost from '../src/host/CanvasHost.vue'`（相对源码）+ `DEFAULT_EDGE_VISUAL/DEFAULT_HANDLE_VISUAL` from `../src/host/canvasHostCore`；import 各业务插件包。
- **canvas-core-v2/demo-web/plugin-load.ts / plugin-load-dev.ts**：`import { createMiniCanvasHost } from '@mini-canvas/canvas-core-v2'`（dev.ts 另 + NodeRegistry）。这两个是"最小宿主 + window.MiniCanvas + 热装 UMD/源码插件"验证页，**用 createMiniCanvasHost 而非 CanvasHost**，会消费渲染包（若 host 门面随迁）。
- **plugin-load-dev-app.vue**：`import { HOST_KEY, NODE_REGISTRY_KEY } from '@mini-canvas/canvas-core-v2'`。

---

## 三、测试面

### canvas-core-v2/src/host/__tests__/
| 测试 | import | 归类 |
|---|---|---|
| canvasHostCore.test.ts | `NodeStore`(services), `ThemeRegistry`(core)，`assembleTheme/edgeId/nodesFromStore/pruneDanglingEdges/DEFAULT_*` from `../canvasHostCore` | **纯逻辑单测**（只依赖 core/services type+inst，无 vue-flow/vue） |
| createMiniCanvasHost.test.ts | `createMiniCanvasHost` from `../createMiniCanvasHost`, `MemoryStorageAdapter`, `type PluginModule` | **纯逻辑单测** |
| fullchain.test.ts | `createMiniCanvasHost` + `MemoryStorageAdapter` + `nodeImagePlugin/nodeTextPlugin/canvasCommandsPlugin`(插件包) + services | **集成/纯逻辑**（Node 环境无 DOM） |

这三个测试都是 Node 环境、无 Vue/vue-flow 运行时，归"纯逻辑"侧。canvasHostCore / createMiniCanvasHost 若随迁，两个纯逻辑测试也应随迁（它们 import 相对路径，需改写为包导入）。

### contracts/__tests__/edgeGeometry.test.ts
测 `edgeGeometry` 纯函数：Position/getSourcePosition/getTargetPosition/normalizePosition/buildEdgePath/sampleEdgePath/findClosestPointOnPath/EdgeAppearance —— 锚定金标准 §6.3 路径算法，零 Vue 依赖。edgeGeometry 若随迁，此测试同迁。

### 插件包测试
theme-default / node-text / node-image / commands 四包 **均无任何 .test/.spec 文件**。

---

## 四、构建/依赖方向结论

### A. 渲染包是否依赖内核 `@mini-canvas/canvas-core-v2`？
**是，必须依赖（runtime）。** 依据：
- CanvasHost.vue runtime import：NodeRegistry、MemoryStorageAdapter、connection(validateConnection/typeConnectionDef)、nodeStore type——全在内核。
- CanvasHost.vue import `./createMiniCanvasHost`（CanvasHost.vue 行 28-32 实证），后者 runtime new Context/NodeStore/SaveService/Selection/History/CommandRegistry/NodeFactory/NodeRegistry/ThemeRegistry（全内核 runtime）。
- canvasHostCore / createMiniCanvasHost 若随迁，其 type 依赖(NodeStoreService/CanvasNode/ThemeRegistry)也在内核。

→ 渲染包 = `@mini-canvas/canvas-render`，deps 含 `@mini-canvas/canvas-core-v2`（runtime）+ `@vue-flow/core` + `vue`。createMiniCanvasHost 被 CanvasHost 调用，故不能把渲染包做成"不依赖内核"的叶子，除非连 createMiniCanvasHost 的装配逻辑也整体重写（不建议，破坏现有 window.MiniCanvas 装配面）。

### B. theme-default 该依赖哪个包？是否把 vueFlowBridge + 渲染令牌一并挪进渲染包？
theme-default 现状对内核的 runtime 依赖可分两类：
1. **渲染专属**：vueFlowBridge re-export(useVueFlow/Handle/Position/EdgeProps) + 令牌(HOST_KEY/NODE_REGISTRY_KEY/NODE_WRITE_KEY/CANVAS_PARAMS_KEY/EDGE_VISUAL_KEY/EDGE_SELECTION_KEY) + edgeGeometry + CanvasHost。
2. **纯逻辑面**：registerThemeSlot、PluginModule（来自 core/services，不渲染）。

theme-default 是"纯渲染皮"（nodeShell/edge/background/edgeDefaultType），其运行时只碰第 1 类。**建议**：vueFlowBridge + 5 个令牌 + edgeGeometry + CanvasHost/createMiniCanvasHost/canvasHostCore 一并搬入渲染包，theme-default 改依赖渲染包（拿 vue-flow 原语 + 令牌 + edgeGeometry）；`registerThemeSlot/PluginModule` 仍留内核、经内核包拿。这样 theme-default 需要同时依赖 `@mini-canvas/canvas-render`（渲染面）与 `@mini-canvas/canvas-core-v2`（registerThemeSlot/PluginModule type）。

⚠️ 注意主题 default 是 **peerDeps 包**：`@vue-flow/core`/`vue` 在 peer。若渲染包替内核提供 vue-flow re-export，渲染包也要把 `@vue-flow/core`/`vue` 放 peer，避免双实例。

### C. 内核挪走后剩什么（最终导出面）
保留**纯逻辑**，去掉一切浏览器/vue-flow/令牌装配：
- core：Context/Scope/topo/types、registry(nodeRegistry/nodeRenderer/registerNodeType/registerThemeSlot/themeRegistry)、EventBus。
- services：command/connection/history/nodeFactory/nodeStore/selection/storage(+各自 registry key 的"类型面"如 NodeStoreService/SelectionService/CommandService/HistoryService/NodeFactoryService/SaveService、CanvasNode)。
- 需**移除/移交**的顶层导出：HOST_KEY、NODE_REGISTRY_KEY、NODE_WRITE_KEY、CANVAS_PARAMS_KEY、EDGE_VISUAL_KEY、EDGE_SELECTION_KEY、`export * from './vueFlowBridge'`、createMiniCanvasHost(+types)、CanvasHost、FlowNode/ThemeAssembly、以及整个 contracts/ 目录(edgeGeometry/edgeContext/canvasParamKey/contentBridge/nodeRegistryKey 的令牌面)。
- 内核内部对这些类型的消费（registry 传 `type NodeRegistry`、nodeStore 类型）仅 type，改从内核自持类型即可，**无 runtime 反向依赖**。

### D. 循环依赖隐患
- 渲染包 → 内核（get createMiniCanvasHost/NodeStore…）：单向，安全。
- theme-default → 渲染包（令牌/vue-flow/edgeGeometry/CanvasHost）+ 内核（registerThemeSlot/PluginModule）：theme-default 经注入 key(provide/inject)、经 ctx 调服务，**不反向 import 渲染包实现**——无循环。
- plugin-node-text(TextContent → HOST_KEY)、plugin-node-image、commands：若令牌随迁到渲染包，TextContent 得改依赖渲染包拿 HOST_KEY；ImageContent/commands 只依赖内核纯逻辑(registerNodeType/PluginModule)，**无需改**。
- **反向检查（防真环）**：渲染包不许 import 任何 plugin-*；内核不许 import 渲染包。内核 services/core 已证实不触碰 host/contracts/vueFlowBridge，天然安全。唯一要守的约束：`contracts/nodeRegistryKey.ts` 的 `type NodeRegistry` 引用若随迁会变成"渲染包→内核"type 依赖——可接受（单向），或改用结构类型/内核再导出来避免类型层环。

结论：**无既有运行时循环；新方向全部单向（渲染→内核、插件→渲染+内核）**。真正的类型环隐患仅在 nodeRegistryKey 对 NodeRegistry 的 type import（若把该令牌独立搬出而不带内核类型时出现），建议渲染包依赖内核来消除。

---

## 五、根项目 src/
- 根 package.json deps 只依赖 `@mini-canvas/canvas-core`(v1)，**不含 canvas-core-v2**。
- `grep -rn "canvas-core-v2|CanvasHost|createMiniCanvasHost|HOST_KEY|vueFlowBridge" src/` → **零命中**。根 src/（App.vue/main.ts/views/router）是 v1 主项目。
- 根 vite.config.ts 无 MPA 多入口、无 demo 别名——只 alias `@`→`./src`；根 index.html 只挂 `/src/main.ts`。
- 各包 demo 各自独立（theme-default/demo-web 与 canvas-core-v2/demo-web 各有自己的 main.ts+index.html+vite config），根项目不消费 CanvasHost。

**结论：根项目不受本次迁移影响，无需改动。**
