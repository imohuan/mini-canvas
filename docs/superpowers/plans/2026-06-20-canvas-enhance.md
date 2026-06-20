## ⚠️ 全局前置任务：统一 components 文件夹命名

### Task Z0: 重命名 components 子目录为首字母大写

**当前状态（不规范）：**
- `src/canvas/core/components/menu/` → 需改为 `Menu/`
- `src/canvas/core/components/panel/` → 需改为 `Panel/`
- `src/canvas/core/components/performance/` → 需改为 `Performance/`
- `src/canvas/core/components/toolbar/` → 需改为 `Toolbar/`
- `src/canvas/core/components/Decoration/` → 已正确，不动

- [ ] **Step 1: 用 git mv 重命名目录（保留 git 历史）**

```bash
cd D:\Code\GitTest\canvas-ai\mini-canvas
git mv src/canvas/core/components/menu src/canvas/core/components/Menu
git mv src/canvas/core/components/panel src/canvas/core/components/Panel
git mv src/canvas/core/components/performance src/canvas/core/components/Performance
git mv src/canvas/core/components/toolbar src/canvas/core/components/Toolbar
```

- [ ] **Step 2: 更新所有 import 路径**

全局搜索替换以下模式：

| 旧路径 | 新路径 |
|--------|--------|
| `components/menu/` | `components/Menu/` |
| `components/panel/` | `components/Panel/` |
| `components/performance/` | `components/Performance/` |
| `components/toolbar/` | `components/Toolbar/` |

涉及的文件（至少）：`Canvas.vue`、`CustomNode.vue`、`BaseNode.vue`、`NodeToolbar.vue`

- [ ] **Step 3: 验证** — `pnpm build`，确认编译无报错，画布正常渲染

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: 统一 components 子目录命名为首字母大写 (Menu/Panel/Performance/Toolbar)"
```

---

## 📋 执行顺序（严格按此顺序执行）

```
Task Z0 (目录重命名) ← 必须先做，所有后续任务 import 路径依赖新目录名
  └─→ Part A (Bug 修复: A1 → A2 → A3，无依赖)
       └─→ Part B (性能优化: B1)
            └─→ Part H (架构拆分: H1 → H2 → H3)
                 ├─→ Part C (对齐排列)   ← 可并行
                 ├─→ Part D (画布导出)   ← 可并行
                 ├─→ Part E (小地图)     ← 可并行
                 └─→ Part G (批量面板)   ← 可并行
