# CanvasProvider 与外壳插槽 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 把画布内核的启动和基础上下文移到应用最外层，让左侧抽屉、状态条、底栏直接消费 ctx，并通过 ctx.slots 提供可扩展插槽；不保留旧 CanvasHost 自启动用法，不写任何兼容层。

**Architecture:** 新增无 UI 的 CanvasProvider，唯一负责 createMiniCanvasHost、window API 暴露和卸载收尾。CanvasHost 原地改成纯画布组件，只消费 Provider 提供的 ctx/host，不再创建内核。外壳用 SlotHost 渲染插件组件；左抽屉的扩展页签由 DrawerHost 统一管理 activeTab、开合、收起和宽度。

**Tech Stack:** Vue 3.5、TypeScript、VueFlow、Vitest、Playwright、pnpm workspace。

**Spec:** 本文件 §1-§4 同时承担需求、设计与实施计划。用户 2026-10-27 已确认：不做兼容、接受整页 loading、外壳按钮走命令控制抽屉。

## Global Constraints

- 不碰 v1：根 src/ 与 packages/canvas-core 一律不动。
- 不碰六个核心节点件：BaseNode.vue、MovingHandle.vue、BaseTitle.vue、CustomEdge.vue、ConnectionLine.vue、DefaultBackground.vue。
- 编辑文件只用 apply_patch，不使用 PowerShell 写文件。
- 检索优先 codegraph；开工先跑 codegraph status，结束跑 codegraph index。
- 每个任务完成立即 git add + git commit；不允许大量改动堆在工作区。
- 插件不反向 import @mini-canvas/ui；插件只依赖 ctx、canvas-base 或 canvas-render 的公开面。
- 每个画布实例必须各自包一个 CanvasProvider；同一个 Provider 不能服务两个画布。
- 不保留 CanvasHost 自启动、Provider 缺失时自动补一层、useCanvasContext 回退读 RENDER_CONTEXT_KEY 等兼容路径。
- SettingsHost 仍留在 CanvasHost 的 #ui 内；设置面板内容继续用 useCanvasRender()。
- 外壳槽只提供基础上下文（ctx/host/api/manager）；需要 flow、renderNodes、visibleRect 的组件仍住 CanvasHost 内。
- 抽屉保留 id 只有 canvas 和 assets；插件不能占用。
- UI 数值走 docs/design/ui-style-guide.md 的 token；不自造颜色、圆角、字号、z-index。
- 测试是裁判：每一步先写失败测试，再写最小实现，再跑绿。

---

## 1. 需求与结论

### 1.1 要做的三块区域

1. 左侧抽屉顶部页签行：可以追加“完整页签”（按钮 + 正文面板）。
2. 左下状态条：可以追加按钮或小状态块。
3. 底部中央工具栏：可以在最前或最后追加入口。

### 1.2 用户已确认的决策

| 决策 | 结论 |
|---|---|
| 是否保留旧 CanvasHost 用法 | 不保留。所有调用点一起迁移。 |
| 首次启动 | 接受整页 loading，内核就绪后再显示外壳。 |
| 抽屉控制 | 外壳按钮通过命令打开抽屉、切页签、收起或展开。 |
| 审核方式 | 文档由主代理自审；不创建子代理、不创建分支。 |

### 1.3 根因

    现在
    CanvasShell
      +- CanvasHost        <- 在内部启动内核并提供 ctx
      +- LeftDrawer        <- 兄弟节点，拿不到 ctx

    目标
    CanvasProvider        <- 只启动内核、提供 ctx，不画业务 UI
      +- CanvasShell
           +- CanvasHost  <- 只画 VueFlow
           +- LeftDrawer  <- 直接拿 ctx
           +- StatusArea / DockArea

问题的本质是上下文的提供范围太小，不是“插槽不够”。把启动和基础上下文提到外层，Teleport 桥、锚点表和插件自己查找 DOM 都不再需要。

---

## 2. 设计

### 2.1 两层上下文

| 上下文 | 提供方 | 内容 | 使用范围 |
|---|---|---|---|
| CanvasContext | CanvasProvider | ctx、host、api、manager | 整个应用壳、左侧抽屉、状态条、底栏、外壳插槽 |
| CanvasRenderContext | CanvasSurface | 再加 flow、renderNodes、renderEdges、visibleRect、interaction、edgeVisual 等 | 只在 CanvasHost 的渲染子树内 |

规则：

- 只读服务、命令、设置、插槽、主题目录 → useCanvasContext()。
- 需要视口、节点画面快照、连线反馈、拖拽状态 → useCanvasRender()。
- useCanvasContext() 只认 CanvasProvider；找不到就抛错，不回退到 RENDER_CONTEXT_KEY。
- useCanvasRender() 保持原样，只认 CanvasSurface；找不到就抛错。

### 2.2 组件关系

    CanvasProvider
      provide(CANVAS_CONTEXT_KEY)
      ready 后渲染默认插槽
      +- CanvasShell
           +- TopLeftArea / TopRightArea
           +- StatusArea + SlotHost(shell.status.end)
           +- DockArea + SlotHost(shell.dock.start/end)
           +- LeftDrawer
                +- 内置页签：画布 / 资产
                +- 插件页签按钮（shell.drawer.tabs）
                +- 插件页签面板（meta.panel）
           +- CanvasHost
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

### 2.4 “插件页”是什么

“插件页”不是路由页面、不是设置页、不是画布节点。它专指：

**左侧抽屉里的第三个及之后的页签，以及点中它时显示的正文面板。**

现在抽屉顶部是：

    画布 | 资产

插件注册完整页签后是：

    画布 | 资产 | 灵感

点“灵感”时：

- 页签行里的“灵感”高亮；
- 下方正文从“画布树 / 资产树”切换成插件自己的面板；
- 浏览器 URL 不变，不换路由；
- 再点“画布”或“资产”，抽屉回到原来的树，插件面板卸载。

适合做抽屉页签的内容：

| 例子 | 为什么适合 |
|---|---|
| “灵感 / 备注”列表 | 宽高和抽屉一致，需要长期停留在左侧 |
| 某个工具的补充素材面板 | 和画布同时看，打开抽屉即可操作 |
| 生成历史或操作记录 | 一列一条，适合抽屉宽度 |
| 带搜索和批量操作的表单 | 需要整页空间 |

不适合做抽屉页签的内容：

| 例子 | 应放哪里 |
|---|---|
| 单个按钮 | 状态条或底栏槽 |
| 画布上的浮层 | 现有 overlay 槽 |
| 设置项 | 现有 settingsGroup/<key> |
| 独立页面 | 路由，不进抽屉 |

注册示例：

    ctx.slots.register('shell.drawer.tabs', {
      id: 'inspiration',
      order: 20,
      component: InspirationTabButton,
      meta: {
        title: '灵感',
        panel: InspirationPanel,
      },
    })

按钮收到：

    {
      active: boolean,
      onSelect: () => void,
      host: DrawerHost,
    }

面板收到：

    {
      host: DrawerHost,
    }

DrawerHost 接口：

    export interface DrawerHost {
      readonly activeTab: string
      readonly width: number
      readonly collapsed: boolean
      openTab(id: string): void
      close(): void
      toggleCollapsed(): void
    }

宿主负责：

- 哪个页签高亮；
- 点页签后切到哪一页；
- 抽屉打开、关闭、收起、展开、拖宽；
- 插件卸载后，当前页签若消失就回退到 canvas；
- 画布/资产两个内置页签的行为不变。

插件负责：

- 只画页签按钮和面板内容；
- 使用宿主给的 active/onSelect/host；
- 不直接改 ui.state.leftTab 或 ui.state.drawer；
- 不自己写 fixed 定位，不自己找抽屉 DOM。

