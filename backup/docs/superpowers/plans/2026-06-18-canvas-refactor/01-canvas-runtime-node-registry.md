# Plan 1: 架构地基 — CanvasRuntime + PluginAPI + NodeRegistry + 节点插件化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让组件和插件都能稳定拿到插件 API，并把 text/image/video/stage 从 `CustomNode.vue` 硬编码迁到 `NodeRegistry`。

**Architecture:** 当前阶段只打地基：`CanvasRuntime` 负责把 `PluginManager`、`EventBus`、`NodeRegistry` 注入组件树；`PluginContext` 暴露 `getPluginAPI()` 和 `canvasNodes`；内置节点通过节点插件注册完整定义。

**Tech Stack:** Vue 3 + TypeScript, VueFlow, Pinia, Node native `node:test`, pnpm。

---

## 复查后必须修正的点

- `CanvasRuntimeProvider` 和 `useCanvasRuntime()` 必须共用同一个 injection key，不能各写一个 `Symbol('canvasRuntime')`。
- 插件里不要用 `context.getPlugin('storage')?.api`，因为 CodeGraph 显示 `PluginManager.getPlugin()` 只返回插件定义对象。必须新增 `context.getPluginAPI<T>(name)`。
- `NodeRegistry` 不能只保存 node 组件，还要保存 topToolbar、bottomToolbar、默认尺寸、菜单项、是否可输入、是否可 resize。
- 默认节点要补 `data.nodeType`。否则 `CustomNode.vue` 改成注册表后，默认节点只有 `type: 'custom'`，不知道该渲染 image/text/video/stage。
- `CustomNode.vue` 到 runtime 的路径是 `../runtime/useCanvasRuntime`，不是 `../../runtime/useCanvasRuntime`。

---

## 文件结构

新建：
- `src/canvas/core/types/CanvasNodeData.ts`
- `src/canvas/core/registry/NodeRegistry.ts`
- `src/canvas/core/registry/__tests__/NodeRegistry.test.ts`
- `src/canvas/core/runtime/CanvasRuntime.ts`
- `src/canvas/core/runtime/CanvasRuntimeKey.ts`
- `src/canvas/core/runtime/CanvasRuntimeProvider.vue`
- `src/canvas/core/runtime/useCanvasRuntime.ts`
- `src/canvas/core/runtime/usePluginApi.ts`
- `src/canvas/core/runtime/index.ts`
- `src/canvas/core/nodes/text/TextNodePlugin.ts`
- `src/canvas/core/nodes/image/ImageNodePlugin.ts`
- `src/canvas/core/nodes/Video/VideoNodePlugin.ts`
- `src/canvas/core/nodes/stage/StageNodePlugin.ts`

修改：
- `src/canvas/core/plugins/types.ts`
- `src/canvas/core/plugins/PluginContext.ts`
- `src/canvas/core/plugins/auto-save/AutoSavePlugin.ts`
- `src/canvas/core/Canvas.vue`
- `src/canvas/core/components/CustomNode.vue`
- `src/App.vue`

重命名：
- `src/canvas/core/components/nodes/video` → `src/canvas/core/components/nodes/Video`

---

### Task 1: 创建统一节点数据类型和 NodeRegistry

**Files:**
- Create: `src/canvas/core/types/CanvasNodeData.ts`
- Create: `src/canvas/core/registry/NodeRegistry.ts`
- Create: `src/canvas/core/registry/__tests__/NodeRegistry.test.ts`

- [ ] **Step 1: 写节点数据类型**

Create `src/canvas/core/types/CanvasNodeData.ts`:

```typescript
export type CanvasNodeKind = 'text' | 'image' | 'video' | 'stage' | (string & {})

export interface BaseCanvasNodeData {
  nodeType: CanvasNodeKind
  label?: string
  cardWidth?: number
  cardHeight?: number
  resizable?: boolean
}

export interface ImageNodeData extends BaseCanvasNodeData {
  nodeType: 'image'
  assetId?: string
  imageName?: string
  imageType?: string
  imageWidth?: number
  imageHeight?: number
  imageUrl?: string // runtime only，保存前删除
  _cropMode?: boolean // runtime only
  _cropRect?: unknown // runtime only
}

export interface VideoNodeData extends BaseCanvasNodeData {
  nodeType: 'video'
  assetId?: string
  videoName?: string
  videoType?: string
  videoWidth?: number
  videoHeight?: number
  videoUrl?: string // runtime only，保存前删除
  thumbUrl?: string // runtime only，保存前删除
}

export interface TextNodeData extends BaseCanvasNodeData {
  nodeType: 'text'
  text?: string
}

export interface StageNodeData extends BaseCanvasNodeData {
  nodeType: 'stage'
  values?: Record<string, unknown>
}

export type CanvasNodeData = TextNodeData | ImageNodeData | VideoNodeData | StageNodeData | BaseCanvasNodeData
```

- [ ] **Step 2: 写 NodeRegistry**

Create `src/canvas/core/registry/NodeRegistry.ts`:

```typescript
import type { Component } from 'vue'

export interface NodeMenuItemDefinition {
  label: string
  description?: string
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
  badge?: string
}

export interface CanvasNodeDefinition {
  type: string
  node?: Component
  topToolbar?: Component
  bottomToolbar?: Component
  label: string
  defaultSize: { cardWidth: number; cardHeight: number }
  menuItem: NodeMenuItemDefinition
  canReceiveInput?: boolean
  resizable?: boolean
}

export interface CanvasNodeMenuItem {
  id: string
  label: string
  description?: string
  icon?: NodeMenuItemDefinition['icon']
  badge?: string
}

const FALLBACK_SIZE = { cardWidth: 256, cardHeight: 256 }

export class NodeRegistry {
  private definitions = new Map<string, CanvasNodeDefinition>()

  register(definition: CanvasNodeDefinition): void {
    this.definitions.set(definition.type, definition)
  }

  unregister(type: string): void {
    this.definitions.delete(type)
  }

  get(type: string): CanvasNodeDefinition | null {
    return this.definitions.get(type) ?? null
  }

  getAllTypes(): string[] {
    return [...this.definitions.keys()]
  }

  getDefaultSize(type: string): { cardWidth: number; cardHeight: number } {
    return this.definitions.get(type)?.defaultSize ?? FALLBACK_SIZE
  }

  getLabel(type: string): string {
    return this.definitions.get(type)?.label ?? type
  }

  canReceiveInput(type: string): boolean {
    return this.definitions.get(type)?.canReceiveInput ?? true
  }

  isResizable(type: string): boolean {
    return this.definitions.get(type)?.resizable ?? false
  }

  getMenuItems(): CanvasNodeMenuItem[] {
    return [...this.definitions.values()].map(definition => ({
      id: definition.type,
      label: definition.menuItem.label,
      description: definition.menuItem.description,
      icon: definition.menuItem.icon,
      badge: definition.menuItem.badge,
    }))
  }
}
```

- [ ] **Step 3: 写 NodeRegistry 测试**

