# canvas-render 开发手册 · CanvasHost / CanvasSurface / canvasHostCore

> 来源：`packages/canvas-render/src/host/CanvasHost.vue`、`host/CanvasSurface.vue`、`host/canvasHostCore.ts`、
> `host/renderEvents.ts`、`host/selectionInteractions.ts`、`contracts/renderContext.ts`，
> 测试 `host/__tests__/canvasHostCore.test.ts`、`host/__tests__/renderEvents.test.ts`。

## 一句话

这几处是"渲染宿主"的分工：

- **`CanvasHost.vue`（外层官方宿主组件）**：你唯一要渲染的。负责建宿主、冷启动插件、订阅数据变化、通用交互（拖拽落盘 / 点选 / 连边 / 快捷键）、生命周期落盘与回收。它自身在 boot 完成前**不 provide**。
- **`CanvasSurface.vue`（内层渲染子树宿主）**：boot 完成后 CanvasHost 才以 `v-else` 挂它。它在 setup 时 `props.host` 已就绪，于是向整棵 VueFlow 子树 **provide 统一渲染上下文**（`useCanvasRender()` 拿到的就是它 provide 的），同时仍逐个 provide 旧令牌做兼容。
- **`canvasHostCore.ts`（纯逻辑，可单测）**：把"数据→flow 映射、主题装配、默认外观参数、悬挂边清理、边 id 生成、写入 patch 拆分、命中判定"这些**无副作用**逻辑抽出来，不 import Vue/VueFlow，方便单测。

---

## CanvasHost.vue

### Props

```ts
withDefaults(defineProps<{
  plugins: (PluginModule | PluginClassLike)[]  // 冷启动插件，顺序即装载序（必填）
  manifest?: PluginManifest                    // 与 plugins 二选一，给了走 manifest
  adapter?: StorageAdapter                     // 存储后端；缺省 MemoryStorageAdapter（刷新即丢）
  seed?: () => CanvasNode[]                    // 首次(存储空)生成默认画布
  nodeWrite?: NodeWrite                        // 覆盖标题/尺寸写回实现；缺省=改 store data + 落盘
  edgeVisual?: Partial<EdgeVisual>             // 覆盖边外观（传响应式对象可实时生效）
  handleVisual?: CanvasParams                  // 浮动端口外观（需含全部 8 字段的响应式对象）
  debugVisual?: CanvasDebug                    // 调试可视化开关
  snapZoneVisual?: SnapZoneConfig              // 吸附带配置
  minZoom?: number                             // 兼容保留，缺省 0.2
  maxZoom?: number                             // 兼容保留，缺省 2
  windowKey?: string                           // 把 api 挂到 window 的 key；空则不挂
  persistViewport?: boolean                    // 是否持久化画布视口；缺省 true
  dev?: boolean                                // 开发态开关，落到 ctx.isDev；缺省 false
}>(), {
  minZoom: 0.2,
  maxZoom: 2,
  persistViewport: true,
})
```

`minZoom` / `maxZoom` **已不生效**：缩放范围由 settings 里的「常规/画布」接管（`interactionSettings.minZoom/maxZoom`），这两个 prop 只是兼容保留。

### `dev` 的重要事实（务必记牢）

`CanvasHost` **不自己读 `import.meta.env`**。原因：vite 的 `import.meta.env` 替换只作用于应用包自身源码；`canvas-render` 是独立 workspace 包，它自己的 .vue 拿不到替换（读出来是 undefined），dev 判定会静默失效。

所以必须**由应用显式传**：`packages/ui` 的 `App.vue` 就是 `:dev="import.meta.env.DEV"`。缺省 `false` = 生产语义（能力包 `needs` 缺项时只 warn 不抛错）。

### Emits

```ts
(context-menu, { kind: 'node' | 'pane' | 'edge', clientX, clientY, nodeId?, edgeId? })  // 右键（已 preventDefault，父级弹菜单）
(ready, host: CanvasHostHandle)                                    // 宿主就绪
(boot-error, error: Error)
(plugin-issue, { name, lifecycle })                                // 运行期某插件装载失败
```

### defineExpose（父级用 ref 拿）

```ts
c.value.host          // CanvasHostHandle | undefined（boot 后可用）
c.value.api           // MiniCanvasApi | undefined
c.value.manager       // PluginManager | undefined
c.value.ready         // boolean
c.value.bootErrorText // string
```

