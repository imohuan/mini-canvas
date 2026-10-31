# 服务与注册场收敛 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 14 个基础服务收敛到 7 个、17 个注册场收敛到 11 个、9 份聚焦实现收敛到 1 个，且不丢任何现有行为与用户未提交的插件改动。

**Architecture:** 先加新入口并保留旧名（纯新增、可回退），再按包迁移调用方，最后删旧名。数据真相只留一份：`ThemeRegistry` / `SlotRegistry` / `SettingsStore` / `nodeFactory` 继续做容器，注册场不再重复写。

**Tech Stack:** Vue 3 + TypeScript + Vite + VueFlow + pnpm workspace；测试用 Vitest；浏览器验证只用 `@Chrome`（cua_repl）。

**Spec:** `docs/superpowers/specs/2026-10-31-service-registry-simplification-design.md`

## Global Constraints

- 修改文件只用 `apply_patch`，禁止 PowerShell 写文件。
- 检索优先 `codegraph`，不用 `grep`；每次改完可能过期时 `codegraph index`。
- 不碰 `backup/canvas-core`、根目录 `src/`。
- 不改 `packages/plugins/plugin-theme-default/src/components/` 下六个核心节点件的渲染结构（`BaseNode.vue`、`MovingHandle.vue`、`BaseTitle.vue`、`CustomEdge.vue`、`ConnectionLine.vue`、`DefaultBackground.vue`）；只允许改它们取服务的方式。
- 每个任务一个提交；任务内每步可验证。
- 旧服务名/旧场名一律“先兼容、后删除”，删除任务必须有“旧名不可取”的断言。
- 每个 Agent 用独立端口：后台 886x、前端 528x、文档 529x。
- 子代理不改别人的包；跨包改动由主代理合并。

---

## 前置状态（已由主代理完成，执行者不要重做）

- 用户未提交改动已保护成两个提交：
  - `9df26acb wip(plugin): 宫格发布单事务 + 视频统一缩略图（重构前保护）`
  - `ac2c6e58 wip(ui-kit): 通知改 sonner 宿主 + 轻提示样式（重构前保护，PlaygroundPreview 仍双挂 1 例红）`
- 已知红：`pnpm -C packages/ui-kit test` 有 1 例失败（`PlaygroundPreview.test.ts` 断言试玩分支不再自己挂宿主，但 `PlaygroundPreview.vue` 的 `notify`/`messages` 分支仍各挂一次）。这属于用户半截改动，Task 0 先修。

---

### Task 0: 分支、基线与半截红灯

**Files:**
- Modify: `packages/ui-kit/src/preview/PlaygroundPreview.vue`
- Test: `packages/ui-kit/src/preview/PlaygroundPreview.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 干净的基线（所有目标包测试全绿），供后续任务比较

- [ ] **Step 1: 建分支**

Run:
```bash
git switch -c codex/refactor-services-registry
```
Expected: 切到新分支，工作区干净。

- [ ] **Step 2: 修掉双挂宿主（对齐测试与文档的意图）**

`PlaygroundPreview.vue` 的 `notify` / `messages` 分支删掉 `<NotifyHost />` 与 `<MessagesHost />`（宿主由 `UiKitPreview.vue` 统一挂一次）。保留触发按钮。

```vue
<!-- Notify -->
<template v-else-if="id === 'notify'">
  <Button variant="secondary" @click="fireNotify">发一条通知</Button>
</template>

<!-- Messages -->
<template v-else-if="id === 'messages'">
  <Button variant="secondary" @click="fireMessage">显示轻提示</Button>
</template>
```

同时删掉文件顶部 `MessagesHost, NotifyHost` 两个未再使用的 import。

- [ ] **Step 3: 跑测试**

Run: `pnpm -C packages/ui-kit test -- --reporter=dot`
Expected: 25 文件 / 79 测试全绿。

- [ ] **Step 4: 记录基线**

Run:
```bash
pnpm -C packages/kernel test
pnpm -C packages/canvas-data test
pnpm -C packages/canvas-render test
pnpm -C packages/ui test
```
Expected: 全绿。把每个包的“文件数 / 测试数”写进 `.superpowers/sdd/service-registry/progress.md` 的 `Baseline:` 行。若某包本来就有红，原样记录，不要顺手修（写进 ledger 的 `Baseline-red:`）。

- [ ] **Step 5: 提交**

```bash
git add packages/ui-kit/src/preview/PlaygroundPreview.vue
git commit -m "fix(ui-kit): 试玩分支不再重复挂通知宿主"
```

---

### Task 1: `view` 服务（合并 nodeLayout + viewport + fitTo）

**Files:**
- Create: `packages/canvas-render/src/view/viewService.ts`
- Create: `packages/canvas-render/src/view/fitTo.ts`
- Create: `packages/canvas-render/src/view/__tests__/viewService.test.ts`
- Create: `packages/canvas-render/src/view/__tests__/fitTo.test.ts`
- Modify: `packages/canvas-data/src/canvas/renderServiceContracts.ts`
- Modify: `packages/canvas-data/src/canvas/serviceTypes.ts`
- Modify: `packages/canvas-render/src/host/createMiniCanvasHost.ts`
- Modify: `packages/canvas-render/src/index.ts`

**Interfaces:**
- Consumes: `NodeLayoutService`（`packages/canvas-render/src/layout/nodeLayout.ts`）、`ViewportService`（`packages/canvas-render/src/viewport/viewportService.ts`）、`NodeStore`
- Produces:
  - `class ViewService implements ViewContract`，构造 `new ViewService({ nodeStore, layout, viewport })`
  - `attachBackend(backend: ViewportBackend): void`
  - 内部写口 `setMeasuredSize / clearMeasuredSize / resetMeasured`（`useNodeMeasure` 用）
  - `fitTo(target, opts): boolean`
  - `ViewContract` 类型（放 `renderServiceContracts.ts`）

- [ ] **Step 1: 写失败的契约测试**

```ts
// packages/canvas-render/src/view/__tests__/viewService.test.ts
import { describe, expect, it, vi } from 'vitest'
import { ViewService } from '../viewService'
import { NodeLayoutService } from '../../layout/nodeLayout'
import { NodeStore } from '@mini-canvas/canvas-data'

