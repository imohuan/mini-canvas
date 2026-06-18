# Plan 1: 架构重构 — CanvasRuntime + NodeRegistry + 节点插件化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 CanvasRuntime 让任意组件能拿到 PluginAPI，建立 NodeRegistry 消除 CustomNode.vue 的硬编码节点导入，把 text/image/video/stage 改造为节点插件，让整个架构从"上帝组件一把抓"变成"插件注册 + 按需注入"。

**Architecture:** 三层推进。第一层：CanvasRuntime（provide/inject → 任意组件通过 `usePluginApi('storage')` 拿插件 API）。第二层：NodeRegistry（注册表管理节点组件 + 默认尺寸 + 菜单项，CustomNode.vue 从注册表动态查找组件）。第三层：四种内置节点转为插件（TextNodePlugin / ImageNodePlugin / VideoNodePlugin / StageNodePlugin），安装时自动注册到 NodeRegistry。

**Tech Stack:** Vue 3 + TypeScript, VueFlow, Pinia, Node native `node:test`, pnpm。

---

## 文件结构

新建：
- `src/canvas/core/runtime/CanvasRuntime.ts`
- `src/canvas/core/runtime/CanvasRuntimeProvider.vue`
- `src/canvas/core/runtime/useCanvasRuntime.ts`
- `src/canvas/core/runtime/usePluginApi.ts`
- `src/canvas/core/runtime/index.ts`
- `src/canvas/core/registry/NodeRegistry.ts`
- `src/canvas/core/registry/__tests__/NodeRegistry.test.ts`
- `src/canvas/core/nodes/text/TextNodePlugin.ts`
- `src/canvas/core/nodes/image/ImageNodePlugin.ts`
- `src/canvas/core/nodes/Video/VideoNodePlugin.ts`
- `src/canvas/core/nodes/stage/StageNodePlugin.ts`

修改：
- `src/canvas/core/Canvas.vue` — 包裹 CanvasRuntimeProvider，创建 runtime 和 nodeRegistry
- `src/canvas/core/components/CustomNode.vue` — 从 NodeRegistry 读组件，删除硬编码 import
- `src/App.vue` — 注册 4 个节点插件

重命名：
- `src/canvas/core/components/nodes/video` → `src/canvas/core/components/nodes/Video`

---

### Task 1: 创建 CanvasRuntime

**Files:**
- Create: `src/canvas/core/runtime/CanvasRuntime.ts`
- Create: `src/canvas/core/runtime/CanvasRuntimeProvider.vue`
- Create: `src/canvas/core/runtime/useCanvasRuntime.ts`
- Create: `src/canvas/core/runtime/usePluginApi.ts`
- Create: `src/canvas/core/runtime/index.ts`

- [ ] **Step 1: 写 CanvasRuntime 类**

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

- [ ] **Step 2: 写 CanvasRuntimeProvider.vue**

Create `src/canvas/core/runtime/CanvasRuntimeProvider.vue`:

```vue
<script setup lang="ts">
import { provide, type InjectionKey } from 'vue'
import type { CanvasRuntime } from './CanvasRuntime'

const props = defineProps<{ runtime: CanvasRuntime }>()
const KEY: InjectionKey<CanvasRuntime> = Symbol('canvasRuntime')
provide(KEY, props.runtime)
</script>
<template><slot /></template>
```

- [ ] **Step 3: 写 useCanvasRuntime**

Create `src/canvas/core/runtime/useCanvasRuntime.ts`:

```typescript
import { inject, type InjectionKey } from 'vue'
import type { CanvasRuntime } from './CanvasRuntime'

const KEY: InjectionKey<CanvasRuntime> = Symbol('canvasRuntime')

export function useCanvasRuntime(): CanvasRuntime {
  const runtime = inject(KEY)
  if (!runtime) throw new Error('useCanvasRuntime() must be used inside CanvasRuntimeProvider')
  return runtime
}
```

- [ ] **Step 4: 写 usePluginApi**

Create `src/canvas/core/runtime/usePluginApi.ts`:

```typescript
import { useCanvasRuntime } from './useCanvasRuntime'

export function usePluginApi<T = unknown>(name: string) {
  const runtime = useCanvasRuntime()
  return runtime.getPluginAPI<T>(name)
}
```

- [ ] **Step 5: 写 index.ts 导出**

Create `src/canvas/core/runtime/index.ts`:

```typescript
export { CanvasRuntime } from './CanvasRuntime'
export { default as CanvasRuntimeProvider } from './CanvasRuntimeProvider.vue'
export { useCanvasRuntime } from './useCanvasRuntime'
export { usePluginApi } from './usePluginApi'
```

- [ ] **Step 6: 构建验证**

```powershell
pnpm build
```

Expected: exit code `0`。

- [ ] **Step 7: 提交**

```powershell
git add src/canvas/core/runtime
git commit -m "feat: add CanvasRuntime + usePluginApi for component-level plugin API access"
```

---

### Task 2: Canvas.vue 接入 CanvasRuntime

**Files:**
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 修改 import**

在 `Canvas.vue` 顶部添加：

```typescript
import { CanvasRuntime, CanvasRuntimeProvider } from './runtime'
import { NodeRegistry } from './registry/NodeRegistry'
```

- [ ] **Step 2: 创建 nodeRegistry 和 runtime**

在 `const manager = new PluginManager()` 附近（约 L1174）添加：

```typescript
const nodeRegistry = new NodeRegistry()
const runtime = new CanvasRuntime(manager, manager.eventBus, nodeRegistry, vueFlowInstance as any)
```

- [ ] **Step 3: 模板包裹 CanvasRuntimeProvider**

将 `<template>` 中最外层 `<div class="canvas-container">` 改为：

```vue
<template>
  <CanvasRuntimeProvider :runtime="runtime">
    <div class="canvas-container">
      <!-- 现有内容不变 -->
    </div>
  </CanvasRuntimeProvider>
</template>
```

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/Canvas.vue
git commit -m "feat: wire CanvasRuntime into Canvas.vue, provide runtime to all child components"
```

---

### Task 3: 创建 NodeRegistry

**Files:**
- Create: `src/canvas/core/registry/NodeRegistry.ts`
- Create: `src/canvas/core/registry/__tests__/NodeRegistry.test.ts`

- [ ] **Step 1: 写测试**

Create `src/canvas/core/registry/__tests__/NodeRegistry.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeRegistry } from '../NodeRegistry.ts'

test('NodeRegistry register and get', () => {
  const registry = new NodeRegistry()
  const comp = {} as any
  registry.register('text', {
    node: comp,
    topToolbar: comp,
    bottomToolbar: comp,
    defaultSize: { cardWidth: 300, cardHeight: 320 },
    label: 'text',
  })
  const bundle = registry.get('text')
  assert.ok(bundle)
  assert.equal(bundle!.defaultSize.cardWidth, 300)
  assert.equal(bundle!.label, 'text')
})

test('NodeRegistry getAllTypes returns all registered type names sorted', () => {
  const registry = new NodeRegistry()
  registry.register('text', { defaultSize: { cardWidth: 300, cardHeight: 320 }, label: 'text' })
  registry.register('image', { defaultSize: { cardWidth: 360, cardHeight: 270 }, label: 'image' })
  assert.deepEqual(registry.getAllTypes().sort(), ['image', 'text'])
})

test('NodeRegistry unregister removes type', () => {
  const registry = new NodeRegistry()
  registry.register('text', { defaultSize: { cardWidth: 300, cardHeight: 320 }, label: 'text' })
  registry.unregister('text')
  assert.equal(registry.get('text'), null)
})

test('NodeRegistry getDefaultSize returns default for known type', () => {
  const registry = new NodeRegistry()
  registry.register('video', { defaultSize: { cardWidth: 480, cardHeight: 320 }, label: 'video' })
  assert.deepEqual(registry.getDefaultSize('video'), { cardWidth: 480, cardHeight: 320 })
})

test('NodeRegistry getDefaultSize returns fallback for unknown type', () => {
  const registry = new NodeRegistry()
  assert.deepEqual(registry.getDefaultSize('unknown'), { cardWidth: 256, cardHeight: 256 })
})
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
node --test src\canvas\core\registry\__tests__\NodeRegistry.test.ts
```

Expected: FAIL — `NodeRegistry` 模块不存在。

- [ ] **Step 3: 实现 NodeRegistry**

Create `src/canvas/core/registry/NodeRegistry.ts`:

```typescript
import type { Component } from 'vue'

export interface NodeTypeBundle {
  node?: Component
  topToolbar?: Component
  bottomToolbar?: Component
  defaultSize: { cardWidth: number; cardHeight: number }
  label: string
}

