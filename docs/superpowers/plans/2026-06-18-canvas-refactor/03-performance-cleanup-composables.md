# Plan 3: 性能优化与收尾 — Canvas/Pannel 拆分 + 移除全局单例 + 渲染优化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Canvas.vue（1641 行）拆成 4 个 composables，Pannel.vue（780 行）按 tab 拆成 4 个子组件，移除 useStorage 全局单例改用 CanvasRuntime，默认开启只渲染可见元素，清掉调试日志，修复 ImageCropper 和 VideoNode 的内存泄漏。

**Architecture:** Canvas.vue 保留为 VueFlow 外壳 + 模板，具体逻辑通过 composables 引入。Pannel.vue 保留 tab 导航和折叠状态，每个 tab 内容独立为子组件。全局单例 `getAssetManager()` / `getStorageApi()` 逐步替换为 `usePluginApi('storage')`。

**Tech Stack:** Vue 3 + TypeScript, VueFlow, Pinia, pnpm。

---

## 文件结构

新建：
- `src/canvas/core/composables/useCanvasPersistence.ts` — 持久化逻辑
- `src/canvas/core/composables/useCanvasConnection.ts` — 连线吸附 + 验证
- `src/canvas/core/composables/useCanvasPanelState.ts` — storage/theme/layout 状态桥接
- `src/canvas/core/composables/useCanvasShortcuts.ts` — 快捷键注册
- `src/canvas/core/components/panel/PanelTabGeneral.vue`
- `src/canvas/core/components/panel/PanelTabTheme.vue`
- `src/canvas/core/components/panel/PanelTabStorage.vue`
- `src/canvas/core/components/panel/PanelTabLayout.vue`

修改：
- `src/canvas/core/Canvas.vue` — 拆出逻辑，引入 composables
- `src/canvas/core/Pannel.vue` — 拆出 4 个 tab 组件
- `src/canvas/core/useCanvasStore.ts` — 开启 onlyRenderVisibleElements
- `src/canvas/core/components/nodes/image/ImageTopToolbar.vue` — 改用 usePluginApi
- `src/canvas/core/plugins/file-drop/FileDropPlugin.ts` — 通过 context 获取 storage
- `src/canvas/core/components/nodes/image/ImageCropper.vue` — 清理 emitTimer
- `src/canvas/core/components/nodes/Video/VideoNode.vue` — 空地址兜底
- `src/canvas/core/hooks/useStorage.ts` — 标记 @deprecated
- `src/canvas/core/plugins/theme/ThemePlugin.ts` — 清调试日志
- `src/canvas/core/plugins/theme/colorUtils.ts` — 清调试日志

---

### Task 1: 提取 useCanvasPersistence

**Files:**
- Create: `src/canvas/core/composables/useCanvasPersistence.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 写 useCanvasPersistence**

Create `src/canvas/core/composables/useCanvasPersistence.ts`:

```typescript
import { nextTick } from 'vue'
import type { Node, Edge } from '@vue-flow/core'

const LS_KEY = 'canvas-data'

