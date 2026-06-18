# 连接系统分析与优化方案

> 对照 vue-flow v1.48.2 源码和旧 `useCanvasConnection.ts` 实现，给出更优方案。

---

## 一、需求明确

三条硬性规则：

| 规则 | 说明 |
|------|------|
| 端口方向强制 | **左端口（target/输入）只能接收连接，右端口（source/输出）只能发出连接**。禁止 source→source、target→target |
| 连接唯一性 | 两个端口之间（sourceNode:sourceHandle → targetNode:targetHandle）**只能有一条线**，不允许重复 |
| 空白区域松手弹菜单 | 从端口拖出线，松手时没落在任何节点上 → 创建临时虚拟线和节点 → 弹出菜单 → 选择目标节点类型 → 替换为正式节点 |

---

## 二、VueFlow 自带了什么（直接可用的部分）

经过源码分析，两个核心机制在 VueFlow 中已经内置了：

### 2.1 端口方向强制 → `isValidConnection` prop

```typescript
type ValidConnectionFunc = (
  connection: Connection,         // { source, target, sourceHandle, targetHandle }
  elements: {
    edges: GraphEdge[]
    nodes: GraphNode[]
    sourceNode: GraphNode
    targetNode: GraphNode
  }
) => boolean
```

在 `<VueFlow :isValidConnection="validateConnection">` 注册一个回调。VueFlow 在**两个阶段**调用它：
1. 拖拽过程中（实时，决定连接线是绿色还是红色）
2. 边创建时（决定要不要真的建这条边）

**方向验证可以这样写：**

```typescript
function validateConnection(connection: Connection): boolean {
  // 强制 source端口 = 右(source)，target端口 = 左(target)
  if (connection.sourceHandle !== 'source') return false
  if (connection.targetHandle !== 'target') return false
  // 其他业务规则...
  return true
}
```

### 2.2 重复边检测 → `connectionExists()` 函数（VueFlow 内置）

位于 `vue-flow/packages/core/src/utils/graph.ts`：

```typescript
export function connectionExists(edge, elements) {
  return elements.some(el =>
    isEdge(el) &&
    el.source === edge.source &&
    el.target === edge.target &&
    (el.sourceHandle === edge.sourceHandle || (!el.sourceHandle && !edge.sourceHandle)) &&
    (el.targetHandle === edge.targetHandle || (!el.targetHandle && !edge.targetHandle))
  )
}
```

这个函数**在 `addEdgeToStore()` 中自动调用**（path: `addEdges() → createGraphEdges() → addEdgeToStore() → connectionExists()`）。如果发现重复，返回 `false` 静默跳过。

**但有一个前提**：必须是 `Connection` 类型（不带 id），不能用 `Edge` 类型（带 id）。因为 `createGraphEdges` 中对 Edge 类型会跳过 `addEdgeToStore`。

---

## 三、旧实现的问题（和可以优化的点）

对照源码，旧的 `useCanvasConnection.ts` 有几个冗余：

### 问题 1：手动重复检测是多余的

```typescript
// 旧 onConnect() 中的手动检查
const existingEdge = getEdges.value.find((edge: any) =>
  edge.source === params.source &&
  edge.target === params.target &&
  edge.sourceHandle === params.sourceHandle &&
  edge.targetHandle === params.targetHandle
)
```

如果改用 VueFlow 的 `isValidConnection` 做方向验证 + `autoConnect` 模式，这个检查 VueFlow 内部已经做过了（`connectionExists()`）。**可以删除。**

### 问题 2：方向验证分散在多处

旧代码的验证逻辑分散在：
- `onConnect()` 中：`if (params.sourceHandle === 'target' || params.targetHandle === 'source') return`
- `findNearestValidTarget()` 中：`sourceHandle === 'source'`
- `isValidConnection()` 在 CanvasPage.vue 中也有一个（但只检查 `sourcePosition/targetPosition`）

应该集中到 `isValidConnection` 回调中，一处定义，全局生效。

### 问题 3：`handleConnectEnd` 和 VueFlow 原生 `@connect` 的职责不清

