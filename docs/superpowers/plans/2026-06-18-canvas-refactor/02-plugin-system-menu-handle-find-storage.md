# Plan 2: 插件系统完善 — MenuRegistry + ContextMenu + CustomHandle + NodeFind + 存储修复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Canvas.vue 中的硬编码菜单逻辑、连接验证逻辑、端口配置全部抽成独立插件；新增 Ctrl+F 节点搜索；修复 StoragePlugin 保存时改坏 node type 的 bug 并添加导出和卸载清理。

**Architecture:** MenuRegistry（单例注册表）作为菜单路由引擎，ContextMenuPlugin 注册内置菜单项，CustomHandlePlugin 接管连接验证和端口配置，NodeFindPlugin 通过 `mountOverlay` 挂载搜索弹窗。存储方面：`sanitizeForSave` 抽为纯函数 + 测试保护。

**Tech Stack:** Vue 3 + TypeScript, VueFlow, Pinia, Node native `node:test`, pnpm。

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
- `src/canvas/core/plugins/types.ts` — 添加 MenuItemDefinition、HandleConfig、MenuContext 类型
- `src/canvas/core/plugins/PluginContext.ts` — 添加 menus、registerHandleConfig 实现
- `src/canvas/core/components/CanvasMenu.types.ts` — 扩展 CanvasMenuMode、CanvasMenuItem
- `src/canvas/core/components/CanvasMenu.vue` — 支持 group 分隔、danger 红色、shortcut 显示
- `src/canvas/core/Canvas.vue` — 接入 MenuResolver、删除硬编码菜单逻辑
- `src/canvas/core/plugins/storage/StoragePlugin.ts` — 拆分 sanitizeForSave、添加 uninstall/export
- `src/App.vue` — 注册三个新插件

---

### Task 1: 扩展 PluginContext API（menus + handle）

**Files:**
- Modify: `src/canvas/core/plugins/types.ts`
- Modify: `src/canvas/core/plugins/PluginContext.ts`

- [ ] **Step 1: types.ts 添加新类型**

In `src/canvas/core/plugins/types.ts`, add before the `PluginContext` interface:

```typescript
export interface MenuItemDefinition {
  id: string
  label: string
  description?: string
  icon?: string
  shortcut?: string
  danger?: boolean
  group?: string
  priority?: number
  visible: (ctx: MenuContext) => boolean
}

export interface MenuContext {
  mode: string
  nodeId?: string
  nodeType?: string
  flowPosition?: { x: number; y: number }
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
```

In `PluginContext` interface, add:

```typescript
menus: {
  register(items: MenuItemDefinition[]): void
  unregister(ids: string[]): void
}
registerHandleConfig(config: Partial<HandleConfig>): void
```

- [ ] **Step 2: PluginContext.ts 实现 menus 和 registerHandleConfig**

In `src/canvas/core/plugins/PluginContext.ts`, add import:

```typescript
import { MenuRegistry } from '../menu/MenuRegistry'
```

In the `context` object (before `return context`), add:

```typescript
menus: {
  register(items: MenuItemDefinition[]): void {
    MenuRegistry.getInstance().register(pluginName, items)
  },
  unregister(ids: string[]): void {
    MenuRegistry.getInstance().unregister(pluginName, ids)
  },
},
registerHandleConfig(config: Partial<HandleConfig>): void {
  const current = effectiveStore.state.handleConfig || {}
  effectiveStore.state.handleConfig = { ...current, ...config }
},
```

- [ ] **Step 3: 构建验证**

```powershell
pnpm build
```

Expected: exit code `0`（此时 MenuRegistry 还不存在，但 PluginContext 中只是 import 它，构建时会报找不到模块。需要先创建 MenuRegistry 的骨架文件再构建，或者这一步和 Task 2 合并构建）。

实际做法：这一步先写代码不构建，Task 2 创建 MenuRegistry 后一起构建。

- [ ] **Step 4: 提交（与 Task 2 合并提交）**

