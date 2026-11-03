# 迁移计划：消除 Pinia↔VueFlow 双数据绑定

> 目标：VueFlow 成为 nodes/edges 唯一数据源，Pinia 只保留 UI 配置 + 选中态 Set。
> 原则：不改变任何文件的外部 API 接口签名。渐进式替换，每步可验证。

---

## 受影响文件总览（26 个）

| # | 文件 | 操作 | 改动量 |
|---|------|------|--------|
| 1 | `src/canvas/core/useCanvasStore.ts` | **重写**（删 ~180 行） | 大 |
| 2 | `src/canvas/core/Canvas.vue` | **重写** 数据绑定 + 持久化 + 所有 canvas.nodes/edges 引用 | 大 |
| 3 | `src/canvas/core/plugins/PluginContext.ts` | **修改** createActions 去双写 | 中 |
| 4 | `src/canvas/core/plugins/multi-select/SelectionFrame.vue` | **修改** nodes 来源 | 小 |
| 5 | `src/canvas/core/components/CustomEdge.vue` | **不修改**（只读 selected state，仍保留在 Pinia） | 0 |
| 6 | `src/canvas/core/components/Decoration/BaseNode.vue` | **修改** canvas.nodes → vf.getNodes | 小 |
| 7 | `src/canvas/core/components/Decoration/BottomToolbar.vue` | **不修改**（只读 state 配置） | 0 |
| 8 | `src/canvas/core/components/Decoration/TopToolbar.vue` | **不修改**（只读 state 配置） | 0 |
| 9 | `src/canvas/core/components/Decoration/MovingHandle.vue` | **不修改** | 0 |
| 10 | `src/canvas/core/components/nodes/image/ImageTopToolbar.vue` | **修改** canvas.getNodeById/updateNode → vf | 小 |
| 11 | `src/canvas/core/components/nodes/image/ImageBottomToolbar.vue` | **不修改**（只读 state 配置） | 0 |
| 12 | `src/canvas/core/components/nodes/video/VideoTopToolbar.vue` | **不修改**（只读 state 配置） | 0 |
| 13 | `src/canvas/core/components/nodes/video/VideoBottomToolbar.vue` | **不修改** | 0 |
| 14 | `src/canvas/core/components/nodes/text/TextTopToolbar.vue` | **不修改**（只读 state 配置） | 0 |
| 15 | `src/canvas/core/components/nodes/text/TextBottomToolbar.vue` | **不修改** | 0 |
| 16 | `src/canvas/core/components/nodes/stage/StageTopToolbar.vue` | **不修改** | 0 |
| 17 | `src/canvas/core/components/nodes/stage/StageBottomToolbar.vue` | **不修改** | 0 |
| 18 | `src/canvas/core/plugins/history/HistoryPlugin.ts` | **不修改**（全走 context.actions） | 0 |
| 19 | `src/canvas/core/plugins/clipboard/ClipboardPlugin.ts` | **不修改**（全走 context.actions） | 0 |
| 20 | `src/canvas/core/plugins/multi-select/MultiSelectPlugin.ts` | **不修改**（全走 context.actions） | 0 |
| 21 | `src/canvas/core/plugins/auto-save/AutoSavePlugin.ts` | **不修改**（context.actions.getNodes/Edges） | 0 |
| 22 | `src/canvas/core/plugins/storage/StoragePlugin.ts` | **不修改**（自己的持久化逻辑不受影响） | 0 |
| 23 | `src/canvas/core/plugins/group/GroupPlugin.ts` | **不修改**（全走 context.actions） | 0 |
| 24 | `src/canvas/core/plugins/align-guide/AlignGuidePlugin.ts` | **不修改**（全走 context.actions） | 0 |
| 25 | `src/canvas/core/plugins/file-drop/FileDropPlugin.ts` | **不修改**（全走 context.actions） | 0 |
| 26 | `src/canvas/core/Pannel.vue` | **不修改**（只读 state + EdgeType type import） | 0 |

**实际需改动的文件：6 个**

---

## 步骤 1：精简 useCanvasStore.ts

