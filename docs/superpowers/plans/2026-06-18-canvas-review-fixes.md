# Canvas Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复本次代码审查里最影响正确性、内存、性能和命名一致性的几个问题，让画布保存更可靠、资源能释放、视频节点更稳、后续继续优化更容易。

**Architecture:** 先修数据正确性和资源释放，再做低风险体验修复，最后做结构性性能优化。保存清洗逻辑会从 `StoragePlugin.ts` 拆到单独模块，方便用 Node 原生测试直接测。视频目录改名只做大小写一致性修复，不改业务行为。

**Tech Stack:** Vue 3、TypeScript、Vite、Pinia、@vue-flow/core、Node 原生 `node:test`、PowerShell、pnpm。

---

## File Structure

这些文件会被创建或修改：

- Create: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\sanitizeForSave.ts`
  - 只负责保存前清洗画布数据。
  - 保留真实节点 `type`，清掉运行时 URL 和临时节点/边。

- Create: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts`
  - 覆盖保存清洗的核心行为，防止再次把 `custom` 改坏。

- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts`
  - 删除内置 `sanitizeForSave` 函数。
  - 引入新模块。
  - 增加 `uninstall()` 清理 timer、cache、object URL。

- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue`
  - 卸载时调用 `setStorageApi(null)`。
  - 后续性能任务里增加连线吸附缓存。

- Rename: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\video` → `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video`
  - 保持目录首字母大写。

- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\CustomNode.vue`
  - 把 `./nodes/video/index` 改成 `./nodes/Video/index`。

- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\image\ImageCropper.vue`
  - 给 `emitTimer` 增加卸载清理。

- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video\VideoNode.vue`
  - 增加视频空地址和加载失败兜底。

- Optional later modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\useCanvasStore.ts`
  - 默认开启只渲染可见元素。

---

## Execution Notes

- 每个任务完成后都运行：

```powershell
pnpm build
```

Expected: exit code `0`，允许继续出现当前已有的 `@vueuse/core` pure annotation warning。

- 测试文件使用 Node 原生测试风格，和现有 `auto-layout/__tests__` 一致。
- 如果本地 Node 版本不能直接运行 TypeScript 测试，就以 `pnpm build` 做强校验；测试仍要保留，后续可统一补测试运行脚本。
- Windows 下只改目录大小写时，必须用两步 `git mv`，否则 Git 可能识别不到变化。

---

### Task 1: 修复保存清洗逻辑，保证节点类型不被改坏

**Files:**
- Create: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\sanitizeForSave.ts`
- Create: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts`
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts:1-104`

- [ ] **Step 1: 写失败测试**

Create `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeForSave } from '../sanitizeForSave.ts'

test('sanitizeForSave keeps VueFlow custom node type and semantic data.nodeType', () => {
  const result = sanitizeForSave([
    {
      id: 'node-1',
      type: 'custom',
      position: { x: 10, y: 20 },
      data: {
        nodeType: 'image',
        label: '输入图片',
        assetId: 'asset-1',
        imageUrl: 'blob:http://localhost/image-1',
        _cropMode: true,
        _cropRect: { x: 0, y: 0, width: 10, height: 10 },
      },
    },
  ], [])

  assert.equal(result.nodes[0].type, 'custom')
  assert.equal(result.nodes[0].data.nodeType, 'image')
  assert.equal(result.nodes[0].data.assetId, 'asset-1')
  assert.equal('imageUrl' in result.nodes[0].data, false)
  assert.equal('_cropMode' in result.nodes[0].data, false)
  assert.equal('_cropRect' in result.nodes[0].data, false)
})

test('sanitizeForSave removes temp nodes and temp edges', () => {
  const result = sanitizeForSave([
    { id: 'node-1', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'text' } },
    { id: 'temp-target-1', type: 'tempTarget', position: { x: 1, y: 1 }, data: { isTemp: true } },
  ], [
    { id: 'edge-1', source: 'node-1', target: 'node-2', data: {} },
    { id: 'temp-edge-1', source: 'node-1', target: 'temp-target-1', data: { isTemp: true } },
  ])

  assert.deepEqual(result.nodes.map((node) => node.id), ['node-1'])
  assert.deepEqual(result.edges.map((edge) => edge.id), ['edge-1'])
})

test('sanitizeForSave removes nested runtime _url fields without mutating input', () => {
  const original = [{
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
  }]

  const result = sanitizeForSave(original, [])

  assert.equal(result.nodes[0].data.values.first.assetId, 'a')
  assert.equal('_url' in result.nodes[0].data.values.first, false)
  assert.equal((original[0].data.values.first as { _url?: string })._url, 'blob:http://localhost/a')
})
```

