# Vue Flow 架构分析

> 本文基于 `@vue-flow/core` v1.48.2 源码分析。理解 Vue Flow 的内部机制是实现插件的先决条件。

---

## 一、整体架构

Vue Flow 不是简单的 UI 库，而是一套完整的**画布运行时**。它管理节点/边的完整生命周期，从 DOM 渲染到事件分发到坐标变换。

```
VueFlow.vue (根组件)
├── [Props 入口, Slots 分发, Emit 桥接]
├── useVueFlow() → Storage.create(id, opts)
│   ├── useState()        → reactive(state)  -- 所有运行时状态
│   ├── useActions()      → 状态操作方法
│   ├── useGetters()      → 派生计算属性
│   └── createHooks()     → EventHook System -- 事件分发系统
│
├── Viewport.vue (视口层 / d3-zoom)
│   ├── Pane.vue (交互区域, 处理点击/拖拽/框选)
│   ├── Transform.vue (CSS transform 应用画布变换)
│
├── EdgeRenderer.vue (边渲染)
│   └── EdgeWrapper.ts (每个边的容器, 计算位置/处理更新)
│       ├── 解析 edge 组件 (slot → template → prop → global)
│       ├── 计算 source/target handle 锚点
│       └── EdgeAnchor (重连手柄)
│
└── NodeRenderer.vue (节点渲染)
    └── NodeWrapper.ts (每个节点的容器, useDrag/DOM 测量)
        ├── ResizeObserver → 更新节点尺寸
        ├── useDrag (d3-drag) → 拖拽/选中/平移
        ├── 解析 node 组件 (slot → template → prop → global)
        └── Handle 子组件 (端口渲染)
```

**核心设计：多实例 Storage 单例**

Vue Flow 不使用 Pinia/Vuex，而是自建 `Storage` 类管理多实例。同一页面可以有多个 VueFlow 实例，每个由 `id` 区分。这对插件系统很重要——插件需要知道自己在哪个实例中运行。

```typescript
class Storage {
  flows: Map<string, VueFlowStore>
  
  create(id, preloadedState): VueFlowStore {
    const state = reactive(useState())   // 响应式状态
    const hooks = createHooks()         // EventHook System
    const actions = useActions(state)   // 方法
    const getters = useGetters(state)   // 计算属性
    return { ...hooks, ...getters, ...actions, ...toRefs(state) }
  }
}
```

---

## 二、状态管理

### 2.1 核心状态 (State)

| 分类 | 关键字段 | 说明 |
|------|----------|------|
| 元素 | `nodes`, `edges` | 运行时节点/边数组 |
| 元素查找表 | `nodeLookup`, `edgeLookup`, `connectionLookup` | Comupted Map，O(1) 查找 |
| 视口 | `viewport: { x, y, zoom }` | 画布变换参数 |
| 尺寸 | `dimensions: { width, height }` | 视口容器尺寸 |
| 交互控制 | `nodesDraggable`, `elementsSelectable` 等 | 布尔开关 |
| 连接状态 | `connectionStartHandle`, `connectionPosition` | 拖拽连线的临时状态 |
| 组件注册 | `nodeTypes`, `edgeTypes` | 自定义组件映射表 |

**关键的设计决策：直接 mutate 而非不可变更新。** 状态是 `reactive()` 包装的普通对象，actions 直接修改属性。这意味着插件可以直接操作状态而不用担心不可变数据带来的开销。

### 2.2 Actions（操作方法）

```typescript
// 元素管理
setNodes(nodes) / setEdges(edges)      // 整体替换
addNodes(nodes) / addEdges(edges)       // 追加（生成 ID）
removeNodes(ids) / removeEdges(ids)     // 移除（支持级联删除子节点）

// 选择管理
addSelectedNodes(ids) / removeSelectedNodes(ids)

// 视图操作
setViewport({ x, y, zoom })
fitView(options)
zoomIn() / zoomOut()

// 导出/导入
toObject() / fromObject(obj)           // 完整状态序列化
```