旧代码中 `handleConnectEnd` 做了所有事情：找目标、连节点、临时节点、弹菜单。但这里和 VueFlow 原生 `@connect` 存在重叠——如果用户精确对准了 Handle，VueFlow 自己也会走 `@connect` 流程。

**优化方向：** 
- VueFlow `@connect` 负责标准 Handle→Handle 连接（含方向验证、去重）
- `@connect-end` 只负责"没连上→弹菜单"这个 fallback 逻辑

---

## 四、优化后的方案

### 4.1 整体架构

```
<Canvas>
  ├── VueFlow
  │     ├── :connectionMode="Strict"           ← 强制 source↔target
  │     ├── :isValidConnection="validateConn"  ← 方向+去重验证
  │     ├── :autoConnect="false"               ← 不用自动模式（自建控制）
  │     │
  │     ├── @connect="onVueFlowConnect"        ← 标准连接：直接添加边
  │     └── @connect-end="onConnectEnd"        ← 松手：找附近节点 或 弹菜单
  │
  └── ConnectionPlugin (未来插件化)
        ├── useConnectionValidator()   ← isValidConnection 回调工厂
        ├── useBlankConnect()          ← 空白区域松手 → 菜单逻辑
        └── useConnectFeedback()       ← 3D+模糊视觉反馈
```

### 4.2 `isValidConnection` 统一验证工厂

```typescript
// useConnectionValidator.ts
function createConnectionValidator(options: {
  allowedNodeTypes?: string[]
  maxEdgesPerHandle?: number
}) {
  return (connection: Connection, elements: any): boolean => {
    // 规则 1: 端口方向强制——左端口连右端口
    // sourceHandle 必须是 'source'（右端口）
    // targetHandle 必须是 'target'（左端口）
    if (connection.sourceHandle !== 'source') return false
    if (connection.targetHandle !== 'target') return false

    // 规则 2: 不能自己连自己
    if (connection.source === connection.target) return false

    // 规则 3: 允许的节点类型（可选）
    if (options.allowedNodeTypes?.length) {
      const { targetNode } = elements
      if (targetNode && !options.allowedNodeTypes.includes(targetNode.type!)) {
        return false
      }
    }

    // 规则 4: 端口连接数限制（可选）
    if (options.maxEdgesPerHandle) {
      const { edges } = elements
      const existingCount = edges.filter(
        (e: any) => e.target === connection.target && e.targetHandle === 'target'
      ).length
      if (existingCount >= options.maxEdgesPerHandle) return false
    }

    // 重复边检测：VueFlow 的 connectionExists() 会在此之后自动执行
    // 不需要在这里手动检查

    return true
  }
}
```

**为什么不在 `isValidConnection` 里做重复检测？** 因为 VueFlow 的 `connectionExists()` 在 `createGraphEdges()` 中会自动调用，且它比较的是完整的 source+target+handle 组合。在 `isValidConnection` 回调里再检查一次是多余的。

### 4.3 标准连接处理（`@connect`）

```typescript
// 标准 Handle→Handle 连接
function onVueFlowConnect(connection: Connection) {
  // 验证已经通过 isValidConnection 做了
  // 去重已经通过 connectionExists() 做了
  // 这里只需要构建 edge 对象并添加

  const newEdge = {
    ...connection,
    id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
    type: 'flowing',  // 或其他默认线型
    data: {
      edgeType: currentEdgeType.value,
      edgeLineWidth: currentEdgeLineWidth.value,
    },
  }

  addEdges([newEdge])
  // emit('history:record', ...)
}
```

比旧代码少了 10 行方向/重复检查。

### 4.4 空白区域松手 → 弹菜单（`@connect-end`）

这是 VueFlow 不能直接处理的部分。保留旧方案但有优化：