### 模板插槽

- 默认插槽（`<slot/>`）透传进内层 `<VueFlow>`（可放自定义背景/控件）。
- 具名插槽 `#ui`：宿主把工具栏 / 设置面板 / 右键菜单等"画布之上的业务 UI"放这里，**它们也在 CanvasSurface 的 provide 作用域内**，能 `useCanvasRender()` 读 ctx。CanvasHost 不内置任何业务 UI，只把 `#ui` 转发给 CanvasSurface。

### 它内部做了什么

1. **建宿主**：`onMounted` 里
   ```ts
   await createMiniCanvasHost({
     adapter: props.adapter ?? new MemoryStorageAdapter(),
     manifest: props.manifest,
     coldPlugins: props.plugins,
     nodeRegistry: registry,       // 组件内自建，boot 前就能持有
     seedDefault: props.seed,
     dev: props.dev,               // 只认显式传参
   })
   ```
2. **订阅自动刷渲染态**：`host.nodeStore.subscribe(syncFromStore)` + `host.edgeStore.subscribe(syncFromStore)` + `host.selection.onChange(syncSelected)`。任何增删改（命令 / 插件服务 / 拖拽 / 历史 undo·redo）都自动重灌 VueFlow，**不需要手动 map**。
3. **主题 + nodeTypes 装配**（`applyTheme`）：用 `assembleTheme` 解析每个 type 的节点壳，`markRaw` 包好（防 Vue 把组件对象 reactive 化），填 `node-types` / `edge-types` / 背景 / 拖线临时线。同时订阅 `themeRegistry.subscribe`、`nodeRegistry.subscribe`、以及 `registryOf('node/shell')` 场的变化——所以热装卸插件、乃至运行期直接 `add`/`wrap` 换壳，都会重装配并 bump `nodeEpoch` 让 VueFlow 子树重挂。
4. **通用交互**：
   - 拖节点：`onNodeDragStart` 用 `beginNodeDrag` 写交互状态（`interaction.activity.nodeDragging` / 派生 `interaction.isNodeDragging`）并按配置顺手选中被拖节点；`onNodeDragStop` 把最终位置（多选拖动时是全部被拖节点的位置）经 `graph.updateNodes` 写回并落盘。
   - pan/缩放：`onMoveStart` / `onMoveEnd` 用 `beginViewportMove` / `endViewportMove` 驱动交互状态（`interaction.activity.paneDragging` / 派生 `interaction.isPanning`；VueFlow 的 pan 与滚轮缩放共用同一套 move 事件），结束后把视口落盘。
   - 点选：`onNodeClick` / `onEdgeClick` / `onPaneClick` 走 `clickNode` / `clickEdge` / `clickPane` 纯函数（Shift 加选、点空白清空），只写内核 selection（选中单源）。
   - 连边：`isValidConnection` 走内核校验；真正落边统一走 `graph.connectEdge`（校验 → 满额挤出 → 落边，一条历史）。
   - 快捷键：`findCommandByKeys` 扫已注册命令的 `keys`（同键多命令按 `order` 定优先级、`when` 不满足则让位），命中即 `command.execute`（输入框内不劫持）。
5. **视口持久化**（`persistViewport`）：boot 读存档 `GRAPH_VIEWPORT_KEY`；有存档就恢复，没存档就对所有节点 `fitView` 一次并落盘基线。移动/缩放结束时落盘。
6. **生命周期**：`visibilitychange` / `pagehide` 落盘；卸载时 flush + `host.stop()`，并摘掉全部监听与订阅。

### 渲染层广播的画布事件（`host/renderEvents.ts`）

CanvasHost 在 VueFlow 事件回调里 `ctx.emit` 这些事件，插件用 `ctx.on(名字)` 消费（名字已在模块加载时 `registerEventName` 登记）：

