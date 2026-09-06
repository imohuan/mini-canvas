# plugin-theme-default 重构调研：canvas-render / canvas-core-v2 能力盘点

> 目的：为把 `@mini-canvas/plugin-theme-default` 的 `BaseNode.vue` / `CustomEdge.vue` / `MovingHandle.vue`
> 对齐 v1 `@mini-canvas/canvas-core` 的 Decoration 实现（端口按节点类型能力显隐、3D 连接反馈、非法连接气泡、
> resize 写回），调研 plugin 能拿到的"最新 API"。本文件**只调研不写代码**，供据此写移植方案。
>
> 包依赖事实（`packages/plugins/plugin-theme-default/package.json`）：
> - 运行时实现 import 的：`@mini-canvas/canvas-render`（peer）、`@vue-flow/core`（peer 1.48.2）、`vue`。
> - 源码里其实还直接 import 了 `@mini-canvas/canvas-core-v2`（`resolveSegment`、`type CanvasNode`…）
>   与 `@mini-canvas/canvas-base`（`type ConfigSchema` 等）——但这两者当前只在 **devDependencies**。
>   移植若要新增内核类型/函数依赖，需注意：内核目前只当 devDep，运行时 export 的 `.` 入口没有 re-export 内核，
>   直接 import 内核在"已发布包"场景会断。**风险点 0**。

---

## 0. 一张图：插件侧（BaseNode/CustomEdge）实际能 import / inject 到的东西

渲染插件组件（壳/边/content）都在 `<CanvasHost>` 的渲染子树里运行，最统一、推荐的取数入口是
`useCanvasRender()`（新代码首选）；它把 6 个旧 `*_KEY` 收拢成一个对象。单令牌由内层 `CanvasSurface` provide。

```ts
// packages/canvas-render/src/contracts/renderContext.ts  L33-48
interface CanvasRenderContext {
  ctx: Context          // 内核上下文：ctx.get('nodeStore'/'nodeRegistry'/'edgeStore'/'selection'…)、ctx.text 直访服务
  host: CanvasHostHandle// 宿主句柄：ctx 超集，含 nodeStore/edgeStore/selection/command/history/nodeRegistry/themeRegistry/save/stop
  registry: NodeRegistry// 展示注册表：node type → 各段组件（content/title/top-toolbar/bottom-toolbar）
  nodeWrite: NodeWrite  // 标题就地重命名写回（或任意 data patch 写回）
  handleParams: CanvasParams // 浮动端口外观（reactive，改属性实时生效）
  edgeVisual: Partial<EdgeVisual> // 边外观（reactive）
  edgeSelection: EdgeSelection   // selectedNodeIds / selectedEdgeIds（含 Ref）
}
```

取法：`const { ctx, registry, nodeWrite, handleParams, edgeVisual, edgeSelection } = useCanvasRender()`。
`useCanvasRender()` 在宿主外调用会抛错（`renderContext.ts` L57-63）。也保留 6 个独立令牌可 inject（兼容旧代码）。

- BaseNode 目前已用：`registry, nodeWrite, handleParams` + `useVueFlow()`（拿 `viewport.zoom`）。
- CustomEdge 已用：`edgeVisual, edgeSelection` + `useVueFlow().removeEdges`。
- **关键缺口（本调研核心结论）**：canvas-render 的 `CanvasRenderContext` **没有暴露任何"连接进行中"的响应式状态**
  （无 isConnecting / 无 activeConnection / 无 hoverNode(valid/invalid 候选) / 无 suppressHandles / 无 temp 边）。
  所以 v1 里 BaseNode 的"3D 连接反馈 + 非法气泡 + 拖线时抑制端口按钮"在 v2 插件体系里**没有现成数据源**，属于要补的缺口（详见 §7/§9）。

---

## 1. `canvas-render/src/index.ts`（对外出口总表）

`packages/canvas-render/src/index.ts`。全部导出（已看过，含行号）：