```

**依赖说明：**
- Z0 必须先做：所有 import 路径依赖新目录名
- Part A/B 无依赖：独立改动
- Part H 在 C/D/E/F/G 之前：拆分后的 composable 可能被后续插件引用；H3 保证后续插件安装失败时画布仍可用
- C/D/E/G 互相独立：4 个功能模块没有代码重叠，可并行开发

| 顺序 | 任务 | 类型 | 依赖 |
|------|------|------|------|
| 1 | Z0 目录重命名 | 重构 | 无 |
| 2 | A2 AutoSavePlugin beforeunload | Bug修复 | Z0 |
| 3 | A3 AutoLayoutPlugin rAF锁 | Bug修复 | Z0 |
| 4 | B1 nodesById 性能 | 性能 | Z0 |
| 5 | H1 useCanvasMenu 拆分 | 重构 | Z0 |
| 6 | H2 useCanvasConnections 拆分 | 重构 | Z0 |
| 7 | H3 错误降级 | 重构 | Z0 |
| 8 | C1 AlignArrangePlugin | 新功能 | H |
| 9 | D1 CanvasExportPlugin | 新功能 | H |
| 10 | E1 MiniMap+Controls | 新功能 | H |
| 11 | G1 批量属性面板 | 新功能 | H |


---

﻿# 2026-06-20 画布增强综合计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 HistoryPlugin 删除双注册 Bug、AutoSavePlugin beforeunload 异步丢失、AutoLayoutPlugin rAF 嵌套风险；重构 Canvas.vue 拆分 + 性能优化；添加画布导出图片、节点对齐排列、小地图、缩放控件、节点备注 tooltip、批量属性面板。

**Architecture:** 保持现有插件系统架构不变，新增 `AlignArrangePlugin` 实现 Ctrl+方向键对齐排列，新增 `CanvasExportPlugin` 实现画布导出，在 MultiSelectPlugin 中注册 Toolbar 实现批量属性面板，在 Canvas.vue 中启用 VueFlow 内置 MiniMap/Controls。

**Tech Stack:** Vue 3, VueFlow, Pinia, TypeScript, html-to-image

---

## Part A: Bug 修复

### Task A2: 修复 AutoSavePlugin beforeunload 异步丢失

**Files:** Modify `src/canvas/core/plugins/auto-save/AutoSavePlugin.ts`

**问题：** `beforeunload` 中调用 async `performSave()` 但没有 await，浏览器可能在保存完成前关闭页面。

**修复：** 改为同步 localStorage 保存兜底。

- [ ] **Step 1: 修改 handleBeforeUnload**

将 `handleBeforeUnload` 函数替换为：
```typescript
function handleBeforeUnload() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (!dirty) return
  const storage = getStorageAPI()
  if (!storage || !storage.isConnected || !storage.currentProjectId) return
  try {
    const nodes = context.actions.getNodes()
    const edges = context.actions.getEdges()
    const cleaned = JSON.parse(JSON.stringify({ nodes, edges }))
    cleaned.nodes = cleaned.nodes.filter((n: any) =>
      n.type !== 'tempTarget' && !String(n.id ?? '').startsWith('temp-') && !n.data?.isTemp
    )
    cleaned.edges = cleaned.edges.filter((e: any) =>
      !String(e.id ?? '').startsWith('temp-') && !e.data?.isTemp
    )
    localStorage.setItem(`canvas-ai:project:${storage.currentProjectId}`, JSON.stringify(cleaned))
    dirty = false
  } catch (_err) { /* 静默失败 */ }
}
```

- [ ] **Step 2: 验证** - 打开 DevTools Application 面板，关闭标签页后检查 localStorage

- [ ] **Step 3: Commit**
```bash
git add src/canvas/core/plugins/auto-save/AutoSavePlugin.ts
git commit -m "fix: beforeunload 改为同步 localStorage 保存，防止异步丢失"
```

---

### Task A3: 修复 AutoLayoutPlugin rAF 嵌套风险

**Files:** Modify `src/canvas/core/plugins/auto-layout/AutoLayoutPlugin.ts`

- [ ] **Step 1: 添加锁变量**

在 `const config: AutoLayoutConfig = ...` 下方添加：
```typescript
let isLayouting = false
```

- [ ] **Step 2: `run` 函数入口加锁**

在 `function run(...)` 第一行添加：
```typescript
if (isLayouting) { logger.warn('自动布局正在进行中，跳过重复调用'); return }
isLayouting = true
```

- [ ] **Step 3: 最内层 rAF 回调末尾解锁**

在 `focusBounds(result.nodes, { keepZoom: true })` 之后添加：
```typescript
isLayouting = false
```

- [ ] **Step 4: Commit**
```bash
git add src/canvas/core/plugins/auto-layout/AutoLayoutPlugin.ts
git commit -m "fix: AutoLayoutPlugin 添加 isLayouting 锁，防止 rAF 嵌套重入"
```

---

## Part B: 性能优化

### Task B1: 优化 nodesById computed

**Files:** Modify `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 替换实现**

将：
```typescript
const nodesById = computed(() => {
  const map = new Map<string, Node>()
  for (const n of getNodes.value as Node[]) map.set(n.id, n)
  return map
})
```
替换为：
```typescript
const nodesById = shallowRef(new Map<string, Node>())
watch(() => getNodes.value, (nodes) => {
  const map = new Map<string, Node>()
  for (const n of nodes as Node[]) map.set(n.id, n)
  nodesById.value = map
}, { immediate: true, deep: false })
```

