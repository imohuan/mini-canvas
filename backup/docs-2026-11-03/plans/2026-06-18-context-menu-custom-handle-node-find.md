# ContextMenu + CustomHandle + NodeFind + Export 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 3 个独立插件（ContextMenuPlugin、CustomHandlePlugin、NodeFindPlugin），并将 Export 功能内建到 StoragePlugin。同时从 Canvas.vue 中抽走 ~350 行硬编码逻辑。

**Architecture:**
- ContextMenuPlugin 引入 MenuRegistry 三层注册模型（内置默认 / 插件注册 / 节点类型注册），通过 `visible(ctx)` 按场景过滤菜单项。替代当前 Canvas.vue 中的 NODE_MENU_ITEMS + openCreateNodeMenu + onMenuSelect 硬编码。
- CustomHandlePlugin 将连接验证 (`isValidConnection`)、端口偏移配置（handleRadius/handleRestOffset 等）、连接线反馈 (`buildConnectionEdgeProps`) 收归插件统一管理，通过 PluginContext.store 暴露配置和事件总线通信。
- NodeFindPlugin 通过 `PluginContext.mountOverlay` 挂载搜索弹窗，Ctrl+F 触发，模糊匹配节点 label，Enter 聚焦节点。
- Export 作为 StoragePlugin API 的两个新方法 (`exportJSON` / `exportPNG`)，不新建插件。

**Tech Stack:** Vue 3 + TypeScript, VueFlow, Pinia

---

## Task 1: 扩展 PluginContext API（Menu + Handle 注册入口）

**Files:**
- Modify: `src/canvas/core/plugins/types.ts` — 添加 MenuAPI、HandleConfig 类型
- Modify: `src/canvas/core/plugins/PluginContext.ts` — 实现 menu/handle 子模块

### Step 1: 在 types.ts 中定义 MenuAPI 和 HandleAPI

在 `PluginContext` 接口中添加两个新属性：

```typescript
// 新增类型
export interface MenuItemDefinition {
  id: string
  label: string
  description?: string
  icon?: string
  shortcut?: string
  danger?: boolean
  group?: string           // 'create' | 'action' | 'transform' | 'delete'
  priority?: number         // 组内排序，默认 0
  visible: (ctx: MenuContext) => boolean
}

export type MenuMode = 'pane' | 'node' | 'edge' | 'connection'

export interface MenuContext {
  mode: MenuMode
  nodeId?: string
  nodeType?: string
  nodeData?: Record<string, unknown>
  edgeId?: string
  sourceNodeId?: string
  sourceNodeType?: string
  flowPosition?: { x: number; y: number }
}

export interface MenuAPI {
  register(items: MenuItemDefinition[]): void
  unregister(ids: string[]): void
}

export interface HandleConfig {
  radius: number
  restOffset: number
  cursorGap: number
  buttonSize: number
  overlap: number
  snapOuterRatio: number
  snapInnerRatio: number
  snapHeightRatio: number
}

// 在 PluginContext 接口中添加：
export interface PluginContext {
  // ...existing...
  menus: MenuAPI
  registerHandleConfig(config: Partial<HandleConfig>): void
}
```

同时添加 `menu` mode 的 `'edge'` 到 CanvasMenuState：

```typescript
// 修改 CanvasMenu.types.ts
export type CanvasMenuMode = 'pane' | 'node' | 'connection' | 'edge'
export type { CanvasMenuItem } from '../plugins/types'  // 重新导出 MenuItemDefinition 作为 CanvasMenuItem
```

**验收标准：**
- TypeScript 编译无错误
- `PluginContext` 接口可见 `menus` 和 `registerHandleConfig`

### Step 2: 在 PluginContext.ts 中实现 MenuAPI

在 `createPluginContext()` 返回之前，注入 `menus` 实现。由于 MenuRegistry 是全局单例，PluginContext 只需要透传：

```typescript
import { MenuRegistry } from './menu/MenuRegistry'

// 在 createPluginContext 内部，context 对象中添加：
menus: {
  register(items: MenuItemDefinition[]): void {
    MenuRegistry.getInstance().register(pluginName, items)
  },
  unregister(ids: string[]): void {
    MenuRegistry.getInstance().unregister(pluginName, ids)
  },
},
```

`registerHandleConfig` 通过 store 写入：

```typescript
registerHandleConfig(config: Partial<HandleConfig>): void {
  const current = effectiveStore.state.handleConfig || {}
  effectiveStore.state.handleConfig = { ...current, ...config }
},
```

**验收标准：**
- 插件调用 `context.menus.register(...)` 不报错
- 插件调用 `context.registerHandleConfig(...)` 更新 store

---

## Task 2: MenuRegistry 单例（核心路由引擎）