```typescript
function onConnectEnd(event: MouseEvent) {
  // 获取连接状态
  if (!connectingSourceNodeId.value || !connectingSourceHandle.value) return

  // 1. 先试一下：鼠标在某个节点附近 80px 内吗？
  const targetNode = findNearestValidTarget(
    event.clientX, event.clientY,
  )

  if (targetNode) {
    // 找到目标节点 → 直接创建连接
    // （这种情况是：鼠标在节点内部但没对准 Handle）
    const connection: Connection = {
      source: connectingSourceNodeId.value,
      target: targetNode.id,
      sourceHandle: connectingSourceHandle.value,
      targetHandle: 'target',
    }
    // 通过 isValidConnection 验证 → 通过则 addEdges
    if (validateConn(connection, getValidationContext())) {
      addEdges([connection])
    }
    return
  }

  // 2. 鼠标在任何节点上吗？（在节点上但不在 80px 内 → 不管，VueFlow 自己处理）
  if (isMouseOverAnyNode(event.clientX, event.clientY)) {
    // VueFlow 的 @connect 会处理（如果鼠标恰好落在 Handle 上）
    return
  }

  // 3. 鼠标在空白区域 → 创建临时线和菜单
  createTempConnection(event)
}

function createTempConnection(event: MouseEvent) {
  const sourceId = connectingSourceNodeId.value!
  const sourceHandle = connectingSourceHandle.value!
  const canvasRect = getCanvasRect()
  const canvasPos = project({ x: event.clientX - canvasRect.left, y: event.clientY - canvasRect.top })

  // 创建临时节点（不可见）
  const tempNodeId = `temp-${Date.now()}`
  const tempEdgeId = `temp-edge-${Date.now()}`

  addNodes([{
    id: tempNodeId,
    position: canvasPos,
    type: 'temp-target',
    data: {},
  }])

  addEdges([{
    id: tempEdgeId,
    source: sourceId,
    target: tempNodeId,
    sourceHandle,
    targetHandle: 'target',
    type: 'flowing',
    zIndex: 99999,
    data: { isTemp: true },
    class: 'temp-edge',
  }])

  // 打开菜单
  emit('menu:open', {
    mode: 'connection',
    position: { x: event.clientX, y: event.clientY },
    onSelect: (nodeType: NodeType) => confirmTempConnection(nodeType, sourceId, sourceHandle, tempNodeId, tempEdgeId, canvasPos),
    onCancel: () => cancelTempConnection(tempNodeId, tempEdgeId),
  })
}
```

### 4.5 连接函数：统一的 `createConnection()`

把这些逻辑封装成一组对外 API：

```typescript
// useConnectionAPI.ts

interface CreateConnectionOptions {
  sourceNodeId: string
  sourceHandle: string
  targetNodeId: string
  targetHandle?: string          // 默认 'target'
  edgeType?: string              // 默认当前全局线型
  edgeLineWidth?: number         // 默认当前全局线宽
  validateOnly?: boolean         // 只验证不创建
}

interface ConnectionResult {
  success: boolean
  edge?: Edge
  error?: string
  reason?: 'duplicate' | 'invalid-direction' | 'self-connect' | 'node-type-mismatch'
}

function createConnection(
  opts: CreateConnectionOptions,
  context: { validate: ValidConnectionFunc; edges: Edge[]; hasEdge: (source, target, sh, th) => boolean }
): ConnectionResult {
  const { sourceNodeId, sourceHandle, targetNodeId, targetHandle = 'target' } = opts

  // 1. 自连接检查
  if (sourceNodeId === targetNodeId) {
    return { success: false, error: '不能连接自己', reason: 'self-connect' }
  }

  // 2. 方向检查
  if (sourceHandle !== 'source' || targetHandle !== 'target') {
    return { success: false, error: '连接方向错误', reason: 'invalid-direction' }
  }

  // 3. 重复检查（在 validate 之前先快检）
  const connection: Connection = { source: sourceNodeId, target: targetNodeId, sourceHandle, targetHandle }
  if (context.hasEdge(sourceNodeId, targetNodeId, sourceHandle, targetHandle)) {
    return { success: false, error: '连接已存在', reason: 'duplicate' }
  }

  // 4. 自定义验证
  if (!context.validate(connection, getElementsContext())) {
    return { success: false, error: '连接不符合规则', reason: 'node-type-mismatch' }
  }

  // 5. 创建边
  const edge: Edge = {
    ...connection,
    id: `edge-${sourceNodeId}-${targetNodeId}-${Date.now()}`,
    type: opts.edgeType ?? 'flowing',
    data: {
      edgeType: opts.edgeType ?? 'flowing',
      edgeLineWidth: opts.edgeLineWidth ?? 2,
    },
  }

  return { success: true, edge }
}
```

