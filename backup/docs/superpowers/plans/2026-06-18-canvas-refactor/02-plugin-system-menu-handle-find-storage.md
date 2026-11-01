# Plan 2: 插件系统完善 — MenuRegistry + ContextMenu + CustomHandle + NodeFind + 存储修复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把菜单、端口配置、节点搜索和保存清洗继续从 `Canvas.vue` 迁到插件系统；修复保存时改坏 `node.type` 的 P0 bug。

**Architecture:** `MenuRegistry` 是当前 Canvas runtime 的实例，不是全局单例；创建节点菜单从 `NodeRegistry` 动态生成；插件内拿其他插件 API 统一使用 `context.getPluginAPI()`。

**Tech Stack:** Vue 3 + TypeScript, VueFlow, Pinia, Node native `node:test`, pnpm。

---

## 复查后必须修正的点

- 不要做 `MenuRegistry.getInstance()`，这会继续制造全局状态。`MenuRegistry` 要挂在当前 `CanvasRuntime`。
- 菜单不要再次硬编码 text/image/video/stage，要从 `NodeRegistry.getMenuItems()` 生成。
- `registerHandleConfig()` 不能写不存在的 `state.handleConfig`，当前 store 字段是 `handleRadius`、`handleRestOffset` 等平铺字段。
- 右键复制不能只选中节点，要调用 clipboard API。
- 原计划写了 edge 菜单，但 `Canvas.vue` 没绑定 `@edge-context-menu`，要补上。
- `exportPNG()` 需要安装 `html-to-image`，且用 `toPng` 下载 `.png`，不要 `toJpeg` 下载 `.jpg`。
- `NodeFindPlugin` 必须在卸载时注销快捷键并清理 overlay。

---

## 文件结构

新建：
- `src/canvas/core/menu/MenuRegistry.ts`
- `src/canvas/core/menu/MenuResolver.ts`
- `src/canvas/core/menu/index.ts`
- `src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts`
- `src/canvas/core/plugins/context-menu/builtinMenuItems.ts`
- `src/canvas/core/plugins/context-menu/index.ts`
- `src/canvas/core/plugins/custom-handle/CustomHandlePlugin.ts`
- `src/canvas/core/plugins/custom-handle/ConnectionValidator.ts`
- `src/canvas/core/plugins/custom-handle/index.ts`
- `src/canvas/core/plugins/node-find/NodeFindPlugin.ts`
- `src/canvas/core/plugins/node-find/NodeFindOverlay.vue`
- `src/canvas/core/plugins/node-find/index.ts`
- `src/canvas/core/plugins/storage/sanitizeForSave.ts`
- `src/canvas/core/plugins/storage/__tests__/sanitizeForSave.test.ts`

修改：
- `package.json`
- `src/canvas/core/runtime/CanvasRuntime.ts`
- `src/canvas/core/plugins/types.ts`
- `src/canvas/core/plugins/PluginContext.ts`
- `src/canvas/core/components/CanvasMenu.types.ts`
- `src/canvas/core/components/CanvasMenu.vue`
- `src/canvas/core/Canvas.vue`
- `src/canvas/core/plugins/storage/StoragePlugin.ts`
- `src/App.vue`

---

### Task 1: 创建 MenuRegistry / MenuResolver 并挂到 CanvasRuntime

**Files:**
- Create: `src/canvas/core/menu/MenuRegistry.ts`
- Create: `src/canvas/core/menu/MenuResolver.ts`
- Create: `src/canvas/core/menu/index.ts`
- Modify: `src/canvas/core/runtime/CanvasRuntime.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 写 MenuRegistry**

Create `src/canvas/core/menu/MenuRegistry.ts`:

```typescript
export interface MenuContext {
  mode: 'pane' | 'node' | 'connection' | 'edge'
  nodeId?: string
  nodeType?: string
  edgeId?: string
  sourceNodeId?: string
  flowPosition?: { x: number; y: number }
}

export interface MenuItemDefinition {
  id: string
  label: string
  description?: string
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
  badge?: string
  shortcut?: string
  danger?: boolean
  group?: 'create' | 'action' | 'delete'
  priority?: number
  visible: (ctx: MenuContext) => boolean
}

interface RegistryEntry {
  source: string
  item: MenuItemDefinition
}

export class MenuRegistry {
  private entries: RegistryEntry[] = []

