# Toolbar 架构重构 v2 — 统一 BaseToolbar + NodeToolbar 定位

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除所有节点类型独立的 `*TopToolbar.vue` / `*BottomToolbar.vue`，改为插件通过 `ToolbarRegistry` 注册按钮，`BaseToolbar` 统一渲染，`NodeToolbar` 负责 Teleport 定位。

**Architecture:** `BaseNode` slot → `NodeToolbar`（Teleport 定位到 viewport）→ `BaseToolbar`（从 ToolbarRegistry 读按钮列表）→ `ToolbarButton`（图标+文字+tooltip+下拉菜单）或 `customRender` 组件。

**Tech Stack:** Vue 3.5 + TypeScript + @vue-flow/core

---

## 文件变更总览

### 新建
```
src/canvas/core/components/toolbar/
  ToolbarDropdown.vue              # 下拉菜单弹出层（已内嵌到 ToolbarButton）
src/canvas/core/nodes/image/
  ImageUploadButton.vue            # 图片上传按钮（customRender 组件）
```

### 修改
```
src/canvas/core/components/toolbar/BaseToolbar.vue       # 重写：包裹 NodeToolbar，用 ToolbarButton 渲染
src/canvas/core/components/Decoration/ToolbarButton.vue   # 增强：icon/title/tooltip/dropdown/customRender
src/canvas/core/components/Decoration/NodeToolbar.vue     # 去掉 @deprecated 注释
src/canvas/core/components/CustomNode.vue                 # 简化：只放 BaseToolbar
src/canvas/core/registry/types.ts                         # ToolbarButtonDefinition 加字段
src/canvas/core/nodes/image/ImageNodePlugin.ts            # 注册 toolbar 按钮
src/canvas/core/nodes/text/TextNodePlugin.ts              # 同上
src/canvas/core/nodes/Video/VideoNodePlugin.ts            # 同上
src/canvas/core/nodes/stage/StageNodePlugin.ts            # 同上
```

### 删除
```
src/canvas/core/nodes/image/ImageTopToolbar.vue
src/canvas/core/nodes/image/ImageBottomToolbar.vue
src/canvas/core/nodes/text/TextTopToolbar.vue
src/canvas/core/nodes/text/TextBottomToolbar.vue
src/canvas/core/nodes/Video/VideoTopToolbar.vue
src/canvas/core/nodes/Video/VideoBottomToolbar.vue
src/canvas/core/nodes/stage/StageTopToolbar.vue
src/canvas/core/nodes/stage/StageBottomToolbar.vue
```

### 更新 index.ts 导出
```
src/canvas/core/nodes/image/index.ts   # 移除 toolbar 导出
src/canvas/core/nodes/text/index.ts    # 同上
src/canvas/core/nodes/Video/index.ts   # 同上
src/canvas/core/nodes/stage/index.ts   # 同上
```
---

### Task 1: 扩展 ToolbarButtonDefinition 类型

**Files:**
- Modify: `src/canvas/core/registry/types.ts`

- [ ] **Step 1: 添加 tooltip、dropdown、customRender 字段**

在 `ToolbarButtonDefinition` 接口前新增 `ToolbarDropdownItem`，扩展 `ToolbarButtonDefinition`：

```ts
export interface ToolbarDropdownItem {
  id: string
  title?: string
  icon?: string | Component
  commandId?: string
  disabled?: boolean | ((ctx: CommandContext) => boolean)
  danger?: boolean
}

// ToolbarButtonDefinition 改为：
export interface ToolbarButtonDefinition extends BaseRegistryItem {
  commandId: string
  title?: string
  icon?: string | Component
  position: 'top' | 'bottom'
  nodeTypes?: string[]
  tooltip?: string
  dropdown?: ToolbarDropdownItem[]
  customRender?: Component
}
```

- [ ] **Step 2: 运行类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/canvas/core/registry/types.ts
git commit -m "feat: add tooltip/dropdown/customRender to ToolbarButtonDefinition"
```

---

### Task 2: 增强 ToolbarButton 组件

**Files:**
- Modify: `src/canvas/core/components/Decoration/ToolbarButton.vue`

- [ ] **Step 1: 重写 ToolbarButton**

完整替换 `ToolbarButton.vue` 为支持 icon/title/tooltip/dropdown/customRender 的版本：

```vue
<script setup lang="ts">
import { ref, type Component } from 'vue'

