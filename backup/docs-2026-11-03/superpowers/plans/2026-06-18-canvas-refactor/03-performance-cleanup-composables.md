# Plan 3: 性能优化与收尾 — 移除重复保存 + Canvas/Pannel 拆分 + useStorage 退场

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Canvas.vue` 从“上帝组件”降级为画布壳子；移除 `canvas-data` 这条重复保存链路；让图片/拖拽组件不再绕过插件系统；补上几个明确的性能和内存泄漏修复。

**Architecture:** 保存只走 `AutoSavePlugin -> StoragePlugin.saveCanvas()`。Canvas 初始化只负责从 StoragePlugin 加载当前项目或创建默认节点。大段逻辑搬到 composables，Pannel 按 tab 拆分。资产 URL 统一由 `StoragePlugin.assets` 的 `AssetManager` 管。

**Tech Stack:** Vue 3 + TypeScript, VueFlow, Pinia, pnpm。

---

## 复查后必须修正的点

原计划把 `Canvas.vue` 的 `canvas-data` 保存逻辑抽成 `useCanvasPersistence`，这会把“双保存”问题固化下来。现在改成：

- 删除 `Canvas.vue` 直接写 `localStorage('canvas-data')` 的逻辑。
- 初始化从 `StoragePlugin` 当前项目加载；没有数据时创建默认节点。
- 保存交给 `AutoSavePlugin + StoragePlugin`。
- 图片上传和文件拖拽的 object URL 由 `AssetManager` 管。
- 插件内拿 storage 一律用 `context.getPluginAPI()`。

---

## 文件结构

新建：
- `src/canvas/core/composables/useCanvasBootstrap.ts`
- `src/canvas/core/composables/useCanvasConnection.ts`
- `src/canvas/core/composables/useCanvasPanelState.ts`
- `src/canvas/core/composables/useCanvasShortcuts.ts`
- `src/canvas/core/components/panel/PanelTabGeneral.vue`
- `src/canvas/core/components/panel/PanelTabTheme.vue`
- `src/canvas/core/components/panel/PanelTabStorage.vue`
- `src/canvas/core/components/panel/PanelTabLayout.vue`

修改：
- `src/canvas/core/Canvas.vue`
- `src/canvas/core/Pannel.vue`
- `src/canvas/core/useCanvasStore.ts`
- `src/canvas/core/plugins/auto-save/AutoSavePlugin.ts`
- `src/canvas/core/components/nodes/image/ImageTopToolbar.vue`
- `src/canvas/core/plugins/file-drop/FileDropPlugin.ts`
- `src/canvas/core/components/nodes/image/ImageCropper.vue`
- `src/canvas/core/components/nodes/Video/VideoNode.vue`
- `src/canvas/core/components/Decoration/BaseNode.vue`
- `src/canvas/core/plugins/multi-select/SelectionFrame.vue`
- `src/canvas/core/hooks/useStorage.ts`
- `src/canvas/core/plugins/theme/ThemePlugin.ts`
- `src/canvas/core/plugins/theme/colorUtils.ts`

---

### Task 1: 删除 Canvas.vue 的重复 localStorage 保存链路

**Files:**
- Create: `src/canvas/core/composables/useCanvasBootstrap.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 写 useCanvasBootstrap**

Create `src/canvas/core/composables/useCanvasBootstrap.ts`:

```typescript
import { nextTick } from 'vue'
import { Position } from '@vue-flow/core'
import type { Edge, Node } from '@vue-flow/core'
import type { StorageAPI } from '../plugins/storage/StoragePlugin'

export function createDefaultCanvasData(edgeData: Record<string, unknown>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: '1', type: 'custom', position: { x: 200, y: 260 }, data: { label: '输入图像', nodeType: 'image' }, sourcePosition: Position.Right },
    { id: '2', type: 'custom', position: { x: 700, y: 260 }, data: { label: '生成图像', nodeType: 'image' }, sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: '3', type: 'custom', position: { x: 1200, y: 260 }, data: { label: '生成图像', nodeType: 'image' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  ]

  const edges: Edge[] = [
    { id: 'e1-2', type: 'custom', source: '1', target: '2', sourceHandle: 'source', targetHandle: 'target', data: edgeData },
  ]

  return { nodes, edges }
}

export function useCanvasBootstrap(vueFlowInstance: any, getStorageApi: () => StorageAPI | null, makeEdgeData: () => Record<string, unknown>) {
  async function loadInitialCanvas() {
    const storage = getStorageApi()
    const currentProjectId = storage?.currentProjectId

    if (storage && currentProjectId) {
      const data = await storage.loadCanvas(currentProjectId)
      if (data.nodes.length > 0 || data.edges.length > 0) {
        vueFlowInstance.fromObject({ nodes: data.nodes, edges: data.edges })
        await nextTick()
        return
      }
    }

    const fallback = createDefaultCanvasData(makeEdgeData())
    vueFlowInstance.addNodes(fallback.nodes)
    vueFlowInstance.addEdges(fallback.edges)
    await nextTick()
  }

  return { loadInitialCanvas }
}
```

- [ ] **Step 2: Canvas.vue 删除旧保存逻辑**

Delete from `Canvas.vue`:

- `LS_KEY`
- `persistReady`
- `defaultNodes`
- `defaultEdges`
- `initCanvasData()`
- `safeLocalStorageSet()`
- `saveTimer`
- `persistCanvas()`
- `scheduleSave()`
- `onPersistenceEvent()`
- `handleBeforeUnload()`
- `manager.eventBus.on('nodesChange', onPersistenceEvent)` 等持久化监听
- `window.addEventListener('beforeunload', handleBeforeUnload)`
- `window.removeEventListener('beforeunload', handleBeforeUnload)`

Add:

```typescript
import { useCanvasBootstrap } from './composables/useCanvasBootstrap'
```

Near runtime setup:

```typescript
const bootstrap = useCanvasBootstrap(
  vueFlowInstance,
  () => manager.getPluginAPI<StorageAPI>('storage'),
  makeEdgeData,
)
```

Replace `initCanvasData()` calls with:

```typescript
await bootstrap.loadInitialCanvas()
```

- [ ] **Step 3: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/composables/useCanvasBootstrap.ts src/canvas/core/Canvas.vue
git commit -m "refactor: remove duplicate canvas-data persistence and bootstrap from storage"
```

---

### Task 2: 修正 AutoSavePlugin 的关闭页保存策略

**Files:**
- Modify: `src/canvas/core/plugins/auto-save/AutoSavePlugin.ts`

- [ ] **Step 1: 加 visibilitychange flush**

Add:

```typescript
function flushBeforePageHide() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!dirty) return
  void performSave()
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') flushBeforePageHide()
}
```

Replace `handleBeforeUnload()` with:

```typescript
function handleBeforeUnload() {
  // 这里不要承诺文件系统异步写入一定完成；只尽量触发保存。
  flushBeforePageHide()
}
```

Add listener:

```typescript
document.addEventListener('visibilitychange', handleVisibilityChange)
```

Uninstall:

```typescript
document.removeEventListener('visibilitychange', handleVisibilityChange)
```

- [ ] **Step 2: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins/auto-save/AutoSavePlugin.ts
git commit -m "fix: flush autosave on visibility change"
```

---

### Task 3: 提取 useCanvasConnection，并缓存拖线时的 DOM 矩形

