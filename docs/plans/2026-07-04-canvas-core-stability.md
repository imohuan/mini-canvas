# Canvas-Core Stability & Performance Hardening Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 P0 memory leak/bug/crash issues and 10 P1 performance bottlenecks identified in the comprehensive audit of the canvas-core package.

**Architecture:** Phase 1 fixes EventBus listener leaks and missing lifecycle cleanup in Image overlay components. Phase 2 rewrites the connection drag DOM query bottleneck from O(N×DOM) to O(N) pure-data computation. Phase 3 hardens the storage pipeline (beforeunload sanitization, RUNTIME_FIELDS completeness, race condition fix). Phase 4 adds safety net (error boundary), dead code removal, and algorithmic optimizations.

**Tech Stack:** Vue 3 + TypeScript + Pinia + VueFlow + Node test runner (node:test + assert)

---

## Audit Background

Four sub-agents independently reviewed the codebase after a CodeGraph-powered analysis. The full audit report identified 30+ issues across 6 severity tiers. This plan covers the **P0 (crash/data-loss)** and **P1 (perf bottleneck)** tiers — 16 fixes total.

---

### Task 1: Fix EventBus Listener Leaks in Canvas.vue

**Files:**
- Modify: `packages/canvas-core/src/Canvas.vue`

**Step 1: Extract inline arrow handlers to named functions**

In `<script setup>` top-level (before `onMounted`), add:

```typescript
// ====== EventBus cleanup helpers (extracted so .off() can reference them) ======
function onSelectionChange(payload: any) {
  canvasStore.setSelection({
    nodeIds: payload?.nodeIds || [],
    edgeIds: payload?.edgeIds || [],
  })
}

function onCanvasSetFlag(payload: any) {
  if (!payload || !payload.key) return
  if (payload.key === 'selectedNodeIds') {
    canvasStore.setSelectedNodeIds(payload.value || [])
    return
  }
  if (payload.key === 'selectedEdgeIds') {
    canvasStore.setSelectedEdgeIds(payload.value || [])
    return
  }
  const stateKey = payload.key as keyof typeof canvas.state
  if (stateKey in canvas.state) {
    ;(canvas.state as any)[stateKey] = payload.value
  }
}
```

**Step 2: Collect cleanup functions in `onMounted`**

In `onMounted`, replace the inline arrow functions with named functions and collect returned unsubscribers:

```typescript
const cleanupFns: Array<() => void> = []

onMounted(() => {
  // ... existing setup ...

  // EventBus listeners (collect for cleanup)
  cleanupFns.push(manager.eventBus.on('selection:change', onSelectionChange))
  cleanupFns.push(manager.eventBus.on('canvas:setFlag', onCanvasSetFlag))
  cleanupFns.push(manager.eventBus.on('storage:status', refreshStorageState))
  cleanupFns.push(manager.eventBus.on('storage:project-created', refreshStorageState))
  cleanupFns.push(manager.eventBus.on('storage:project-deleted', refreshStorageState))
  cleanupFns.push(manager.eventBus.on('storage:project-switched', refreshStorageState))
  cleanupFns.push(manager.eventBus.on('storage:connected', refreshStorageState))
  cleanupFns.push(manager.eventBus.on('storage:disconnected', refreshStorageState))
})
```

**Step 3: Add cleanup in `onUnmounted`**

At the end of `onUnmounted`:

```typescript
// Clean up EventBus listeners
for (const fn of cleanupFns) fn()
cleanupFns.length = 0
```

**Step 4: Run tests to verify no regression**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass, 0 fail

**Step 5: Commit**

```bash
git add packages/canvas-core/src/Canvas.vue
git commit -m "fix(canvas): clean up EventBus listeners in onUnmounted to prevent memory leaks"
```

---

### Task 2: Add onUnmounted Cleanup to ImageMasker

**Files:**
- Modify: `packages/canvas-core/src/nodes/image/ImageMasker.vue`