Create `src/canvas/core/registry/__tests__/NodeRegistry.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeRegistry } from '../NodeRegistry.ts'

test('NodeRegistry registers full node definition', () => {
  const registry = new NodeRegistry()
  const comp = {} as any

  registry.register({
    type: 'image',
    node: comp,
    topToolbar: comp,
    bottomToolbar: comp,
    label: '图片',
    defaultSize: { cardWidth: 360, cardHeight: 270 },
    menuItem: { label: '图片', description: '创建图片节点', icon: 'image' },
    canReceiveInput: true,
    resizable: false,
  })

  const found = registry.get('image')
  assert.ok(found)
  assert.equal(found!.node, comp)
  assert.equal(found!.topToolbar, comp)
  assert.deepEqual(found!.defaultSize, { cardWidth: 360, cardHeight: 270 })
  assert.equal(found!.menuItem.label, '图片')
})

test('NodeRegistry menu items are derived from registered nodes', () => {
  const registry = new NodeRegistry()
  registry.register({ type: 'text', label: '文本', defaultSize: { cardWidth: 300, cardHeight: 320 }, menuItem: { label: '文本', description: '创建文本节点', icon: 'text' } })
  registry.register({ type: 'stage', label: '导演台', defaultSize: { cardWidth: 320, cardHeight: 320 }, menuItem: { label: '导演台', description: '创建编排节点', icon: 'layers', badge: 'NEW' } })

  assert.deepEqual(registry.getMenuItems().map(item => item.id), ['text', 'stage'])
  assert.equal(registry.getMenuItems()[1].badge, 'NEW')
})

test('NodeRegistry fallback for unknown type', () => {
  const registry = new NodeRegistry()
  assert.deepEqual(registry.getDefaultSize('unknown'), { cardWidth: 256, cardHeight: 256 })
  assert.equal(registry.canReceiveInput('unknown'), true)
  assert.equal(registry.isResizable('unknown'), false)
})

test('NodeRegistry unregister removes definition', () => {
  const registry = new NodeRegistry()
  registry.register({ type: 'text', label: '文本', defaultSize: { cardWidth: 300, cardHeight: 320 }, menuItem: { label: '文本' } })
  registry.unregister('text')
  assert.equal(registry.get('text'), null)
})
```

- [ ] **Step 4: 运行测试 + 构建 + 提交**

```powershell
node --test src\canvas\core\registry\__tests__\NodeRegistry.test.ts
pnpm build
git add src/canvas/core/types/CanvasNodeData.ts src/canvas/core/registry
git commit -m "feat: add canvas node data types and NodeRegistry"
```

---

### Task 2: 创建 CanvasRuntime 和共享 injection key

**Files:**
- Create: `src/canvas/core/runtime/CanvasRuntime.ts`
- Create: `src/canvas/core/runtime/CanvasRuntimeKey.ts`
- Create: `src/canvas/core/runtime/CanvasRuntimeProvider.vue`
- Create: `src/canvas/core/runtime/useCanvasRuntime.ts`
- Create: `src/canvas/core/runtime/usePluginApi.ts`
- Create: `src/canvas/core/runtime/index.ts`

- [ ] **Step 1: 写 runtime 文件**

Create `src/canvas/core/runtime/CanvasRuntime.ts`:

```typescript
import type { PluginManager } from '../plugins/PluginManager'
import type { EventBus } from '../plugins/PluginContext'
import type { NodeRegistry } from '../registry/NodeRegistry'

export class CanvasRuntime {
  constructor(
    readonly pluginManager: PluginManager,
    readonly eventBus: EventBus,
    readonly nodeRegistry: NodeRegistry,
    readonly vueFlowInstance: any,
  ) {}

  getPluginAPI<T = unknown>(name: string): T | null {
    return this.pluginManager.getPluginAPI<T>(name)
  }
}
```

Create `src/canvas/core/runtime/CanvasRuntimeKey.ts`:

```typescript
import type { InjectionKey } from 'vue'
import type { CanvasRuntime } from './CanvasRuntime'

export const CanvasRuntimeKey: InjectionKey<CanvasRuntime> = Symbol('canvasRuntime')
```

Create `src/canvas/core/runtime/CanvasRuntimeProvider.vue`:

```vue
<script setup lang="ts">
import { provide } from 'vue'
import type { CanvasRuntime } from './CanvasRuntime'
import { CanvasRuntimeKey } from './CanvasRuntimeKey'

const props = defineProps<{ runtime: CanvasRuntime }>()
provide(CanvasRuntimeKey, props.runtime)
</script>

<template>
  <slot />
</template>
```

Create `src/canvas/core/runtime/useCanvasRuntime.ts`:

```typescript
import { inject } from 'vue'
import { CanvasRuntimeKey } from './CanvasRuntimeKey'
import type { CanvasRuntime } from './CanvasRuntime'

export function useCanvasRuntime(): CanvasRuntime {
  const runtime = inject(CanvasRuntimeKey)
  if (!runtime) throw new Error('useCanvasRuntime() must be used inside CanvasRuntimeProvider')
  return runtime
}
```

Create `src/canvas/core/runtime/usePluginApi.ts`:

```typescript
import { useCanvasRuntime } from './useCanvasRuntime'

export function usePluginApi<T = unknown>(name: string): T | null {
  return useCanvasRuntime().getPluginAPI<T>(name)
}
```

Create `src/canvas/core/runtime/index.ts`:

```typescript
export { CanvasRuntime } from './CanvasRuntime'
export { CanvasRuntimeKey } from './CanvasRuntimeKey'
export { default as CanvasRuntimeProvider } from './CanvasRuntimeProvider.vue'
export { useCanvasRuntime } from './useCanvasRuntime'
export { usePluginApi } from './usePluginApi'
```

- [ ] **Step 2: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/runtime
git commit -m "feat: add CanvasRuntime provider and plugin API hook"
```

---

### Task 3: PluginContext 接通 getPluginAPI 和 NodeRegistry

**Files:**
- Modify: `src/canvas/core/plugins/types.ts`
- Modify: `src/canvas/core/plugins/PluginContext.ts`
- Modify: `src/canvas/core/plugins/auto-save/AutoSavePlugin.ts`

- [ ] **Step 1: types.ts 扩展 PluginContext**

Add imports:

```typescript
import type { CanvasNodeDefinition, CanvasNodeMenuItem } from '../registry/NodeRegistry'
```

Add interface:

```typescript
export interface CanvasNodeRegistryAPI {
  register(definition: CanvasNodeDefinition): void
  unregister(type: string): void
  get(type: string): CanvasNodeDefinition | null
  getMenuItems(): CanvasNodeMenuItem[]
}
```

Inside `PluginContext`, add:

```typescript
readonly canvasNodes: CanvasNodeRegistryAPI
getPluginAPI: <T = unknown>(name: string) => T | null
/** @deprecated 只返回插件定义对象。插件间调用 API 请用 getPluginAPI()。 */
getPlugin: <T = CanvasPlugin>(name: string) => T | null
```

- [ ] **Step 2: PluginContext.ts 实现**

Add import:

```typescript
import type { NodeRegistry } from '../registry/NodeRegistry'
```

Add to `CreatePluginContextOptions`:

```typescript
nodeRegistry?: NodeRegistry
```

Destructure `nodeRegistry` from options。

Inside returned `context` object, before old `registerNodeType`:

```typescript
canvasNodes: {
  register(definition) {
    nodeRegistry?.register(definition)
    logger.debug(`Registered canvas node: "${definition.type}"`)
  },
  unregister(type) {
    nodeRegistry?.unregister(type)
    logger.debug(`Unregistered canvas node: "${type}"`)
  },
  get(type) {
    return nodeRegistry?.get(type) ?? null
  },
  getMenuItems() {
    return nodeRegistry?.getMenuItems() ?? []
  },
},
```

Near `getPlugin`, add:

```typescript
getPluginAPI<T = unknown>(name: string): T | null {
  try {
    return pluginManager?.getPluginAPI<T>(name) ?? null
  } catch (err) {
    logger.error(`Failed to get plugin API "${name}":`, err)
    return null
  }
},
```

- [ ] **Step 3: AutoSavePlugin 改 API 获取方式**

Replace:

```typescript
const storagePlugin = context.getPlugin('storage') as any
return storagePlugin?.api ?? null
```

with:

```typescript
return context.getPluginAPI('storage')
```

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/types.ts src/canvas/core/plugins/PluginContext.ts src/canvas/core/plugins/auto-save/AutoSavePlugin.ts
git commit -m "feat: expose plugin APIs and node registry through PluginContext"
```

---

### Task 4: Canvas.vue 接入 runtime 和 NodeRegistry

**Files:**
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 添加 imports 和实例**

Add imports:

```typescript
import { CanvasRuntime, CanvasRuntimeProvider } from './runtime'
import { NodeRegistry } from './registry/NodeRegistry'
```

Near `const manager = new PluginManager()` add:

```typescript
const nodeRegistry = new NodeRegistry()
const runtime = new CanvasRuntime(manager, manager.eventBus, nodeRegistry, vueFlowInstance as any)
```