注意需要额外 import `shallowRef` 和 `watch`（已导入）。

- [ ] **Step 2: 验证** - `pnpm dev`，拖拽节点、连线，确认正常

- [ ] **Step 3: Commit**
```bash
git add src/canvas/core/Canvas.vue
git commit -m "perf: nodesById 改为 shallowRef+watch 增量更新"
```

---

## Part C: 新功能 - 节点对齐排列

### Task C1: 创建 AlignArrangePlugin

**Files:**
- Create: `src/canvas/core/plugins/align-arrange/types.ts`
- Create: `src/canvas/core/plugins/align-arrange/arrangeEngine.ts`
- Create: `src/canvas/core/plugins/align-arrange/AlignArrangePlugin.ts`
- Create: `src/canvas/core/plugins/align-arrange/index.ts`
- Modify: `src/App.vue`

**功能：** Ctrl+↑/↓/←/→ 将选中节点向指定方向排列（PureRef 风格算法），支持设置间距，记录历史。

- [ ] **Step 1: 创建 types.ts**

```typescript
export type ArrangeDirection = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export interface AlignArrangeConfig {
  gap: number
  debug: boolean
}

export interface AlignArrangeAPI {
  arrange(direction: ArrangeDirection): void
  setGap(gap: number): void
  getConfig(): AlignArrangeConfig
}
```

- [ ] **Step 2: 创建 arrangeEngine.ts**

```typescript
import type { ArrangeDirection } from './types'

interface NodeRect { id: string; x: number; y: number; w: number; h: number }

export function computeArrange(
  nodes: NodeRect[], direction: ArrangeDirection, gap: number,
): Map<string, { x: number; y: number }> {
  if (nodes.length <= 1) return new Map()
  const result = new Map<string, { x: number; y: number }>()

  const minX = Math.min(...nodes.map(n => n.x))
  const minY = Math.min(...nodes.map(n => n.y))
  const maxX = Math.max(...nodes.map(n => n.x + n.w))
  const maxY = Math.max(...nodes.map(n => n.y + n.h))

  const sorted = [...nodes].sort((a, b) => {
    switch (direction) {
      case 'ArrowLeft':  return a.x - b.x
      case 'ArrowRight': return (b.x + b.w) - (a.x + a.w)
      case 'ArrowUp':    return a.y - b.y
      case 'ArrowDown':  return (b.y + b.h) - (a.y + a.h)
    }
  })

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i]
    if (i === 0) { result.set(curr.id, { x: curr.x, y: curr.y }); continue }

    const obstacles = sorted.slice(0, i).filter(prev => {
      if (direction === 'ArrowLeft' || direction === 'ArrowRight')
        return !(curr.y + curr.h <= prev.y || curr.y >= prev.y + prev.h)
      else
        return !(curr.x + curr.w <= prev.x || curr.x >= prev.x + prev.w)
    })

    let newX = curr.x, newY = curr.y
    if (obstacles.length > 0) {
      switch (direction) {
        case 'ArrowLeft':  newX = Math.max(...obstacles.map(o => result.get(o.id)!.x + o.w)) + gap; break
        case 'ArrowRight': newX = Math.min(...obstacles.map(o => result.get(o.id)!.x)) - curr.w - gap; break
        case 'ArrowUp':    newY = Math.max(...obstacles.map(o => result.get(o.id)!.y + o.h)) + gap; break
        case 'ArrowDown':  newY = Math.min(...obstacles.map(o => result.get(o.id)!.y)) - curr.h - gap; break
      }
    } else {
      switch (direction) {
        case 'ArrowLeft':  newX = minX; break
        case 'ArrowRight': newX = maxX - curr.w; break
        case 'ArrowUp':    newY = minY; break
        case 'ArrowDown':  newY = maxY - curr.h; break
      }
    }
    result.set(curr.id, { x: newX, y: newY })
  }
  return result
}
```