**Step 1: Track the current Image loading**

In `<script setup>`, add a module-level variable near other state:

```typescript
let currentImage: HTMLImageElement | null = null
```

**Step 2: Cancel previous Image on new load**

In `setupCanvases()`, before `const img = new Image()`:

```typescript
if (currentImage) {
  currentImage.onload = null
  currentImage.src = ''
  currentImage = null
}
const img = new Image()
currentImage = img
```

**Step 3: Add onUnmounted hook**

```typescript
onUnmounted(() => {
  // Disconnect ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  // Release canvas context reference
  drawCtx = null
  // Cancel pending image load
  if (currentImage) {
    currentImage.onload = null
    currentImage.src = ''
    currentImage = null
  }
  // Release pointer capture if active
  if (overlayRef.value) {
    try { overlayRef.value.releasePointerCapture?.(1) } catch { /* ignore */ }
  }
  // Clear draw canvas to release GPU memory
  const fg = drawCanvasRef.value
  if (fg) {
    const ctx = fg.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, fg.width, fg.height)
  }
})
```

**Step 4: Run tests to verify no regression**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass, 0 fail

**Step 5: Commit**

```bash
git add packages/canvas-core/src/nodes/image/ImageMasker.vue
git commit -m "fix(canvas): add onUnmounted cleanup to ImageMasker to prevent ResizeObserver leak"
```

---

### Task 3: Add onUnmounted Cleanup to ImageCropper

**Files:**
- Modify: `packages/canvas-core/src/nodes/image/ImageCropper.vue`
- Create: (none — the cropper code is inline, check exact file path)

**Step 1: Find the file**

Run: `ls packages/canvas-core/src/nodes/image/ImageCropper* 2>/dev/null`
If ImageCropper is inline in ImageNodePlugin.ts or ImageNode.vue, adjust accordingly.

**Step 2: Add equivalent onUnmounted cleanup**

Same pattern as ImageMasker: disconnect ResizeObserver, null canvas ctx, cancel pending Image loads.

**Step 3: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass

**Step 4: Commit**

```bash
git add packages/canvas-core/src/nodes/image/ImageCropper.vue
git commit -m "fix(canvas): add onUnmounted cleanup to ImageCropper"
```

---

### Task 4: Add onUnmounted Cleanup to ImageExpander

**Files:**
- Modify: `packages/canvas-core/src/nodes/image/ImageExpander.vue`

**Step 1-4: Same pattern as Task 2 and Task 3**

Add onUnmounted with ResizeObserver disconnect + pointer capture release + image load cancel.

```bash
git add packages/canvas-core/src/nodes/image/ImageExpander.vue
git commit -m "fix(canvas): add onUnmounted cleanup to ImageExpander"
```

---

### Task 5: Rewrite buildConnectionEdgeProps — Eliminate DOM Queries

**Files:**
- Modify: `packages/canvas-core/src/composables/useCanvasConnection.ts`

This is the **core performance fix**. Currently `buildConnectionEdgeProps` calls `getNodeCardFlowRect` for every node on every mousemove frame, which internally does `document.querySelectorAll('.vue-flow__node')` + `querySelector('.custom-node-card')` + `getBoundingClientRect()`. Replace this with pure data computation.

**Step 1: Write a pure-data replacement for `getNodeCardFlowRect`**

```typescript
/**
 * Get card rectangle from node data only — NO DOM queries.
 * Uses VueFlow's computedPosition for correct absolute positioning.
 */
function getNodeCardRect(node: Node): { x: number; y: number; width: number; height: number } {
  const anyNode = node as any
  const position = anyNode.computedPosition || node.position
  const size = getNodeSize(node)
  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  }
}
```

**Step 2: Merge connectableNodes and feedbackNodes into one pass**

In `buildConnectionEdgeProps`, replace lines ~698-717 (the two `.filter().map()` chains) with:

```typescript
// Single pass: compute card data for all live nodes once
const allCardData = liveNodes.map(node => {
  const rect = getNodeCardRect(node)
  return {
    node,
    size: { width: rect.width, height: rect.height },
    position: { x: rect.x, y: rect.y },
  }
})

// connectableNodes: nodes with the correct port
const connectableNodes = allCardData
  .filter(({ node }) => {
    if (node.id === sourceId) return false
    return isReverseConnection ? node.sourcePosition : node.targetPosition
  })
  .map(({ node, size, position }) => ({
    id: node.id,
    position,
    ...size,
  }))

// feedbackNodes: all non-temp nodes (reuse same data, no second DOM pass)
const feedbackNodes = allCardData
  .filter(({ node }) => node.id !== sourceId && !isTempNode(node))
  .map(({ node, size, position }) => ({
    id: node.id,
    position,
    ...size,
  }))
```

**Step 3: Remove the old `getNodeCardFlowRect` function (lines ~126-153) if no other callers**

Check: `grep -rn "getNodeCardFlowRect" packages/canvas-core/src/`
If only called from `buildConnectionEdgeProps`, delete it.

**Step 4: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass, 0 fail

**Step 5: Commit**

```bash
git add packages/canvas-core/src/composables/useCanvasConnection.ts
git commit -m "perf(canvas): replace DOM queries in buildConnectionEdgeProps with pure data computation"
```

---

### Task 6: Delete Dead Code — Canvas.vue nodesById

**Files:**
- Modify: `packages/canvas-core/src/Canvas.vue`

**Step 1: Remove the dead nodesById shallowRef + watch**

Delete lines 131-141 (the `nodesById` shallowRef and its watch). 
Verify it's truly unused: `grep -n "nodesById" packages/canvas-core/src/Canvas.vue` — should only appear at the definition and watch, not in template or any other function.

**Step 2: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass

**Step 3: Commit**

```bash
git add packages/canvas-core/src/Canvas.vue
git commit -m "chore(canvas): remove dead nodesById code from Canvas.vue"
```

---

### Task 7: Fix O(n) find in isValidConnection

**Files:**
- Modify: `packages/canvas-core/src/composables/useCanvasConnection.ts`

**Step 1: Replace `.find()` with `nodesById.value.get()`**

In `isValidConnection`, lines ~481-482:

```typescript
// Before:
const src = (getNodes.value as Node[]).find(n => n.id === canonical.source)
const tgt = (getNodes.value as Node[]).find(n => n.id === canonical.target)

// After:
const src = nodesById.value.get(canonical.source)
const tgt = nodesById.value.get(canonical.target)
```

**Step 2: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass

**Step 3: Commit**

```bash
git add packages/canvas-core/src/composables/useCanvasConnection.ts
git commit -m "perf(canvas): use O(1) nodesById.get() instead of O(n) find() in isValidConnection"
```

---

### Task 8: Optimize wouldCreateCycle to O(V+E)

**Files:**
- Modify: `packages/canvas-core/src/composables/useCanvasConnection.ts`

**Step 1: Rewrite with adjacency list BFS**

Replace the current nested-loop implementation (lines ~205-226) with:

```typescript
function wouldCreateCycle(sourceId: string, targetId: string, edges: Edge[]): boolean {
  if (sourceId === targetId) return true

  // Build adjacency list: O(E)
  const adj = new Map<string, string[]>()
  for (const edge of edges) {
    if (isTempEdge(edge)) continue
    const ep = getCanonicalEdgeEndpoints(edge)
    if (!ep) continue
    const list = adj.get(ep.source)
    if (list) list.push(ep.target)
    else adj.set(ep.source, [ep.target])
  }

  // BFS from targetId: O(V + E)
  const stack = [targetId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === sourceId) return true
    if (visited.has(current)) continue
    visited.add(current)
    const neighbors = adj.get(current)
    if (neighbors) {
      for (const n of neighbors) {
        if (!visited.has(n)) stack.push(n)
      }
    }
  }
  return false
}
```

