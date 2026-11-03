# 2026-06-20 canvas enhancement plan

Goal: Fix AutoSavePlugin beforeunload async loss, AutoLayoutPlugin rAF reentry risk; refactor Canvas.vue; add AlignArrangePlugin, CanvasExportPlugin, MiniMap/Controls, batch color toolbar.

Architecture: Keep existing plugin system. Add new plugins. Use ThemePlugin API for batch color (no accentColor field in node data).

Tech Stack: Vue 3, VueFlow, Pinia, TypeScript, html-to-image (already in deps)

---

## Execution Order

Z0 (dir rename) MUST be first. All tasks depend on Z0 for correct import paths.

A2/A3 are independent bug fixes (different plugin files).
B1 modifies Canvas.vue nodesById.
H1/H2/H3 all modify Canvas.vue, must be sequential (H1->H2->H3).
C/D/E/G are independent new features (new files or their own plugin files).
C/D/E/G do NOT depend on H completing - new plugins use PluginContext interface, not Canvas.vue composables.

Order: Z0 -> [A2, A3, B1, H1->H2->H3, C1, D1, E1, G1] (all parallel after Z0 except H chain)

---

## Part A: Bug Fixes

Note: HistoryPlugin delete double-register bug NOT FOUND. deleteHandler registers delete and backspace shortcuts via ShortcutManager - no duplicate registration. Removed from plan.

### Task A2: Fix AutoSavePlugin beforeunload async loss

File: src/canvas/core/plugins/auto-save/AutoSavePlugin.ts

Problem: handleBeforeUnload calls performSave() (async, awaits storage.saveCanvas) without await. Browser does not wait for async ops in beforeunload. Data loss risk.

Fix: Replace with synchronous localStorage.setItem fallback in handleBeforeUnload.

Steps:
1. Replace handleBeforeUnload function: clear timer, check dirty, get storage API, deep-clone nodes/edges (JSON.parse/stringify to strip reactivity), filter temp nodes/edges, localStorage.setItem with project key
2. Verify: Open DevTools Application panel, close tab, check localStorage
3. Commit: fix: beforeunload changed to sync localStorage save to prevent async data loss

### Task A3: Fix AutoLayoutPlugin rAF reentry risk

File: src/canvas/core/plugins/auto-layout/AutoLayoutPlugin.ts

Problem: run() has nested requestAnimationFrame callbacks. Rapid Ctrl+L triggers concurrent rAF groups that overwrite each other.

Fix: Add isLayouting lock variable. Check at run() entry, set true. Unlock at innermost rAF callback after focusBounds.

Steps:
1. Add: let isLayouting = false after config declaration
2. Add at run() first line: if (isLayouting) { logger.warn(...); return } isLayouting = true
3. Add isLayouting = false after focusBounds() in innermost rAF
4. Commit: fix: AutoLayoutPlugin add isLayouting lock to prevent rAF nested reentry

---

## Part B: Performance

### Task B1: Optimize nodesById computed

File: src/canvas/core/Canvas.vue

Problem: nodesById is computed, rebuilds Map on every getNodes.value change.

Fix: Change to shallowRef + watch with deep:false.

Replace computed with: const nodesById = shallowRef(new Map()); watch(() => getNodes.value, (nodes) => { const map = new Map(); for (const n of nodes) map.set(n.id, n); nodesById.value = map }, { immediate: true, deep: false })

shallowRef and watch already imported. Callers use .value.get(id) unchanged.

---

## Part C: AlignArrangePlugin

### Task C1: Create AlignArrangePlugin

New files: src/canvas/core/plugins/align-arrange/{types,arrangeEngine,AlignArrangePlugin,index}.ts
Modify: src/App.vue

Feature: Select 2+ nodes, Ctrl+ArrowKey arranges them with PureRef-style obstacle avoidance.
Records undo history via context.emit(history:record). No hard dependency on history plugin (fire-and-forget event).

Files to create:
- types.ts: ArrangeDirection type, AlignArrangeConfig (gap, debug), AlignArrangeAPI (arrange, setGap, getConfig)
- arrangeEngine.ts: computeArrange function - sorts nodes by direction, iterates placing each after obstacles
- AlignArrangePlugin.ts: registers panel setting for gap, getNodeDim helper, arrange function (uses computedPosition for group children), 4 shortcuts (ctrl+arrowleft/right/up/down), uninstall cleans up shortcuts
- index.ts: re-exports

Register in App.vue pluginSlots with label=对齐排列.

---

## Part D: CanvasExportPlugin

### Task D1: Create CanvasExportPlugin

New files: src/canvas/core/plugins/canvas-export/{CanvasExportPlugin,index}.ts
Modify: src/App.vue