**Files:**
- Create: `src/canvas/core/menu/MenuRegistry.ts`
- Create: `src/canvas/core/menu/MenuResolver.ts`
- Create: `src/canvas/core/menu/index.ts`

### Step 3: 写 MenuRegistry （注册存储）

```typescript
// src/canvas/core/menu/MenuRegistry.ts
import type { MenuItemDefinition, MenuContext } from '../plugins/types'

type SourceKey = string  // 'builtin' | 'plugin:<name>' | 'nodetype:<name>'

interface RegistryEntry {
  source: SourceKey
  item: MenuItemDefinition
}

export class MenuRegistry {
  private static instance: MenuRegistry
  private items: RegistryEntry[] = []

  static getInstance(): MenuRegistry {
    if (!MenuRegistry.instance) {
      MenuRegistry.instance = new MenuRegistry()
    }
    return MenuRegistry.instance
  }

  /** 内置默认菜单（插件系统和节点类型注册前的基础菜单） */
  registerDefaults(items: MenuItemDefinition[]): void {
    for (const item of items) {
      this.items.push({ source: 'builtin', item })
    }
  }

  /** 插件注册菜单项 */
  register(pluginName: string, items: MenuItemDefinition[]): void {
    for (const item of items) {
      this.items.push({ source: `plugin:${pluginName}`, item })
    }
  }

  /** 注销指定来源的所有菜单项 */
  unregister(sourceName: string, ids: string[]): void {
    const key = `plugin:${sourceName}`
    const idSet = new Set(ids)
    this.items = this.items.filter(e => !(e.source === key && idSet.has(e.item.id)))
  }

  /** 节点类型注册菜单项 */
  registerForNodeType(nodeType: string, items: MenuItemDefinition[]): void {
    for (const item of items) {
      this.items.push({ source: `nodetype:${nodeType}`, item })
    }
  }

  /** 返回所有已注册项（供 MenuResolver 使用） */
  getAll(): RegistryEntry[] {
    return this.items
  }

  /** 清空（测试用） */
  reset(): void {
    this.items = []
  }
}
```

### Step 4: 写 MenuResolver（过滤 + 排序）

```typescript
// src/canvas/core/menu/MenuResolver.ts
import type { MenuItemDefinition, MenuContext } from '../plugins/types'
import { MenuRegistry } from './MenuRegistry'

export interface ResolvedMenuItem {
  id: string
  label: string
  description?: string
  icon?: string
  shortcut?: string
  danger?: boolean
  group: string
}

const GROUP_ORDER: Record<string, number> = {
  'create': 1,
  'action': 2,
  'transform': 3,
  'connect': 4,
  'delete': 5,
}

export function resolveMenuItems(ctx: MenuContext, nodeTypeOverrides?: MenuItemDefinition[]): ResolvedMenuItem[] {
  const all = MenuRegistry.getInstance().getAll()
  const filtered: { item: MenuItemDefinition; source: string }[] = []

  // 1. 过滤：只收集 visible(ctx) === true 的项
  for (const entry of all) {
    try {
      if (entry.item.visible(ctx)) {
        filtered.push({ item: entry.item, source: entry.source })
      }
    } catch (err) {
      console.warn(`[MenuResolver] visible() 抛出异常，跳过菜单项 "${entry.item.id}":`, err)
    }
  }

  // 2. 合并节点类型重载（override 同 id 的 builtin 项）
  if (nodeTypeOverrides && nodeTypeOverrides.length > 0) {
    const overrideMap = new Map(nodeTypeOverrides.map(item => [item.id, item]))
    const overridden = new Set<string>()
    for (const entry of filtered) {
      if (entry.source === 'builtin' && overrideMap.has(entry.item.id)) {
        overridden.add(entry.item.id)
      }
    }
    filtered.push(
      ...nodeTypeOverrides
        .filter(item => overridden.has(item.id))
        .map(item => ({ item, source: 'nodetype-override' }))
    )
  }

  // 3. 排序：先按 group 权重，再按 priority 降序，同 priority 按 id 字母序
  const sorted = [...filtered].sort((a, b) => {
    const ga = GROUP_ORDER[a.item.group || 'action'] ?? 3
    const gb = GROUP_ORDER[b.item.group || 'action'] ?? 3
    if (ga !== gb) return ga - gb
    const pa = a.item.priority ?? 0
    const pb = b.item.priority ?? 0
    if (pa !== pb) return pb - pa
    return a.item.id.localeCompare(b.item.id)
  })

  // 4. 映射为 ResolvedMenuItem
  return sorted.map(e => ({
    id: e.item.id,
    label: e.item.label,
    description: e.item.description,
    icon: e.item.icon,
    shortcut: e.item.shortcut,
    danger: e.item.danger,
    group: e.item.group || 'action',
  }))
}
```