| 常量 | 事件名 | payload |
|------|--------|---------|
| `RenderEvents.NodeDragStart` / `NodeDrag` / `NodeDragEnd` | `canvas:node:drag-start` / `drag` / `drag-end` | `{ nodeId, position }` |
| `RenderEvents.MoveStart` / `MoveEnd` | `canvas:viewport:move-start` / `move-end` | `{ viewport }` |
| `RenderEvents.NodeClick` / `EdgeClick` / `PaneClick` | `canvas:node:click` / `canvas:edge:click` / `canvas:pane:click` | `{ nodeId?, edgeId?, shiftKey? }` |
| `RenderEvents.SelectionChange` | `canvas:selection:change` | `{ nodeIds, edgeIds }` |
| `RenderEvents.ConnectionDropBlank` | `canvas:connection:drop-blank` | `{ clientX, clientY, flowPosition, sourceNodeId, sourceHandle, dragDistance }` |
| `RenderEvents.ContextMenuPane` / `Node` / `Edge` | `canvas:context-menu:pane` / `:node` / `:edge` | `{ clientX, clientY, flowPosition, nodeId?/edgeId? }` |

`ConnectionDropBlank` 只描述事实（"线落在空白"），是否弹菜单/放临时节点由消费方自己决定——渲染层不掺业务。落点是否真的空白用 `hitNodeIdAt` 做几何判定（拖线期间画布挂着端口覆盖层，`elementFromPoint` 会命中覆盖元素而不是卡片）。

### 渲染一个节点要哪些注册

一个节点能"在画布上以正确外观显示并可编辑"，需要这几件事恰好凑齐：

| 注册 | 谁提供 | 作用 |
|------|--------|------|
| 节点壳（`nodeShell`，如 BaseNode） | 主题插件 `ctx.theme.register('nodeShell', BaseNode)` | 卡片外观、标题、连接 Handle、就地重命名 |
| 业务 type 注册（数据 + `in` 区域组件） | 节点插件 `ctx.nodes.register({ type, size, in })` | `doc` 的类型表有该 type，nodeRegistry 有该 type 的 `in` 区域组件 |
| `node-types` 铺底 | CanvasHost.`applyTheme` | 把解析出的壳铺满 `doc` 类型表里每个已注册 type |

> 每 type 的壳按四级优先解析（`assembleTheme`）：场 `node/shell/<type>` 精确键 → 场 `node/shell/*` 通配 → theme 槽 `nodeShell:<type>` → theme 槽 `nodeShell`。孤儿的 type（有存量节点但类型已注销）也会映射到默认壳——卸载插件后存量节点仍有占位渲染，数据不丢、插件重装后自动恢复。

渲染一个节点的链路：VueFlow 见节点 `type:'text'` → 查 `node-types` 找到该 type 的壳（默认 BaseNode）→ BaseNode 内按区域词解析出该 type 的 `TextContent.vue` → `<component :is="content" :id :data>` 渲染。

---

## CanvasSurface.vue

### 它解决什么

CanvasHost 自身在 setup 期就要 provide，但那时 ctx 还没建好，只能给 "Ref 盒子" → 消费方拿 ctx 要 `.value` + 判空。所以单独拆一个 CanvasSurface：**boot 完成后才挂载**，setup 里 `props.host` 已就绪，能 provide **裸 ctx / 裸 host**。

### provide 了什么

```ts
const renderCtx: CanvasRenderContext = {
  ctx: host.ctx,           // 裸内核上下文
  host,                    // 裸宿主句柄
  registry: props.registry,
  nodeWrite: props.nodeWrite,
  handleParams: props.handleParams,
  edgeVisual: props.edgeVisual,
  edgeSelection: props.edgeSelection,
  connectionState: props.connectionState,  // 拖线过程反馈
  interaction: props.interaction,          // 画布交互状态 —— 见 10 号专档
  debug: props.debugVisual,
  snapZone: props.snapZone,
  viewport, paneRect, pane, rootEl, rendererEl,     // 只读数据源 / 坐标基准
  renderNodes, renderEdges,                          // 当前渲染态只读快照
  visibleRect, visibleNodes,
  screenToFlow, flowToScreen,
  updateNodeVisual, updateNodeVisualSize,
}
provide(RENDER_CONTEXT_KEY, renderCtx)

// 旧令牌兼容（同引用）：HOST_KEY 历史上是 Ref 形态，这里包成 shallowRef(host)
provide(NODE_REGISTRY_KEY, props.registry)
provide(NODE_WRITE_KEY, props.nodeWrite)
provide(CANVAS_PARAMS_KEY, props.handleParams)
provide(EDGE_VISUAL_KEY, props.edgeVisual)
provide(EDGE_SELECTION_KEY, props.edgeSelection)
provide(HOST_KEY, shallowRef(host))
```

