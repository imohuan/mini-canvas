# Image Compare Node Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 创建图片对比节点（image-compare），支持连接 2 个上游图片节点，并排对比显示，带可拖拽分割线。最多 2 条连接（FIFO），超出的删除最早的一条。

**Architecture:** 参照 PanoramaNodePlugin 模式——单一 targetHandle 限制 2 条输入连接的 FIFO 策略，通过监听 connect 事件自动清理。视图层用 CSS clip-path 实现左右分割对比效果。

**Tech Stack:** Vue 3 + TypeScript + @vue-flow/core + CSS clip-path

---

### Task 1: 扩展类型定义

**Files:**
- Modify: `src/canvas/core/types/CanvasNodeData.ts`

**Step 1: 添加 ImageCompareNodeData 类型**

在 `PanoramaNodeData` 后面追加：

```typescript
export interface ImageCompareNodeData extends BaseCanvasNodeData {
  nodeType: 'image-compare'
  leftImageUrl?: string   // 左侧图片 URL（runtime only）
  rightImageUrl?: string  // 右侧图片 URL（runtime only）
  dividerPosition?: number // 分割线位置百分比 0-100，默认 50
  compareMode?: 'side-by-side' | 'overlay' | 'slider' // 对比模式，默认 'slider'
}
```

在 `CanvasNodeData` 联合类型中加入 `ImageCompareNodeData`：

```typescript
export type CanvasNodeData = ... | ImageCompareNodeData | BaseCanvasNodeData
```

**Step 2: 验证类型**

运行 `npx tsc --noEmit` 确认无类型错误。

---

### Task 2: 创建 ImageCompareNode.vue

**Files:**
- Create: `src/canvas/core/nodes/image-compare/ImageCompareNode.vue`

**组件逻辑：**

```vue
<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import { NodeIdInjection } from '@vue-flow/core'
import type { Edge, Node } from '@vue-flow/core'

defineOptions({ inheritAttrs: false })
const props = defineProps<NodeProps>()
const nodeId = inject(NodeIdInjection, null) as string | null
const { getEdges, findNode } = useVueFlow()

const containerRef = ref<HTMLDivElement | null>(null)
const dividerPos = ref(50)
const isDragging = ref(false)

/** 从左到右按连接顺序取得 2 个上游 imageUrl */
const connectedImages = computed(() => {
  if (!nodeId) return [] as string[]
  const edges = getEdges.value as Edge[]
  const connected = edges
    .filter(e => e.target === nodeId && e.targetHandle === 'target')
    .map(e => {
      const sourceNode = findNode(e.source) as Node | undefined
      return (sourceNode?.data as any)?.imageUrl as string || ''
    })
    .filter(Boolean)
  return connected.slice(0, 2)
})

const leftImage = computed(() => connectedImages.value[0] || '')
const rightImage = computed(() => connectedImages.value[1] || '')
const hasTwoImages = computed(() => !!leftImage.value && !!rightImage.value)

/** 分割线拖拽 */
function onDividerPointerDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onDividerPointerMove(e: PointerEvent) {
  if (!isDragging.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const pct = Math.max(5, Math.min(95, (x / rect.width) * 100))
  dividerPos.value = pct
}

function onDividerPointerUp(e: PointerEvent) {
  isDragging.value = false
}
</script>

<template>
  <div ref="containerRef" class="w-full h-full relative overflow-hidden bg-gray-100 select-none">
    <!-- 无连接占位 -->
    <div v-if="!connectedImages.length" class="absolute inset-0 flex items-center justify-center">
      <div class="flex flex-col items-center gap-2 text-gray-400">
        <svg class="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 12h6"/>
          <path d="M12 9v6"/>
        </svg>
        <span class="text-xs">连接 2 个图片节点进行对比</span>
      </div>
    </div>

    <!-- 只有一张图：直接显示 -->
    <img
      v-if="leftImage && !rightImage"
      :src="leftImage"
      class="absolute inset-0 w-full h-full object-contain"
      draggable="false"
    />

    <!-- 两张图：分割对比 -->
    <template v-if="hasTwoImages">
      <!-- 右图（底层，被左图 clip 遮住） -->
      <img
        :src="rightImage"
        class="absolute inset-0 w-full h-full object-contain"
        draggable="false"
      />
      <!-- 左图（上层，clip 到分割线左侧） -->
      <img
        :src="leftImage"
        class="absolute inset-0 w-full h-full object-contain"
        :style="{ clipPath: `inset(0 ${100 - dividerPos}% 0 0)` }"
        draggable="false"
      />
      <!-- 分割线 -->
      <div
        class="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg cursor-col-resize z-10"
        :style="{ left: dividerPos + '%' }"
        @pointerdown="onDividerPointerDown"
        @pointermove="onDividerPointerMove"
        @pointerup="onDividerPointerUp"
      >
        <!-- 拖拽手柄 -->
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center border border-gray-200">
          <svg class="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l-3-3.5L4 16l4-4-4-4 1-1.5L8 5zm8 14V5l3 3.5L20 8l-4 4 4 4-1 1.5L16 19z"/>
          </svg>
        </div>
      </div>
    </template>

    <!-- 单图时显示连接提示 -->
    <div v-if="leftImage && !rightImage" class="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-1 rounded">
      再连接一个图片节点进行对比
    </div>
  </div>
</template>
```