- [ ] **Step 2: createPluginContext 传 nodeRegistry**

```typescript
createContext: (pluginName: string) => createPluginContext(pluginName, {
  canvasId: 'main-canvas',
  vueFlowInstance: vueFlowInstance as any,
  canvasStore: canvas,
  pluginManager: manager,
  eventBus: manager.eventBus,
  nodeRegistry,
}),
```

- [ ] **Step 3: 默认节点补 nodeType**

Default nodes must be:

```typescript
const defaultNodes: Node[] = [
  { id: '1', type: 'custom', position: { x: 200, y: 260 }, data: { label: '输入图像', nodeType: 'image' }, sourcePosition: Position.Right },
  { id: '2', type: 'custom', position: { x: 700, y: 260 }, data: { label: '生成图像', nodeType: 'image' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: '3', type: 'custom', position: { x: 1200, y: 260 }, data: { label: '生成图像', nodeType: 'image' }, sourcePosition: Position.Right, targetPosition: Position.Left },
]
```

- [ ] **Step 4: 创建节点和菜单改用 NodeRegistry**

Delete `NODE_TYPE_DEFAULT_SIZE` and `NODE_MENU_ITEMS`.

`nodeLabelFromMenuItem`:

```typescript
function nodeLabelFromMenuItem(item: CanvasMenuItem) {
  return nodeRegistry.getLabel(item.id) || NODE_TYPE_LABELS[item.id] || item.label
}
```

Inside `createNodeFromMenuItem()`:

```typescript
const defaultSize = nodeRegistry.getDefaultSize(item.id)
const canReceiveInput = options.requireTarget || nodeRegistry.canReceiveInput(item.id)
const resizable = nodeRegistry.isResizable(item.id)
```

and node data uses:

```typescript
resizable,
```

`openCreateNodeMenu()` uses:

```typescript
items: nodeRegistry.getMenuItems(),
```

- [ ] **Step 5: 模板包裹 Provider**

```vue
<template>
  <CanvasRuntimeProvider :runtime="runtime">
    <div class="canvas-container">
      <!-- 原内容保持不变 -->
    </div>
  </CanvasRuntimeProvider>
</template>
```

- [ ] **Step 6: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/Canvas.vue
git commit -m "feat: provide CanvasRuntime and use NodeRegistry for node creation"
```

---

### Task 5: CustomNode.vue 从 NodeRegistry 读取组件

**Files:**
- Modify: `src/canvas/core/components/CustomNode.vue`

- [ ] **Step 1: 替换 script**

```vue
<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, type Component } from 'vue'
import BaseNode from './Decoration/BaseNode.vue'
import { useCanvasRuntime } from '../runtime/useCanvasRuntime'

const props = defineProps<NodeProps>()
const runtime = useCanvasRuntime()

interface NodeTypeBundle {
  node?: Component
  topToolbar?: Component
  bottomToolbar?: Component
}

const bundle = computed<NodeTypeBundle>(() => {
  const nodeType = props.data?.nodeType as string | undefined
  if (!nodeType) return {}
  const definition = runtime.nodeRegistry.get(nodeType)
  if (!definition) return {}
  return {
    node: definition.node,
    topToolbar: definition.topToolbar,
    bottomToolbar: definition.bottomToolbar,
  }
})

const ContentComponent = computed(() => bundle.value.node || null)
const TopToolbarComponent = computed(() => bundle.value.topToolbar || null)
const BottomToolbarComponent = computed(() => bundle.value.bottomToolbar || null)
</script>
```

Template uses `v-if` for all dynamic components:

```vue
<template>
  <BaseNode v-bind="$props">
    <template #top-toolbar>
      <component v-if="TopToolbarComponent" :is="TopToolbarComponent" v-bind="$props" />
    </template>
    <template #content>
      <component v-if="ContentComponent" :is="ContentComponent" v-bind="$props" />
    </template>
    <template #bottom-toolbar>
      <component v-if="BottomToolbarComponent" :is="BottomToolbarComponent" v-bind="$props" />
    </template>
  </BaseNode>