### 2.3 Getters（计算属性）

| 属性 | 说明 |
|------|------|
| `getNodes` | 支持 `onlyRenderVisibleElements` 时的可见节点过滤，返回 `GraphNode[]`（包含 `dimensions`, `handleBounds`, `computedPosition` 等运行时字段） |
| `getEdges` | 返回 `GraphEdge[]`（包含 `sourceNode`, `targetNode` 引用和渲染用的 `sourceX/Y`, `targetX/Y` 等坐标） |
| `getSelectedNodes / Edges` | 当前选中的元素 |
| `nodeLookup` / `edgeLookup` | `Map<id, element>` 快速查找 |

**重点：** `getNodes` 和 `getEdges` 是 computed 属性，它们是响应式的。但它们返回的是 `GraphNode`（运行时增强版），比用户传入的 `Node` 多出 `dimensions`, `handleBounds`, `computedPosition` 等运行时字段。

---

## 三、EventHook System（事件系统）

这是插件架构最关键的部分。

### 3.1 事件触发流程

Vue Flow 的事件系统基于自定义的 `EventHookExtended`（对 VueUse `EventHook` 的扩展）。

```
事件触发 (trigger)
├── emitter (Vue emit)              → 总是调用（Vue 组件层面 @eventName）
├── if hasListeners()
│   ├── 用户注册的 listeners        → useVueFlow().onEventName(fn)
│   └── 默认处理器 (defaultHandler)  → 当没有用户监听时的内置处理
```

这种分层设计意味着：**用户监听器可以完全替代默认行为**（通过 `onNodesChange` 而不用 VueFlow 自带的 `applyNodeChanges`）。

### 3.2 事件类型全景

| 分类 | 事件 | 触发时机 |
|------|------|----------|
| **节点** | `nodeClick/DoubleClick` | 点击/双击节点 |
| | `nodeMouseEnter/Move/Leave` | 鼠标进出节点 |
| | `nodeDrag/DragStart/DragStop` | 节点拖拽 |
| | `nodeContextMenu` | 节点右键 |
| **边** | `edgeClick/DoubleClick` | 点击/双击边 |
| | `edgeMouseEnter/Move/Leave` | 鼠标进出边 |
| | `edgeUpdate/UpdateStart/UpdateEnd` | 拖拽边的端点重新连接 |
| | `edgeContextMenu` | 边右键 |
| **连接** | `connect/Start/End` | 创建连接的完整流程 |
| | `clickConnectStart/End` | 点击连接模式（connectOnClick=true 时） |
| **选择** | `selectionStart/End` | 框选开始/结束 |
| | `selectionDragStart/Drag/DragStop` | 拖拽选择框移动 |
| | `selectionContextMenu` | 选择框右键 |
| **视口** | `viewportChange/Start/End` | 缩放/平移 |
| | `move/Start/End` | 画布平移 |
| **Pane** | `paneClick/ContextMenu/Scroll` | 画布空白区域交互 |
| | `paneMouseEnter/Move/Leave` | 鼠标进出画布空白区域 |
| **MiniMap** | `miniMapNodeClick/DoubleClick/MouseEnter/MouseMove/MouseLeave` | 小地图节点交互 |
| **系统** | `nodesChange/edgesChange` | 节点/边的任何属性变更 |
| | `nodesInitialized` | 所有节点首次渲染完成 |
| | `init` (paneReady 已弃用) | VueFlow 初始化完成 |
| | `updateNodeInternals` | 手动触发节点重新计算 |
| | `error` | VueFlowError 错误通知 |

### 3.3 Change 系统

`nodesChange` 和 `edgesChange` 是变更驱动系统的核心。每次节点/边状态改变（位置、选中、尺寸、添加、删除），都会触发：