**验收标准：**
- 注册 3 个 pane 菜单项 + 2 个 node 菜单项，传入 `mode: 'pane'` 只返回 3 个
- `visible` 抛出异常时该项被跳过，不影响其他项
- 排序：create 组在前，action 在中，delete 在最后

### Step 5: 写 index.ts 导出

```typescript
// src/canvas/core/menu/index.ts
export { MenuRegistry } from './MenuRegistry'
export { resolveMenuItems } from './MenuResolver'
export type { ResolvedMenuItem } from './MenuResolver'
```

---

## Task 3: ContextMenuPlugin 插件骨架

**Files:**
- Create: `src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts`
- Create: `src/canvas/core/plugins/context-menu/builtinMenuItems.ts`
- Create: `src/canvas/core/plugins/context-menu/index.ts`

### Step 6: 写 builtinMenuItems.ts（内置默认菜单项）

```typescript
// src/canvas/core/plugins/context-menu/builtinMenuItems.ts
import type { MenuItemDefinition } from '../types'
import { NODE_TYPE_LABELS } from '../../constants'

export function createBuiltinMenuItems(): MenuItemDefinition[] {
  return [
    // ===== pane: 创建节点菜单 =====
    { id: 'create:text', group: 'create', label: '文本', description: '创建文本节点', icon: 'text',
      visible: (c) => c.mode === 'pane',
      priority: 10 },
    { id: 'create:image', group: 'create', label: '图片', description: '创建图片节点', icon: 'image',
      visible: (c) => c.mode === 'pane',
      priority: 9 },
    { id: 'create:video', group: 'create', label: '视频', description: '创建视频节点', icon: 'video',
      visible: (c) => c.mode === 'pane',
      priority: 8 },
    { id: 'create:stage', group: 'create', label: '导演台', description: '创建编排节点', icon: 'layers',
      visible: (c) => c.mode === 'pane',
      priority: 7 },

    // ===== connection: 连线创建菜单 =====
    // 与 pane 相同的 4 项，但 visible 增加连线规则过滤
    { id: 'connect:text', group: 'create', label: '文本', description: '创建文本节点并连接',
      visible: (c) => c.mode === 'connection',
      priority: 10 },
    { id: 'connect:image', group: 'create', label: '图片', description: '创建图片节点并连接',
      visible: (c) => c.mode === 'connection',
      priority: 9 },
    { id: 'connect:video', group: 'create', label: '视频', description: '创建视频节点并连接',
      visible: (c) => c.mode === 'connection',
      priority: 8 },
    { id: 'connect:stage', group: 'create', label: '导演台', description: '创建编排节点并连接',
      visible: (c) => c.mode === 'connection',
      priority: 7 },

    // ===== node: 通用节点操作 =====
    { id: 'node:copy', group: 'action', label: '复制', shortcut: 'Ctrl+C',
      visible: (c) => c.mode === 'node' },
    { id: 'node:duplicate', group: 'action', label: '创建副本', shortcut: 'Ctrl+D',
      visible: (c) => c.mode === 'node' },
    { id: 'node:bring-to-front', group: 'action', label: '置于顶层',
      visible: (c) => c.mode === 'node' },
    { id: 'node:send-to-back', group: 'action', label: '置于底层',
      visible: (c) => c.mode === 'node' },
    { id: 'node:delete', group: 'delete', label: '删除', shortcut: 'Del', danger: true,
      visible: (c) => c.mode === 'node' || c.mode === 'edge' },

    // ===== edge: 边操作 =====
    { id: 'edge:delete', group: 'delete', label: '删除连线', shortcut: 'Del', danger: true,
      visible: (c) => c.mode === 'edge' },
  ]
}
```

### Step 7: 写 ContextMenuPlugin（插件入口）

```typescript
// src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts
import type { CanvasPlugin, PluginContext } from '../types'
import { MenuRegistry } from '../../menu/MenuRegistry'
import { createBuiltinMenuItems } from './builtinMenuItems'

export const ContextMenuPlugin: CanvasPlugin = {
  name: 'context-menu',
  version: '1.0.0',

  install(context: PluginContext) {
    // 注册内置菜单项
    MenuRegistry.getInstance().registerDefaults(createBuiltinMenuItems())

    // 暴露公共 API 给 Canvas.vue，用于渲染菜单
    context.store.set('api', {
      registry: MenuRegistry.getInstance(),
    })

    context.logger.info('ContextMenuPlugin 已安装，内置菜单项已注册')
  },

  uninstall() {
    // 由 MenuRegistry.reset() 统一清理（在 PluginManager 卸载时调用）
  },
}
```

**验收标准：**
- 插件安装后 `MenuRegistry.getAll()` 包含 builtinItems
- 插件暴露的 API 可被 Canvas.vue 获取

---