```powershell
# 暂存，等 Task 2 完成后一起提交
git add src/canvas/core/plugins/types.ts src/canvas/core/plugins/PluginContext.ts
```

---

### Task 2: 创建 MenuRegistry + MenuResolver

**Files:**
- Create: `src/canvas/core/menu/MenuRegistry.ts`
- Create: `src/canvas/core/menu/MenuResolver.ts`
- Create: `src/canvas/core/menu/index.ts`

- [ ] **Step 1: 写 MenuRegistry**

Create `src/canvas/core/menu/MenuRegistry.ts`:

```typescript
import type { MenuItemDefinition } from '../plugins/types'

interface RegistryEntry {
  source: string
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

  registerDefaults(items: MenuItemDefinition[]): void {
    for (const item of items) {
      this.items.push({ source: 'builtin', item })
    }
  }

  register(pluginName: string, items: MenuItemDefinition[]): void {
    for (const item of items) {
      this.items.push({ source: `plugin:${pluginName}`, item })
    }
  }

  unregister(sourceName: string, ids: string[]): void {
    const key = `plugin:${sourceName}`
    const idSet = new Set(ids)
    this.items = this.items.filter(
      (e) => !(e.source === key && idSet.has(e.item.id)),
    )
  }

  getAll(): RegistryEntry[] {
    return this.items
  }

  reset(): void {
    this.items = []
  }
}
```

- [ ] **Step 2: 写 MenuResolver**

Create `src/canvas/core/menu/MenuResolver.ts`:

```typescript
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
  create: 1,
  action: 2,
  transform: 3,
  connect: 4,
  delete: 5,
}

export function resolveMenuItems(ctx: MenuContext): ResolvedMenuItem[] {
  const all = MenuRegistry.getInstance().getAll()
  const filtered: { item: MenuItemDefinition; source: string }[] = []

  for (const entry of all) {
    try {
      if (entry.item.visible(ctx)) {
        filtered.push({ item: entry.item, source: entry.source })
      }
    } catch (err) {
      console.warn(
        `[MenuResolver] visible() threw for "${entry.item.id}", skipping:`,
        err,
      )
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const ga = GROUP_ORDER[a.item.group || 'action'] ?? 3
    const gb = GROUP_ORDER[b.item.group || 'action'] ?? 3
    if (ga !== gb) return ga - gb
    const pa = a.item.priority ?? 0
    const pb = b.item.priority ?? 0
    if (pa !== pb) return pb - pa
    return a.item.id.localeCompare(b.item.id)
  })

  return sorted.map((e) => ({
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

- [ ] **Step 3: 写 index.ts**

Create `src/canvas/core/menu/index.ts`:

```typescript
export { MenuRegistry } from './MenuRegistry'
export { resolveMenuItems } from './MenuResolver'
export type { ResolvedMenuItem } from './MenuResolver'
```

- [ ] **Step 4: 构建 + 提交（含 Task 1 改动）**

```powershell
pnpm build
git add src/canvas/core/menu src/canvas/core/plugins/types.ts src/canvas/core/plugins/PluginContext.ts
git commit -m "feat: add MenuRegistry + MenuResolver, extend PluginContext with menus and handle config API"
```

---

### Task 3: 创建 ContextMenuPlugin

**Files:**
- Create: `src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts`
- Create: `src/canvas/core/plugins/context-menu/builtinMenuItems.ts`
- Create: `src/canvas/core/plugins/context-menu/index.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: 写 builtinMenuItems**

Create `src/canvas/core/plugins/context-menu/builtinMenuItems.ts`:

```typescript
import type { MenuItemDefinition } from '../../plugins/types'

export function createBuiltinMenuItems(): MenuItemDefinition[] {
  return [
    // ---- pane: create nodes ----
    {
      id: 'create:text',
      group: 'create',
      label: 'text',
      description: 'create text node',
      icon: 'text',
      visible: (c) => c.mode === 'pane',
      priority: 10,
    },
    {
      id: 'create:image',
      group: 'create',
      label: 'image',
      description: 'create image node',
      icon: 'image',
      visible: (c) => c.mode === 'pane',
      priority: 9,
    },
    {
      id: 'create:video',
      group: 'create',
      label: 'video',
      description: 'create video node',
      icon: 'video',
      visible: (c) => c.mode === 'pane',
      priority: 8,
    },
    {
      id: 'create:stage',
      group: 'create',
      label: 'stage',
      description: 'create stage node',
      icon: 'layers',
      visible: (c) => c.mode === 'pane',
      priority: 7,
    },

    // ---- connection: create + connect ----
    {
      id: 'connect:text',
      group: 'create',
      label: 'text',
      description: 'create text node and connect',
      visible: (c) => c.mode === 'connection',
      priority: 10,
    },
    {
      id: 'connect:image',
      group: 'create',
      label: 'image',
      description: 'create image node and connect',
      visible: (c) => c.mode === 'connection',
      priority: 9,
    },
    {
      id: 'connect:video',
      group: 'create',
      label: 'video',
      description: 'create video node and connect',
      visible: (c) => c.mode === 'connection',
      priority: 8,
    },
    {
      id: 'connect:stage',
      group: 'create',
      label: 'stage',
      description: 'create stage node and connect',
      visible: (c) => c.mode === 'connection',
      priority: 7,
    },

    // ---- node: common actions ----
    {
      id: 'node:copy',
      group: 'action',
      label: 'copy',
      shortcut: 'Ctrl+C',
      visible: (c) => c.mode === 'node',
    },
    {
      id: 'node:duplicate',
      group: 'action',
      label: 'duplicate',
      shortcut: 'Ctrl+D',
      visible: (c) => c.mode === 'node',
    },
    {
      id: 'node:bring-to-front',
      group: 'action',
      label: 'bring to front',
      visible: (c) => c.mode === 'node',
    },
    {
      id: 'node:send-to-back',
      group: 'action',
      label: 'send to back',
      visible: (c) => c.mode === 'node',
    },
    {
      id: 'node:delete',
      group: 'delete',
      label: 'delete',
      shortcut: 'Del',
      danger: true,
      visible: (c) => c.mode === 'node' || c.mode === 'edge',
    },

    // ---- edge: edge actions ----
    {
      id: 'edge:delete',
      group: 'delete',
      label: 'delete edge',
      shortcut: 'Del',
      danger: true,
      visible: (c) => c.mode === 'edge',
    },
  ]
}
```

- [ ] **Step 2: 写 ContextMenuPlugin**

Create `src/canvas/core/plugins/context-menu/ContextMenuPlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../types'
import { MenuRegistry } from '../../menu/MenuRegistry'
import { createBuiltinMenuItems } from './builtinMenuItems'

export const ContextMenuPlugin: CanvasPlugin = {
  name: 'context-menu',
  version: '1.0.0',

  install(context: PluginContext) {
    MenuRegistry.getInstance().registerDefaults(createBuiltinMenuItems())
    context.logger.info('ContextMenuPlugin installed, builtin menu items registered')
  },
}
```

- [ ] **Step 3: 写 index.ts**

Create `src/canvas/core/plugins/context-menu/index.ts`:

```typescript
export { ContextMenuPlugin } from './ContextMenuPlugin'
```

- [ ] **Step 4: App.vue 注册**

In `src/App.vue`, add:

```typescript
import { ContextMenuPlugin } from './canvas/core/plugins/context-menu'
```

Add to `pluginSlots` (after node plugins, before other plugins):

```typescript
{
  plugin: markRaw(ContextMenuPlugin) as CanvasPlugin,
  enabled: true,
  label: 'context menu',
  description: 'right-click context menu with builtin items',
  usage: 'auto-loaded',
},
```

- [ ] **Step 5: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/context-menu src/App.vue
git commit -m "feat: add ContextMenuPlugin with builtin menu items"
```

---

### Task 4: CanvasMenu 支持 group/danger/shortcut + Canvas.vue 接入 MenuResolver

**Files:**
- Modify: `src/canvas/core/components/CanvasMenu.types.ts`
- Modify: `src/canvas/core/components/CanvasMenu.vue`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 扩展 CanvasMenu.types.ts**

Replace `src/canvas/core/components/CanvasMenu.types.ts`:

```typescript
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

