# 连线拖拽菜单逻辑迁移到 ContextMenuPlugin 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把"从端口拖到空白弹出节点选择菜单"的逻辑从 `Canvas.vue` 迁移到 `ContextMenuPlugin`，并修复"松开在节点上仍弹菜单"、"吸附到节点后仍弹菜单"两个判定 bug。

**Architecture:**
- 状态层：`useCanvasStore.connectionState` 重构，合并冗余字段，新增 `hoverTarget` / `snapTarget` / `tempConnection` 等用于判定的字段。`ConnectionState` 通过 `PluginContext.connectionState` 暴露给插件。
- 行为层：`ContextMenuPlugin` 监听 `connectEnd` 事件，读取 `connectionState` 判定 `canShowMenu`，命中则创建临时节点+边并 emit `connectionContextMenu`，临时节点生命周期在插件内闭环。
- 入口层：`Canvas.vue` 只保留事件转发和"鼠标位置/源信息"等原始事实写入，删除吸附/主体命中/临时节点创建等业务逻辑。删除 dead code `useCanvasConnection.ts`。

**Tech Stack:** Vue 3 Composition API, VueFlow, TypeScript, Pinia-style store

---

## 任务依赖关系

```
Task 1 (类型定义) ─┬─→ Task 2 (store 重构) ─┬─→ Task 4 (PluginContext 扩展)
                   │                         │
                   └─→ Task 3 (BaseNode 适配)─┤
                                             │
                                             ├─→ Task 5 (ContextMenuPlugin 改造)
                                             │
                                             └─→ Task 6 (Canvas.vue 瘦身)
                                                  │
                                                  ├─→ Task 7 (回归验证)
                                                  │
                                                  └─→ Task 8 (清理 dead code + 提交)
```

---

## Task 1: 定义 `HoverTarget` 和 `ConnectionState` 类型

**Files:**
- Modify: `src/canvas/core/plugins/types.ts`

**Step 1: 在 `types.ts` 末尾追加类型定义**

在 `types.ts` 文件末尾追加：

```typescript
// ============================================================================
// 连线拖拽状态
// ============================================================================

/** 鼠标下方的目标类型（实时判定，用于菜单触发条件） */
export type HoverTarget =
  | { type: 'pane' }                                                       // 画布空白
  | { type: 'node'; nodeId: string }                                       // 节点主体
  | { type: 'node-handle'; nodeId: string; handle: 'source' | 'target' }   // 节点端口
  | { type: 'toolbar'; nodeId: string; position: 'top' | 'bottom' }        // 节点工具栏
  | { type: 'edge'; edgeId: string }                                       // 已存在连线
  | { type: 'connection-line' }                                            // 拖拽中的临时线
  | { type: 'overlay' }                                                    // 其他 UI 覆盖层
  | null                                                                   // 画布外

/** 拖线时悬停目标节点的反馈状态（合并原 hover/invalid 两组字段） */
export interface ConnectionHoverNode {
  nodeId: string
  status: 'valid' | 'invalid'
  flowPoint: Point
  message?: string
}

/** 吸附目标 */
export interface ConnectionSnapTarget {
  nodeId: string
  isSnapped: boolean
}

/** 临时连接节点信息（拖到空白时创建） */
export interface TempConnection {
  tempNodeId: string
  tempEdgeId: string
  flowPosition: Point
}

/** 活动连接源信息 */
export interface ActiveConnection {
  sourceNodeId: string
  sourceHandle: 'source' | 'target'
}

/** 连线拖拽完整状态 */
export interface ConnectionState {
  /** null = 未拖线；非 null = 正在拖 */
  activeConnection: ActiveConnection | null

  /** 拖线时悬停目标节点的反馈状态 */
  hoverNode: ConnectionHoverNode | null

  /** 吸附目标（拖线时实时计算） */
  snapTarget: ConnectionSnapTarget | null

  /** 鼠标当前位置（画布坐标） */
  mouseFlowPosition: Point | null

  /** 鼠标当前位置（屏幕坐标） */
  mouseScreenPosition: Point | null

  /** 鼠标下方的目标类型（核心判定依据） */
  hoverTarget: HoverTarget

  /** 拖到空白时创建的临时节点信息 */
  tempConnection: TempConnection | null

  /** UI 开关：是否隐藏所有节点的端口 */
  suppressHandles: boolean
}
```