## Task 4: 重构 CanvasMenu.vue + CanvasMenu.types.ts

**Files:**
- Modify: `src/canvas/core/components/CanvasMenu.types.ts`
- Modify: `src/canvas/core/components/CanvasMenu.vue`

### Step 8: 扩展 CanvasMenu.types.ts

```typescript
// 新增类型，替换原有 CanvasMenuItem
export type CanvasMenuMode = 'pane' | 'node' | 'connection' | 'edge'

export interface CanvasMenuItem {
  id: string
  label: string
  description?: string
  icon?: string
  shortcut?: string
  danger?: boolean
  group?: string
  disabled?: boolean
}

export interface CanvasMenuState {
  visible: boolean
  title: string
  mode: CanvasMenuMode
  position: { x: number; y: number }
  items: CanvasMenuItem[]
}
```

### Step 9: 重构 CanvasMenu.vue（支持 group 分隔 + danger + shortcut）

在模板中添加 group 分隔线和 shortcut 显示：

```vue
<template>
  <div v-if="menu.visible" class="canvas-menu-overlay" @click.self="$emit('close')">
    <div class="canvas-menu" :style="{ left: menu.position.x + 'px', top: menu.position.y + 'px' }">
      <div class="canvas-menu-title">{{ menu.title }}</div>
      <template v-for="(groupItems, groupName) in groupedItems" :key="groupName">
        <div v-if="groupName !== firstGroup" class="canvas-menu-divider" />
        <div
          v-for="item in groupItems"
          :key="item.id"
          class="canvas-menu-item"
          :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled }"
          @click="!item.disabled && $emit('select', item)"
        >
          <span class="canvas-menu-item-icon" v-if="item.icon"></span>
          <span class="canvas-menu-item-label">{{ item.label }}</span>
          <span class="canvas-menu-item-desc" v-if="item.description">{{ item.description }}</span>
          <kbd class="canvas-menu-item-shortcut" v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </div>
      </template>
    </div>
  </div>
</template>
```

按 group 分组逻辑在 computed 中实现：

```typescript
const groupedItems = computed(() => {
  const groups = new Map<string, CanvasMenuItem[]>()
  for (const item of props.menu.items) {
    const g = item.group || 'action'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(item)
  }
  return Object.fromEntries(groups)
})
```

**验收标准：**
- danger 项显示红色
- 不同 group 之间有分隔线
- shortcut 显示为 kbd 样式

---

## Task 5: 从 Canvas.vue 抽走菜单逻辑（大重构）

**Files:**
- Modify: `src/canvas/core/Canvas.vue`

这是最关键的步骤——从 Canvas.vue 中移除约 100 行硬编码菜单逻辑，改为调用 ContextMenuPlugin 和 MenuResolver。

### Step 10: 删除旧代码，接入 MenuResolver

**要删除的代码块（精确行号偏移 ±5，实际以当前文件为准）：**

1. **删除** `NODE_MENU_ITEMS` 数组（L169-174）
2. **删除** `openCreateNodeMenu` 函数（L436-443）
3. **修改** `onMenuSelect` — 改为根据 `item.id` 前缀分发行为
4. **修改** `onNodeContextMenu` — 调用 `resolveMenuItems({ mode: 'node', nodeId, nodeType, flowPosition })` 而非 `openCreateNodeMenu`
5. **修改** `onPaneContextMenu` — 调用 `resolveMenuItems({ mode: 'pane', flowPosition })`
6. **修改** `onPaneDoubleClick` — 改为直接创建文本节点，不弹菜单
7. **修改** `createTempConnectionMenu` — 调用 `resolveMenuItems({ mode: 'connection', sourceNodeId, sourceNodeType, flowPosition })`

**新增逻辑：**

```typescript
// 将 onPaneDoubleClick 改为直接创建默认节点
function onPaneDoubleClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('.vue-flow__node') || target.closest('.vue-flow__edge')) return
  const flowPosition = toFlowPosition(event.clientX, event.clientY)
  // 直接创建文本节点（默认类型），不弹菜单
  const nodeId = `node-text-${Date.now()}`
  vueFlowInstance.addNodes([{
    id: nodeId, type: 'custom',
    position: { x: flowPosition.x - 150, y: flowPosition.y - 160 },
    data: { label: '文本', nodeType: 'text', cardWidth: 300, cardHeight: 320 },
    sourcePosition: Position.Right,
  }])
}

// 将 onNodeContextMenu 改为使用 MenuResolver
function onNodeContextMenu({ event, node }: NodeMouseEvent) {
  event.preventDefault()
  const e = event as MouseEvent
  const flowPosition = toFlowPosition(e.clientX, e.clientY)
  const items = resolveMenuItems({
    mode: 'node',
    nodeId: node.id,
    nodeType: (node.data as any)?.nodeType,
    nodeData: node.data as Record<string, unknown>,
    flowPosition,
  })
  menuState.visible = true
  menuState.title = (node.data as any)?.label || '节点菜单'
  menuState.mode = 'node'
  menuState.position = { x: e.clientX, y: e.clientY }
  menuState.items = items as any
  menuContext.value = { nodeId: node.id, flowPosition }
}

// onPaneContextMenu 同理，mode: 'pane'
// createTempConnectionMenu 同理，mode: 'connection', sourceNodeId, sourceNodeType
```