**Files:**
- Create: `src/canvas/core/composables/useCanvasConnection.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 先搬连接相关函数**

Move these from `Canvas.vue` into `useCanvasConnection.ts`:

- `getMousePoint`
- `getNodeIdFromElement`
- `getNodeCardRectFromNodeElement`
- `isTempNode`
- `isTempEdge`
- `findNearestValidTarget`
- `findNearestValidSource`
- `createTempConnectionMenu`
- `onConnectStart`
- `onConnectEnd`
- `onSelectionBatchConnectStart`
- `onBatchConnectMove`
- `onBatchConnectEnd`
- `cancelBatchConnect`
- `resetBatchConnectState`
- `buildConnectionEdgeProps`
- `getNodeSize`
- `getNodeCardFlowRect`

Composable signature:

```typescript
export function useCanvasConnection(options: {
  canvas: ReturnType<typeof useCanvasStore>
  vueFlowInstance: any
  getNodes: any
  getEdges: any
  nodesById: any
  createConnection: (connection: Connection, source?: string) => boolean
  openMenu: (next: Omit<CanvasMenuState, 'visible'>, context?: any) => void
  menuContext: Ref<any>
  makeEdgeData: () => Record<string, unknown>
  resolveConnectionMenuItems: (args: { sourceNodeId: string; flowPosition: { x: number; y: number } }) => CanvasMenuItem[]
})
```

- [ ] **Step 2: 加 rect 缓存**

Inside composable:

```typescript
type CachedNodeRect = { nodeId: string; rect: DOMRect }
let cachedNodeRects: CachedNodeRect[] = []
let rafId: number | null = null

function rebuildNodeRectCache(excludedNodeIds: Set<string>) {
  cachedNodeRects = []
  const nodeEls = document.querySelectorAll('.vue-flow__node')
  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || excludedNodeIds.has(nodeId)) continue
    cachedNodeRects.push({ nodeId, rect: getNodeCardRectFromNodeElement(el) })
  }
}

function clearNodeRectCache() {
  cachedNodeRects = []
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}
```

- `onConnectStart` rebuild cache。
- `onConnectEnd` / `cancelBatchConnect` clear cache。
- `findNearestValidTarget` / `findNearestValidSource` read cache，不再每次 `querySelectorAll()`。
- `onBatchConnectMove` expensive update 用 `requestAnimationFrame` 合并。

- [ ] **Step 3: Canvas.vue 使用 composable**

Use:

```typescript
const connection = useCanvasConnection({
  canvas,
  vueFlowInstance,
  getNodes,
  getEdges,
  nodesById,
  createConnection,
  openMenu,
  menuContext,
  makeEdgeData,
  resolveConnectionMenuItems: ({ sourceNodeId, flowPosition }) => resolveMenuItems({ mode: 'connection', sourceNodeId, flowPosition }, menuRegistry, nodeRegistry),
})
```

Template handlers use `connection.onConnectStart` etc.

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/composables/useCanvasConnection.ts src/canvas/core/Canvas.vue
git commit -m "perf: extract connection logic and cache node rects during drag"
```

---

### Task 4: 提取 panel state 和 shortcuts

**Files:**
- Create: `src/canvas/core/composables/useCanvasPanelState.ts`
- Create: `src/canvas/core/composables/useCanvasShortcuts.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: useCanvasPanelState**

Move storage/theme/layout state and handlers from `Canvas.vue` into `useCanvasPanelState.ts`.

Signature:

```typescript
export function useCanvasPanelState(options: {
  canvas: ReturnType<typeof useCanvasStore>
  manager: PluginManager
  vueFlowInstance: any
  getNodes: any
  getEdges: any
})
```

Return all state and handlers used by template.

- [ ] **Step 2: useCanvasShortcuts**

Move:

- `toVueFlowKey`
- `syncVueFlowKeymap`
- VueFlow system shortcut registration
- shortcut keymap load/export/watch

Signature:

```typescript
export function useCanvasShortcuts(options: { canvas: ReturnType<typeof useCanvasStore>; vueFlowInstance: any })
```

Return:

```typescript
{ installVueFlowShortcutBridge, persistShortcutKeymap, syncVueFlowKeymap }
```

- [ ] **Step 3: Canvas.vue 替换为 composable 调用**

Template uses `panelState.storageState`, `panelState.themeState`, `panelState.layoutState` etc.

Unmount calls:

```typescript
shortcuts.persistShortcutKeymap()
```

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/composables/useCanvasPanelState.ts src/canvas/core/composables/useCanvasShortcuts.ts src/canvas/core/Canvas.vue
git commit -m "refactor: extract panel state and shortcuts from Canvas.vue"
```

