# canvas-core 节点/边数据源调查

> 调查对象：`packages/canvas-core`（v1 画布核心）
> 调查日期：2026-09-05
> 目的：回答两个问题
> 1. 画布上的 node/edge 用的是**自己的数据**还是 **VueFlow 内部维护的数据**？
> 2. VueFlow 内部那份 nodes/edges 是**怎么被灌进去 / 设置**的？

---

## 结论先行

**结论 1（数据归属）**：nodes/edges 的"唯一真源"（single source of truth）是 **VueFlow 实例内部维护的那份响应式数组**，本项目**没有**第二份节点数据副本。Pinia（`useCanvasStore`）只存配置、选中态、插件设置、节点组件类型等**旁路状态**，不存节点/连边本体。

**结论 2（如何设置）**：代码拿到 `useVueFlow('main-canvas')` 返回的实例后，**直接调用实例方法把数据写进 VueFlow 内部数组**。灌数据只有三种途径：
- 有存档 → `fromObject({nodes, edges})` 整体还原；
- 无存档 → `addNodes/addEdges` 写入写死的默认 3 节点；
- 运行中日常增删改 → `addNodes / removeNodes / updateNode / removeEdges` 等操作同一份内部数组。

---

## 一、证据链：数据归属

### 1.1 核心实例：`useVueFlow(CANVAS_ID)` 单例
文件：`packages/canvas-core/src/Canvas.vue`

```ts
// 显式 ID，确保 useVueFlow() 和 <VueFlow> 共享同一个实例
const CANVAS_ID = 'main-canvas'
const vueFlowInstance = useVueFlow(CANVAS_ID)   // 行 86
const { getNodes, getEdges } = vueFlowInstance   // 行 87
```

`useVueFlow(id)` 在 VueFlow 库内部按 `id` 创建并**缓存一个全局 store**，`nodes` / `edges` 就是该 store 里的两个 `ref` 数组。后续所有读写都通过这个实例方法进行，实例唯一，数据也就唯一。

### 1.2 模板直接渲染 VueFlow 内部数组
文件：`Canvas.vue`（模板区，行 666-667）

```html
<VueFlow
  :nodes="vueFlowInstance.nodes.value"
  :edges="vueFlowInstance.edges.value"
  ... >
```

渲染读的就是 `vueFlowInstance.nodes.value`——即 VueFlow 内部 store 的状态。这个绑定使内部数据显式驱动组件渲染。

### 1.3 所有写操作都走 VueFlow 实例方法
- `Canvas.vue:110-113` 把 `vueFlowInstance.addNodes / addEdges / removeNodes / removeEdges / updateNode` 包装传给 `useCanvasConnection`。
- 插件 action 层（`packages/canvas-core/src/plugins/PluginContext.ts`，`createActions(vueFlowInstance)`）内部全部调用 `vf.addNodes / vf.removeNodes / vf.updateNode / vf.getNodes.value` 等。
- 后端同步、存储、剪贴板等插件通过 `actions.getNodes() / addNodes() / removeNodes()` 读写，最终都落到 `vueFlowInstance` 这份数据。

### 1.4 Pinia 不存节点本体（关键注释）
文件：`packages/canvas-core/src/composables/useCanvasStore.ts`（行 119-120）：

> nodes/edges 不再由 Pinia 管理，改为 VueFlow 内部唯一管理。
> 持久化通过 Canvas.vue 中的 toObject()/fromObject() + localStorage 实现。

`useCanvasStore` 只负责：
- `state.core`（连线样式、视口交互、快捷键映射等配置）
- `selectionState`（选中 node/edge 的 id 集合，不持久化）
- `connectionState`（拖线过程态，不持久化）
- `nodeTypes / edgeTypes / customNodeTypes`（节点/边组件类型映射）
- `state.plugins`（插件命名空间设置）

没有任何一处存 `nodes` / `edges` 数据数组。

### 1.5 持久化也绕不开 VueFlow 这份
- 存盘：`getNodes() / getEdges()` 读 VueFlow 内部数据 → 清洗 → 存储/后端。
- 恢复：`addNodes / fromObject` 灌回 VueFlow 内部。
- 保存函数参考 `plugins/storage/sanitizeForSave.ts`、`StoragePlugin.ts`、`plugins/backend-sync/BackendSyncPlugin.ts`（其中 `replaceAll(data.nodes, data.edges)`）。

---

## 二、证据链：nodes 是怎么被设置的

### 2.1 底层机制
`useVueFlow('main-canvas')` 内部已把 nodes/edges 建为响应式数组；写入用实例方法：
- `addNodes(n)` —— 追加
- `setNodes(n)` —— 整体替换
- `fromObject({nodes, edges})` —— 整体还原（含视口等）
- `removeNodes / removeEdges / updateNode` —— 单点删改
- UI 交互（拖拽/连线/删除）由 VueFlow 事件 `@nodes-change/@connect` 自动更新内部数组，代码只做旁路同步（如选中态）。