- [ ] **Step 3: 创建 AlignArrangePlugin.ts**

```typescript
import type { CanvasPlugin, PluginContext } from '../types'
import type { PanelSettingDefinition } from '../../registry/types'
import type { ArrangeDirection, AlignArrangeConfig, AlignArrangeAPI } from './types'
import { computeArrange } from './arrangeEngine'

const DEFAULT_CONFIG: AlignArrangeConfig = { gap: 20, debug: false }

export const AlignArrangePlugin: CanvasPlugin<Partial<AlignArrangeConfig>, AlignArrangeAPI> = {
  name: 'align-arrange',
  version: '0.1.0',

  install(context: PluginContext, options: Partial<AlignArrangeConfig>) {
    const logger = context.logger
    const config: AlignArrangeConfig = { ...DEFAULT_CONFIG, ...options }

    context.panels.registerSetting('align-arrange', {
      id: 'align-arrange.gap', title: '排列间距',
      description: 'Ctrl+方向键排列节点时的间距',
      type: 'slider', group: '布局', order: 70,
      defaultValue: config.gap, min: 0, max: 100, step: 1,
    } as PanelSettingDefinition)

    function getNodeDim(node: any): { w: number; h: number } {
      return {
        w: node.dimensions?.width ?? (node.style?.width ? parseInt(String(node.style.width)) : 200),
        h: node.dimensions?.height ?? (node.style?.height ? parseInt(String(node.style.height)) : 100),
      }
    }

    function arrange(direction: ArrangeDirection): void {
      const selectedIds = context.selection.getSelectedNodeIds()
      if (selectedIds.size < 2) { logger.debug('排列需要至少 2 个选中节点'); return }
      const allNodes = context.actions.getNodes()
      const selectedNodes = allNodes.filter(n => selectedIds.has(n.id))
      if (selectedNodes.length < 2) return

      const nodeRects = selectedNodes.map(n => {
        const pos = n.computedPosition?.x !== undefined ? n.computedPosition : n.position
        const dim = getNodeDim(n)
        return { id: n.id, x: pos.x, y: pos.y, w: dim.w, h: dim.h }
      })

      const oldPositions = new Map(nodeRects.map(r => [r.id, { x: r.x, y: r.y }]))
      const newPositions = computeArrange(nodeRects, direction, config.gap)

      context.emit('history:record', {
        type: 'arrangeNodes',
        description: `排列 ${selectedNodes.length} 个节点 (${direction})`,
        undo: () => { for (const [id, pos] of oldPositions) context.actions.updateNode(id, { position: pos } as any) },
        redo: () => { for (const [id, pos] of newPositions) context.actions.updateNode(id, { position: pos } as any) },
      })

      for (const [id, pos] of newPositions) context.actions.updateNode(id, { position: pos } as any)
      logger.info(`排列完成: ${newPositions.size} 个节点, 方向=${direction}`)
    }

    context.registerShortcut('ctrl+arrowleft', () => { arrange('ArrowLeft'); return true }, '节点向左排列')
    context.registerShortcut('ctrl+arrowright', () => { arrange('ArrowRight'); return true }, '节点向右排列')
    context.registerShortcut('ctrl+arrowup', () => { arrange('ArrowUp'); return true }, '节点向上排列')
    context.registerShortcut('ctrl+arrowdown', () => { arrange('ArrowDown'); return true }, '节点向下排列')

    const api: AlignArrangeAPI = { arrange, setGap(gap: number) { config.gap = gap }, getConfig() { return { ...config } } }
    logger.info('AlignArrangePlugin v0.1.0 ready (Ctrl+方向键 排列)')

    return {
      api,
      uninstall() {
        try { context.unregisterShortcut('ctrl+arrowleft') } catch (_e) {}
        try { context.unregisterShortcut('ctrl+arrowright') } catch (_e) {}
        try { context.unregisterShortcut('ctrl+arrowup') } catch (_e) {}
        try { context.unregisterShortcut('ctrl+arrowdown') } catch (_e) {}
      },
    }
  },
}
```