  register(source: string, items: MenuItemDefinition[]): void {
    this.unregisterSource(source)
    for (const item of items) this.entries.push({ source, item })
  }

  unregister(source: string, ids: string[]): void {
    const idSet = new Set(ids)
    this.entries = this.entries.filter(entry => !(entry.source === source && idSet.has(entry.item.id)))
  }

  unregisterSource(source: string): void {
    this.entries = this.entries.filter(entry => entry.source !== source)
  }

  getAll(): RegistryEntry[] {
    return [...this.entries]
  }
}
```

- [ ] **Step 2: 写 MenuResolver**

Create `src/canvas/core/menu/MenuResolver.ts`:

```typescript
import type { NodeRegistry } from '../registry/NodeRegistry'
import type { MenuContext, MenuItemDefinition, MenuRegistry } from './MenuRegistry'

export interface ResolvedMenuItem {
  id: string
  label: string
  description?: string
  icon?: MenuItemDefinition['icon']
  badge?: string
  shortcut?: string
  danger?: boolean
  group: string
  priority?: number
}

const GROUP_ORDER: Record<string, number> = { create: 1, action: 2, delete: 3 }

function createNodeItems(ctx: MenuContext, nodeRegistry: NodeRegistry): ResolvedMenuItem[] {
  if (ctx.mode !== 'pane' && ctx.mode !== 'connection') return []
  const prefix = ctx.mode === 'connection' ? 'connect:' : 'create:'
  return nodeRegistry.getMenuItems().map((item, index) => ({
    id: `${prefix}${item.id}`,
    label: item.label,
    description: item.description,
    icon: item.icon,
    badge: item.badge,
    group: 'create',
    priority: 100 - index,
  }))
}

export function resolveMenuItems(ctx: MenuContext, menuRegistry: MenuRegistry, nodeRegistry: NodeRegistry): ResolvedMenuItem[] {
  const items: ResolvedMenuItem[] = createNodeItems(ctx, nodeRegistry)

  for (const entry of menuRegistry.getAll()) {
    try {
      if (!entry.item.visible(ctx)) continue
      items.push({
        id: entry.item.id,
        label: entry.item.label,
        description: entry.item.description,
        icon: entry.item.icon,
        badge: entry.item.badge,
        shortcut: entry.item.shortcut,
        danger: entry.item.danger,
        group: entry.item.group || 'action',
        priority: entry.item.priority ?? 0,
      })
    } catch (err) {
      console.warn(`[MenuResolver] visible() failed for ${entry.item.id}:`, err)
    }
  }

  return items.sort((a, b) => {
    const ga = GROUP_ORDER[a.group] ?? 99
    const gb = GROUP_ORDER[b.group] ?? 99
    if (ga !== gb) return ga - gb
    const pa = a.priority ?? 0
    const pb = b.priority ?? 0
    if (pa !== pb) return pb - pa
    return a.id.localeCompare(b.id)
  })
}
```

Create `src/canvas/core/menu/index.ts`:

```typescript
export { MenuRegistry } from './MenuRegistry'
export type { MenuContext, MenuItemDefinition } from './MenuRegistry'
export { resolveMenuItems } from './MenuResolver'
export type { ResolvedMenuItem } from './MenuResolver'
```

- [ ] **Step 3: CanvasRuntime 加 menuRegistry**

Modify `src/canvas/core/runtime/CanvasRuntime.ts`:

```typescript
import type { MenuRegistry } from '../menu/MenuRegistry'
```

Constructor becomes:

```typescript
constructor(
  readonly pluginManager: PluginManager,
  readonly eventBus: EventBus,
  readonly nodeRegistry: NodeRegistry,
  readonly menuRegistry: MenuRegistry,
  readonly vueFlowInstance: any,
) {}
```

- [ ] **Step 4: Canvas.vue 创建 menuRegistry**

Add import:

```typescript
import { MenuRegistry, resolveMenuItems } from './menu'
```

Near `nodeRegistry`:

```typescript
const menuRegistry = new MenuRegistry()
const runtime = new CanvasRuntime(manager, manager.eventBus, nodeRegistry, menuRegistry, vueFlowInstance as any)
```

- [ ] **Step 5: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/menu src/canvas/core/runtime/CanvasRuntime.ts src/canvas/core/Canvas.vue
git commit -m "feat: add per-canvas MenuRegistry and resolver"
```

---

### Task 2: PluginContext 添加 menus 和 handle config API