- [ ] **Step 2: 运行测试，确认现在失败**

Run:

```powershell
node --test "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts"
```

Expected: FAIL，原因是 `../sanitizeForSave.ts` 还不存在。

- [ ] **Step 3: 创建最小实现**

Create `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\sanitizeForSave.ts`:

```typescript
import type { CanvasData } from './StoragePlugin'

const RUNTIME_DATA_FIELDS = ['imageUrl', 'videoUrl', 'thumbUrl', '_cropRect', '_cropMode'] as const

function cloneCanvasData(nodes: unknown[], edges: unknown[]): CanvasData {
  return JSON.parse(JSON.stringify({ nodes, edges })) as CanvasData
}

function removeRuntimeNodeData(data: Record<string, unknown>): void {
  for (const key of RUNTIME_DATA_FIELDS) {
    delete data[key]
  }

  const values = data.values
  if (!values || typeof values !== 'object') return

  for (const value of Object.values(values as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      delete (value as Record<string, unknown>)._url
    }
  }
}

export function sanitizeForSave(nodes: unknown[], edges: unknown[]): CanvasData {
  const cleaned = cloneCanvasData(nodes, edges)

  for (const node of cleaned.nodes) {
    if (node.data && typeof node.data === 'object') {
      removeRuntimeNodeData(node.data as Record<string, unknown>)
    }
  }

  cleaned.nodes = cleaned.nodes.filter((node) => !String(node.id ?? '').startsWith('temp-') && !node.data?.isTemp)
  cleaned.edges = cleaned.edges.filter((edge) => !String(edge.id ?? '').startsWith('temp-') && !edge.data?.isTemp)

  return cleaned
}
```

- [ ] **Step 4: 修改 StoragePlugin 使用新函数**

Modify `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts`:

```typescript
import type { CanvasPlugin, PluginContext } from '../types'
import { IndexedDBAdapter } from './adapters/IndexedDBAdapter'
import { FileSystemAdapter } from './adapters/FileSystemAdapter'
import { AssetManager } from './adapters/AssetManager'
import { IndexedDBAssetStore } from './adapters/IndexedDBAssetStore'
import { FileSystemAssetStore } from './adapters/FileSystemAssetStore'
import { sanitizeForSave } from './sanitizeForSave'
```

Then delete the old local function block from `function sanitizeForSave(nodes: any[], edges: any[]): CanvasData {` through its closing `}` before `// ===== LocalStorage fallback constants =====`.

After deletion, the code should jump from `export interface StorageAPI { ... }` directly to:

```typescript
// ===== LocalStorage fallback constants =====
const LS_KEY_PROJECT_INDEX = 'canvas-ai:project-index'
const LS_KEY_PREFIX = 'canvas-ai:project:'
```

- [ ] **Step 5: 跑测试和构建**

Run:

```powershell
node --test "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts"
pnpm build
```

Expected:
- test PASS，3 个测试通过。
- build exit code `0`。

- [ ] **Step 6: 提交**

```powershell
git add "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\sanitizeForSave.ts" "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts" "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts"
git commit -m "fix: preserve canvas node type when saving"
```

---

### Task 2: 给 StoragePlugin 和全局 Storage API 增加卸载清理

**Files:**
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts:171-217, 564`
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:1524-1542`

- [ ] **Step 1: 写清理测试**

Append to `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts`:

```typescript
test('sanitizeForSave output contains no runtime blob url fields', () => {
  const result = sanitizeForSave([
    {
      id: 'video-1',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'video',
        videoUrl: 'blob:http://localhost/video-1',
        thumbUrl: 'blob:http://localhost/thumb-1',
        values: {
          source: { assetId: 'video-asset', _url: 'blob:http://localhost/nested' },
        },
      },
    },
  ], [])

  assert.equal('videoUrl' in result.nodes[0].data, false)
  assert.equal('thumbUrl' in result.nodes[0].data, false)
  assert.equal('_url' in result.nodes[0].data.values.source, false)
})
```

- [ ] **Step 2: 跑测试**

Run:

```powershell
node --test "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts"
```

Expected: PASS。这个测试保护清洗行为，清理生命周期主要靠构建和人工核对。

- [ ] **Step 3: 修改 StoragePlugin 返回 uninstall**

At the bottom of `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts`, replace:

```typescript
    return { api }
```

with:

```typescript
    return {
      api,
      uninstall() {
        if (_restoreTimer) {
          clearTimeout(_restoreTimer)
          _restoreTimer = null
        }
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

- [ ] **Step 4: Canvas 卸载时清空全局 Storage API**

Modify `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue` inside `onUnmounted(async () => { ... })` after `window.removeEventListener('beforeunload', handleBeforeUnload)`:

```typescript
  canvasStorageApi.value = null
  setStorageApi(null)
```

The start of `onUnmounted` should be:

```typescript
onUnmounted(async () => {
  cancelBatchConnect()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  canvasStorageApi.value = null
  setStorageApi(null)

  // 持久化当前快捷键映射到 Store
  const mgr = ShortcutManager.getInstance()
```

- [ ] **Step 5: 跑测试和构建**

Run:

```powershell
node --test "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts"
pnpm build
```

Expected:
- test PASS。
- build exit code `0`。

- [ ] **Step 6: 提交**

```powershell
git add "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts" "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue" "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\sanitizeForSave.test.ts"
git commit -m "fix: clean up storage resources on unmount"
```

---

### Task 3: 把 video 目录改为 Video，保持命名一致

**Files:**
- Rename: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\video` → `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video`
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\CustomNode.vue:7`

- [ ] **Step 1: 用两步 git mv 改大小写目录**

Run:

```powershell
git mv "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\video" "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video_tmp"
git mv "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video_tmp" "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video"
```

Expected: `git status --short` shows rename entries for the video files.

- [ ] **Step 2: 修改 CustomNode import**

Modify `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\CustomNode.vue` line 7 from:

```typescript
import { VideoNode, VideoTopToolbar, VideoBottomToolbar } from './nodes/video/index'
```

to:

```typescript
import { VideoNode, VideoTopToolbar, VideoBottomToolbar } from './nodes/Video/index'
```

- [ ] **Step 3: 验证没有旧路径引用**

Run:

```powershell
Select-String -Path "D:\Code\GitTest\canvas-ai\mini-canvas\src\**\*" -Pattern "nodes/video" -SimpleMatch
pnpm build
```

Expected:
- `Select-String` no matches。
- build exit code `0`。

- [ ] **Step 4: 提交**

```powershell
git add "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\CustomNode.vue" "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video"
git commit -m "chore: capitalize video node directory"
```

---

### Task 4: 给 ImageCropper 清理 emitTimer

**Files:**
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\image\ImageCropper.vue:1, 210-220`

- [ ] **Step 1: 修改 import**

Modify first import in `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\image\ImageCropper.vue` from:

```typescript
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue'
```

to:

```typescript
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
```

- [ ] **Step 2: 增加卸载清理**

After the current `onMounted` block:

```typescript
onMounted(() => {
  initCrop()
  nextTick(() => emitCrop())
})
```

add:

```typescript
onUnmounted(() => {
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
})
```

- [ ] **Step 3: 构建验证**

Run:

```powershell
pnpm build
```

Expected: build exit code `0`。

- [ ] **Step 4: 提交**

```powershell
git add "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\image\ImageCropper.vue"
git commit -m "fix: clear image crop timer on unmount"
```

---

### Task 5: 给 VideoNode 增加空地址和加载失败兜底

**Files:**
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video\VideoNode.vue:1-21`

- [ ] **Step 1: 修改脚本状态**

Replace script in `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video\VideoNode.vue` with:

```vue
<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, ref, watch } from 'vue'

const props = defineProps<NodeProps>()
const playing = ref(false)
const loadError = ref(false)
const videoUrl = computed(() => props.data?.videoUrl as string | undefined)
const videoLabel = computed(() => (props.data?.label as string | undefined) || '视频')

watch(videoUrl, () => {
  playing.value = false
  loadError.value = false
})

function startPlay() {
  if (!videoUrl.value) {
    loadError.value = true
    return
  }
  playing.value = true
}
</script>
```

- [ ] **Step 2: 修改模板**

Replace template in the same file with:

```vue
<template>
  <div class="w-full h-full flex items-center justify-center rounded-xl overflow-hidden bg-gray-900">
    <div v-if="loadError" class="flex flex-col items-center gap-2 px-4 text-center text-white/80">
      <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span class="text-sm">视频加载失败</span>
      <span class="text-xs text-white/50">{{ videoLabel }}</span>
    </div>

    <div v-else-if="!playing" class="flex flex-col items-center gap-2 cursor-pointer" @click="startPlay">
      <div class="w-16 h-16 rounded-full bg-white/80 flex items-center justify-center shadow-lg">
        <svg class="w-8 h-8 text-gray-800 ml-1" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
      </div>
      <span class="text-white text-sm">{{ videoLabel }}</span>
    </div>

    <video
      v-else
      :src="videoUrl"
      class="w-full h-full object-cover"
      controls
      autoplay
      @error="loadError = true; playing = false" />
  </div>
</template>
```

- [ ] **Step 3: 构建验证**

Run:

```powershell
pnpm build
```

Expected: build exit code `0`。

- [ ] **Step 4: 提交**

```powershell
git add "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\Video\VideoNode.vue"
git commit -m "fix: add video node fallback state"
```

---

### Task 6: 默认开启只渲染可见元素

**Files:**
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\useCanvasStore.ts:130`

- [ ] **Step 1: 修改默认值**

Modify `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\useCanvasStore.ts`:

```typescript
    onlyRenderVisibleElements: true,
```

This replaces:

```typescript
    onlyRenderVisibleElements: false,
```

- [ ] **Step 2: 构建验证**

Run:

```powershell
pnpm build
```

Expected: build exit code `0`。

- [ ] **Step 3: 人工冒烟检查**

Run:

```powershell
pnpm dev
```

Expected:
- 打开 Vite 地址。
- 新建、拖动、缩放节点正常。
- 画布外节点移入可视区后能显示。
- 连接线、工具栏、多选框基本正常。

Stop dev server after check.

- [ ] **Step 4: 提交**

```powershell
git add "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\useCanvasStore.ts"
git commit -m "perf: render only visible canvas elements by default"
```

---

### Task 7: 优化连线吸附，减少拖拽时反复扫 DOM

**Files:**
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:483-579, 629-675, 713-733, 843-874`

- [ ] **Step 1: 增加吸附缓存类型和状态**

In `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue`, after `function isTempEdge(...)` add:

```typescript
type SnapCandidate = {
  node: Node
  rect: DOMRect
  width: number
  height: number
  canBeSource: boolean
  canBeTarget: boolean
}

let snapCandidates: SnapCandidate[] = []

function refreshSnapCandidates() {
  const next: SnapCandidate[] = []
  const nodeEls = document.querySelectorAll('.vue-flow__node')

  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId) continue

    const node = nodesById.value.get(nodeId)
    if (!node || isTempNode(node)) continue

    const rect = getNodeCardRectFromNodeElement(el)
    const nodeSize = getNodeSize(node)
    next.push({
      node,
      rect,
      width: nodeSize.width,
      height: nodeSize.height,
      canBeSource: Boolean(node.sourcePosition),
      canBeTarget: Boolean(node.targetPosition),
    })
  }

  snapCandidates = next
}