### 2.5 外壳操作命令

| 命令 id | payload | 行为 |
|---|---|---|
| shell:open-drawer | 无 | 打开左侧抽屉，保留当前页签 |
| shell:open-drawer-tab | { id: string } | 打开左侧抽屉并切到指定页签 |
| shell:toggle-drawer | 无 | 收起或展开左侧抽屉 |

插件按钮调用：

    ctx.get('command').execute('shell:open-drawer-tab', { id: 'inspiration' })

不新增全局 shell 服务；动作继续走命令表，和项目现有快捷键/右键菜单同一条路。

### 2.6 文件结构

新建：

- packages/canvas-render/src/contracts/canvasContext.ts
- packages/canvas-render/src/host/CanvasProvider.vue
- packages/canvas-render/src/contracts/__tests__/canvasContext.test.ts
- packages/canvas-render/src/host/__tests__/canvasProvider.test.ts
- packages/canvas-render/src/host/__tests__/canvasHostPure.test.ts
- packages/canvas-render/src/components/__tests__/slotHost.test.ts
- packages/ui/src/composables/drawerTabs.ts
- packages/ui/src/composables/__tests__/drawerTabs.test.ts
- packages/ui/src/shellCommands.ts
- packages/ui/src/__tests__/shellCommands.test.ts
- packages/ui/src/__tests__/drawerTabState.test.ts
- packages/ui/src/__tests__/appCanvasProvider.test.ts
- packages/ui/src/__tests__/shellSlotMounts.test.ts
- packages/ui/src/__tests__/leftDrawerTabs.test.ts
- packages/ui/e2e/shell-slots-check.mjs
- docs/代码开发/canvas-render/13-CanvasProvider与外壳插槽.md

修改：

- packages/canvas-render/src/host/CanvasHost.vue
- packages/canvas-render/src/components/SlotHost.vue
- packages/canvas-render/src/contracts/uiCatalog.ts
- packages/canvas-render/src/contracts/useThemeColor.ts
- packages/canvas-render/src/contracts/nodeLayoutSettings.ts
- packages/canvas-render/src/contracts/__tests__/uiCatalog.test.ts
- packages/canvas-render/src/index.ts
- packages/ui/src/App.vue
- packages/ui/src/composables/ui.ts
- packages/ui/src/components/areas/LeftDrawer.vue
- packages/plugins/plugin-theme-gallery/src/GalleryCanvasStage.vue
- packages/plugins/plugin-theme-default/demo-web/App.vue
- packages/docs/public/examples/canvas-render/canvas-host/src/App.vue
- docs/代码开发/canvas-render/05-渲染上下文与content组件.md
- docs/代码开发/canvas-render/09-端到端可运行Demo.md
- docs/代码开发/00-总览与架构.md
- docs/代码开发/plugins/plugin-theme-default.md
- packages/docs/canvas-render/canvas-host.md
- packages/docs/canvas-render/demo.md
- packages/plugins/README.md
- docs/STATUS.md

不动：

- packages/canvas-core 与根 src。
- 六个核心节点件。
- packages/kernel 的公共 API。
- packages/canvas-data 的公共 API。

### 2.7 失败行为

- CanvasProvider 启动失败：默认插槽不渲染，显示 error 插槽；默认文案“启动失败：…”；不再尝试启动第二次。
- CanvasHost 被放在 Provider 外：useCanvasContext 抛清晰错误，提示“请放在 CanvasProvider 内”。
- 抽屉页签缺 meta.panel：忽略该页签并 console.warn 一次，不给空白页。
- 抽屉页签 id 是 canvas/assets：忽略并 warn。
- 插件卸载导致当前页签消失：自动回 canvas，不抛错。
- 启动期间组件卸载：Provider 在异步启动返回后检查 disposed，若已卸载则直接 stop，不写入上下文。

---

## 3. 实施任务

### Task 0: 开工条件

**Files:** 无代码改动。

**Interfaces:** 无。

- [ ] **Step 1: 处理工作区已有 WIP**

Run:

    git status --short --branch

Expected:

- 只留下与本计划无关、且已确认的 WIP。
- 未确认的改动先单独提交或备份；不要把本计划建立在别人未提交的半成品上。

- [ ] **Step 2: 跑基线测试**

Run:

    pnpm -C packages/canvas-render test
    pnpm -C packages/ui test

Expected:

- 两包基线全绿。
- 若有既有红项，记录在案，本计划不顺手修无关问题。

- [ ] **Step 3: 更新 codegraph**

Run:

    codegraph status

Expected: Index is up to date。

---

### Task 1: 基础上下文，严格只认 Provider

**Files:**

- Create: packages/canvas-render/src/contracts/canvasContext.ts
- Test: packages/canvas-render/src/contracts/__tests__/canvasContext.test.ts
- Modify: packages/canvas-render/src/index.ts

**Interfaces:**

    export interface CanvasContext {
      ctx: Context
      host: CanvasHostHandle
      api: MiniCanvasApi
      manager: PluginManager
    }

    export const CANVAS_CONTEXT_KEY: InjectionKey<CanvasContext>
    export function useCanvasContext(): CanvasContext

- [ ] **Step 1: 写失败测试**

