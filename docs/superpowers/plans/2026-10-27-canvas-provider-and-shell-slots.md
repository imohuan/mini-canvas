# CanvasProvider 与外壳插槽 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 把画布上下文从 CanvasHost 内部提到应用最外层，让左侧抽屉、状态条、底栏等外壳区域可以直接消费 ctx，并通过 ctx.slots 提供可扩展插槽，不再使用 Teleport 桥接层。

**Architecture:** 新增无 UI 的 CanvasProvider，负责启动唯一画布宿主并提供基础画布上下文。CanvasHost 拆成“兼容外壳 + 纯画布内层”；外壳插槽用 SlotHost 直接渲染，左侧抽屉用 DrawerTabHost 的同一套页签状态管理。画布渲染上下文仍只存在于 CanvasHost 内部，两层上下文职责分开。

**Tech Stack:** Vue 3.5、TypeScript、VueFlow、Vitest、Playwright、pnpm workspace。

**Spec:** 本文件 §1-§4 同时承担需求、设计与实施计划；用户 2026-10-27 的评审意见是本计划的来源。

## Global Constraints

- 不碰 v1：根 src/ 与 packages/canvas-core 一律不动。
- 不碰核心节点件：BaseNode.vue、MovingHandle.vue、BaseTitle.vue、CustomEdge.vue、ConnectionLine.vue、DefaultBackground.vue 一律不动。
- 编辑文件只用 apply_patch，不用 PowerShell 写文件。
- 检索优先用 codegraph；开工先执行 codegraph status，改完执行 codegraph index。
- 每个任务完成即 git add + git commit；禁止把大量改动堆在工作区。
- 插件不得反向 import @mini-canvas/ui；插件只依赖 ctx、canvas-base 或 canvas-render 的公开面。
- CanvasProvider 每个画布实例只能有一个；不能在外壳里再包第二个 Provider。
- SettingsHost 仍留在 CanvasHost 的 #ui 内，因为设置面板内容依赖 useCanvasRender()。
- 外壳槽只保证基础画布上下文（ctx + host）；需要 flow / renderNodes / visibleRect 的组件仍必须住在 CanvasHost 内。
- 抽屉页签保留 canvas 与 assets 两个保留 id；插件页签不能占用它们。
- UI 数值走 docs/design/ui-style-guide.md 的 token；不自造颜色、圆角、字号、z-index。
- 测试是裁判：每步先写红，再写最小实现，再跑绿。

---

## 1. 需求与结论

### 1.1 用户要的结果

1. 三个红框区域可以被插件塞入自定义 UI：左侧抽屉页签行、左下状态条、底部中央工具栏。
2. 不再为每个区域写 Teleport 桥、DOM 锚点表或 querySelector。
3. 最外层有一个类似 n-config-provider 的组件，负责初始化上下文；里面的内容可以直接使用上下文。
4. 左侧抽屉的页签切换、折叠、展开、隐藏仍由应用壳统一管理；插件只交按钮和面板。
5. 后续代码应更精简，尤其是删掉重复的桥接和查找目标的逻辑。

### 1.2 关键判断

当前问题的根因不是插槽不够，而是上下文边界放错了：

    现在
    CanvasShell
      +- CanvasHost        <- 在这里启动内核并提供 ctx
      +- LeftDrawer        <- 兄弟节点，拿不到 ctx

    目标
    CanvasProvider        <- 只启动内核、提供 ctx，不画业务 UI
      +- CanvasShell
           +- CanvasHost  <- 只画 VueFlow，不再启动内核
           +- LeftDrawer  <- 直接拿到 ctx

因此不需要再让插件自己 Teleport 到外壳。组件在 Vue 树里本来就是外壳的后代，provide / inject 正常，DOM 关系也正常。

### 1.3 不在本次范围

- 不把设置面板外壳搬出 CanvasHost。
- 不把节点、连线、画布内浮层迁移到基础上下文。
- 不新增第二套插件系统。
- 不新增分支，不创建子代理；按用户要求由主代理完成文档自审。

---

## 2. 设计

### 2.1 两层上下文

| 上下文 | 提供方 | 内容 | 使用范围 |
|---|---|---|---|
| CanvasContext | CanvasProvider | ctx、host、api、manager | 整个应用壳、左侧抽屉、状态条、底栏、外壳插槽 |
| CanvasRenderContext | CanvasSurface | ctx、host、flow、renderNodes、renderEdges、visibleRect、interaction、edgeVisual 等 | 只在 VueFlow 渲染子树内 |

规则：

- 只读服务、命令、设置、插槽、主题目录 → 用 useCanvasContext()。
- 需要视口、节点渲染快照、连线反馈、拖拽状态 → 用 useCanvasRender()。
- useCanvasContext() 在找不到基础上下文时，回退读取 RENDER_CONTEXT_KEY，保证现有单元测试和旧渲染子树兼容。

### 2.2 组件关系

    CanvasProvider
      provide(CANVAS_CONTEXT_KEY)
      +- CanvasShell
           +- TopLeftArea
           +- TopRightArea
           +- StatusArea + SlotHost(shell.status.end)
           +- DockArea + SlotHost(shell.dock.start/end)
           +- LeftDrawer
                +- 内置画布/资产页签
                +- 插件页签按钮（shell.drawer.tabs）
                +- 插件页签面板（meta.panel）
           +- CanvasHost（兼容外壳）
                +- CanvasHostInner
                     +- CanvasSurface
                          provide(RENDER_CONTEXT_KEY)
                          +- VueFlow / overlay / 节点 / 连线

### 2.3 插槽表

| 槽名 | 位置 | 组件收到什么 | 适用内容 |
|---|---|---|---|
| shell.status.end | 左下状态条末尾 | 无固定 props；自行 useCanvasContext() | 小按钮、状态徽章、计数 |
| shell.dock.start | 底部工具栏最前 | 无固定 props；自行 useCanvasContext() | 入口按钮、工具开关 |
| shell.dock.end | 底部工具栏最后 | 无固定 props；自行 useCanvasContext() | 入口按钮、扩展工具 |
| shell.drawer.tabs | 左侧抽屉页签行末尾 | active、onSelect、host | 页签按钮，必须带 meta.panel |

已有槽不改：overlay、mini-map、agent-conversation、settingsNav、settingsTab、settingsGroup/<key>。

### 2.4 左侧抽屉页签契约

插件注册：

    ctx.slots.register('shell.drawer.tabs', {
      id: 'my-panel',
      order: 20,
      component: MyTabButton,
      meta: {
        title: '我的面板',
        panel: MyPanel,
      },
    })

页签按钮收到：

    {
      active: boolean,
      onSelect: () => void,
      host: {
        activeTab: string,
        width: number,
        openTab(id: string): void,
        close(): void,
        toggleCollapsed(): void,
      },
    }

页签面板收到：

    {
      host: 上面同一个 host,
    }

抽屉外壳负责：

- 当前页签是高亮还是普通。
- 点击页签后是否切换。
- 抽屉打开、关闭、收起、展开、拖宽。
- 插件卸载后如果当前页签正是它，自动退回 canvas。
- 画布/资产两个内置页签保持不变。

插件不负责：

- 直接改 state.leftTab 或 state.drawer。
- 自己写 fixed 定位。
- 自己查找抽屉 DOM。

### 2.5 外壳操作命令

为了外壳插槽里的按钮能打开抽屉或切换页签，又不必 import @mini-canvas/ui，注册三条公共命令：

| 命令 id | payload | 行为 |
|---|---|---|
| shell:open-drawer | 无 | 打开左侧抽屉 |
| shell:open-drawer-tab | { id: string } | 打开抽屉并切到指定页签 |
| shell:toggle-drawer | 无 | 收起/展开左侧抽屉 |

插件按钮这样调用：

    ctx.get('command').execute('shell:open-drawer-tab', { id: 'my-panel' })

这比新增一个全局 shell 服务更轻，也沿用本项目“动作走命令表”的既有模式。

### 2.6 兼容策略

- 直接写 CanvasHost 的旧用法继续有效：CanvasHost 检测不到 Provider 时，内部临时包一层 CanvasProvider。
- CanvasHost 的公开 ref 继续提供 host、api、manager、ready、bootErrorText。
- CanvasHost 的 @ready 仍表示“画布渲染子树准备完成”，不是“内核刚建好”。
- CanvasProvider 自己的 @ready 表示“内核已启动、ctx 可用”；应用壳应优先使用 CanvasHost 的 @ready 做原有 onReady 初始化。

### 2.7 文件结构

新建：

- packages/canvas-render/src/contracts/canvasContext.ts
- packages/canvas-render/src/host/CanvasProvider.vue
- packages/canvas-render/src/host/CanvasHostInner.vue
- packages/canvas-render/src/host/canvasHostTypes.ts
- packages/canvas-render/src/components/__tests__/slotHost.test.ts
- packages/canvas-render/src/contracts/__tests__/canvasContext.test.ts
- packages/ui/src/composables/drawerTabs.ts
- packages/ui/src/composables/__tests__/drawerTabs.test.ts
- packages/ui/src/shellCommands.ts
- packages/ui/src/__tests__/shellCommands.test.ts
- packages/ui/e2e/shell-slots-check.mjs
- docs/代码开发/canvas-render/13-CanvasProvider与外壳插槽.md

修改：