function clearSnapCandidates() {
  snapCandidates = []
}
```

- [ ] **Step 2: 拖拽开始时刷新缓存，结束时清掉**

Modify `onConnectStart`:

```typescript
function onConnectStart(payload: ({ event?: MouseEvent | TouchEvent } & OnConnectStartParams)) {
  refreshSnapCandidates()
  canvas.connectionState.isConnecting = true
  canvas.connectionState.sourceNodeId = payload.nodeId || null
  canvas.connectionState.sourceHandle = payload.handleId || null
  canvas.connectionState.suppressHandles = true
  canvas.connectionState.hoverFeedbackNodeId = null
  canvas.connectionState.hoverFeedbackPoint = null
}
```

Modify `onConnectEnd` finally block so it includes:

```typescript
  } finally {
    clearSnapCandidates()
    canvas.connectionState.isConnecting = false
    canvas.connectionState.sourceNodeId = null
    canvas.connectionState.sourceHandle = null
    canvas.connectionState.suppressHandles = false
    canvas.connectionState.hoverFeedbackNodeId = null
    canvas.connectionState.hoverFeedbackPoint = null
  }
```

- [ ] **Step 3: 批量连线开始和结束也使用缓存**

Inside `onSelectionBatchConnectStart`, before creating temp node, add:

```typescript
  refreshSnapCandidates()
