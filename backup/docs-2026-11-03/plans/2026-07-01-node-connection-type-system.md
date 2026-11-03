# Node Connection Type System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a declarative type-based connection validation system to the canvas, restricting which node types can connect to which, and delete the unused stage node.

**Architecture:** Add `acceptsInputs?: string[]` field to `CanvasNodeDefinition` in `NodeRegistry`. The connection validation in `useCanvasConnection.ts` (`isValidConnection` + `getInvalidConnectionReason`) queries the registry to reject type-incompatible connections with a specific tooltip message. Each node plugin declares its accepted input types at registration time. The existing `invalid-connection-tooltip` in `BaseNode.vue:492-498` automatically displays the rejection reason.

**Tech Stack:** Vue 3 + Vue Flow + TypeScript, NodeRegistry pattern, node:test runner

---

## Connection Rules Matrix

| Target ↓ \ Source → | image | text | video | panorama | image-compare |
|---------------------|:-----:|:----:|:-----:|:--------:|:-------------:|
| **image** `['image','text']` | O | O | X | X | X |
| **text** (no input port) | - | - | - | - | - |
| **video** `['image','text','video']` | O | O | O | X | X |
| **panorama** `['image']` | O | X | X | X | X |
| **image-compare** `['image']` | O | X | X | X | X |

Key: O = allowed, X = blocked, - = no port

**Design principle:** Only `acceptsInputs` on the target is needed. Source output restrictions are implicitly enforced because other targets don't include that source type in their `acceptsInputs`. No `outputsTo` field required.

---

### Task 1: Add `acceptsInputs` to NodeRegistry

**Files:**
- Modify: `packages/canvas-core/src/registry/NodeRegistry.ts:11-33` (CanvasNodeDefinition interface)
- Modify: `packages/canvas-core/src/registry/NodeRegistry.ts:45-93` (NodeRegistry class)
- Test: `packages/canvas-core/src/registry/__tests__/NodeRegistry.test.ts`

**Step 1: Write the failing test**

Add to `packages/canvas-core/src/registry/__tests__/NodeRegistry.test.ts`:

```typescript
test("NodeRegistry acceptsInputs returns declared types", () => {
  const registry = new NodeRegistry()
  registry.register({
    type: "panorama",
    label: "360全景",
    defaultSize: { cardWidth: 640, cardHeight: 400 },
    menuItem: { label: "360全景" },
    acceptsInputs: ["image"],
  })
  assert.deepEqual(registry.getAcceptsInputs("panorama"), ["image"])
})

test("NodeRegistry acceptsInputs returns undefined when not declared", () => {
  const registry = new NodeRegistry()
  registry.register({
    type: "image",
    label: "图片",
    defaultSize: { cardWidth: 360, cardHeight: 270 },
    menuItem: { label: "图片" },
  })
  assert.equal(registry.getAcceptsInputs("image"), undefined)
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/canvas-core && npx tsx --test src/registry/__tests__/NodeRegistry.test.ts`
Expected: FAIL — `registry.getAcceptsInputs is not a function`

**Step 3: Write minimal implementation**

In `packages/canvas-core/src/registry/NodeRegistry.ts`:

1. Add to `CanvasNodeDefinition` interface (after `canProduceOutput?: boolean`):

```typescript
  /** 允许连接到本节点的输入源 nodeType 列表。
   *  undefined = 接受全部（向后兼容）
   *  [] = 不接受任何输入
   *  ['image'] = 只接受 image 节点 */
  acceptsInputs?: string[]
```

2. Add method to `NodeRegistry` class (after `canProduceOutput` method):

```typescript
  getAcceptsInputs(type: string): string[] | undefined {
    return this.definitions.get(type)?.acceptsInputs
  }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/canvas-core && npx tsx --test src/registry/__tests__/NodeRegistry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/canvas-core/src/registry/NodeRegistry.ts packages/canvas-core/src/registry/__tests__/NodeRegistry.test.ts
git commit -m "feat: add acceptsInputs field to NodeRegistry for type-based connection validation"
```

---