**文件：** `src/canvas/core/useCanvasStore.ts`

### 1.1 删除的内容

```
删除 import: useStorage（保留）
删除: isPersistentNode, isPersistentEdge, toUnselectedNode, toUnselectedEdge（第 24-40 行）
删除: nodesSerializer, edgesSerializer（第 50-68 行）
删除: defaultNodes, defaultEdges（第 220-240 行）
删除: nodes useStorage 声明（第 242 行）
删除: edges useStorage 声明（第 243 行）
删除: getNodeById, getEdgeById（第 245-251 行）
删除: addNode, addNodes, addEdge, addEdges（第 253-270 行）
删除: updateNode, updateEdge（第 273-303 行）
删除: removeNodeById, removeNodesByIds（第 305-331 行）
删除: removeEdgeById, removeEdgesByIds, removeEdgesByNodeIds（第 333-370 行）
删除: updateNodePosition（第 442-447 行）
```

### 1.2 保留的内容

```
保留: EdgeType 类型导出
保留: numberOr 辅助函数
保留: sameStringSet
保留: serializer（但去掉 selected 字段的序列化，只序列化配置）
保留: useCanvasStore() 中的 state ref（配置项全部保留）
保留: useStorage('canvas-state', state, ...)（state 持久化不变）
保留: nodeTypes, edgeTypes
保留: customNodeTypes, customEdgeTypes, registerCustomNodeType, registerCustomEdgeType
保留: connectionState
保留: selectedNodeIds, selectedEdgeIds 在 state 内
保留: setSelectedNodeIds, setSelectedEdgeIds, setSelection, clearSelection
保留: applyNodeSelectChanges, applyEdgeSelectChanges
保留: usePluginStore
```

### 1.3 修改 serializer

去掉 selectedNodeIds/selectedEdgeIds 的序列化（运行时状态，不持久化）：

```typescript
const serializer = {
  read(raw: string) {
    const data = JSON.parse(raw)
    if (!data.plugins) data.plugins = {}
    if (!data.shortcutKeymap) data.shortcutKeymap = {}
    return {
      ...data,
      handleDebug: data.handleDebug ?? false,
      handleRadius: numberOr(data.handleRadius, 86),
      handleRestOffset: numberOr(data.handleRestOffset, 36),
      handleCursorGap: numberOr(data.handleCursorGap, 24),
      handleButtonSize: numberOr(data.handleButtonSize, 32),
      handleOverlap: numberOr(data.handleOverlap, 16),
      connectionSnapDebugVisible: data.connectionSnapDebugVisible ?? false,
      connectionSnapOuterRatio: numberOr(data.connectionSnapOuterRatio, 0.75),
      connectionSnapInnerRatio: numberOr(data.connectionSnapInnerRatio, 0.6),
      connectionSnapHeightRatio: numberOr(data.connectionSnapHeightRatio, 1.35),
      selectionFramePaddingX: numberOr(data.selectionFramePaddingX, 16),
      selectionFramePaddingTop: numberOr(data.selectionFramePaddingTop, 34),
      selectionFramePaddingBottom: numberOr(data.selectionFramePaddingBottom, 16),
      selectedNodeIds: new Set<string>(),   // 运行时重置
      selectedEdgeIds: new Set<string>(),   // 运行时重置
      selectionVersion: 0,
      connectionMode:
        data.connectionMode === 'loose' ? ConnectionMode.Loose : ConnectionMode.Strict,
      selectionMode:
        data.selectionMode === 'partial' ? SelectionMode.Partial : SelectionMode.Full,
    }
  },
  write(value: any) {
    return JSON.stringify({
      ...value,
      selectedNodeIds: [],       // 不持久化选中
      selectedEdgeIds: [],
      selectionVersion: 0,
      connectionMode: value.connectionMode === ConnectionMode.Loose ? 'loose' : 'strict',
      selectionMode: value.selectionMode === SelectionMode.Partial ? 'partial' : 'full',
    })
  },
}
```

### 1.4 修改 return 对象