- packages/canvas-render/src/host/CanvasHost.vue
- packages/canvas-render/src/components/SlotHost.vue
- packages/canvas-render/src/contracts/uiCatalog.ts
- packages/canvas-render/src/contracts/useThemeColor.ts
- packages/canvas-render/src/contracts/nodeLayoutSettings.ts
- packages/canvas-render/src/index.ts
- packages/ui/src/App.vue
- packages/ui/src/composables/ui.ts
- packages/ui/src/components/areas/LeftDrawer.vue
- docs/代码开发/canvas-render/05-渲染上下文与content组件.md
- docs/代码开发/00-总览与架构.md
- docs/STATUS.md

不动：

- packages/canvas-core 与根 src。
- 六个核心节点件。
- packages/canvas-data 与 packages/kernel 的公共 API。

---

## 3. 实施任务

### Task 0: 清理开工条件

**Files:** 无代码改动。

**Interfaces:** 无。

- [ ] **Step 1: 确认工作区没有本计划之外的未提交改动**

Run:

    git status --short --branch

Expected:

- 如果只剩你已确认的 WIP，先把它们单独提交或备份。
- 本计划不能建立在未提交的 bottom-bar / ref-slot-decoupling 等工作之上。

- [ ] **Step 2: 确认 codegraph 索引可用**

Run:

    codegraph status

Expected:

    Index is up to date

- [ ] **Step 3: 跑一次基线测试**

Run:

    pnpm -C packages/canvas-render test
    pnpm -C packages/ui test

Expected:

- 两个包都绿。
- 如果基线本来就红，先记录红项，不在本任务里修无关问题。

---

### Task 1: 基础画布上下文

**Files:**

- Create: packages/canvas-render/src/contracts/canvasContext.ts
- Test: packages/canvas-render/src/contracts/__tests__/canvasContext.test.ts
- Modify: packages/canvas-render/src/index.ts

**Interfaces:**

    export interface CanvasContext {
      ctx: Context
      host: CanvasHostHandle
      api?: MiniCanvasApi
      manager?: PluginManager
    }

    export const CANVAS_CONTEXT_KEY: InjectionKey<CanvasContext>
    export function useCanvasContext(): CanvasContext

- [ ] **Step 1: 写失败测试**