| export | 来源文件 | 说明 |
|---|---|---|
| `HOST_KEY` | contracts/contentBridge | content 组件拿宿主 Ref（旧式） |
| `NODE_REGISTRY_KEY` / `NODE_WRITE_KEY` / `type NodeWrite` | contracts/nodeRegistryKey | 段组件注册表令牌 / 数据写回回调 |
| `CANVAS_PARAMS_KEY` / `type CanvasParams` | contracts/canvasParamKey | 浮动端口尺寸 |
| `EDGE_VISUAL_KEY` / `EDGE_SELECTION_KEY` / types | contracts/edgeContext | 边外观/选中 |
| `RENDER_CONTEXT_KEY` / `useCanvasRender` / `type CanvasRenderContext` | contracts/renderContext | 统一上下文（新代码首选） |
| `export * from './vueFlowBridge'` | vueFlowBridge | 精选 @vue-flow/core 原语 |
| `default CanvasHost` | host/CanvasHost.vue | 官方宿主组件 |
| types `SettingsPanelSource` 等 | components/settingsPanelTypes | 设置面板数据契约 |
| `SettingsHost` / `settingsSourceFrom` | components/* | 设置面板宿主/适配 |
| `SlotHost` | components/SlotHost.vue | 通用 UI 槽渲染 |
| `FlowNode` / `ThemeAssembly` | host/canvasHostCore | 渲染/装配类型 |
| `nodesFromStore` / `pruneDanglingEdges` / `assembleTheme` / `edgeId` / `DEFAULT_EDGE_VISUAL` / `DEFAULT_HANDLE_VISUAL` | host/canvasHostCore | 纯逻辑 helper（见 §8） |
| `createMiniCanvasHost` / `MiniCanvasOptions` / `MiniCanvasApi` / `CanvasHostHandle` | host/createMiniCanvasHost | 宿主门面（见 §8） |
| `createPluginManager` + types | host/pluginManager | 统一安装句柄 |
| `createCoalescer` / `rafScheduler` / `manualScheduler` | utils/coalesce | 合帧工具 |

注意：**canvas-render 不 re-export canvas-core-v2**。要 `NodeRegistry` / `resolveSegment` / `validateConnection` /
`Context` 类型等必须直接 `import '@mini-canvas/canvas-core-v2'`（plugin-theme-default 目前确实这么干了）。

---

## 2. 统一渲染上下文 `useCanvasRender`（renderContext.ts）

上面已列结构。补细节：
- `ctx`、`host` 是**裸值**（非 Ref），因为 `CanvasSurface` 在 boot 完成后才挂载（CanvasHost `v-else`），provide 时必已就绪。
- `registry` 是内核展示注册表（NodeRegistry 实例，`CanvasHost.vue` L114 新建并传入 boot）。
- `nodeWrite` 缺省实现 = 改 nodeStore data + 落盘（`CanvasHost.vue` L118-126）。
- `handleParams`/`edgeVisual` 是 reactive（父级传或内部 DEFAULT reactive），**属性改动实时生效**（改即被 computed 追踪）。
- `edgeSelection.selectedNodeIds` 是 `Ref<ReadonlySet<string>>`，由内核 Selection 的 onChange 投影更新（`CanvasHost.vue` L145-149、L323）。
- 旧 6 令牌仍在 `CanvasSurface.vue` L79-84 逐个 provide（兼容未迁移组件），指向同一批引用。

> 给 BaseNode 的结论：**节点类型"能力信息"不在这层**。registry 只给"段组件"，没有 canReceiveInput/canProduceOutput。
> 详见 §6/§8 —— 能力的唯一权威源在内核 `ctx.get('nodeStore').types.get(type)`。

---

## 3. `CanvasParams`（canvasParamKey.ts）—— 浮动端口外观字段

`packages/canvas-render/src/contracts/canvasParamKey.ts`：

```ts
interface CanvasParams {
  handleRadius: number        // 浮动端口半径 px，默认 86
  handleRestOffset: number    // 圆球离区归位偏移 px，默认 36
  handleCursorGap: number     // 圆球跟鼠标错开 px，默认 24
  handleButtonSize: number    // 圆球尺寸 px，默认 32
  handleOverlap: number       // 半圆向节点内侧裁剪 px，默认 16
}
```
默认常量 `DEFAULT_HANDLE_VISUAL`（canvasHostCore.ts L102-108）同值。`handleParams` 通过 `useCanvasRender()` 直接给。
BaseNode 已把这 5 个字段喂给 MovingHandle。**v1 同名字段全都有**，无缺口；MovingHandle 尺寸来源充分。

---

## 4. `EdgeVisual` / `EdgeSelection`（edgeContext.ts）

```ts
interface EdgeVisual {
  edgeType?: 'bezier'|'straight'|'step'|'smoothstep'
  edgeLineWidth?: number; edgeColor?: string; edgeDashed?: boolean
  edgeAnimated?: boolean; edgeMarkerEnd?: boolean; edgeMarkerSize?: number
  edgeVisible?: boolean; edgeGlowEnabled?: boolean
  edgeGlowIntensity?: number; edgeGlowColor?: string
}
interface EdgeSelection {
  selectedNodeIds: Ref<ReadonlySet<string>>
  selectedEdgeIds: Ref<ReadonlySet<string>>
}
```
CustomEdge 已消费两者。注意 **EdgeSelection 只含"选中集合"**，不含任何"连接进行中 hover"态（v1 里"相连节点被选即高亮流光"用它就够，CustomEdge 已实现 `isHighlighted` 逻辑）。

---

## 5. `nodeRegistryKey.ts` / `NodeWrite` —— registry 到底给什么能力

`packages/canvas-render/src/contracts/nodeRegistryKey.ts`：
- `NODE_REGISTRY_KEY` 注入的是内核 `NodeRegistry`（见 §6）。
- `NodeWrite = (id: string, patch: Record<string, unknown>) => void` —— 宿主注入的数据写回回调。

**registry 只是"段组件注册表"**，不是能力注册表。关键判断（回答问题 6 问的"是否提供 get 节点类型定义含
是否可输入输出/canReceiveInput"）：

> 否。`NodeRegistry`（内核 nodeRegistry.ts）只存 `type → { type, segments: {content/title/top-toolbar/bottom-toolbar} }`，
> 另加"段内多 occupant 叠加"能力。它**不存** inputs/outputs/大小/label/canReceiveInput/canProduceOutput 这些"能力/元数据"。
> 这些能力只在内核 `NodeStore`（见 §8）里。二者职责：NodeRegistry=展示（组件），NodeStore.types=数据+连接约束。

---

## 6. `vueFlowBridge.ts` —— re-export 的 @vue-flow/core 清单

`packages/canvas-render/src/vueFlowBridge.ts`（全文 16 行），**只精选这些**，不 `export *`：

```ts
export { Handle, Position, getBezierPath, useVueFlow } from '@vue-flow/core'
export type { EdgeProps, NodeProps } from '@vue-flow/core'
```

即插件能拿到的 vue-flow 原语只有：`Handle`、`Position`、`getBezierPath`、`useVueFlow`，类型 `EdgeProps/NodeProps`。

**缺失项（对齐 v1 需要但 bridge 没导出的 @vue-flow/core 能力）：**
- `ConnectionLineProps` 类型（v1 useCanvasConnection.ts L27 import 它；ConnectionLineProps 描述 `#connection-line` 槽 props：sourceNode/targetX/targetY/sourceHandleId…）
- 贝塞尔以外路径工具（straight/step/smoothstep 的 path 函数，如 `getSmoothStepPath`/`getStraightPath`）；当前 v2 CustomEdge 用**自研 edgeGeometry**（§10），不依赖这些，没问题。
- v1 `useCanvasConnection.ts` 依赖的 `OnConnectStartParams` 类型。
- 需要完整 VueFlow 的宿主 demo 仍直接 import `@vue-flow/core`（不走 bridge），插件侧被限定在这 4+2。

`useVueFlow()` 返回的实例（来自 @vue-flow/core 1.48.2）里可用：`viewport`、`getNodes/getEdges`、`removeEdges/addEdges`、
`updateNode`、`screenToFlowCoordinate` 等（CustomEdge 已用 removeEdges；v1 BaseNode 用 vf.updateNode 写 resize）。
**plugin-theme-default 自己也是 peer 依赖 @vue-flow/core，可以直接再 import**，但要小心"双实例"（bridge 与直 import
指向同一模块实例时无碍——同版本 pnpm 单副本；bridge 注释也说明 re-export 不产生新副本）。移植若要 ConnectionLineProps，
建议给 vueFlowBridge 补导出一个 `export type { ConnectionLineProps, OnConnectStartParams }` 更整洁。

---

## 7. `CanvasHost.vue` + `CanvasSurface.vue` —— provide 了什么、nodeType 如何映射、onConnect 在哪

### CanvasHost.vue（装配 + 通用交互，厚）
职责见文件头注释。要点：
- **新建并持有展示 registry**（L114 `new NodeRegistry()`），注入 boot。
- **nodeType → 组件映射**（L173-186 `applyTheme()`）：从 themeRegistry 取 `nodeShell`，`markRaw` 后把**所有 store 业务 type
  都映射到同一个 shell 组件**：
  ```ts
  nodeTypes.value = {}
  for (const t of asm.nodeTypes) nodeTypes.value[t] = shell   // 每个 type 同一 BaseNode 壳
  ```
  即**壳是"所有 type 共用一个 BaseNode"**，type 只作 registry 查段的 key（BaseNode 里 `resolveSegment(registry, props.type,'content')`）。
  边 `edgeTypes = { custom: markRaw(edge) }`；`edgeDefaultType` = theme 的 edgeDefaultType（theme-default 注册 'custom'）。
  **没有"某 type 用不同 content 渲染机制"之外的任何差异化**——差异化完全靠段组件。
- **onConnect**（L247-264）：`onConnect` 里调 `isValidConnection(conn)` → 通过则 `history.withRecord` + `edgeStore.addEdge`。
- **isValidConnection**（L236-245）：只返回 `boolean`，**丢弃校验 reason**（详 §9 缺口）。
  ```ts
  function isValidConnection(conn) {
    ...
    const res = validateConnection({source,sourceHandle,target,targetHandle},
      { nodes: map, edges: edges.value, getTypeConn: (t) => typeConnectionDef(h.nodeStore.types.get(t)) })
    return res.ok   // reason 被丢弃
  }
  ```
- 提供 `@ready`(host) / `@context-menu` / `@boot-error` / `@plugin-issue` emits；暴露 `host/api/manager/ready/bootErrorText`。
- 键盘 Delete/Ctrl+Z（L267-285），选中同步（L228 onNodeClick → `selection.set`），拖拽落盘（onNodeDragStop L213）。
- 订阅插件热装热卸 → `applyTheme()` + `nodeEpoch++` 强制 VueFlow 重挂（L335-349）。
- 生命周期：boot 前 booting，失败 bootError；booting 时**不挂 CanvasSurface**（v-else）。

### CanvasSurface.vue（渲染子树宿主，薄）
- **真正 provide RENDER_CONTEXT_KEY 的地方**（boot 后裸值，L67-76），并兼容 provide 旧 6 令牌（L79-84）。
- 内部 `一个 <VueFlow>`（L89-104）：
  - 绑定了 **这些事件**：`@connect`、`@node-click`、`@node-drag-stop`、`@pane-click`、`@node-context-menu`、`@pane-context-menu`。
  - `:is-valid-connection`、`:min-zoom/:max-zoom`、`:node-types/:edge-types`、`:key="nodeEpoch"`。
  - **没有** `@connect-start` / `@connect-end` / `@connect-stop`，**没有** `#connection-line` 插槽，**没有** `connection-mode`/`connection-radius`。
  - 即 VueFlow 拖线阶段完全是原生默认：没有临时边吸附、没有 hover 反馈态。→ **缺口**（§9）。
- 渲染背景 `<component :is="backgroundComp" v-if>`（theme-default 的 DefaultBackground）。
- overlay UI：`<SlotHost slot="overlay"/>` + 父级 `#ui`/默认槽透传。

> 结论（回问题 7/11）：一个节点 → 全 type 共用 BaseNode 壳；壳内按 `props.type` 经展示 registry 查 content/title 等段组件。
> "连接处理/onConnect" 在 CanvasHost（写 edgeStore + 历史 + 落盘）。**连接拖拽阶段的 3D 反馈 / 非法气泡 / 端口抑制 / 临时边吸附
> 目前无处驱动，需在 canvas-render 层补一个连接状态机（类 v1 useCanvasConnection），或给 CanvasRenderContext 增加连接态字段。**

---

## 8. `canvasHostCore.ts` —— nodesFromStore / ThemeAssembly / 默认外观

`packages/canvas-render/src/host/canvasHostCore.ts`（纯逻辑，无 Vue/无 vue-flow import）：

```ts
interface FlowNode { id: string; type: string; position: {x,y}; data: Record<string, unknown> }
function nodesFromStore(store: NodeStoreService): FlowNode[]
  // store.getNodes().map(n => ({ id:n.id, type:n.type, position:{...}, data:{...n.data} }))  // data 浅拷贝

function pruneDanglingEdges(edges, aliveNodeIds)  // 删节点清悬挂边

interface ThemeAssembly {
  nodeShell: unknown; edge: unknown; background: unknown
  edgeDefaultType: string; nodeTypes: string[]
}
function assembleTheme(theme: ThemeRegistry|undefined, storeTypes): ThemeAssembly
  // shell = theme.get('nodeShell'); edge=theme.get('edge'); background=theme.get('background')
  // edgeDefaultType = theme.get('edgeDefaultType') ?? 'custom'; nodeTypes=[...storeTypes]
  // storeTypes 来自 host.nodeStore.types.keys()（CanvasHost L176）

DEFAULT_EDGE_VISUAL  // 见 §4 默认值
DEFAULT_HANDLE_VISUAL // handleRadius 86 etc
function edgeId(source, target) { return `e-${source}-${target}` }
```

`nodesFromStore` 关键语义：**FlowNode.type = 业务 type，data = 节点 data 的浅拷贝**。渲染层 nodes ref 每变化整体替换。
**不注入默认尺寸**：CanvasNode 没有 w/h 字段（data 里也无 cardWidth/cardHeight），FlowNode 无 dimensions/width/height →
v2 卡片尺寸由 CSS 内容撑开（BaseNode `.v2-card { min-width:120px; min-height:40px }`），无显式尺寸模型 → **resize 无锚点**（§11）。

---

## 8b. `createMiniCanvasHost.ts` —— CanvasHostHandle 全集（BaseNode 能经 ctx/host 够到的一切）

`CanvasHostHandle`（createMiniCanvasHost.ts L65-81）：
```ts
interface CanvasHostHandle {
  ctx: Context            // 根内核上下文
  save: SaveServiceImpl
  nodeStore: NodeStore    // 节点数据 + types(含 inputs/outputs) —— 能力权威源（见下）
  edgeStore: EdgeStoreService
  nodeRegistry: NodeRegistry
  themeRegistry: ThemeRegistry
  selection: SelectionService
  command: CommandService
  history: HistoryService
  nodeFactory: NodeFactoryService
  stop(): void
}
```
BaseNode 在渲染子树里拿 `useCanvasRender().ctx` 就是同一个 `host.ctx`（CanvasSurface provide 的是 `host.ctx`，renderContext.ts L35 也给了 host）。所以 `ctx.get('nodeStore')` 与 `host.nodeStore` 同实例。

---

## 8c. 内核 `canvas-core-v2` 关键服务（plugin 经 ctx 可取 / 已 import 用）

### NodeStore（nodeStore.ts）—— **能力（inputs/outputs）的唯一权威源**
```ts
interface CanvasNodeType {   // nodeStore.ts L19-26
  type: string; label: string; defaultSize: {w;h}
  inputs?:  Array<{ port?: string; accepts?: string[]; limit?: 'single'|'multi' }>  // target 输入声明
  outputs?: Array<{ port?: string }>                                                // source 输出声明
}
interface NodeStoreService {
  types: ReadonlyMap<string, CanvasNodeType>   // 按 type 查声明 —— 端口能力在这
  registerType / unregisterType / getNodes / addNode / updateNodeData(id,data)
  getNode(id) / removeNode(id) / replaceAll / subscribe(listener)
}
```
**这就是 BaseNode 想"端口按节点类型能力显隐"的数据源**：`ctx.get<NodeStoreService>('nodeStore').types.get(props.type)?.inputs / ?.outputs`。
但注意语义（connection.ts L199-203 + nodeStore）：**缺省（无 inputs/outputs）= 默认都能 source→target 连**（"人人可连"）；
只有当某 type 显式声明了 `inputs`（port='target'）非空数组才算"限制 target 输入"，`outputs` 同理 source。
`accepts[]` 限定能接的源 type；`limit:'single'` 单输入口只接一条。**没有 canReceiveInput/canProduceOutput 这种布尔字段**，是"声明了才约束"模型，与 v1 的 `canReceiveInput/canProduceOutput` 布尔默认 true 语义等价（v1 默认 true = v2 未声明）。

### NodeRegistry（nodeRegistry.ts）—— 展示段组件表
见 §5。`register(type, {segments})` / `get(type).segments[seg]` / 开放叠加 `registerContribution` / `contributionOccupants`。
**不含能力**。

### 装配助手（registry/registerNodeType.ts、capabilities.ts、nodeRenderer.ts）
- `registerNodeType(ctx, {type,label,defaultSize,segments,inputs,outputs})`：**一次写两边** —— nodeStore.registerType（数据+连接约束）
  + nodeRegistry.register（展示段），自动回收。capabilities 的 `ctx.nodes.register(def)` 内部走它（外加可选 nodeFactory.create）。
- 插件注册的"inputs/outputs"**只落 nodeStore.types**，展示 registry 不落。
- `resolveSegment(registry,type,'content')` = `registry.get(type)?.segments['content']`（nodeRenderer.ts L18-20）；`nodeSegmentStack`/`activeSegments`/`hasContent` 同文件。

### connection.ts —— v2 连接校验内核（v1 useCanvasConnection 校验部分"原样吸收"）
纯函数：`normalizeConnection` / `toCanonicalConnection` / `wouldCreateCycle` / `findDuplicate` / `validateConnection`。
`validateConnection(conn, { nodes, edges, getTypeConn })` 返回 `{ ok, reason, canonical? }`，reason ∈
`missing-node|self-loop|bad-orientation|no-source-port|no-target-port|type-not-accepted|limit-reached|duplicate|cycle`。
`typeConnectionDef(nodeTypeDef)` 把 types 项映射成 `NodeConnectionDef{inputs,outputs}`。
> 已可返回**结构化 reason**，但宿主 `isValidConnection` 只取 `.ok`（丢 reason）→ 非法气泡文案要补 reason 透传（§9 缺口）。
> **无响应式"拖线中"状态机**（start/end、hoverNode、snap、suppressHandles、temp 边），这些是 v1 useCanvasConnection 的编排逻辑，v2 内核只吸收了"纯校验函数"，没吸收 UI 编排。

### 其它服务（CanvasHost/createMiniCanvasHost 注入的 ctx 服务）
- `selection`（SelectionService：ids/has/set/add/remove/clear/onChange）—— 点击/删除/撤销的单源。
- `edgeStore`（CanvasEdge + addEdge/removeEdge/removeEdgesOfNode/prune/replaceAll/subscribe）。
- `history`（withRecord / snapshot-restore 全图）。
- `command`（registry/has/execute）。
- `nodeFactory`、`save`、内置 `slots`、内置 `settings`。
- 事件总线 `ctx.on/once/emit`（插件生命周期事件 + 自定义）。

### 类型（configSchema.ts 等）
- `PluginModule { name, deps?/inject?, Config?, setup?(ctx) / apply?(ctx, config) }`（types.ts L218-229）。
- `ConfigSchema` / `InferConfig`（configSchema.ts）—— plugin Config 用；theme-default 已用。
- Context 声明合并：插件可 `declare module '@mini-canvas/canvas-core-v2'{ interface Context { text: TextService } }` 扩 ctx 直访。

---

## 9. 连接"拖拽反馈"驱动 —— 现成封装？缺口在哪？（问题 7/11 主答案）

**结论：canvas-render + canvas-core-v2 目前没有 v1 `useCanvasConnection` 式的"连接状态机 + 拖拽反馈编排"，是最大缺口。**

现状盘点：
1. `vueFlowBridge` 只给 Handle/Position/getBezierPath/useVueFlow + NodeProps/EdgeProps（§6）。无 ConnectionLineProps。
2. `CanvasSurface` 的 `<VueFlow>` 没绑 `@connect-start/@connect-end`、没渲染 `#connection-line` 插槽、没配 `connection-mode`（§7）。
3. `CanvasHost.isValidConnection` 返回 boolean、丢弃 `reason`（L236-245）。v2 校验内核虽能给 reason，但**宿主没把它带给 UI**。
4. themeRegistry 枚举里有 `'connectionLine'` 槽位名（themeRegistry.ts L29），**但谁也没注册、CanvasSurface 也没渲染**它——空壳占位，无实现。
5. BaseNode（v2 现版）里已有 `shouldShowHandles`（hover/选中才显示端口）+ MovingHandle 的 `disabled` 端口状态机，
   **但没有**"正在拖线(isConnecting)"来源：缺 `canvas.isConnecting`、`connectionState.suppressHandles`、`activeConnection.sourceNodeId`。
   所以 v1 的"拖线时抑制自己端口、其余节点显端口"v2 实现不了（除非补状态）。
6. BaseNode 无任何 `connectionHover`(valid/invalid) computed → 无法做 3D 倾斜 / 非法气泡 / 目标高亮。v1 这些全部读 `canvas.connectionState.hoverNode`（BaseNode L224-287、L342-403、L568），v2 无此数据源。

要"端口按能力显隐 + 3D 连接反馈 + 非法气泡"需要补什么（移植方案层面给方向，不写码）：
- **数据源缺口**：需要一层"拖线中状态"（谁在拖、从哪个 handle、当前 hover 到哪个节点、该候选 valid/invalid + reason），
  由 `@connect-start` / `#connection-line` 渲染时的命中检测 / `@connect-end` 驱动写入，并经 provide/inject 让每个 BaseNode 读到。
  推荐落点：给 `CanvasRenderContext` 增 connection 态字段（类似 v1 connectionState），由 CanvasHost 在 connect-start/line/end 时维护。
- **reason 透传缺口**：宿主 `isValidConnection` 应把 `validateConnection` 的 reason 暴露成响应式（供非法气泡文案），当前只返回 bool。
- **命中/吸附几何**：v1 的吸附/snap 区算法（handleRadius × ratios）与卡片 DOM 命中逻辑在 v1 useCanvasConnection 里，
  v2 内核没吸收；若要对齐需把纯算法抽出来（可放 canvas-render 纯函数或复用 v1 移植），加"在拖线时查询当前节点是否可连"。
- **临时边渲染**：用 VueFlow `#connection-line` 槽，把 v2 CustomEdge 当 connectionLine（它已支持 `temporary/forceFlow` props
  与 `data.isTemp`，见 CustomEdge.vue L26-30、L41）——CustomEdge 本身**已经为临时拖线准备好了**（`isTemporaryEdge`/`animateFlow`），
  缺的是宿主把它挂到 `#connection-line`。

---

## 10. `CustomEdge` / `edgeGeometry.ts` 现状（v2 边侧已具备/缺什么）

`CustomEdge.vue` 现状：读 `edgeVisual`+`edgeSelection`（useCanvasRender）+ props 的 `temporary/forceFlow/visual/geometry`；
几何全抽到 `./edgeGeometry.ts`（`buildEdgePath`/`sampleEdgePath`/`findClosestPointOnPath`/`getSourcePosition`/`getTargetPosition`，
支持 bezier/straight/step/smoothstep），自研、无 @vue-flow path 依赖。功能已含：流光（runner-glow/hot）、箭头（自采样角度）、
加宽热区、双击剪切钮（removeEdges）。选中高亮依据"相连节点被选 / 边自选 / temporary / forceFlow / props.selected"。
→ **CustomEdge 侧对标 v1 基本已齐**。唯一与"3D 反馈/吸附"相关的潜在缺口是：v1 拖线临时边由 useCanvasConnection 把
`ConnectionLineProps` 转成 CustomEdge props（snap 到端口、target 定位、endX/endY），这套**宿主未提供**（需 §9 的状态机补）。

---

## 11. resize / 尺寸写回 —— 现状与缺口（问题里"resize 写回"专项）

v1 参考（canvas-core/src/components/Decoration/BaseNode.vue）：
- 尺寸模型在 **node.data.cardWidth / cardHeight / resizable**（v1 BaseNode L80-107），resizable=data.resizable===true 才显示右下角拖柄。
- resize 逻辑：pointerdown 记起点+初尺寸 → pointermove `(clientX-startX)/zoom` 算 delta → pointerup `vf.updateNode(id,{data:{cardWidth,cardHeight}})`。
- v2 现版 BaseNode **完全没有 resize**：
  - 没有 cardWidth/cardHeight/resizable 概念（grep 全 v2 render/plugins 无一处出现，仅 canvas-core v1 有）。
  - 卡片尺寸由 CSS `min-width/min-height` + 内容撑开，无显式尺寸 → 无 resize 锚点。
  - 渲染数据单向流：`nodeStore` → nodesFromStore → VueFlow，卡片 width 不在渲染态。
- **要加 resize 写回**，v2 可用通道：
  - 尺寸写到 node.data：`nodeWrite(id, { cardWidth, cardHeight, resizable })`（host.nodeWrite 缺省=updateNodeData+落盘，CanvasHost L118-126），
    触发 nodeStore.subscribe → 渲染态自动刷新（无需手动 updateNode/map，这是 v2 相比 v1 的优势：数据源下沉 nodeStore）。
  - 节点类型默认尺寸可读 `ctx.get('nodeStore').types.get(type).defaultSize`（node-text 注册 size:{w:300,h:200}），
    data 里无则回落 defaultSize，作为初值来源。
  - 反向缩放 / DOM→画布换算逻辑 v2 BaseNode 已有（cardClientW/zoom → cardCanvasW，BaseNode.vue L122-132 做标题宽度换算），可复用同一套做 resize delta。
  - 端口锚点：v1 MovingHandle 收 `node-size` prop 处理"半圆向卡片内侧裁剪/锚点定位"随尺寸变化；v2 MovingHandle **没有 node-size prop**（尺寸由 overlap 单独算），若卡片尺寸可变需确认端口锚点仍居中（现 MovingHandle zone 是 absolute、锚点 absolute 于卡侧边，尺寸变化时其 position 相对卡片容器，通常 OK，但 v1 把 node-size 显式传入用于某几个定位公式——移植时对照 v1 MovingHandle.vue 逐条核对）。

> 结论：resize 写回在 v2 **可以做**，通道是 nodeWrite→nodeStore（自动刷新），尺寸初值 = node data.cardWidth/cardHeight ?? types.defaultSize。
> 缺口是 (a) data 层尚无尺寸字段约定（需在壳内约定 cardWidth/cardHeight/resizable 命名，与 v1 对齐便于迁移存量数据）；
> (b) BaseNode 无拖柄交互；(c) MovingHandle 是否需 node-size 参与定位需对照 v1。

---

## 12. 端口"按节点类型能力显隐"（问题核心之一）—— BaseNode 要拿什么

v1 语义：`showTargetHandle = targetPosition 显式 ? 它 : (nodeDef.canReceiveInput ?? true)`；`showSourceHandle` 同理
用 `canProduceOutput`（v1 BaseNode L34-41；nodeDef 来自 `runtime.nodeRegistry.get(nodeType)`）。

v2 里能力权威源换了（见 §8c）：NodeRegistry 只有段组件，**能力在 `nodeStore.types`**。BaseNode 已能在渲染子树拿
`useCanvasRender().ctx` → `ctx.get<NodeStoreService>('nodeStore')` → `types.get(props.type)`。

对应到 v2 现有连接约束字段：
- v1 `canReceiveInput`（target 输入能力） ≈ **v2 该 type 未声明 `inputs` 或 `inputs` 非空**（"声明了 target 输入口才算有/限制"，connection.ts L202-203：`hasTargetPort = !tgtConn.inputs || tgtConn.inputs.length>0`）。
- v1 `canProduceOutput`（source 输出能力） ≈ **v2 未声明 `outputs` 或 `outputs` 非空**（L200-201：`hasSourcePort = !outputs || outputs.length>0`）。
- `accepts`（v1 acceptsInputs）≈ v2 `inputs[].accepts`；`limit:'single'` v2 原生支持。
- 默认缺省行为两者一致：都默认"可进可出"，除非显式声明限制。

**给移植的准确写法方向**（BaseNode 里）：拿 `nodeStore.types.get(props.type)`，按
`hasInput = !def?.inputs || def.inputs.length > 0`、`hasOutput = !def?.outputs || def.outputs.length > 0`
来决定渲染 target/source 的 MovingHandle（`v-if`），再叠加现有 hover/选中/拖线抑制。这与 v1 的 `canReceiveInput ?? true` 在默认上等价。
> 注意：**它不叫 canReceiveInput/canProduceOutput/titleIcon**。v2 无 titleIcon 概念；label 放 types.label（node-text 注册 label:'文本'）。type 名显示用 `props.type` 或 data.label（BaseNode 现 L33-36 已回落）。

---

## 13. demo 层面：一个节点如何被注册/渲染（含 node-text 全链、ui/App 真宿主）

### 插件注册一个节点（node-text 例子，nodeTextPlugin.ts）
```ts
export function apply(ctx) {
  const text = new TextService(ctx)          // Service extends Service，super(ctx,'text') 上架 'text' 服务
  ctx.nodes.register({                       // capabilities 收口
    type: 'text', label: '文本', size: {w:300,h:200},
    content: TextContent,                    // content 段组件
    create(position){ return text.addTextNode(position) },  // nodeFactory 建节点
  })
}
```
内部：`ctx.nodes.register` → `capabilities.ts` → `registerNodeType(ctx, {..., segments:{content}})`
→ `nodeStore.registerType({type,label,defaultSize:{w:300,h:200}})` + `nodeRegistry.register('text',{content:TextContent})`。

### 渲染
CanvasHost 冷启动传 `plugins:[themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]`（ui/App.vue L21-26；
plugin-theme-default/demo-web/App.vue 同）。boot 时 theme-default `apply` 注册 nodeShell=BaseNode、edge=CustomEdge、
background=DefaultBackground、edgeDefaultType='custom'（theme-default index.ts L118-121）。
CanvasHost `applyTheme()` 把 nodeShell 填进**所有** nodeTypes 键（§7）→ 渲染任何 type 节点都用 BaseNode 壳；
BaseNode 按 `props.type` 经展示 registry resolve content 段组件渲染真正内容。
seed（CanvasHost 存储空时）产生 text+image 节点。

> 结论：壳**全 type 共用**，type 差异化靠 content/title/top/bottom 段组件（registry.resolveSegment / nodeSegmentStack），
> 数据能力差异化靠 nodeStore.types（端口/连接约束）。这回答了"node-text 注册 type='text' content 段；壳是否所有 type 共用 BaseNode"——
> **是共用，注册的只是 content 段**。

---

## 14. 逐项可 import 清单（移植时按需精确 import）

```ts
// 渲染插件统一上下文 / 旧令牌（@mini-canvas/canvas-render）
import { useCanvasRender, CANVAS_PARAMS_KEY, EDGE_VISUAL_KEY, EDGE_SELECTION_KEY,
         NODE_REGISTRY_KEY, NODE_WRITE_KEY, CanvasHost } from '@mini-canvas/canvas-render'
import type { CanvasRenderContext, CanvasParams, EdgeVisual, EdgeSelection, NodeWrite } from '@mini-canvas/canvas-render'

// vue-flow 精选原语（@mini-canvas/canvas-render 经 vueFlowBridge 导出）
import { Handle, Position, getBezierPath, useVueFlow } from '@mini-canvas/canvas-render'
import type { EdgeProps, NodeProps } from '@mini-canvas/canvas-render'

// 内核（@mini-canvas/canvas-core-v2）—— 直接 import
import { resolveSegment, nodeSegmentStack, activeSegments } from '@mini-canvas/canvas-core-v2'
import type { NodeRegistry, NodeStoreService, CanvasNode, CanvasNodeType } from '@mini-canvas/canvas-core-v2'
// 连接校验（如需 reason / 端口能力判定）
import { validateConnection, typeConnectionDef } from '@mini-canvas/canvas-core-v2'
import type { ValidationResult, InvalidReason, NodeConnectionDef } from '@mini-canvas/canvas-core-v2'
```

能力拿取建议（BaseNode）：
- 端口显隐：`useCanvasRender().ctx.get<NodeStoreService>('nodeStore').types.get(props.type)` → hasInput/hasOutput（§12）。
- 数据写回（resize/改名）：`useCanvasRender().nodeWrite`。
- 端口外观：`useCanvasRender().handleParams`。
- 选中/相连高亮：`useCanvasRender().edgeSelection.selectedNodeIds`（CustomEdge 已用）。
- 缩放/坐标：`useVueFlow()`（viewport / getNodes / screenToFlowCoordinate）。

---

## 15. 风险与待确认点（写移植方案前先拍板）

1. **能力字段模型差异**：v2 没有 `canReceiveInput/canProduceOutput/titleIcon`，改用 `nodeStore.types.inputs/outputs`
   "声明了才约束"模型；默认行为等价但字段/语义不同，需跟团队确认是否接受"以 inputs/outputs 有无"推导端口显隐，
   还是要内核新增布尔能力字段（侵入内核，不推荐）。
2. **连接反馈大缺口**：要 3D 倾斜 + 非法气泡 + 拖线端口抑制，必须补"拖线状态机 + 候选命中判定 + reason 透传"，
   而这跨 canvas-render 宿主层（connect-start/#connection-line/connect-end 挂接）+ 纯几何算法。
   需确认改 canvas-render（渲染抽象层）还是只在 plugin-theme-default 里自建一个 provide 的连接态（前者影响面大但复用广）。
3. **`#connection-line` 槽**与 `ConnectionLineProps` 目前不被 bridge 导出、CanvasSurface 不渲染 → 要么给 bridge 补类型导出 + CanvasSurface 加槽渲染 + 宿主在 connect-start 写状态，要么 theme-default 自己 peer import @vue-flow/core 并自行另包一层 VueFlow（会绕过 CanvasHost，不推荐）。
4. **reason→中文文案映射**：`InvalidReason` 是枚举（type-not-accepted/limit-reached/duplicate/cycle…），要展示 v1 那种
   "X 不接受 Y 输入"等，需宿主把 reason + 相关 type label 拼成文案（v1 useCanvasConnection.getInvalidConnectionReason 有样板）。
5. **resize 尺寸字段未约定**：需在壳内约定 `data.cardWidth/cardHeight/resizable`（建议与 v1 同名便于存量迁移），
   初值回落 `nodeStore.types.defaultSize`。
6. **peer vs dev 依赖**：plugin-theme-default 的 package.json 把 canvas-core-v2/canvas-base 只放 devDeps，但源码运行时 import 内核
   （resolveSegment/CanvasNode）。已在 pnpm workspace 内工作正常，但若未来发布成独立包需把内核挪进 dependencies 或经 canvas-render 转发（风险点 0）。

---

## 附：关键源码位置索引

| 内容 | 文件:行 |
|---|---|
| useCanvasRender / CanvasRenderContext | canvas-render/src/contracts/renderContext.ts L33-63 |
| CanvasParams 字段 | canvas-render/src/contracts/canvasParamKey.ts L10-21 |
| EdgeVisual / EdgeSelection | canvas-render/src/contracts/edgeContext.ts L11-41 |
| NodeWrite / NODE_WRITE_KEY | canvas-render/src/contracts/nodeRegistryKey.ts L17-19 |
| vueFlowBridge 导出 | canvas-render/src/vueFlowBridge.ts L14-16 |
| CanvasHost nodeTypes 全映射同壳 | canvas-render/src/host/CanvasHost.vue L173-186 |
| CanvasHost onConnect / isValidConnection（丢 reason） | canvas-render/src/host/CanvasHost.vue L236-264 |
| CanvasHost nodeWrite 缺省 | canvas-render/src/host/CanvasHost.vue L118-126 |
| CanvasHost 选中投影 | canvas-render/src/host/CanvasHost.vue L145-149, L323 |
| CanvasSurface VueFlow 事件清单（无 connect-start/无 connection-line） | canvas-render/src/host/CanvasSurface.vue L89-104 |
| CanvasSurface provide 裸上下文 | canvas-render/src/host/CanvasSurface.vue L67-84 |
| nodesFromStore / assembleTheme / ThemeAssembly | canvas-render/src/host/canvasHostCore.ts L28-83 |
| DEFAULT_HANDLE_VISUAL / DEFAULT_EDGE_VISUAL / edgeId | canvas-render/src/host/canvasHostCore.ts L90-113 |
| CanvasHostHandle 全集 | canvas-render/src/host/createMiniCanvasHost.ts L65-81 |
| NodeStore.types(inputs/outputs) | canvas-core-v2/src/services/nodeStore.ts L19-26, L29-35 |
| validateConnection reason 枚举 | canvas-core-v2/src/services/connection.ts L73-89, L178-226 |
| NodeRegistry 段表（无能力） | canvas-core-v2/src/core/registry/nodeRegistry.ts L43-77 |
| resolveSegment | canvas-core-v2/src/core/registry/nodeRenderer.ts L18-20 |
| registerNodeType 一次写两边 | canvas-core-v2/src/core/registry/registerNodeType.ts L45-72 |
| ctx.nodes.register（capabilities） | canvas-core-v2/src/core/capabilities.ts L116-138 |
| themeRegistry 'connectionLine' 槽（空占位） | canvas-core-v2/src/core/registry/themeRegistry.ts L24-30 |
| CanvasHostHandle ctx 服务注入 | canvas-render/src/host/createMiniCanvasHost.ts L119-175 |
| node-text 节点注册 | plugins/plugin-node-text/src/nodeTextPlugin.ts L70-84 |
| theme-default apply 注册皮 | plugins/plugin-theme-default/src/index.ts L112-125 |
| ui 真宿主（CanvasHost 冷启动全部插件） | packages/ui/src/App.vue L20-60, L139-158 |
| v1 参考 useCanvasConnection（连接状态机/吸附/反馈） | canvas-core/src/composables/useCanvasConnection.ts（全文） |
| v1 参考 BaseNode（端口能力/3D/气泡/resize） | canvas-core/src/components/Decoration/BaseNode.vue |
| v1 参考 MovingHandle | canvas-core/src/components/Decoration/MovingHandle.vue |