```typescript
return {
  state,
  // nodes, edges — 删除
  nodeTypes,
  edgeTypes,
  customNodeTypes,
  customEdgeTypes,
  registerCustomNodeType,
  registerCustomEdgeType,
  connectionState,
  // 删除所有 CRUD 方法
  setSelectedNodeIds,
  setSelectedEdgeIds,
  setSelection,
  clearSelection,
  applyNodeSelectChanges,
  applyEdgeSelectChanges,
}
```

---

## 步骤 2：Canvas.vue — 数据绑定 + 持久化改造

**文件：** `src/canvas/core/Canvas.vue`

### 2.1 新增：VueFlow 持久化初始化

在 `<script setup>` 顶部，`useCanvasStore()` 之后：

```typescript
const CANVAS_ID = 'main-canvas'
const vueFlowInstance = useVueFlow(CANVAS_ID)

// ===== 新增：从 localStorage 恢复 nodes/edges =====
const LS_KEY = 'canvas-data'
const defaultNodes: Node[] = [
  { id: '1', type: 'custom', position: { x: 200, y: 260 }, data: { label: '输入图像' }, sourcePosition: Position.Right },
  { id: '2', type: 'custom', position: { x: 700, y: 260 }, data: { label: '生成图像' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: '3', type: 'custom', position: { x: 1200, y: 260 }, data: { label: '生成图像' }, sourcePosition: Position.Right, targetPosition: Position.Left },
]
const defaultEdges: Edge[] = [
  { id: 'e1-2', type: 'custom', source: '1', target: '2', sourceHandle: 'source', targetHandle: 'target',
    data: { edgeType: canvas.state.edgeType, edgeLineWidth: canvas.state.edgeLineWidth,
      edgeColor: canvas.state.edgeColor, edgeDashed: canvas.state.edgeDashed } },
]

const saved = localStorage.getItem(LS_KEY)
if (saved) {
  try {
    const data = JSON.parse(saved)
    // fromObject 会设置 nodes + edges + viewport
    vueFlowInstance.fromObject(data)
    console.log('[Canvas] ✅ 从 localStorage 恢复画布数据')
  } catch (err) {
    console.warn('[Canvas] 恢复失败，使用默认数据:', err)
    vueFlowInstance.addNodes(defaultNodes)
    vueFlowInstance.addEdges(defaultEdges)
  }
} else {
  vueFlowInstance.addNodes(defaultNodes)
  vueFlowInstance.addEdges(defaultEdges)
}
```

### 2.2 新增：持久化 watch

```typescript
// 防抖保存到 localStorage
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const data = vueFlowInstance.toObject()
      // 过滤临时元素
      data.nodes = data.nodes.filter((n: any) => !n.type?.startsWith('temp') && !n.data?.isTemp)
      data.edges = data.edges.filter((e: any) => !e.id?.startsWith('temp-') && !e.data?.isTemp)
      localStorage.setItem(LS_KEY, JSON.stringify(data))
    } catch (err) {
      console.error('[Canvas] 保存失败:', err)
    }
  }, 500)
}

watch(
  [() => vueFlowInstance.nodes.value, () => vueFlowInstance.edges.value],
  scheduleSave,
  { deep: true }
)

// 页面关闭时立即保存
function handleBeforeUnload() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  scheduleSave()
}
window.addEventListener('beforeunload', handleBeforeUnload)
```

**注意：** after this change, StoragePlugin.saveCanvas is still called by AutoSavePlugin. StoragePlugin has its own save logic. We should keep BOTH — VueFlow's `toObject()` for quick restore, and StoragePlugin for project management.

### 2.3 替换：`canvas.nodes` → `vueFlowInstance.getNodes.value` 或 `vueFlowInstance.nodes.value`