export function useCanvasPersistence(vueFlowInstance: any) {
  let persistReady = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const defaultNodes: Node[] = [
    { id: '1', type: 'custom', position: { x: 200, y: 260 }, data: { label: 'input image' }, sourcePosition: 'right' as any },
    { id: '2', type: 'custom', position: { x: 700, y: 260 }, data: { label: 'output image' }, sourcePosition: 'right' as any, targetPosition: 'left' as any },
    { id: '3', type: 'custom', position: { x: 1200, y: 260 }, data: { label: 'output image' }, sourcePosition: 'right' as any, targetPosition: 'left' as any },
  ]

  const defaultEdges: Edge[] = [
    { id: 'e1-2', type: 'custom', source: '1', target: '2', sourceHandle: 'source', targetHandle: 'target', data: {} },
  ]

  function safeLocalStorageSet(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value)
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.error(`[Canvas] localStorage quota exceeded (key: ${key})`)
      } else {
        console.error('[Canvas] localStorage write failed:', err)
      }
      return false
    }
  }

  function persistCanvas() {
    if (!persistReady) return
    try {
      const data = vueFlowInstance.toObject()
      data.nodes = data.nodes.filter((n: any) => n.type !== 'tempTarget' && !n.data?.isTemp)
      data.edges = data.edges.filter((e: any) => !e.id?.startsWith?.('temp-') && !e.data?.isTemp)
      safeLocalStorageSet(LS_KEY, JSON.stringify(data))
    } catch (err) {
      console.error('[Canvas] persist serialize failed:', err)
    }
  }

  function scheduleSave() {
    if (!persistReady) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistCanvas, 500)
  }

  function onPersistenceEvent() {
    scheduleSave()
  }

  function handleBeforeUnload() {
    persistReady = true
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    persistCanvas()
  }

  function initCanvasData() {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) {
      try {
        const data = JSON.parse(saved)
        vueFlowInstance.fromObject(data)
      } catch (err) {
        console.warn('[Canvas] localStorage restore failed, using defaults:', err)
        vueFlowInstance.addNodes(defaultNodes)
        vueFlowInstance.addEdges(defaultEdges)
      }
    } else {
      vueFlowInstance.addNodes(defaultNodes)
      vueFlowInstance.addEdges(defaultEdges)
    }
    nextTick(() => { persistReady = true })
  }

  return {
    initCanvasData,
    scheduleSave,
    onPersistenceEvent,
    handleBeforeUnload,
    persistCanvas,
  }
}
```

- [ ] **Step 2: Canvas.vue 替换为调用 composable**

In `Canvas.vue`:
- 删除 `LS_KEY`、`defaultNodes`、`defaultEdges`、`persistReady`、`saveTimer`、`initCanvasData`、`safeLocalStorageSet`、`persistCanvas`、`scheduleSave`、`onPersistenceEvent`、`handleBeforeUnload`
- 替换为：

```typescript
import { useCanvasPersistence } from './composables/useCanvasPersistence'

const persistence = useCanvasPersistence(vueFlowInstance)
```

- `onMounted` 中 `initCanvasData()` 改为 `persistence.initCanvasData()`
- 事件绑定中 `onPersistenceEvent` 改为 `persistence.onPersistenceEvent`
- `handleBeforeUnload` 改为 `persistence.handleBeforeUnload`

- [ ] **Step 3: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/composables/useCanvasPersistence.ts src/canvas/core/Canvas.vue
git commit -m "refactor: extract persistence logic to useCanvasPersistence composable"
```

---

### Task 2: 提取 useCanvasConnection

**Files:**
- Create: `src/canvas/core/composables/useCanvasConnection.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 写 useCanvasConnection**

Create `src/canvas/core/composables/useCanvasConnection.ts`：

从 Canvas.vue 搬出：
- `makeEdgeData`
- `getConnectableNode`、`normalizeConnection`
- `isValidConnection`、`findSameConnection`、`repairExistingConnection`、`createConnection`
- `toFlowPosition`
- `getMousePoint`、`getNodeIdFromElement`、`getNodeCardRectFromNodeElement`
- `isTempNode`、`isTempEdge`
- `findNearestValidTarget`、`findNearestValidSource`
- `createTempConnectionMenu`
- `onConnectStart`、`onConnectEnd`
- `onSelectionBatchConnectStart`、`onBatchConnectMove`、`onBatchConnectEnd`、`cancelBatchConnect`、`resetBatchConnectState`
- `buildConnectionEdgeProps`、`getNodeSize`、`getNodeCardFlowRect`

参数化需要的外部依赖（`canvas.state`、`nodesById`、`vueFlowInstance`、`menuState`、`menuContext` 等通过参数传入）。

- [ ] **Step 2: Canvas.vue 替换**

Canvas.vue 中删除上述函数，改为从 composable 解构使用。

- [ ] **Step 3: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/composables/useCanvasConnection.ts src/canvas/core/Canvas.vue
git commit -m "refactor: extract connection logic to useCanvasConnection composable"
```

---

### Task 3: 提取 useCanvasPanelState + useCanvasShortcuts

**Files:**
- Create: `src/canvas/core/composables/useCanvasPanelState.ts`
- Create: `src/canvas/core/composables/useCanvasShortcuts.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 写 useCanvasPanelState**

从 Canvas.vue 搬出：
- `storageState`、`refreshStorageState`、`onStorageConnect`、`onStorageDisconnect`、`onStorageCreateProject`、`onStorageDeleteProject`、`onStorageSwitchProject`
- `themeState`、`onApplyThemePreset`、`onApplyCustomTheme`
- `layoutState`、`syncLayoutState`、`pushLayoutConfig`、`onAutoLayout`、`onFocusSelected`、`onUpdateLayoutDirection` 等

- [ ] **Step 2: 写 useCanvasShortcuts**

从 Canvas.vue 搬出：
- `toVueFlowKey`、`syncVueFlowKeymap`
- VueFlow 系统键位注册逻辑（`vfSystemEntries`）
- `shortcutKeymap` 的 load/sync/watch

- [ ] **Step 3: Canvas.vue 替换**

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/composables src/canvas/core/Canvas.vue
git commit -m "refactor: extract panel state and shortcut logic to composables"
```