```typescript
type NodeChange = {
  type: 'select' | 'position' | 'dimensions' | 'add' | 'remove'
  id: string
  selected?: boolean
  position?: { x: number; y: number }
  dimensions?: { width: number; height: number }
}
```

**默认行为：** 当没有用户注册 `onNodesChange` 监听器时，VueFlow 自动调用 `applyNodeChanges()` 应用所有变更。当用户注册了监听器且返回 `true` 时，用户接管变更处理。

---

## 四、Handle（端口）系统

Handle 是连接线的锚点，也是插件要改造的核心对象之一。

### 4.1 Handle 的 DOM 结构

```html
<div class="vue-flow__handle connectable" 
     data-id="{flowId}-{nodeId}-{handleId}-{type}"
     data-handleid="{handleId}"
     data-nodeid="{nodeId}"
     data-handlepos="{position: Top/Bottom/Left/Right}">
</div>
```

关键：`data-*` 属性是 Vue Flow 识别 Handle 的方式。自定义端口必须保持这些属性。

### 4.2 Handle 的位置计算

Handle 的实际渲染位置通过 `handleBounds` 存储：

```typescript
interface HandleElement {
  id: string
  type: 'source' | 'target'
  nodeId: string
  position: Position          // Top/Bottom/Left/Right
  x: number                   // 相对节点左上角的 x 偏移（画布坐标）
  y: number                   // 相对节点左上角的 y 偏移（画布坐标）
  width: number
  height: number
}
```

`getHandleBounds(type, nodeElement, nodeBounds, zoom)` 在每次节点尺寸变化时重新计算。

### 4.3 连接流程

```
pointerdown on Handle
  → startConnection()  设置 connectionStartHandle
  → emits.connectStart()
  
pointermove
  → getClosestHandle()  查找最近可连接 Handle
  → isValidHandle()     验证连接有效性
  → updateConnection()  更新连接预览
  → 高亮目标 Handle
  
pointerup
  → if valid: emits.connect(connection)
  → emits.connectEnd()
  → endConnection()
```

`getClosestHandle` 在 `connectionRadius + 250px` 范围内搜索附近节点的所有 Handle（source + target），返回欧几里德距离最近的那个。

### 4.4 连接模式

| 模式 | 行为 |
|------|------|
| `Strict` (严格) | 只允许 source <-> target 互连 |
| `Loose` (宽松) | 任何不同节点/Handle 均可连接 |

---

## 五、节点拖拽系统

### 5.1 拖拽架构

基于 **d3-drag** 实现：

```
d3-drag filter (排除 .nodrag, 检查 dragHandle)
├── start: 记录起始状态, 检查阈值
├── drag:  calculateNextPosition → updateNodes → updateNodePositions
│   ├── getDragItems()  收集所有选中 + 可拖拽节点
│   ├── handleNodeClick()  处理选择
│   ├── calcNextPosition()  算位置 (考虑 extent 约束 + snapToGrid)
│   └── autoPan()  边缘自动平移
└── end: 标记 dragging=false, 触发 DragStop 事件
```

### 5.2 `getDragItems()` 逻辑

拖拽一个节点时，所有选中的节点会一起移动：

```typescript
getDragItems(nodeLookup, nodesDraggable, mousePos, nodeId):
  遍历所有节点:
    1. node.selected || node.id === nodeId     → 被选中或正在被拖拽
    2. parentNode 未被选中                      → 避免双重移动
    3. node.draggable !== false                 → 可拖拽
    4. 记录 position、extent 等
  返回 NodeDragItem[]
```

### 5.3 位置约束

```typescript
calcNextPosition(node, nextPosition):
  1. 解析 extent 配置 (绝对范围/父节点约束/内边距)
  2. 如果 snapToGrid: 吸附到网格
  3. clamp 位置在 extent 内
  返回 { position (相对父节点), computedPosition (绝对坐标) }
```

---

## 六、坐标系统

Vue Flow 有三个坐标层：