**onMenuSelect 改造：**

```typescript
async function onMenuSelect(item: CanvasMenuItem) {
  const ctx = menuContext.value

  // connection 模式：创建节点 + 连线
  if (menuState.mode === 'connection' && ctx.pendingConnection) {
    // ... 现有逻辑保留 ...
    return
  }

  // 按 menu item id 前缀分发
  const id = item.id as string

  if (id === 'node:delete') {
    if (ctx.nodeId) {
      const edgeIds = (getEdges.value as Edge[])
        .filter(e => e.source === ctx.nodeId || e.target === ctx.nodeId)
        .map(e => e.id)
      vueFlowInstance.removeEdges(edgeIds)
      vueFlowInstance.removeNodes([ctx.nodeId])
    }
    closeMenu()
    return
  }

  if (id === 'node:copy') {
    if (ctx.nodeId) {
      canvas.selectionState.selectedNodeIds = new Set([ctx.nodeId])
    }
    closeMenu()
    return
  }

  // create 前缀：通过事件总线触发创建
  if (id.startsWith('create:') && ctx.flowPosition) {
    const nodeType = id.replace('create:', '')
    createNodeByType(nodeType, ctx.flowPosition)
    closeMenu()
    return
  }

  closeMenu()
}
```

**验收标准：**
- 右键画布只显示创建节点菜单
- 右键节点显示删除/复制等操作菜单
- 双击画布直接创建文本节点
- 拖线释放显示过滤后的连接菜单
- NODE_MENU_ITEMS 数组已删除

---

## Task 6: CustomHandlePlugin

**Files:**
- Create: `src/canvas/core/plugins/custom-handle/CustomHandlePlugin.ts`
- Create: `src/canvas/core/plugins/custom-handle/ConnectionValidator.ts`
- Create: `src/canvas/core/plugins/custom-handle/ConnectionLineBuilder.ts`
- Create: `src/canvas/core/plugins/custom-handle/index.ts`
- Modify: `src/canvas/core/Canvas.vue` — 从插件获取 isValidConnection 和 buildConnectionEdgeProps
- Modify: `src/canvas/core/plugins/PluginContext.ts` — 已添加 registerHandleConfig

### Step 11: 写 ConnectionValidator

将 `Canvas.vue` 中的 `isValidConnection` 和 `normalizeConnection` 提取为独立模块：

```typescript
// src/canvas/core/plugins/custom-handle/ConnectionValidator.ts
import type { Connection, Node, Edge } from '@vue-flow/core'

export interface ValidationContext {
  getNodes: () => Node[]
  getEdges: () => Edge[]
}

function normalize(connection: Connection): Connection {
  return {
    ...connection,
    sourceHandle: connection.sourceHandle || 'source',
    targetHandle: connection.targetHandle || 'target',
  }
}

export function isValidConnection(
  connection: Connection,
  ctx: ValidationContext,
): boolean {
  const c = normalize(connection)

  if (!c.source || !c.target) return false
  if (c.sourceHandle !== 'source') return false
  if (c.targetHandle !== 'target') return false
  if (c.source === c.target) return false

  const src = ctx.getNodes().find(n => n.id === c.source)
  const tgt = ctx.getNodes().find(n => n.id === c.target)
  if (!src || !tgt) return false
  if (!src.sourcePosition) return false
  if (!tgt.targetPosition) return false

  return true
}

export function findSameConnection(
  connection: Connection,
  ctx: ValidationContext,
): Edge | undefined {
  const c = normalize(connection)
  return ctx.getEdges().find(
    (e: Edge & { isTemp?: boolean; data?: { isTemp?: boolean } }) =>
      !e.id?.startsWith('temp-') && !(e as any).data?.isTemp &&
      e.source === c.source && e.target === c.target &&
      (e.sourceHandle ?? 'source') === c.sourceHandle &&
      (e.targetHandle ?? 'target') === c.targetHandle,
  )
}
```

### Step 12: 写 ConnectionLineBuilder（抽走 buildConnectionEdgeProps）

将 `Canvas.vue` 中 `buildConnectionEdgeProps`（约 80 行，L997-L1125）提取到插件，通过事件总线暴露：