- [ ] **Step 4: 创建 index.ts**

```typescript
export { AlignArrangePlugin } from './AlignArrangePlugin'
export type { AlignArrangeAPI, AlignArrangeConfig, ArrangeDirection } from './types'
```

- [ ] **Step 5: 注册到 App.vue**

在 `src/App.vue` 中：
```typescript
import { AlignArrangePlugin } from './canvas/core/plugins/align-arrange/index'
```
在 `pluginSlots` 数组末尾添加：
```typescript
{ plugin: markRaw(AlignArrangePlugin) as CanvasPlugin, enabled: true, label: '对齐排列', description: 'Ctrl+方向键排列选中节点', usage: '选中多个节点 → Ctrl+方向键 → 自动排列' },
```

- [ ] **Step 6: 验证** - `pnpm dev`，创建 3+ 节点，选中后按 Ctrl+→

- [ ] **Step 7: Commit**
```bash
git add src/canvas/core/plugins/align-arrange/ src/App.vue
git commit -m "feat: 添加 AlignArrangePlugin，Ctrl+方向键排列节点"
```

---

## Part D: 新功能 - 画布导出图片

### Task D1: 创建 CanvasExportPlugin

**Files:**
- Create: `src/canvas/core/plugins/canvas-export/CanvasExportPlugin.ts`
- Create: `src/canvas/core/plugins/canvas-export/index.ts`
- Modify: `src/App.vue`

- [ ] **Step 1: 创建 CanvasExportPlugin.ts**

