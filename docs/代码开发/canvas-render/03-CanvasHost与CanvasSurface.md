# canvas-render 开发手册 · CanvasHost / CanvasSurface / canvasHostCore

> 来源：`packages/canvas-render/src/host/CanvasHost.vue`、`host/CanvasSurface.vue`、`host/canvasHostCore.ts`、
> 测试 `host/__tests__/canvasHostCore.test.ts`。

## 一句话

三个文件是"宿主组件"的三层分工：

- **`CanvasHost.vue`（外层官方宿主组件）**：你唯一要写的。负责建内核宿主、冷启动插件、订阅 store 变化、通用交互（拖拽落盘/点选/连边/键盘删除撤销）、生命周期落盘。它自身在 boot 完成前**不 provide**。
- **`CanvasSurface.vue`（内层渲染子树宿主）**：boot 完成后 CanvasHost 才用 `v-else` 挂它。它在 setup 时 ctx/host 已就绪，于是向整棵 VueFlow 子树 **provide 裸渲染上下文**（`useCanvasRender` 拿到的就是它 provide 的）。
- **`canvasHostCore.ts`（纯逻辑，可单测）**：把"store→flow 映射、主题装配、默认外观参数、悬挂边清理、边 id 生成"这些**无副作用**逻辑抽出来，不 import Vue/VueFlow，方便单测。

---

## CanvasHost.vue

### Props

```ts
interface CanvasHostProps {
  plugins: (PluginModule | PluginClassLike)[]  // 冷启动插件，顺序即装载序
  manifest?: PluginManifest                    // 与 plugins 二选一，给了走 manifest
  adapter?: StorageAdapter                     // 存储后端；缺省 MemoryStorageAdapter（刷新即丢）
  seed?: () => CanvasNode[]                    // 首次(存储空)生成默认画布
  nodeWrite?: NodeWrite                        // 覆盖标题写回实现；缺省=改 store data + 落盘
  edgeVisual?: Partial<EdgeVisual>             // 覆盖边外观（传响应式对象可实时生效）
  handleVisual?: CanvasParams                  // 浮动端口尺寸（BaseNode 无回落，需含全部 5 字段的响应式对象）
  minZoom?: number                             // 缺省 0.2
  maxZoom?: number                             // 缺省 2
  windowKey?: string                           // 把 api 挂到 window 的 key；空则不挂
}
```

### Emits

```ts
(context-menu, { kind:'node'|'pane', clientX, clientY, nodeId? })  // 右键（已 preventDefault，父级弹菜单）
(ready, host: CanvasHostHandle)                                    // 宿主就绪
(boot-error, error)
(plugin-issue, { name, lifecycle })                                // 运行期某插件装载失败
```

### defineExpose（父级用 ref 拿）

```ts
c.value.host          // CanvasHostHandle | undefined（boot 后可用）
c.value.api           // MiniCanvasApi
c.value.manager       // PluginManager（install/uninstall/reload/list/applyManifest）
c.value.ready         // boolean
c.value.bootErrorText // string
```

### 模板插槽

- 默认插槽（`<slot/>`）透传进内层 `<VueFlow>`（可放自定义背景/控件）。
- 具名插槽 `#ui`：宿主把 toolbar / 设置 dock / 右键菜单等"画布之上的业务 UI"放这里，**它们也在 CanvasSurface 的 provide 作用域内**，能 `useCanvasRender()` 读 ctx。CanvasHost 不内置任何业务 UI，只把 `#ui` 转发给 CanvasSurface。

### 它内部做了什么