**Files:**
- Modify: `src/canvas/core/plugins/types.ts`
- Modify: `src/canvas/core/plugins/PluginContext.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: types.ts 添加类型和字段**

Add import:

```typescript
import type { MenuItemDefinition } from '../menu/MenuRegistry'
```

Add:

```typescript
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

export interface MenuRegistryAPI {
  register(items: MenuItemDefinition[]): void
  unregister(ids: string[]): void
  unregisterAll(): void
}
```

Inside `PluginContext`, add:

```typescript
readonly menus: MenuRegistryAPI
registerHandleConfig(config: Partial<HandleConfig>): void
```

- [ ] **Step 2: PluginContext.ts 实现**

Import:

```typescript
import type { MenuRegistry } from '../menu/MenuRegistry'
import type { HandleConfig, MenuItemDefinition } from './types'
```

Add to `CreatePluginContextOptions`:

```typescript
menuRegistry?: MenuRegistry
```

Destructure `menuRegistry` from options。

Inside returned `context` object:

```typescript
menus: {
  register(items: MenuItemDefinition[]): void {
    menuRegistry?.register(`plugin:${pluginName}`, items)
  },
  unregister(ids: string[]): void {
    menuRegistry?.unregister(`plugin:${pluginName}`, ids)
  },
  unregisterAll(): void {
    menuRegistry?.unregisterSource(`plugin:${pluginName}`)
  },
},

registerHandleConfig(config: Partial<HandleConfig>): void {
  const state = effectiveStore.state as Record<string, unknown>
  if (typeof config.radius === 'number') state.handleRadius = config.radius
  if (typeof config.restOffset === 'number') state.handleRestOffset = config.restOffset
  if (typeof config.cursorGap === 'number') state.handleCursorGap = config.cursorGap
  if (typeof config.buttonSize === 'number') state.handleButtonSize = config.buttonSize
  if (typeof config.overlap === 'number') state.handleOverlap = config.overlap
  if (typeof config.snapOuterRatio === 'number') state.connectionSnapOuterRatio = config.snapOuterRatio
  if (typeof config.snapInnerRatio === 'number') state.connectionSnapInnerRatio = config.snapInnerRatio
  if (typeof config.snapHeightRatio === 'number') state.connectionSnapHeightRatio = config.snapHeightRatio
},
```

- [ ] **Step 3: Canvas.vue createPluginContext 传 menuRegistry**

```typescript
menuRegistry,
```

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/types.ts src/canvas/core/plugins/PluginContext.ts src/canvas/core/Canvas.vue
git commit -m "feat: expose menu and handle config APIs through PluginContext"
```

---

### Task 3: 创建 ContextMenuPlugin

**Files:**
- Create: `src/canvas/core/plugins/context-menu/builtinMenuItems.ts`
- Create: `src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts`
- Create: `src/canvas/core/plugins/context-menu/index.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: 内置动作菜单，只注册动作，不注册节点类型**

Create `src/canvas/core/plugins/context-menu/builtinMenuItems.ts`:

```typescript
import type { MenuItemDefinition } from '../../menu/MenuRegistry'

export function createBuiltinMenuItems(): MenuItemDefinition[] {
  return [
    { id: 'node:copy', group: 'action', label: '复制', shortcut: 'Ctrl+C', icon: 'duplicate', visible: ctx => ctx.mode === 'node', priority: 30 },
    { id: 'node:duplicate', group: 'action', label: '复制一份', shortcut: 'Ctrl+D', icon: 'duplicate', visible: ctx => ctx.mode === 'node', priority: 20 },
    { id: 'node:delete', group: 'delete', label: '删除节点', shortcut: 'Del', icon: 'delete', danger: true, visible: ctx => ctx.mode === 'node', priority: 10 },
    { id: 'edge:delete', group: 'delete', label: '删除连线', shortcut: 'Del', icon: 'delete', danger: true, visible: ctx => ctx.mode === 'edge', priority: 10 },
  ]
}
```

Create `src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../types'
import { createBuiltinMenuItems } from './builtinMenuItems'

