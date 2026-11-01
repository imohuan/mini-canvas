# 连接线吸附系统详解

> 本文档详细说明 mini-canvas 中连接线拖拽的吸附机制、节点区域划分、以及单条连线与批量连线的实现差异。

## 1. 节点区域划分

拖拽连接线时，每个节点在屏幕上被划分为 **三个独立区域**，每个区域有不同的交互效果：

```
┌─────────────────────────────────────────────────────┐
│                    节点上方 toolbar                   │
├──────────┬──────────────────────────┬───────────────┤
│          │                          │               │
│  吸附区域  │      节点主体区域          │   吸附区域     │
│  (target) │      (body)              │   (source)    │
│  左侧端口  │                          │   右侧端口     │
│          │                          │               │
├──────────┴──────────────────────────┴───────────────┤
│                    节点下方 toolbar                   │
└─────────────────────────────────────────────────────┘
```

### 1.1 三大区域定义

| 区域 | 位置 | 检测函数 | 用途 |
|------|------|----------|------|
| **吸附区域 (Snap Zone)** | 端口附近的窄条 | `findNearestValidTarget` / `findNearestValidSource` | 线条 snap 到端口 + 3D 反馈 + 松开创建连接 |
| **节点主体 (Body)** | 卡片矩形内部 | `findNodeBodyAtPoint` | 3D 反馈 + 松开创建连接（线条跟鼠标走，不 snap） |
| **空白 (Pane)** | 节点外区域 | 无 | 线条跟鼠标走，松开弹菜单 |

### 1.2 吸附区域的精确几何

吸附区域是端口附近的一个**窄条矩形**，由三个参数控制（在设置面板"端口"分组中可调）：

```
         snapHeight (高度)
         ◄──────────►
    ┌─────────────────┐
    │                 │ ▲
    │   吸附区域       │ │
    │                 │ │ snapHeightInScreen
    │                 │ ▼
    └─────────────────┘
    ◄────────────────►
         snapWidth
    = snapOuter + snapInner
```

**参数计算**（基于 `handleRadius` 倍数）：
- `snapOuter = handleRadius × connectionSnapOuterRatio` — 端口**外侧**延伸距离
- `snapInner = handleRadius × connectionSnapInnerRatio` — 端口**内侧**延伸距离
- `snapHeight = handleRadius × connectionSnapHeightRatio` — 吸附区域高度

**target 端口（左侧）吸附区域范围**：
- X 轴：`[rect.left - snapOuter, rect.left + snapInner]`
- Y 轴：`[centerY - snapHeight/2, centerY + snapHeight/2]`

**source 端口（右侧）吸附区域范围**：
- X 轴：`[rect.right - snapInner, rect.right + snapOuter]`
- Y 轴：`[centerY - snapHeight/2, centerY + snapHeight/2]`

**缩放适配**：所有距离乘以 `zoomScale`（节点实际渲染宽度 / 逻辑宽度），保证缩放后吸附区域视觉一致。

### 1.3 区域行为对比

| 行为 | 吸附区域 | 节点主体 | 空白 |
|------|---------|---------|------|
| **临时线位置** | snap 到端口锚点 | 跟鼠标走 | 跟鼠标走 |
| **3D 倾斜反馈** | ✅ valid | ✅ valid | ❌ |
| **松开创建连接** | ✅ 直接创建 | ✅ 直接创建 | ❌ 弹菜单 |
| **hoverNode 状态** | valid | valid | null |

> **关键区别**：吸附区域内，连接线末端会"吸"到端口位置；节点主体内，连接线末端跟鼠标走，但松开仍然创建连接。两种区域都有 3D 反馈。

## 2. 单条连线实现

单条连线使用 VueFlow 的 `#connection-line` slot 渲染，吸附逻辑在 `buildConnectionEdgeProps` 中实现。

### 2.1 事件流

```
用户从端口拖出
  │
  ▼
onConnectStart          ← 记录 sourceNodeId + sourceHandle
  │
  ▼  (鼠标移动，VueFlow 每帧重渲染 connection-line slot)
buildConnectionEdgeProps ← 每帧计算吸附 + 设置 hoverNode
  │   ├─ 遍历 snapZones → 命中则 endX/endY = 端口锚点
  │   ├─ 遍历 feedbackZones → 命中则设 bodyNodeId
  │   └─ 设置 canvas.connectionState.hoverNode (valid/invalid)
  │
  ▼  (松开鼠标)
onConnectEnd            ← 决定创建连接/弹菜单
  │   ├─ 1. findNearestConnectableNode (吸附区域)
  │   │     └─ 命中 → createConnection + emit('connect')
  │   ├─ 2. findNodeBodyAtPoint (节点主体)
  │   │     └─ 命中 → createConnection + emit('connect')
  │   └─ 3. 空白 → hoverTarget = 'pane' (弹菜单)
  │
  ▼
(如果精确命中 Handle)
onConnect               ← VueFlow 原生 connect 事件
  │   └─ createConnection + lastNativeConnectAt = Date.now()
```