```typescript
import type { CanvasPlugin, PluginContext } from '../types'
import { toPng } from 'html-to-image'

export interface CanvasExportAPI {
  exportFullCanvas(): Promise<void>
  exportSelectedNodes(): Promise<void>
}

export const CanvasExportPlugin: CanvasPlugin<Record<string, unknown>, CanvasExportAPI> = {
  name: 'canvas-export',
  version: '0.1.0',

  install(context: PluginContext, _options: Record<string, unknown>) {
    const logger = context.logger

    function getFlowEl(): HTMLElement | null {
      return document.querySelector('.vue-flow__viewport')
    }

    async function exportFullCanvas(): Promise<void> {
      const el = getFlowEl()
      if (!el) { logger.warn('未找到画布元素'); return }
      try {
        const dataUrl = await toPng(el, { backgroundColor: '#ffffff', pixelRatio: 2 })
        const link = document.createElement('a')
        link.download = `canvas-export-${Date.now()}.png`
        link.href = dataUrl
        link.click()
        logger.info('画布已导出为 PNG')
        context.emit('canvas-export:exported', { type: 'full' })
      } catch (err) { logger.error('导出画布失败:', err) }
    }

    async function exportSelectedNodes(): Promise<void> {
      const selectedIds = context.selection.getSelectedNodeIds()
      if (selectedIds.size === 0) { logger.warn('没有选中节点'); return }

      const nodeEls: HTMLElement[] = []
      for (const id of selectedIds) {
        const el = document.querySelector(`.vue-flow__node[data-id="${id}"]`) as HTMLElement
        if (el) nodeEls.push(el)
      }
      if (nodeEls.length === 0) { logger.warn('未找到选中节点的 DOM 元素'); return }

      const container = document.createElement('div')
      container.style.cssText = 'position:absolute;left:-9999px;top:-9999px'
      document.body.appendChild(container)

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      const clones: HTMLElement[] = []
      for (const el of nodeEls) {
        const rect = el.getBoundingClientRect()
        minX = Math.min(minX, rect.left); minY = Math.min(minY, rect.top)
        maxX = Math.max(maxX, rect.right); maxY = Math.max(maxY, rect.bottom)
        const clone = el.cloneNode(true) as HTMLElement
        clone.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;transform:none`
        container.appendChild(clone)
        clones.push(clone)
      }
      container.style.width = `${maxX - minX}px`
      container.style.height = `${maxY - minY}px`
      for (const clone of clones) {
        clone.style.left = `${parseFloat(clone.style.left) - minX}px`
        clone.style.top = `${parseFloat(clone.style.top) - minY}px`
      }
      try {
        const dataUrl = await toPng(container, { backgroundColor: '#ffffff', pixelRatio: 2 })
        const link = document.createElement('a')
        link.download = `canvas-selected-${Date.now()}.png`
        link.href = dataUrl
        link.click()
        logger.info(`已导出 ${selectedIds.size} 个选中节点为 PNG`)
        context.emit('canvas-export:exported', { type: 'selected', count: selectedIds.size })
      } catch (err) { logger.error('导出选中节点失败:', err) }
      finally { document.body.removeChild(container) }
    }

    context.registerShortcut('ctrl+e', () => { exportFullCanvas(); return true }, '导出画布为 PNG')
    context.registerShortcut('ctrl+shift+e', () => { exportSelectedNodes(); return true }, '导出选中节点为 PNG')

    const api: CanvasExportAPI = { exportFullCanvas, exportSelectedNodes }
    logger.info('CanvasExportPlugin v0.1.0 ready (Ctrl+E 导出画布, Ctrl+Shift+E 导出选中)')

    return {
      api,
      uninstall() {
        try { context.unregisterShortcut('ctrl+e') } catch (_e) {}
        try { context.unregisterShortcut('ctrl+shift+e') } catch (_e) {}
      },
    }
  },
}
```

- [ ] **Step 2: 创建 index.ts**

```typescript
export { CanvasExportPlugin } from './CanvasExportPlugin'
export type { CanvasExportAPI } from './CanvasExportPlugin'
```

- [ ] **Step 3: 注册到 App.vue**

```typescript
import { CanvasExportPlugin } from './canvas/core/plugins/canvas-export/index'
```
在 pluginSlots 添加：
```typescript
{ plugin: markRaw(CanvasExportPlugin) as CanvasPlugin, enabled: true, label: '画布导出', description: 'Ctrl+E 导出 PNG', usage: 'Ctrl+E 导出画布 / Ctrl+Shift+E 导出选中节点' },
```

- [ ] **Step 4: 验证** - `pnpm dev`，创建节点后按 Ctrl+E

- [ ] **Step 5: Commit**
```bash
git add src/canvas/core/plugins/canvas-export/ src/App.vue
git commit -m "feat: 添加 CanvasExportPlugin，支持导出画布/选中节点为 PNG"
```

---

## Part E: 新功能 - 小地图 + 缩放控件

### Task E1: 启用 VueFlow MiniMap 和 Controls

**Files:** Modify `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 更新 import**

在 Canvas.vue 的 import 中添加 `MiniMap, Controls`：
```typescript
import { VueFlow, useVueFlow, Position, MiniMap, Controls } from '@vue-flow/core'
```

- [ ] **Step 2: 在模板中添加组件**

在 `<VueFlow>` 标签内部（`</VueFlow>` 之前）添加：
```html
<MiniMap style="position:absolute;bottom:12px;right:12px;width:180px;height:120px"
  :node-stroke-color="'#3b82f6'" :mask-color="'rgba(0,0,0,0.08)'" :pannable="true" :zoomable="true" />
<Controls style="position:absolute;bottom:12px;left:12px"
  :show-zoom="true" :show-fit-view="true" :show-interactive="false" />
```

- [ ] **Step 3: 验证** - `pnpm dev`，确认右下角小地图、左下角缩放控件

- [ ] **Step 4: Commit**
```bash
git add src/canvas/core/Canvas.vue
git commit -m "feat: 启用 VueFlow MiniMap 和 Controls 组件"
```

---

## Part G: 新功能 - 多选批量属性