```

Inside `resetBatchConnectState`, before removing listeners or before resetting fields, add:

```typescript
  clearSnapCandidates()
```

The function should contain:

```typescript
function resetBatchConnectState() {
  clearSnapCandidates()
  batchConnectState.value = null
  canvas.connectionState.isConnecting = false
  canvas.connectionState.sourceNodeId = null
  canvas.connectionState.sourceHandle = null
  canvas.connectionState.suppressHandles = true
  canvas.connectionState.hoverFeedbackNodeId = null
  canvas.connectionState.hoverFeedbackPoint = null
  document.removeEventListener('mousemove', onBatchConnectMove)
  document.removeEventListener('mouseup', onBatchConnectEnd)
  window.removeEventListener('blur', cancelBatchConnect)
  document.removeEventListener('pointercancel', cancelBatchConnect)
}
```

- [ ] **Step 4: 改 findNearestValidTarget 使用缓存**

Replace body of `findNearestValidTarget` with:

```typescript
function findNearestValidTarget(clientX: number, clientY: number, sourceNodeIdOverride?: string, excludedNodeIdsOverride?: Iterable<string>) {
  const sourceNodeId = sourceNodeIdOverride || canvas.connectionState.sourceNodeId
  const sourceHandle = sourceNodeIdOverride ? 'source' : canvas.connectionState.sourceHandle
  if (!sourceNodeId || sourceHandle !== 'source') return null

  const excludedNodeIds = new Set(excludedNodeIdsOverride ?? [sourceNodeId])
  let bestNode: Node | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const snapHeight = canvas.state.handleRadius * canvas.state.connectionSnapHeightRatio
  const snapOuter = canvas.state.handleRadius * canvas.state.connectionSnapOuterRatio
  const snapInner = canvas.state.handleRadius * canvas.state.connectionSnapInnerRatio
  const candidates = snapCandidates.length > 0 ? snapCandidates : []

  for (const candidate of candidates) {
    const { node, rect, width } = candidate
    if (!candidate.canBeTarget || excludedNodeIds.has(node.id)) continue

    const zoomScale = width > 0 ? rect.width / width : 1
    const snapOuterInScreen = snapOuter * zoomScale
    const snapInnerInScreen = snapInner * zoomScale
    const snapHeightInScreen = snapHeight * zoomScale
    const centerY = rect.top + rect.height / 2
    const snapTop = centerY - snapHeightInScreen / 2
    const snapBottom = centerY + snapHeightInScreen / 2

    const insideSnapArea =
      clientX >= rect.left - snapOuterInScreen &&
      clientX <= rect.left + snapInnerInScreen &&
      clientY >= snapTop &&
      clientY <= snapBottom

    const insideBodyArea =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom

    if (!insideSnapArea && !insideBodyArea) continue

    const distance = Math.hypot(clientX - rect.left, clientY - centerY)
    if (distance < bestDistance) {
      bestNode = node
      bestDistance = distance
    }
  }

  return bestNode
}
```

- [ ] **Step 5: 改 findNearestValidSource 使用缓存**

Replace body of `findNearestValidSource` with:

```typescript
function findNearestValidSource(clientX: number, clientY: number, targetNodeIds: Set<string>) {
  let bestNode: Node | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const snapHeight = canvas.state.handleRadius * canvas.state.connectionSnapHeightRatio
  const snapOuter = canvas.state.handleRadius * canvas.state.connectionSnapOuterRatio
  const snapInner = canvas.state.handleRadius * canvas.state.connectionSnapInnerRatio
  const candidates = snapCandidates.length > 0 ? snapCandidates : []

  for (const candidate of candidates) {
    const { node, rect, width } = candidate
    if (!candidate.canBeSource || targetNodeIds.has(node.id)) continue

    const zoomScale = width > 0 ? rect.width / width : 1
    const snapOuterInScreen = snapOuter * zoomScale
    const snapInnerInScreen = snapInner * zoomScale
    const snapHeightInScreen = snapHeight * zoomScale
    const centerY = rect.top + rect.height / 2
    const snapTop = centerY - snapHeightInScreen / 2
    const snapBottom = centerY + snapHeightInScreen / 2

    const insideSnapArea =
      clientX >= rect.right - snapInnerInScreen &&
      clientX <= rect.right + snapOuterInScreen &&
      clientY >= snapTop &&
      clientY <= snapBottom

    const insideBodyArea =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom

    if (!insideSnapArea && !insideBodyArea) continue

    const distance = Math.hypot(clientX - rect.right, clientY - centerY)
    if (distance < bestDistance) {
      bestNode = node
      bestDistance = distance
    }
  }

  return bestNode
}
```

- [ ] **Step 6: 构建验证**

Run:

```powershell
pnpm build
```

Expected: build exit code `0`。

- [ ] **Step 7: 人工冒烟检查连线**

Run:

```powershell
pnpm dev
```

Expected:
- 单节点拖出连线，吸附目标节点正常。
- 拖到空白处弹出创建菜单正常。
- 多选后批量连线正常。
- 缩放后吸附区域仍然大致对齐。

Stop dev server after check.

- [ ] **Step 8: 提交**

```powershell
git add "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue"
git commit -m "perf: cache canvas snap candidates during connection drag"
```

---

### Task 8: 去掉明显高频和主题调试日志

**Files:**
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\ThemePlugin.ts:73-78, 133-151`
- Modify: `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\colorUtils.ts:236-251`