### 2.2 buildConnectionEdgeProps 中的吸附计算

这是单条连线的核心：**每帧**都会被 VueFlow 调用，计算连接线末端应该显示在哪。

```typescript
// 1. 为每个有 targetPosition 的节点构建 snapZone
const snapZones = connectableNodes.map(({ node, size, position }) => ({
  id: node.id,
  x: position.x - snapOuter,        // 吸附区域左边界
  y: centerY - snapHeight / 2,      // 吸附区域上边界
  width: snapWidth,                 // snapOuter + snapInner
  height: snapHeight,
  anchorX: position.x,              // snap 到的 X 锚点（端口位置）
  anchorY: centerY,                 // snap 到的 Y 锚点
}))

// 2. 遍历 snapZones，检查鼠标是否在某个区域内
for (const zone of snapZones) {
  if (鼠标在 zone 内) {
    // 检查是否循环/重复
    if (getInvalidConnectionReason(candidateConnection)) {
      invalidNodeId = zone.id
      continue
    }
    // 取距离最近的
    if (distance < bestDistance) {
      endX = zone.anchorX    // ← 线条末端 snap 到端口！
      endY = zone.anchorY
      snappedNodeId = zone.id
    }
  }
}

// 3. 如果没 snap 到端口，检查是否在节点主体上
if (!snappedNodeId && bodyNodeId) {
  // 节点主体也可以连接（但不 snap 线条位置）
  snappedNodeId = bodyNodeId
}

// 4. 设置 hoverNode → 触发 3D 反馈
canvas.connectionState.hoverNode = {
  nodeId: effectiveFeedbackNodeId,
  status: invalidNodeId ? 'invalid' : 'valid',
  flowPosition: nextFeedbackPoint,
}

// 5. 返回修改后的 targetX/targetY → VueFlow 用它渲染线条末端
return { ...connectionLineProps, targetX: endX, targetY: endY }
```

**关键点**：`targetX/targetY` 被修改为端口锚点位置时，VueFlow 渲染的连接线末端就"吸"过去了。节点主体命中时不修改 `targetX/targetY`，所以线条跟鼠标走。

### 2.3 onConnectEnd 中的三层判定

松开鼠标时的处理（和 `buildConnectionEdgeProps` 的区域判定一致，但这里是"最终决策"）：

```typescript
function onConnectEnd(event) {
  // 1. 吸附区域 → 创建连接
  const targetNode = findNearestConnectableNode(point.x, point.y, sourceHandle, sourceNodeId)
  if (targetNode) {
    createConnection(connection, 'snap')
    eventBus?.emit('connect', connection)  // ← 通知 ContextMenuPlugin
    return
  }

  // 2. 节点主体 → 创建连接
  const bodyNode = findNodeBodyAtPoint(point.x, point.y, [sourceNodeId])
  if (bodyNode) {
    createConnection(connection, 'snap')
    eventBus?.emit('connect', connection)
    return
  }

  // 3. 空白 → 弹菜单
  canvas.connectionState.hoverTarget = { type: 'pane' }
}
```

### 2.4 ContextMenuPlugin 的 connectEnd 协调

`ContextMenuPlugin` 也监听 `connectEnd` 事件，用于弹菜单。两个 handler 通过 `lastNativeConnectAt` 时间戳协调：

```
composable.onConnect  → lastNativeConnectAt = Date.now()
composable.onConnectEnd → 检查 Date.now() - lastNativeConnectAt < 80ms
                          ├─ 是 → 说明 @connect 已处理，跳过
                          └─ 否 → 执行吸附/主体判定

ContextMenuPlugin.connect handler → lastNativeConnectAt = Date.now()
ContextMenuPlugin.connectEnd handler → 检查 < 80ms
                          ├─ 是 → 说明已处理，跳过
                          └─ 否 → 弹菜单
```

> **重构时的 bug**：`useCanvasConnection` 没传 `eventBus`，导致 `eventBus?.emit('connect')` 是 no-op，`ContextMenuPlugin` 的 `connect` handler 收不到事件，`lastNativeConnectAt` 保持 0，`connectEnd` handler 的 `< 80ms` 检查永远不通过，覆盖了 composable 的 `hoverTarget`/`snapTarget`。

## 3. 批量连线实现

批量连线（多选后从 SelectionFrame 拖出）不使用 VueFlow 的 `#connection-line` slot，而是创建**临时节点 + 临时边**来模拟多条连接线。

### 3.1 事件流