1. **建内核宿主**：`onMounted` 里 `await createMiniCanvasHost({ adapter, manifest, coldPlugins: plugins, nodeRegistry: registry, seedDefault: seed })`。
2. **订阅自动刷渲染态**：`nodeStore.subscribe(syncFromStore)` + `edgeStore.subscribe(syncFromStore)` + `selection.onChange(syncSelected)`。任何增删改（命令/拖拽/历史 undo/redo）都自动重灌 VueFlow，**不需要手动 map**。
3. **主题 + nodeTypes 装配**（`applyTheme`）：读 `themeRegistry` 的 nodeShell/edge/edgeDefaultType/background，用 `markRaw` 包好（防 Vue reactive 化警告），把 nodeTypes 铺满 nodeStore 已注册的类型。
4. **通用交互**：
   - `onNodeDragStart/onNodeDragStop`：拖节点开始/结束——begin/endNodeDrag 驱动交互状态 `interaction`（见 10 号专档）；`onNodeDragStop` 同时把最终 position 写回内核 nodeStore + 落盘。
   - `onMoveStart/onMoveEnd`：pan/缩放（VueFlow 同一套 move 事件）——begin/endViewportMove 驱动 `interaction.paneDragging`。
   - `onNodeClick`：只写内核 Selection（单源）。
   - `onPaneClick`：`selection.clear()`。
   - `isValidConnection`：走内核 connection 校验（自连/环/重复/朝向/类型）。
   - `onConnect`：`history.withRecord(() => edgeStore.addEdge(...))` + 边落盘 `GRAPH_EDGES_KEY`。
   - 键盘：Delete 删选中、Ctrl/Cmd+Z 撤销/重做（在输入框内不劫持）。
5. **生命周期**：visibilitychange/pagehide 落盘；卸载时 flush + `host.stop()`。

### 渲染一个节点要哪些注册

一个节点能"在画布上以正确外观显示并可编辑"，需要这几件事恰好凑齐：

| 注册 | 谁提供 | 作用 |
|------|--------|------|
| `nodeShell`（节点壳组件，如 BaseNode） | theme 插件 `ctx.theme.register('nodeShell', BaseNode)` | 卡片外观、标题、连接 Handle、就地重命名 |
| 业务 type 注册（数据 + content） | 节点插件 `ctx.nodes.register({ type, size, content })` | nodeStore 有该 type，nodeRegistry 有该 type 的 content 组件 |
| `nodeTypes` 铺底 | CanvasHost.applyTheme | 把 nodeShell 铺满 nodeStore 里每个已注册 type 作 VueFlow 的 `node-types` |

渲染一个节点的链路：VueFlow 见节点 `type:'text'` → 查 `node-types` 找到 BaseNode（nodeShell）→ BaseNode 内 `resolveSegment(registry, type, 'content')` 解析出该 type 的 `TextContent.vue` → `<component :is="content" :id :data">` 渲染。

---

## CanvasSurface.vue

### 它解决什么

CanvasHost 自身在 setup 期就要 provide，但那时 ctx 还没建好，只能给 Ref 盒子 → 消费方拿 ctx 要 `.value` + 判空。所以单独拆一个 CanvasSurface：**boot 完成后才挂载**，setup 里 props.host 已就绪，能 provide **裸 ctx / 裸 host**。

### provide 了什么

```ts
const renderCtx: CanvasRenderContext = {
  ctx: host.ctx,          // 裸内核上下文
  host,                    // 裸宿主句柄
  registry: props.registry,
  nodeWrite: props.nodeWrite,
  handleParams: props.handleParams,
  edgeVisual: props.edgeVisual,
  edgeSelection: props.edgeSelection,
  connectionState: props.connectionState,  // 拖线连接反馈（hover/合法目标/压端口）
  interaction: props.interaction,          // 画布交互状态（拖节点/pan/缩放）——见 10 号专档
  debug: props.debugVisual,                // 调试可视化开关
  snapZone: props.snapZone,                // 吸附带配置
}
provide(RENDER_CONTEXT_KEY, renderCtx)

// 旧 6 个 *_KEY 兼容（同引用）：HOST_KEY 历史上是 Ref 形态，这里包成 shallowRef(host)
provide(NODE_REGISTRY_KEY, props.registry)
provide(NODE_WRITE_KEY, props.nodeWrite)
provide(CANVAS_PARAMS_KEY, props.handleParams)
provide(EDGE_VISUAL_KEY, props.edgeVisual)
provide(EDGE_SELECTION_KEY, props.edgeSelection)
provide(HOST_KEY, shallowRef(host))
```

> 关键：`RENDER_CONTEXT_KEY` 里 ctx/host 是**裸值**（非 Ref 非空），渲染组件 setup 里直接 `ctx.get('nodeStore')` 或 `ctx.text.editText(...)`，**零 `.value` 零判空**。这是推荐入口。

### 渲染了什么