- [ ] **Step 2: CanvasMenu.vue 添加 group 分隔线和 danger/shortcut**

Replace `<template>` in `src/canvas/core/components/CanvasMenu.vue`:

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
          <span class="canvas-menu-item-label">{{ item.label }}</span>
          <span class="canvas-menu-item-desc" v-if="item.description">{{ item.description }}</span>
          <kbd class="canvas-menu-item-shortcut" v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </div>
      </template>
    </div>
  </div>
</template>
```

Add `<script setup>` computed:

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

const firstGroup = computed(() => Object.keys(groupedItems.value)[0] || '')
```

- [ ] **Step 3: Canvas.vue 接入 MenuResolver**

Import at top:

```typescript
import { resolveMenuItems } from './menu/MenuResolver'
```

Modify `onNodeContextMenu`:

```typescript
function onNodeContextMenu({ event, node }: NodeMouseEvent) {
  event.preventDefault()
  const e = event as MouseEvent
  const flowPosition = toFlowPosition(e.clientX, e.clientY)
  const items = resolveMenuItems({
    mode: 'node',
    nodeId: node.id,
    nodeType: (node.data as any)?.nodeType,
    flowPosition,
  })
  menuState.visible = true
  menuState.title = (node.data as any)?.label || 'node menu'
  menuState.mode = 'node'
  menuState.position = { x: e.clientX, y: e.clientY }
  menuState.items = items as any
  menuContext.value = { nodeId: node.id, flowPosition }
}
```

Modify `onPaneContextMenu`:

```typescript
function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  const flowPosition = toFlowPosition(event.clientX, event.clientY)
  const items = resolveMenuItems({ mode: 'pane', flowPosition })
  menuState.visible = true
  menuState.title = 'add node'
  menuState.mode = 'pane'
  menuState.position = { x: event.clientX, y: event.clientY }
  menuState.items = items as any
  menuContext.value = { flowPosition }
}
```

Modify `createTempConnectionMenu` — replace `openCreateNodeMenu(...)` call with:

```typescript
const items = resolveMenuItems({
  mode: 'connection',
  sourceNodeId,
  flowPosition,
})
openMenu(
  {
    mode: 'connection',
    title: 'create and connect',
    position: { x: point.x, y: point.y },
    items: items as any,
  },
  {
    pendingConnection: { sourceNodeId, sourceHandle, tempNodeId, tempEdgeId, flowPosition },
  },
)
```

Modify `onMenuSelect` — replace body with:

```typescript
async function onMenuSelect(item: CanvasMenuItem) {
  const ctx = menuContext.value
  const id = item.id as string

  // connection mode: create node + connect
  if (menuState.mode === 'connection' && ctx.pendingConnection) {
    const pending = { ...ctx.pendingConnection }
    menuState.visible = false
    menuContext.value = {}
    vueFlowInstance.removeEdges([pending.tempEdgeId])
    vueFlowInstance.removeNodes([pending.tempNodeId])
    await nextTick()
    const nodeType = id.replace('connect:', '')
    const node = createNodeFromMenuItem({ id: nodeType, label: nodeType } as any, pending.flowPosition, { requireTarget: true })
    await nextTick()
    createConnection({ source: pending.sourceNodeId, target: node.id, sourceHandle: pending.sourceHandle, targetHandle: 'target' }, 'blank-menu')
    return
  }

  // pane/node mode: create node
  if (id.startsWith('create:') && ctx.flowPosition) {
    const nodeType = id.replace('create:', '')
    createNodeFromMenuItem({ id: nodeType, label: nodeType } as any, ctx.flowPosition)
    closeMenu()
    return
  }

  // node:delete
  if (id === 'node:delete' && ctx.nodeId) {
    const edgeIds = (getEdges.value as Edge[]).filter(e => e.source === ctx.nodeId || e.target === ctx.nodeId).map(e => e.id)
    vueFlowInstance.removeEdges(edgeIds)
    vueFlowInstance.removeNodes([ctx.nodeId])
    closeMenu()
    return
  }

  // node:copy
  if (id === 'node:copy' && ctx.nodeId) {
    canvas.setSelectedNodeIds([ctx.nodeId])
    closeMenu()
    return
  }

  closeMenu()
}
```

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/components/CanvasMenu.types.ts src/canvas/core/components/CanvasMenu.vue src/canvas/core/Canvas.vue
git commit -m "refactor: CanvasMenu supports group/danger/shortcut, Canvas.vue uses MenuResolver"
```

---

### Task 5: 创建 CustomHandlePlugin

**Files:**
- Create: `src/canvas/core/plugins/custom-handle/CustomHandlePlugin.ts`
- Create: `src/canvas/core/plugins/custom-handle/ConnectionValidator.ts`
- Create: `src/canvas/core/plugins/custom-handle/index.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: 写 ConnectionValidator**