**Step 2: 验证类型编译**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && npx vue-tsc --noEmit -p tsconfig.app.json 2>&1 | head -30`
Expected: 不应该出现 `HoverTarget` / `ConnectionState` 相关的错误（其他原有错误忽略）

**Step 3: Commit**

```bash
cd "D:/Code/GitTest/canvas-ai/mini-canvas"
git add src/canvas/core/plugins/types.ts
git commit -m "feat(canvas): 定义 HoverTarget 和 ConnectionState 类型"
```

---

## Task 2: 重构 `useCanvasStore.connectionState`

**Files:**
- Modify: `src/canvas/core/composables/useCanvasStore.ts:221-236`

**Step 1: 替换 `connectionState` 定义**

把 `useCanvasStore.ts` 第 221-236 行的 `connectionState` 定义替换为：

```typescript
  // ==================== 连线拖拽状态（不持久化） ====================
  const connectionState = ref<ConnectionState>({
    activeConnection: null,
    hoverNode: null,
    snapTarget: null,
    mouseFlowPosition: null,
    mouseScreenPosition: null,
    hoverTarget: null,
    tempConnection: null,
    suppressHandles: false,
  })
```

**Step 2: 在 `useCanvasStore.ts` 顶部添加 import**

在文件顶部 import 区域添加：

```typescript
import type { ConnectionState } from '../plugins/types'
```

**Step 3: 在 `useCanvasStore.ts` return 之前添加派生 getter**

在 `return { state, ...` 之前添加：

```typescript
  /** 是否正在拖线（派生） */
  const isConnecting = computed(() => connectionState.value.activeConnection !== null)

  /** 是否可以弹出"拖到空白"的节点选择菜单（核心判定） */
  const canShowConnectionMenu = computed(() => {
    const s = connectionState.value
    if (!s.activeConnection) return false
    if (s.hoverTarget?.type !== 'pane') return false
    if (s.snapTarget?.isSnapped) return false
    if (s.tempConnection) return false
    return true
  })
```

**Step 4: 在 return 对象中导出新增 getter**

把 return 对象里 `connectionState,` 这行下方添加：

```typescript
    isConnecting,
    canShowConnectionMenu,
```

**Step 5: 验证 store 编译**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && npx vue-tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "useCanvasStore|connectionState" | head -20`
Expected: 不应有 `useCanvasStore` 自身定义错误（Canvas.vue 等消费方的报错是预期的，下个 Task 处理）

**Step 6: Commit**

```bash
cd "D:/Code/GitTest/canvas-ai/mini-canvas"
git add src/canvas/core/composables/useCanvasStore.ts
git commit -m "refactor(canvas): 重构 connectionState，合并冗余字段并新增判定字段"
```

---

## Task 3: 适配 `BaseNode.vue` 读取新字段

**Files:**
- Modify: `src/canvas/core/components/Decoration/BaseNode.vue:175-245`

**Step 1: 替换所有 `connectionState` 读取**

把 `BaseNode.vue` 中以下 computed（约 175-245 行）按映射表替换：

| 旧表达式 | 新表达式 |
|---|---|
| `canvas.connectionState.isConnecting` | `canvas.isConnecting.value` |
| `canvas.connectionState.sourceNodeId === props.id` | `canvas.connectionState.activeConnection?.sourceNodeId === props.id` |
| `canvas.connectionState.suppressHandles` | `canvas.connectionState.suppressHandles`（不变） |
| `canvas.connectionState.invalidFeedbackNodeId !== props.id` | `canvas.connectionState.hoverNode?.status !== 'invalid' \|\| canvas.connectionState.hoverNode?.nodeId !== props.id` |
| `canvas.connectionState.hoverFeedbackNodeId === props.id` | `canvas.connectionState.hoverNode?.nodeId === props.id && canvas.connectionState.hoverNode?.status === 'valid'` |
| `canvas.connectionState.invalidFeedbackNodeId === props.id` | `canvas.connectionState.hoverNode?.nodeId === props.id && canvas.connectionState.hoverNode?.status === 'invalid'` |

具体代码替换（5 处 computed）：

```typescript
const isCurrentConnectingNode = computed(() =>
  canvas.isConnecting.value &&
  canvas.connectionState.activeConnection?.sourceNodeId === props.id
)

const shouldShowHandles = computed(() =>
  !canvas.connectionState.suppressHandles &&
  !isCurrentConnectingNode.value &&
  (isHovered.value || props.selected)
)

const showConnectFeedback = computed(() =>
  canvas.isConnecting.value &&
  canvas.connectionState.activeConnection?.sourceNodeId !== props.id &&
  !isInvalidConnectionTarget.value &&
  (
    isHovered.value ||
    (canvas.connectionState.hoverNode?.nodeId === props.id &&
     canvas.connectionState.hoverNode?.status === 'valid')
  )
)

const isInvalidConnectionTarget = computed(() =>
  canvas.isConnecting.value &&
  canvas.connectionState.hoverNode?.nodeId === props.id &&
  canvas.connectionState.hoverNode?.status === 'invalid'
)

const showTargetZones = computed(() =>
  canvas.isConnecting.value &&
  canvas.connectionState.activeConnection?.sourceNodeId !== props.id &&
  Boolean(props.targetPosition)
)
```

**Step 2: 替换模板中的读取**

搜索 `BaseNode.vue` 模板里的 `connectionState` 引用（约第 286、326-327、413、473 行），按同样映射表替换。重点：

- `canvas.connectionState.invalidFeedbackPoint` → `canvas.connectionState.hoverNode?.status === 'invalid' ? canvas.connectionState.hoverNode.flowPoint : null`
- `canvas.connectionState.hoverFeedbackPoint` → `canvas.connectionState.hoverNode?.status === 'valid' ? canvas.connectionState.hoverNode.flowPoint : null`
- `canvas.connectionState.hoverFeedbackNodeId !== props.id` → `canvas.connectionState.hoverNode?.nodeId !== props.id`
- `canvas.connectionState.invalidFeedbackMessage` → `canvas.connectionState.hoverNode?.message || '无法连接'`

**Step 3: 验证 BaseNode 编译**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && npx vue-tsc --noEmit -p tsconfig.app.json 2>&1 | grep "BaseNode" | head -20`
Expected: 不应有 BaseNode 相关错误

**Step 4: Commit**

```bash
cd "D:/Code/GitTest/canvas-ai/mini-canvas"
git add src/canvas/core/components/Decoration/BaseNode.vue
git commit -m "refactor(canvas): BaseNode 适配新 connectionState 字段"
```

---

## Task 4: 扩展 `PluginContext` 暴露 `connectionState`

**Files:**
- Modify: `src/canvas/core/plugins/types.ts:146-177` (PluginContext 接口)
- Modify: `src/canvas/core/plugins/PluginContext.ts:102-128` (CreatePluginContextOptions)
- Modify: `src/canvas/core/plugins/PluginContext.ts:134-150` (createPluginContext 函数签名和结构)
- Modify: `src/canvas/core/plugins/PluginContext.ts:267-274` (context 对象构建)
- Modify: `src/canvas/core/Canvas.vue:1409-1421` (createPluginContext 调用)

**Step 1: 在 `PluginContext` 接口添加字段**

在 `types.ts` 的 `PluginContext` 接口（约第 146-177 行）中，在 `readonly dom: CanvasDomServiceAPI` 之后添加：

```typescript
  /** 连线拖拽状态（响应式 ref，可直接 .value 读取） */
  readonly connectionState: import('vue').Ref<ConnectionState>
  /** 是否正在拖线（派生 computed） */
  readonly isConnecting: import('vue').ComputedRef<boolean>
  /** 是否可以弹出"拖到空白"菜单（派生 computed） */
  readonly canShowConnectionMenu: import('vue').ComputedRef<boolean>
```

**Step 2: 在 `CreatePluginContextOptions` 添加可选字段**

在 `PluginContext.ts` 第 102-128 行的 `CreatePluginContextOptions` 接口中，在 `canvasState?:` 之前添加：

```typescript
  /** 连线拖拽状态 ref */
  connectionState?: import('vue').Ref<import('./types').ConnectionState>
  /** 是否正在拖线 computed */
  isConnecting?: import('vue').ComputedRef<boolean>
  /** 是否可弹连线菜单 computed */
  canShowConnectionMenu?: import('vue').ComputedRef<boolean>
```

**Step 3: 在 `createPluginContext` 解构新增字段**

在 `PluginContext.ts` 第 138-150 行的解构中，在 `canvasState,` 之后添加：

```typescript
    connectionState: connectionStateRef,
    isConnecting: isConnectingComputed,
    canShowConnectionMenu: canShowConnectionMenuComputed,
```

**Step 4: 在 context 对象添加字段**

在 `PluginContext.ts` 第 267-274 行的 `const context: PluginContext = {` 对象中，在 `dom: createDomService(),` 之后添加：

```typescript
    connectionState: connectionStateRef as any,
    isConnecting: isConnectingComputed as any,
    canShowConnectionMenu: canShowConnectionMenuComputed as any,
```

**Step 5: 在 Canvas.vue 调用 `createPluginContext` 时传入**

在 `Canvas.vue` 第 1409-1421 行的 `createPluginContext(pluginName, {...})` 调用中，在 `canvasState: canvas.state as any,` 之后添加：

```typescript
        connectionState: canvas.connectionState,
        isConnecting: canvas.isConnecting,
        canShowConnectionMenu: canvas.canShowConnectionMenu,
```

**Step 6: 验证编译**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && npx vue-tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "PluginContext|types\.ts" | head -20`
Expected: 不应有 PluginContext 类型错误

**Step 7: Commit**

```bash
cd "D:/Code/GitTest/canvas-ai/mini-canvas"
git add src/canvas/core/plugins/types.ts src/canvas/core/plugins/PluginContext.ts src/canvas/core/Canvas.vue
git commit -m "feat(canvas): PluginContext 暴露 connectionState 和派生 getter"
```

---

## Task 5: 改造 `ContextMenuPlugin` 接管连线菜单逻辑

**Files:**
- Modify: `src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts`

**Step 1: 在 `ContextMenuPlugin.ts` 顶部添加 import 和工具函数**

在文件顶部 import 区域之后追加工具函数（从 `Canvas.vue` 移植）：

```typescript
import type { Node, Edge } from "@vue-flow/core"
import type { ConnectionState, Point } from "../types"

/** 从 MouseEvent 或 TouchEvent 提取屏幕坐标 */
function getMousePoint(event?: MouseEvent | TouchEvent): Point | null {
  if (!event) return null
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0]
    return { x: touch.clientX, y: touch.clientY }
  }
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY }
  }
  return null
}

/** 从 DOM 元素上提取节点 ID */
function getNodeIdFromElement(el: Element): string {
  return (
    el.getAttribute('data-id') ||
    (el as HTMLElement).dataset?.id ||
    el.getAttribute('data-nodeid') ||
    ''
  )
}

/** 判断节点是否为临时节点 */
function isTempNode(node: Node | undefined | null): boolean {
  return Boolean(node?.type === 'tempTarget' || node?.data?.isTemp)
}

/** 在屏幕坐标附近查找最近的可连线目标节点（吸附区域版） */
function findNearestValidTarget(
  clientX: number,
  clientY: number,
  context: PluginContext,
  sourceNodeId: string,
  sourceHandle: 'source' | 'target',
): Node | null {
  if (sourceHandle !== 'source') return null

  const excludedNodeIds = new Set([sourceNodeId])
  let bestNode: Node | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  // 从 store 拿吸附参数；这里通过 context.store 拿不到 core 配置，
  // 改成直接读 DOM 的 dataset 或者通过 context.actions.getAllNodes 读节点尺寸
  // 简化版：用固定阈值，后续可调
  const SNAP_THRESHOLD = 50

  const nodeEls = document.querySelectorAll('.vue-flow__node')
  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || excludedNodeIds.has(nodeId)) continue

    const node = context.actions.getNodes().find(n => n.id === nodeId)
    if (!node || isTempNode(node) || !node.targetPosition) continue

    const rect = el.getBoundingClientRect()
    const insideSnapArea =
      clientX >= rect.left - SNAP_THRESHOLD &&
      clientX <= rect.left + SNAP_THRESHOLD &&
      clientY >= rect.top &&
      clientY <= rect.bottom

    if (!insideSnapArea) continue

    const centerX = rect.left
    const centerY = rect.top + rect.height / 2
    const distance = Math.hypot(clientX - centerX, clientY - centerY)

    if (distance < bestDistance) {
      bestNode = node
      bestDistance = distance
    }
  }

  return bestNode
}

/** 判断鼠标是否落在某个节点主体区域内 */
function findNodeBodyAtPoint(
  clientX: number,
  clientY: number,
  context: PluginContext,
  excludedNodeIds: Iterable<string> = [],
): Node | null {
  const excluded = new Set(excludedNodeIds)
  const nodeEls = document.querySelectorAll('.vue-flow__node')

  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || excluded.has(nodeId)) continue

    const node = context.actions.getNodes().find(n => n.id === nodeId)
    if (!node || isTempNode(node)) continue

    const rect = el.getBoundingClientRect()
    const inside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom

    if (inside) return node
  }

  return null
}

/** 判定 hoverTarget */
function resolveHoverTarget(
  clientX: number,
  clientY: number,
  context: PluginContext,
  sourceNodeId: string,
): ConnectionState['hoverTarget'] {
  // 1. 检查节点主体
  const bodyNode = findNodeBodyAtPoint(clientX, clientY, context, [sourceNodeId])
  if (bodyNode) {
    return { type: 'node', nodeId: bodyNode.id }
  }
  // 2. 检查端口（通过 DOM 类名）
  const handleEl = document.elementFromPoint(clientX, clientY)
  if (handleEl?.classList.contains('vue-flow__handle')) {
    const nodeEl = handleEl.closest('.vue-flow__node')
    const nodeId = nodeEl ? getNodeIdFromElement(nodeEl) : ''
    if (nodeId && nodeId !== sourceNodeId) {
      const handle = handleEl.classList.contains('source') ? 'source' : 'target'
      return { type: 'node-handle', nodeId, handle }
    }
  }
  // 3. 检查连线
  const edgeEl = document.elementFromPoint(clientX, clientY)
  if (edgeEl?.closest('.vue-flow__edge')) {
    const edgeId = edgeEl.closest('.vue-flow__edge')?.getAttribute('data-id') || ''
    if (edgeId) return { type: 'edge', edgeId }
  }
  // 4. 默认画布空白
  return { type: 'pane' }
}
```

**Step 2: 改造 `install` 方法，监听 `connectEnd`**

在 `ContextMenuPlugin.ts` 的 `install` 方法中（约第 95 行之后），在 `let appInstance` 之前添加 `connectEnd` 监听：

```typescript
    // ===== 连线拖拽菜单逻辑（从 Canvas.vue 迁移） =====
    let lastNativeConnectAt = 0
    const offConnectStart = context.on('connectStart', () => {
      lastNativeConnectAt = 0
    })
    const offConnect = context.on('connect', () => {
      lastNativeConnectAt = Date.now()
    })

    const offConnectEnd = context.on('connectEnd', (event: MouseEvent | TouchEvent | undefined) => {
      const point = getMousePoint(event)
      const active = context.connectionState.value.activeConnection
      if (!point || !active) return
      // 如果已经精确连到了 Handle，@connect 会先创建边，这里不要再抢着处理
      if (Date.now() - lastNativeConnectAt < 80) return

      const { sourceNodeId, sourceHandle } = active

      // 判定 hoverTarget
      const hoverTarget = resolveHoverTarget(point.x, point.y, context, sourceNodeId)
      context.connectionState.value.hoverTarget = hoverTarget

      // 判定吸附
      const snapNode = findNearestValidTarget(point.x, point.y, context, sourceNodeId, sourceHandle)
      context.connectionState.value.snapTarget = snapNode
        ? { nodeId: snapNode.id, isSnapped: true }
        : null

      // 核心：只在 hoverTarget === 'pane' 且未吸附时弹菜单
      if (!context.canShowConnectionMenu.value) return

      // 创建临时节点 + 边
      createTempConnection(point, sourceNodeId, sourceHandle, context)
    })
```

**Step 3: 添加 `createTempConnection` 函数**

在 `ContextMenuPlugin.ts` 的 `install` 方法内部、`offConnectEnd` 定义之前添加：

```typescript
    function toFlowPosition(clientX: number, clientY: number): Point {
      return context.viewport.screenToFlowCoordinate({ x: clientX, y: clientY })
    }

    function createTempConnection(
      point: Point,
      sourceNodeId: string,
      sourceHandle: 'source' | 'target',
      ctx: PluginContext,
    ) {
      const flowPosition = toFlowPosition(point.x, point.y)
      const tempNodeId = `temp-target-${Date.now()}`
      const tempEdgeId = `temp-edge-${sourceNodeId}-${Date.now()}`
      const isReverseConnection = sourceHandle === 'target'

      ctx.actions.addNodes([{
        id: tempNodeId,
        type: 'tempTarget',
        position: flowPosition,
        data: { isTemp: true },
        sourcePosition: isReverseConnection ? Position.Right : undefined,
        targetPosition: isReverseConnection ? undefined : Position.Left,
        draggable: false,
        selectable: false,
      } as Node])

      ctx.actions.addEdges([{
        id: tempEdgeId,
        type: 'custom',
        source: isReverseConnection ? tempNodeId : sourceNodeId,
        target: isReverseConnection ? sourceNodeId : tempNodeId,
        sourceHandle: isReverseConnection ? 'source' : sourceHandle,
        targetHandle: isReverseConnection ? sourceHandle : 'target',
        selectable: false,
        zIndex: 99999,
        data: { isTemp: true },
      } as Edge])

      // 记录到 connectionState
      ctx.connectionState.value.tempConnection = {
        tempNodeId,
        tempEdgeId,
        flowPosition,
      }

      // emit 事件给现有的菜单 UI 流程
      ctx.emit('connectionContextMenu', {
        clientX: point.x,
        clientY: point.y,
        sourceNodeId,
        sourceHandle,
        tempNodeId,
        tempEdgeId,
        flowPosition,
      })
    }
```

**Step 4: 在 `closeMenu` 中清理 `tempConnection`**

修改 `ContextMenuPlugin.ts` 的 `closeMenu` 函数（约第 111-116 行），在 `if (p) { context.actions.removeEdges([p.tempEdgeId]); context.actions.removeNodes([p.tempNodeId]) }` 之后追加：

```typescript
        // 清理 connectionState.tempConnection
        context.connectionState.value.tempConnection = null
        context.connectionState.value.hoverTarget = null
        context.connectionState.value.snapTarget = null
```

**Step 5: 在 uninstall 中解绑新增监听**

修改 `ContextMenuPlugin.ts` 的 `uninstall`（约第 188-193 行），在 `off1(); off2(); off3(); off4(); off5()` 之后添加：

```typescript
        offConnectStart(); offConnect(); offConnectEnd()
```

**Step 6: 验证插件编译**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && npx vue-tsc --noEmit -p tsconfig.app.json 2>&1 | grep "ContextMenuPlugin" | head -20`
Expected: 不应有 ContextMenuPlugin 类型错误

**Step 7: Commit**

```bash
cd "D:/Code/GitTest/canvas-ai/mini-canvas"
git add src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts
git commit -m "feat(canvas): ContextMenuPlugin 接管连线拖拽菜单逻辑并修复判定 bug"
```

---

## Task 6: `Canvas.vue` 瘦身——删除迁移走的代码

**Files:**
- Modify: `src/canvas/core/Canvas.vue`

**Step 1: 删除 `findNearestValidTarget` / `findNearestValidSource` / `findNearestConnectableNode` / `findNodeBodyAtPoint` / `createTempConnectionMenu` 函数**

删除 `Canvas.vue` 中以下函数（约第 509-696 行）：
- `findNearestValidTarget`
- `findNearestConnectableNode`
- `findNodeBodyAtPoint`
- `createTempConnectionMenu`
- `findNearestValidSource`

**Step 2: 简化 `onConnectEnd` 函数**

把 `Canvas.vue` 第 884-945 行的 `onConnectEnd` 整体替换为：

```typescript
/** VueFlow connectEnd 事件：转发到 eventBus，由 ContextMenuPlugin 处理 */
function onConnectEnd(event?: MouseEvent | TouchEvent) {
  try {
    // 不再做判定，全部交给 ContextMenuPlugin
    // 只负责重置 activeConnection（插件已经处理完菜单逻辑后会读这个状态）
  } finally {
    canvas.connectionState.value.activeConnection = null
    canvas.connectionState.value.hoverNode = null
    canvas.connectionState.value.hoverTarget = null
    canvas.connectionState.value.snapTarget = null
    canvas.connectionState.value.suppressHandles = true
  }
}
```

**Step 3: 改写 `onConnectStart` 函数**

把 `Canvas.vue` 第 459-468 行的 `onConnectStart` 替换为：

```typescript
/** VueFlow connectStart 事件：开始拖拽连线时记录源节点信息 */
function onConnectStart(payload: ({ event?: MouseEvent | TouchEvent } & OnConnectStartParams)) {
  canvas.connectionState.value.activeConnection = {
    sourceNodeId: payload.nodeId || '',
    sourceHandle: (payload.handleId as 'source' | 'target') || 'source',
  }
  canvas.connectionState.value.suppressHandles = true
  canvas.connectionState.value.hoverNode = null
  canvas.connectionState.value.hoverTarget = null
  canvas.connectionState.value.snapTarget = null
  canvas.connectionState.value.tempConnection = null
}
```

**Step 4: 改写 `clearInvalidConnectionFeedback` 和 `setInvalidConnectionFeedback`**

把 `Canvas.vue` 第 318-335 行的两个函数替换为：

```typescript
/** 清除无效连接反馈 */
function clearInvalidConnectionFeedback() {
  if (canvas.connectionState.value.hoverNode?.status === 'invalid') {
    canvas.connectionState.value.hoverNode = null
  }
}

/** 设置无效连接反馈 */
function setInvalidConnectionFeedback(nodeId: string | null, point: { x: number; y: number } | null, message = '无法连接') {
  if (!nodeId || !point) {
    clearInvalidConnectionFeedback()
    return
  }
  canvas.connectionState.value.hoverNode = {
    nodeId,
    status: 'invalid',
    flowPoint: point,
    message,
  }
}
```

**Step 5: 改写 `updateBatchConnectFeedback` 中的字段写入**

把 `Canvas.vue` 第 746-771 行的 `updateBatchConnectFeedback` 函数中所有 `canvas.connectionState.hoverFeedbackNodeId` / `hoverFeedbackPoint` / `invalidFeedbackNodeId` / `invalidFeedbackPoint` / `invalidFeedbackMessage` 替换为对应的新字段：

```typescript
function updateBatchConnectFeedback(point: { x: number; y: number }) {
  const batch = batchConnectState.value
  if (!batch) return

  let feedbackNode: Node | null = null
  let invalidNode: Node | null = null
  // ...（保留原逻辑，但 findNearestValidTarget/Source 需要从插件 API 拿或保留在 Canvas.vue）

  // 简化：因为批量连线的吸附函数已迁移，这里暂时保留批量逻辑所需的查找函数
  // 见 Step 6 说明
}
```

**Step 6: 保留批量连线专用查找函数**

注意：批量连线（`onBatchConnectMove` / `onBatchConnectEnd`）也用到 `findNearestValidTarget` / `findNearestValidSource`。两个选择：

- **方案 A（推荐）**：把这些查找函数保留在 `Canvas.vue`（批量连线的吸附逻辑跟单连线菜单的吸附逻辑不是一回事，留 Canvas.vue 合理）
- **方案 B**：把批量连线整体也迁移到另一个插件

本计划选 **方案 A**：把 `findNearestValidTarget` / `findNearestValidSource` 保留在 `Canvas.vue`，但移除 `createTempConnectionMenu` / `findNodeBodyAtPoint` / `findNearestConnectableNode`（这些只服务于单连线菜单）。

**Step 7: 改写 mousemove handler 中的 hoverFeedback 写入**

把 `Canvas.vue` 第 1199-1226 行的 mousemove handler 中所有 `hoverFeedbackNodeId` / `hoverFeedbackPoint` / `invalidFeedbackNodeId` / `invalidFeedbackPoint` 替换为 `hoverNode`：

```typescript
  const effectiveFeedbackNodeId = snappedNodeId || bodyNodeId
  const nextFeedbackPoint = effectiveFeedbackNodeId
    ? { x: connectionLineProps.targetX, y: connectionLineProps.targetY }
    : null

  const currentHover = canvas.connectionState.value.hoverNode
  const hoverChanged =
    currentHover?.nodeId !== effectiveFeedbackNodeId ||
    currentHover?.flowPoint?.x !== nextFeedbackPoint?.x ||
    currentHover?.flowPoint?.y !== nextFeedbackPoint?.y

  if (hoverChanged) {
    if (effectiveFeedbackNodeId && nextFeedbackPoint) {
      canvas.connectionState.value.hoverNode = {
        nodeId: effectiveFeedbackNodeId,
        status: invalidNodeId ? 'invalid' : 'valid',
        flowPoint: nextFeedbackPoint,
        message: invalidNodeId ? '无法连接' : undefined,
      }
    } else {
      canvas.connectionState.value.hoverNode = null
    }
  }
```

**Step 8: 改写 connectionLine slot 中读取**

把 `Canvas.vue` 第 1038-1039 行的读取替换为：

```typescript
  const sourceId = connectionLineProps.sourceNode?.id || canvas.connectionState.value.activeConnection?.sourceNodeId || '__source__'
  const startHandle = canvas.connectionState.value.activeConnection?.sourceHandle || (connectionLineProps as any).sourceHandleId || 'source'
```

**Step 9: 改写批量连线开始/重置中的字段写入**

把 `Canvas.vue` 第 870-875 行和 937-942 行的所有 `canvas.connectionState.isConnecting = true/false` / `sourceNodeId = ...` / `sourceHandle = ...` / `hoverFeedbackNodeId = null` / `hoverFeedbackPoint = null` 替换为：

```typescript
// 批量连线开始
canvas.connectionState.value.activeConnection = {
  sourceNodeId: payload.type === 'source' ? activeNodes[0].id : tempNodeId,
  sourceHandle: 'source',
}
canvas.connectionState.value.suppressHandles = true
canvas.connectionState.value.hoverNode = null
canvas.connectionState.value.hoverTarget = null
canvas.connectionState.value.snapTarget = null

// 批量连线重置
canvas.connectionState.value.activeConnection = null
canvas.connectionState.value.suppressHandles = true
canvas.connectionState.value.hoverNode = null
```

**Step 10: 删除不再使用的工具函数**

删除 `Canvas.vue` 中以下函数（如果 Step 1 没删完）：
- `getMousePoint`（如果不再被 Canvas.vue 使用）
- `getNodeIdFromElement`（同上）
- `isTempNode` / `isTempEdge`（如果不再被 Canvas.vue 使用）
- `getNodeCardRectFromNodeElement`（如果不再使用）

**Step 11: 验证 Canvas.vue 编译**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && npx vue-tsc --noEmit -p tsconfig.app.json 2>&1 | grep "Canvas.vue" | head -30`
Expected: 不应有 Canvas.vue 类型错误

**Step 12: Commit**

```bash
cd "D:/Code/GitTest/canvas-ai/mini-canvas"
git add src/canvas/core/Canvas.vue
git commit -m "refactor(canvas): Canvas.vue 瘦身，连线菜单逻辑迁移到 ContextMenuPlugin"
```

---

## Task 7: 回归验证——修复两个 bug

**Files:**
- 无文件修改，只验证

**Step 1: 启动 dev server**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && pnpm dev`（后台运行）

**Step 2: 手动验证 Bug 1——鼠标松开在节点上不弹菜单**

操作：
1. 在画布上创建两个节点 A 和 B
2. 从 A 的 source 端口开始拖拽
3. 把鼠标移到 B 节点的**主体区域**（不是端口）
4. 松开鼠标

Expected: **不弹出菜单**，不创建连线
Actual（修复前）: 弹出菜单
Actual（修复后）: 不弹出菜单 ✓

**Step 3: 手动验证 Bug 2——吸附到节点后不弹菜单**

操作：
1. 从 A 的 source 端口开始拖拽
2. 把鼠标移到 B 节点**左侧吸附区**（端口附近）
3. 松开鼠标

Expected: **创建 A→B 连线**，不弹出菜单
Actual（修复前）: 可能弹出菜单
Actual（修复后）: 创建连线，不弹菜单 ✓

**Step 4: 手动验证正常场景——拖到空白弹菜单**

操作：
1. 从 A 的 source 端口开始拖拽
2. 把鼠标移到**画布空白区域**
3. 松开鼠标

Expected: **弹出节点选择菜单**，菜单显示在松开位置
Actual（修复后）: 弹出菜单 ✓

**Step 5: 验证菜单选择后创建节点+连线**

操作：
1. 在 Step 4 弹出的菜单中选择一个节点类型
2. 观察画布

Expected: 创建新节点，并自动连接 A→新节点，临时节点和边被清理
Actual（修复后）: 正常创建 ✓

**Step 6: 验证 ESC 关闭菜单清理临时元素**

操作：
1. 拖到空白弹出菜单
2. 按 ESC

Expected: 菜单关闭，临时节点和边被清理，`connectionState.tempConnection = null`
Actual（修复后）: 正常清理 ✓

**Step 7: 验证批量连线不受影响**

操作：
1. 选中多个节点
2. 从工具栏触发批量连线
3. 拖到目标节点

Expected: 批量连线正常工作
Actual（修复后）: 正常 ✓

**Step 8: Commit（如有 hotfix）**

如果验证过程中发现问题并修复：
```bash
cd "D:/Code/GitTest/canvas-ai/mini-canvas"
git add -A
git commit -m "fix(canvas): 回归验证 hotfix"
```

---

## Task 8: 清理 dead code 并最终提交

**Files:**
- Delete: `src/canvas/core/composables/useCanvasConnection.ts`

**Step 1: 确认 `useCanvasConnection.ts` 零引用**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && grep -r "useCanvasConnection" src/ --include="*.ts" --include="*.vue"`

Expected: 只在 `useCanvasConnection.ts` 自身出现，无其他引用

**Step 2: 删除文件**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && rm src/canvas/core/composables/useCanvasConnection.ts`

**Step 3: 验证编译**

Run: `cd "D:/Code/GitTest/canvas-ai/mini-canvas" && npx vue-tsc --noEmit -p tsconfig.app.json 2>&1 | head -20`
Expected: 不应有错误

**Step 4: 最终 Commit**

```bash
cd "D:/Code/GitTest/canvas-ai/mini-canvas"
git add -A
git commit -m "chore(canvas): 删除 dead code useCanvasConnection.ts"
```

---

## 风险与注意事项

1. **`findNearestValidTarget` 的吸附阈值**：计划中用了固定 `SNAP_THRESHOLD = 50`，原 `Canvas.vue` 用的是基于 `handleRadius * snapOuterRatio` 的动态计算。如果回归验证发现吸附精度退化，需要从 `context.store` 或 `canvas.state.core` 拿到 `handleRadius` 等配置。可能需要在 Task 5 中扩展 `PluginContext` 让插件能读 `canvas.state.core`。

2. **`getInvalidConnectionReason` 和 `createConnection`**：这两个函数仍在 `Canvas.vue`，ContextMenuPlugin 创建临时节点后实际连线由 `onMenuSelect` 触发。`onMenuSelect` 调用的 `createNode` 和 `addEdges` 已经在插件内，但**实际创建 source→target 边的校验逻辑（避免循环、重复）**目前不在插件内。如果验证发现菜单选择后能创建出非法连线，需要在 Task 5 的 `onMenuSelect` 中补校验。

3. **批量连线**：本计划只迁移单连线菜单逻辑，批量连线保留在 `Canvas.vue`。如果后续也要迁移，需要新建 `BatchConnectionPlugin`。

4. **`tempConnection` 状态竞争**：`closeMenu` 在 ContextMenuPlugin 中清理 `tempConnection`，但 `onConnectEnd` 也会重置。需要确保顺序：`connectEnd` 触发 → 插件判定 → 创建 tempConnection → emit `connectionContextMenu` → 菜单显示 → 用户选择/关闭 → `closeMenu` 清理。如果用户在菜单显示期间再次拖线，需要确保旧 tempConnection 被清理。