### Task G1: MultiSelectPlugin 注册批量 Toolbar

**Files:** Modify `src/canvas/core/plugins/multi-select/MultiSelectPlugin.ts`

- [ ] **Step 1: 注册命令和工具栏按钮**

在 `install` 函数中（快捷键注册之前）添加：
```typescript
context.commands.register({
  id: 'multi-select.batch-color', source: 'multi-select',
  run: (cmdCtx: any) => {
    const selectedIds = context.selection.getSelectedNodeIds()
    const color = prompt('输入颜色 (hex):', '#3b82f6')
    if (!color) return
    const allNodes = context.actions.getNodes()
    for (const id of selectedIds) {
      const node = allNodes.find(n => n.id === id)
      if (node) context.actions.updateNode(id, { data: { ...node.data, accentColor: color } } as any)
    }
  }
})

context.toolbars.register('multi-select', {
  id: 'multi-select.batch-color', source: 'multi-select',
  commandId: 'multi-select.batch-color', position: 'top',
  title: '批量改色', nodeTypes: [], order: 10,
  icon: `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 2a10 10 0 010 20"/></svg>`,
})
```

- [ ] **Step 2: 验证** - 选中 3 个节点，确认工具栏出现"批量改色"按钮

- [ ] **Step 3: Commit**
```bash
git add src/canvas/core/plugins/multi-select/MultiSelectPlugin.ts
git commit -m "feat: MultiSelectPlugin 添加批量改色工具栏按钮"
```

---

## Part H: 架构优化

### Task H1: 提取 useCanvasMenu composable

**Files:**
- Create: `src/canvas/core/composables/useCanvasMenu.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 创建 useCanvasMenu.ts**（完整代码见上文详细版）

将 Canvas.vue 中的 `menuState`、`menuContext`、`openMenu`、`closeMenu`、`openCreateNodeMenu` 提取到此文件。

- [ ] **Step 2: 修改 Canvas.vue** - 删除上述代码，替换为 `const canvasMenu = useCanvasMenu(...)`，更新模板引用

- [ ] **Step 3: 验证** - 右键菜单正常工作

- [ ] **Step 4: Commit**
```bash
git add src/canvas/core/composables/useCanvasMenu.ts src/canvas/core/Canvas.vue
git commit -m "refactor: 提取 useCanvasMenu composable"
```

---

### Task H2: 提取 useCanvasConnections composable

**Files:**
- Create: `src/canvas/core/composables/useCanvasConnections.ts`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 创建 useCanvasConnections.ts**（完整代码见上文详细版）

提取 `makeEdgeData`、`isValidConnection`、`createConnection`、`findSameConnection` 等。

- [ ] **Step 2: 修改 Canvas.vue** - 替换为 `const connections = useCanvasConnections(vueFlowInstance)`

- [ ] **Step 3: 验证** - 连线功能正常

- [ ] **Step 4: Commit**
```bash
git add src/canvas/core/composables/useCanvasConnections.ts src/canvas/core/Canvas.vue
git commit -m "refactor: 提取 useCanvasConnections composable"
```

---

### Task H3: 插件错误降级处理

**Files:** Modify `src/canvas/core/Canvas.vue`

- [ ] **Step 1: 修改 onMounted 插件安装逻辑**

在 `try { await manager.install(...) }` 外层改为：
```typescript
try {
  await manager.install({...})
} catch (err) {
  console.error('[Canvas] 插件安装失败，降级运行:', err)
}
// 无论如何都初始化画布
await bootstrap.loadInitialCanvas()
```

同时把面板注册等不依赖插件安装结果的逻辑移到 try-catch 外面。

- [ ] **Step 2: 验证** - 禁用 StoragePlugin 后画布仍能渲染

- [ ] **Step 3: Commit**
```bash
git add src/canvas/core/Canvas.vue
git commit -m "fix: 插件安装失败时画布降级运行，不阻塞初始化"
```

---