Create `src/canvas/core/plugins/custom-handle/ConnectionValidator.ts`:

```typescript
import type { Connection, Node, Edge } from '@vue-flow/core'

function normalize(connection: Connection): Connection {
  return {
    ...connection,
    sourceHandle: connection.sourceHandle || 'source',
    targetHandle: connection.targetHandle || 'target',
  }
}

export function isValidConnection(
  connection: Connection,
  getNodes: () => Node[],
  getEdges: () => Edge[],
): boolean {
  const c = normalize(connection)
  if (!c.source || !c.target) return false
  if (c.sourceHandle !== 'source') return false
  if (c.targetHandle !== 'target') return false
  if (c.source === c.target) return false

  const src = getNodes().find((n) => n.id === c.source)
  const tgt = getNodes().find((n) => n.id === c.target)
  if (!src || !tgt) return false
  if (!src.sourcePosition) return false
  if (!tgt.targetPosition) return false

  return true
}
```

- [ ] **Step 2: 写 CustomHandlePlugin**

Create `src/canvas/core/plugins/custom-handle/CustomHandlePlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../types'

export const CustomHandlePlugin: CanvasPlugin = {
  name: 'custom-handle',
  version: '1.0.0',

  install(context: PluginContext) {
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

    context.logger.info('CustomHandlePlugin installed, handle config registered')
  },
}
```

- [ ] **Step 3: App.vue 注册**

Add import and pluginSlot entry for `CustomHandlePlugin`。

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/custom-handle src/App.vue
git commit -m "feat: add CustomHandlePlugin for handle config and connection validation"
```

---

### Task 6: 创建 NodeFindPlugin（Ctrl+F 节点搜索）

**Files:**
- Create: `src/canvas/core/plugins/node-find/NodeFindPlugin.ts`
- Create: `src/canvas/core/plugins/node-find/NodeFindOverlay.vue`
- Create: `src/canvas/core/plugins/node-find/index.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: 写 NodeFindOverlay.vue**

Create `src/canvas/core/plugins/node-find/NodeFindOverlay.vue`:

```vue
<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import type { Node } from '@vue-flow/core'

const props = defineProps<{
  nodes: Node[]
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
    .filter((n) => {
      const label = ((n.data as any)?.label as string) || ''
      return label.toLowerCase().includes(q)
    })
    .map((n) => ({
      id: n.id,
      label: (n.data as any)?.label as string || n.id,
      nodeType: (n.data as any)?.nodeType as string,
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
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        placeholder="search nodes..."
        class="node-find-input"
      />
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
      <div class="node-find-empty" v-else-if="query.trim()">no matching nodes</div>
      <div class="node-find-footer">arrow keys navigate . enter focus . esc close</div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 写 NodeFindPlugin**

Create `src/canvas/core/plugins/node-find/NodeFindPlugin.ts`:

```typescript
import { createApp, h } from 'vue'
import type { CanvasPlugin, PluginContext } from '../types'
import NodeFindOverlay from './NodeFindOverlay.vue'