Feature: Ctrl+E exports full canvas as PNG. Ctrl+Shift+E exports selected nodes as PNG.
Uses html-to-image (already in deps). toPng with pixelRatio 2.

exportFullCanvas: querySelector .vue-flow__viewport, toPng, download link
exportSelectedNodes: querySelector .vue-flow__node[data-id=...], clone to offscreen container, compute bounding box, toPng, download link, cleanup container

Note: toPng may fail for very large canvases (browser canvas size limit). Start with 2x pixelRatio, adjust if needed.

Register shortcuts: ctrl+e, ctrl+shift+e. Uninstall cleans up both.

---

## Part E: MiniMap + Controls

### Task E1: Enable VueFlow MiniMap and Controls

File: src/canvas/core/Canvas.vue

Import MiniMap, Controls from @vue-flow/core.
Add inside VueFlow template tag (before closing):
  MiniMap with position:absolute, bottom:12px, right:12px, 180x120, pannable, zoomable
  Controls with position:absolute, bottom:12px, left:12px, show-zoom, show-fit-view

---

## Part G: Batch Color Toolbar

### Task G1: MultiSelectPlugin batch color toolbar

File: src/canvas/core/plugins/multi-select/MultiSelectPlugin.ts

Design: No accentColor field in node data. Node colors controlled by ThemePlugin CSS variables. Batch color = switch theme accent color via ThemePlugin API.

Implementation:
- Define BATCH_COLORS array: Slate/Blue/Green/Red/Purple/Amber with accent+surface hex values
- Register parent command multi-select.batch-color with dropdown of color options
- Register child commands for each color: calls context.getPluginAPI(theme).applyCustom(accent, surface)
- Register custom color command: prompt() for hex input, validates with regex, calls applyCustom
- Register toolbar button with dropdown (color options + custom...)

Verification: Select 2+ nodes, see batch color button in top toolbar, click dropdown, select Blue -> all node borders turn blue

---

## Part H: Architecture Refactoring

Background: Canvas.vue is ~1518 lines. Project already has useCanvasConnection.ts (~280 lines) but Canvas.vue does not use it - has duplicate functions.

### Task H1: Extract useCanvasMenu composable

New file: src/canvas/core/composables/useCanvasMenu.ts
Modify: src/canvas/core/Canvas.vue

Extract from Canvas.vue: menuState, menuContext, openMenu, closeMenu, openCreateNodeMenu, removeTempConnection, createNodeFromMenuItem, onMenuSelect, toFlowPosition, isTempNode, isTempEdge.

useCanvasMenu function takes: vueFlowInstance, nodeRegistry, menuRegistry, makeEdgeData, createConnection.
Returns: { menuState, menuContext, openMenu, closeMenu, openCreateNodeMenu, onMenuSelect, createNodeFromMenuItem, toFlowPosition, isTempNode, isTempEdge }

In Canvas.vue: import useCanvasMenu, call with options, delete extracted definitions, update template bindings (onMenuSelect->canvasMenu.onMenuSelect, closeMenu->canvasMenu.closeMenu), update event handler references.

### Task H2: Use existing useCanvasConnection in Canvas.vue

Modify: src/canvas/core/composables/useCanvasConnection.ts, src/canvas/core/Canvas.vue

Strategy: Fix differences in useCanvasConnection.ts, then make Canvas.vue use it and delete duplicates.

Key differences to fix in useCanvasConnection.ts:
1. getNodeCardRectFromNodeElement: use .custom-node-card selector (not .base-node-card)
2. findNearestValidTarget: use Canvas.vue version with snap zones (snapHeight/snapOuter/snapInner)
3. onConnectEnd: add lastNativeConnectAt check (from Canvas.vue)
4. Export lastNativeConnectAt as ref

Then in Canvas.vue: import useCanvasConnection, call with options, delete duplicate functions, update template bindings.

### Task H3: Plugin error degradation

File: src/canvas/core/Canvas.vue

Problem: bootstrap.loadInitialCanvas() and all panelRegistry.registerSetting() calls are inside try { await manager.install(...) } block. If any plugin fails, canvas stays blank.

Fix: Move bootstrap.loadInitialCanvas() and registerCore() calls OUTSIDE the try-catch. Plugin install failure should still render empty canvas.

Verification: Disable StoragePlugin in App.vue, canvas should still render (empty).

---

## Revision History

v1.0 2026-06-20 Initial draft
v1.1 2026-06-20 Review fixes: removed A1 HistoryPlugin task (no bug found); H1/H2 added full migration strategy; H3 fixed try-catch scope; C1 added history dependency notes; G1 switched to ThemePlugin API (no accentColor field); fixed execution order (C/D/E/G do not depend on H)