---

### Task 4: Pannel.vue 按 tab 拆分

**Files:**
- Create: `src/canvas/core/components/panel/PanelTabGeneral.vue`
- Create: `src/canvas/core/components/panel/PanelTabTheme.vue`
- Create: `src/canvas/core/components/panel/PanelTabStorage.vue`
- Create: `src/canvas/core/components/panel/PanelTabLayout.vue`
- Modify: `src/canvas/core/Pannel.vue`

- [ ] **Step 1: 拆 PanelTabGeneral.vue**

将 Pannel.vue 中 `activeTab === 'general'` 的模板内容搬到 `PanelTabGeneral.vue`。
Props: `toggles`, `connectionMode`, `edgeLineWidth`, `edgeColor`, `edgeType`, `edgeDashed`, `edgeAnimated`, `minZoom`, `maxZoom`, `plugins`, `topToolbarOffset`, `bottomToolbarOffset`, `handleDebug`, `handleRadius`, `handleRestOffset`, `handleCursorGap`, `handleButtonSize`, `handleOverlap`, `connectionSnapDebugVisible`, `connectionSnapOuterRatio`, `connectionSnapInnerRatio`, `connectionSnapHeightRatio`, `selectionFramePaddingX`, `selectionFramePaddingTop`, `selectionFramePaddingBottom`。
Emits: 对应的 update/toggle/zoom 事件。

- [ ] **Step 2: 拆 PanelTabTheme.vue**

Props: `themePreset`, `themeAccent`, `themeSurface`。
Emits: `applyThemePreset`, `applyCustomTheme`。

- [ ] **Step 3: 拆 PanelTabStorage.vue**

Props: `storageStatus`。
Emits: `storageConnect`, `storageDisconnect`, `storageCreateProject`, `storageDeleteProject`, `storageSwitchProject`。

- [ ] **Step 4: 拆 PanelTabLayout.vue**

Props: `layoutDirection`, `layoutIntraSpacingX`, `layoutIntraSpacingY`, `layoutInterSpacingX`, `layoutInterSpacingY`, `layoutFocusHeightRatio`。
Emits: 对应的 update 事件 + `autoLayout`, `focusSelected`。

- [ ] **Step 5: Pannel.vue 改为引用子组件**

删除 4 个 `<template v-if="activeTab === '...'">` 块，替换为：

```vue
<PanelTabGeneral v-if="activeTab === 'general'" v-bind="generalProps" @... />
<PanelTabTheme v-if="activeTab === 'theme'" v-bind="themeProps" @... />
<PanelTabStorage v-if="activeTab === 'storage'" v-bind="storageProps" @... />
<PanelTabLayout v-if="activeTab === 'layout'" v-bind="layoutProps" @... />
```

- [ ] **Step 6: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/components/panel src/canvas/core/Pannel.vue
git commit -m "refactor: split Pannel.vue into per-tab components"
```

---

### Task 5: 移除 useStorage 全局单例

**Files:**
- Modify: `src/canvas/core/components/nodes/image/ImageTopToolbar.vue`
- Modify: `src/canvas/core/plugins/file-drop/FileDropPlugin.ts`
- Modify: `src/canvas/core/hooks/useStorage.ts`

- [ ] **Step 1: ImageTopToolbar 改用 usePluginApi**

Replace:

```typescript
import { getAssetManager } from '../../../hooks/useStorage'
// ...
const assetManager = getAssetManager()
```

With:

```typescript
import { usePluginApi } from '../../../runtime/usePluginApi'
// ...
const storage = usePluginApi<any>('storage')
const assetManager = storage?.assets ?? null
```

- [ ] **Step 2: FileDropPlugin 通过 context 获取 storage**

Replace:

```typescript
import { getAssetManager } from '../../hooks/useStorage'
// ...
const am = getAssetManager()
```

With a helper function inside `install()`:

```typescript
function getAssetMgr() {
  const sp = context.getPlugin('storage') as any
  return sp?.api?.assets ?? null
}
// usage:
const am = getAssetMgr()
```

- [ ] **Step 3: useStorage.ts 标记 @deprecated**

Add `/** @deprecated Use usePluginApi('storage') from CanvasRuntime instead */` to `getStorageApi` and `getAssetManager`。

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/components/nodes/image/ImageTopToolbar.vue src/canvas/core/plugins/file-drop/FileDropPlugin.ts src/canvas/core/hooks/useStorage.ts
git commit -m "refactor: replace useStorage global singleton with runtime plugin API"
```