**注意**: 分割线拖拽使用 `pointer-events + setPointerCapture`，在模板中用 `@pointermove/@pointerup` 挂载在 divider 自身。避免和 vue-flow 拖拽冲突。

---

### Task 3: 创建 ImageCompareNodePlugin.ts

**Files:**
- Create: `src/canvas/core/nodes/image-compare/ImageCompareNodePlugin.ts`

```typescript
import { markRaw } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { Position } from '@vue-flow/core'
import { ImageCompareNode } from './index'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'

const menuIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21" stroke-width="2"/><polyline points="9 8 6 11 9 14" stroke-linecap="round" stroke-linejoin="round"/><polyline points="15 8 18 11 15 14" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const titleIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/><polyline points="9 8 6 11 9 14"/><polyline points="15 8 18 11 15 14"/></svg>`

export const ImageCompareNodePlugin: CanvasPlugin = {
  name: 'node:image-compare',
  version: '1.0.0',

  install(context: PluginContext) {
    // 注册节点定义
    context.canvasNodes.register({
      type: 'image-compare',
      node: markRaw(ImageCompareNode),
      label: '图片对比',
      defaultSize: { cardWidth: 500, cardHeight: 350 },
      menuItem: {
        label: '图片对比',
        description: '创建图片对比节点，连接2个图片并排对比',
        icon: menuIconSvg,
        badge: 'Compare',
      },
      canReceiveInput: true,
      resizable: true,
      titleIcon: titleIconSvg,
    })

    /** 限制最多 2 条输入连接：新边连入时，若已有 2 条，删除最早的一条（FIFO） */
    const offConnect = context.on('connect', (connection: {
      source: string; target: string; sourceHandle: string | null; targetHandle: string | null
    }) => {
      if (connection.targetHandle !== 'target') return

      const targetNode = context.actions.getNodes().find(
        (n: Node) => n.id === connection.target
      )
      if ((targetNode?.data as any)?.nodeType !== 'image-compare') return

      const allEdges = context.actions.getEdges()
      const inputEdges = allEdges.filter(
        e => e.target === connection.target && e.targetHandle === 'target'
      )

      // 只有超过 2 条时才清理
      if (inputEdges.length <= 2) return

      // 找到新边（精确匹配 source/target/handle），其余按 id 排序取最早的
      const newEdge = inputEdges.find(
        e => e.source === connection.source && e.target === connection.target
          && e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle
      )
      if (!newEdge) return

      const oldEdges = inputEdges.filter(e => e.id !== newEdge.id)
      if (oldEdges.length === 0) return

      // 删除最早的那条（保留最新 2 条即 newEdge + 最近的 1 条 oldEdge）
      // oldEdges 按连接顺序排列，删除第一条（最早）
      if (inputEdges.length > 2) {
        const toRemove = oldEdges.slice(0, oldEdges.length - 1)
        context.actions.removeEdges(toRemove.map(e => e.id))
      }
    })

    return {
      uninstall() {
        context.canvasNodes.unregister('image-compare')
        offConnect()
      },
    }
  },
}
```

**重要**: FIFO 逻辑——当有 N > 2 条输入边时，保留最新的 2 条（新边 + 最接近新边的 1 条旧边），删除其余最早的边。

等一等，让我重新想想。如果已有 2 条边（edge1, edge2），第 3 条（edge3）连入时，total 变成 3。我们应该保留 edge2 和 edge3，删除 edge1。即保留最新的 2 条。

oldEdges 不包含 newEdge，如果 oldEdges 有 2 条（即总共 3 条），取 `oldEdges[0]`（最早的那条）删除。

修正后的逻辑：
```typescript
if (inputEdges.length <= 2) return
// 总边数 > 2
const newEdge = inputEdges.find(...)
if (!newEdge) return
const oldEdges = inputEdges.filter(e => e.id !== newEdge.id)
// 保留 2 条：newEdge + oldEdges 中离现在最近的那条
// 删除 oldEdges 中最早的 (N-2) 条
const removeCount = oldEdges.length - 1  // 只保留 1 条旧边
if (removeCount > 0) {
  const toRemove = oldEdges.slice(0, removeCount)
  context.actions.removeEdges(toRemove.map(e => e.id))
}
```

---

### Task 4: 创建 index.ts 导出

**Files:**
- Create: `src/canvas/core/nodes/image-compare/index.ts`

```typescript
export { default as ImageCompareNode } from './ImageCompareNode.vue'
```

---

### Task 5: 注册插件到 App.vue

**Files:**
- Modify: `src/App.vue`

在 import 区域添加：
```typescript
import { ImageCompareNodePlugin } from './canvas/core/nodes/image-compare/ImageCompareNodePlugin'
```

在 `pluginSlots` 数组中（PanoramaNodePlugin 后面）添加：
```typescript
{
  plugin: markRaw(ImageCompareNodePlugin) as CanvasPlugin,
  enabled: true,
  label: '图片对比节点',
  description: '注册图片对比节点到 NodeRegistry，连接2个图片节点进行并排对比',
  usage: '右键画布 → 图片对比 → 连接2个图片节点 → 拖拽分割线对比',
},
```

---

### Task 6: 验证构建

运行 `npx tsc --noEmit` 确认无类型错误，然后执行 `pnpm dev` 验证功能：
1. 右键画布 → 图片对比 → 创建节点
2. 创建 2 个图片节点，分别连接到此节点
3. 拖拽分割线查看对比效果
4. 连接第 3 个图片节点，验证最早连接被删除
5. 验证节点可 resize