export const ContextMenuPlugin: CanvasPlugin = {
  name: 'context-menu',
  version: '1.0.0',

  install(context: PluginContext) {
    context.menus.register(createBuiltinMenuItems())
    return {
      uninstall() {
        context.menus.unregisterAll()
      },
    }
  },
}
```

Create `src/canvas/core/plugins/context-menu/index.ts`:

```typescript
export { ContextMenuPlugin } from './ContextMenuPlugin'
```

- [ ] **Step 2: App.vue 注册**

Add import and plugin slot after node plugins。

- [ ] **Step 3: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/context-menu src/App.vue
git commit -m "feat: add ContextMenuPlugin for menu actions"
```

---

### Task 4: CanvasMenu 支持 group / danger / shortcut / edge

**Files:**
- Modify: `src/canvas/core/components/CanvasMenu.types.ts`
- Modify: `src/canvas/core/components/CanvasMenu.vue`

- [ ] **Step 1: 扩展类型**

Replace `CanvasMenu.types.ts`:

```typescript
export type CanvasMenuMode = 'pane' | 'node' | 'connection' | 'edge'

export type CanvasMenuItem = {
  id: string
  label: string
  description?: string
  badge?: string
  disabled?: boolean
  danger?: boolean
  shortcut?: string
  group?: string
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
}

export type CanvasMenuState = {
  visible: boolean
  title: string
  mode: CanvasMenuMode
  position: { x: number; y: number }
  items: CanvasMenuItem[]
}
```

- [ ] **Step 2: CanvasMenu.vue 添加分组 computed 和样式**

Add script computed:

```typescript
const groupedItems = computed(() => {
  const groups = new Map<string, CanvasMenuItem[]>()
  for (const item of props.menu.items) {
    const group = item.group || 'action'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(item)
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})
```

Template should loop groups, add divider between groups, and show `shortcut` before `badge`.

Add CSS:

```css
.canvas-menu-divider { height: 1px; margin: 8px 0; background: rgb(255 255 255 / 0.08); }
.canvas-menu-item.is-danger { color: #fecaca; }
.canvas-menu-item.is-danger:hover:not(.is-disabled) { background: rgb(239 68 68 / 0.18); }
.canvas-menu-shortcut { color: #a1a1aa; font-size: 11px; font-weight: 700; }
```

- [ ] **Step 3: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/components/CanvasMenu.types.ts src/canvas/core/components/CanvasMenu.vue
git commit -m "feat: support grouped context menu items"
```

---

### Task 5: Canvas.vue 接入 MenuResolver 和 edge 菜单

**Files:**
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 添加 EdgeMouseEvent 类型**

```typescript
import type { Node, Edge, Connection, EdgeChange, NodeMouseEvent, EdgeMouseEvent, OnConnectStartParams } from '@vue-flow/core'
```

- [ ] **Step 2: 替换 onNodeContextMenu / onPaneContextMenu**

`onNodeContextMenu` uses:

```typescript
items: resolveMenuItems({ mode: 'node', nodeId: node.id, nodeType: (node.data as any)?.nodeType, flowPosition }, menuRegistry, nodeRegistry)
```

`onPaneContextMenu` uses:

```typescript
items: resolveMenuItems({ mode: 'pane', flowPosition }, menuRegistry, nodeRegistry)
```

- [ ] **Step 3: 双击画布直接创建文本节点**

After node/edge target guard:

```typescript
const flowPosition = toFlowPosition(event.clientX, event.clientY)
createNodeFromMenuItem({ id: 'text', label: nodeRegistry.getLabel('text'), icon: 'text' }, flowPosition)
```

- [ ] **Step 4: 添加 edge context menu**

Add function:

```typescript
function onEdgeContextMenu({ event, edge }: EdgeMouseEvent) {
  event.preventDefault()
  const e = event as MouseEvent
  const flowPosition = toFlowPosition(e.clientX, e.clientY)
  openMenu({
    mode: 'edge',
    title: `连线 ${edge.id} 菜单`,
    position: { x: e.clientX, y: e.clientY },
    items: resolveMenuItems({ mode: 'edge', edgeId: edge.id, flowPosition }, menuRegistry, nodeRegistry),
  }, { edgeId: edge.id, flowPosition })
}
```

Add to `<VueFlow>`:

```vue
@edge-context-menu="onEdgeContextMenu"
```

- [ ] **Step 5: onMenuSelect 处理 create/connect/copy/duplicate/delete**

Important rules:

- `connect:*`：删除临时点和临时边，创建对应 `nodeType`，再连线。
- `create:*`：创建对应 `nodeType`。
- `node:copy`：先 `canvas.setSelection({ nodeIds: [context.nodeId], edgeIds: [] })`，再 `manager.getPluginAPI('clipboard')?.copy()`。
- `node:duplicate`：copy 后 paste。
- `node:delete`：删节点和相连边。
- `edge:delete`：删边。

- [ ] **Step 6: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/Canvas.vue
git commit -m "refactor: route canvas context menus through MenuResolver"
```