> 关键：`RENDER_CONTEXT_KEY` 里 ctx/host 是**裸值**（非 Ref 非空），渲染组件 setup 里直接 `ctx.get('doc')`，**零 `.value` 零判空**。这是推荐入口。
> （`DEBUG_KEY` 也有导出，但 CanvasSurface 目前不逐个 provide 它；调试开关经 `useCanvasRender().debug` 取。）

### 渲染了什么

```html
<div ref="rootEl" class="csurface">
  <VueFlow :key="nodeEpoch" :nodes="nodes" :edges="edges"
           :node-types="nodeTypes" :edge-types="edgeTypes"
           :is-valid-connection="isValidConnection"
           :connection-mode="ConnectionMode.Strict"
           :elevate-nodes-on-select="false"
           :nodes-draggable="interactionSettings.nodesDraggable"
           ...（其余交互开关也全部来自 interactionSettings）...
           :min-zoom="interactionSettings.minZoom" :max-zoom="interactionSettings.maxZoom"
           @connect @connect-start @connect-end
           @node-click @edge-click @node-drag @node-drag-start @node-drag-stop
           @move-start @move-end @pane-click
           @node-context-menu @edge-context-menu @pane-context-menu>
    <component :is="backgroundComp" v-if="backgroundComp" />   <!-- 主题背景 -->
    <template #connection-line="lineProps">
      <ConnectionLineHost .../>                                <!-- 拖线临时线 -->
    </template>
    <slot />                                                    <!-- 父级塞 VueFlow 内自定义 -->
  </VueFlow>

  <div class="csurface-overlay">   <!-- 盖满画布的一层浮层（pointer-events:none） -->
    <SlotHost slot="overlay" item-class="csurface-overlay-item" />
  </div>
  <slot name="ui" />               <!-- 宿主业务 UI 区（#ui），可 useCanvasRender 读 ctx -->
</div>
```

- `nodeEpoch`：插件热装/热卸后 bump，给 VueFlow 加 key 强制重挂（新的 nodeShell/content 生效）。
- `overlay` 槽用 `SlotHost` 渲染：插件 `ctx.slots.register('overlay', ...)` 塞的 occupant 会浮在画布上（详见《06》）。
- 组件不持有业务逻辑：所有 handler/订阅/生命周期仍在 CanvasHost，经 props 传入，避免状态双份。
- `onMounted` 里做三件"只有渲染完才有 DOM"的事：抓住 pane / 节点层容器用于量测；启动节点尺寸观测（`ResizeObserver`，喂给 `nodeLayout`）；把 VueFlow 能力 `attachBackend` 到 `host.viewport`（插件此后可 `ctx.get('viewport')` 读/控视图）。
- `defineExpose` 给父级：`queryNodeEl` / `getViewport` / `getPaneRect` / `getSelectedNodePositions` / `screenToFlow` / `flowToScreen` / `zoomIn` / `zoomOut` / `zoomTo` / `fitView` / `setCenter` / `setViewport`。

---

## canvasHostCore.ts（纯逻辑函数）

### `nodesFromStore(store, selectedIds?): FlowNode[]`

把内核 nodeStore 当前节点灌成 VueFlow 节点数组。data 是浅拷贝（`{...}`），避免共享引用被 Vue 改写污染内核。还会做 v2 渲染投影：`parentId → parentNode`、`size → style` 像素尺寸、容器型类型（`transparent`）算 `zIndex`、中间态节点关掉拖拽/选中/删除。

```ts
interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  selected?: boolean
  parentNode?: string
  zIndex?: number
  style?: { width: string; height: string }
  draggable?: boolean; selectable?: boolean; deletable?: boolean; focusable?: boolean
}
```

```ts
const flowNodes = nodesFromStore(host.nodeStore, host.selection.ids)
```

### `edgesFromStore(edges, aliveNodeIds): FlowEdge[]`

把边灌成 VueFlow 边数组，并过滤掉源/目标已不在存活节点集的悬挂边；保留 `sourceHandle` / `targetHandle`（多端口边按 handle 匹配端点）。

```ts
interface FlowEdge {
  id: string
  type: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  data?: Record<string, unknown>
  selectable?: boolean; focusable?: boolean; deletable?: boolean; zIndex?: number
}
```