Create packages/canvas-render/src/contracts/__tests__/canvasContext.test.ts:

    import { describe, expect, it } from 'vitest'
    import { createSSRApp, defineComponent, h } from 'vue'
    import { renderToString } from 'vue/server-renderer'
    import { Context } from '@mini-canvas/canvas-data'
    import type { CanvasHostHandle } from '../host/createMiniCanvasHost'
    import { CANVAS_CONTEXT_KEY, useCanvasContext } from '../canvasContext'
    import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '../renderContext'

    const Probe = defineComponent({
      name: 'CanvasContextProbe',
      setup() {
        const { ctx } = useCanvasContext()
        return () => h('div', { 'data-state': ctx.getState() }, 'ok')
      },
    })

    describe('CanvasContext', () => {
      it('在 Provider 内取到 ctx / host', async () => {
        const ctx = new Context()
        const app = createSSRApp(Probe)
        app.provide(CANVAS_CONTEXT_KEY, { ctx, host: {} as CanvasHostHandle })
        const html = await renderToString(app)
        expect(html).toContain('data-state')
        expect(html).toContain('ok')
      })

      it('没有 Provider 时给出清晰错误', async () => {
        const app = createSSRApp(Probe)
        await expect(renderToString(app)).rejects.toThrow(/CanvasProvider/)
      })

      it('兼容旧渲染上下文：只有 RENDER_CONTEXT_KEY 时也能取到 ctx', async () => {
        const ctx = new Context()
        const app = createSSRApp(Probe)
        app.provide(RENDER_CONTEXT_KEY, { ctx, host: {} as CanvasHostHandle } as unknown as CanvasRenderContext)
        const html = await renderToString(app)
        expect(html).toContain('ok')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/canvas-render test -- canvasContext

Expected:

- 模块不存在或 useCanvasContext 未定义。

- [ ] **Step 3: 写最小实现**

Create packages/canvas-render/src/contracts/canvasContext.ts:

    import { inject, type InjectionKey } from 'vue'
    import type { Context } from '@mini-canvas/canvas-data'
    import type { CanvasHostHandle, MiniCanvasApi } from '../host/createMiniCanvasHost'
    import type { PluginManager } from '../host/pluginManager'
    import { RENDER_CONTEXT_KEY } from './renderContext'

    export interface CanvasContext {
      ctx: Context
      host: CanvasHostHandle
      api?: MiniCanvasApi
      manager?: PluginManager
    }

    export const CANVAS_CONTEXT_KEY: InjectionKey<CanvasContext> = Symbol('mini-canvas-context')

    export function useCanvasContext(): CanvasContext {
      const base = inject(CANVAS_CONTEXT_KEY, null)
      if (base) return base

      const render = inject(RENDER_CONTEXT_KEY, null)
      if (render) return { ctx: render.ctx, host: render.host }

      throw new Error(
        '[useCanvasContext] 缺少画布上下文：请把组件放在 <CanvasProvider> 内，' +
          '或放在 <CanvasHost> 的渲染子树内。',
      )
    }

Modify packages/canvas-render/src/index.ts:

    export { CANVAS_CONTEXT_KEY, useCanvasContext } from './contracts/canvasContext'
    export type { CanvasContext } from './contracts/canvasContext'

- [ ] **Step 4: 跑测试确认通过**

Run:

    pnpm -C packages/canvas-render test -- canvasContext
    pnpm -C packages/canvas-render typecheck

Expected: 全绿。

- [ ] **Step 5: 提交**

    git add packages/canvas-render/src/contracts/canvasContext.ts packages/canvas-render/src/contracts/__tests__/canvasContext.test.ts packages/canvas-render/src/index.ts
    git commit -m "feat(canvas-render): add base canvas context"

---

### Task 2: CanvasProvider 启动唯一宿主

**Files:**

- Create: packages/canvas-render/src/host/CanvasProvider.vue
- Create: packages/canvas-render/src/host/canvasHostTypes.ts
- Test: packages/canvas-render/src/host/__tests__/canvasProvider.test.ts
- Modify: packages/canvas-render/src/index.ts

**Interfaces:**

    export interface CanvasHostBootProps {
      plugins?: (PluginModule | PluginClassLike)[]
      manifest?: PluginManifest
      adapter?: StorageAdapter
      seed?: () => CanvasNode[]
      dev?: boolean
      windowKey?: string
    }

    export interface CanvasHostRenderProps {
      nodeWrite?: NodeWrite
      edgeVisual?: Partial<EdgeVisual>
      handleVisual?: CanvasParams
      debugVisual?: CanvasDebug
      snapZoneVisual?: SnapZoneConfig
      persistViewport?: boolean
    }

    export type CanvasHostProps = CanvasHostBootProps & CanvasHostRenderProps

    export interface CanvasHostEmits {
      ready: [host: CanvasHostHandle]
      'boot-error': [error: Error]
      'context-menu': [payload: CanvasContextMenuPayload]
      'plugin-issue': [payload: { name: string; lifecycle: string }]
    }

- [ ] **Step 1: 写失败测试**

Create packages/canvas-render/src/host/__tests__/canvasProvider.test.ts。这里测的是启动责任真的搬走了，而不是组件绘制细节（Node 没有 DOM，onMounted 不稳定）。

    import { describe, expect, it } from 'vitest'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'

    function read(rel: string): string {
      return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    }

    describe('CanvasProvider 启动责任', () => {
      it('Provider 调用 createMiniCanvasHost 并在卸载时 stop', () => {
        const src = read('../CanvasProvider.vue')
        expect(src).toContain('createMiniCanvasHost')
        expect(src).toContain('exposeToWindow')
        expect(src).toContain('host.stop()')
        expect(src).toContain('CANVAS_CONTEXT_KEY')
      })

      it('CanvasHost 内层不再自己启动内核', () => {
        const src = read('../CanvasHostInner.vue')
        expect(src).not.toContain('createMiniCanvasHost')
        expect(src).not.toContain('new MemoryStorageAdapter')
        expect(src).not.toContain('exposeToWindow')
      })

      it('Provider 的默认插槽只在 ready 后出现', () => {
        const src = read('../CanvasProvider.vue')
        expect(src).toContain('v-if="ready"')
        expect(src).toContain('name="loading"')
        expect(src).toContain('name="error"')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/canvas-render test -- canvasProvider

Expected: CanvasProvider.vue / CanvasHostInner.vue 不存在。

- [ ] **Step 3: 写类型文件**

Create packages/canvas-render/src/host/canvasHostTypes.ts:

    import type { CanvasNode, StorageAdapter } from '@mini-canvas/canvas-data'
    import type { PluginClassLike, PluginModule } from '@mini-canvas/kernel'
    import type { CanvasHostHandle } from './createMiniCanvasHost'
    import type { PluginManifest } from './pluginManager'
    import type { NodeWrite } from '../contracts/nodeRegistryKey'
    import type { EdgeVisual } from '../contracts/edgeContext'
    import type { CanvasParams } from '../contracts/canvasParamKey'
    import type { CanvasDebug } from '../contracts/debugContext'
    import type { SnapZoneConfig } from '../connection/geometry'

    export interface CanvasHostBootProps {
      plugins?: (PluginModule | PluginClassLike)[]
      manifest?: PluginManifest
      adapter?: StorageAdapter
      seed?: () => CanvasNode[]
      dev?: boolean
      windowKey?: string
    }

    export interface CanvasHostRenderProps {
      nodeWrite?: NodeWrite
      edgeVisual?: Partial<EdgeVisual>
      handleVisual?: CanvasParams
      debugVisual?: CanvasDebug
      snapZoneVisual?: SnapZoneConfig
      persistViewport?: boolean
    }

    export type CanvasHostProps = CanvasHostBootProps & CanvasHostRenderProps

    export interface CanvasContextMenuPayload {
      kind: 'node' | 'pane' | 'edge'
      clientX: number
      clientY: number
      nodeId?: string
      edgeId?: string
    }

    export interface CanvasHostEmits {
      ready: [host: CanvasHostHandle]
      'boot-error': [error: Error]
      'context-menu': [payload: CanvasContextMenuPayload]
      'plugin-issue': [payload: { name: string; lifecycle: string }]
    }

- [ ] **Step 4: 写 CanvasProvider**

Create packages/canvas-render/src/host/CanvasProvider.vue:

    <script setup lang="ts">
    import { onBeforeUnmount, onMounted, onUnmounted, provide, ref, shallowRef } from 'vue'
    import { createMiniCanvasHost, type CanvasHostHandle, type MiniCanvasApi } from './createMiniCanvasHost'
    import type { PluginManager } from './pluginManager'
    import type { CanvasHostBootProps } from './canvasHostTypes'
    import { CANVAS_CONTEXT_KEY } from '../contracts/canvasContext'

    const props = withDefaults(defineProps<CanvasHostBootProps>(), {
      plugins: () => [],
    })

    const emit = defineEmits<{
      ready: [host: CanvasHostHandle]
      'boot-error': [error: Error]
    }>()

    interface Boot {
      host: CanvasHostHandle
      api: MiniCanvasApi
      manager: PluginManager
    }

    const boot = shallowRef<Boot | null>(null)
    const error = ref<Error | null>(null)
    const ready = ref(false)

    provide(CANVAS_CONTEXT_KEY, {
      get ctx() {
        if (!boot.value) throw new Error('[CanvasProvider] 上下文尚未就绪')
        return boot.value.host.ctx
      },
      get host() {
        if (!boot.value) throw new Error('[CanvasProvider] 上下文尚未就绪')
        return boot.value.host
      },
      get api() {
        return boot.value?.api
      },
      get manager() {
        return boot.value?.manager
      },
    })

    onMounted(async () => {
      try {
        const r = await createMiniCanvasHost({
          adapter: props.adapter,
          manifest: props.manifest,
          coldPlugins: props.plugins,
          seedDefault: props.seed,
          dev: props.dev,
        })
        boot.value = { host: r.host, api: r.api, manager: r.manager }
        if (props.windowKey) r.exposeToWindow(props.windowKey)
        ready.value = true
        emit('ready', r.host)
      } catch (e) {
        error.value = e instanceof Error ? e : new Error(String(e))
        emit('boot-error', error.value)
      }
    })

    onBeforeUnmount(() => {
      const b = boot.value
      if (!b) return
      void b.host.save.flush()
    })

    onUnmounted(() => {
      // 必须在所有子组件卸载后再停内核：否则 CanvasHostInner 的订阅仍在，
      // 会看到内核正在拆除中的注册表事件。
      const b = boot.value
      if (!b) return
      b.host.stop()
      boot.value = null
    })

    defineExpose({
      get host() {
        return boot.value?.host
      },
      get api() {
        return boot.value?.api
      },
      get manager() {
        return boot.value?.manager
      },
      get ready() {
        return ready.value && !error.value
      },
      get bootErrorText() {
        return error.value?.message ?? ''
      },
    })
    </script>

    <template>
      <slot v-if="ready" />
      <slot v-else-if="error" name="error" :error="error">
        <div class="canvas-provider-status is-error">启动失败：{{ error.message }}</div>
      </slot>
      <slot v-else name="loading">
        <div class="canvas-provider-status">正在启动内核…</div>
      </slot>
    </template>

    <style scoped>
    .canvas-provider-status {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: var(--ui-ink-dim, #6b7280);
      background: var(--ui-canvas-bg, #f5f6f8);
      font: 13px system-ui, 'Microsoft YaHei', sans-serif;
    }
    .canvas-provider-status.is-error {
      color: var(--ui-danger, #dc2626);
    }
    </style>

注意：Provider 只启动一次内核；它不创建 NodeRegistry，也不渲染 VueFlow。nodeRegistry 由 createMiniCanvasHost 建好后从 host.nodeRegistry 取，避免两份实例。

- [ ] **Step 5: 导出 Provider 与类型**

Modify packages/canvas-render/src/index.ts:

    export { default as CanvasProvider } from './host/CanvasProvider.vue'
    export type { CanvasHostBootProps, CanvasHostRenderProps, CanvasHostProps, CanvasHostEmits } from './host/canvasHostTypes'

- [ ] **Step 6: 跑测试确认通过**

Run:

    pnpm -C packages/canvas-render test -- canvasProvider
    pnpm -C packages/canvas-render typecheck

Expected: 全绿。

- [ ] **Step 7: 提交**

    git add packages/canvas-render/src/host/CanvasProvider.vue packages/canvas-render/src/host/canvasHostTypes.ts packages/canvas-render/src/host/__tests__/canvasProvider.test.ts packages/canvas-render/src/index.ts
    git commit -m "feat(canvas-render): add CanvasProvider for shared canvas context"

---

### Task 3: 拆分 CanvasHost 为兼容外壳与纯画布内层

**Files:**

- Move: packages/canvas-render/src/host/CanvasHost.vue -> packages/canvas-render/src/host/CanvasHostInner.vue
- Create: packages/canvas-render/src/host/CanvasHost.vue（新的兼容外壳）
- Modify: packages/canvas-render/src/host/CanvasHostInner.vue
- Test: packages/canvas-render/src/host/__tests__/canvasHostSplit.test.ts

**Interfaces:**

    CanvasHost.vue
      props: CanvasHostProps
      emits: ready / boot-error / context-menu / plugin-issue

    CanvasHostInner.vue
      props: CanvasHostRenderProps
      emits: ready / boot-error / context-menu / plugin-issue

- [ ] **Step 1: 写失败测试**

Create packages/canvas-render/src/host/__tests__/canvasHostSplit.test.ts:

    import { describe, expect, it } from 'vitest'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'

    function read(rel: string): string {
      return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    }

    describe('CanvasHost 拆分', () => {
      it('CanvasHost 是兼容外壳：有 Provider 就用，没有就临时包一层', () => {
        const src = read('../CanvasHost.vue')
        expect(src).toContain('inject(CANVAS_CONTEXT_KEY')
        expect(src).toContain('<CanvasProvider')
        expect(src).toContain('<CanvasHostInner')
        expect(src).toContain('hasProvider')
      })

      it('CanvasHostInner 只消费上下文，不再启动', () => {
        const src = read('../CanvasHostInner.vue')
        expect(src).toContain('useCanvasContext')
        expect(src).not.toContain('createMiniCanvasHost')
        expect(src).not.toContain('host.stop()')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/canvas-render test -- canvasHostSplit

Expected: CanvasHostInner.vue 不存在或旧 CanvasHost 仍含 createMiniCanvasHost。

- [ ] **Step 3: 把现有 CanvasHost 内容移到 CanvasHostInner**

执行文件移动后，在 CanvasHostInner 的 script 顶部把启动改为消费上下文：

    import type { CanvasHostEmits, CanvasHostRenderProps } from './canvasHostTypes'
    import { useCanvasContext } from '../contracts/canvasContext'

    const { host, api, manager } = useCanvasContext()
    const hostRef = shallowRef<CanvasHostHandle>(host)
    const registry = host.nodeRegistry

    const props = withDefaults(defineProps<CanvasHostRenderProps>(), {
      persistViewport: true,
    })
    const emit = defineEmits<CanvasHostEmits>()

删除：

    - createMiniCanvasHost 的 import
    - MemoryStorageAdapter 的 import
    - booting / bootError 这两个启动态
    - apiRef / managerRef 这两个启动结果 ref
    - onMounted 里的 createMiniCanvasHost 调用
    - exposeToWindow
    - onBeforeUnmount 里的 host.stop() 与 save.flush()

保留并改为内层挂载态：

    const surfaceReady = ref(false)
    const mountError = ref('')

把原 onMounted 里“createMiniCanvasHost 之后”的整段逻辑保留，改成一个挂载流程：

    onMounted(async () => {
      try {
        const settingsStore = host.ctx.get<{
          get(key: string): unknown
          onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
        }>('settings')

        Object.assign(interactionSettings, resolveCanvasInteraction((key) => settingsStore.get(key)))
        subs.push(
          settingsStore.onChange((key, value) => {
            applyCanvasInteractionChangeInto(interactionSettings, key, value)
            if (key === 'visibleCullEnabled' || key === 'visibleCullBuffer' || key === 'cullCompactShells') {
              refreshCull()
              rebuildLinkedIds()
              syncNodesFromStore()
            }
          }),
        )

        unsubStore = host.nodeStore.subscribe(syncFromStore)
        unsubEdge = host.edgeStore.subscribe(syncFromStore)

        unsubSel = host.selection.onChange(syncSelected)
        syncSelected()
        applyTheme()
        syncFromStore()

        // 插件热装/热卸、主题场、node/shell 场的现有订阅原样保留
        // ...

        window.addEventListener('keydown', onKeydown)
        keydownBound = true
        window.addEventListener('paste', onPaste)
        pasteBound = true
        window.addEventListener('copy', onCopy)
        window.addEventListener('cut', onCut)
        clipboardWriteBound = true
        document.addEventListener('mousedown', onGlobalPointerDown, true)
        window.addEventListener('visibilitychange', onVisibilityChange)
        window.addEventListener('pagehide', flushSave)
        window.addEventListener('pointerup', resetViewportMoveIfIdle, true)
        window.addEventListener('pointercancel', resetViewportMoveIfIdle, true)
        window.addEventListener('blur', resetViewportMoveIfIdle)
        window.addEventListener('visibilitychange', resetViewportMoveIfIdle)

        // 原来在 boot 里注入的 edit-guard 依赖 interaction，必须留在内层
        subs.push({
          dispose: host.ctx.inject('cloud-client/edit-guard', (nodeId: string): ReadonlySet<'position' | 'data' | 'size'> => {
            const held = new Set<'position' | 'data' | 'size'>()
            const act = interaction.activity.value
            if (act.nodeDragging && act.nodeDragId === nodeId) held.add('position')
            if (act.nodeResizing && act.nodeResizeId === nodeId) held.add('size')
            return held
          }),
        })

        if (props.persistViewport) {
          const vp = await host.save.get<ViewportState>(GRAPH_VIEWPORT_KEY, 'canvas')
          savedViewport.value = vp
        }

        surfaceReady.value = true
        emit('ready', host)
      } catch (err) {
        mountError.value = err instanceof Error ? err.message : String(err)
        surfaceReady.value = true
        emit('boot-error', err instanceof Error ? err : new Error(String(err)))
      }
    })

模板把启动态改成内层准备态：

    <div v-if="!surfaceReady" class="chost-status">正在准备画布…</div>
    <div v-else-if="mountError" class="chost-status chost-err">启动失败：{{ mountError }}</div>
    <div v-else class="chost-canvas">
      <CanvasSurface ...>
        ...
      </CanvasSurface>
    </div>

defineExpose 改为：

    defineExpose({
      host,
      api,
      manager,
      get ready() {
        return surfaceReady.value && !mountError.value
      },
      get bootErrorText() {
        return mountError.value
      },
    })

- [ ] **Step 4: 写新的 CanvasHost 兼容外壳**

Create packages/canvas-render/src/host/CanvasHost.vue:

    <script setup lang="ts">
    import { computed, inject, shallowRef } from 'vue'
    import { CANVAS_CONTEXT_KEY } from '../contracts/canvasContext'
    import CanvasProvider from './CanvasProvider.vue'
    import CanvasHostInner from './CanvasHostInner.vue'
    import type {
      CanvasContextMenuPayload,
      CanvasHostEmits,
      CanvasHostProps,
    } from './canvasHostTypes'

    const props = withDefaults(defineProps<CanvasHostProps>(), {
      persistViewport: true,
    })

    const emit = defineEmits<CanvasHostEmits>()

    const hasProvider = inject(CANVAS_CONTEXT_KEY, null) !== null
    const innerRef = shallowRef<InstanceType<typeof CanvasHostInner> | null>(null)

    const bootProps = computed(() => ({
      plugins: props.plugins,
      manifest: props.manifest,
      adapter: props.adapter,
      seed: props.seed,
      dev: props.dev,
      windowKey: props.windowKey,
    }))

    const renderProps = computed(() => ({
      nodeWrite: props.nodeWrite,
      edgeVisual: props.edgeVisual,
      handleVisual: props.handleVisual,
      debugVisual: props.debugVisual,
      snapZoneVisual: props.snapZoneVisual,
      persistViewport: props.persistViewport,
    }))
    </script>

    <template>
      <CanvasHostInner
        v-if="hasProvider"
        ref="innerRef"
        v-bind="renderProps"
        @ready="emit('ready', $event)"
        @boot-error="emit('boot-error', $event)"
        @plugin-issue="emit('plugin-issue', $event)"
        @context-menu="emit('context-menu', $event as CanvasContextMenuPayload)"
      >
        <template #ui>
          <slot name="ui" />
        </template>
        <slot />
      </CanvasHostInner>

      <CanvasProvider
        v-else
        v-bind="bootProps"
        @boot-error="emit('boot-error', $event)"
      >
        <CanvasHostInner
          ref="innerRef"
          v-bind="renderProps"
          @ready="emit('ready', $event)"
          @boot-error="emit('boot-error', $event)"
          @plugin-issue="emit('plugin-issue', $event)"
          @context-menu="emit('context-menu', $event as CanvasContextMenuPayload)"
        >
          <template #ui>
            <slot name="ui" />
          </template>
          <slot />
        </CanvasHostInner>
        <template #loading>
          <slot name="loading">正在启动内核…</slot>
        </template>
        <template #error="{ error }">
          <slot name="error" :error="error">启动失败：{{ error.message }}</slot>
        </template>
      </CanvasProvider>
    </template>

    在 script setup 末尾补：

    defineExpose({
      get host() {
        return innerRef.value?.host
      },
      get api() {
        return innerRef.value?.api
      },
      get manager() {
        return innerRef.value?.manager
      },
      get ready() {
        return innerRef.value?.ready ?? false
      },
      get bootErrorText() {
        return innerRef.value?.bootErrorText ?? ''
      },
    })

注意：

- Provider 的 @ready 不向外转发；CanvasHost 的 @ready 仍只代表画布内层就绪。
- 旧用法 <CanvasHost :plugins="..." @ready="..."> 继续可用。
- 新用法在 CanvasProvider 内直接写 CanvasHost 时，不会创建第二个宿主。

- [ ] **Step 5: 跑测试与类型检查**

Run:

    pnpm -C packages/canvas-render test -- canvasHostSplit
    pnpm -C packages/canvas-render test
    pnpm -C packages/canvas-render typecheck

Expected:

- canvas-render 原有测试全绿。
- 如果旧测试依赖 CanvasHost 的启动时序，按“内层仍 emit ready”的语义修测试，不改产品行为。

- [ ] **Step 6: 提交**

    git add packages/canvas-render/src/host/CanvasHost.vue packages/canvas-render/src/host/CanvasHostInner.vue packages/canvas-render/src/host/__tests__/canvasHostSplit.test.ts
    git commit -m "refactor(canvas-render): split CanvasHost boot from canvas rendering"

---

### Task 4: SlotHost 改用基础上下文

**Files:**

- Modify: packages/canvas-render/src/components/SlotHost.vue
- Modify: packages/canvas-render/src/contracts/uiCatalog.ts
- Modify: packages/canvas-render/src/contracts/useThemeColor.ts
- Modify: packages/canvas-render/src/contracts/nodeLayoutSettings.ts
- Test: packages/canvas-render/src/components/__tests__/slotHost.test.ts

**Interfaces:**

    SlotHost 继续收 { slot: string, itemClass?: string }
    组件树外不再要求 CanvasSurface，只要求 CanvasProvider（或旧渲染上下文兼容）。

- [ ] **Step 1: 写失败测试**

Create packages/canvas-render/src/components/__tests__/slotHost.test.ts:

    import { describe, expect, it } from 'vitest'
    import { createSSRApp, defineComponent, h } from 'vue'
    import { renderToString } from 'vue/server-renderer'
    import { Context } from '@mini-canvas/canvas-data'
    import type { CanvasHostHandle } from '../../host/createMiniCanvasHost'
    import { CANVAS_CONTEXT_KEY } from '../../contracts/canvasContext'
    import SlotHost from '../SlotHost.vue'

    function renderWithBase(ctx: Context): Promise<string> {
      const app = createSSRApp({
        render: () => h(SlotHost, { slot: 'shell.dock.end' }),
      })
      app.provide(CANVAS_CONTEXT_KEY, { ctx, host: {} as CanvasHostHandle })
      return renderToString(app)
    }

    describe('SlotHost 在外壳里可用', () => {
      it('只提供基础上下文也能渲染占位组件', async () => {
        const ctx = new Context()
        await ctx.start()
        ctx.slots.register('shell.dock.end', {
          id: 'demo',
          component: defineComponent({ render: () => h('button', { 'data-demo': '1' }, '扩展') }),
        })
        const html = await renderWithBase(ctx)
        expect(html).toContain('data-demo')
        expect(html).toContain('扩展')
        ctx.stop()
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/canvas-render test -- slotHost

Expected: 抛缺少渲染上下文。

- [ ] **Step 3: 换消费入口**

Modify packages/canvas-render/src/components/SlotHost.vue:

    import { useCanvasContext } from '../contracts/canvasContext'
    const { ctx } = useCanvasContext()

Modify packages/canvas-render/src/contracts/uiCatalog.ts:

    import { useCanvasContext } from './canvasContext'
    const { ctx } = useCanvasContext()

Modify packages/canvas-render/src/contracts/useThemeColor.ts:

    import { useCanvasContext } from './canvasContext'
    const { ctx } = useCanvasContext()

Modify packages/canvas-render/src/contracts/nodeLayoutSettings.ts:

    import { useCanvasContext } from './canvasContext'
    const { ctx } = useCanvasContext()

保持注释同步：useCanvasContext 从“只在 CanvasHost 子树内”改成“在 CanvasProvider 内或 CanvasHost 子树内”。

- [ ] **Step 4: 跑测试与类型检查**

Run:

    pnpm -C packages/canvas-render test -- slotHost
    pnpm -C packages/canvas-render test
    pnpm -C packages/canvas-render typecheck

Expected: 全绿；旧测试只提供 RENDER_CONTEXT_KEY 时由 useCanvasContext 的回退分支继续工作。

- [ ] **Step 5: 提交**

    git add packages/canvas-render/src/components/SlotHost.vue packages/canvas-render/src/contracts/uiCatalog.ts packages/canvas-render/src/contracts/useThemeColor.ts packages/canvas-render/src/contracts/nodeLayoutSettings.ts packages/canvas-render/src/components/__tests__/slotHost.test.ts
    git commit -m "refactor(canvas-render): let slot hosts consume base canvas context"

---

### Task 5: App 用 CanvasProvider 包住整个外壳

**Files:**

- Modify: packages/ui/src/App.vue
- Test: packages/ui/src/__tests__/appCanvasProvider.test.ts

**Interfaces:**

    <CanvasProvider :plugins :adapter :seed :dev window-key="MiniCanvasUI">
      <CanvasShell>...</CanvasShell>
    </CanvasProvider>

    <CanvasHost :ref="ui.setHostEl" :edge-visual ... @ready="onCanvasReady">

- [ ] **Step 1: 写失败测试**

Create packages/ui/src/__tests__/appCanvasProvider.test.ts:

    import { describe, expect, it } from 'vitest'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'

    const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')

    describe('App 装配层级', () => {
      it('CanvasProvider 在 CanvasShell 外面', () => {
        const provider = app.indexOf('<CanvasProvider')
        const shell = app.indexOf('<CanvasShell')
        expect(provider).toBeGreaterThan(-1)
        expect(shell).toBeGreaterThan(provider)
      })

      it('CanvasHost 不再自己带 plugins / adapter / seed / window-key', () => {
        const host = app.slice(app.indexOf('<CanvasHost'), app.indexOf('</CanvasHost>'))
        expect(host).not.toContain(':plugins=')
        expect(host).not.toContain(':adapter=')
        expect(host).not.toContain(':seed=')
        expect(host).not.toContain('window-key=')
      })

      it('设置面板仍在 CanvasHost 的 #ui 内', () => {
        const host = app.slice(app.indexOf('<CanvasHost'), app.indexOf('</CanvasHost>'))
        expect(host).toContain('<SettingsHost')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/ui test -- appCanvasProvider

Expected: 当前 App 没有 CanvasProvider。

- [ ] **Step 3: 改 App 模板**

在 App.vue 的 template 外加 Provider：

    <CanvasProvider
      :plugins="plugins"
      :adapter="adapter"
      :seed="seedDefaultCanvas"
      :dev="DEV"
      window-key="MiniCanvasUI"
    >
      <CanvasShell ...>
        ...原有内容...
      </CanvasShell>
    </CanvasProvider>

CanvasHost 改成只收渲染参数：

    <CanvasHost
      :ref="ui.setHostEl"
      :edge-visual="ui.cfg.edge"
      :handle-visual="ui.cfg.handle"
      :debug-visual="ui.cfg.debug"
      :snap-zone-visual="ui.cfg.snapZone"
      @ready="onCanvasReady"
    >
      <template #ui>
        <SettingsHost v-if="s.settingsOpen" />
        <AgentPanel />
        <div ref="miniMapEl" class="fixed left-0 top-0 z-[25]" ...>
          <div style="pointer-events: auto">
            <SlotHost slot="mini-map" />
          </div>
        </div>
        <AssetUiSlot />
      </template>
    </CanvasHost>

import 增加：

    import { CanvasHost, CanvasProvider, SettingsHost, SlotHost } from '@mini-canvas/canvas-render'

同时删掉 CanvasHost 上的 :plugins、:adapter、:seed、:dev、window-key。

- [ ] **Step 4: 加小地图的挂载 watch**

因为外壳现在晚于 App 的 onMounted 出现，补一条：

    watch(miniMapEl, () => placeMiniMap(), { flush: 'post' })

这样不必等 2 秒兜底轮询才把地图贴到状态栏按钮上方。

- [ ] **Step 5: 跑测试与类型检查**

Run:

    pnpm -C packages/ui test -- appCanvasProvider
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck

Expected: 全绿。

- [ ] **Step 6: 真机冒烟**

Run:

    pnpm -C packages/ui dev

浏览器打开 http://localhost:5288/#/canvas/default，确认：

- 首次打开出现“正在启动内核…”后进入画布。
- 左侧抽屉、状态条、底栏、设置面板、Agent 面板都正常。
- 控制台零 error。

- [ ] **Step 7: 提交**

    git add packages/ui/src/App.vue packages/ui/src/__tests__/appCanvasProvider.test.ts
    git commit -m "refactor(ui): wrap app shell with CanvasProvider"

---

### Task 6: 状态条与底栏插槽

**Files:**

- Modify: packages/ui/src/App.vue
- Test: packages/ui/src/__tests__/shellSlotMounts.test.ts

**Interfaces:**

    <SlotHost slot="shell.status.end" />
    <SlotHost slot="shell.dock.start" />
    <SlotHost slot="shell.dock.end" />

- [ ] **Step 1: 写失败测试**

Create packages/ui/src/__tests__/shellSlotMounts.test.ts:

    import { describe, expect, it } from 'vitest'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'

    const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')

    describe('外壳插槽挂载点', () => {
      it('状态条末尾有 shell.status.end', () => {
        expect(app).toContain('<SlotHost slot="shell.status.end"')
      })

      it('底栏首尾有 shell.dock.start / shell.dock.end', () => {
        expect(app).toContain('<SlotHost slot="shell.dock.start"')
        expect(app).toContain('<SlotHost slot="shell.dock.end"')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/ui test -- shellSlotMounts

Expected: 找不到槽。

- [ ] **Step 3: 加挂载点**

状态条：

    <template #status>
      <div class="flex items-end gap-1">
        <StatusArea />
        <SlotHost slot="shell.status.end" item-class="flex-none" />
      </div>
    </template>

底栏：

    <template #dock>
      <SlotHost slot="shell.dock.start" item-class="flex-none" />
      <DockArea />
    </template>
    <template #dock-append>
      <SlotHost slot="shell.dock.end" item-class="flex-none" />
    </template>

说明：

- CanvasShell 已经有 dock-append，不需要新增它。
- 插件按钮自己只画按钮内容，不自带 fixed 定位和外层容器。
- 状态条、底栏的推挤/居中仍由 CanvasShell 负责。

- [ ] **Step 4: 跑测试与类型检查**

Run:

    pnpm -C packages/ui test -- shellSlotMounts
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck

Expected: 全绿。

- [ ] **Step 5: 提交**

    git add packages/ui/src/App.vue packages/ui/src/__tests__/shellSlotMounts.test.ts
    git commit -m "feat(ui): expose status and dock shell slots"

---

### Task 7: 抽屉页签纯逻辑与外壳命令

**Files:**

- Create: packages/ui/src/composables/drawerTabs.ts
- Create: packages/ui/src/shellCommands.ts
- Test: packages/ui/src/composables/__tests__/drawerTabs.test.ts
- Test: packages/ui/src/__tests__/shellCommands.test.ts
- Modify: packages/ui/src/composables/ui.ts

**Interfaces:**

    export interface DrawerTabMeta {
      title?: string
      panel?: unknown
    }

    export interface DrawerTabEntry {
      id: string
      order: number
      button: unknown
      panel: unknown
      title: string
    }

    export interface DrawerTabsInvalid {
      id: string
      reason: 'reserved' | 'missing-panel' | 'missing-button'
    }

    export function resolveDrawerTabs(
      occ: Array<{ id: string; order: number; component: unknown; meta?: unknown }>,
      opts?: { reserved?: string[] },
    ): { tabs: DrawerTabEntry[]; invalid: DrawerTabsInvalid[] }

    export function fallbackDrawerTab(active: string, pluginIds: string[]): string

    export function registerShellCommands(
      ctx: Context,
      host: {
        openDrawer(which: 'left'): void
        openDrawerTab(id: string): void
        toggleLeftCollapsed(): void
      },
    ): Array<{ dispose(): void }>

- [ ] **Step 1: 写失败测试**

Create packages/ui/src/composables/__tests__/drawerTabs.test.ts:

    import { describe, expect, it } from 'vitest'
    import { fallbackDrawerTab, resolveDrawerTabs } from '../drawerTabs'

    const A = { name: 'A' }
    const B = { name: 'B' }
    const P = { name: 'P' }

    describe('resolveDrawerTabs', () => {
      it('按 order 排序，保留有面板的插件页签', () => {
        const r = resolveDrawerTabs([
          { id: 'b', order: 20, component: B, meta: { panel: P, title: 'B' } },
          { id: 'a', order: 10, component: A, meta: { panel: P, title: 'A' } },
        ])
        expect(r.tabs.map((t) => t.id)).toEqual(['a', 'b'])
      })

      it('保留 id 与缺面板的条目被拒绝，并给出原因', () => {
        const r = resolveDrawerTabs(
          [
            { id: 'canvas', order: 0, component: A, meta: { panel: P } },
            { id: 'no-panel', order: 30, component: A, meta: {} },
            { id: 'ok', order: 10, component: A, meta: { panel: P } },
          ],
          { reserved: ['canvas', 'assets'] },
        )
        expect(r.tabs.map((t) => t.id)).toEqual(['ok'])
        expect(r.invalid).toEqual([
          { id: 'canvas', reason: 'reserved' },
          { id: 'no-panel', reason: 'missing-panel' },
        ])
      })
    })

    describe('fallbackDrawerTab', () => {
      it('当前插件页签还在就保留，不在了回 canvas', () => {
        expect(fallbackDrawerTab('my-tab', ['my-tab'])).toBe('my-tab')
        expect(fallbackDrawerTab('gone', ['my-tab'])).toBe('canvas')
        expect(fallbackDrawerTab('assets', [])).toBe('assets')
      })
    })

Create packages/ui/src/__tests__/shellCommands.test.ts:

    import { describe, expect, it } from 'vitest'
    import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
    import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
    import { registerShellCommands } from '../shellCommands'

    describe('shell 命令', () => {
      it('外壳按钮能通过命令打开抽屉和页签', async () => {
        const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
        const calls: string[] = []
        const disposers = registerShellCommands(host.ctx, {
          openDrawer: (which) => calls.push('open:' + which),
          openDrawerTab: (id) => calls.push('tab:' + id),
          toggleLeftCollapsed: () => calls.push('toggle'),
        })

        host.command.execute('shell:open-drawer')
        host.command.execute('shell:open-drawer-tab', { id: 'my-tab' })
        host.command.execute('shell:toggle-drawer')

        expect(calls).toEqual(['open:left', 'tab:my-tab', 'toggle'])
        for (const d of disposers) d.dispose()
        host.stop()
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/ui test -- drawerTabs
    pnpm -C packages/ui test -- shellCommands

Expected: 模块不存在。

- [ ] **Step 3: 写纯逻辑**

Create packages/ui/src/composables/drawerTabs.ts:

    export interface DrawerTabMeta {
      title?: string
      panel?: unknown
    }

    export interface DrawerTabEntry {
      id: string
      order: number
      button: unknown
      panel: unknown
      title: string
    }

    export type DrawerTabsInvalidReason = 'reserved' | 'missing-panel' | 'missing-button'

    export interface DrawerTabsInvalid {
      id: string
      reason: DrawerTabsInvalidReason
    }

    export const DRAWER_TAB_CANVAS = 'canvas'
    export const DRAWER_TAB_ASSETS = 'assets'
    export const DRAWER_TAB_RESERVED = [DRAWER_TAB_CANVAS, DRAWER_TAB_ASSETS]

    export function resolveDrawerTabs(
      occ: Array<{ id: string; order: number; component: unknown; meta?: unknown }>,
      opts: { reserved?: string[] } = {},
    ): { tabs: DrawerTabEntry[]; invalid: DrawerTabsInvalid[] } {
      const reserved = new Set(opts.reserved ?? DRAWER_TAB_RESERVED)
      const tabs: DrawerTabEntry[] = []
      const invalid: DrawerTabsInvalid[] = []

      for (const e of occ) {
        if (reserved.has(e.id)) {
          invalid.push({ id: e.id, reason: 'reserved' })
          continue
        }
        if (!e.component) {
          invalid.push({ id: e.id, reason: 'missing-button' })
          continue
        }
        const meta = (e.meta ?? {}) as DrawerTabMeta
        if (!meta.panel) {
          invalid.push({ id: e.id, reason: 'missing-panel' })
          continue
        }
        tabs.push({
          id: e.id,
          order: e.order,
          button: e.component,
          panel: meta.panel,
          title: meta.title ?? e.id,
        })
      }

      tabs.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      return { tabs, invalid }
    }

    export function fallbackDrawerTab(active: string, pluginIds: string[]): string {
      if (active === DRAWER_TAB_CANVAS || active === DRAWER_TAB_ASSETS) return active
      return pluginIds.includes(active) ? active : DRAWER_TAB_CANVAS
    }

Create packages/ui/src/shellCommands.ts:

    import type { Context } from '@mini-canvas/canvas-data'

    export interface ShellCommandHost {
      openDrawer(which: 'left'): void
      openDrawerTab(id: string): void
      toggleLeftCollapsed(): void
    }

    export function registerShellCommands(ctx: Context, host: ShellCommandHost): Array<{ dispose(): void }> {
      return [
        ctx.commands.register({
          id: 'shell:open-drawer',
          title: '打开左侧抽屉',
          run: () => host.openDrawer('left'),
        }),
        ctx.commands.register({
          id: 'shell:open-drawer-tab',
          title: '打开左侧抽屉页签',
          run: (_ctx, payload) => {
            const id = (payload as { id?: unknown } | undefined)?.id
            if (typeof id === 'string' && id) host.openDrawerTab(id)
          },
        }),
        ctx.commands.register({
          id: 'shell:toggle-drawer',
          title: '收起或展开左侧抽屉',
          run: () => host.toggleLeftCollapsed(),
        }),
      ]
    }

- [ ] **Step 4: 改 ui.ts**

把 leftTab 类型从闭集放宽为 string：

    leftTab: DRAWER_TAB_CANVAS as string,

新增唯一入口：

    function openDrawerTab(id: string): void {
      state.leftTab = id
      state.drawer = 'left'
      if (id === DRAWER_TAB_ASSETS) {
        void loadAssets()
        void loadAssetFolders()
      }
    }

把 toggleLeftCollapsed 的展开分支改成保留上次页签：

    function toggleLeftCollapsed(): void {
      state.leftCollapsed = !state.leftCollapsed
      if (state.leftCollapsed) {
        state.drawer = null
        showToast('已收起节点侧栏')
      } else {
        state.drawer = 'left'
        showToast('已展开节点侧栏')
      }
    }

把 openDrawerTab 加进 return 对象，并导出常量：

    return {
      ...,
      openDrawerTab,
    }

    export { DRAWER_TAB_ASSETS, DRAWER_TAB_CANVAS } from './drawerTabs'

为 UI 状态补测试：

Create packages/ui/src/__tests__/drawerTabState.test.ts:

    import { describe, expect, it } from 'vitest'
    import { useUi } from '../composables/ui'

    describe('抽屉页签状态', () => {
      it('openDrawerTab 打开抽屉并切页签', () => {
        const ui = useUi()
        ui.state.drawer = null
        ui.openDrawerTab('my-tab')
        expect(ui.state.drawer).toBe('left')
        expect(ui.state.leftTab).toBe('my-tab')
      })

      it('收起再展开保留上次页签', () => {
        const ui = useUi()
        ui.state.leftTab = 'my-tab'
        ui.state.drawer = 'left'
        ui.toggleLeftCollapsed()
        expect(ui.state.drawer).toBe(null)
        ui.toggleLeftCollapsed()
        expect(ui.state.drawer).toBe('left')
        expect(ui.state.leftTab).toBe('my-tab')
      })
    })

- [ ] **Step 5: 在 App 注册命令**

在 App.vue 的 onCanvasReady 内：

    let shellCommandDisposers: Array<{ dispose(): void }> = []

    function onCanvasReady(host: unknown): void {
      setReadyHost(host)
      void ui.onReady()
      for (const d of shellCommandDisposers) d.dispose()
      shellCommandDisposers = registerShellCommands((host as CanvasHostHandle).ctx, ui)
    }

onBeforeUnmount:

    for (const d of shellCommandDisposers) d.dispose()
    shellCommandDisposers = []

import:

    import { registerShellCommands } from './shellCommands'
    import type { CanvasHostHandle } from '@mini-canvas/canvas-render'

- [ ] **Step 6: 跑测试与类型检查**

Run:

    pnpm -C packages/ui test -- drawerTabs
    pnpm -C packages/ui test -- shellCommands
    pnpm -C packages/ui test -- drawerTabState
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck

Expected: 全绿。

- [ ] **Step 7: 提交**

    git add packages/ui/src/composables/drawerTabs.ts packages/ui/src/shellCommands.ts packages/ui/src/composables/__tests__/drawerTabs.test.ts packages/ui/src/__tests__/shellCommands.test.ts packages/ui/src/__tests__/drawerTabState.test.ts packages/ui/src/composables/ui.ts packages/ui/src/App.vue
    git commit -m "feat(ui): add drawer tab registry and shell commands"

---

### Task 8: 左侧抽屉接入插件页签

**Files:**

- Modify: packages/ui/src/components/areas/LeftDrawer.vue
- Test: packages/ui/src/__tests__/leftDrawerTabs.test.ts

**Interfaces:**

    const { ctx } = useCanvasContext()

    const drawerHost = {
      get activeTab() { return s.leftTab },
      get width() { return s.drawerWidth },
      openTab: (id: string) => ui.openDrawerTab(id),
      close: () => { s.drawer = null },
      toggleCollapsed: () => ui.toggleLeftCollapsed(),
    }

- [ ] **Step 1: 写失败测试**

Create packages/ui/src/__tests__/leftDrawerTabs.test.ts:

    import { describe, expect, it } from 'vitest'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'

    const src = readFileSync(
      fileURLToPath(new URL('../components/areas/LeftDrawer.vue', import.meta.url)),
      'utf8',
    )

    describe('LeftDrawer 插件页签', () => {
      it('使用基础上下文并读 shell.drawer.tabs', () => {
        expect(src).toContain('useCanvasContext')
        expect(src).toContain("occupants('shell.drawer.tabs')")
      })

      it('页签按钮收到 active / onSelect / host', () => {
        expect(src).toContain(':active=')
        expect(src).toContain(':on-select=')
        expect(src).toContain(':host="drawerHost"')
      })

      it('插件面板只在当前页签是它时渲染', () => {
        expect(src).toContain('activePluginTab')
        expect(src).toContain(':is="activePluginTab.panel"')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/ui test -- leftDrawerTabs

Expected: 当前 LeftDrawer 没有这些内容。

- [ ] **Step 3: 改 LeftDrawer 脚本**

加 import：

    import { markRaw } from 'vue'
    import { useCanvasContext } from '@mini-canvas/canvas-render'
    import {
      DRAWER_TAB_ASSETS,
      DRAWER_TAB_CANVAS,
      fallbackDrawerTab,
      resolveDrawerTabs,
    } from '../../composables/drawerTabs'

在 setup 里：

    const { ctx } = useCanvasContext()
    const slotTick = ref(0)
    const bumpSlots = (): void => { slotTick.value += 1 }

    const slotRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('slots')
    const slotOff = slotRegistry?.subscribe?.(bumpSlots)

    const offInstalled = ctx.on('ctx:plugin-installed', bumpSlots)
    const offUninstalled = ctx.on('ctx:plugin-uninstalled', bumpSlots)

    onBeforeUnmount(() => {
      slotOff?.()
      offInstalled.dispose()
      offUninstalled.dispose()
    })

    const pluginTabsResult = computed(() => {
      void slotTick.value
      return resolveDrawerTabs(ctx.slots.occupants('shell.drawer.tabs'), {
        reserved: [DRAWER_TAB_CANVAS, DRAWER_TAB_ASSETS],
      })
    })

    const pluginTabs = computed(() =>
      pluginTabsResult.value.tabs.map((t) => ({
        ...t,
        button: markRaw(t.button as object),
        panel: markRaw(t.panel as object),
      })),
    )

    const activePluginTab = computed(() =>
      pluginTabs.value.find((t) => t.id === s.leftTab),
    )

    watch(
      pluginTabs,
      (tabs) => {
        const next = fallbackDrawerTab(s.leftTab, tabs.map((t) => t.id))
        if (next !== s.leftTab) s.leftTab = next
      },
      { immediate: true },
    )

    const drawerHost = {
      get activeTab(): string { return s.leftTab },
      get width(): number { return s.drawerWidth },
      openTab: (id: string): void => ui.openDrawerTab(id),
      close: (): void => { s.drawer = null },
      toggleCollapsed: (): void => ui.toggleLeftCollapsed(),
    }

开发态提示非法页签（只提示一次，不打断）：

    watch(
      () => pluginTabsResult.value.invalid,
      (list) => {
        for (const item of list) {
          console.warn('[left-drawer] 忽略页签 ' + item.id + '：' + item.reason)
        }
      },
      { immediate: true },
    )

- [ ] **Step 4: 改页签行**

保留原有 canvas/assets 两个按钮，但在循环后追加：

    <component
      v-for="tab in pluginTabs"
      :key="tab.id"
      :is="tab.button"
      :active="s.leftTab === tab.id"
      :on-select="() => ui.openDrawerTab(tab.id)"
      :host="drawerHost"
    />

把内置按钮的点击从直接写 state 改成统一入口：

    @click="ui.openDrawerTab(t)"

- [ ] **Step 5: 改页签内容**

原有画布与资产内容不动。追加插件页签内容：

    <AxScrollArea
      v-if="activePluginTab"
      class="min-h-0 flex-1"
      direction="y"
      body-class="p-2"
    >
      <component :is="activePluginTab.panel" :host="drawerHost" />
    </AxScrollArea>

放在原有内容之后、底部状态条之前。它用独立 v-if，不与画布/资产的 v-if 链冲突。

- [ ] **Step 6: 跑测试与类型检查**

Run:

    pnpm -C packages/ui test -- leftDrawerTabs
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck

Expected: 全绿。

- [ ] **Step 7: 真机验证**

Run:

    pnpm -C packages/ui dev

在浏览器控制台注册一个测试页签：

    const Vue = window.Vue
    const ctx = window.MiniCanvasUI.getContext()
    const Tab = {
      props: ['active', 'onSelect'],
      render() {
        return Vue.h(
          'button',
          {
            role: 'tab',
            'aria-selected': String(this.active),
            onClick: () => this.onSelect(),
          },
          '测试页签',
        )
      },
    }
    const Panel = {
      props: ['host'],
      render() {
        return Vue.h('div', { 'data-test-panel': '1' }, '测试面板')
      },
    }
    ctx.slots.register('shell.drawer.tabs', {
      id: 'test-tab',
      component: Tab,
      meta: { title: '测试页签', panel: Panel },
    })
    ctx.get('command').execute('shell:open-drawer-tab', { id: 'test-tab' })

确认：

- 抽屉打开并高亮测试页签。
- 面板显示“测试面板”。
- 卸载插件/移除槽后自动回画布页签。
- 收起再展开仍停在测试页签（只要插件还在）。

- [ ] **Step 8: 提交**

    git add packages/ui/src/components/areas/LeftDrawer.vue packages/ui/src/__tests__/leftDrawerTabs.test.ts
    git commit -m "feat(ui): render plugin tabs in left drawer"

---

### Task 9: 真机外壳插槽 e2e

**Files:**

- Create: packages/ui/e2e/shell-slots-check.mjs
- Modify: docs/STATUS.md（验证记录）

**Interfaces:**

    window.MiniCanvasUI.getContext()
    ctx.slots.register / ctx.slots.remove
    window.Vue.h

- [ ] **Step 1: 写 e2e 脚本**

Create packages/ui/e2e/shell-slots-check.mjs:

    // @ts-nocheck
    import { chromium } from 'playwright-core'
    import { existsSync } from 'node:fs'

    const EXE = process.env.CANVAS_E2E_CHROME
      ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
    const BASE = 'http://localhost:' + (process.env.CANVAS_PORT ?? 5288) + '/#/canvas/shell-slots'

    if (!existsSync(EXE)) {
      console.error('chromium 不存在:', EXE)
      process.exit(2)
    }

    const browser = await chromium.launch({ executablePath: EXE, headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message)))

// 本脚本在 SPA 内注册测试槽后会离开页面；收尾必须把宿主清干净，否则 ctx 里残留的
// 测试按钮会跨用例污染，也会让同一 dev server 上的其它 e2e 看到多出来的按钮。
// 注意：page.evaluate 在导航后拿不到旧 ctx，所以清理放在 test 结束前显式做。

    let failed = 0
    function check(name, ok, detail = '') {
      console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -- ' + detail : ''))
      if (!ok) failed++
    }

    await page.goto(BASE, { waitUntil: 'load' })
    await page.evaluate(() => { try { localStorage.clear() } catch {} })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('.vue-flow', { timeout: 30000 })
    await page.waitForTimeout(800)

    const registered = await page.evaluate(() => {
      const Vue = window.Vue
      const ctx = window.MiniCanvasUI.getContext()
      if (!Vue || !ctx) return false

      const button = (text, attr) => ({
        render() {
          return Vue.h('button', { [attr]: text, type: 'button' }, text)
        },
      })

      ctx.slots.register('shell.status.end', {
        id: 'e2e-status',
        component: button('STATUS', 'data-e2e-slot'),
      })
      ctx.slots.register('shell.dock.end', {
        id: 'e2e-dock',
        component: button('DOCK', 'data-e2e-slot'),
      })

      const Tab = {
        props: ['active', 'onSelect'],
        render() {
          return Vue.h(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': String(this.active),
              'data-e2e-slot': 'DRAWER_TAB',
              onClick: () => this.onSelect(),
            },
            'DRAWER_TAB',
          )
        },
      }
      const Panel = {
        props: ['host'],
        render() {
          return Vue.h('div', { 'data-e2e-slot': 'DRAWER_PANEL' }, 'DRAWER_PANEL')
        },
      }
      ctx.slots.register('shell.drawer.tabs', {
        id: 'e2e-tab',
        component: Tab,
        meta: { title: 'E2E 页签', panel: Panel },
      })
      return true
    })
    check('能经 window 注册外壳槽', registered)

    await page.waitForSelector('[data-e2e-slot="STATUS"]', { timeout: 5000 })
    await page.waitForSelector('[data-e2e-slot="DOCK"]', { timeout: 5000 })
    check('状态条出现扩展按钮', (await page.locator('.shell-status [data-e2e-slot="STATUS"]').count()) === 1)
    check('底栏出现扩展按钮', (await page.locator('.shell-dock [data-e2e-slot="DOCK"]').count()) === 1)

    await page.getByRole('button', { name: '资产管理' }).first().click()
    await page.waitForSelector('.left-drawer', { timeout: 5000 })
    await page.locator('.left-drawer [data-e2e-slot="DRAWER_TAB"]').click()
    await page.waitForSelector('[data-e2e-slot="DRAWER_PANEL"]', { timeout: 5000 })
    check('点击插件页签后出现插件面板', (await page.locator('[data-e2e-slot="DRAWER_PANEL"]').count()) === 1)

    const removed = await page.evaluate(() => {
      const ctx = window.MiniCanvasUI.getContext()
      ctx.slots.remove('shell.status.end', 'e2e-status')
      ctx.slots.remove('shell.dock.end', 'e2e-dock')
      ctx.slots.remove('shell.drawer.tabs', 'e2e-tab')
      return true
    })
    check('能移除外壳槽', removed)
    await page.waitForTimeout(300)
    check('状态条按钮随槽移除而消失', (await page.locator('[data-e2e-slot="STATUS"]').count()) === 0)
    check('底栏按钮随槽移除而消失', (await page.locator('[data-e2e-slot="DOCK"]').count()) === 0)
    check('当前插件页签移除后回画布', (await page.locator('.left-drawer [role=tab][aria-selected=true]').innerText()).includes('画布'))

    check('零 pageerror', errors.length === 0, errors.join(' | '))

    await browser.close()
    process.exit(failed ? 1 : 0)

- [ ] **Step 2: 跑 e2e**

先起服务：

    pnpm -C packages/ui dev

另一个终端：

    node packages/ui/e2e/shell-slots-check.mjs

Expected:

- 所有 check PASS。
- 状态条、底栏、抽屉页签三处都能注册、显示、点击、移除。

- [ ] **Step 3: 跑既有 e2e 回归**

    node packages/ui/e2e/canvas-e2e.mjs
    node packages/ui/e2e/context-menu-viewport-check.mjs

Expected: 全 PASS；控制台零 error。

- [ ] **Step 4: 提交**

    git add packages/ui/e2e/shell-slots-check.mjs
    git commit -m "test(ui): cover shell slots in real browser"

---

### Task 10: 文档、索引与最终验证

**Files:**

- Create: docs/代码开发/canvas-render/13-CanvasProvider与外壳插槽.md
- Modify: docs/代码开发/canvas-render/05-渲染上下文与content组件.md
- Modify: docs/代码开发/00-总览与架构.md
- Modify: docs/STATUS.md

**Interfaces:** 无新代码接口；只把已实现契约写清楚。

- [ ] **Step 1: 写新手册**

Create docs/代码开发/canvas-render/13-CanvasProvider与外壳插槽.md，至少写清：

    # CanvasProvider 与外壳插槽

    1. 为什么需要 CanvasProvider
       - Context 与 VueFlow 渲染上下文的边界
       - 为什么外壳不能直接用 useCanvasRender

    2. 两层上下文速查
       - CanvasContext: ctx / host / api / manager
       - CanvasRenderContext: 再加 flow / renderNodes / visibleEdges / interaction

    3. 插槽表
       - shell.status.end
       - shell.dock.start
       - shell.dock.end
       - shell.drawer.tabs

    4. 抽屉页签完整示例
       - 注册按钮 + meta.panel
       - 按钮收到 active / onSelect / host
       - 面板收到 host
       - 保留 id 与缺面板会被忽略

    5. 外壳按钮打开抽屉
       - command: shell:open-drawer-tab

    6. 边界与坑
       - 外壳槽不能用 useCanvasRender
       - SettingsHost 仍在 CanvasHost 内
       - Provider 每个画布只能一个
       - 不要自己写 fixed 定位或 z-index

- [ ] **Step 2: 更新旧手册**

在 docs/代码开发/canvas-render/05-渲染上下文与content组件.md 增加两段：

    ## CanvasProvider 与两层上下文

    - useCanvasRender：CanvasHost 内，含 flow 等渲染能力。
    - useCanvasContext：CanvasProvider 内，含 ctx / host，外壳区域用。
    - 只有 ctx 需求的组件优先 useCanvasContext，这样它既能放外壳也能放画布。

    ## 外壳槽与画布槽的区别

    - overlay / mini-map / agent-conversation 在 CanvasHost 内，可用 useCanvasRender。
    - shell.status.end / shell.dock.* / shell.drawer.tabs 在外壳里，只能用 useCanvasContext。

在 docs/代码开发/00-总览与架构.md 的架构图与入口表里补 CanvasProvider。

- [ ] **Step 3: 更新 STATUS**

在 docs/STATUS.md 顶部“现在该做什么”下新增一条追记，写清：

    - 根因：上下文在 CanvasHost 内，外壳是兄弟节点，只能靠 Teleport 桥。
    - 落地：CanvasProvider / 两层上下文 / 三处外壳槽 / 抽屉页签 / 三条 shell 命令。
    - 验证：各包测试数字、typecheck、e2e 脚本名。
    - 兼容：直接写 CanvasHost 的旧用法仍有效。
    - 已知边界：外壳槽不能使用 flow 相关能力；SettingsHost 仍留在 CanvasHost。

- [ ] **Step 4: 全量验证**

Run:

    pnpm -C packages/canvas-render test
    pnpm -C packages/canvas-render typecheck
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck
    pnpm -C packages/plugins/plugin-theme-default test
    pnpm -C packages/plugins/plugin-mini-map test
    pnpm -C packages/plugins/plugin-agent test
    pnpm -C packages/plugins/plugin-manager test

Expected:

- 全绿。
- 任何一包红都先修根因，不跳过。

Run:

    pnpm -C packages/ui build
    node packages/ui/e2e/shell-slots-check.mjs
    node packages/ui/e2e/canvas-e2e.mjs
    node packages/ui/e2e/context-menu-viewport-check.mjs

Expected:

- build 通过。
- 三条 e2e 全 PASS。

- [ ] **Step 5: 更新 codegraph**

Run:

    codegraph index
    codegraph status

Expected: Index is up to date。

- [ ] **Step 6: 提交**

    git add docs/代码开发/canvas-render/13-CanvasProvider与外壳插槽.md docs/代码开发/canvas-render/05-渲染上下文与content组件.md docs/代码开发/00-总览与架构.md docs/STATUS.md
    git commit -m "docs(canvas-render): document provider and shell slots"

---

## 4. 自审

### 4.1 需求覆盖

| 用户要求 | 对应任务 |
|---|---|
| 最外层 Provider 初始化上下文 | Task 1 / Task 2 / Task 5 |
| 删除 Teleport 桥与锚点表 | Task 2 / Task 4 / Task 5 |
| 左侧抽屉页签行可扩展 | Task 7 / Task 8 |
| 状态条可扩展 | Task 6 / Task 9 |
| 底栏可扩展 | Task 6 / Task 9 |
| 抽屉折叠/展开/隐藏仍由壳管理 | Task 7 / Task 8 |
| 页签上下文传递 | Task 7 / Task 8 |
| 代码更精简 | Task 2 / Task 4 / Task 5；桥接层不再需要 |
| 不破坏旧 CanvasHost 用法 | Task 3 |

### 4.2 类型一致性

- CanvasContext.ctx / host / api / manager 在 Provider、CanvasHostInner、useCanvasContext 中同名。
- CanvasHostProps = CanvasHostBootProps + CanvasHostRenderProps，只在兼容外壳使用。
- drawerHost 的 activeTab / width / openTab / close / toggleCollapsed 在 LeftDrawer 与文档一致。
- 槽名 shell.status.end / shell.dock.start / shell.dock.end / shell.drawer.tabs 在代码、测试、e2e、文档中一致。
- 命令 id shell:open-drawer / shell:open-drawer-tab / shell:toggle-drawer 在 shellCommands、测试、文档中一致。

### 4.3 风险与限制

1. **外壳晚于 App 挂载**：Provider 只在 ready 后渲染默认插槽，所以 App 的 onMounted 早于 CanvasShell。小地图已用 MutationObserver + 2s 兜底；本计划另加 watch(miniMapEl)，避免依赖轮询。
2. **设置面板仍依赖 useCanvasRender**：SettingsHost 继续留在 CanvasHost #ui，不搬去外壳。这限制外壳槽不能直接渲染设置面板内容，但不影响本次三处插槽。
3. **外壳槽的能力边界**：插件组件只能 useCanvasContext；需要 flow 的组件必须留在画布内。文档必须写清楚。
4. **抽屉页签卸载**：插件卸载后，LeftDrawer 的 watch 会把当前页签回退到 canvas，不留下空白面板。
5. **多画布实例**：每个画布实例必须各自包一个 CanvasProvider；不能跨实例共享 Provider。
6. **工作区当前不干净**：Task 0 必须先处理已有 WIP，否则大改中途回退会丢工作。

### 4.4 自审结论

- 文档没有把“子代理审核”写成已完成；按用户要求，不创建子代理。
- 文档没有把“创建分支”写成步骤；按用户要求，不创建分支。
- 文档没有涉及 v1 或核心节点件。
- 文档把“Provider 外提”和“外壳插槽”拆成独立任务，便于逐段验证。

---

## 5. 评审时需要你拍板的点

1. **第一次打开是否接受整页 loading**：Provider ready 前不渲染 CanvasShell。这样最安全，但首屏会先看到“正在启动内核…”。如果你要保留顶栏骨架，需要额外做“可空上下文 + 骨架壳”，复杂度会上升。
2. **抽屉插件页签是否必须带面板**：本计划要求 meta.panel；只有按钮没有面板的注册会被忽略并 warn。这样避免点了页签出现空白。若你要“只加按钮、不新增页签”，应改用状态条/底栏槽，而不是 drawer.tabs。
3. **是否保留直接写 CanvasHost 的旧用法**：本计划保留，代价是多一个兼容外壳文件。若你愿意一次性迁移所有 demo/docs，可以删除兼容外壳，代码更少，但改动面更大。
4. **外壳按钮是否走命令**：本计划用 shell:* 命令控制抽屉，不新增全局 shell 服务。若你更希望 ctx.get('shell') 直接拿对象，可以改成服务，但会多一个服务名。