```
用户从 SelectionFrame 拖出
  │
  ▼
onSelectionBatchConnectStart  ← 创建临时节点 + N 条临时边
  │   ├─ addNodes(tempTarget node)
  │   ├─ addEdges(N temp edges)
  │   └─ 绑定 document mousemove/mouseup
  │
  ▼  (鼠标移动)
onBatchConnectMove
  ├─ updateBatchTempTarget    ← 更新临时节点位置（含 snap）
  └─ updateBatchConnectFeedback ← 更新 hoverNode (3D 反馈)
  │
  ▼  (松开鼠标)
onBatchConnectEnd             ← 决定创建连接
  │   ├─ removeBatchTempConnection (先删除临时元素)
  │   ├─ 1. findNearestValidTarget (吸附区域)
  │   │     └─ 命中 → 为每个源节点 createConnection
  │   ├─ 2. findNodeBodyAtPoint (节点主体)
  │   │     └─ 命中 → 为每个源节点 createConnection
  │   └─ 3. 空白 → 不创建
  │
  ▼
resetBatchConnectState        ← 清理状态 + 解绑事件
```

### 3.2 updateBatchTempTarget 中的 snap 逻辑

**这是批量连线视觉吸附的核心**。和单条连线的 `buildConnectionEdgeProps` 对应：

```typescript
function updateBatchTempTarget(point) {
  // 只在吸附区域内才 snap（不用 findNodeBodyAtPoint 回退！）
  let snapNode = null
  if (batch.type === 'source') {
    snapNode = findNearestValidTarget(point.x, point.y, ...)
  } else {
    snapNode = findNearestValidSource(point.x, point.y, ...)
  }

  if (snapNode) {
    // snap 到端口位置 → 临时节点"吸"过去
    const cardRect = getNodeCardFlowRect(snapNode.id, ...)
    position = batch.type === 'source'
      ? { x: cardRect.x, y: cardRect.y + cardRect.height / 2 }         // 左侧端口
      : { x: cardRect.x + cardRect.width, y: cardRect.y + cardRect.height / 2 }  // 右侧端口
  } else {
    // 不在吸附区域 → 跟鼠标走
    position = toFlowPosition(viewport.value, point.x, point.y)
  }
  updateNode(batch.tempNodeId, { position })
}
```

> **关键区别**：`updateBatchTempTarget` **只用 `findNearestValidTarget`/`findNearestValidSource`** 检测吸附区域。不会用 `findNodeBodyAtPoint` 做 snap 回退。节点主体命中时，临时节点跟鼠标走，3D 反馈由 `updateBatchConnectFeedback` 处理。

### 3.3 updateBatchConnectFeedback 中的区域反馈

`updateBatchConnectFeedback` 负责设置 `hoverNode`（3D 倾斜效果），它的检测是**两层**的：

```typescript
function updateBatchConnectFeedback(point) {
  // 1. 先查吸附区域
  feedbackNode = findNearestValidTarget(point.x, point.y, ...)

  // 2. 吸附区域没命中 → 回退到节点主体
  if (!feedbackNode) {
    const bodyNode = findNodeBodyAtPoint(point.x, point.y, ...)
    if (bodyNode && bodyNode.targetPosition) feedbackNode = bodyNode
  }

  // 3. 设置 hoverNode → 触发 3D 反馈
  canvas.connectionState.hoverNode = {
    nodeId: feedbackNode.id,
    status: invalidNode ? 'invalid' : 'valid',
    ...
  }
}
```

> **两层检测**的原因：`feedback` 函数需要同时覆盖吸附区域和节点主体——两个区域都要有 3D 反馈。但 `tempTarget` 函数只需要吸附区域——只有吸附区域才 snap 位置。

### 3.4 onBatchConnectEnd 中的三层判定

和单条连线的 `onConnectEnd` 一致：

```typescript
function onBatchConnectEnd(event) {
  // 1. 吸附区域 → 为每个源节点创建连接
  const targetNode = findNearestValidTarget(point.x, point.y, ...)
  if (targetNode) {
    for (const sourceNode of sourceNodes) {
      createConnection({ source: sourceNode.id, target: targetNode.id, ... })
    }
    return
  }

  // 2. 节点主体 → 为每个源节点创建连接
  const bodyNode = findNodeBodyAtPoint(point.x, point.y, ...)
  if (bodyNode && bodyNode.targetPosition) {
    for (const sourceNode of sourceNodes) {
      createConnection({ source: sourceNode.id, target: bodyNode.id, ... })
    }
  }
  // 3. 空白 → 不创建
}
```

## 4. 3D 反馈效果

3D 倾斜效果在 `BaseNode.vue` 中实现，由 `canvas.connectionState.hoverNode` 驱动：