- [ ] **Step 1: 清理 ThemePlugin console.log**

In `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\ThemePlugin.ts`, replace `refreshTheme` with:

```typescript
function refreshTheme(store: PluginContext['store']): void {
  const st = readState(store)
  const vars = computeThemeVars(st.accent, st.surface)
  applyThemeToDOM(vars, st.customVariables)
}
```

Inside `api.applyPreset`, delete:

```typescript
console.log('[🎨 ThemePlugin] applyPreset called:', name)
```

Inside `api.applyCustom`, delete:

```typescript
console.log('[🎨 ThemePlugin] applyCustom called:', accent, surface)
```

- [ ] **Step 2: 清理 colorUtils console.log**

In `D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\colorUtils.ts`, replace `applyThemeToDOM` with:

```typescript
export function applyThemeToDOM(
  vars: ComputedVars,
  overrides?: Record<string, string>,
): void {
  const root = document.documentElement
  const merged = { ...vars, ...(overrides || {}) }

  for (const [name, value] of Object.entries(merged)) {
    root.style.setProperty(`--${name}`, value)
  }
}
```

- [ ] **Step 3: 构建验证**

Run:

```powershell
pnpm build
```

Expected: build exit code `0`。

- [ ] **Step 4: 提交**

```powershell
git add "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\ThemePlugin.ts" "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\colorUtils.ts"
git commit -m "chore: remove theme debug logs"
```

---

## Final Verification

- [ ] **Step 1: 运行所有已有 Node 测试**

Run:

```powershell
node --test "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\auto-layout\__tests__\*.test.ts"
node --test "D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\__tests__\*.test.ts"
```

Expected: all tests PASS。

- [ ] **Step 2: 运行生产构建**

Run:

```powershell
pnpm build
```

Expected: build exit code `0`。

- [ ] **Step 3: 查看 Git 状态**

Run:

```powershell
git status --short
```

Expected: clean working tree after all commits。

- [ ] **Step 4: 最终人工检查**

Run:

```powershell
pnpm dev
```

Expected:
- 画布能打开。
- 默认节点能显示。
- 新建 text/image/video/stage 节点正常。
- 图片上传和裁剪后保存不报错。
- 视频无地址或加载失败时显示兜底状态。
- 刷新后保存的节点仍然是 `type: custom`，并根据 `data.nodeType` 正常渲染。
- 连线、批量连线、多选框正常。

---

## Self-Review

**Spec coverage:**
- 数据正确性：Task 1。
- 内存释放：Task 2、Task 4、Task 5。
- 已知 video 目录命名：Task 3。
- 渲染/拖拽性能：Task 6、Task 7。
- 日志和维护性：Task 8。

**Placeholder scan:**
- 未发现占位写法。
- 每个代码步骤都给了具体代码或具体命令。

**Type consistency:**
- `sanitizeForSave(nodes: unknown[], edges: unknown[]): CanvasData` 被 `StoragePlugin` 直接调用，现有 `saveCanvas(nodes: any[], edges: any[])` 可兼容。
- 视频目录改名后统一使用 `./nodes/Video/index`。
- `setStorageApi(null)` 已由现有 `useStorage.ts` 支持。