---

### Task 6: CustomHandlePlugin + ConnectionValidator

**Files:**
- Create: `src/canvas/core/plugins/custom-handle/ConnectionValidator.ts`
- Create: `src/canvas/core/plugins/custom-handle/CustomHandlePlugin.ts`
- Create: `src/canvas/core/plugins/custom-handle/index.ts`
- Modify: `src/canvas/core/Canvas.vue`
- Modify: `src/App.vue`

- [ ] **Step 1: 写验证函数**

Create `ConnectionValidator.ts`:

```typescript
import type { Connection, Edge, Node } from '@vue-flow/core'

export function normalizeConnection(connection: Connection): Connection {
  return { ...connection, sourceHandle: connection.sourceHandle || 'source', targetHandle: connection.targetHandle || 'target' }
}

export function isValidCanvasConnection(connection: Connection, getNodes: () => Node[], getEdges: () => Edge[]): boolean {
  const normalized = normalizeConnection(connection)
  if (!normalized.source || !normalized.target) return false
  if (normalized.sourceHandle !== 'source') return false
  if (normalized.targetHandle !== 'target') return false
  if (normalized.source === normalized.target) return false

  const source = getNodes().find(node => node.id === normalized.source)
  const target = getNodes().find(node => node.id === normalized.target)
  if (!source || !target) return false
  if (!source.sourcePosition || !target.targetPosition) return false

  return !getEdges().some(edge =>
    edge.source === normalized.source &&
    edge.target === normalized.target &&
    (edge.sourceHandle ?? 'source') === normalized.sourceHandle &&
    (edge.targetHandle ?? 'target') === normalized.targetHandle &&
    !(edge.data as any)?.isTemp
  )
}
```

- [ ] **Step 2: 写插件**

Create `CustomHandlePlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../types'

export const CustomHandlePlugin: CanvasPlugin = {
  name: 'custom-handle',
  version: '1.0.0',
  install(context: PluginContext) {
    context.registerHandleConfig({ radius: 86, restOffset: 36, cursorGap: 24, buttonSize: 32, overlap: 16, snapOuterRatio: 0.75, snapInnerRatio: 0.6, snapHeightRatio: 1.35 })
  },
}
```

Create index export。

- [ ] **Step 3: Canvas.vue 和 App.vue 接入**

Canvas.vue import validator and replace duplicated validation body.

App.vue add `CustomHandlePlugin` slot。

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/custom-handle src/canvas/core/Canvas.vue src/App.vue
git commit -m "feat: extract handle config and connection validation"
```

---

### Task 7: NodeFindPlugin

**Files:**
- Create: `src/canvas/core/plugins/node-find/NodeFindOverlay.vue`
- Create: `src/canvas/core/plugins/node-find/NodeFindPlugin.ts`
- Create: `src/canvas/core/plugins/node-find/index.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: Overlay 支持输入、上下选择、Enter 聚焦、Esc 关闭**

Create `NodeFindOverlay.vue` with props:

```typescript
nodes: Node[]
onFocus: (nodeId: string) => void
onClose: () => void
```

Search label、id、nodeType。

- [ ] **Step 2: 插件用 context.mountOverlay，卸载要清理**

`NodeFindPlugin.ts` must:

- `context.registerShortcut('ctrl+f', openOverlay, '搜索节点')`
- `openOverlay()` creates a Vue app and mounts overlay
- `closeOverlay()` unmounts app and removes DOM
- `uninstall()` calls `context.unregisterShortcut('ctrl+f')` and `closeOverlay()`

- [ ] **Step 3: App.vue 注册**