export class NodeRegistry {
  private types = new Map<string, NodeTypeBundle>()

  register(name: string, bundle: NodeTypeBundle): void {
    this.types.set(name, bundle)
  }

  unregister(name: string): void {
    this.types.delete(name)
  }

  get(name: string): NodeTypeBundle | null {
    return this.types.get(name) ?? null
  }

  getAllTypes(): string[] {
    return [...this.types.keys()]
  }

  getDefaultSize(name: string): { cardWidth: number; cardHeight: number } {
    return this.types.get(name)?.defaultSize ?? { cardWidth: 256, cardHeight: 256 }
  }

  getMenuItems(): { id: string; label: string; icon?: string }[] {
    const items: { id: string; label: string; icon?: string }[] = []
    for (const [name, bundle] of this.types) {
      items.push({ id: name, label: bundle.label, icon: undefined })
    }
    return items
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```powershell
node --test src\canvas\core\registry\__tests__\NodeRegistry.test.ts
```

Expected: PASS — 5 tests。

- [ ] **Step 5: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/registry
git commit -m "feat: add NodeRegistry with unit tests for dynamic node component lookup"
```

---

### Task 4: CustomNode.vue 从 NodeRegistry 读取组件

**Files:**
- Modify: `src/canvas/core/components/CustomNode.vue`

- [ ] **Step 1: 重写 script setup**

Replace the entire `<script setup>` block in `src/canvas/core/components/CustomNode.vue`:

```vue
<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, type Component } from 'vue'
import BaseNode from './Decoration/BaseNode.vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'

const props = defineProps<NodeProps>()
const runtime = useCanvasRuntime()

interface NodeTypeBundle {
  node?: Component
  topToolbar?: Component
  bottomToolbar?: Component
}

const bundle = computed<NodeTypeBundle>(() => {
  const nt = props.data?.nodeType as string | undefined
  if (nt) {
    const reg = runtime.nodeRegistry.get(nt)
    if (reg) {
      return {
        node: reg.node,
        topToolbar: reg.topToolbar,
        bottomToolbar: reg.bottomToolbar,
      }
    }
  }
  return {}
})

const ContentComponent = computed(() => bundle.value.node || null)
const TopToolbarComponent = computed(() => bundle.value.topToolbar || null)
const BottomToolbarComponent = computed(() => bundle.value.bottomToolbar || null)
</script>
```

模板保持不变。

- [ ] **Step 2: 构建验证**

```powershell
pnpm build
```

Expected: exit code `0`。注意：此时 CustomNode 能编译通过，但节点组件还未注册到 NodeRegistry，运行时 CustomNode 会走 fallback（空 bundle）。

- [ ] **Step 3: 提交**

```powershell
git add src/canvas/core/components/CustomNode.vue
git commit -m "refactor: CustomNode reads node components from NodeRegistry instead of hardcoded imports"
```

---

### Task 5: Canvas.vue 菜单和默认尺寸从 NodeRegistry 读取

**Files:**
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 删除硬编码的 NODE_MENU_ITEMS**

删除约 L169-174 的 `NODE_MENU_ITEMS` 数组。

- [ ] **Step 2: 删除硬编码的 NODE_TYPE_DEFAULT_SIZE**

删除约 L378-383 的 `NODE_TYPE_DEFAULT_SIZE` 对象。

- [ ] **Step 3: 改为从 nodeRegistry 读取**

在用到 `NODE_MENU_ITEMS` 的地方（`openCreateNodeMenu` 内 L441），改为：

```typescript
items: nodeRegistry.getMenuItems().map(item => ({
  id: item.id,
  label: item.label,
  description: `create ${item.label} node`,
  icon: item.icon as any,
})),
```

在 `createNodeFromMenuItem`（约 L388）中，改为：

```typescript
const defaultSize = nodeRegistry.getDefaultSize(item.id)
```

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/Canvas.vue
git commit -m "refactor: Canvas.vue reads menu items and default sizes from NodeRegistry"
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

- [ ] **Step 1: 改名 video 目录**

```powershell
git mv src\canvas\core\components\nodes\video src\canvas\core\components\nodes\Video_tmp
git mv src\canvas\core\components\nodes\Video_tmp src\canvas\core\components\nodes\Video
```

- [ ] **Step 2: 写 TextNodePlugin**

Create `src/canvas/core/nodes/text/TextNodePlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { markRaw } from 'vue'
import { TextNode, TextTopToolbar, TextBottomToolbar } from '../../components/nodes/text/index'

export const TextNodePlugin: CanvasPlugin = {
  name: 'node:text',
  version: '1.0.0',

  install(context: PluginContext) {
    context.registerNodeType('text', markRaw(TextNode))

    context.logger.info('text node type registered')
  },
}
```

- [ ] **Step 3: 写 ImageNodePlugin**

Create `src/canvas/core/nodes/image/ImageNodePlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { markRaw } from 'vue'
import { ImageNode, ImageTopToolbar, ImageBottomToolbar } from '../../components/nodes/image/index'

export const ImageNodePlugin: CanvasPlugin = {
  name: 'node:image',
  version: '1.0.0',

  install(context: PluginContext) {
    context.registerNodeType('image', markRaw(ImageNode))

    context.logger.info('image node type registered')
  },
}
```

- [ ] **Step 4: 写 VideoNodePlugin**

Create `src/canvas/core/nodes/Video/VideoNodePlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { markRaw } from 'vue'
import { VideoNode, VideoTopToolbar, VideoBottomToolbar } from '../../components/nodes/Video/index'

export const VideoNodePlugin: CanvasPlugin = {
  name: 'node:video',
  version: '1.0.0',

  install(context: PluginContext) {
    context.registerNodeType('video', markRaw(VideoNode))

    context.logger.info('video node type registered')
  },
}
```

- [ ] **Step 5: 写 StageNodePlugin**

Create `src/canvas/core/nodes/stage/StageNodePlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { markRaw } from 'vue'
import { StageNode, StageTopToolbar, StageBottomToolbar } from '../../components/nodes/stage/index'

export const StageNodePlugin: CanvasPlugin = {
  name: 'node:stage',
  version: '1.0.0',

  install(context: PluginContext) {
    context.registerNodeType('stage', markRaw(StageNode))

    context.logger.info('stage node type registered')
  },
}
```

- [ ] **Step 6: 修改 App.vue 注册节点插件**

In `src/App.vue`, add imports:

```typescript
import { TextNodePlugin } from './canvas/core/nodes/text/TextNodePlugin'
import { ImageNodePlugin } from './canvas/core/nodes/image/ImageNodePlugin'
import { VideoNodePlugin } from './canvas/core/nodes/Video/VideoNodePlugin'
import { StageNodePlugin } from './canvas/core/nodes/stage/StageNodePlugin'
```

Add to `pluginSlots` array at the very top:

```typescript
{
  plugin: markRaw(TextNodePlugin) as CanvasPlugin,
  enabled: true,
  label: 'text node',
  description: 'text node type registration',
  usage: 'auto-loaded',
},
{
  plugin: markRaw(ImageNodePlugin) as CanvasPlugin,
  enabled: true,
  label: 'image node',
  description: 'image node type registration',
  usage: 'auto-loaded',
},
{
  plugin: markRaw(VideoNodePlugin) as CanvasPlugin,
  enabled: true,
  label: 'video node',
  description: 'video node type registration',
  usage: 'auto-loaded',
},
{
  plugin: markRaw(StageNodePlugin) as CanvasPlugin,
  enabled: true,
  label: 'stage node',
  description: 'stage node type registration',
  usage: 'auto-loaded',
},
```

- [ ] **Step 7: 确认无旧路径引用**

```powershell
Select-String -Path 'src\canvas\core\**\*.ts' -Pattern 'nodes/video' -SimpleMatch
Select-String -Path 'src\canvas\core\**\*.vue' -Pattern 'nodes/video' -SimpleMatch
```

Expected: no matches。

- [ ] **Step 8: 构建 + 提交**

```powershell
pnpm build
git add .
git commit -m "feat: convert text/image/video/stage to node plugins, rename video dir to Video"
```

---

## 完成标准

- [ ] `pnpm build` 通过
- [ ] `node --test src\canvas\core\registry\__tests__\NodeRegistry.test.ts` 通过
- [ ] 画布能正常打开，四种节点类型能正常创建和渲染
- [ ] 任意子组件可以 `usePluginApi('storage')` 拿到 storage API
- [ ] CustomNode.vue 不再硬编码 import text/image/video/stage 组件
- [ ] video 目录已改名为 Video