---

### Task 6: 性能优化与清理

**Files:**
- Modify: `src/canvas/core/useCanvasStore.ts`
- Modify: `src/canvas/core/components/nodes/image/ImageCropper.vue`
- Modify: `src/canvas/core/components/nodes/Video/VideoNode.vue`
- Modify: `src/canvas/core/plugins/theme/ThemePlugin.ts`
- Modify: `src/canvas/core/plugins/theme/colorUtils.ts`

- [ ] **Step 1: 默认开启 onlyRenderVisibleElements**

In `src/canvas/core/useCanvasStore.ts`, change:

```typescript
onlyRenderVisibleElements: false,
```

to:

```typescript
onlyRenderVisibleElements: true,
```

- [ ] **Step 2: ImageCropper 清理 emitTimer**

In `src/canvas/core/components/nodes/image/ImageCropper.vue`:
- Add `onUnmounted` to import
- Add after `onMounted`:

```typescript
onUnmounted(() => {
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
})
```

- [ ] **Step 3: VideoNode 空地址兜底**

In `src/canvas/core/components/nodes/Video/VideoNode.vue`:
- Add `loadError` ref and `videoUrl` computed
- Template: show error state when `loadError` or no `videoUrl`, play button when not playing, `<video>` element when playing
- `@error` on `<video>` sets `loadError = true`

- [ ] **Step 4: 清调试日志**

In `ThemePlugin.ts`:
- Delete `console.log('[ThemePlugin] applyPreset called:', name)` in `api.applyPreset`
- Delete `console.log('[ThemePlugin] applyCustom called:', accent, surface)` in `api.applyCustom`

In `colorUtils.ts`:
- Delete `console.log` calls in `applyThemeToDOM`

- [ ] **Step 5: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/useCanvasStore.ts src/canvas/core/components/nodes/image/ImageCropper.vue src/canvas/core/components/nodes/Video/VideoNode.vue src/canvas/core/plugins/theme/ThemePlugin.ts src/canvas/core/plugins/theme/colorUtils.ts
git commit -m "perf: enable onlyRenderVisibleElements, fix memory leaks, clean debug logs"
```

---

### Task 7: 最终验证

- [ ] **Step 1: 运行所有测试**

```powershell
node --test src\canvas\core\plugins\auto-layout\__tests__\*.test.ts
node --test src\canvas\core\plugins\storage\__tests__\*.test.ts
node --test src\canvas\core\registry\__tests__\*.test.ts
```

Expected: all PASS。

- [ ] **Step 2: 生产构建**

```powershell
pnpm build
```

Expected: exit code `0`。

- [ ] **Step 3: 冒烟测试**

```powershell
pnpm dev
```

检查清单：
- 画布打开正常，所有节点类型可创建
- 右键菜单（pane/node/connection 三种模式）正常
- 连线吸附正常
- Ctrl+F 搜索正常
- 图片上传/裁剪正常，保存后刷新节点 type 仍为 `custom`
- 视频节点无地址时显示兜底状态
- Pannel 四个 tab 切换正常
- 插件列表正常显示

- [ ] **Step 4: Git 状态**

```powershell
git status --short
```

Expected: clean。

---

## 完成标准

- [ ] Canvas.vue 从 1641 行降到 ~400 行（模板 + 组装 composables）
- [ ] Pannel.vue 从 780 行降到 ~150 行（tab 导航 + 子组件引用）
- [ ] `usePluginApi('storage')` 可替代 `getAssetManager()` / `getStorageApi()`
- [ ] `onlyRenderVisibleElements: true` 默认开启
- [ ] ImageCropper emitTimer 在 onUnmounted 清理
- [ ] VideoNode 有空地址和加载失败兜底
- [ ] 构建通过，所有测试通过