---

### Task 5: Pannel.vue 按 tab 拆分

**Files:**
- Create: `src/canvas/core/components/panel/PanelTabGeneral.vue`
- Create: `src/canvas/core/components/panel/PanelTabTheme.vue`
- Create: `src/canvas/core/components/panel/PanelTabStorage.vue`
- Create: `src/canvas/core/components/panel/PanelTabLayout.vue`
- Modify: `src/canvas/core/Pannel.vue`

- [ ] **Step 1: General tab**

Move current `activeTab === 'general'` block into `PanelTabGeneral.vue`.

- [ ] **Step 2: Theme tab**

Move current theme block into `PanelTabTheme.vue`.

- [ ] **Step 3: Storage tab**

Move current storage block into `PanelTabStorage.vue`.

- [ ] **Step 4: Layout tab**

Move current layout block into `PanelTabLayout.vue`.

- [ ] **Step 5: Pannel.vue 只保留壳子**

Keep collapsed state、active tab、tab header and event forwarding.

- [ ] **Step 6: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/components/panel src/canvas/core/Pannel.vue
git commit -m "refactor: split Pannel tabs into focused components"
```

---

### Task 6: 移除 useStorage 单例依赖，并统一资产 URL 生命周期

**Files:**
- Modify: `src/canvas/core/components/nodes/image/ImageTopToolbar.vue`
- Modify: `src/canvas/core/plugins/file-drop/FileDropPlugin.ts`
- Modify: `src/canvas/core/Canvas.vue`
- Modify: `src/canvas/core/hooks/useStorage.ts`

- [ ] **Step 1: ImageTopToolbar 改用 usePluginApi**

Replace `getAssetManager` import with:

```typescript
import { usePluginApi } from '../../../runtime/usePluginApi'
import type { StorageAPI } from '../../../plugins/storage/StoragePlugin'
```

Use:

```typescript
const storage = usePluginApi<StorageAPI>('storage')
const assetManager = storage?.assets ?? null
```

When uploading:

```typescript
let imageUrl = ''
let assetId: string | undefined
if (assetManager) {
  assetId = await assetManager.saveAsset(file, file.name, file.type)
  imageUrl = assetManager.setObjectURL(assetId, file)
} else {
  imageUrl = URL.createObjectURL(file) // fallback only
}
```

- [ ] **Step 2: FileDropPlugin 改用 context.getPluginAPI**

Inside install:

```typescript
function getAssetManager() {
  return context.getPluginAPI<StorageAPI>('storage')?.assets ?? null
}
```

When possible, use `assetManager.setObjectURL(assetId, file)` instead of unmanaged `URL.createObjectURL(file)`.

- [ ] **Step 3: Canvas.vue 删除 setStorageApi/provide 后门**

Remove `setStorageApi` import, `canvasStorageApi` ref, `provide('canvasStorageApi', ...)`, and assignment to `setStorageApi(storageApi)`.

- [ ] **Step 4: useStorage.ts 标记 deprecated**

Add file comment:

```typescript
/**
 * @deprecated 旧兼容层。新代码请用：
 * - 组件：usePluginApi<StorageAPI>('storage')
 * - 插件：context.getPluginAPI<StorageAPI>('storage')
 */