**Step 2: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass

**Step 3: Commit**

```bash
git add packages/canvas-core/src/composables/useCanvasConnection.ts
git commit -m "perf(canvas): optimize wouldCreateCycle from O(V*E) to O(V+E) with adjacency list"
```

---

### Task 9: Fix RUNTIME_FIELDS — Add panoUrl and _editing

**Files:**
- Modify: `packages/canvas-core/src/plugins/storage/sanitizeForSave.ts`

**Step 1: Add missing fields to RUNTIME_FIELDS**

```typescript
// Before (line 1):
const RUNTIME_FIELDS = ['imageUrl', 'videoUrl', 'thumbUrl', 'maskUrl', 'leftImageUrl', 'rightImageUrl', '_overlay', '_cropRect', '_cropMode', '_expandRect', '_expandMode', '_maskMode', '_maskConfig'] as const

// After:
const RUNTIME_FIELDS = ['imageUrl', 'videoUrl', 'thumbUrl', 'maskUrl', 'panoUrl', 'leftImageUrl', 'rightImageUrl', '_overlay', '_cropRect', '_cropMode', '_expandRect', '_expandMode', '_maskMode', '_maskConfig', '_editing'] as const
```

**Step 2: Write a test for the new fields**

Create `packages/canvas-core/src/plugins/storage/__tests__/sanitizeForSave.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import { sanitizeForSave } from "../sanitizeForSave.ts"

test("sanitizeForSave removes panoUrl", () => {
  const nodes = [{ id: '1', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'panorama', panoUrl: 'blob:...', label: '360' } }]
  const result = sanitizeForSave(nodes, [])
  assert.equal((result.nodes[0].data as any).panoUrl, undefined)
  assert.equal((result.nodes[0].data as any).label, '360')
})

test("sanitizeForSave removes _editing", () => {
  const nodes = [{ id: '1', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'panorama', _editing: true, label: '360' } }]
  const result = sanitizeForSave(nodes, [])
  assert.equal((result.nodes[0].data as any)._editing, undefined)
})

test("sanitizeForSave removes leftImageUrl and rightImageUrl", () => {
  const nodes = [{ id: '1', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'image-compare', leftImageUrl: 'blob:...', rightImageUrl: 'blob:...' } }]
  const result = sanitizeForSave(nodes, [])
  assert.equal((result.nodes[0].data as any).leftImageUrl, undefined)
  assert.equal((result.nodes[0].data as any).rightImageUrl, undefined)
})
```

**Step 3: Run all tests**

Run: `node --import tsx --test packages/canvas-core/src/plugins/storage/__tests__/sanitizeForSave.test.ts packages/canvas-core/src/registry/**/*.test.ts`
Expected: 33 pass (30 original + 3 new)

**Step 4: Commit**

```bash
git add packages/canvas-core/src/plugins/storage/sanitizeForSave.ts packages/canvas-core/src/plugins/storage/__tests__/sanitizeForSave.test.ts
git commit -m "fix(storage): add panoUrl and _editing to RUNTIME_FIELDS to prevent blob URL persistence"
```

---

### Task 10: Fix beforeunload Bypassing sanitizeForSave

**Files:**
- Modify: `packages/canvas-core/src/plugins/auto-save/AutoSavePlugin.ts`

**Step 1: Import sanitizeForSave**

```typescript
import { sanitizeForSave } from '../storage/sanitizeForSave'
```

**Step 2: Replace direct serialization in handleBeforeUnload**

In `handleBeforeUnload`, replace:
```typescript
localStorage.setItem(`canvas-ai:project:${storage.currentProjectId}`, JSON.stringify({ nodes, edges }))
```

With:
```typescript
const cleaned = sanitizeForSave(nodes, edges)
localStorage.setItem(`canvas-ai:project:${storage.currentProjectId}`, JSON.stringify(cleaned))
```