</template>
```

- [ ] **Step 2: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/components/CustomNode.vue
git commit -m "refactor: resolve custom node components from NodeRegistry"
```

---

### Task 6: video 目录改名 + 创建四个节点插件

**Files:**
- Rename: `src/canvas/core/components/nodes/video` → `src/canvas/core/components/nodes/Video`
- Create: `src/canvas/core/nodes/text/TextNodePlugin.ts`
- Create: `src/canvas/core/nodes/image/ImageNodePlugin.ts`
- Create: `src/canvas/core/nodes/Video/VideoNodePlugin.ts`
- Create: `src/canvas/core/nodes/stage/StageNodePlugin.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: 两步 git mv**

```powershell
git mv src\canvas\core\components\nodes\video src\canvas\core\components\nodes\Video_tmp
git mv src\canvas\core\components\nodes\Video_tmp src\canvas\core\components\nodes\Video
```

- [ ] **Step 2: 四个插件都用 context.canvasNodes.register()**

Text plugin shape:

```typescript
context.canvasNodes.register({
  type: 'text',
  node: markRaw(TextNode),
  topToolbar: markRaw(TextTopToolbar),
  bottomToolbar: markRaw(TextBottomToolbar),
  label: '文本',
  defaultSize: { cardWidth: 300, cardHeight: 320 },
  menuItem: { label: '文本', description: '创建文本节点', icon: 'text' },
  canReceiveInput: false,
  resizable: true,
})
return { uninstall() { context.canvasNodes.unregister('text') } }
```

Image/video/stage 同样注册完整定义：

- image: size `{ cardWidth: 360, cardHeight: 270 }`, label `图片`, icon `image`, `canReceiveInput: true`, `resizable: false`
- video: size `{ cardWidth: 480, cardHeight: 320 }`, label `视频`, icon `video`, `canReceiveInput: true`, `resizable: false`
- stage: size `{ cardWidth: 320, cardHeight: 320 }`, label `导演台`, icon `layers`, badge `NEW`, `canReceiveInput: true`, `resizable: false`

`VideoNodePlugin.ts` import path must use `../../components/nodes/Video/index`.

- [ ] **Step 3: App.vue 注册节点插件到最前面**

Add imports:

```typescript
import { TextNodePlugin } from './canvas/core/nodes/text/TextNodePlugin'
import { ImageNodePlugin } from './canvas/core/nodes/image/ImageNodePlugin'
import { VideoNodePlugin } from './canvas/core/nodes/Video/VideoNodePlugin'
import { StageNodePlugin } from './canvas/core/nodes/stage/StageNodePlugin'
```

Add the four plugin slots before all other plugins.

- [ ] **Step 4: pluginLabels 补节点插件名称**

In `Canvas.vue`:

```typescript
'node:text': '文本节点',
'node:image': '图片节点',
'node:video': '视频节点',
'node:stage': '导演台节点',
```

- [ ] **Step 5: 确认无旧路径引用**

```powershell
Select-String -Path 'src\canvas\core\**\*.ts' -Pattern 'nodes/video' -SimpleMatch
Select-String -Path 'src\canvas\core\**\*.vue' -Pattern 'nodes/video' -SimpleMatch
```

Expected: no matches。

- [ ] **Step 6: 构建 + 提交**

```powershell
pnpm build
git add src/App.vue src/canvas/core
git commit -m "feat: convert built-in nodes to NodeRegistry plugins"
```

---

## 完成标准

- [ ] `pnpm build` 通过。
- [ ] `node --test src\canvas\core\registry\__tests__\NodeRegistry.test.ts` 通过。
- [ ] `CanvasRuntimeProvider` 和 hooks 使用同一个 key。
- [ ] 插件里能用 `context.getPluginAPI('storage')`。
- [ ] 组件里能用 `usePluginApi('storage')`。
- [ ] `CustomNode.vue` 不再 import text/image/video/stage。
- [ ] 四种内置节点通过 `context.canvasNodes.register()` 注册完整定义。
- [ ] VueFlow 节点 `type` 仍是 `custom`，业务类型是 `data.nodeType`。