```

- [ ] **Step 5: 搜索确认**

```powershell
Select-String -Path 'src\canvas\core\**\*.ts','src\canvas\core\**\*.vue' -Pattern 'getAssetManager|getStorageApi|setStorageApi' -SimpleMatch
```

Expected: only `hooks/useStorage.ts` definitions remain。

- [ ] **Step 6: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/components/nodes/image/ImageTopToolbar.vue src/canvas/core/plugins/file-drop/FileDropPlugin.ts src/canvas/core/Canvas.vue src/canvas/core/hooks/useStorage.ts
git commit -m "refactor: replace storage singleton with runtime plugin API"
```

---

### Task 7: 性能和小泄漏修复

**Files:**
- Modify: `src/canvas/core/useCanvasStore.ts`
- Modify: `src/canvas/core/components/Decoration/BaseNode.vue`
- Modify: `src/canvas/core/plugins/multi-select/SelectionFrame.vue`
- Modify: `src/canvas/core/components/nodes/image/ImageCropper.vue`
- Modify: `src/canvas/core/components/nodes/Video/VideoNode.vue`
- Modify: `src/canvas/core/plugins/theme/ThemePlugin.ts`
- Modify: `src/canvas/core/plugins/theme/colorUtils.ts`

- [ ] **Step 1: 默认开启 onlyRenderVisibleElements**

`useCanvasStore.ts`:

```typescript
onlyRenderVisibleElements: true,
```

- [ ] **Step 2: BaseNode 鼠标移动只在需要时更新**

```typescript
function updateCardMousePosition(event: MouseEvent) {
  if (!showConnectFeedback.value && !debugHandle.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  mousePosition.value = {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  }
}
```

- [ ] **Step 3: SelectionFrame 拖拽批量更新按帧合并**

Use one `requestAnimationFrame` for mousemove updates and cancel it on mouseup/unmount.

- [ ] **Step 4: ImageCropper 清理 emitTimer**

Import `onUnmounted` and add cleanup for `emitTimer`.

- [ ] **Step 5: VideoNode 空地址和加载失败兜底**

Add no-url and error state. `<video>` must have `@error="loadError = true"`.

- [ ] **Step 6: 清主题调试日志**

Remove noisy `console.log` from `ThemePlugin.ts` and `colorUtils.ts`。

- [ ] **Step 7: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/useCanvasStore.ts src/canvas/core/components/Decoration/BaseNode.vue src/canvas/core/plugins/multi-select/SelectionFrame.vue src/canvas/core/components/nodes/image/ImageCropper.vue src/canvas/core/components/nodes/Video/VideoNode.vue src/canvas/core/plugins/theme/ThemePlugin.ts src/canvas/core/plugins/theme/colorUtils.ts
git commit -m "perf: reduce high-frequency updates and fix media cleanup edge cases"
```

---

### Task 8: 最终验证

```powershell
node --test src\canvas\core\plugins\auto-layout\__tests__\*.test.ts
node --test src\canvas\core\plugins\storage\__tests__\*.test.ts
node --test src\canvas\core\registry\__tests__\*.test.ts
pnpm build
pnpm dev
```

手动检查：

- 刷新后数据来自 StoragePlugin 项目，不再依赖 `canvas-data`。
- 创建、删除、连线、拖动后自动保存正常。
- 图片上传、裁剪、刷新恢复正常。
- 文件拖入图片/视频后 URL 由 AssetManager 管理。
- Pannel 四个 tab 正常。
- 右键菜单、Ctrl+F、自动布局、快捷键帮助都正常。

---

## 完成标准

- [ ] `Canvas.vue` 不再包含 `LS_KEY = 'canvas-data'`。
- [ ] 保存链路只剩 `AutoSavePlugin -> StoragePlugin.saveCanvas()`。
- [ ] `getAssetManager/getStorageApi/setStorageApi` 不再被业务代码调用。
- [ ] `Canvas.vue` 明显瘦身。
- [ ] `Pannel.vue` 只保留 tab 壳子。
- [ ] 构建通过，现有测试通过。