**Step 3: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/**/*.test.ts`
Expected: all pass

**Step 4: Commit**

```bash
git add packages/canvas-core/src/plugins/auto-save/AutoSavePlugin.ts
git commit -m "fix(storage): use sanitizeForSave in beforeunload handler to prevent blob URL pollution"
```

---

### Task 11: Fix loadCanvas Defense Strip Alignment

**Files:**
- Modify: `packages/canvas-core/src/plugins/storage/StoragePlugin.ts`

**Step 1: Add missing fields to the loadCanvas strip loop**

In the `loadCanvas` function (~line 521-528), add:

```typescript
for (const node of cached.nodes) {
  if (node.data && typeof node.data === 'object') {
    delete node.data._overlay
    delete node.data._cropRect
    delete node.data._cropMode
    delete node.data._expandRect
    delete node.data._expandMode
    delete node.data._maskMode      // NEW: prevent masked mode residue
    delete node.data._maskConfig    // NEW: prevent mask config residue
    delete node.data._editing       // NEW: prevent editing mode residue
  }
}
```

**Step 2: Better: export RUNTIME_FIELDS from sanitizeForSave.ts and reuse**

```typescript
// sanitizeForSave.ts — add export:
export const RUNTIME_FIELD_SET = new Set(RUNTIME_FIELDS)

// StoragePlugin.ts — use the shared set:
import { RUNTIME_FIELD_SET } from './sanitizeForSave'

for (const node of cached.nodes) {
  if (node.data && typeof node.data === 'object') {
    for (const key of RUNTIME_FIELD_SET) {
      delete (node.data as any)[key]
    }
  }
}
```

**Step 3: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/**/*.test.ts`
Expected: all pass

**Step 4: Commit**

```bash
git add packages/canvas-core/src/plugins/storage/StoragePlugin.ts packages/canvas-core/src/plugins/storage/sanitizeForSave.ts
git commit -m "fix(storage): align loadCanvas defense strip with RUNTIME_FIELDS"
```

---

### Task 12: Fix performSave Race Condition

**Files:**
- Modify: `packages/canvas-core/src/plugins/auto-save/AutoSavePlugin.ts`

**Step 1: Re-check dirty flag after save completes**

In `performSave()`, add a `finally` block:

```typescript
async function performSave() {
  if (!dirty) return
  const storage = getStorageAPI()
  if (!storage || !storage.isConnected || !storage.currentProjectId) return

  try {
    const nodes = context.actions.getNodes()
    const edges = context.actions.getEdges()
    await storage.saveCanvas(nodes, edges)
    dirty = false
    context.emit('auto-save:saved', { time: Date.now(), nodeCount: nodes.length, edgeCount: edges.length })
  } catch (err) {
    context.logger.error('[AutoSave] Save failed:', err)
  } finally {
    // If new changes came in during async save, reschedule
    if (dirty) {
      saveTimer = setTimeout(performSave, interval)
    }
  }
}
```

**Step 2: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/**/*.test.ts`
Expected: all pass

**Step 3: Commit**

```bash
git add packages/canvas-core/src/plugins/auto-save/AutoSavePlugin.ts
git commit -m "fix(storage): prevent race condition where dirty flag is overwritten during async save"
```

---

### Task 13: Add Error Boundary to CustomNode

**Files:**
- Modify: `packages/canvas-core/src/components/CustomNode.vue`

**Step 1: Add onErrorCaptured to prevent one node crash from toppling the entire canvas**

```typescript
import { onErrorCaptured, ref } from 'vue'

const nodeError = ref<string | null>(null)

onErrorCaptured((err: Error, instance, info) => {
  console.error(`[CustomNode] Error in node ${props.id}:`, err, info)
  nodeError.value = err.message
  return false // prevent propagation to parent
})
```

**Step 2: Add a fallback template when error occurs**

```html
<template>
  <div v-if="nodeError" class="custom-node custom-node--error">
    <div class="error-indicator">⚠️ 节点渲染错误</div>
    <pre class="error-detail">{{ nodeError }}</pre>
  </div>
  <div v-else class="custom-node">
    <!-- existing template -->
  </div>