### 2.2 初始化入口：`useCanvasBootstrap`
文件：`packages/canvas-core/src/composables/useCanvasBootstrap.ts`

**有存档时**（`storage` 存在且 `currentProjectId` 有效，且存档非空）：
```ts
const data = await storage.loadCanvas(currentProjectId)   // 读持久化节点/边
if (data.nodes.length > 0 || data.edges.length > 0) {
  vueFlowInstance.fromObject({ nodes: data.nodes, edges: data.edges })  // 整体灌入
  await nextTick()
  await vueFlowInstance.fitView({ padding: 0.2, duration: 0 })          // 适配视口
  return
}
```

**无存档 / 存档为空时，用写死的默认数据**：
```ts
const fallback = createDefaultCanvasData(makeEdgeData())
vueFlowInstance.addNodes(fallback.nodes)   // 3 个默认节点 '1'/'2'/'3'
vueFlowInstance.addEdges(fallback.edges)
```

默认数据（`createDefaultCanvasData`，行 6-18）：
```ts
const nodes = [
  { id: '1', type: 'custom', position: { x: 200, y: 260 },  data: { label: '输入图像', nodeType: 'image' }, sourcePosition: Position.Right },
  { id: '2', type: 'custom', position: { x: 700, y: 260 },   data: { label: '生成图像', nodeType: 'image' }, ... },
  { id: '3', type: 'custom', position: { x: 1200, y: 260 },  data: { label: '生成图像', nodeType: 'image' }, ... },
]
```

### 2.3 启动时机（顺序很重要）
文件：`Canvas.vue` `onMounted`（行 417-482）

```
1. 更新容器尺寸、注册 ResizeObserver
2. 若 props.plugins 非空：
   - 安装插件 manager（此时注册各节点组件类型 nodeTypes、storage、connection 等）
3. if (!props.skipDefaultLoad) {
     await bootstrap.loadInitialCanvas()   // ← 决定用存档还是默认数据灌入
   }
```

关键注释（`Canvas.vue:567`）：**初始化画布数据必须在所有插件注册完 nodeTypes 之后**，否则 VueFlow 渲染会遇到未注册的节点类型。

注意 `props.skipDefaultLoad`：注释说明"MCP 等外部数据源模式会跳过默认加载，避免覆盖外部注入的节点/边"，即外部注入时由外部先灌、再交给 VueFlow 渲染。

---

## 三、常见困惑点澄清

| 疑问 | 解答 |
|------|------|
| Pinia 是不是节点数据源？ | 不是。只存配置/选中态/类型/插件设置。 |
| `vueFlowInstance.nodes` 与模板 `:nodes` 是两份吗？ | 不是。模板绑的就是实例内部那同一份数组。 |
| 刷新后数据怎么回来？ | `useCanvasBootstrap.loadInitialCanvas` → `storage.loadCanvas` → `fromObject` 灌回。 |
| "自己复制一份管理"在哪存在？ | 不存在。v2（`packages/canvas-core-v2`）的 `nodeStore` 是另一套独立实现（ctx 注入服务），与 v1 不同，不在本次范围。 |

---

## 四、相关文件索引

| 文件 | 作用 |
|------|------|
| `packages/canvas-core/src/Canvas.vue` | 主组件：useVueFlow 单例、模板渲染、onMounted 引导 |
| `packages/canvas-core/src/composables/useCanvasBootstrap.ts` | 初始数据加载（存档 fromObject / 默认 addNodes） |
| `packages/canvas-core/src/composables/useCanvasStore.ts` | Pinia store（不存节点，注释声明节点归 VueFlow 管） |
| `packages/canvas-core/src/composables/useCanvasConnection.ts` | 连线交互，接收 addNodes 等包装方法 |
| `packages/canvas-core/src/composables/useCanvasFlow.ts` | 旧的基础层封装（含 localStorage `canvas-data` 兜底，逻辑与 Bootstrap 类似） |
| `packages/canvas-core/src/plugins/PluginContext.ts` | `createActions(vueFlowInstance)` 插件 action 层 |
| `packages/canvas-core/src/plugins/storage/StoragePlugin.ts` | 存储插件（loadCanvas/save） |
| `packages/canvas-core/src/plugins/backend-sync/BackendSyncPlugin.ts` | 后端同步（replaceAll 灌数据） |

> 注：`useCanvasFlow.ts`（基础层封装）与 `useCanvasBootstrap.ts` 存在相似职责，前者走 localStorage `canvas-data`、后者走 storage 插件的项目存档，需注意两者并非同一入口（`Canvas.vue` 用的是 `useCanvasBootstrap`）。