```typescript
// src/canvas/core/plugins/custom-handle/ConnectionLineBuilder.ts
import type { ConnectionLineProps, Node } from '@vue-flow/core'

export interface HandleConfig {
  radius: number
  snapOuterRatio: number
  snapInnerRatio: number
  snapHeightRatio: number
}

export function buildConnectionLine(
  props: ConnectionLineProps,
  config: HandleConfig,
  getNodes: () => Node[],
  getCardRect: (nodeId: string, ...) => any,
  getNodeSize: (node: Node) => { width: number; height: number },
): ConnectionLineProps & Record<string, any> {
  // ... 从 Canvas.vue L997-L1125 复制逻辑，参数化 config ...
  // 关键：用传入的 config 替代 canvas.state.handleRadius 等
}
```

### Step 13: 写 CustomHandlePlugin 入口

```typescript
// src/canvas/core/plugins/custom-handle/CustomHandlePlugin.ts
import type { CanvasPlugin, PluginContext } from '../types'
import { isValidConnection, findSameConnection } from './ConnectionValidator'
import { buildConnectionLine } from './ConnectionLineBuilder'

export const CustomHandlePlugin: CanvasPlugin = {
  name: 'custom-handle',
  version: '1.0.0',

  install(context: PluginContext) {
    // 1. 注册默认端口配置（可被其他插件覆盖）
    context.registerHandleConfig({
      radius: 76,
      restOffset: 36,
      cursorGap: 22,
      buttonSize: 32,
      overlap: 16,
      snapOuterRatio: 1.4,
      snapInnerRatio: 1.0,
      snapHeightRatio: 1.5,
    })

    // 2. 暴露连接验证器给事件总线（Canvas.vue 通过事件调用）
    context.emit = context.emit  // noop, keep for reference
    // 实际通过 store 暴露
    context.store.set('isValidConnection', isValidConnection)

    // 3. 暴露连接线构建器
    context.store.set('buildConnectionLine', buildConnectionLine)

    context.logger.info('CustomHandlePlugin 已安装，端口配置已注册')
  },
}
```

### Step 14: Canvas.vue 接入 CustomHandlePlugin

在 `onMounted` 后获取插件 API：

```typescript
const customHandleAPI = computed(() => {
  const api = manager.getPluginAPI<any>('custom-handle')
  return api
})

// isValidConnection 从插件获取
const pluginIsValidConnection = computed(() =>
  customHandleAPI.value?.isValidConnection
)

// 传递给 VueFlow 的 :is-valid-connection
const activeIsValidConnection = (conn: Connection) => {
  const fn = customHandleAPI.value?.isValidConnection
  return fn ? fn(conn, { getNodes: () => getNodes.value, getEdges: () => getEdges.value }) : true
}
```

**验收标准：**
- Canvas.vue 中 `isValidConnection` 和 `buildConnectionEdgeProps` 逻辑已内聚到插件
- 端口偏移参数通过 `context.registerHandleConfig` 可被其他插件修改
- 现有连接行为 100% 不变

---

## Task 7: NodeFindPlugin（Ctrl+F 节点搜索）

**Files:**
- Create: `src/canvas/core/plugins/node-find/NodeFindPlugin.ts`
- Create: `src/canvas/core/plugins/node-find/NodeFindOverlay.vue`
- Create: `src/canvas/core/plugins/node-find/index.ts`
- Modify: `src/canvas/core/plugins/context-menu/builtinMenuItems.ts` — 将 NodeFind 命令添加到 pane 菜单或快捷键

### Step 15: 写 NodeFindOverlay.vue（搜索弹窗）

```vue
<!-- src/canvas/core/plugins/node-find/NodeFindOverlay.vue -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import type { Node } from '@vue-flow/core'

const props = defineProps<{
  nodes: Node[]
  /** 聚焦节点 + 居中 */
  onFocus: (nodeId: string) => void
  onClose: () => void
}>()

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement>()

const results = computed(() => {
  if (!query.value.trim()) return []
  const q = query.value.toLowerCase()
  return props.nodes
    .filter(n => {
      const label = ((n.data as any)?.label as string) || ''
      return label.toLowerCase().includes(q)
    })
    .map(n => ({
      id: n.id,
      label: (n.data as any)?.label as string || n.id,
      nodeType: (n.data as any)?.nodeType,
    }))
})

onMounted(() => {
  nextTick(() => inputRef.value?.focus())
})

function onSelect(index: number) {
  const item = results.value[index]
  if (item) {
    props.onFocus(item.id)
    props.onClose()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    onSelect(selectedIndex.value)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    props.onClose()
  }
}
</script>

<template>
  <div class="node-find-overlay" @click.self="onClose">
    <div class="node-find-dialog" @keydown="onKeydown">
      <input ref="inputRef" v-model="query" type="text" placeholder="搜索节点..." class="node-find-input" />
      <div class="node-find-results" v-if="results.length > 0">
        <div
          v-for="(item, i) in results"
          :key="item.id"
          class="node-find-result"
          :class="{ 'is-selected': i === selectedIndex }"
          @click="onSelect(i)"
          @mouseenter="selectedIndex = i"
        >
          <span class="node-find-result-label">{{ item.label }}</span>
          <span class="node-find-result-type">{{ item.nodeType }}</span>
        </div>
      </div>
      <div class="node-find-empty" v-else-if="query.trim()">无匹配节点</div>
      <div class="node-find-footer">↑↓ 导航 · Enter 定位 · Esc 关闭</div>
    </div>
  </div>
</template>
```