export const NodeFindPlugin: CanvasPlugin = {
  name: 'node-find',
  version: '1.0.0',

  install(context: PluginContext) {
    let overlayEl: HTMLDivElement | null = null

    context.registerShortcut('ctrl+f', () => {
      if (overlayEl) return

      const nodes = context.actions.getNodes()
      const div = document.createElement('div')
      div.id = 'node-find-overlay-root'

      const app = createApp({
        render: () =>
          h(NodeFindOverlay, {
            nodes,
            onFocus: (nodeId: string) => {
              const node = nodes.find((n) => n.id === nodeId)
              if (node) {
                context.viewport.setCenter(
                  node.position.x + 150,
                  node.position.y + 130,
                  Math.max(context.viewport.getViewport().zoom, 1.0),
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
    }, 'search nodes')

    context.logger.info('NodeFindPlugin installed, Ctrl+F to search nodes')
  },
}
```

- [ ] **Step 3: App.vue 注册**

Add import and pluginSlot entry for `NodeFindPlugin`。

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/node-find src/App.vue
git commit -m "feat: add NodeFindPlugin for Ctrl+F node search"
```

---

### Task 7: 修复保存数据清洗 + StoragePlugin 卸载清理 + 导出

**Files:**
- Create: `src/canvas/core/plugins/storage/sanitizeForSave.ts`
- Create: `src/canvas/core/plugins/storage/__tests__/sanitizeForSave.test.ts`
- Modify: `src/canvas/core/plugins/storage/StoragePlugin.ts`

- [ ] **Step 1: 写测试**

Create `src/canvas/core/plugins/storage/__tests__/sanitizeForSave.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeForSave } from '../sanitizeForSave.ts'

test('sanitizeForSave keeps VueFlow custom node type and data.nodeType', () => {
  const result = sanitizeForSave(
    [
      {
        id: 'node-1',
        type: 'custom',
        position: { x: 10, y: 20 },
        data: {
          nodeType: 'image',
          assetId: 'asset-1',
          imageUrl: 'blob:http://localhost/img',
          _cropMode: true,
          _cropRect: { x: 0, y: 0, width: 10, height: 10 },
        },
      },
    ],
    [],
  )

  assert.equal(result.nodes[0].type, 'custom')
  assert.equal(result.nodes[0].data.nodeType, 'image')
  assert.equal(result.nodes[0].data.assetId, 'asset-1')
  assert.equal('imageUrl' in result.nodes[0].data, false)
  assert.equal('_cropMode' in result.nodes[0].data, false)
  assert.equal('_cropRect' in result.nodes[0].data, false)
})

test('sanitizeForSave removes temp nodes and temp edges', () => {
  const result = sanitizeForSave(
    [
      { id: 'node-1', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'text' } },
      { id: 'temp-target-1', type: 'tempTarget', position: { x: 1, y: 1 }, data: { isTemp: true } },
    ],
    [
      { id: 'edge-1', source: 'node-1', target: 'node-2', data: {} },
      { id: 'temp-edge-1', source: 'node-1', target: 'temp-target-1', data: { isTemp: true } },
    ],
  )

  assert.deepEqual(result.nodes.map((n) => n.id), ['node-1'])
  assert.deepEqual(result.edges.map((e) => e.id), ['edge-1'])
})

test('sanitizeForSave removes nested runtime _url without mutating input', () => {
  const original = [
    {
      id: 'node-1',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'stage',
        values: {
          first: { assetId: 'a', _url: 'blob:http://localhost/a' },
          second: { text: 'ok' },
        },
      },
    },
  ]

  const result = sanitizeForSave(original, [])

  assert.equal(result.nodes[0].data.values.first.assetId, 'a')
  assert.equal('_url' in result.nodes[0].data.values.first, false)
  // input must NOT be mutated
  assert.equal((original[0].data.values.first as any)._url, 'blob:http://localhost/a')
})

test('sanitizeForSave removes videoUrl and thumbUrl', () => {
  const result = sanitizeForSave(
    [
      {
        id: 'video-1',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'video',
          videoUrl: 'blob:http://localhost/video',
          thumbUrl: 'blob:http://localhost/thumb',
        },
      },
    ],
    [],
  )

  assert.equal('videoUrl' in result.nodes[0].data, false)
  assert.equal('thumbUrl' in result.nodes[0].data, false)
})
```

- [ ] **Step 2: 实现 sanitizeForSave**

Create `src/canvas/core/plugins/storage/sanitizeForSave.ts`:

```typescript
const RUNTIME_FIELDS = ['imageUrl', 'videoUrl', 'thumbUrl', '_cropRect', '_cropMode'] as const

function cloneCanvasData(nodes: unknown[], edges: unknown[]): { nodes: any[]; edges: any[] } {
  return JSON.parse(JSON.stringify({ nodes, edges }))
}

function removeRuntimeData(data: Record<string, unknown>): void {
  for (const key of RUNTIME_FIELDS) {
    delete data[key]
  }
  const values = data.values
  if (!values || typeof values !== 'object') return
  for (const v of Object.values(values as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      delete (v as Record<string, unknown>)._url
    }
  }
}

export function sanitizeForSave(
  nodes: unknown[],
  edges: unknown[],
): { nodes: any[]; edges: any[] } {
  const cleaned = cloneCanvasData(nodes, edges)

  for (const node of cleaned.nodes) {
    if (node.data && typeof node.data === 'object') {
      removeRuntimeData(node.data)
    }
  }

  cleaned.nodes = cleaned.nodes.filter(
    (n) => !String(n.id ?? '').startsWith('temp-') && !n.data?.isTemp,
  )
  cleaned.edges = cleaned.edges.filter(
    (e) => !String(e.id ?? '').startsWith('temp-') && !e.data?.isTemp,
  )

  return cleaned
}
```

- [ ] **Step 3: StoragePlugin 改用新函数 + 添加 uninstall/export**

In `StoragePlugin.ts`:
- Add `import { sanitizeForSave } from './sanitizeForSave'`
- Delete old `function sanitizeForSave(...)` block
- In `install()` return, add `uninstall()` function:

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

- Add to `StorageAPI` interface and `api` object:

```typescript
exportJSON(): string {
  const nodes = context.actions.getNodes()
    .filter((n: any) => n.type !== 'tempTarget' && !(n.data as any)?.isTemp)
  const edges = context.actions.getEdges()
    .filter((e: any) => !e.id?.startsWith('temp-') && !(e.data as any)?.isTemp)
  return JSON.stringify({ nodes, edges }, null, 2)
},

async exportPNG(): Promise<void> {
  const vfEl = document.querySelector('.vue-flow__viewport') as HTMLElement
  if (!vfEl) throw new Error('VueFlow viewport not found')
  const { toJpeg } = await import('html-to-image')
  const dataUrl = await toJpeg(vfEl, { quality: 1.0, backgroundColor: '#ffffff' })
  const link = document.createElement('a')
  link.download = `canvas-export-${Date.now()}.jpg`
  link.href = dataUrl
  link.click()
},
```

- [ ] **Step 4: 运行测试 + 构建 + 提交**

```powershell
node --test src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts
pnpm build
git add src/canvas/core/plugins/storage
git commit -m "fix: extract sanitizeForSave, add storage uninstall cleanup, add exportJSON/exportPNG"
```

---

## 完成标准

- [ ] `pnpm build` 通过
- [ ] `node --test src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts` 4 tests PASS
- [ ] 右键画布显示创建节点菜单（create group 在前）
- [ ] 右键节点显示操作菜单（含红色 delete、shortcut 提示）
- [ ] 双击画布直接创建文本节点
- [ ] 拖线到空白释放 → 弹出连线创建菜单
- [ ] Ctrl+F → 搜索弹窗 → ↑↓ 导航 → Enter 聚焦
- [ ] 刷新页面后节点 type 仍为 `custom`（不再被 sanitizeForSave 改坏）
- [ ] 保存的数据不含 imageUrl/videoUrl/_cropMode 等运行时字段