```typescript
// 是否显示 3D 反馈
const showConnectFeedback = computed(() =>
  canvas.isConnecting &&
  canvas.connectionState.activeConnection?.sourceNodeId !== props.id &&
  !isInvalidConnectionTarget.value &&
  (
    isHovered.value ||
    (canvas.connectionState.hoverNode?.nodeId === props.id &&
     canvas.connectionState.hoverNode?.status === 'valid')
  )
)

// 3D 变换
const cardTransform = computed(() => {
  if (!showConnectFeedback.value) return ''
  const p = feedbackMousePosition.value
  const rotateX = (p.y - 0.5) * 18  // 绕 X 轴旋转
  const rotateY = (p.x - 0.5) * -18 // 绕 Y 轴旋转
  return `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px) scale(1.018)`
})
```

**触发条件**：
- 正在拖线（`isConnecting === true`）
- 不是拖线起点节点
- 不是禁止连接节点
- 鼠标悬停在此节点上 **或** `hoverNode.nodeId === props.id && status === 'valid'`

> `hoverNode` 由 `buildConnectionEdgeProps`（单条）或 `updateBatchConnectFeedback`（批量）设置。只要鼠标在吸附区域或节点主体内，就会设置 `hoverNode`，触发 3D 效果。

## 5. 重构中遇到的 Bug 记录

### Bug 1: eventBus 未传入 composable

**现象**：重构后单节点拖拽连接线到节点上，3D 动效有但吸附不生效。

**根因**：`useCanvasConnection` 创建时未传 `eventBus`，导致 `eventBus?.emit('connect')` 是 no-op。`ContextMenuPlugin` 收不到 `connect` 事件，`lastNativeConnectAt` 保持 0，`connectEnd` handler 的 `< 80ms` 检查永远不通过，覆盖了 composable 的 `hoverTarget`/`snapTarget`。

**修复**：`Canvas.vue` 中 `const manager = new PluginManager()` 提前到 composable 之前，传入 `eventBus: manager.eventBus`。

### Bug 2: 批量连线无视觉吸附

**现象**：批量连线拖到吸附区域有 3D 反馈，但临时线不 snap 到端口。

**根因**：`updateBatchTempTarget` 只跟鼠标走，缺少 snap 到端口的逻辑。

**修复**：`updateBatchTempTarget` 加入 snap 逻辑——`findNearestValidTarget`/`findNearestValidSource` 找到目标时，临时节点位置 snap 到目标端口位置。

### Bug 3: 节点主体也 snap

**现象**：鼠标移动到节点主体上时，临时线也 snap 到端口了。

**根因**：`updateBatchTempTarget` 中加了 `findNodeBodyAtPoint` 作为 snap 回退。但节点主体和吸附区域是两个独立区域——吸附区域 snap，节点主体不 snap。

**修复**：`updateBatchTempTarget` 只用 `findNearestValidTarget`/`findNearestValidSource` 检测吸附区域。`findNodeBodyAtPoint` 只在 `updateBatchConnectFeedback`（3D 反馈）和 `onBatchConnectEnd`（松开判定）中使用，不参与 snap 位置计算。

### Bug 4: 批量连线不动

**现象**：批量连线开始后，临时线固定在原地不跟随鼠标。

**根因**：`onSelectionBatchConnectStart` 末尾漏了 `document.addEventListener('mousemove'/'mouseup')` 全局事件绑定。

**修复**：补上全局 mousemove/mouseup/blur/pointercancel 事件绑定。

### Bug 5: 批量连线 z-index 在节点下方

**现象**：批量连线的临时边在节点下方，被节点遮挡。

**根因**：VueFlow 的 `.vue-flow__edges` 默认 z-index 低于 `.vue-flow__nodes`。

**修复**：Canvas.vue 加 CSS `.is-batch-connecting .vue-flow__edges { z-index: 10 !important; }`。注意不能加 `position: relative`，会破坏 `.vue-flow__container` 的 `position: absolute` 导致容器塌缩。

## 6. 文件索引

| 文件 | 职责 |
|------|------|
| `composables/useCanvasConnection.ts` | 连接线核心逻辑（吸附计算、验证、创建、批量连线） |
| `composables/useCanvasStore.ts` | Pinia store，持有 `connectionState` |
| `Canvas.vue` | VueFlow 组件绑定，composable 初始化 |
| `components/Decoration/BaseNode.vue` | 节点渲染，3D 反馈效果 |
| `components/Decoration/MovingHandle.vue` | 端口渲染 |
| `plugins/multi-select/SelectionFrame.vue` | 多选框，触发批量连线 |
| `plugins/context-menu/ContextMenuPlugin.ts` | 右键菜单 + 连线拖拽菜单协调 |
| `plugins/types.ts` | `ConnectionState` / `HoverTarget` 等类型定义 |