| 行号 | 当前代码 | 替换为 |
|------|---------|--------|
| 105 | `canvas.nodes.some(...)` | `vueFlowInstance.getNodes.value.some(...)` |
| 112 | `canvas.nodes.length` | `vueFlowInstance.getNodes.value.length` |
| 150 | `canvas.edges.length` | `vueFlowInstance.getEdges.value.length` |
| 162 | `getNodes.value as Node[]` \|\| `canvas.getNodeById(id)` | `getNodes.value as Node[]`（getNodeById 已删除） |
| 205 | `canvas.edges as any[]` | `getEdges.value as any[]` |
| 256 | `canvas.edges.length + 1` | `getEdges.value.length + 1` |
| 459 | `canvas.nodes as any[]` | `getNodes.value as any[]` |
| 558 | `canvas.nodes as any[]` | `getNodes.value as any[]` |
| 666 | `canvas.nodes as Node[]` | `getNodes.value as Node[]` |
| 684 | `canvas.nodes as Node[]` | `getNodes.value as Node[]` |
| 703 | `canvas.nodes as Node[]` | `getNodes.value as Node[]` |
| 819 | `canvas.edges as any[]` | `getEdges.value as any[]` |
| 1251 | `:nodes="canvas.nodes"` | `:nodes="vueFlowInstance.nodes.value"` |
| 1251 | `:edges="canvas.edges"` | `:edges="vueFlowInstance.edges.value"` |
| 1309 | `:nodes="canvas.nodes"` | `:nodes="vueFlowInstance.getNodes.value"` |

### 2.4 删除：所有画布 → Pinia 的双写

**createConnection（第 267-268 行）：**
```typescript
// 删除 canvas.addEdge(edge)
vueFlowInstance.addEdges([edge])
```

**createNodeFromMenuItem（第 324 行）：**
```typescript
// 删除 canvas.addNode(node)
// 只保留 return node（节点本身不需要手动 add，由后续代码通过 vf.addNodes 添加）
// 但实际上 createNodeFromMenuItem 被多处调用，有的地方需要 add，有的不需要。
// 检查调用点：
//   Line 373: createNodeFromMenuItem → 然后 createConnection → vf.addEdges 会创建边，但节点？
//   Line 386: createNodeFromMenuItem → 直接创建节点，没有 add！
// 所以 createNodeFromMenuItem 需要改为内部调用 vueFlowInstance.addNodes([node])
```

**removeTempConnection（第 341-342 行）：**
```typescript
// 删除 canvas.removeEdgeById / canvas.removeNodeById
vueFlowInstance.removeEdges([pending.tempEdgeId])
vueFlowInstance.removeNodes([pending.tempNodeId])
```

**onMenuSelect（第 369-370 行）：**
```typescript
// 删除 canvas.removeEdgeById / canvas.removeNodeById
vueFlowInstance.removeEdges([...])
vueFlowInstance.removeNodes([...])
```

**createTempConnectionMenu（第 505-528 行）：**
```typescript
// 删除 canvas.addNode / canvas.addEdge
vueFlowInstance.addNodes([tempNode])
vueFlowInstance.addEdges([tempEdge])
```

**removeBatchTempConnection（第 598-601 行）：**
```typescript
// 删除所有 canvas.xxx 行，只保留 vf.xxx
vueFlowInstance.removeEdges(batch.tempEdgeIds)
vueFlowInstance.removeNodes([batch.tempNodeId])
```

**updateBatchTempTarget（第 629 行）：**
```typescript
// 删除 canvas.updateNodePosition(...)
// 只保留 vueFlowInstance.updateNode(...)
```

**onSelectionBatchConnectStart（第 713-739 行）：**
```typescript
// 删除 canvas.addNode / canvas.addEdge
vueFlowInstance.addNodes([tempNode])
// ... edges loop ...
vueFlowInstance.addEdges(tempEdges)
```

### 2.5 onNodesChange/onEdgesChange — 保留选中同步，去掉其他