const props = withDefaults(defineProps<{
  icon?: Component | string
  title?: string
  tooltip?: string
  variant?: 'default' | 'primary'
  danger?: boolean
  disabled?: boolean
  dropdown?: Array<{
    id: string; title?: string; icon?: Component | string
    danger?: boolean; disabled?: boolean
  }>
  customRender?: Component
}>(), { variant: 'default', danger: false, disabled: false })

const emit = defineEmits<{
  (e: 'action'): void
  (e: 'dropdown-select', id: string): void
}>()

const showDropdown = ref(false)

function onButtonClick() {
  if (props.disabled) return
  if (props.dropdown && props.dropdown.length > 0) {
    showDropdown.value = !showDropdown.value
    return
  }
  emit('action')
}

function onDropdownItemClick(id: string) {
  showDropdown.value = false
  emit('dropdown-select', id)
}
</script>

<template>
  <div class="toolbar-button-wrapper" @mouseleave="showDropdown = false">
    <component v-if="customRender" :is="customRender" @action="emit('action')" />
    <button v-else class="toolbar-button"
      :class="{
        'toolbar-button--primary': variant === 'primary',
        'toolbar-button--danger': danger,
        'is-disabled': disabled,
      }"
      :disabled="disabled" :title="tooltip || title" type="button" @click="onButtonClick">
      <component v-if="typeof icon === 'object' && icon" :is="icon" class="toolbar-button-icon" />
      <span v-else-if="typeof icon === 'string' && icon" class="toolbar-button-icon" v-html="icon" />
      <span v-if="title" class="toolbar-button-label">{{ title }}</span>
      <svg v-if="dropdown && dropdown.length > 0" class="toolbar-button-chevron" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <Teleport to="body">
      <Transition name="dropdown-fade">
        <div v-if="showDropdown && dropdown && dropdown.length > 0" class="toolbar-dropdown">
          <button v-for="item in dropdown" :key="item.id" class="toolbar-dropdown-item"
            :class="{ 'toolbar-dropdown-item--danger': item.danger, 'is-disabled': item.disabled }"
            :disabled="item.disabled" type="button" @click.stop="onDropdownItemClick(item.id)">
            <component v-if="typeof item.icon === 'object' && item.icon" :is="item.icon" class="toolbar-dropdown-item-icon" />
            <span v-else-if="typeof item.icon === 'string' && item.icon" class="toolbar-dropdown-item-icon" v-html="item.icon" />
            <span v-if="item.title" class="toolbar-dropdown-item-label">{{ item.title }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.toolbar-button-wrapper { position: relative; display: inline-flex; }
.toolbar-button {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; border: 0; border-radius: 6px;
  background: transparent; color: var(--canvas-node-text, #374151);
  font-size: 12px; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.toolbar-button:hover:not(.is-disabled) {
  background: var(--canvas-node-panel-surface-hover, rgba(0,0,0,0.06));
  color: var(--canvas-node-text-strong, #111827);
}
.toolbar-button--primary { color: var(--canvas-node-text-strong, #111827); }
.toolbar-button--primary:hover:not(.is-disabled) { background: var(--canvas-node-panel-surface-active, rgba(59,130,246,0.12)); }
.toolbar-button--danger { color: #ef4444; }
.toolbar-button--danger:hover:not(.is-disabled) { background: rgba(239,68,68,0.08); }
.toolbar-button.is-disabled { opacity: 0.4; cursor: not-allowed; }
.toolbar-button-icon { width: 14px; height: 14px; flex-shrink: 0; }
.toolbar-button-label { font-size: 12px; }
.toolbar-button-chevron { opacity: 0.5; margin-left: 2px; }
.toolbar-dropdown {
  position: fixed; z-index: 99999; margin-top: 4px; min-width: 140px;
  padding: 4px; background: rgba(255,255,255,0.95); backdrop-filter: blur(12px);
  border: 1px solid rgba(0,0,0,0.08); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.toolbar-dropdown-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 10px; border: 0; border-radius: 6px;
  background: transparent; color: #374151; font-size: 12px;
  cursor: pointer; text-align: left;
}
.toolbar-dropdown-item:hover:not(.is-disabled) { background: rgba(0,0,0,0.05); }
.toolbar-dropdown-item--danger { color: #ef4444; }
.toolbar-dropdown-item--danger:hover:not(.is-disabled) { background: rgba(239,68,68,0.08); }
.toolbar-dropdown-item.is-disabled { opacity: 0.4; cursor: not-allowed; }
.toolbar-dropdown-item-icon { width: 14px; height: 14px; flex-shrink: 0; }
.toolbar-dropdown-item-label { font-size: 12px; }
.dropdown-fade-enter-active, .dropdown-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-fade-enter-from, .dropdown-fade-leave-to {
  opacity: 0; transform: translateY(-4px);
}
</style>
```

- [ ] **Step 2: 运行类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/canvas/core/components/Decoration/ToolbarButton.vue
git commit -m "feat: enhance ToolbarButton with icon/title/tooltip/dropdown/customRender"
```

---

### Task 3: 恢复 NodeToolbar（去掉 @deprecated）

**Files:**
- Modify: `src/canvas/core/components/Decoration/NodeToolbar.vue`

- [ ] **Step 1: 删除 @deprecated 注释**

删除文件第一行：
```ts
/** @deprecated 使用 BaseToolbar 替代。BaseToolbar 通过 slot 渲染在节点 DOM 内，不需要 Teleport 定位。 */
```

- [ ] **Step 2: Commit**

```bash
git add src/canvas/core/components/Decoration/NodeToolbar.vue
git commit -m "fix: remove deprecated annotation from NodeToolbar"
```

---

### Task 4: 重写 BaseToolbar

**Files:**
- Modify: `src/canvas/core/components/toolbar/BaseToolbar.vue`

- [ ] **Step 1: 完整替换 BaseToolbar.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { Position } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'
import NodeToolbar from '../Decoration/NodeToolbar.vue'
import ToolbarButton from '../Decoration/ToolbarButton.vue'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import { useCanvasStore } from '../../composables/useCanvasStore'
import type { ToolbarButtonDefinition, CommandContext } from '../../registry/types'

const props = defineProps<NodeProps & {
  toolbarPosition: 'top' | 'bottom'
}>()

const runtime = useCanvasRuntime()
const canvas = useCanvasStore()

const nodeType = computed(() => props.data?.nodeType as string | undefined)

const visibleButtons = computed<ToolbarButtonDefinition[]>(() => {
  const all = runtime.toolbarRegistry.getByPosition(props.toolbarPosition)
  return all.filter((btn) => {
    if (btn.nodeTypes && btn.nodeTypes.length > 0 && nodeType.value) {
      if (!btn.nodeTypes.includes(nodeType.value)) return false
    }
    return true
  })
})

const nodeToolbarPosition = computed(() =>
  props.toolbarPosition === 'top' ? Position.Top : Position.Bottom
)
const nodeToolbarOffset = computed(() =>
  props.toolbarPosition === 'top'
    ? canvas.state.core.topToolbarOffset
    : canvas.state.core.bottomToolbarOffset
)

function buildContext(): CommandContext {
  return {
    runtime, actions: null, selection: null, viewport: null, store: null,
    logger: console, node: props as any, nodeType: nodeType.value,
  }
}

function isDisabled(btn: ToolbarButtonDefinition): boolean {
  if (btn.disabled === undefined) return false
  if (typeof btn.disabled === 'boolean') return btn.disabled
  try { return btn.disabled(buildContext()) } catch { return true }
}

function onButtonAction(btn: ToolbarButtonDefinition) {
  if (isDisabled(btn)) return
  runtime.commandRegistry.execute(btn.commandId, buildContext())
}

function onDropdownSelect(btn: ToolbarButtonDefinition, itemId: string) {
  const item = btn.dropdown?.find(d => d.id === itemId)
  if (!item || item.disabled) return
  if (item.commandId) {
    runtime.commandRegistry.execute(item.commandId, buildContext())
  }
}
</script>

<template>
  <NodeToolbar v-if="visibleButtons.length > 0" :position="nodeToolbarPosition" :offset="nodeToolbarOffset">
    <div class="base-toolbar">
      <ToolbarButton v-for="btn in visibleButtons" :key="btn.id"
        :icon="btn.icon" :title="btn.title" :tooltip="btn.tooltip"
        :disabled="isDisabled(btn)" :dropdown="btn.dropdown" :custom-render="btn.customRender"
        @action="onButtonAction(btn)"
        @dropdown-select="(id: string) => onDropdownSelect(btn, id)" />
    </div>
  </NodeToolbar>
</template>

<style scoped>
.base-toolbar {
  display: flex; align-items: center; gap: 2px; padding: 4px;
  border: 1px solid rgba(0,0,0,0.08); border-radius: 8px;
  background: rgba(255,255,255,0.92); backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.08); pointer-events: auto;
}
</style>
```

- [ ] **Step 2: 运行类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/canvas/core/components/toolbar/BaseToolbar.vue
git commit -m "feat: rewrite BaseToolbar with NodeToolbar wrapper and ToolbarButton"
```

---

### Task 5: 简化 CustomNode

**Files:**
- Modify: `src/canvas/core/components/CustomNode.vue`

- [ ] **Step 1: 完整替换 CustomNode.vue**

```vue
<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, type Component } from 'vue'
import BaseNode from './Decoration/BaseNode.vue'
import BaseToolbar from './toolbar/BaseToolbar.vue'
import { useCanvasRuntime } from '../runtime/useCanvasRuntime'

const props = defineProps<NodeProps>()
const runtime = useCanvasRuntime()

const ContentComponent = computed<Component | null>(() => {
  const nodeType = props.data?.nodeType as string | undefined
  if (!nodeType) return null
  return runtime.nodeRegistry.get(nodeType)?.node ?? null
})
</script>

<template>
  <BaseNode v-bind="$props">
    <template #top-toolbar>
      <slot name="top-toolbar">
        <BaseToolbar v-bind="$props" toolbar-position="top" />
      </slot>
    </template>
    <template #content>
      <component v-if="ContentComponent" :is="ContentComponent" v-bind="$props" />
    </template>
    <template #bottom-toolbar>
      <slot name="bottom-toolbar">
        <BaseToolbar v-bind="$props" toolbar-position="bottom" />
      </slot>
    </template>
  </BaseNode>
</template>
```

- [ ] **Step 2: 运行类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/canvas/core/components/CustomNode.vue
git commit -m "refactor: simplify CustomNode, remove toolbarLoaders"
```

---

### Task 6: ImageNodePlugin 注册 toolbar + 删除旧文件

**Files:**
- Create: `src/canvas/core/nodes/image/ImageUploadButton.vue`
- Modify: `src/canvas/core/nodes/image/ImageNodePlugin.ts`
- Delete: `src/canvas/core/nodes/image/ImageTopToolbar.vue`
- Delete: `src/canvas/core/nodes/image/ImageBottomToolbar.vue`
- Modify: `src/canvas/core/nodes/image/index.ts`

- [ ] **Step 1: 创建 ImageUploadButton.vue**

图片上传需要 `<input type="file">`，用 customRender 组件：

```vue
<script setup lang="ts">
import { ref } from 'vue'
const emit = defineEmits<{ (e: 'action'): void }>()
const fileInputRef = ref<HTMLInputElement | null>(null)
function openPicker() { fileInputRef.value?.click() }
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) emit('action')
  input.value = ''
}
</script>
<template>
  <div class="image-upload-btn">
    <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileChange" />
    <button class="toolbar-btn-inner" type="button" @click="openPicker">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span>上传图片</span>
    </button>
  </div>
</template>
<style scoped>
.hidden { display: none; }
.toolbar-btn-inner { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: #374151; font-size: 12px; cursor: pointer; }
.toolbar-btn-inner:hover { background: rgba(0,0,0,0.06); }
</style>
```

- [ ] **Step 2: 修改 ImageNodePlugin.ts**

```ts
import { markRaw } from 'vue'
import { ImageNode } from './index'
import ImageUploadButton from './ImageUploadButton.vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'

export const ImageNodePlugin: CanvasPlugin = {
  name: 'node:image',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'image',
      node: markRaw(ImageNode),
      label: '图片',
      defaultSize: { cardWidth: 360, cardHeight: 270 },
      menuItem: { label: '图片', description: '创建图片节点', icon: 'image' },
      canReceiveInput: true,
      resizable: false,
    })

    const uploadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`
    const cropSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`
    const filterSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke-linecap="round"/></svg>`
    const rotateSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`
    const downloadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

    context.toolbars.register('node:image', { id: 'image.upload', source: 'node:image', commandId: 'image.upload', position: 'top', title: '上传图片', tooltip: '点击上传本地图片', nodeTypes: ['image'], order: 10, customRender: markRaw(ImageUploadButton) })
    context.toolbars.register('node:image', { id: 'image.crop', source: 'node:image', commandId: 'image.crop', position: 'top', title: '裁剪', icon: cropSvg, tooltip: '裁剪图片', nodeTypes: ['image'], order: 20 })
    context.toolbars.register('node:image', { id: 'image.filter', source: 'node:image', commandId: 'image.filter', position: 'top', title: '滤镜', icon: filterSvg, nodeTypes: ['image'], order: 30, dropdown: [{ id: 'image.filter.none', title: '无滤镜' }, { id: 'image.filter.grayscale', title: '黑白' }, { id: 'image.filter.sepia', title: '复古' }] })
    context.toolbars.register('node:image', { id: 'image.rotate', source: 'node:image', commandId: 'image.rotate', position: 'bottom', title: '旋转', icon: rotateSvg, nodeTypes: ['image'], order: 10 })
    context.toolbars.register('node:image', { id: 'image.download', source: 'node:image', commandId: 'image.download', position: 'bottom', title: '下载', icon: downloadSvg, nodeTypes: ['image'], order: 20 })

    return {
      uninstall() {
        context.canvasNodes.unregister('image')
        context.toolbars.unregisterSource('node:image')
      },
    }
  },
}
```

- [ ] **Step 3: 删除旧 toolbar 文件**

```powershell
Remove-Item src/canvas/core/nodes/image/ImageTopToolbar.vue
Remove-Item src/canvas/core/nodes/image/ImageBottomToolbar.vue
```

- [ ] **Step 4: 更新 index.ts**

```ts
export { default as ImageNode } from './ImageNode.vue'
export { default as ImageCropper } from './ImageCropper.vue'
```

- [ ] **Step 5: 运行类型检查 + Commit**

Run: `npx vue-tsc --noEmit`
Expected: 无错误

```bash
git add src/canvas/core/nodes/image/
git rm src/canvas/core/nodes/image/ImageTopToolbar.vue src/canvas/core/nodes/image/ImageBottomToolbar.vue
git commit -m "refactor: migrate ImageNode toolbar to ToolbarRegistry"
```

---

### Task 7: TextNodePlugin 注册 toolbar + 删除旧文件

**Files:**
- Modify: `src/canvas/core/nodes/text/TextNodePlugin.ts`
- Delete: `src/canvas/core/nodes/text/TextTopToolbar.vue`
- Delete: `src/canvas/core/nodes/text/TextBottomToolbar.vue`
- Modify: `src/canvas/core/nodes/text/index.ts`

- [ ] **Step 1: 修改 TextNodePlugin.ts**

```ts
import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { TextNode } from './index'

const boldSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg>`
const fontSizeSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`
const colorSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 2a10 10 0 010 20"/></svg>`
const alignSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/></svg>`
const copySvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`
const deleteSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`

export const TextNodePlugin: CanvasPlugin = {
  name: 'node:text',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'text', node: markRaw(TextNode), label: '文本',
      defaultSize: { cardWidth: 300, cardHeight: 200 },
      menuItem: { label: '文本', description: '创建文本节点', icon: 'text' },
      canReceiveInput: false, resizable: true,
    })

    context.toolbars.register('node:text', { id: 'text.bold', source: 'node:text', commandId: 'text.bold', position: 'top', title: '加粗', icon: boldSvg, nodeTypes: ['text'], order: 10 })
    context.toolbars.register('node:text', { id: 'text.fontsize', source: 'node:text', commandId: 'text.fontsize', position: 'top', title: '字号', icon: fontSizeSvg, nodeTypes: ['text'], order: 20 })
    context.toolbars.register('node:text', { id: 'text.color', source: 'node:text', commandId: 'text.color', position: 'top', title: '颜色', icon: colorSvg, nodeTypes: ['text'], order: 30 })
    context.toolbars.register('node:text', { id: 'text.align', source: 'node:text', commandId: 'text.align', position: 'top', title: '对齐', icon: alignSvg, nodeTypes: ['text'], order: 40 })
    context.toolbars.register('node:text', { id: 'text.copy', source: 'node:text', commandId: 'text.copy', position: 'bottom', title: '复制', icon: copySvg, nodeTypes: ['text'], order: 10 })
    context.toolbars.register('node:text', { id: 'text.delete', source: 'node:text', commandId: 'text.delete', position: 'bottom', title: '删除', icon: deleteSvg, nodeTypes: ['text'], order: 20 })

    return {
      uninstall() {
        context.canvasNodes.unregister('text')
        context.toolbars.unregisterSource('node:text')
      },
    }
  },
}
```

- [ ] **Step 2: 删除旧文件 + 更新 index.ts**

```powershell
Remove-Item src/canvas/core/nodes/text/TextTopToolbar.vue
Remove-Item src/canvas/core/nodes/text/TextBottomToolbar.vue
```

index.ts: `export { default as TextNode } from './TextNode.vue'`

- [ ] **Step 3: 类型检查 + Commit**

Run: `npx vue-tsc --noEmit`

```bash
git add src/canvas/core/nodes/text/
git rm src/canvas/core/nodes/text/TextTopToolbar.vue src/canvas/core/nodes/text/TextBottomToolbar.vue
git commit -m "refactor: migrate TextNode toolbar to ToolbarRegistry"
```

---

### Task 8: VideoNodePlugin 注册 toolbar + 删除旧文件

**Files:**
- Modify: `src/canvas/core/nodes/Video/VideoNodePlugin.ts`
- Delete: `src/canvas/core/nodes/Video/VideoTopToolbar.vue`
- Delete: `src/canvas/core/nodes/Video/VideoBottomToolbar.vue`
- Modify: `src/canvas/core/nodes/Video/index.ts`

- [ ] **Step 1: 修改 VideoNodePlugin.ts**

```ts
import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { VideoNode } from './index'

const playSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg>`
const cropSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/><polyline points="16 3 21 3 21 8"/><line x1="21" y1="3" x2="11" y2="13"/></svg>`
const exportFrameSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`
const replaceSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`

export const VideoNodePlugin: CanvasPlugin = {
  name: 'node:video',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'video', node: markRaw(VideoNode), label: '视频',
      defaultSize: { cardWidth: 480, cardHeight: 320 },
      menuItem: { label: '视频', description: '创建视频节点', icon: 'video' },
      canReceiveInput: true, resizable: false,
    })

    context.toolbars.register('node:video', { id: 'video.play', source: 'node:video', commandId: 'video.play', position: 'top', title: '播放', icon: playSvg, nodeTypes: ['video'], order: 10 })
    context.toolbars.register('node:video', { id: 'video.crop', source: 'node:video', commandId: 'video.crop', position: 'top', title: '裁剪', icon: cropSvg, nodeTypes: ['video'], order: 20 })
    context.toolbars.register('node:video', { id: 'video.export-frame', source: 'node:video', commandId: 'video.export-frame', position: 'bottom', title: '导出帧', icon: exportFrameSvg, nodeTypes: ['video'], order: 10 })
    context.toolbars.register('node:video', { id: 'video.replace', source: 'node:video', commandId: 'video.replace', position: 'bottom', title: '替换', icon: replaceSvg, nodeTypes: ['video'], order: 20 })

    return {
      uninstall() {
        context.canvasNodes.unregister('video')
        context.toolbars.unregisterSource('node:video')
      },
    }
  },
}
```

- [ ] **Step 2: 删除旧文件 + 更新 index.ts**

```powershell
Remove-Item src/canvas/core/nodes/Video/VideoTopToolbar.vue
Remove-Item src/canvas/core/nodes/Video/VideoBottomToolbar.vue
```

index.ts: `export { default as VideoNode } from './VideoNode.vue'`

- [ ] **Step 3: 类型检查 + Commit**

Run: `npx vue-tsc --noEmit`

```bash
git add src/canvas/core/nodes/Video/
git rm src/canvas/core/nodes/Video/VideoTopToolbar.vue src/canvas/core/nodes/Video/VideoBottomToolbar.vue
git commit -m "refactor: migrate VideoNode toolbar to ToolbarRegistry"
```

---

### Task 9: StageNodePlugin 注册 toolbar + 删除旧文件

**Files:**
- Modify: `src/canvas/core/nodes/stage/StageNodePlugin.ts`
- Delete: `src/canvas/core/nodes/stage/StageTopToolbar.vue`
- Delete: `src/canvas/core/nodes/stage/StageBottomToolbar.vue`
- Modify: `src/canvas/core/nodes/stage/index.ts`

- [ ] **Step 1: 修改 StageNodePlugin.ts**

```ts
import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { StageNode } from './index'

const castSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`
const configSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.77 3.77z"/></svg>`
const exportSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
const copySvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`
const deleteSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`

export const StageNodePlugin: CanvasPlugin = {
  name: 'node:stage',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'stage', node: markRaw(StageNode), label: '导演台',
      defaultSize: { cardWidth: 320, cardHeight: 320 },
      menuItem: { label: '导演台', description: '创建编排节点', icon: 'layers', badge: 'NEW' },
      canReceiveInput: true, resizable: false,
    })

    context.toolbars.register('node:stage', { id: 'stage.cast', source: 'node:stage', commandId: 'stage.cast', position: 'top', title: '角色', icon: castSvg, nodeTypes: ['stage'], order: 10 })
    context.toolbars.register('node:stage', { id: 'stage.config', source: 'node:stage', commandId: 'stage.config', position: 'top', title: '配置', icon: configSvg, nodeTypes: ['stage'], order: 20 })
    context.toolbars.register('node:stage', { id: 'stage.export', source: 'node:stage', commandId: 'stage.export', position: 'bottom', title: '导出', icon: exportSvg, nodeTypes: ['stage'], order: 10 })
    context.toolbars.register('node:stage', { id: 'stage.copy', source: 'node:stage', commandId: 'stage.copy', position: 'bottom', title: '复制', icon: copySvg, nodeTypes: ['stage'], order: 20 })
    context.toolbars.register('node:stage', { id: 'stage.delete', source: 'node:stage', commandId: 'stage.delete', position: 'bottom', title: '删除', icon: deleteSvg, nodeTypes: ['stage'], order: 30 })

    return {
      uninstall() {
        context.canvasNodes.unregister('stage')
        context.toolbars.unregisterSource('node:stage')
      },
    }
  },
}
```

- [ ] **Step 2: 删除旧文件 + 更新 index.ts**

```powershell
Remove-Item src/canvas/core/nodes/stage/StageTopToolbar.vue
Remove-Item src/canvas/core/nodes/stage/StageBottomToolbar.vue
```

index.ts: `export { default as StageNode } from './StageNode.vue'`

- [ ] **Step 3: 类型检查 + Commit**

Run: `npx vue-tsc --noEmit`

```bash
git add src/canvas/core/nodes/stage/
git rm src/canvas/core/nodes/stage/StageTopToolbar.vue src/canvas/core/nodes/stage/StageBottomToolbar.vue
git commit -m "refactor: migrate StageNode toolbar to ToolbarRegistry"
```

---

### Task 10: 全量验证

- [ ] **Step 1: 运行所有单元测试**

Run: `node --test "src/canvas/core/registry/**/*.test.ts"`
Expected: 全部通过（25 tests）

- [ ] **Step 2: 运行 vue-tsc 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 确认无残留引用**

Run:
```powershell
Get-ChildItem -Path src -Recurse -Include "*.ts","*.vue" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
  if ($c -match "ImageTopToolbar|ImageBottomToolbar|TextTopToolbar|TextBottomToolbar|VideoTopToolbar|VideoBottomToolbar|StageTopToolbar|StageBottomToolbar") {
    Write-Output $_.FullName
  }
}
```
Expected: 无输出

- [ ] **Step 4: 最终 commit**

```bash
git commit -m "chore: final verification - all tests pass, no stale references"
```