---

## 五、空白区域松手 → 菜单流程（完整梳理）

```
用户在端口上按下鼠标
  ↓ VueFlow: connectStart 事件 → isConnecting = true
用户拖动连线
  ↓ 鼠标经过其他节点 → 3D 倾斜 + 模糊效果
用户松开鼠标在空白区域
  ↓
VueFlow: connectEnd 事件
  ↓ 我们的代码接管
┌─────────────────────────────────────┐
│ 1. 先找附近节点（80px 模糊范围）      │
│ 2. 没找到 → 检查鼠标在节点上吗？      │
│ 3. 也不在 → 进入"空白连接"流程：      │
│                                        │
│  创建临时不可见节点（TempTargetNode）  │
│  创建临时连线（class: temp-edge）      │
│  ┌──────────────────────┐            │
│  │  弹出连接菜单          │            │
│  │  ○ 图片输入节点        │            │
│  │  ○ 视频生成节点        │            │
│  │  ○ 文本节点            │            │
│  │  [取消]                │            │
│  └──────────────────────┘            │
│                                        │
│  用户选择"视频生成节点"                │
│    → 删除临时节点和临时边              │
│    → 在鼠标位置创建正式节点            │
│    → 创建正式连线                      │
│    → 记录历史                          │
│                                        │
│  用户点击"取消"                        │
│    → 删除临时节点和临时边              │
│    → 不创建任何东西                    │
└─────────────────────────────────────┘
```

### 临时节点/边的设计考量

- **TempTargetNode**：1×1px 不可见节点，位置在鼠标松开的画布坐标。它有一个 `target` Handle，让临时线"有地方落"。
- **临时边**：带 `class: 'temp-edge'` 和 `zIndex: 99999`，视觉上置顶。`data.isTemp = true` 标记，自动保存时会被过滤。
- **菜单位置**：用屏幕坐标（`clientX/Y`），渲染在 root 层（不受画布缩放影响）。

---

## 六、旧代码 vs 优化后的对比

| 维度 | 旧实现 | 优化后 | 原因 |
|------|--------|--------|------|
| 方向验证 | 分散在 `onConnect()` + `findNearestValidTarget()` | 集中在 `isValidConnection` | 一处定义，全局生效 |
| 重复边检测 | `getEdges.value.find(...)` 手动检查 | 信任 VueFlow `connectionExists()` | VueFlow 在 `addEdgeToStore` 中自动执行 |
| 连接创建 | `handleConnectEnd` 直接 `addEdges` | `createConnection()` 函数封装 + 通过 `isValidConnection` | 验证和执行分离 |
| 空白区域菜单 | `handleConnectEnd` + `pendingConnection` 引用 | 保持相同逻辑，但通过 `emit('menu:open')` 解耦 | 菜单是独立的插件职责 |
| 连线样式注入 | 手动加 `data.edgeType/edgeLineWidth` | 保持一致 | 这部分没有更好的方案 |

### 你不需要做的

1. **不要自己实现去重逻辑** — `connectionExists()` 已经做了，而且是 O(n) 遍历所有已有边。你的手动 `find` 也是 O(n)，没有性能差异。
2. **不要在 `isValidConnection` 里再去重** — 它在拖拽过程中被高频调用（每次 `mousemove`），把 O(n) 的去重放进去会卡。
3. **不要改用 `autoConnect` 模式** — 因为你需要在空白区域松手时弹菜单，`autoConnect` 模式下 VueFlow 直接调用 `addEdges`，你无法在中间插入"弹菜单"逻辑。保持 `@connect` + `@connect-end` 的自建控制。

---

## 七、给 `05-feature-implementation-guide.md` 的修正

基于以上分析，需要修正的内容：

1. **端口方向规则**：明确 left(target) 只能接收，right(source) 只能发出。用 `isValidConnection` 集中验证。
2. **去重规则**：说明 VueFlow 已内置 `connectionExists()`，不需要手动检查。
3. **空白区域菜单**：流程描述正确（临时节点+临时线+菜单），但需要强调这是在 `@connect-end` 中处理的标准 fallback。