```html
<VueFlow :key="nodeEpoch" :nodes="nodes" :edges="edges"
          :node-types="nodeTypes" :edge-types="edgeTypes"
          :is-valid-connection="isValidConnection" :min-zoom="minZoom" :max-zoom="maxZoom"
          @connect @connect-start @connect-end @node-click @node-drag-start @node-drag-stop @move-start @move-end @pane-click @node-context-menu @pane-context-menu>
  <component :is="backgroundComp" v-if="backgroundComp" />   <!-- 主题背景 -->
  <slot />                                                    <!-- 父级塞 VueFlow 内自定义 -->
</VueFlow>
<div class="csurface-overlay">   <!-- 盖满画布的一层浮层（pointer-events:none） -->
  <SlotHost slot="overlay" item-class="csurface-overlay-item" />
</div>
<slot name="ui" />               <!-- 宿主业务 UI 区（#ui），可 useCanvasRender 读 ctx -->
```

- `nodeEpoch`：插件热装/热卸后 bump，给 VueFlow 加 key 强制重挂（新的 nodeShell/content 生效）。
- `overlay` 槽用 `SlotHost` 渲染：插件 `ctx.slots.register('overlay', ...)` 塞的 occupant 会浮在画布上（详见《06》）。
- 组件不持有业务逻辑，所有 handler/订阅在 CanvasHost、经 props 传入，避免状态双份。

---

## canvasHostCore.ts（纯逻辑函数）

### `nodesFromStore(store): FlowNode[]`

把内核 nodeStore 当前节点灌成 VueFlow 节点数组。data 是浅拷贝（`{...}`），避免共享引用被 Vue 改写污染内核。

```ts
interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}
```

```ts
const flowNodes = nodesFromStore(host.nodeStore)
```

### `pruneDanglingEdges(edges, aliveNodeIds)`

当节点被删时清掉源或目标已不存在的悬挂边。CanvasHost 里兜底过滤渲染态。

```ts
const alive = new Set(host.nodeStore.getNodes().map(n => n.id))
const cleanEdges = pruneDanglingEdges(renderEdges, alive)
```

### `assembleTheme(theme, storeTypes): ThemeAssembly`

从 themeRegistry 读整幅画布外观装配：

```ts
interface ThemeAssembly {
  nodeShell: unknown          // 节点壳（无壳=undefined）
  edge: unknown               // 边渲染组件（放 edgeTypes.custom）
  background: unknown         // 背景组件
  edgeDefaultType: string     // 所有边默认 type 键（缺省 'custom'）
  nodeTypes: string[]         // nodeStore 已注册的业务 type 列表
}
```

```ts
const asm = assembleTheme(host.themeRegistry, host.nodeStore.types.keys())
```

### 默认外观常量

```ts
DEFAULT_EDGE_VISUAL = {
  edgeType:'bezier', edgeLineWidth:2, edgeColor:'#3b82f6', edgeDashed:false,
  edgeAnimated:true, edgeMarkerEnd:false, edgeGlowEnabled:true, edgeGlowIntensity:1,
}
DEFAULT_HANDLE_VISUAL = {   // 浮动端口
  handleRadius:86, handleRestOffset:36, handleCursorGap:24,
  handleButtonSize:32, handleOverlap:16,
}
```

CanvasHost 内部用它们做回落：`edgeVisual ?? reactive({...DEFAULT_EDGE_VISUAL})`。

### `edgeId(source, target): string`

给一条源→目标连接生成稳定边 id：`e-${source}-${target}`（如 `e-1-2`）。

---

## 坑

1. **`handleVisual` 必须给全 5 个字段**：BaseNode 读 `handleParams.handleRadius` 等**不做默认回落**，缺字段会是 undefined。通常传一个全字段的 `reactive` 对象。
2. **外观参数传响应式对象才会实时生效**：`edgeVisual`/`handleVisual` 用 reactive 对象，改动属性被消费方 computed 追踪。
3. **`nodeEpoch` 别自己加**：插件热装热卸时 CanvasHost 已自动 bump。
4. **nodeTypes 组件句柄要用 shallowRef/markRaw**：存的是 .vue 组件对象，ref 深代理会触发 Vue 警告（CanvasHost 已处理）。
5. **自己手写渲染（不用 CanvasHost）时**：要自己 provide 令牌 + mount VueFlow + store↔flow 双向同步——这正是 CanvasHost 替你收编掉的部分。真要用 CanvasHost 就别重复造。