### Step 16: 写 NodeFindPlugin.ts

```typescript
// src/canvas/core/plugins/node-find/NodeFindPlugin.ts
import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../types'
import NodeFindOverlay from './NodeFindOverlay.vue'

export const NodeFindPlugin: CanvasPlugin = {
  name: 'node-find',
  version: '1.0.0',

  install(context: PluginContext) {
    let overlayEl: HTMLElement | null = null

    // 注册 Ctrl+F 快捷键
    context.registerShortcut('ctrl+f', () => {
      if (overlayEl) return // 已打开

      const nodes = context.actions.getNodes()
      const div = document.createElement('div')
      div.id = 'node-find-overlay-root'

      // 使用 createApp 动态挂载 Vue 组件
      const { createApp, h } = require('vue')
      const app = createApp({
        render: () => h(NodeFindOverlay, {
          nodes,
          onFocus: (nodeId: string) => {
            const node = nodes.find(n => n.id === nodeId)
            if (node) {
              context.viewport.setCenter(
                node.position.x + 150,
                node.position.y + 130,
                context.viewport.getViewport().zoom >= 1.0
                  ? context.viewport.getViewport().zoom
                  : 1.0,
              )
            }
          },
          onClose: () => {
            app.unmount()
            div.remove()
            overlayEl = null
          },
        }),
      })
      app.mount(div)
      document.body.appendChild(div)
      overlayEl = div
    }, '查找节点')

    context.logger.info('NodeFindPlugin 已安装，Ctrl+F 搜索节点')
  },
}
```

> 注意：上述 `require('vue')` 应为 `import { createApp, h } from 'vue'`，在文件顶部导入。

**验收标准：**
- Ctrl+F 弹出搜索弹窗
- 输入关键词过滤节点
- ↑↓ Enter 导航并聚焦
- Esc 关闭

---

## Task 8: Export 内建到 StoragePlugin

**Files:**
- Modify: `src/canvas/core/plugins/storage/StoragePlugin.ts` — 添加 exportJSON / exportPNG 方法
- Modify: `src/canvas/core/plugins/context-menu/builtinMenuItems.ts` — 添加导出菜单项

### Step 17: 在 StoragePlugin 中添加导出方法

```typescript
// 在 StorageAPI 接口中添加：
export interface StorageAPI {
  // ...existing...
  /** 导出画布为 JSON（排除临时节点） */
  exportJSON(): string
  /** 通过 VueFlow 导出 PNG */
  exportPNG(): Promise<void>
}

// 在 StoragePlugin 的 install 中实现：
install(context: PluginContext) {
  // ... existing ...

  return {
    api: {
      // ... existing methods ...

      exportJSON(): string {
        const nodes = context.actions.getNodes()
          .filter(n => n.type !== 'tempTarget' && !(n.data as any)?.isTemp)
        const edges = context.actions.getEdges()
          .filter(e => !e.id?.startsWith('temp-') && !(e.data as any)?.isTemp)
        return JSON.stringify({ nodes, edges }, null, 2)
      },

      async exportPNG(): Promise<void> {
        // 使用 VueFlow 实例的截图能力
        // 调用 useVueFlow() 中的 toObject 后用 canvas API 截图
        const vfEl = document.querySelector('.vue-flow__viewport') as HTMLElement
        if (!vfEl) throw new Error('VueFlow viewport not found')

        const { toJpeg } = await import('html-to-image')
        const dataUrl = await toJpeg(vfEl, { quality: 1.0, backgroundColor: '#ffffff' })

        const link = document.createElement('a')
        link.download = `canvas-export-${Date.now()}.jpg`
        link.href = dataUrl
        link.click()
      },
    },
  }
}
```

### Step 18: 注册导出菜单项

在 `builtinMenuItems.ts` 的 node 菜单中添加：

```typescript
{ id: 'node:export-json', group: 'action', label: '导出 JSON',
  visible: (c) => c.mode === 'node',
  priority: -5 },
```

或在 pane 菜单添加全局导出。由 ContextMenuPlugin 统一管理。