Add `NodeFindPlugin`。

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/node-find src/App.vue
git commit -m "feat: add Ctrl+F node search plugin"
```

---

### Task 8: 修复 StoragePlugin 保存清洗、卸载清理、导出

**Files:**
- Create: `src/canvas/core/plugins/storage/sanitizeForSave.ts`
- Create: `src/canvas/core/plugins/storage/__tests__/sanitizeForSave.test.ts`
- Modify: `src/canvas/core/plugins/storage/StoragePlugin.ts`
- Modify: `package.json`

- [ ] **Step 1: 安装导出依赖**

```powershell
pnpm add html-to-image
```

- [ ] **Step 2: 写 sanitizeForSave 测试**

Create tests covering:

- 保留 `node.type === 'custom'` 和 `node.data.nodeType`
- 删除 `imageUrl/videoUrl/thumbUrl/_cropMode/_cropRect`
- 删除 `data.values[*]._url`
- 删除 `type === 'tempTarget'`、`id` 以 `temp-` 开头、`data.isTemp` 的临时节点/边
- 不修改输入对象

- [ ] **Step 3: 实现 sanitizeForSave**

Create `sanitizeForSave.ts`:

```typescript
const RUNTIME_FIELDS = ['imageUrl', 'videoUrl', 'thumbUrl', '_cropRect', '_cropMode'] as const

function cloneCanvasData(nodes: unknown[], edges: unknown[]): { nodes: any[]; edges: any[] } {
  return JSON.parse(JSON.stringify({ nodes, edges }))
}

function removeRuntimeData(data: Record<string, unknown>): void {
  for (const key of RUNTIME_FIELDS) delete data[key]
  const values = data.values
  if (!values || typeof values !== 'object') return
  for (const value of Object.values(values as Record<string, unknown>)) {
    if (value && typeof value === 'object') delete (value as Record<string, unknown>)._url
  }
}

export function sanitizeForSave(nodes: unknown[], edges: unknown[]): { nodes: any[]; edges: any[] } {
  const cleaned = cloneCanvasData(nodes, edges)
  for (const node of cleaned.nodes) {
    if (node.data && typeof node.data === 'object') removeRuntimeData(node.data)
  }
  cleaned.nodes = cleaned.nodes.filter(node => node.type !== 'tempTarget' && !String(node.id ?? '').startsWith('temp-') && !node.data?.isTemp)
  cleaned.edges = cleaned.edges.filter(edge => !String(edge.id ?? '').startsWith('temp-') && !edge.data?.isTemp)
  return cleaned
}
```

- [ ] **Step 4: StoragePlugin 改用新函数并删除旧函数**

Add import:

```typescript
import { sanitizeForSave } from './sanitizeForSave'
```

Delete old inline `sanitizeForSave()` that rewrites node type。

- [ ] **Step 5: 添加 exportJSON/exportPNG**

StorageAPI adds:

```typescript
exportJSON(): string
exportPNG(): Promise<void>
```

api adds:

```typescript
exportJSON() {
  return JSON.stringify(sanitizeForSave(context.actions.getNodes(), context.actions.getEdges()), null, 2)
},
async exportPNG() {
  const viewport = document.querySelector('.vue-flow__viewport') as HTMLElement | null
  if (!viewport) throw new Error('VueFlow viewport not found')
  const { toPng } = await import('html-to-image')
  const dataUrl = await toPng(viewport, { backgroundColor: '#ffffff' })
  const link = document.createElement('a')
  link.download = `canvas-export-${Date.now()}.png`
  link.href = dataUrl
  link.click()
},
```

- [ ] **Step 6: 添加 uninstall 清理**

Return:

```typescript
return {
  api,
  uninstall() {
    if (_restoreTimer) { clearTimeout(_restoreTimer); _restoreTimer = null }
    canvasDataCache.clear()
    assetManager.revokeAllURLs()
    assetManager.setStore(null)
    fsAdapter = null
    isConnected = false
    connectionMode = 'none'
    currentProjectId = null
    projectIndex.length = 0
  },
}
```

- [ ] **Step 7: 测试 + 构建 + 提交**

```powershell
node --test src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts
pnpm build
git add package.json pnpm-lock.yaml src/canvas/core/plugins/storage
git commit -m "fix: preserve custom node type in storage sanitize and add cleanup"
```

---

## 完成标准

- [ ] `pnpm build` 通过。
- [ ] storage sanitize 测试通过。
- [ ] 右键画布菜单从 NodeRegistry 动态显示节点类型。
- [ ] 右键节点有复制、复制一份、删除。
- [ ] 右键连线有删除。
- [ ] 双击空白画布直接创建文本节点。
- [ ] Ctrl+F 能搜索节点并聚焦。
- [ ] 保存后节点仍是 `type: 'custom'`，业务类型在 `data.nodeType`。