Create packages/canvas-render/src/contracts/__tests__/canvasContext.test.ts:

    import { describe, expect, it } from 'vitest'
    import { createSSRApp, defineComponent, h } from 'vue'
    import { renderToString } from 'vue/server-renderer'
    import { Context } from '@mini-canvas/canvas-data'
    import type { CanvasHostHandle, MiniCanvasApi } from '../host/createMiniCanvasHost'
    import type { PluginManager } from '../host/pluginManager'
    import { CANVAS_CONTEXT_KEY, useCanvasContext } from '../canvasContext'

    const Probe = defineComponent({
      name: 'CanvasContextProbe',
      setup() {
        const { ctx } = useCanvasContext()
        return () => h('div', { 'data-probe': 'ok' }, ctx.getState())
      },
    })

    describe('CanvasContext', () => {
      it('在 Provider 内取到 ctx / host / api / manager', async () => {
        const ctx = new Context()
        const host = { ctx } as unknown as CanvasHostHandle
        const api = {} as MiniCanvasApi
        const manager = {} as PluginManager
        const app = createSSRApp(Probe)
        app.provide(CANVAS_CONTEXT_KEY, { ctx, host, api, manager })
        const html = await renderToString(app)
        expect(html).toContain('data-probe="ok"')
        expect(html).toContain('created')
      })

      it('没有 Provider 时直接抛错，不回退读渲染上下文', async () => {
        const app = createSSRApp(Probe)
        await expect(renderToString(app)).rejects.toThrow(/CanvasProvider/)
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/canvas-render test -- canvasContext

Expected: 模块不存在或 useCanvasContext 未定义。

- [ ] **Step 3: 写实现**

Create packages/canvas-render/src/contracts/canvasContext.ts:

    import { inject, type InjectionKey } from 'vue'
    import type { Context } from '@mini-canvas/canvas-data'
    import type { CanvasHostHandle, MiniCanvasApi } from '../host/createMiniCanvasHost'
    import type { PluginManager } from '../host/pluginManager'

    export interface CanvasContext {
      ctx: Context
      host: CanvasHostHandle
      api: MiniCanvasApi
      manager: PluginManager
    }

    export const CANVAS_CONTEXT_KEY: InjectionKey<CanvasContext> = Symbol('mini-canvas-context')

    export function useCanvasContext(): CanvasContext {
      const base = inject(CANVAS_CONTEXT_KEY, null)
      if (!base) {
        throw new Error(
          '[useCanvasContext] 缺少画布上下文：请把组件放在 <CanvasProvider> 内。' +
            '如果这里需要视口/节点渲染快照，它应该放在 <CanvasHost> 内并用 useCanvasRender()。',
        )
      }
      return base
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
    git commit -m "feat(canvas-render): add strict base canvas context"

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

    export interface CanvasContextMenuPayload {
      kind: 'node' | 'pane' | 'edge'
      clientX: number
      clientY: number
      nodeId?: string
      edgeId?: string
    }

    export interface CanvasHostEmits {
      ready: [host: CanvasHostHandle]
      'context-menu': [payload: CanvasContextMenuPayload]
      'plugin-issue': [payload: { name: string; lifecycle: string }]
    }

    export interface CanvasProviderEmits {
      ready: [host: CanvasHostHandle]
      'boot-error': [error: Error]
    }

- [ ] **Step 1: 写失败测试**

Create packages/canvas-render/src/host/__tests__/canvasProvider.test.ts:

    import { describe, expect, it } from 'vitest'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'

    function read(rel: string): string {
      return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    }

    describe('CanvasProvider 启动责任', () => {
      it('Provider 是唯一启动点，并在卸载后 stop', () => {
        const src = read('../CanvasProvider.vue')
        expect(src).toContain('createMiniCanvasHost')
        expect(src).toContain('exposeToWindow(props.windowKey)')
        expect(src).toContain('onUnmounted')
        expect(src).toContain('host.stop()')
        expect(src).toContain('CANVAS_CONTEXT_KEY')
        expect(src).toContain('disposed')
      })

      it('Provider 只在 ready 后显示默认插槽', () => {
        const src = read('../CanvasProvider.vue')
        expect(src).toContain('v-if="ready"')
        expect(src).toContain('name="loading"')
        expect(src).toContain('name="error"')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/canvas-render test -- canvasProvider

Expected: CanvasProvider.vue 不存在。

- [ ] **Step 3: 写共享类型**

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

    export interface CanvasContextMenuPayload {
      kind: 'node' | 'pane' | 'edge'
      clientX: number
      clientY: number
      nodeId?: string
      edgeId?: string
    }

    export interface CanvasHostEmits {
      ready: [host: CanvasHostHandle]
      'context-menu': [payload: CanvasContextMenuPayload]
      'plugin-issue': [payload: { name: string; lifecycle: string }]
    }

    export interface CanvasProviderEmits {
      ready: [host: CanvasHostHandle]
      'boot-error': [error: Error]
    }

- [ ] **Step 4: 写 CanvasProvider**

Create packages/canvas-render/src/host/CanvasProvider.vue:

    <script setup lang="ts">
    import { onBeforeUnmount, onMounted, onUnmounted, provide, ref, shallowRef } from 'vue'
    import { createMiniCanvasHost, type CanvasHostHandle, type MiniCanvasApi } from './createMiniCanvasHost'
    import type { PluginManager } from './pluginManager'
    import type { CanvasHostBootProps, CanvasProviderEmits } from './canvasHostTypes'
    import { CANVAS_CONTEXT_KEY, type CanvasContext } from '../contracts/canvasContext'

    const props = withDefaults(defineProps<CanvasHostBootProps>(), {
      plugins: () => [],
    })

    const emit = defineEmits<CanvasProviderEmits>()

    interface Boot {
      host: CanvasHostHandle
      api: MiniCanvasApi
      manager: PluginManager
    }

    const boot = shallowRef<Boot | null>(null)
    const error = ref<Error | null>(null)
    const ready = ref(false)
    let disposed = false

    function mustBoot(): Boot {
      if (!boot.value) throw new Error('[CanvasProvider] 上下文尚未就绪')
      return boot.value
    }

    provide(CANVAS_CONTEXT_KEY, {
      get ctx() {
        return mustBoot().host.ctx
      },
      get host() {
        return mustBoot().host
      },
      get api() {
        return mustBoot().api
      },
      get manager() {
        return mustBoot().manager
      },
    } satisfies CanvasContext)

    onMounted(async () => {
      try {
        const r = await createMiniCanvasHost({
          adapter: props.adapter,
          manifest: props.manifest,
          coldPlugins: props.plugins,
          seedDefault: props.seed,
          dev: props.dev,
        })
        if (disposed) {
          r.host.stop()
          return
        }
        boot.value = { host: r.host, api: r.api, manager: r.manager }
        if (props.windowKey) r.exposeToWindow(props.windowKey)
        ready.value = true
        emit('ready', r.host)
      } catch (e) {
        if (disposed) return
        error.value = e instanceof Error ? e : new Error(String(e))
        emit('boot-error', error.value)
      }
    })

    onBeforeUnmount(() => {
      if (!boot.value) return
      void boot.value.host.save.flush()
    })

    onUnmounted(() => {
      disposed = true
      if (!boot.value) return
      boot.value.host.stop()
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
      min-height: 100vh;
      color: var(--ui-ink-dim, #6b7280);
      background: var(--ui-canvas-bg, #f5f6f8);
      font: 13px system-ui, 'Microsoft YaHei', sans-serif;
    }
    .canvas-provider-status.is-error {
      color: var(--ui-danger, #dc2626);
    }
    </style>

说明：

- Provider 不创建 NodeRegistry；CanvasHost 使用 host.nodeRegistry。
- Provider 不做任何画布渲染。
- onUnmounted 才 stop，保证 CanvasHost 的订阅先卸载。
- 如果启动还没返回组件就卸载，disposed 分支会 stop 刚建好的宿主。

- [ ] **Step 5: 导出 Provider 与类型**

Modify packages/canvas-render/src/index.ts:

    export { default as CanvasProvider } from './host/CanvasProvider.vue'
    export type {
      CanvasHostBootProps,
      CanvasHostRenderProps,
      CanvasContextMenuPayload,
      CanvasHostEmits,
      CanvasProviderEmits,
    } from './host/canvasHostTypes'

- [ ] **Step 6: 跑测试确认通过**

Run:

    pnpm -C packages/canvas-render test -- canvasProvider
    pnpm -C packages/canvas-render typecheck

Expected: 全绿。

- [ ] **Step 7: 提交**

    git add packages/canvas-render/src/host/CanvasProvider.vue packages/canvas-render/src/host/canvasHostTypes.ts packages/canvas-render/src/host/__tests__/canvasProvider.test.ts packages/canvas-render/src/index.ts
    git commit -m "feat(canvas-render): add CanvasProvider as the only host boot point"

---

### Task 3: CanvasHost 改成纯画布组件，并迁移所有调用点

**Files:**

- Modify: packages/canvas-render/src/host/CanvasHost.vue
- Modify: packages/ui/src/App.vue
- Modify: packages/plugins/plugin-theme-gallery/src/GalleryCanvasStage.vue
- Modify: packages/plugins/plugin-theme-default/demo-web/App.vue
- Modify: packages/docs/public/examples/canvas-render/canvas-host/src/App.vue
- Test: packages/canvas-render/src/host/__tests__/canvasHostPure.test.ts

**Interfaces:**

    CanvasHost props = CanvasHostRenderProps
    CanvasHost emits = CanvasHostEmits
    CanvasHost 不接收 plugins / adapter / seed / windowKey

- [ ] **Step 1: 写失败测试**

Create packages/canvas-render/src/host/__tests__/canvasHostPure.test.ts:

    import { describe, expect, it } from 'vitest'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'

    function read(rel: string): string {
      return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    }

    describe('CanvasHost 纯画布化', () => {
      it('不再创建内核、不再创建 NodeRegistry、不再 stop host', () => {
        const src = read('../CanvasHost.vue')
        expect(src).not.toContain('createMiniCanvasHost')
        expect(src).not.toContain('new NodeRegistry')
        expect(src).not.toContain('new MemoryStorageAdapter')
        expect(src).not.toContain('host.stop()')
        expect(src).not.toContain('exposeToWindow')
      })

      it('改为消费基础上下文，并用 host.nodeRegistry', () => {
        const src = read('../CanvasHost.vue')
        expect(src).toContain('useCanvasContext')
        expect(src).toContain('host.nodeRegistry')
        expect(src).toContain('CanvasHostRenderProps')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/canvas-render test -- canvasHostPure

Expected: 当前 CanvasHost 仍含 createMiniCanvasHost。

- [ ] **Step 3: 改 CanvasHost 顶部**

在 CanvasHost.vue 的 script 顶部：

- 删除 createMiniCanvasHost、MemoryStorageAdapter 的 import；
- 增加 useCanvasContext、CanvasHostRenderProps、CanvasHostEmits 的 import；
- 加：

    const { host, api, manager } = useCanvasContext()

    const props = withDefaults(defineProps<CanvasHostRenderProps>(), {
      persistViewport: true,
    })
    const emit = defineEmits<CanvasHostEmits>()

    const hostRef = shallowRef<CanvasHostHandle>(host)
    const registry = host.nodeRegistry

把原来的：

    const booting = ref(true)
    const bootError = ref('')
    const hostRef = shallowRef<CanvasHostHandle | undefined>()
    const apiRef = shallowRef<MiniCanvasApi | undefined>()
    const managerRef = shallowRef<PluginManager | undefined>()

改成：

    const surfaceReady = ref(false)
    const mountError = ref('')

注意：原文件里的 const registry = new NodeRegistry() 整行删除；所有 registry 引用继续用，但现在指向 host.nodeRegistry。

- [ ] **Step 4: 改 onMounted**

原 onMounted 从 const { host, api, manager, exposeToWindow } = await createMiniCanvasHost({ ... }) 开始。

删除这一段启动代码以及 hostRef.value = host、apiRef.value = api、managerRef.value = manager、exposeToWindow。

保留原有启动后的逻辑，改为：

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

        // 原文件里的插件热装/热卸、themeRegistry、nodeRegistry、node/shell、plugin-issue 订阅原样保留
        // 这里只把启动时的 host 改成上文的常量 host。

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

        if (props.persistViewport) {
          const vp = await host.save.get<ViewportState>(GRAPH_VIEWPORT_KEY, 'canvas')
          savedViewport.value = vp
        }

        surfaceReady.value = true
        emit('ready', host)
      } catch (err) {
        mountError.value = err instanceof Error ? err.message : String(err)
        surfaceReady.value = true
      }
    })

注意：cloud-client/edit-guard 的 ctx.inject 依赖 interaction，仍留在内层，位置和内容不变。

- [ ] **Step 5: 改模板与 defineExpose**

模板把启动态替换成内层准备态：

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

onBeforeUnmount 里删除：

    void hostRef.value?.save.flush()
    hostRef.value?.stop()

其余解绑（rAF、subs、window listeners）保留。

全文件搜一次 booting、bootError、apiRef、managerRef，确认没有残留。

- [ ] **Step 6: 迁移 App.vue**

App.vue 改成：

    import { CanvasHost, CanvasProvider, SettingsHost, SlotHost } from '@mini-canvas/canvas-render'
    import type { CanvasHostHandle } from '@mini-canvas/canvas-render'

    let shellCommandDisposers: Array<{ dispose(): void }> = []

    function onProviderReady(host: CanvasHostHandle): void {
      setReadyHost(host)
      ui.setHostEl({ host })
      void ui.onReady()
      for (const d of shellCommandDisposers) d.dispose()
      shellCommandDisposers = registerShellCommands(host.ctx, ui)
    }

    onBeforeUnmount(() => {
      for (const d of shellCommandDisposers) d.dispose()
      shellCommandDisposers = []
    })

模板（注意 Provider 在 CanvasShell 外面）：

    <CanvasProvider
      :plugins="plugins"
      :adapter="adapter"
      :seed="seedDefaultCanvas"
      :dev="DEV"
      window-key="MiniCanvasUI"
      @ready="onProviderReady"
    >
      <CanvasShell ...>
        ...原有内容...
      </CanvasShell>
    </CanvasProvider>

CanvasHost 只保留渲染参数和 #ui：

    <CanvasHost
      :edge-visual="ui.cfg.edge"
      :handle-visual="ui.cfg.handle"
      :debug-visual="ui.cfg.debug"
      :snap-zone-visual="ui.cfg.snapZone"
    >
      <template #ui>
        <SettingsHost v-if="s.settingsOpen" />
        <AgentPanel />
        <div ref="miniMapEl" class="fixed left-0 top-0 z-[25]" :style="{ pointerEvents: 'none', visibility: miniMapPlaced ? 'visible' : 'hidden' }">
          <div style="pointer-events: auto">
            <SlotHost slot="mini-map" />
          </div>
        </div>
        <AssetUiSlot />
      </template>
    </CanvasHost>

删掉 CanvasHost 上的 :ref、:plugins、:adapter、:seed、:dev、window-key、@ready。

补小地图挂载 watch：

    watch(miniMapEl, () => placeMiniMap(), { flush: 'post' })

- [ ] **Step 7: 迁移 GalleryCanvasStage**

改成：

    import { CanvasHost, CanvasProvider } from '@mini-canvas/canvas-render'

    <div class="gcs-stage" :style="{ height: (height ?? 300) + 'px' }">
      <CanvasProvider :plugins="plugins" :adapter="adapter">
        <CanvasHost :persist-viewport="false" />
      </CanvasProvider>
    </div>

- [ ] **Step 8: 迁移 theme-default demo**

改成：

    import { CanvasHost, CanvasProvider } from '@mini-canvas/canvas-render'

    <CanvasProvider
      :plugins="[themeDefaultPlugin, demoNodePlugin]"
      :seed="seedDefault"
      window-key="MiniCanvasThemePreview"
    >
      <CanvasHost class="canvas-area" @ready="ready = true" />
    </CanvasProvider>

外层 .preview-root 和 .bar 不变。

- [ ] **Step 9: 迁移 docs 的 CanvasHost 示例**

packages/docs/public/examples/canvas-render/canvas-host/src/App.vue：

    import { CanvasHost, CanvasProvider, type CanvasHostHandle } from '@mini-canvas/canvas-render'

    <CanvasProvider
      :plugins="plugins"
      :adapter="adapter"
      :dev="import.meta.env.DEV"
      window-key="MiniCanvasHostDemo"
    >
      <CanvasHost
        ref="canvas"
        :edge-visual="edge"
        :handle-visual="handle"
        @ready="onReady"
        @plugin-issue="(p) => console.warn('插件出问题了：', p.name, p.lifecycle)"
      >
        <template #ui>
          <div class="demo-bar">...</div>
        </template>
      </CanvasHost>
    </CanvasProvider>

- [ ] **Step 10: 跑测试与类型检查**

Run:

    pnpm -C packages/canvas-render test -- canvasHostPure
    pnpm -C packages/canvas-render test
    pnpm -C packages/canvas-render typecheck
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck
    pnpm -C packages/plugins/plugin-theme-gallery test
    pnpm -C packages/plugins/plugin-theme-gallery typecheck
    pnpm -C packages/plugins/plugin-theme-default test
    pnpm -C packages/plugins/plugin-theme-default typecheck

Expected:

- 全绿。
- 如果组件测试里出现“找不到 CanvasProvider”，说明该测试还只 provide RENDER_CONTEXT_KEY；按 Task 4 改成 provide CANVAS_CONTEXT_KEY。

- [ ] **Step 11: 提交**

    git add packages/canvas-render/src/host/CanvasHost.vue packages/canvas-render/src/host/__tests__/canvasHostPure.test.ts packages/ui/src/App.vue packages/plugins/plugin-theme-gallery/src/GalleryCanvasStage.vue packages/plugins/plugin-theme-default/demo-web/App.vue packages/docs/public/examples/canvas-render/canvas-host/src/App.vue
    git commit -m "refactor(canvas-render): make CanvasHost a pure canvas consumer"

---

### Task 4: SlotHost 与相关 helper 改用基础上下文

**Files:**

- Modify: packages/canvas-render/src/components/SlotHost.vue
- Modify: packages/canvas-render/src/contracts/uiCatalog.ts
- Modify: packages/canvas-render/src/contracts/useThemeColor.ts
- Modify: packages/canvas-render/src/contracts/nodeLayoutSettings.ts
- Modify: packages/canvas-render/src/contracts/__tests__/uiCatalog.test.ts
- Test: packages/canvas-render/src/components/__tests__/slotHost.test.ts

**Interfaces:**

    useCanvasContext() -> CanvasContext
    SlotHost 仍收 { slot: string, itemClass?: string }

- [ ] **Step 1: 写失败测试**

Create packages/canvas-render/src/components/__tests__/slotHost.test.ts:

    import { describe, expect, it } from 'vitest'
    import { createSSRApp, defineComponent, h } from 'vue'
    import { renderToString } from 'vue/server-renderer'
    import { Context } from '@mini-canvas/canvas-data'
    import type { CanvasHostHandle, MiniCanvasApi } from '../../host/createMiniCanvasHost'
    import type { PluginManager } from '../../host/pluginManager'
    import { CANVAS_CONTEXT_KEY, type CanvasContext } from '../../contracts/canvasContext'
    import SlotHost from '../SlotHost.vue'

    function baseContext(ctx: Context): CanvasContext {
      return {
        ctx,
        host: {} as CanvasHostHandle,
        api: {} as MiniCanvasApi,
        manager: {} as PluginManager,
      }
    }

    describe('SlotHost 使用基础上下文', () => {
      it('Provider 内可渲染外壳槽', async () => {
        const ctx = new Context()
        await ctx.start()
        ctx.slots.register('shell.dock.end', {
          id: 'demo',
          component: defineComponent({ render: () => h('button', { 'data-demo': '1' }, '扩展') }),
        })
        const app = createSSRApp({ render: () => h(SlotHost, { slot: 'shell.dock.end' }) })
        app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
        const html = await renderToString(app)
        expect(html).toContain('data-demo')
        expect(html).toContain('扩展')
        ctx.stop()
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/canvas-render test -- slotHost

Expected: SlotHost 仍抛“缺少渲染上下文”。

- [ ] **Step 3: 换消费入口**

SlotHost.vue：

    import { useCanvasContext } from '../contracts/canvasContext'
    const { ctx } = useCanvasContext()

uiCatalog.ts：

    import { useCanvasContext } from './canvasContext'
    const { ctx } = useCanvasContext()

useThemeColor.ts：

    import { useCanvasContext } from './canvasContext'
    const { ctx } = useCanvasContext()

nodeLayoutSettings.ts 的两处：

    import { useCanvasContext } from './canvasContext'
    const { ctx } = useCanvasContext()

把注释里“必须在 CanvasHost 渲染子树内”改成“在 CanvasProvider 内或 CanvasHost 内”。

- [ ] **Step 4: 修 uiCatalog 测试**

packages/canvas-render/src/contracts/__tests__/uiCatalog.test.ts 里：

- 删掉 RENDER_CONTEXT_KEY / CanvasRenderContext 的 import；
- 增加 CANVAS_CONTEXT_KEY / CanvasContext；
- renderWithCatalog 改成：

    const app = createSSRApp({ render: () => h(Consumer) })
    app.provide(CANVAS_CONTEXT_KEY, {
      ctx: { registryOf: () => field } as unknown as Context,
      host: {} as CanvasHostHandle,
      api: {} as MiniCanvasApi,
      manager: {} as PluginManager,
    })
    return renderToString(app)

需要的类型从 createMiniCanvasHost / pluginManager 导入。

- [ ] **Step 5: 跑测试与类型检查**

Run:

    pnpm -C packages/canvas-render test -- slotHost
    pnpm -C packages/canvas-render test -- uiCatalog
    pnpm -C packages/canvas-render test
    pnpm -C packages/canvas-render typecheck

Expected: 全绿。

- [ ] **Step 6: 提交**

    git add packages/canvas-render/src/components/SlotHost.vue packages/canvas-render/src/contracts/uiCatalog.ts packages/canvas-render/src/contracts/useThemeColor.ts packages/canvas-render/src/contracts/nodeLayoutSettings.ts packages/canvas-render/src/contracts/__tests__/uiCatalog.test.ts packages/canvas-render/src/components/__tests__/slotHost.test.ts
    git commit -m "refactor(canvas-render): consume base context in slot hosts and helpers"

---

### Task 5: App 的 Provider 装配（整合进 Task 3 后只补测试）

**Files:**

- Test: packages/ui/src/__tests__/appCanvasProvider.test.ts

**Interfaces:**

    CanvasProvider 包住 CanvasShell
    CanvasProvider 持有 plugins / adapter / seed / dev / windowKey
    CanvasHost 只持有渲染参数

- [ ] **Step 1: 写测试**

Create packages/ui/src/__tests__/appCanvasProvider.test.ts:

    import { describe, expect, it } from 'vitest'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'

    const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')

    describe('App 装配层级', () => {
      it('Provider 在 CanvasShell 外面', () => {
        expect(app.indexOf('<CanvasProvider')).toBeGreaterThan(-1)
        expect(app.indexOf('<CanvasShell')).toBeGreaterThan(app.indexOf('<CanvasProvider'))
      })

      it('CanvasHost 不再携带启动参数', () => {
        const host = app.slice(app.indexOf('<CanvasHost'), app.indexOf('</CanvasHost>'))
        expect(host).not.toContain(':plugins=')
        expect(host).not.toContain(':adapter=')
        expect(host).not.toContain(':seed=')
        expect(host).not.toContain('window-key=')
        expect(host).not.toContain(':ref=')
      })

      it('设置面板仍在 CanvasHost 的 #ui 内', () => {
        const host = app.slice(app.indexOf('<CanvasHost'), app.indexOf('</CanvasHost>'))
        expect(host).toContain('<SettingsHost')
      })

      it('Provider 的 ready 负责旧 onReady 工作', () => {
        expect(app).toContain('@ready="onProviderReady"')
        expect(app).toContain('setReadyHost(host)')
        expect(app).toContain('ui.setHostEl({ host })')
        expect(app).toContain('registerShellCommands(host.ctx, ui)')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/ui test -- appCanvasProvider

Expected: Task 3 变绿前红；Task 3 完成后应绿。

- [ ] **Step 3: 提交**

    git add packages/ui/src/__tests__/appCanvasProvider.test.ts
    git commit -m "test(ui): lock CanvasProvider app wiring"

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

- CanvasShell 已有 dock-append，不新增它。
- 插件按钮只画按钮本身，不自带 fixed 定位和外层容器。
- 推挤和居中仍由 CanvasShell 负责。

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

### Task 7: 抽屉页签纯逻辑、DrawerHost 状态与 shell 命令

**Files:**

- Create: packages/ui/src/composables/drawerTabs.ts
- Create: packages/ui/src/shellCommands.ts
- Modify: packages/ui/src/composables/ui.ts
- Test: packages/ui/src/composables/__tests__/drawerTabs.test.ts
- Test: packages/ui/src/__tests__/shellCommands.test.ts
- Test: packages/ui/src/__tests__/drawerTabState.test.ts

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

    export interface DrawerHost {
      readonly activeTab: string
      readonly width: number
      readonly collapsed: boolean
      openTab(id: string): void
      close(): void
      toggleCollapsed(): void
    }

    export function resolveDrawerTabs(
      occ: Array<{ id: string; order: number; component: unknown; meta?: unknown }>,
      opts?: { reserved?: string[] },
    ): { tabs: DrawerTabEntry[]; invalid: Array<{ id: string; reason: 'reserved' | 'missing-panel' | 'missing-button' }> }

    export function fallbackDrawerTab(active: string, pluginIds: string[]): string

    export function registerShellCommands(
      ctx: Context,
      host: {
        showLeftDrawer(): void
        openDrawerTab(id: string): void
        toggleLeftCollapsed(): void
      },
    ): Array<{ dispose(): void }>

- [ ] **Step 1: 写 drawerTabs 测试**

Create packages/ui/src/composables/__tests__/drawerTabs.test.ts:

    import { describe, expect, it } from 'vitest'
    import { fallbackDrawerTab, resolveDrawerTabs } from '../drawerTabs'

    const A = { name: 'A' }
    const B = { name: 'B' }
    const P = { name: 'P' }

    describe('resolveDrawerTabs', () => {
      it('按 order 排序，只保留带按钮与面板的页签', () => {
        const r = resolveDrawerTabs([
          { id: 'b', order: 20, component: B, meta: { panel: P, title: 'B' } },
          { id: 'a', order: 10, component: A, meta: { panel: P, title: 'A' } },
        ])
        expect(r.tabs.map((t) => t.id)).toEqual(['a', 'b'])
      })

      it('保留 id、缺面板、缺按钮都被拒绝并给出原因', () => {
        const r = resolveDrawerTabs(
          [
            { id: 'canvas', order: 0, component: A, meta: { panel: P } },
            { id: 'no-panel', order: 30, component: A, meta: {} },
            { id: 'no-button', order: 40, component: undefined, meta: { panel: P } },
            { id: 'ok', order: 10, component: A, meta: { panel: P } },
          ],
          { reserved: ['canvas', 'assets'] },
        )
        expect(r.tabs.map((t) => t.id)).toEqual(['ok'])
        expect(r.invalid).toEqual([
          { id: 'canvas', reason: 'reserved' },
          { id: 'no-panel', reason: 'missing-panel' },
          { id: 'no-button', reason: 'missing-button' },
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

- [ ] **Step 2: 写 shell 命令测试**

Create packages/ui/src/__tests__/shellCommands.test.ts:

    import { describe, expect, it } from 'vitest'
    import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
    import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
    import { registerShellCommands } from '../shellCommands'

    describe('shell 命令', () => {
      it('打开抽屉 / 切页签 / 收起展开都走命令', async () => {
        const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
        const calls: string[] = []
        const disposers = registerShellCommands(host.ctx, {
          showLeftDrawer: () => calls.push('open'),
          openDrawerTab: (id) => calls.push('tab:' + id),
          toggleLeftCollapsed: () => calls.push('toggle'),
        })

        host.command.execute('shell:open-drawer')
        host.command.execute('shell:open-drawer-tab', { id: 'inspiration' })
        host.command.execute('shell:toggle-drawer')

        expect(calls).toEqual(['open', 'tab:inspiration', 'toggle'])
        for (const d of disposers) d.dispose()
        host.stop()
      })
    })

- [ ] **Step 3: 跑测试确认失败**

Run:

    pnpm -C packages/ui test -- drawerTabs
    pnpm -C packages/ui test -- shellCommands

Expected: 模块不存在。

- [ ] **Step 4: 写 drawerTabs**

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

    export interface DrawerHost {
      readonly activeTab: string
      readonly width: number
      readonly collapsed: boolean
      openTab(id: string): void
      close(): void
      toggleCollapsed(): void
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

- [ ] **Step 5: 写 shellCommands**

Create packages/ui/src/shellCommands.ts:

    import type { Context } from '@mini-canvas/canvas-data'

    export interface ShellCommandHost {
      showLeftDrawer(): void
      openDrawerTab(id: string): void
      toggleLeftCollapsed(): void
    }

    export function registerShellCommands(
      ctx: Context,
      host: ShellCommandHost,
    ): Array<{ dispose(): void }> {
      return [
        ctx.commands.register({
          id: 'shell:open-drawer',
          title: '打开左侧抽屉',
          run: () => host.showLeftDrawer(),
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

- [ ] **Step 6: 改 ui.ts**

1. state.leftTab 改成 string：

    leftTab: DRAWER_TAB_CANVAS as string,

2. 新增：

    function showLeftDrawer(): void {
      state.drawer = 'left'
    }

    function openDrawerTab(id: string): void {
      state.leftTab = id
      state.drawer = 'left'
      if (id === DRAWER_TAB_ASSETS) {
        void loadAssets()
        void loadAssetFolders()
      }
    }

3. toggleLeftCollapsed 去掉强制回 canvas：

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

4. return 对象加 showLeftDrawer、openDrawerTab。

5. 文件顶部导入常量，并 re-export：

    import { DRAWER_TAB_ASSETS, DRAWER_TAB_CANVAS } from './drawerTabs'
    export { DRAWER_TAB_ASSETS, DRAWER_TAB_CANVAS } from './drawerTabs'

6. App 的 onProviderReady 已经调用 registerShellCommands；不需要再加一处。

- [ ] **Step 7: 写 ui 状态测试**

Create packages/ui/src/__tests__/drawerTabState.test.ts:

    import { describe, expect, it } from 'vitest'
    import { useUi } from '../composables/ui'

    describe('抽屉页签状态', () => {
      it('openDrawerTab 打开抽屉并切页签', () => {
        const ui = useUi()
        ui.state.drawer = null
        ui.openDrawerTab('inspiration')
        expect(ui.state.drawer).toBe('left')
        expect(ui.state.leftTab).toBe('inspiration')
      })

      it('收起再展开保留上次页签', () => {
        const ui = useUi()
        ui.state.leftTab = 'inspiration'
        ui.state.leftCollapsed = false
        ui.state.drawer = 'left'
        ui.toggleLeftCollapsed()
        expect(ui.state.drawer).toBe(null)
        ui.toggleLeftCollapsed()
        expect(ui.state.drawer).toBe('left')
        expect(ui.state.leftTab).toBe('inspiration')
      })
    })

- [ ] **Step 8: 跑测试与类型检查**

Run:

    pnpm -C packages/ui test -- drawerTabs
    pnpm -C packages/ui test -- shellCommands
    pnpm -C packages/ui test -- drawerTabState
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck

Expected: 全绿。

- [ ] **Step 9: 提交**

    git add packages/ui/src/composables/drawerTabs.ts packages/ui/src/shellCommands.ts packages/ui/src/composables/__tests__/drawerTabs.test.ts packages/ui/src/__tests__/shellCommands.test.ts packages/ui/src/__tests__/drawerTabState.test.ts packages/ui/src/composables/ui.ts
    git commit -m "feat(ui): add drawer tab logic and shell commands"

---

### Task 8: 左侧抽屉渲染插件页签

**Files:**

- Modify: packages/ui/src/components/areas/LeftDrawer.vue
- Test: packages/ui/src/__tests__/leftDrawerTabs.test.ts

**Interfaces:**

    const { ctx } = useCanvasContext()
    ctx.slots.occupants('shell.drawer.tabs')
    DrawerHost 通过 props 交给页签按钮和面板

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
      it('读基础上下文与 shell.drawer.tabs', () => {
        expect(src).toContain('useCanvasContext')
        expect(src).toContain("occupants('shell.drawer.tabs')")
      })

      it('按钮收到 active / onSelect / host', () => {
        expect(src).toContain(':active=')
        expect(src).toContain(':on-select=')
        expect(src).toContain(':host="drawerHost"')
      })

      it('面板只在当前页签时渲染', () => {
        expect(src).toContain('activePluginTab')
        expect(src).toContain(':is="activePluginTab.panel"')
      })
    })

- [ ] **Step 2: 跑测试确认失败**

Run:

    pnpm -C packages/ui test -- leftDrawerTabs

Expected: 当前 LeftDrawer 没有这些内容。

- [ ] **Step 3: 加脚本**

在 LeftDrawer.vue 的 setup 中增加：

    import { markRaw } from 'vue'
    import { useCanvasContext } from '@mini-canvas/canvas-render'
    import {
      DRAWER_TAB_ASSETS,
      DRAWER_TAB_CANVAS,
      fallbackDrawerTab,
      resolveDrawerTabs,
      type DrawerHost,
    } from '../../composables/drawerTabs'

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

    const drawerHost: DrawerHost = {
      get activeTab() { return s.leftTab },
      get width() { return s.drawerWidth },
      get collapsed() { return s.leftCollapsed },
      openTab: (id: string) => ui.openDrawerTab(id),
      close: () => { s.drawer = null },
      toggleCollapsed: () => ui.toggleLeftCollapsed(),
    }

    const warned = new Set<string>()
    watch(
      () => pluginTabsResult.value.invalid,
      (list) => {
        for (const item of list) {
          const key = item.id + ':' + item.reason
          if (warned.has(key)) continue
          warned.add(key)
          console.warn('[left-drawer] 忽略页签 ' + item.id + '：' + item.reason)
        }
      },
      { immediate: true },
    )

- [ ] **Step 4: 改页签行**

原有内置按钮改成走统一入口：

    <button
      v-for="t in ([DRAWER_TAB_CANVAS, DRAWER_TAB_ASSETS] as const)"
      :key="t"
      ...
      @click="ui.openDrawerTab(t)"
    >{{ t === DRAWER_TAB_CANVAS ? '画布' : '资产' }}</button>

在循环后追加：

    <component
      v-for="tab in pluginTabs"
      :key="tab.id"
      :is="tab.button"
      :active="s.leftTab === tab.id"
      :on-select="() => ui.openDrawerTab(tab.id)"
      :host="drawerHost"
    />

- [ ] **Step 5: 加插件正文**

原有画布/资产内容不动。在它们之后、底部状态条之前追加：

    <AxScrollArea
      v-if="activePluginTab"
      class="min-h-0 flex-1"
      direction="y"
      body-class="p-2"
    >
      <component :is="activePluginTab.panel" :host="drawerHost" />
    </AxScrollArea>

注意：不要把它塞进 s.leftTab === 'assets' 的 v-if 里；它必须是独立分支。

- [ ] **Step 6: 加真机验证**

Run:

    pnpm -C packages/ui dev

浏览器控制台执行：

    const Vue = window.Vue
    const ctx = window.MiniCanvasUI.getContext()
    const Tab = {
      props: ['active', 'onSelect'],
      render() {
        return Vue.h('button', {
          role: 'tab',
          'aria-selected': String(this.active),
          onClick: () => this.onSelect(),
        }, '灵感')
      },
    }
    const Panel = {
      props: ['host'],
      render() {
        return Vue.h('div', { 'data-inspiration': '1' }, '灵感列表')
      },
    }
    ctx.slots.register('shell.drawer.tabs', {
      id: 'inspiration',
      component: Tab,
      meta: { title: '灵感', panel: Panel },
    })
    ctx.get('command').execute('shell:open-drawer-tab', { id: 'inspiration' })

确认：

- 抽屉顶部出现“灵感”页签；
- 点中后高亮，正文显示“灵感列表”；
- 再点“画布”，正文回到画布树，URL 不变；
- 收起再展开仍停在“灵感”（插件还在）；
- 移除该槽后自动回“画布”。

- [ ] **Step 7: 跑测试与类型检查**

Run:

    pnpm -C packages/ui test -- leftDrawerTabs
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck

Expected: 全绿。

- [ ] **Step 8: 提交**

    git add packages/ui/src/components/areas/LeftDrawer.vue packages/ui/src/__tests__/leftDrawerTabs.test.ts
    git commit -m "feat(ui): render plugin tabs in the left drawer"

---

### Task 9: 真机 e2e

**Files:**

- Create: packages/ui/e2e/shell-slots-check.mjs

**Interfaces:**

    window.MiniCanvasUI.getContext()
    ctx.slots.register / ctx.slots.remove
    window.Vue.h

- [ ] **Step 1: 写脚本**

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

      const button = (text) => ({
        render() {
          return Vue.h('button', { 'data-e2e-slot': text, type: 'button' }, text)
        },
      })

      ctx.slots.register('shell.status.end', { id: 'e2e-status', component: button('STATUS') })
      ctx.slots.register('shell.dock.end', { id: 'e2e-dock', component: button('DOCK') })

      const Tab = {
        props: ['active', 'onSelect'],
        render() {
          return Vue.h('button', {
            type: 'button',
            role: 'tab',
            'aria-selected': String(this.active),
            'data-e2e-slot': 'DRAWER_TAB',
            onClick: () => this.onSelect(),
          }, 'DRAWER_TAB')
        },
      }
      const Panel = {
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

    await page.evaluate(() => {
      const ctx = window.MiniCanvasUI.getContext()
      ctx.slots.remove('shell.status.end', 'e2e-status')
      ctx.slots.remove('shell.dock.end', 'e2e-dock')
      ctx.slots.remove('shell.drawer.tabs', 'e2e-tab')
    })
    await page.waitForTimeout(300)
    check('状态条按钮随槽移除而消失', (await page.locator('[data-e2e-slot="STATUS"]').count()) === 0)
    check('底栏按钮随槽移除而消失', (await page.locator('[data-e2e-slot="DOCK"]').count()) === 0)
    check(
      '当前插件页签移除后回画布',
      (await page.locator('.left-drawer [role=tab][aria-selected=true]').innerText()).includes('画布'),
    )
    check('零 pageerror', errors.length === 0, errors.join(' | '))

    await browser.close()
    process.exit(failed ? 1 : 0)

- [ ] **Step 2: 跑 e2e**

Run:

    pnpm -C packages/ui dev

另一个终端：

    node packages/ui/e2e/shell-slots-check.mjs

Expected: 全部 PASS。

- [ ] **Step 3: 回归既有 e2e**

    node packages/ui/e2e/canvas-e2e.mjs
    node packages/ui/e2e/context-menu-viewport-check.mjs

Expected: 全部 PASS，零 pageerror。

- [ ] **Step 4: 提交**

    git add packages/ui/e2e/shell-slots-check.mjs
    git commit -m "test(ui): cover shell slots and drawer tabs in browser"

---

### Task 10: 文档与全量验证

**Files:**

- Create: docs/代码开发/canvas-render/13-CanvasProvider与外壳插槽.md
- Modify: docs/代码开发/canvas-render/05-渲染上下文与content组件.md
- Modify: docs/代码开发/canvas-render/09-端到端可运行Demo.md
- Modify: docs/代码开发/00-总览与架构.md
- Modify: docs/代码开发/plugins/plugin-theme-default.md
- Modify: packages/docs/canvas-render/canvas-host.md
- Modify: packages/docs/canvas-render/demo.md
- Modify: packages/plugins/README.md
- Modify: docs/STATUS.md

**Interfaces:** 无新代码接口。

- [ ] **Step 1: 写新手册**

Create docs/代码开发/canvas-render/13-CanvasProvider与外壳插槽.md，包含：

    # CanvasProvider 与外壳插槽

    ## 1. 为什么需要 Provider
    - 旧结构：CanvasHost 启动内核，外壳是兄弟节点，拿不到 ctx。
    - 新结构：Provider 启动内核，外壳和 CanvasHost 都是它的后代。
    - 整页 loading 是已确认的行为。

    ## 2. 两层上下文
    - useCanvasContext：ctx / host / api / manager。
    - useCanvasRender：再加 flow / renderNodes / visibleRect / interaction。

    ## 3. 外壳插槽
    - shell.status.end
    - shell.dock.start
    - shell.dock.end
    - shell.drawer.tabs

    ## 4. 什么叫抽屉页签（插件页）
    - 画布 | 资产 | 灵感
    - 点“灵感”只切抽屉正文，不换 URL。
    - 不是设置页，不是画布浮层，不是路由页面。

    ## 5. 完整示例
    - InspirationTabButton.vue
    - InspirationPanel.vue
    - apply(ctx) 注册
    - DrawerHost 接口

    ## 6. 外壳按钮控制抽屉
    - shell:open-drawer
    - shell:open-drawer-tab
    - shell:toggle-drawer

    ## 7. 边界与坑
    - 外壳槽不能用 useCanvasRender。
    - SettingsHost 仍在 CanvasHost 内。
    - Provider 每个画布只能一个。
    - 不写 fixed 定位或 z-index。

- [ ] **Step 2: 更新旧文档**

在 05-渲染上下文与content组件.md 增加：

    ## CanvasProvider 与两层上下文
    - useCanvasRender：CanvasHost 内，含 flow 等渲染能力。
    - useCanvasContext：Provider 内，含 ctx/host/api/manager。
    - 只有 ctx 需求的组件优先 useCanvasContext。

    ## 外壳槽与画布槽的区别
    - overlay / mini-map / agent-conversation 在 CanvasHost 内。
    - shell.status.end / shell.dock.* / shell.drawer.tabs 在外壳里。

在 09-端到端可运行Demo.md、docs 的 canvas-host 示例、plugin-theme-default 文档、plugins/README 里，把
<CanvasHost :plugins ... :adapter ... /> 全部改成：

    <CanvasProvider :plugins="plugins" :adapter="adapter">
      <CanvasHost />
    </CanvasProvider>

在 00-总览与架构.md 的架构图、入口表里补 CanvasProvider。

- [ ] **Step 3: 更新 STATUS**

在 docs/STATUS.md 顶部增加一条追记：

    - 根因：上下文在 CanvasHost 内，外壳是兄弟节点。
    - 落地：CanvasProvider / 两层上下文 / 三处外壳槽 / 抽屉页签 / 三条 shell 命令。
    - 无兼容：CanvasHost 不再自启动；所有调用点已迁移。
    - 验证：各包测试数字、typecheck、e2e 脚本名。
    - 边界：外壳槽不能用 flow 相关能力；SettingsHost 仍在 CanvasHost。

- [ ] **Step 4: 全量验证**

Run:

    pnpm -C packages/canvas-render test
    pnpm -C packages/canvas-render typecheck
    pnpm -C packages/ui test
    pnpm -C packages/ui typecheck
    pnpm -C packages/plugins/plugin-theme-default test
    pnpm -C packages/plugins/plugin-theme-default typecheck
    pnpm -C packages/plugins/plugin-theme-gallery test
    pnpm -C packages/plugins/plugin-theme-gallery typecheck
    pnpm -C packages/plugins/plugin-mini-map test
    pnpm -C packages/plugins/plugin-agent test
    pnpm -C packages/plugins/plugin-manager test

Expected: 全绿。任何红项先修根因。

Run:

    pnpm -C packages/ui build
    node packages/ui/e2e/shell-slots-check.mjs
    node packages/ui/e2e/canvas-e2e.mjs
    node packages/ui/e2e/context-menu-viewport-check.mjs

Expected: build 通过，三条 e2e 全 PASS。

- [ ] **Step 5: 更新 codegraph**

Run:

    codegraph index
    codegraph status

Expected: Index is up to date。

- [ ] **Step 6: 提交**

    git add docs/代码开发/canvas-render/13-CanvasProvider与外壳插槽.md docs/代码开发/canvas-render/05-渲染上下文与content组件.md docs/代码开发/canvas-render/09-端到端可运行Demo.md docs/代码开发/00-总览与架构.md docs/代码开发/plugins/plugin-theme-default.md packages/docs/canvas-render/canvas-host.md packages/docs/canvas-render/demo.md packages/plugins/README.md docs/STATUS.md
    git commit -m "docs(canvas-render): document provider and shell slots"

---

## 4. 自审

### 4.1 需求覆盖

| 要求 | 任务 |
|---|---|
| 最外层 Provider 初始化上下文 | Task 1 / Task 2 / Task 3 |
| 不做兼容 | Task 1（无回退）/ Task 2（唯一启动点）/ Task 3（迁移全部调用点） |
| 整页 loading | Task 2 / Task 3 |
| 状态条插槽 | Task 6 / Task 9 |
| 底栏插槽 | Task 6 / Task 9 |
| 左抽屉插件页签 | Task 7 / Task 8 / Task 9 |
| 抽屉开合/收起/宽度 | Task 7 / Task 8 |
| 页签 active/onSelect/host | Task 7 / Task 8 |
| 命令控制抽屉 | Task 7 / Task 8 |
| 删除 Teleport 桥 | Task 3 / Task 4 |

### 4.2 类型一致性

- CanvasContext 的 ctx/host/api/manager 在 Provider、CanvasHost、useCanvasContext 中同名且必填。
- CanvasHost 只使用 CanvasHostRenderProps；CanvasHostBootProps 只在 Provider 使用。
- DrawerHost 的 activeTab/width/collapsed/openTab/close/toggleCollapsed 在 drawerTabs、LeftDrawer、文档中一致。
- 槽名 shell.status.end/shell.dock.start/shell.dock.end/shell.drawer.tabs 在代码、测试、e2e、文档中一致。
- 命令名 shell:open-drawer/shell:open-drawer-tab/shell:toggle-drawer 在 shellCommands、测试、文档中一致。

### 4.3 风险

1. CanvasHost 是一个大文件，启动代码搬走后要全文件搜 booting、bootError、apiRef、managerRef、host.stop，避免残留。
2. Provider 的 onUnmounted 必须在子组件卸载之后 stop；不能换成 onBeforeUnmount。
3. 外壳槽只在 Provider 的 ready 后出现；App 的 onMounted 会早于 CanvasShell，所有依赖 DOM 的定位要监听 ref/挂载事件。
4. 没有兼容层后，任何漏迁移的 CanvasHost :plugins=... 都会直接报错；Task 3 必须覆盖 ui、gallery、demo、docs 示例。
5. uiCatalog.test 等只 provide RENDER_CONTEXT_KEY 的测试必须改为 CANVAS_CONTEXT_KEY，否则会红。
6. 抽屉页签缺面板会 warn 并忽略；不产生空白页。

### 4.4 自审结论

- 没有把子代理审核写成已完成；按用户要求不创建子代理。
- 没有创建分支步骤；按用户要求不创建分支。
- 没有涉及 v1 或核心节点件。
- 已把用户确认的三点写进约束与任务。
- 已把“插件页”定义成左侧抽屉第三个及之后的页签与正文面板。

---

## 5. 开工前最后确认

1. 抽屉页签的正文宽度就是抽屉宽度，不额外弹窗；这符合你对“左侧菜单”的要求。
2. 插件页签必须同时有按钮和面板；只有按钮的入口应使用状态条/底栏槽。
3. 旧 CanvasHost 用法全部迁移，不保留兼容分支；文档和 demo 同步更新。
4. 首次打开先显示整页“正在启动内核…”，就绪后一次性出现外壳并挂载画布。