```typescript
function onNodesChange(changes: any[]) {
  // 删除操作
  const removeChanges = changes.filter((c: any) => c.type === 'remove')
  if (removeChanges.length > 0) {
    const removeIds = removeChanges.map((c: any) => c.id)
    const groupIds = removeChanges
      .filter((c: any) => {
        const node = getNodes.value.find(n => n.id === c.id)
        return node?.type === 'group'
      })
      .map((c: any) => c.id)
    for (const groupId of groupIds) {
      window.dispatchEvent(new CustomEvent('canvas:group:ungroup', { detail: { groupId } }))
    }
    // 清理 selectedNodeIds 中的已删除节点
    for (const id of removeIds) {
      canvas.state.selectedNodeIds.delete(id)
    }
    manager.eventBus.emit('nodesChange', changes)
    return
  }

  // position 变化 → 不需要同步到 Pinia，VueFlow 自己管理
  // （positionChanges 不再处理 pinia 同步）

  // select 变化 → 同步到 Pinia selectedNodeIds
  const selectChanges = changes.filter((c: any) => c.type === 'select')
  if (selectChanges.length > 0) {
    canvas.applyNodeSelectChanges(selectChanges)
  }
}

function onEdgesChange(changes: EdgeChange[]) {
  const removeChanges = changes.filter((c): c is Extract<EdgeChange, { type: 'remove' }> => c.type === 'remove')
  if (removeChanges.length > 0) {
    for (const id of removeChanges.map(c => c.id)) {
      canvas.state.selectedEdgeIds.delete(id)
    }
    manager.eventBus.emit('edgesChange', changes)
    return
  }

  const selectChanges = changes.filter((c): c is Extract<EdgeChange, { type: 'select' }> => c.type === 'select')
  if (selectChanges.length > 0) {
    canvas.applyEdgeSelectChanges(selectChanges)
  }
}
```

### 2.6 getConnectableNode — 移除 Pinia 回退

```typescript
function getConnectableNode(id: string | null | undefined) {
  if (!id) return undefined
  return (getNodes.value as Node[]).find(node => node.id === id)
  // 不再 || canvas.getNodeById(id)
}
```

### 2.7 PluginManager 初始化 — 移除 canvasStore

```typescript
// Line 1168-1174
createPluginContext(pluginName, {
  canvasId: 'main-canvas',
  vueFlowInstance: vueFlowInstance as any,
  // canvasStore: canvas,  ← 删除此行
  pluginManager: manager,
  eventBus: manager.eventBus,
})
```

### 2.8 selection:change 事件处理 — 不变

保留 `manager.eventBus.on('selection:change', ...)` 逻辑不变，因为 Pinia 仍管理 selectedNodeIds。

### 2.9 onUnmounted — 添加 beforeunload 清理

```typescript
onUnmounted(async () => {
  window.removeEventListener('beforeunload', handleBeforeUnload) // ← 新增
  // ... 其余不变
})
```

---

## 步骤 3：PluginContext.ts — createActions 去双写

**文件：** `src/canvas/core/plugins/PluginContext.ts`

### 3.1 修改 createActions 函数

去掉 canvasStore 参数和所有双写：

```typescript
function createActions(vf: VueFlowInstance, logger: Logger) {
  // 不再接收 canvasStore 参数
  return {
    addNodes(nodes: Node[]): void {
      try {
        vf.addNodes(nodes)  // 之前：canvasStore.addNodes?.(nodes) + vf.addNodes(nodes)
      } catch (err) {
        logger.error('actions.addNodes failed:', err)
      }
    },
    removeNodes(ids: string[]): void {
      try {
        vf.removeNodes(ids)  // 之前：canvasStore.removeNodesByIds?.(ids) + vf.removeNodes(ids)
      } catch (err) {
        logger.error('actions.removeNodes failed:', err)
      }
    },
    addEdges(edges: Edge[]): void {
      try {
        vf.addEdges(edges)  // 之前：canvasStore.addEdges?.(edges) + vf.addEdges(edges)
      } catch (err) {
        logger.error('actions.addEdges failed:', err)
      }
    },
    removeEdges(ids: string[]): void {
      try {
        vf.removeEdges(ids)  // 之前：canvasStore.removeEdgesByIds?.(ids) + vf.removeEdges(ids)
      } catch (err) {
        logger.error('actions.removeEdges failed:', err)
      }
    },
    updateNode(id: string, data: Partial<Omit<Node, 'id'>>): void {
      try {
        vf.updateNode(id, data)  // 之前：canvasStore.updateNode?.(id, data) + vf.updateNode(id, data)
      } catch (err) {
        logger.error(`actions.updateNode("${id}") failed:`, err)
      }
    },
    updateEdge(id: string, data: Partial<Omit<Edge, 'id'>>): void {
      try {
        vf.updateEdge(id, data)  // 之前：canvasStore.updateEdge?.(id, data) + vf.updateEdge(id, data)
      } catch (err) {
        logger.error(`actions.updateEdge("${id}") failed:`, err)
      }
    },
    // getNodes, getEdges, addSelectedNodes, removeSelectedNodes, removeSelectedElements — 不变
    getNodes(): Node[] { try { return vf.getNodes.value } catch (err) { ... } },
    getEdges(): Edge[] { try { return vf.getEdges.value } catch (err) { ... } },
    addSelectedNodes(nodes: Node[]): void { try { vf.addSelectedNodes(nodes) } catch (err) { ... } },
    removeSelectedNodes(nodes: Node[]): void { try { vf.removeSelectedNodes(nodes) } catch (err) { ... } },
    removeSelectedElements(): void { try { vf.removeSelectedElements() } catch (err) { ... } },
  }
}
```