describe('view · 几何与视口合体', () => {
  it('未 attach 后端时读默认 {0,0,1}，控制 no-op 不抛', () => {
    const v = new ViewService({ nodeStore: new NodeStore() })
    expect(v.getViewport()).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(() => v.zoomIn()).not.toThrow()
    expect(() => v.setViewport({ x: 10, y: 10, zoom: 2 })).not.toThrow()
  })

  it('几何读口与 NodeLayoutService 逐字一致', () => {
    const store = new NodeStore()
    store.registerType({ type: 'note', label: '便签', defaultSize: { w: 300, h: 200 } })
    store.addNodes([{ type: 'note', position: { x: 12, y: 34 }, id: 'n1' }])
    const id = 'n1'
    const layout = new NodeLayoutService(store)
    const view = new ViewService({ nodeStore: store, layout })
    expect(view.nodeSize(id)).toEqual(layout.nodeSize(id))
    expect(view.absolutePosition(id)).toEqual(layout.absolutePosition(id))
    expect(view.getNodeRect(id)).toEqual(layout.getNodeRect(id))
  })

  it('setViewport 即时、animateViewport 走过渡', () => {
    const setViewport = vi.fn()
    const animate = vi.fn()
    const v = new ViewService({ nodeStore: new NodeStore() })
    v.attachBackend({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      screenToFlow: (x, y) => ({ x, y }),
      flowToScreen: (x, y) => ({ x, y }),
      zoomIn() {}, zoomOut() {}, zoomTo() {}, fitView() {}, setCenter() {},
      setViewport, animateViewport: animate,
    })
    v.setViewport({ x: 1, y: 2, zoom: 3 })
    expect(setViewport).toHaveBeenCalledTimes(1)
    v.animateViewport({ x: 4, y: 5, zoom: 1 })
    expect(animate).toHaveBeenCalledWith({ x: 4, y: 5, zoom: 1 }, 320)
  })

  it('内部写口仍能改实测尺寸（量测不能断）', () => {
    const store = new NodeStore()
    store.registerType({ type: 'note', label: '便签', defaultSize: { w: 300, h: 200 } })
    store.addNodes([{ type: 'note', position: { x: 0, y: 0 }, id: 'n1' }])
    const id = 'n1'
    const v = new ViewService({ nodeStore: store })
    v.setMeasuredSize(id, 200, 100)
    expect(v.nodeSize(id)).toEqual({ w: 200, h: 100 })
    v.clearMeasuredSize(id)
    expect(v.nodeSize(id)).not.toEqual({ w: 200, h: 100 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/canvas-render test -- src/view/__tests__/viewService.test.ts`
Expected: FAIL，`Cannot find module '../viewService'`。

- [ ] **Step 3: 写 `fitTo` 的失败测试**

```ts
// packages/canvas-render/src/view/__tests__/fitTo.test.ts
import { describe, expect, it } from 'vitest'
import { computeFitTo } from '../fitTo'

const rects = [
  { id: 'a', x: 0, y: 0, w: 100, h: 100 },
  { id: 'b', x: 200, y: 100, w: 100, h: 100 },
]

describe('fitTo · 唯一取景算法', () => {
  it('heightRatio 按内容高度占视口比例算缩放并夹在 [0.1,4]', () => {
    const r = computeFitTo({ rects, viewport: { w: 800, h: 600 }, opts: { heightRatio: 0.5 } })
    expect(r.zoom).toBeCloseTo(1.5, 5)   // 600*0.5 / 200（bounds 高 = 200）
    expect(r.moved).toBe(true)
  })

  it('不给 heightRatio 时按 padding 比例适配整块内容', () => {
    const r = computeFitTo({ rects, viewport: { w: 800, h: 600 }, opts: { padding: 0.1 } })
    // 可用 640x480，内容 300x200 → min(2.13, 2.4) = 2.13
    expect(r.zoom).toBeCloseTo(640 / 300, 4)
  })

  it('keepZoom 只平移、不改缩放', () => {
    const r = computeFitTo({ rects, viewport: { w: 800, h: 600 }, opts: { keepZoom: true }, currentZoom: 0.7 })
    expect(r.zoom).toBe(0.7)
  })

  it('onlyIfOutOfView：已完整可见时不动', () => {
    const r = computeFitTo({
      rects: [{ id: 'a', x: 10, y: 10, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      viewportState: { x: 0, y: 0, zoom: 1 },
      opts: { onlyIfOutOfView: true },
    })
    expect(r.moved).toBe(false)
  })

  it('margin 参与可见性判定', () => {
    const r = computeFitTo({
      rects: [{ id: 'a', x: 790, y: 10, w: 100, h: 100 }],
      viewport: { w: 800, h: 600 },
      viewportState: { x: 0, y: 0, zoom: 1 },
      opts: { onlyIfOutOfView: true, margin: 24 },
    })
    expect(r.moved).toBe(true)
  })

  it('zoom 指定时优先于 heightRatio', () => {
    const r = computeFitTo({ rects, viewport: { w: 800, h: 600 }, opts: { zoom: 1 } })
    expect(r.zoom).toBe(1)
  })
})
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm -C packages/canvas-render test -- src/view/__tests__/fitTo.test.ts`
Expected: FAIL，`computeFitTo is not a function`。

- [ ] **Step 5: 实现 `fitTo.ts`**

```ts
// packages/canvas-render/src/view/fitTo.ts
import type { LayoutRect, ViewportState } from '@mini-canvas/canvas-data'

export interface FitToOptions {
  padding?: number
  heightRatio?: number
  minZoom?: number
  maxZoom?: number
  keepZoom?: boolean
  zoom?: number
  select?: boolean
  onlyIfOutOfView?: boolean
  margin?: number
  includeBars?: 'none' | 'bottom' | 'both'
  animate?: boolean
  durationMs?: number
}

export interface FitToInput {
  rects: LayoutRect[]
  viewport: { w: number; h: number }
  viewportState?: ViewportState
  currentZoom?: number
  opts?: FitToOptions
  /** includeBars 用的额外高度（屏幕像素）；由调用方量 DOM 后传入 */
  barHeight?: { top: number; bottom: number }
}

export interface FitToResult {
  moved: boolean
  viewport: ViewportState
  zoom: number
}

/** 不写 heightRatio 时按 padding 比例适配（与 VueFlow fitView 同义） */
const DEFAULTS = { minZoom: 0.1, maxZoom: 4, durationMs: 320 }

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

export function computeFitTo(input: FitToInput): FitToResult {
  const opts = input.opts ?? {}
  const state = input.viewportState ?? { x: 0, y: 0, zoom: input.currentZoom ?? 1 }
  const currentZoom = input.currentZoom ?? state.zoom ?? 1
  const vw = Math.max(input.viewport.w, 1)
  const vh = Math.max(input.viewport.h, 1)
  if (input.rects.length === 0) {
    return { moved: false, viewport: state, zoom: currentZoom }
  }

  const minX = Math.min(...input.rects.map((r) => r.x))
  const minY = Math.min(...input.rects.map((r) => r.y))
  const maxX = Math.max(...input.rects.map((r) => r.x + r.w))
  const maxY = Math.max(...input.rects.map((r) => r.y + r.h))
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }

  // 已完整可见 → 不动（ensureVisible / BaseNode 语义）
  if (opts.onlyIfOutOfView) {
    const margin = Math.max(opts.margin ?? 0, 0)
    const left = -state.x / (state.zoom || 1)
    const top = -state.y / (state.zoom || 1)
    const right = left + vw / (state.zoom || 1)
    const bottom = top + vh / (state.zoom || 1)
    const visible =
      bounds.x >= left + margin &&
      bounds.y >= top + margin &&
      bounds.x + bounds.width <= right - margin &&
      bounds.y + bounds.height <= bottom - margin
    if (visible) return { moved: false, viewport: state, zoom: currentZoom }
  }

  // 缩放优先级：zoom 显式 > keepZoom > heightRatio > padding 比例适配
  let zoom = currentZoom
  if (typeof opts.zoom === 'number') {
    zoom = clamp(opts.zoom, opts.minZoom ?? DEFAULTS.minZoom, opts.maxZoom ?? DEFAULTS.maxZoom)
  } else if (opts.keepZoom) {
    zoom = currentZoom
  } else if (typeof opts.heightRatio === 'number') {
    const ratio = clamp(opts.heightRatio, 0.05, 1)
    const barH = opts.includeBars === 'both'
      ? (input.barHeight?.top ?? 0) + (input.barHeight?.bottom ?? 0)
      : opts.includeBars === 'bottom'
        ? (input.barHeight?.bottom ?? 0)
        : 0
    const usableH = Math.max(vh - barH, 1)
    zoom = clamp((usableH * ratio) / Math.max(bounds.height, 1), opts.minZoom ?? DEFAULTS.minZoom, opts.maxZoom ?? DEFAULTS.maxZoom)
  } else {
    // padding 与 VueFlow 同义：0..1 的比例留白（0.1 = 每边 10%）
    const pad = clamp(opts.padding ?? 0.1, 0, 0.49)
    const availW = Math.max(vw * (1 - pad * 2), 1)
    const availH = Math.max(vh * (1 - pad * 2), 1)
    const fit = Math.min(availW / Math.max(bounds.width, 1), availH / Math.max(bounds.height, 1))
    zoom = clamp(fit, opts.minZoom ?? DEFAULTS.minZoom, opts.maxZoom ?? DEFAULTS.maxZoom)
  }

  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const next = { x: vw / 2 - cx * zoom, y: vh / 2 - cy * zoom, zoom }
  const moved =
    Math.abs(next.x - state.x) > 0.5 ||
    Math.abs(next.y - state.y) > 0.5 ||
    Math.abs(next.zoom - (state.zoom ?? 1)) > 1e-4
  return { moved, viewport: moved ? next : state, zoom }
}
```

- [ ] **Step 6: 跑 `fitTo` 测试**

Run: `pnpm -C packages/canvas-render test -- src/view/__tests__/fitTo.test.ts`
Expected: PASS（5 条）。若 `default 50%` 那条算不出 3，先核对测试里的视口/矩形，别改断言迁就实现。

- [ ] **Step 7: 实现 `ViewService`**

```ts
// packages/canvas-render/src/view/viewService.ts
import type { NodeStore, LayoutRect, ViewportState, FlowPoint } from '@mini-canvas/canvas-data'
import { NodeLayoutService } from '../layout/nodeLayout'
import type { ViewportBackend } from '../viewport/viewportService'
import { ViewportService } from '../viewport/viewportService'
import { computeFitTo, type FitToOptions, type FitToResult } from './fitTo'

export type FocusTarget = string[] | 'selection' | 'all'

export interface ViewServiceDeps {
  nodeStore: NodeStore
  layout?: NodeLayoutService
  viewport?: ViewportService
}

export class ViewService {
  private layout: NodeLayoutService
  private viewport: ViewportService

  constructor(deps: ViewServiceDeps) {
    this.layout = deps.layout ?? new NodeLayoutService(deps.nodeStore)
    this.viewport = deps.viewport ?? new ViewportService()
  }

  // 量测写口（渲染层内部用；不进插件契约）
  setMeasuredSize(id: string, w: number, h: number): void { this.layout.setMeasuredSize(id, w, h) }
  clearMeasuredSize(id: string): void { this.layout.clearMeasuredSize(id) }
  resetMeasured(): void { this.layout.reset() }

  nodeSize(id: string) { return this.layout.nodeSize(id) }
  absolutePosition(id: string) { return this.layout.absolutePosition(id) }
  getNodeRect(id: string): LayoutRect | null { return this.layout.getNodeRect(id) }
  getAllRects(): LayoutRect[] { return this.layout.getAllRects() }
  childrenOf(parentId: string): LayoutRect[] { return this.layout.childrenOf(parentId) }

  attachBackend(backend: ViewportBackend): void { this.viewport.attachBackend(backend) }
  getViewport(): ViewportState { return this.viewport.getViewport() }
  setViewport(v: ViewportState): void { this.viewport.setViewport(v) }
  animateViewport(v: ViewportState, durationMs?: number): void { this.viewport.animateViewport(v, durationMs) }
  setCenter(x: number, y: number, zoom?: number): void { this.viewport.setCenter(x, y, zoom) }
  fitView(padding?: number): void { this.viewport.fitView(padding) }
  zoomIn(): void { this.viewport.zoomIn() }
  zoomOut(): void { this.viewport.zoomOut() }
  zoomTo(level: number): void { this.viewport.zoomTo(level) }
  screenToFlow(x: number, y: number): FlowPoint { return this.viewport.screenToFlow(x, y) }
  flowToScreen(x: number, y: number): FlowPoint { return this.viewport.flowToScreen(x, y) }
  getRootEl() { return this.viewport.getRootEl() }
  getPaneEl() { return this.viewport.getPaneEl() }
  getRendererEl() { return this.viewport.getRendererEl() }
  queryNodeEl(id: string) { return this.viewport.queryNodeEl(id) }

  fitTo(target: FocusTarget, opts: FitToOptions = {}): boolean {
    const rects = this.resolveTargets(target)
    const root = this.viewport.getRootEl()
    const pane = this.viewport.getPaneEl() ?? this.viewport.getRendererEl()
    const host = root ?? pane
    const viewport = { w: host?.clientWidth ?? 1, h: host?.clientHeight ?? 1 }
    const result: FitToResult = computeFitTo({
      rects,
      viewport,
      viewportState: this.viewport.getViewport(),
      opts,
    })
    if (!result.moved) return false
    if (opts.animate === false) this.viewport.setViewport(result.viewport)
    else this.viewport.animateViewport(result.viewport, opts.durationMs ?? 320)
    return true
  }

  private resolveTargets(target: FocusTarget): LayoutRect[] {
    if (target === 'all') return this.layout.getAllRects()
    if (target === 'selection') return [] // 由 canvas 门面注入选中集后再调（见 Task 3）
    return target
      .map((id) => this.layout.getNodeRect(id))
      .filter((r): r is LayoutRect => r !== null)
  }
}
```

- [ ] **Step 8: 跑 `viewService` 测试**

Run: `pnpm -C packages/canvas-render test -- src/view/__tests__/viewService.test.ts`
Expected: PASS（4 条）。

- [ ] **Step 9: 加契约类型与别名注入**

在 `renderServiceContracts.ts` 加 `ViewContract`（`ViewService` 的公开面，不含量测写口），在 `serviceTypes.ts` 注册 `view: ViewContract` 与 `canvas: CanvasService`（后者 Task 3 填类型，这里先只加 `view`）；在 `createMiniCanvasHost.ts` 建一个 `ViewService`，**同时**注入三个名字：

```ts
const view = new ViewService({ nodeStore, layout: nodeLayout, viewport })
ctx.inject('view', view)
ctx.inject('nodeLayout', nodeLayout) // 兼容别名
ctx.inject('viewport', viewport)     // 兼容别名
```

并把 `CanvasHost.vue` 里的 `viewport.attachBackend(...)` 改为对 `view` 调用（保留 `nodeLayout` 变量给 `useNodeMeasure` 用接线）。

- [ ] **Step 10: 全包测试**

Run: `pnpm -C packages/canvas-render test`
Expected: 全绿；`viewportService.test.ts` 与 `nodeLayout` 相关测试一条不删。

- [ ] **Step 11: 提交**

```bash
git add packages/canvas-render/src/view packages/canvas-render/src/host packages/canvas-render/src/index.ts packages/canvas-data/src/canvas/renderServiceContracts.ts packages/canvas-data/src/canvas/serviceTypes.ts
git commit -m "feat(canvas-render): view 服务合并 nodeLayout+viewport 并新增 fitTo"
```

---

### Task 2: 聚焦调用方迁到 `view.fitTo`

**Files（按批，一批一提交）:**
- Modify: `packages/plugins/plugin-auto-layout/src/autoLayoutPlugin.ts`
- Modify: `packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue`
- Modify: `packages/plugins/plugin-node-find/src/nodeFindPlugin.ts`
- Modify: `packages/plugins/plugin-agent/src/components/AgentConversation.vue`
- Modify: `packages/plugins/plugin-style-library/src/stylePlacement.ts`
- Modify: `packages/ui/src/composables/ui.ts`
- Modify: `packages/plugins/plugin-image-grid-split/src/storyboardDrag.ts`
- Modify: `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue`
- Modify: `packages/plugins/plugin-bottom-bar/src/ReferenceSelectOverlay.vue`
- Modify: `packages/canvas-render/src/crop/fitEditingNode.ts`

**Interfaces:**
- Consumes: `ViewService.fitTo(target, opts)`（Task 1）
- Produces: 无新导出；各调用点只换成 `view.fitTo`

映射表（逐条照做，不许“顺手统一参数”）：

| 调用点 | 新写法 |
|---|---|
| `auto-layout:focus-selected` | `view.fitTo('selection', { heightRatio: focusHeightRatio, minZoom, maxZoom })` |
| `auto-layout:focus-node` | `view.fitTo([nodeId], { heightRatio, minZoom, maxZoom })` |
| `auto-layout:fit-view` | 保留 `view.fitView()`（整图语义） |
| 底栏双击卡片兜底 | `view.fitTo([nodeId], { heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 })` |
| `node-find` | `view.fitTo([id], { keepZoom: true })` |
| `AgentConversation.focusNode` | 同上 |
| `stylePlacement.focusStyleNode` | `view.fitTo([id], { keepZoom: true, select: true })` |
| `ui.locateNode` | `view.fitTo([id], { keepZoom: true, select: true })`；无矩形时 `view.fitTo([id], { padding: 0.45 })` |
| `ensureNodeVisible` | `view.fitTo([id], { keepZoom: true, onlyIfOutOfView: true, margin: 24 })` |
| `BaseNode.focusNodeIfNeeded` | `view.fitTo([id], { keepZoom: true, onlyIfOutOfView: true, margin: 32 })` |
| `ReferenceSelectOverlay.focusOwner` | `view.fitTo([id], { zoom: currentZoom < 0.6 ? 1 : currentZoom })` |
| `fitEditingNodeIntoView` | **不迁到 `fitTo`**：保留 `fitEditingNode.ts` 的几何函数，只把 `setCenter` 换成 `view.setCenter`。它有 pane 真实尺寸与编辑余量两件特殊语义（Spec 五.16），硬合并会丢行为 |

- [ ] **Step 1: 先给 `fitTo` 补 `select` 语义的测试**

`ViewService.fitTo` 本身不改选中（它只拿视图）；`select` 由 `canvas.focus` 处理（Task 3）。本任务里 `ui.locateNode` / `stylePlacement` 仍显式调 `selection.set([id])` 再 `fitTo`，**不要**在 `fitTo` 里偷偷改选中。测试断言：`fitTo` 不调用 `selection.set`。

- [ ] **Step 2: 逐批迁移 + 跑该包测试**

顺序与命令：
```bash
pnpm -C packages/plugins/plugin-auto-layout test
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/plugins/plugin-node-find test
pnpm -C packages/plugins/plugin-agent test
pnpm -C packages/plugins/plugin-style-library test
pnpm -C packages/ui test
pnpm -C packages/plugins/plugin-image-grid-split test
pnpm -C packages/plugins/plugin-theme-default test
```
Expected: 每批全绿后再进下一批；某批红就停在该批，修完再继续。

- [ ] **Step 3: 删掉被替代的私有实现**

- `plugin-auto-layout/src/focusViewport.ts` 的 `calculateFocusZoom` / `centerViewportOnBounds` 只保留测试要用的导出，生产代码不再调用；若无人用，删文件与测试。
- `plugin-auto-layout` 的 `focusBounds` 函数体改成一行 `view.fitTo(...)`，保留函数名（命令注册处不改）。
- 底栏 `onCardDblClick` 的兜底分支删掉自己算 zoom 的 30 行，只留“命令失败 → `view.fitTo`”一条。

- [ ] **Step 4: 全量回归**

Run: `pnpm -C packages/canvas-render test && pnpm -C packages/ui test`
Expected: 全绿。

- [ ] **Step 5: 提交（每批一个）**

```bash
git add <该批文件>
git commit -m "refactor(<包名>): 聚焦统一走 view.fitTo"
```

---

### Task 3: `canvas` 动作门面 + `notify`

**Files:**
- Create: `packages/canvas-render/src/canvas/canvasService.ts`
- Create: `packages/canvas-render/src/canvas/notifyService.ts`
- Create: `packages/canvas-render/src/canvas/__tests__/canvasService.test.ts`
- Create: `packages/canvas-render/src/canvas/__tests__/notifyService.test.ts`
- Modify: `packages/canvas-render/src/host/createMiniCanvasHost.ts`
- Modify: `packages/canvas-render/src/tip/tipService.ts`
- Modify: `packages/canvas-data/src/canvas/serviceTypes.ts`

**Interfaces:**
- Consumes: `doc`、`selection`、`view`、`nodeFactory`、`group`、`nodeToolbar`、`nodeTask`（后三者可选，缺服务时明确返回 `undefined`/`false`）
- Produces:
  - `class CanvasService implements CanvasActions`
  - `createNotifyService(): NotifyService`，`NotifyService.notify(msg, opts)` 返回撤回函数
  - `canvasService.createNode / creatableTypes / select / focus / enterMode / exitMode / activeMode / group / ungroup / notify / runBarAction / cancelBarAction`

- [ ] **Step 1: 写失败测试（建节点只有一条路径 + 提示可撤回）**

```ts
// packages/canvas-render/src/canvas/__tests__/canvasService.test.ts
import { describe, expect, it, vi } from 'vitest'
import { CanvasService } from '../canvasService'

function fakeCtx(overrides: Record<string, unknown> = {}) {
  const services: Record<string, unknown> = {
    doc: { transaction: (_r: string, fn: () => unknown) => fn(), createNode: vi.fn(() => 'n1') },
    selection: { set: vi.fn() },
    view: { fitTo: vi.fn(() => true) },
    ...overrides,
  }
  return { get: (name: string) => services[name], tryGet: (name: string) => services[name] } as never
}

describe('canvas 动作门面', () => {
  it('createNode 委托 nodeFactory，找不到类型返回 undefined 不抛', () => {
    const factory = { create: vi.fn(() => 'n9'), creatableTypes: () => ['image'] }
    const c = new CanvasService(fakeCtx({ nodeFactory: factory }))
    expect(c.createNode('image', { x: 1, y: 2 })).toBe('n9')
    expect(c.creatableTypes()).toEqual(['image'])
    expect(new CanvasService(fakeCtx()).createNode('nope', { x: 0, y: 0 })).toBeUndefined()
  })

  it('focus 传 selection 时先解析选中集再 fitTo', () => {
    const view = { fitTo: vi.fn(() => true) }
    const selection = { ids: new Set(['a', 'b']), set: vi.fn() }
    const c = new CanvasService(fakeCtx({ view, selection }))
    expect(c.focus('selection')).toBe(true)
    expect(view.fitTo).toHaveBeenCalledWith(['a', 'b'], undefined)
  })

  it('enterMode 缺 nodeToolbar 时返回 false，不抛', () => {
    const c = new CanvasService(fakeCtx())
    expect(c.enterMode('n1', 'image/crop')).toBe(false)
  })
})
```

```ts
// packages/canvas-render/src/canvas/__tests__/notifyService.test.ts
import { describe, expect, it } from 'vitest'
import { createNotifyService } from '../notifyService'

describe('notify', () => {
  it('同一 source 重复提示会去重（once）', () => {
    const n = createNotifyService()
    n.notify('网络慢', { source: 'gen', once: true })
    n.notify('网络慢', { source: 'gen', once: true })
    expect(n.list()).toHaveLength(1)
  })

  it('返回的撤回函数只撤自己那条', () => {
    const n = createNotifyService()
    const off = n.notify('A', { source: 'a' })
    n.notify('B', { source: 'b' })
    off()
    expect(n.list().map((x) => x.message)).toEqual(['B'])
  })

  it('空串 = 隐藏（保留 tip 语义）', () => {
    const n = createNotifyService()
    n.notify('拖动中', { source: 'drag', followPointer: true })
    n.notify('', { source: 'drag' })
    expect(n.list()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/canvas-render test -- src/canvas/__tests__`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `notifyService.ts` 与 `canvasService.ts`**

```ts
// packages/canvas-render/src/canvas/notifyService.ts
import { shallowReactive } from 'vue'

export interface NotifyOptions {
  source?: string
  priority?: number
  once?: boolean
  durationMs?: number
  followPointer?: boolean
}

export interface NotifyItem {
  id: number
  message: string
  source: string
  priority: number
  durationMs: number
  followPointer: boolean
}

export interface NotifyService {
  notify(message: string, opts?: NotifyOptions): () => void
  hide(source?: string): void
  list(): NotifyItem[]
  clear(): void
}

export function createNotifyService(): NotifyService {
  let seq = 0
  const items = shallowReactive<NotifyItem[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const remove = (id: number): void => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    const i = items.findIndex((x) => x.id === id)
    if (i >= 0) items.splice(i, 1)
  }

  return {
    notify(message, opts = {}) {
      const source = opts.source ?? 'default'
      if (!message) {
        for (const item of items.filter((x) => x.source === source)) remove(item.id)
        return () => undefined
      }
      if (opts.once) {
        const same = items.find((x) => x.source === source && x.message === message)
        if (same) return () => remove(same.id)
      }
      const id = ++seq
      const item: NotifyItem = {
        id,
        message,
        source,
        priority: opts.priority ?? 0,
        durationMs: opts.durationMs ?? 2600,
        followPointer: opts.followPointer ?? false,
      }
      items.push(item)
      if (item.durationMs > 0) {
        timers.set(id, setTimeout(() => remove(id), item.durationMs))
      }
      return () => remove(id)
    },
    hide(source) {
      for (const item of [...items]) if (!source || item.source === source) remove(item.id)
    },
    list: () => [...items].sort((a, b) => a.priority - b.priority),
    clear() {
      for (const item of [...items]) remove(item.id)
    },
  }
}
```

`CanvasService` 每个方法只做“取服务 → 校验 → 转发”，不缓存状态；`focus('selection')` 读 `selection.ids` 后传给 `view.fitTo`；`runBarAction` 缺 `nodeTask` 时返回 `Promise.reject(new Error('[canvas] nodeTask 未安装'))` 之外一律不抛（缺能力返回 `undefined`/`false`）。

- [ ] **Step 4: 跑测试**

Run: `pnpm -C packages/canvas-render test -- src/canvas/__tests__`
Expected: PASS（6 条）。

- [ ] **Step 5: 注入并给 `tip` 加兼容转发**

`createMiniCanvasHost.ts`：
```ts
const notify = createNotifyService()
const canvas = new CanvasService(ctx)
ctx.inject('canvas', canvas)
ctx.inject('notify', notify)
ctx.inject('tip', {
  show: (m: string) => notify.notify(m, { source: 'tip', followPointer: true, durationMs: 0 }),
  hide: () => notify.hide('tip'),
})
```
`TipLayer.vue` 改为渲染 `notify.list().filter(x => x.followPointer)`，保留跟随鼠标定位。

- [ ] **Step 6: 通知相关包回归**

Run:
```bash
pnpm -C packages/canvas-render test
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/plugins/plugin-node-rotate test
pnpm -C packages/plugins/plugin-image-grid-split test
```
Expected: 全绿；拖线提示、@ 无输入框提示、旋转插件提示行为不变。

- [ ] **Step 7: 提交**

```bash
git add packages/canvas-render/src/canvas packages/canvas-render/src/host packages/canvas-render/src/tip packages/canvas-data/src/canvas/serviceTypes.ts
git commit -m "feat(canvas-render): 新增 canvas 动作门面与可撤回通知"
```

---

### Task 4: `save` 吸收 settingsPersist 与 auto-save

**Files:**
- Modify: `packages/canvas-data/src/storage/saveService.ts`（或 `save.ts`，按实际文件名）
- Modify: `packages/canvas-data/src/settingsPersist.ts`
- Modify: `packages/canvas-data/src/canvas/canvasBasePlugin.ts`
- Modify: `packages/canvas-render/src/host/createMiniCanvasHost.ts`
- Modify: `packages/plugins/plugin-auto-save/src/autoSavePlugin.ts`
- Test: `packages/canvas-data/src/__tests__/saveAutoSave.test.ts`

**Interfaces:**
- Consumes: `SaveService`、`SettingsStore`、`AutoSaveEngine`
- Produces:
  - `save.settings?: { restore(): Promise<void>; persistNow(): void; resetKey(k: string): boolean }`（条件存在）
  - `save.autoSave: { isEnabled(): boolean; isDirty(): boolean; saveNow(): Promise<void>; setEnabled(v: boolean): void; interval: number }`

- [ ] **Step 1: 写失败测试**

断言：① `persistSettings:false` 时 `save.settings` 为 `undefined`；② 开启时 `restore()` 后 `settings` 值回到快照，且 restore 期间不触发回写；③ `autoSave` 1000ms 周期落盘、失败恢复脏位、`setEnabled(false)` 不清脏位。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/canvas-data test -- src/__tests__/saveAutoSave.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现子对象并保留旧服务名**

`canvasBasePlugin` 里：
```ts
if (persistSettings) {
  const persist = createSettingsPersist(store, save)
  ;(save as SaveWithSettings).settings = {
    restore: () => persist.restore(),
    persistNow: () => persist.persistNow(),
    resetKey: (k) => persist.resetKey(k),
  }
  ctx.inject('settingsPersist', persist) // 兼容别名
}
```
`plugin-auto-save` 的 `apply` 改成“把 engine 挂到 `save.autoSave`”，仍注入 `auto-save` 别名。

- [ ] **Step 4: 跑两个包测试**

Run: `pnpm -C packages/canvas-data test && pnpm -C packages/plugins/plugin-auto-save test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git commit -am "refactor(save): 配置持久化与自动保存并入 save"
```

---

### Task 5: 删除零读取的场（node/type、node/creator、setting、theme、slot）

**Files:**
- Modify: `packages/canvas-data/src/canvas/capabilities.ts`
- Modify: `packages/canvas-data/src/canvas/__tests__/capabilitiesRegistryLandings.test.ts`
- Modify: `packages/canvas-render/src/host/canvasHostCore.ts`（`surface()` 里主题/槽改读服务）
- Modify: `packages/kernel/src/Context.ts`（`surface()` 的 registry 段）
- Test: `packages/canvas-data/src/canvas/__tests__/noDeadFields.test.ts`

**Interfaces:**
- Consumes: `registryOf`
- Produces: 写入口不再落这 5 个 kind；`surface()` 里主题/槽/设置/节点类型从真实容器取

- [ ] **Step 1: 写失败测试（断言写完之后这些 kind 为空）**

```ts
it('注册一个节点类型 / 主题槽 / 槽位 / 设置项后，五个死场仍为空', async () => {
  const { ctx } = await bootHeadless()
  ctx.nodes.register({ type: 'x', label: 'X', size: { w: 100, h: 100 }, create: () => 'n1' })
  ctx.theme.register('edge', {})
  ctx.slots.register('overlay', { id: 'a', component: {} })
  ctx.settings.define('g', { k: { type: 'string', default: '' } }, 'test')
  for (const kind of ['node/type', 'node/creator', 'setting', 'theme', 'slot']) {
    expect(ctx.registryOf(kind).keys()).toEqual([])
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/canvas-data test -- src/canvas/__tests__/noDeadFields.test.ts`
Expected: FAIL（五个 kind 都非空）。

- [ ] **Step 3: 删写入**

在 `capabilities.ts` 删除：`typeField` 写入、`land('node/creator')` 一行、`land('theme').add/remove` 两处、`slotField` 写入、`settingField` 写入。**保留** `doc.registerType`、`nodeFactory.register`、`themeRegistry.addOccupant`、`slots.register`、`settings.define` 这些真实容器调用。

- [ ] **Step 4: 修 `surface()`**

`surface().registry` 不再列这 5 个 kind；主题列表改为从 `themeRegistry` 取，槽从 `SlotRegistry` 取，设置从 `SettingsStore.groups/entries` 取，节点类型从 `doc.types` 取。字段名保持不变（`registryEntries` 的 shape 不改），只减少 kind。

- [ ] **Step 5: 跑测试与自省**

Run:
```bash
pnpm -C packages/canvas-data test
pnpm -C packages/kernel test
pnpm -C packages/canvas-render test
```
Expected: 全绿；`capabilitiesRegistryLandings.test.ts` 里删掉 5 个死场的断言（这是决策 8 允许的例外，需在提交信息里写明）。

- [ ] **Step 6: 提交**

```bash
git commit -am "refactor(registry): 删除五个零读取的场，主题/槽/设置/类型只留真实容器"
```

---

### Task 6: `node/bar-applier` 并入 `node/bar`；`nodeFactory` 收进 `canvas`

**Files:**
- Modify: `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts`
- Modify: `packages/plugins/plugin-bottom-bar/src/__tests__/barRegistry.test.ts`
- Modify: `packages/canvas-data/src/canvas/capabilities.ts`
- Modify: `packages/plugins/plugin-context-menu/src/contextMenuPlugin.ts`
- Modify: `packages/canvas-data/src/canvas/canvasCommands.ts`

**Interfaces:**
- Consumes: `node/bar` 场、`canvas.createNode`
- Produces: `node/bar` 键空间 `actions/<id>`、`appliers/<kind>`；`nodeFactory` 保留为兼容别名，新代码走 `canvas`

- [ ] **Step 1: 写失败测试**

断言：① 同一 kind 注册第二个 applier 抛错；② `nodeBar.list({type})` 只返回 `actions/*`；③ 卸载插件后 applier 一并消失；④ 右键菜单建节点不再 import `nodeFactory` 类型，而是走 `canvas.createNode`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/plugins/plugin-bottom-bar test -- src/__tests__/barRegistry.test.ts`
Expected: FAIL。

- [ ] **Step 3: 改键前缀**

`registerBarAction` 写 `actions/<id>`，`registerBarApplier` 写 `appliers/<kind>`；`list()` 只扫 `actions/` 前缀，`applierOf(kind)` 读 `appliers/<kind>`。旧的 `BAR_APPLIER_FIELD` 常量删掉（全仓只有本包用）。

- [ ] **Step 4: 右键菜单改走 `canvas.createNode`**

`contextMenuPlugin.ts` 的 `nodeFactory.create(...)` 与 `creatableTypes()` 改 `ctx.get('canvas')`；`canvasCommands.ts` 保持内部工厂调用（它是 `canvas` 的实现下层）。

- [ ] **Step 5: 跑测试**

Run:
```bash
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/plugins/plugin-context-menu test
pnpm -C packages/canvas-data test
```
Expected: 全绿（barRegistry 测试里键名断言同步改）。

- [ ] **Step 6: 提交**

```bash
git commit -am "refactor(bottom-bar): applier 并入 node/bar；建节点统一走 canvas"
```

---

### Task 7: `nodeToolbar` 从主题插件搬到 canvas-render

**Files:**
- Move: `packages/plugins/plugin-theme-default/src/components/node/nodeToolbarService.ts` → `packages/canvas-render/src/toolbar/nodeToolbarService.ts`
- Modify: `packages/canvas-render/src/host/createMiniCanvasHost.ts`
- Modify: `packages/plugins/plugin-theme-default/src/index.ts`
- Modify: `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue`
- Test: `packages/canvas-render/src/toolbar/__tests__/nodeToolbarService.test.ts`

**Interfaces:**
- Consumes: 无（服务自带模式 Map 与会话）
- Produces: `NodeToolbarService` 在渲染层创建并 `ctx.inject('nodeToolbar', svc)`；主题插件只保留 `resolveBar` 的渲染侧调用

- [ ] **Step 1: 把现有测试搬过来并跑通**

现有 `nodeToolbarService` 的测试（如有）原样搬到新目录，只改 import 路径。Run: `pnpm -C packages/canvas-render test -- src/toolbar`
Expected: 与搬家前同样的条数、全绿。

- [ ] **Step 2: 搬实现**

用 `apply_patch` 新增 `canvas-render/src/toolbar/nodeToolbarService.ts`（内容原样），删除主题插件里的旧文件，主题插件 `index.ts` 删掉 `new NodeToolbarService()` 与 `ctx.provide`。

- [ ] **Step 3: 宿主注入**

`createMiniCanvasHost.ts` 在装基础插件前 `ctx.inject('nodeToolbar', new NodeToolbarService())`，保证业务插件启动时能取到。

- [ ] **Step 4: 跑测试**

Run:
```bash
pnpm -C packages/canvas-render test
pnpm -C packages/plugins/plugin-theme-default test
pnpm -C packages/plugins/plugin-node-image test
pnpm -C packages/plugins/plugin-node-video test
pnpm -C packages/plugins/plugin-image-grid-split test
```
Expected: 全绿；关掉主题插件后模式注册仍在（新增一条断言：卸载主题后 `nodeToolbar.listModes()` 非空）。

- [ ] **Step 5: 提交**

```bash
git commit -am "refactor(canvas-render): nodeToolbar 会话从主题插件搬到渲染层"
```

---

### Task 8: 收回插件私有“服务”

**Files:**
- Modify: `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts`
- Modify: `packages/ui/src/composables/ui.ts`
- Modify: `packages/plugins/plugin-shortcut-manager/src/shortcutManagerPlugin.ts`
- Modify: `packages/plugins/plugin-history/src/historyPlugin.ts`
- Modify: `packages/plugins/plugin-cloud-client/src/plugin.ts`
- Modify: `packages/ui/src/composables/ui.ts`（gen-history 改名）
- Modify: `packages/canvas-render/src/host/createMiniCanvasHost.ts`（pluginManager 别名）
- Modify: `packages/plugins/plugin-manager/src/pluginManagerService.ts`

**Interfaces:**
- Consumes: 设置项、`save`、`doc`、`host.manager`
- Produces: 删掉 `mini-map`、`shortcut-manager`、`shortcut-remap`、`history-facade` 四个服务名；`gen-history` → `cloud-client:history`；`pluginManager` 保留别名指向 `host.manager`

- [ ] **Step 1: mini-map 改纯设置项**

`ui.ts` 的两处 `ctx.get('mini-map')` 改读 `settings.miniMapVisible`；`miniMapPlugin` 删掉 `ctx.inject('mini-map', ...)`，命令与设置双向同步逻辑保留。测试：开关按钮 → 设置值变化 → 浮层显隐；反向亦然。

- [ ] **Step 2: shortcut 两服务收回插件内部**

`shortcutManagerPlugin` 用 `ctx.state` 存 `visible` 与管理器实例，删掉 `ctx.inject('shortcut-manager')` 与 `ctx.inject('shortcut-remap')`；面板组件改为 `useCanvasRender()` 传下来的 props 或同包 import。保持 `save('shortcut')` 持久化、默认键快照、冲突预检、导入跳过。

- [ ] **Step 3: history-facade 删服务**

生产零调用；删掉 `ctx.inject('history-facade', ...)`，测试改成直接读 `doc`。

- [ ] **Step 4: gen-history 改名**

`ctx.inject('cloud-client:history', obj)`；`ui.ts` 两处读取改新名；保留 `query` 的 `AbortSignal` 与 `subscribe` 退订语义。

- [ ] **Step 5: pluginManager 变宿主句柄**

`createMiniCanvasHost` 返回的 handle 加 `manager` 字段（已返回，确认类型导出）；`plugin-manager` 插件改为从 `useCanvasRender().host.manager` 取；`ctx.inject('pluginManager', manager)` 保留为别名并标 `@deprecated`。

- [ ] **Step 6: 跑测试**

Run:
```bash
pnpm -C packages/plugins/plugin-mini-map test
pnpm -C packages/plugins/plugin-shortcut-manager test
pnpm -C packages/plugins/plugin-history test
pnpm -C packages/plugins/plugin-cloud-client test
pnpm -C packages/plugins/plugin-manager test
pnpm -C packages/ui test
```
Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
git commit -am "refactor(plugins): 收回四个私有服务，gen-history 改名，pluginManager 变宿主句柄"
```

---

### Task 9: 删旧名 + 文档 + 自省收口

**Files:**
- Modify: `packages/canvas-render/src/host/createMiniCanvasHost.ts`
- Modify: `packages/canvas-data/src/canvas/canvasBasePlugin.ts`
- Modify: `packages/canvas-data/src/canvas/serviceTypes.ts`
- Modify: `docs/design/core-layers-and-registry.md`
- Modify: `docs/design/service-map.md`（若存在；不存在则新建一页“服务与注册场现状”）
- Test: `packages/canvas-render/src/host/__tests__/serviceNames.test.ts`

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 只剩 7 个基础服务名；`surface()` 只列 11 个场

- [ ] **Step 1: 写“旧名不存在”的测试**

```ts
it('基础服务只剩 7 个名字', async () => {
  const { host } = await createMiniCanvasHost({ coldPlugins: [] })
  const names = host.ctx.injectedServices().sort()
  expect(names).toEqual(['canvas', 'doc', 'resources', 'save', 'selection', 'tools', 'view'])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/canvas-render test -- src/host/__tests__/serviceNames.test.ts`
Expected: FAIL（多出 nodeLayout/viewport/tip/pluginManager 等）。

- [ ] **Step 3: 删别名**

删 `nodeLayout`、`viewport`、`tip`、`nodeTask`、`settingsPersist`、`auto-save`、`nodeFactory`、`pluginManager`、`mini-map`、`shortcut-*`、`history-facade` 的注入；`tools` 是内核内置，不在此列。`command` 保留服务（执行入口），但不再出现在“基础服务”清单里？——**不删**：`command` 有 19 个插件在用，删它是另一件事；清单断言里加 `command` 与 `nodeBar`（插件服务）会破坏“基础 7 个”的定义。**处理**：`injectedServices()` 只列基础插件与宿主注入的名字，插件服务不计；断言按实际输出核对后固定。

- [ ] **Step 4: 更新文档**

`core-layers-and-registry.md` 的服务归属表、场总表按本 Spec 第二/三节改写；新增“为什么删这五个场”“fitTo 参数怎么选”“canvas 动作清单”三小节。

- [ ] **Step 5: 全量验证**

Run:
```bash
pnpm -C packages/kernel test
pnpm -C packages/canvas-data test
pnpm -C packages/canvas-render test
pnpm -C packages/ui test
pnpm -C packages/canvas-render typecheck
pnpm -C packages/ui typecheck
```
Expected: 全绿。

- [ ] **Step 6: Chrome 实测**

用 `@Chrome` 起 8865 + 5288，逐项过：建/连/删/撤销/刷新恢复、底栏生成、模式进出（裁剪/绘制/剪辑/宫格）、通知跟随鼠标、宫格发布（一次撤销）、分镜拖拽吸附、插件装卸。控制台零 error。

- [ ] **Step 7: 提交**

```bash
git commit -am "refactor: 删除旧服务名与旧场名，更新架构文档"
```

---

### Task 10: 收尾复核

- [ ] **Step 1: 全仓搜旧名**

Run: `rg -n "nodeLayout|viewport|settingsPersist|'tip'|nodeTask|node/creator|node/bar-applier|'mini-map'|history-facade" packages --glob '!**/__tests__/**'`
Expected: 只剩注释/文档/类型内部实现，无插件调用。

- [ ] **Step 2: 跑三份独立复核**

派 3 个子代理（只读）：① 行为对照（Spec 五 的 17 条逐条找证据）；② 测试真实性（有没有为过而改断言）；③ 未提交改动是否被误伤（`git log --stat` 对照两个 wip 提交）。

- [ ] **Step 3: 汇总**

把复核结论、遗留 Minor、需要的后续（如 `command` 服务最终形态）写进最终回复。