**验收标准：**
- `storageAPI.exportJSON()` 返回不含临时节点的画布 JSON
- `storageAPI.exportPNG()` 触发浏览器下载
- 右键菜单可见导出选项

---

## Task 9: 注册节点类型时声明菜单

**Files:**
- Modify: `src/canvas/core/plugins/PluginContext.ts` — 扩展 registerNodeType 支持 menus 参数（已有 registerNodeType，加第二个可选参数）
- 示例：各节点类型目录下添加 `menus.ts`

### Step 19: 扩展 registerNodeType 签名

在 `PluginContext.ts` 中：

```typescript
registerNodeType(
  name: string,
  component: Component,
  opts?: {
    menus?: MenuItemDefinition[]
    connectableFrom?: string[]  // 哪些来源节点可连接到此类型
  },
): void {
  try {
    effectiveStore.registerCustomNodeType?.(name, component)
    if (opts?.menus) {
      MenuRegistry.getInstance().registerForNodeType(name, opts.menus)
    }
    if (opts?.connectableFrom) {
      context.store.set(`connectableFrom:${name}`, opts.connectableFrom)
    }
    logger.debug(`Registered node type: "${name}"`)
  } catch (err) {
    logger.error(`Failed to register node type "${name}":`, err)
  }
}
```

### Step 20: 示例——文本节点注册菜单

```typescript
// 在注册文本节点类型的地方（如 CustomNode.vue 或插件 install 中）
context.registerNodeType('text', TextNode, {
  menus: [
    { id: 'text:edit', group: 'action', label: '编辑文本',
      visible: (c) => c.mode === 'node' && c.nodeType === 'text' },
    { id: 'text:convert-to-image', group: 'transform', label: '转换为 AI 图片',
      visible: (c) => c.mode === 'node' && c.nodeType === 'text' },
  ],
  connectableFrom: ['text', 'image', 'stage'],
})

context.registerNodeType('image', ImageNode, {
  menus: [
    { id: 'image:replace', group: 'action', label: '替换图片',
      visible: (c) => c.mode === 'node' && c.nodeType === 'image' },
    { id: 'image:crop', group: 'action', label: '裁切',
      visible: (c) => c.mode === 'node' && c.nodeType === 'image' },
  ],
  connectableFrom: ['text', 'image', 'stage', 'video'],
})
```

**验收标准：**
- 右键文本节点 → 菜单包含「编辑文本」「转换为 AI 图片」
- 右键图片节点 → 菜单包含「替换图片」「裁切」
- 通用操作（复制/删除/置顶）仍然存在

---

## Task 10: 集成、测试、清理

**Files:**
- Modify: `src/canvas/core/Canvas.vue` — 确保 3 个新插件被加载
- Modify: `src/canvas/core/plugins/index.ts` — 导出新插件

### Step 21: 注册插件到 Canvas.vue

在 `onMounted` 中确保插件列表包含：

```typescript
import { ContextMenuPlugin } from './plugins/context-menu'
import { CustomHandlePlugin } from './plugins/custom-handle'
import { NodeFindPlugin } from './plugins/node-find'

// 在插件数组前添加（ContextMenu 和 CustomHandle 应最优先加载）：
const pluginList = [
  ContextMenuPlugin,
  CustomHandlePlugin,
  ...(props.plugins || []),
  NodeFindPlugin,
]
```

### Step 22: 验证清单

- [ ] `npm run build` 无错误
- [ ] 右键画布 → 显示 4 个创建节点菜单项（文本/图片/视频/导演台）
- [ ] 右键节点 → 显示删除/复制/置顶/置底 + 节点类型专属操作
- [ ] 双击画布 → 直接创建文本节点
- [ ] 拖线到空白 → 显示过滤后的连线菜单
- [ ] Ctrl+F → 弹出搜索弹窗
- [ ] 搜索节点 → 输入关键词过滤 → Enter 定位
- [ ] Storage 插件 expose exportJSON/exportPNG
- [ ] 连接行为无回归（CustomHandle 接管后与之前一致）

---

## 执行顺序 & 依赖关系

```
Task 1 (扩展 API)
  ├─→ Task 2 (MenuRegistry)
  │     └─→ Task 3 (ContextMenuPlugin 骨架)
  │           └─→ Task 4 (重构 CanvasMenu 组件)
  │                 └─→ Task 5 (Canvas.vue 大重构)
  │                       └─→ Task 10 (集成测试)
  │
  ├─→ Task 6 (CustomHandlePlugin)
  │     └─→ Task 5 (部分) → Task 10
  │
  ├─→ Task 7 (NodeFindPlugin)
  │     └─→ Task 10
  │
  └─→ Task 8 (Export in Storage)
        └─→ Task 10

Task 9 (节点类型菜单) 依赖 Task 3 → 独立于 Task 10
```

**推荐执行顺序：** Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10