### Task 2: Wire NodeRegistry into useCanvasConnection

**Files:**
- Modify: `packages/canvas-core/src/composables/useCanvasConnection.ts:41-62` (UseCanvasConnectionOptions)
- Modify: `packages/canvas-core/src/composables/useCanvasConnection.ts:433-469` (getInvalidConnectionReason)
- Modify: `packages/canvas-core/src/composables/useCanvasConnection.ts:472-487` (isValidConnection)
- Modify: `packages/canvas-core/src/Canvas.vue:99-109` (pass getNodeDefinition option)

**Step 1: Add `getNodeDefinition` to options interface**

In `useCanvasConnection.ts`, add to `UseCanvasConnectionOptions` (after `eventBus?`):

```typescript
  /** 获取节点定义（用于连接类型校验）。返回 CanvasNodeDefinition 或 null */
  getNodeDefinition?: (type: string) => { acceptsInputs?: string[]; label?: string } | null
```

**Step 2: Add type check to `getInvalidConnectionReason`**

In `getInvalidConnectionReason()` function (after the port check at line 466, before `return ''`):

```typescript
    // 类型兼容性校验
    const srcType = (src.data as any)?.nodeType as string | undefined
    const tgtType = (tgt.data as any)?.nodeType as string | undefined
    if (srcType && tgtType && options.getNodeDefinition) {
      const tgtDef = options.getNodeDefinition(tgtType)
      if (tgtDef?.acceptsInputs && !tgtDef.acceptsInputs.includes(srcType)) {
        const tgtLabel = tgtDef.label ?? tgtType
        const srcLabel = options.getNodeDefinition(srcType)?.label ?? srcType
        return `${tgtLabel}不接受${srcLabel}输入`
      }
    }
```

**Step 3: Add type check to `isValidConnection`**

In `isValidConnection()` function (after the port check at line 484, before `return true`):

```typescript
    // 类型兼容性校验
    const srcType = (src.data as any)?.nodeType as string | undefined
    const tgtType = (tgt.data as any)?.nodeType as string | undefined
    if (srcType && tgtType && options.getNodeDefinition) {
      const tgtDef = options.getNodeDefinition(tgtType)
      if (tgtDef?.acceptsInputs && !tgtDef.acceptsInputs.includes(srcType)) {
        return false
      }
    }
```

**Step 4: Pass `getNodeDefinition` from Canvas.vue**

In `Canvas.vue`, add to the `useCanvasConnection({...})` call (after `eventBus`):

```typescript
  getNodeDefinition: (type: string) => nodeRegistry.get(type),
```

Note: `nodeRegistry` is declared at `Canvas.vue:330` as `const nodeRegistry = new NodeRegistry()`. The closure captures the binding — it is only called during user interaction (long after setup completes), so the temporal dead zone is not an issue.

**Step 5: Verify build**

Run: `cd packages/canvas-core && npx vue-tsc --noEmit && npx vite build`
Expected: No type errors

**Step 6: Commit**

```bash
git add packages/canvas-core/src/composables/useCanvasConnection.ts packages/canvas-core/src/Canvas.vue
git commit -m "feat: add type-based connection validation in useCanvasConnection"
```

---

### Task 3: Declare `acceptsInputs` on each node plugin

**Files:**
- Modify: `packages/canvas-core/src/nodes/image/ImageNodePlugin.ts:624-632`
- Modify: `packages/canvas-core/src/nodes/Video/VideoNodePlugin.ts:23-29`
- Modify: `packages/canvas-core/src/nodes/panorama/PanoramaNodePlugin.ts:175-181`
- Modify: `packages/canvas-core/src/nodes/image-compare/ImageCompareNodePlugin.ts:16-31`
- Modify: `packages/canvas-core/src/nodes/text/TextNodePlugin.ts:26-32`

**Step 1: image node — add `acceptsInputs: ['image', 'text']`**

In `ImageNodePlugin.ts`, the `context.canvasNodes.register({...})` call, add:

```typescript
    context.canvasNodes.register({
      type: 'image', node: markRaw(ImageNode), label: '图片',
      defaultSize: { cardWidth: 360, cardHeight: 270 },
      menuItem: { label: '图片', description: '创建图片节点', icon: menuIconSvg },
      canReceiveInput: true,
      canProduceOutput: true,
      acceptsInputs: ['image', 'text'],
      resizable: false,
      selfRender: true,
    })
```

**Step 2: video node — add `acceptsInputs: ['image', 'text', 'video']`**

In `VideoNodePlugin.ts`:

```typescript
    context.canvasNodes.register({
      type: 'video', node: markRaw(VideoNode), label: '视频',
      defaultSize: { cardWidth: 480, cardHeight: 320 },
      menuItem: { label: '视频', description: '创建视频节点', icon: menuIconSvg },
      canReceiveInput: true,
      acceptsInputs: ['image', 'text', 'video'],
      resizable: false,
      titleIcon: titleIconSvg,
    })
```

**Step 3: panorama node — add `acceptsInputs: ['image']`, set `canProduceOutput: false`**

In `PanoramaNodePlugin.ts`:

```typescript
    context.canvasNodes.register({
      type: "panorama", node: markRaw(PanoramaNode), label: "360全景",
      defaultSize: { cardWidth: 640, cardHeight: 400 },
      menuItem: { label: "360全景", description: "创建360全景图片查看节点", icon: menuIconSvg, badge: "VR" },
      canReceiveInput: true,
      canProduceOutput: false,
      acceptsInputs: ["image"],
      titleIcon: titleIconSvg,
    })
```

**Step 4: image-compare node — add `acceptsInputs: ['image']`**

In `ImageCompareNodePlugin.ts`:

```typescript
    context.canvasNodes.register({
      type: 'image-compare',
      node: markRaw(ImageCompareNode),
      label: '图片对比',
      defaultSize: { cardWidth: 500, cardHeight: 350 },
      menuItem: {
        label: '图片对比',
        description: '创建图片对比节点，连接2个图片节点并排对比',
        icon: menuIconSvg,
        badge: 'Compare',
      },
      canReceiveInput: true,
      canProduceOutput: false,
      acceptsInputs: ['image'],
      resizable: false,
      titleIcon: titleIconSvg,
    })
```

**Step 5: text node — no change needed**

text already has `canReceiveInput: false` (no input port). No `acceptsInputs` needed — the port check in `isValidConnection` already blocks all connections to text.

**Step 6: Verify build**

Run: `cd packages/canvas-core && npx vue-tsc --noEmit && npx vite build`
Expected: No type errors

**Step 7: Commit**

```bash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts packages/canvas-core/src/nodes/Video/VideoNodePlugin.ts packages/canvas-core/src/nodes/panorama/PanoramaNodePlugin.ts packages/canvas-core/src/nodes/image-compare/ImageCompareNodePlugin.ts
git commit -m "feat: declare acceptsInputs on all node plugins"
```

---

### Task 4: Delete stage node

**Files:**
- Delete: `packages/canvas-core/src/nodes/stage/` (entire directory: StageNode.vue, index.ts, StageNodePlugin.ts)
- Modify: `packages/canvas-core/src/index.ts:13` (remove export)
- Modify: `packages/canvas-core/src/types/CanvasNodeData.ts:1,73-76,95` (remove StageNodeData)
- Modify: `src/views/CanvasView.vue:8,61-67` (remove import and plugin slot)
- Modify: `packages/canvas-core/src/registry/__tests__/NodeRegistry.test.ts:29-32` (replace stage with panorama in test)
- Modify: `packages/canvas-core/src/plugins/storage/__tests__/sanitizeForSave.test.ts:46` (change nodeType from 'stage' to 'image')

**Step 1: Delete stage directory**

```bash
rm -rf packages/canvas-core/src/nodes/stage/
```

**Step 2: Remove export from index.ts**

In `packages/canvas-core/src/index.ts`, delete line 13:

```typescript
export { StageNodePlugin } from './nodes/stage/StageNodePlugin'
```

**Step 3: Remove StageNodeData from types**

In `packages/canvas-core/src/types/CanvasNodeData.ts`:

1. Line 1 — remove `'stage'` from `CanvasNodeKind`:
```typescript
export type CanvasNodeKind = 'text' | 'image' | 'video' | 'panorama' | (string & {})
```

2. Delete lines 73-76 (StageNodeData interface):
```typescript
export interface StageNodeData extends BaseCanvasNodeData {
  nodeType: 'stage'
  values?: Record<string, unknown>
}
```

3. Line 95 (now adjusted) — remove `StageNodeData` from CanvasNodeData union:
```typescript
export type CanvasNodeData = TextNodeData | ImageNodeData | VideoNodeData | PanoramaNodeData | ImageCompareNodeData | BaseCanvasNodeData
```

**Step 4: Remove from CanvasView.vue**

In `src/views/CanvasView.vue`:

1. Remove import (line 8):
```typescript
  StageNodePlugin,
```

2. Remove plugin slot (lines 61-67):
```typescript
  {
    plugin: markRaw(StageNodePlugin) as CanvasPlugin,
    enabled: true,
    label: '导演台节点',
    description: '注册导演台节点到 NodeRegistry',
    usage: '内置节点类型，自动注册',
  },
```

**Step 5: Fix test references to stage**

In `packages/canvas-core/src/registry/__tests__/NodeRegistry.test.ts`, replace the stage registration with panorama:

```typescript
test("NodeRegistry menu items are derived from registered nodes", () => {
  const registry = new NodeRegistry()
  registry.register({ type: "text", label: "文本", defaultSize: { cardWidth: 300, cardHeight: 320 }, menuItem: { label: "文本", description: "创建文本节点", icon: "text" } })
  registry.register({ type: "panorama", label: "360全景", defaultSize: { cardWidth: 640, cardHeight: 400 }, menuItem: { label: "360全景", description: "创建360全景图片查看节点", icon: "pano", badge: "VR" } })

  assert.deepEqual(registry.getMenuItems().map(item => item.id), ["text", "panorama"])
  assert.equal(registry.getMenuItems()[1].badge, "VR")
})
```

In `packages/canvas-core/src/plugins/storage/__tests__/sanitizeForSave.test.ts` line 46, change `'stage'` to `'image'`:

```typescript
  const nodes = [{ id: '1', type: 'custom', data: { nodeType: 'image', values: { a: { _url: 'blob:...', name: 'x' }, b: { name: 'y' } } } }]
```

**Step 6: Verify build and tests**

Run: `cd packages/canvas-core && npx vue-tsc --noEmit && npx vite build`
Expected: No type errors

Run: `cd packages/canvas-core && npx tsx --test src/registry/__tests__/NodeRegistry.test.ts src/plugins/storage/__tests__/sanitizeForSave.test.ts`
Expected: All tests pass

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: delete unused stage node and remove all references"
```

---

### Task 5: Manual verification

**Step 1: Start dev server**

Run: `cd D:/Code/GitTest/canvas-ai/mini-canvas && pnpm dev`

**Step 2: Test valid connections (should succeed)**

- Drag from image source handle → image target handle: connection created
- Drag from image source handle → video target handle: connection created
- Drag from image source handle → panorama target handle: connection created
- Drag from image source handle → image-compare target handle: connection created
- Drag from text source handle → image target handle: connection created
- Drag from text source handle → video target handle: connection created
- Drag from video source handle → video target handle: connection created (chaining)

**Step 3: Test invalid connections (should show tooltip, no connection created)**

- Drag from text → panorama: tooltip shows "360全景不接受文本输入"
- Drag from text → image-compare: tooltip shows "图片对比不接受文本输入"
- Drag from video → image: tooltip shows "图片不接受视频输入"
- Drag from video → panorama: tooltip shows "360全景不接受视频输入"
- Drag from video → image-compare: tooltip shows "图片对比不接受视频输入"

**Step 4: Verify stage node is gone**

- Right-click canvas → menu should NOT show "导演台" option
- No TypeScript errors in build

**Step 5: Commit final state if any fixes needed**

```bash
git add -A
git commit -m "fix: verification adjustments"
```