</template>
```

**Step 3: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass

**Step 4: Commit**

```bash
git add packages/canvas-core/src/components/CustomNode.vue
git commit -m "feat(canvas): add error boundary to CustomNode to prevent full-canvas crashes"
```

---

### Task 14: Add Command Handler try/catch Wrappers

**Files:**
- Modify: `packages/canvas-core/src/nodes/image/ImageNodePlugin.ts`

**Step 1: Wrap async command handlers with try/catch**

Wrap `handleImageCropConfirm`, `handleImageExpandConfirm`, `handleImageMaskConfirm` each with:

```typescript
async function handleImageCropConfirm(ctx: CommandContext) {
  try {
    // ... existing body ...
  } catch (err) {
    ctx.logger.error('Image crop confirm failed:', err)
    // Ensure UI state is restored
    const node = ctx.node as any
    if (node?.data?._overlay) {
      const data = { ...node.data }
      delete data._overlay
      // We need access to updateNode here — adjust ctx shape or use existing pattern
    }
  }
}
```

**Step 2: Run tests**

Run: `node --import tsx --test packages/canvas-core/src/registry/**/*.test.ts`
Expected: 30 pass

**Step 3: Commit**

```bash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts
git commit -m "fix(canvas): add try/catch wrappers to image command handlers"
```

---

### Task 15: Fix Duplicate removeEventListener in SelectionFrame

**Files:**
- Modify: `packages/canvas-core/src/plugins/multi-select/SelectionFrame.vue`

**Step 1: Remove the duplicate line**

In `onUnmounted`, remove the duplicate `removeEventListener('wheel', handleWheel)` call (line ~249-250).

**Step 2: Commit**

```bash
git add packages/canvas-core/src/plugins/multi-select/SelectionFrame.vue
git commit -m "chore(canvas): remove duplicate removeEventListener in SelectionFrame"
```

---

### Task 16: Final Verification — Full Test Suite

**Step 1: Run all tests**

```bash
node --import tsx --test packages/canvas-core/src/**/*.test.ts
```

Expected: all tests pass, including the new sanitizeForSave tests.

**Step 2: Manual verification checklist**

- [ ] Open the app, create 3 image nodes, connect them
- [ ] Enter crop mode → confirm → verify no crash
- [ ] Enter mask mode → draw → confirm → verify no crash
- [ ] Enter expand mode → confirm → verify no crash
- [ ] Drag connection between nodes → verify smooth at 50+ nodes
- [ ] Zoom in/out rapidly → verify no stutter
- [ ] Refresh page → verify no overlay/mask residue
- [ ] Close and reopen browser tab → verify data persists correctly

**Step 3: Commit if any final tweaks**

```bash
git commit -m "chore(canvas): final verification tweaks"
```

---

## Execution Summary

| Task | Category | Est. Time | Risk |
|------|----------|-----------|------|
| 1 | P0 EventBus leaks | 5 min | Low |
| 2-4 | P0 Image component leaks | 15 min | Low |
| 5 | P0 Perf — DOM query elimination | 20 min | Medium |
| 6 | P1 Dead code removal | 3 min | Low |
| 7 | P1 O(1) lookup fix | 3 min | Low |
| 8 | P1 Cycle detection optimize | 5 min | Low |
| 9 | P1 RUNTIME_FIELDS fix | 10 min | Low |
| 10-11 | P1 Storage hardening | 10 min | Medium |
| 12 | P1 Race condition fix | 5 min | Low |
| 13 | P2 Error boundary | 10 min | Low |
| 14 | P2 Command try/catch | 10 min | Low |
| 15 | P2 Duplicate code | 2 min | Low |
| 16 | Verification | 10 min | - |
| **Total** | | **~110 min** | |

All changes are in `packages/canvas-core/` only, no API breaks, backward compatible.