### 3.2 修改 createPluginContext 函数签名

```typescript
interface CreatePluginContextOptions {
  canvasId: string
  vueFlowInstance: VueFlowInstance
  // canvasStore: { ... }  ← 删除此字段
  eventBus?: EventBus
  pluginManager?: { getPlugin(name: string): unknown }
}

export function createPluginContext(pluginName: string, options: CreatePluginContextOptions): PluginContext {
  const { canvasId, vueFlowInstance, eventBus = new EventBus(), pluginManager } = options
  // 不再从 options 解构 canvasStore

  // ... logger ...

  // store 创建时 canvasStore 仍然需要（用于 plugins 命名空间 + selectedNodeIds）
  // 但 canvasStore 只需要 state 部分
  // 从 vueFlowInstance 或外部获取 canvasStore reference
  // 方案：保留 canvasStore 参数但只用于 store/selection，不用于 nodes/edges CRUD
}
```

**关于 canvasStore 的保留：** `createPluginStore` 和 `selection` API 仍然需要 Pinia store 来读写 `plugins` 命名空间和 `selectedNodeIds`。所以 `canvasStore` 参数保留在 `CreatePluginContextOptions` 中，但用于传给 `createPluginStore` 和 selection API，`createActions` 不再使用它。

保留 `canvasStore` 但精简其类型：
```typescript
interface CreatePluginContextOptions {
  canvasId: string
  vueFlowInstance: VueFlowInstance
  canvasStore: {
    state: Record<string, any>                 // for store.get/set + selectedNodeIds
    plugins?: Record<string, Record<string, unknown>>
    registerCustomNodeType?(name: string, component: Component): void
    registerCustomEdgeType?(name: string, component: Component): void
    // selectedNodeIds 相关
    selectedNodeIds?: Set<string>
    selectedEdgeIds?: Set<string>
    setSelectedNodeIds?(ids: Iterable<string>): boolean
    setSelectedEdgeIds?(ids: Iterable<string>): boolean
    setSelection?(payload: { nodeIds?: Iterable<string>; edgeIds?: Iterable<string> }): boolean
    clearSelection?(): boolean
    selectionVersion?: number
  }
  eventBus?: EventBus
  pluginManager?: { getPlugin(name: string): unknown }
}
```

### 3.3 修改 selection API

selection API 仍然读写 canvasStore.state.selectedNodeIds/selectedEdgeIds。将 `syncSelectionToVueFlow` 和 selection 对象的逻辑保持不变。

**但简化：** 不再更新 selectionVersion（或保留但只用于下游 computed 触发）。实际上 selectionVersion 在 SelectionFrame.vue 中有使用（第 83 行），需要保留。

所以 selection API 部分**不改动**，保持现有逻辑。

---

## 步骤 4：SelectionFrame.vue — nodes 来源修改

**文件：** `src/canvas/core/plugins/multi-select/SelectionFrame.vue`

### 4.1 props 修改