| 坐标层 | 说明 | 转换函数 |
|--------|------|----------|
| Screen Coordinates | 鼠标事件的 clientX/clientY | - |
| Flow Coordinates | 画布逻辑坐标 | `screenToFlowCoordinate(pos)` |
| DOM Coordinates | CSS transform 后的渲染位置 | `rendererPointToPoint(pos)` |

转换公式：
```
Flow Coord = (Screen Coord - viewport.x - containerOffset) / viewport.zoom
Screen Coord = Flow Coord * viewport.zoom + viewport.x + containerOffset
```

---

## 七、组件注册机制

Vue Flow 的"扩展点"主要通过组件注册：

### 节点组件解析优先级
1. **Slot**: `<template #node-myType="props">`
2. **template 属性**: `node.template` (字符串或 Component)
3. **nodeTypes prop**: `:node-types="{ myType: Component }"`
4. **全局注册**: `resolveComponent('myType')`
5. **default**: `nodeTypes.default` (默认节点)

### 边组件同样逻辑
1. `<template #edge-myType="props">` 优先
2. `edgeTypes` prop
3. 全局注册
4. 默认边

---

## 八、State 默认值速查

> 以下值为 `@vue-flow/core` v1.48.2 `store/state.ts` 中的实际默认值，对照源码核实。

| 属性 | 默认值 | 说明 |
|------|--------|------|
| `connectionMode` | `ConnectionMode.Loose` | 宽松模式（任意类型互连） |
| `connectionRadius` | `20` | 连接搜索半径（px） |
| `connectOnClick` | `true` | 点击两次 Handle 建立连接 |
| `nodesConnectable` | `true` | 节点可连接 |
| `nodesDraggable` | `true` | 节点可拖拽 |
| `nodeDragThreshold` | `1` | 拖拽启动阈值（px） |
| `elementsSelectable` | `true` | 元素可选中 |
| `selectNodesOnDrag` | `true` | 拖拽时自动选中节点 |
| `selectionMode` | `SelectionMode.Full` | 完全包含才算选中 |
| `snapToGrid` | `false` | 网格吸附 |
| `snapGrid` | `[15, 15]` | 网格尺寸 |
| `elevateNodesOnSelect` | `true` | 选中时提升 z-index |
| `elevateEdgesOnSelect` | `false` | 选中边不提升 z-index |
| `autoPanOnNodeDrag` | `true` | 拖拽时自动平移 |
| `autoPanOnConnect` | `true` | 连接时自动平移 |
| `autoPanSpeed` | `15` | 自动平移速度 |
| `minZoom` | `0.5` | 最小缩放 |
| `maxZoom` | `2` | 最大缩放 |

> mini-canvas 项目使用了一些不同于默认值的选择（如 `connectionMode: Strict`、`selectionMode: 'partial'`），这是产品决策，不是错误。

---

## 九、对插件系统的影响

从以上分析可以得出：

### 优势
1. **EventHook System** 天然适合作为插件的"钩子点"——插件可以监听任何事件
2. **Reactive State** 使插件可以通过 `useVueFlow()` 直接读写画布状态
3. **组件注册机制** 支持动态添加节点/边类型
4. **Provide/Inject** 可用于插件内部的上下文传递

### 局限
1. **没有插件生命周期**：Vue Flow 不提供 install/uninstall 机制，需要自行实现
2. **没有依赖管理**：多个插件之间的依赖需要自行处理
3. **事件没有优先级**：所有 EventHook 监听器同级触发，无法控制执行顺序
4. **事件冲突**：多个插件监听同一事件时可能互相干扰
5. **没有能力声明**：插件无法声明"我需要访问哪些 API"

### 设计启示
- 插件系统需要在 Vue Flow 之上构建一层抽象
- 插件应该通过统一的 PluginContext 访问画布能力，而不是直接调用 `useVueFlow()`
- 需要 plugin → plugin 的事件通信机制
- 依赖应该在 install 时校验
- 生命周期要支持 init/destroy/activate/deactivate