### `pruneDanglingEdges(edges, aliveNodeIds)`

给一组边清掉源或目标已不存在的悬挂边，CanvasHost 里兜底过滤渲染态。

```ts
const alive = new Set(host.nodeStore.getNodes().map(n => n.id))
const cleanEdges = pruneDanglingEdges(renderEdges, alive)
```

### `assembleTheme(theme, storeTypes, shellField?): ThemeAssembly`

从 themeRegistry（外加 `node/shell` 场）读整幅画布外观装配：

```ts
interface ThemeAssembly {
  nodeShell: unknown            // 全局默认壳（无壳 = undefined）
  nodeShells: Record<string, unknown>  // 每个业务 type 最终用的壳（四级优先解析结果）
  edge: unknown                 // 边渲染组件（放 edgeTypes.custom）
  background: unknown           // 背景组件
  connectionLine: unknown       // 拖线临时线组件（缺省 = 宿主回退默认线）
  edgeDefaultType: string       // 所有边默认 type 键（缺省 'custom'）
  nodeTypes: string[]           // doc 类型表里已注册的业务 type 列表
}
```

```ts
const asm = assembleTheme(
  host.themeRegistry,
  [...host.nodeStore.types.keys(), ...host.nodeStore.orphanTypes()],
  host.ctx.registryOf('node/shell'),   // 第三个参数 = 换壳用的场
)
```

### `nodeShellSlot(type)`

某 type 的"专属节点壳"槽名：`nodeShell:<type>`。插件注册它即接管该 type 的整体外观，默认壳保持通用、零特判。

### 默认外观常量

```ts
DEFAULT_EDGE_VISUAL     // 边默认：bezier / 线宽 2 / #3b82f6 / 辉光开 / 光斑流动开（edgeFlow*）
DEFAULT_HANDLE_VISUAL   // 端口默认（8 字段）：handleRestOffset 36 / handleCursorGap 24 / handleButtonSize 32 /
                        //   portZoneWidth 86 / portZoneHeightRatio 0.8 / portZoneOffset 0 / portZoneShape 'arc' / portZoneArcRatio 1
DEFAULT_DEBUG_VISUAL    // 调试开关默认：handleDebug true / connectionSnapDebugVisible true（默认开）
```

CanvasHost 内部用它们做回落：`edgeVisual ?? reactive({ ...DEFAULT_EDGE_VISUAL })`。

### `edgeId(source, target, sourceHandle?, targetHandle?): string`

稳定边 id：无/默认 handle 时形如 `e-1-2`；带显式端口时纳入 handle（`e-1:source-2:target`），避免同端点不同端口互相覆盖。

### `splitNodeWritePatch(patch)`

把 BaseNode 经 nodeWrite 回传的 patch 拆成 `{ data, size }` 两路。保留 key `size` 会被写进内核的**正式尺寸字段** `node.size`，而不是塞进 `data`——这样一次 resize 只产生一条撤销记录，且 `data.cardWidth` 与 `node.size` 同帧、同一条历史。

### `hitNodeIdAt(point, rects): string | null`

松手点是否落在某个节点卡片上（几何命中），用来区分"落空白"与"落节点上"。

---

## 坑

1. **`handleVisual` 要给全 8 个字段**：BaseNode 读 `handleParams.portZoneWidth` 等**不做默认回落**，缺字段会是 undefined。通常传一个全字段的 `reactive` 对象。
2. **外观参数传响应式对象才会实时生效**：`edgeVisual` / `handleVisual` / `debugVisual` / `snapZoneVisual` 用 reactive 对象，改动属性会被消费方 computed 追踪。
3. **`nodeEpoch` 别自己加**：插件热装热卸时 CanvasHost 已自动 bump。
4. **nodeTypes 组件句柄要用 shallowRef/markRaw**：存的是 .vue 组件对象，ref 深代理会触发 Vue 警告（CanvasHost 已处理）。
5. **要拿 `ctx` 就读 `useCanvasRender()`**：`HOST_KEY` 那条老路要 `.value` + 判空，新代码不要走。
6. **自己手写渲染（不用 CanvasHost）时**：要自己 provide 上下文 + mount VueFlow + 数据↔flow 双向同步——这正是 CanvasHost 替你收编掉的部分。真要用 CanvasHost 就别重复造。