当前模板传递：
```html
<SelectionFrame :nodes="canvas.nodes" :viewport="..." :vf-instance="vueFlowInstance" ... />
```

改为：
```html
<SelectionFrame :nodes="vueFlowInstance.getNodes.value" :viewport="..." :vf-instance="vueFlowInstance" ... />
```

### 4.2 组件内部

SelectionFrame 内部使用 props.nodes 查找节点：
```typescript
const allNodes = props.nodes
```
这个不变——props.nodes 现在是 VueFlow 的 getNodes.value。

### 4.3 selectionVersion 保留

selectedNodeIds 和 selectionVersion 仍在 Pinia store 中，SelectionFrame 的 computed 依赖不变。

---

## 步骤 5：BaseNode.vue — canvas.nodes 引用替换

**文件：** `src/canvas/core/components/Decoration/BaseNode.vue`

### 5.1 第 90 行：updateNode

```typescript
// 当前
canvas.updateNode(props.id, { data: { ... } })

// 替换为
import { useVueFlow } from '@vue-flow/core'
const vf = useVueFlow()
// ...
vf.updateNode(props.id, { data: { ... } })
```

但这里有个问题：`useVueFlow()` 没有传 id。BaseNode 是 VueFlow 自定义节点组件，它在 VueFlow 组件树内，所以 `useVueFlow()` 应该能拿到父级 VueFlow 实例。

验证：BaseNode 被 CustomNode.vue 渲染，CustomNode 是 VueFlow 的节点模板，在 `<VueFlow>` 的 `node-types` 中注册。所以 `useVueFlow()` 不传 id 应该能通过 inject 拿到实例。

### 5.2 第 157 行：查找节点

```typescript
// 当前
const node = (canvas.nodes as any[]).find((item: any) => item.id === props.id)

// 替换为
const node = vf.getNodes.value.find((item: any) => item.id === props.id)
```

---

## 步骤 6：ImageTopToolbar.vue — getNodeById/updateNode 替换

**文件：** `src/canvas/core/components/nodes/image/ImageTopToolbar.vue`

### 6.1 第 53 行

```typescript
// 当前
const node = canvas.getNodeById(props.id)

// 替换为
import { useVueFlow } from '@vue-flow/core'
const { getNodes } = useVueFlow()
const node = getNodes.value.find(n => n.id === props.id)
```

### 6.2 第 55 行

```typescript
// 当前
canvas.updateNode(props.id, { ... })

// 替换为
const { updateNode } = useVueFlow()
updateNode(props.id, { ... })
```

---

## 验证策略

每完成一个步骤，运行以下验证：

### 编译验证
```bash
cd D:\Code\GitTest\canvas-ai\mini-canvas
npx vue-tsc --noEmit
```

### 功能验证（手动）
1. 打开页面 → 默认节点正常渲染
2. 拖拽节点 → 位置正确更新
3. 连线 → 边正常出现
4. 刷新页面 → 之前的状态恢复
5. 撤销/重做 → 正常
6. 复制/粘贴 → 正常
7. 选中/多选 → 框选正常
8. 创建临时节点连线 → 菜单弹出正常
9. 批量连线 → 正常

---

## 执行顺序（严格依赖）

```
步骤 1（useCanvasStore.ts）     ← 先改 Store，只删不增
  │
步骤 2（Canvas.vue）            ← 数据绑定 + 持久化，大部分改动
  │
步骤 3（PluginContext.ts）      ← createActions 去双写
  │
步骤 4（SelectionFrame.vue）    ← nodes 来源
  │
步骤 5（BaseNode.vue）          ← 节点组件
  │
步骤 6（ImageTopToolbar.vue）   ← 工具栏
```

步骤 1 和 2 之间有依赖（步骤 2 需要步骤 1 删完才能编译通过），不能并行。
步骤 3-6 依赖步骤 2 完成，但 4/5/6 之间相互独立可以并行。

---

## 回滚方案

如果任一步骤出现问题：
1. `git stash` 当前改动
2. 逐步恢复，定位问题
3. 每步改动都是独立的，不影响其他功能
