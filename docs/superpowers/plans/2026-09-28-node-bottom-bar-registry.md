# 节点底部状态栏：可替换底栏 + 注册式动作 + 进度覆盖层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 text/image/video 三份各自为政的底部控制栏收敛成一个可替换的
`plugin-bottom-bar`，其它插件用注册的方式往里加动作；执行进度与状态落到节点 data
并本地持久化，卡片上盖一层加载/进度覆盖。

**Architecture:** 新增 `packages/plugins/plugin-bottom-bar`，内含两个服务
（`nodeBar` 注册动作 / `nodeTask` 执行与状态）与三个组件（宿主 `BottomBarHost`、
默认底栏 `NodeBottomBar`、覆盖层 `NodeTaskOverlay`）。底栏整体可替换走
`themeRegistry` 的 `bottomBar` 槽（与 `settingsPanel` 同构）；底栏内部条目走
`ctx.nodeBar.register`（注册场语义，同 id 替换、卸载自动摘除）。`out:bottom`
基座段由 bottom-bar 一家挂，三个节点插件删掉自己的段。

**Tech Stack:** TypeScript / Vue 3 SFC / Vitest（node 环境为主，SSR 渲染测试用
`vue/server-renderer`）/ pnpm workspace。无第三方新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-28-node-bottom-bar-design.md`

## Global Constraints

- **中文注释**：所有新增代码的注释用中文，风格照现有文件（讲「为什么」而不是「是什么」）。
- **不写兼容代码**：旧的三份底栏组件直接删除，不做双轨、不留垫片、不留 deprecated。
- **不改红线件**：`packages/plugins/plugin-theme-default/src/components/node/` 下的
  `BaseNode.vue`、`MovingHandle.vue`、`BaseTitle.vue`、`edge/CustomEdge.vue`、
  `edge/ConnectionLine.vue`、`background/DefaultBackground.vue` 本次**一行不动**
  （底栏用现成的 `out:bottom` 区域与 `over:inset` 区域，不需要改壳）。
- **不碰 v1**：根 `src/` 与 `packages/canvas-core`。
- **词表复用**：动作的参数/进度/结果形状一律用内核已有的 `ToolParamDef` /
  `ToolProgress` / `ToolResult` / `ToolOutcome`（`packages/kernel/src/toolRegistry.ts`），
  不新造平行词表。
- **依赖方向**：`plugin-bottom-bar` 只依赖 `kernel` / `canvas-base` / `canvas-data` /
  `canvas-render` / `prosemirror-editor-bundle`；**不得**在 `dependencies` 里声明
  `plugin-theme-default`（设计系统件走 `useUiComponent`）。节点插件要拿到
  `ctx.nodeBar` 的类型增强时用 `import type {} from ...`（类型可擦除，
  `packages/ui/src/__tests__/pluginDependencyDirection.test.ts` 不拦），并把它放进
  **devDependencies**。
- **UI 规范**：任何新界面照 `docs/design/ui-style-guide.md`，不改 token 数值、不自造颜色。
- **验证命令**（每包各自跑）：`canvas-data` / `plugin-bottom-bar` / `plugin-node-text` /
  `plugin-node-image` / `plugin-node-video` / `plugin-mock-task-backend` / `ui` / `canvas-render`
  各自的 `pnpm -C <包> test` —— 全绿才前进。

## 进度写盘：唯一口径（先定死，后面所有任务都照它写）

**每一帧都写节点，走 `doc.updateNodeRuntime`。**

| 时刻 | 写什么 | 走哪条 API | 进撤销栈吗 |
|---|---|---|---|
| 提交那一刻 | `runState = { status:'running', progress:0, actionId, startedAt }` | `updateNodeRuntime` | 否 |
| 每次轮询有进展 | `runState = { status:'running', progress, message, taskId, actionId }` | `updateNodeRuntime` | 否 |
| 终态 | `runState = { status:'done' / 'error', … }` | `updateNodeRuntime` | 否 |
| 产物落到节点（图/文/视频地址） | `data` 真字段 | `doc.updateNode`（**作品写入，进历史**） | 是 |

为什么每帧都要写盘（而不是「终态才写」）：用户明确要求「进度与状态要保存到本地，
不然刷新一下全完蛋」。如果 running 只在内存，刷新时 localStorage 里没有 running，
「续查 / 判中断」两条分支永远命中不了，等于进度信息还是丢了。

**代价与缓解（必须写进实现）**：`scheduleCommit()`（`graphDocument.ts:405-417`）每次都会
全图 `snapshot()` 深拷贝并触发 `save.set(GRAPH_KEY, …)`（`canvasBasePlugin.ts:159-163`）。
轮询默认 650ms 一帧，直接照发就是 650ms 一次全图序列化。所以 `taskRuntime` 内部对
**中间帧**做 200ms 节流（进度值与文案都没变就完全不写），终态不节流、必写。

---

## 文件结构（先定边界，再拆任务）

**新增包 `packages/plugins/plugin-bottom-bar/`**

| 文件 | 职责 |
|---|---|
| `package.json` / `tsconfig.json` / `vitest.config.ts` / `vite.config.ts` / `src/env.d.ts` | 照 `plugin-node-text` 模板抄**再改本包名**（Task 2 Step 1 有三条改名要求） |
| `src/barTypes.ts` | 动作/写入器/运行上下文的**类型**（纯类型，零运行时代码） |
| `src/barRegistry.ts` | 动作列表与写入器的**纯逻辑容器**（零 Vue，可单测） |
| `src/runState.ts` | `data.runState` 的读写/归一（纯函数） |
| `src/taskRuntime.ts` | 执行一个动作的**纯逻辑流程**（提交→轮询→终态→写回），依赖注入 |
| `src/panelSource.ts` | **从 image/text 两个插件上移合并**的上游素材收集 / @ 引用 / `buildToolInput` |
| `src/nodeBarPlugin.ts` | `NodeBarService` + `NodeTaskService` + 插件 apply |
| `src/BottomBarHost.vue` | 底栏宿主：读 `themeRegistry.winner('bottomBar')` 渲染赢家 |
| `src/NodeBottomBar.vue` | 默认底栏 UI（动作/参数/提示词/执行/状态/进度条） |
| `src/NodeTaskOverlay.vue` | 卡片上的加载/进度覆盖层 |
| `src/index.ts` | 包出口 + `BOTTOM_BAR_SLOT` 常量 |

**改动的现有文件**

| 文件 | 改什么 | 任务 |
|---|---|---|
| `packages/canvas-data/src/graphDocument.ts` | 新增 `updateNodeRuntime`（静默写） | T1 |
| `packages/canvas-data/src/docService.ts` | 门面转发 `updateNodeRuntime` | T1 |
| `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts` | 删 `out:bottom`，改为注册动作 + 写入器 | T7 |
| `packages/plugins/plugin-node-image/src/nodeImagePlugin.ts` | 同上 + 注册 image 写入器 | T8 |
| `packages/plugins/plugin-node-video/src/nodeVideoPlugin.ts` | 同上 + 剪辑改成 `panel` + `onSelect` | T9 |
| `packages/ui/src/assembly.ts` / `packages/ui/package.json` | 装配 `pluginBottomBar` 与 mock 插件 | T10 |
| `packages/ui/src/__tests__/nodePluginsAssembly.test.ts` | `EXPECTED` 段表随迁移更新（text T7 / image T8 / video T9） | T7–T9 |
| `packages/ui/src/__tests__/entrypoint.test.ts` | `APP_PLUGINS` 条数 21 → 23 | T10 |
| `packages/ui/e2e/canvas-e2e.mjs` | 追加 4 条底栏/覆盖层/落盘断言 | T10 |

**删除**

| 文件 | 任务 |
|---|---|
| `packages/plugins/plugin-node-text/src/TextGeneratePanel.vue` | T7 |
| `packages/plugins/plugin-node-text/src/__tests__/textGeneratePanelRender.test.ts` | T7 |
| `packages/plugins/plugin-node-text/src/textPanelSource.ts` + 其测试 | T6b |
| `packages/plugins/plugin-node-image/src/ImageGeneratePanel.vue` | T8 |
| `packages/plugins/plugin-node-image/src/panelSource.ts` + 其测试 | T6b |
| `packages/plugins/plugin-node-image/src/imageRun.ts` 的 `runImageGeneration` | T8 |

（`VideoClipPanel.vue` 保留组件本体，只是不再自己挂 `out:bottom`。）

---

### Task 1: canvas-data 静默写 API（落盘但不进撤销栈）

**Files:**
- Modify: `packages/canvas-data/src/graphDocument.ts`
- Modify: `packages/canvas-data/src/docService.ts`
- Test: `packages/canvas-data/src/__tests__/docRuntimeWrite.test.ts`

**Interfaces:**
- Produces: `GraphDocument.updateNodeRuntime(id: string, patch: NodePatch): void` 与
  `DocService.updateNodeRuntime(id: string, patch: NodePatch): void` —— 语义 = `updateNode`
  但在 `history.withRecord` **外面**执行，仍调 `scheduleCommit()`。节点不存在时与
  `updateNode` 同：抛错。

- [ ] **Step 1: 写失败测试**

```ts
// packages/canvas-data/src/__tests__/docRuntimeWrite.test.ts
import { describe, it, expect } from 'vitest'
import { NodeStore } from '../nodeStore'
import { EdgeStore } from '../edgeStore'
import { Selection } from '../selection'
import { History } from '../history'
import { GraphDocument } from '../graphDocument'

function makeGraph() {
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 100 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: [] }),
    restore: () => {},
  })
  const commits: number[] = []
  const graph = new GraphDocument(nodeStore, edgeStore, selection, history, () => commits.push(1))
  return { graph, nodeStore, history, commits }
}

describe('updateNodeRuntime：写节点 data 但不进撤销栈', () => {
  it('data 落进 nodeStore，且提交（落盘）被触发', () => {
    const { graph, nodeStore, commits } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    const before = commits.length
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', progress: 12 } } })
    expect(nodeStore.getNode(id)?.data.runState).toEqual({ status: 'running', progress: 12 })
    expect(commits.length).toBeGreaterThan(before)
  })

  it('撤销栈深度不变（用户 Ctrl+Z 退的是上一步真实操作，不是进度帧）', () => {
    const { graph, history } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    const depth = history.undoDepth
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', progress: 40 } } })
    graph.updateNodeRuntime(id, { data: { runState: { status: 'running', progress: 80 } } })
    expect(history.undoDepth).toBe(depth)
  })

  it('与 updateNode 对照：后者会进历史（证明前一条不是因为什么都没写进去）', () => {
    const { graph, history } = makeGraph()
    const id = graph.createNode('text', { x: 0, y: 0 }, { text: 'hi' })
    const depth = history.undoDepth
    graph.updateNode(id, { data: { text: '改过' } })
    expect(history.undoDepth).toBe(depth + 1)
  })

  it('节点不存在时抛错（与 updateNode 同语义，不静默）', () => {
    const { graph } = makeGraph()
    expect(() => graph.updateNodeRuntime('nope', { data: { a: 1 } })).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/canvas-data test docRuntimeWrite`
Expected: FAIL —— `graph.updateNodeRuntime is not a function`

- [ ] **Step 3: 最小实现**

`graphDocument.ts` 的接口 `GraphDocumentService` 加一行签名，实现加在 `updateNode` 旁边
（**不要在 `history.withRecord` 里面**）：

```ts
  /**
   * 写节点的**运行期状态**：落盘，但**不进撤销栈**。
   *
   * 为什么单独一条：进度帧每几百毫秒一次，若每帧都 withRecord，撤销栈会被冲垮
   * （用户按一次 Ctrl+Z 只退一格进度条，真正的作品改动要按几十次才退得回来）。
   * 而这类状态又必须持久化 —— 刷新页面不能丢（用户明确要求）。两条一起要，
   * 只能把「写」与「记一次操作」拆开。
   */
  updateNodeRuntime(id: string, patch: Parameters<NodeStoreService['updateNode']>[1]): void {
    this.nodeStore.updateNode(id, patch)
    this.scheduleCommit()
  }
```

`docService.ts` 的 `DocService` 接口加一行，`createDocService` 的转发表加一行：

```ts
  /** 写节点运行期状态：落盘但不进撤销栈（进度帧用） */
  updateNodeRuntime(id: string, patch: NodePatch): void
// …转发表里：
  updateNodeRuntime: (id, patch) => need('graph').updateNodeRuntime(id, patch),
```

- [ ] **Step 4: 跑测试确认通过**：`pnpm -C packages/canvas-data test`（原 328 + 新增 4）
- [ ] **Step 5: 提交**

```bash
git add packages/canvas-data
git commit -m "feat(canvas-data): doc.updateNodeRuntime —— 落盘但不进撤销栈的运行期写入"
```

---

### Task 2: `plugin-bottom-bar` 包骨架 + 动作注册表（纯逻辑）

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/{package.json,tsconfig.json,vitest.config.ts,vite.config.ts,src/env.d.ts}`
- Create: `packages/plugins/plugin-bottom-bar/src/barTypes.ts`
- Create: `packages/plugins/plugin-bottom-bar/src/barRegistry.ts`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/barRegistry.test.ts`

**Interfaces:**
- Produces: `BarAction` / `BarRunInput` / `BarRunContext` / `BarApplier` 类型与
  `class BarRegistry`（`add` / `remove` / `list` / `get` / `addApplier` / `applierOf` / `kinds`）。

```ts
/** 底栏动作：一个「能被用户点、点了有结果」的东西（模型 / 加工 / 工具，同一套形状） */
interface BarAction {
  /** 唯一 id（用户要求的「标识」）：同 id 重复注册 = 替换（热更） */
  id: string
  /** 给哪些节点类型用；省略 = 所有类型都适用 */
  types?: string[]
  /** 按钮 / 下拉里显示的名字 */
  title: string
  description?: string
  /** 图标（opaque 句柄：SVG 字符串，与节点类型 icon 同一写法） */
  icon?: string
  group?: string
  /** 可视化配置：复用内核 ToolParamDef 词表（下拉/数字/开关/自定义组件），底栏自动长控件 */
  fields?: ToolParamDef[]
  /** 预设模板（复用内核 ToolTemplate） */
  templates?: ToolTemplate[]
  /** 要不要底栏那个大输入框（默认 false） */
  needsPrompt?: boolean
  /**
   * 输入框和节点哪个字段绑在一起。
   * - 'none'（默认）：输入框是临时的，内容随 prompt 传给 run；
   * - 'text'：输入框 = data.text（文本节点用），编辑即写回节点、生成结果也写回它。
   */
  promptBinding?: 'none' | 'text'
  /** 选中本动作时渲染的专属面板（video 剪辑时间轴走这条） */
  panel?: unknown
  /**
   * 结果怎么落到节点：
   * - 'applier'（默认）：交给同 kind 的写入器；
   * - 'self'：本动作自己已经写好节点（旋转/下载/复制/删除这类即时动作），别让写入器再写一遍。
   */
  apply?: 'applier' | 'self'
  /** 排序（小者在先；没给的一律排最后） */
  order?: number
  /**
   * 本动作在节点上显示的只读信息（文本节点「12 字 · 3 行」这类）。
   * 返回空串 = 不显示。只拿到 data —— 底栏不认识业务含义。
   */
  info?(data: Record<string, unknown>): string
  /** 本动作被选中 / 取消选中（video 剪辑会话靠它开合） */
  onSelect?(nodeId: string): void
  onDeselect?(nodeId: string): void
  /** 执行体：与内核工具同一个契约（同步返回 ToolResult，或返回轮询函数） */
  run(input: BarRunInput, ctx: BarRunContext): ToolOutcome | Promise<ToolOutcome>
  /** 刷新后接着查（可选）：拿 taskId 造一个轮询函数 */
  resume?(taskId: string, ctx: BarRunContext): ToolPollFn | undefined
}

interface BarRunInput { prompt?: string; values?: Record<string, unknown>; resources?: ToolResource[] }
interface BarRunContext {
  nodeId: string
  nodeType: string
  canvasId?: string
  signal: AbortSignal
  onProgress(p: ToolProgress): void
  /** 读本节点 data（动作要看现有内容时用，不必自己 get 服务） */
  readData(): Record<string, unknown>
}
type BarApplier = (nodeId: string, result: ToolResult, ctx: { nodeType: string }) => void | Promise<void>
```

- [ ] **Step 1: 建包骨架**

从 `packages/plugins/plugin-node-text/` 复制 `package.json` / `tsconfig.json` /
`vitest.config.ts` / `vite.config.ts` / `src/env.d.ts`，然后**三处必须改**：

1. `package.json`：`name` → `@mini-canvas/plugin-bottom-bar`；`scripts` 收成
   `{ "build": "vite build", "test": "vitest run", "typecheck": "tsc --noEmit" }`；
   `dependencies` 保留 `canvas-base / canvas-data / canvas-render / kernel / prosemirror-editor-bundle`；
   `devDependencies` 保留 `@vitejs/plugin-vue / @vue/server-renderer / plugin-theme-default /
   typescript / vite / vitest / vue`（`plugin-theme-default` **只进 devDependencies**，
   供 SSR 测试装载真主题；生产不依赖）。
2. `vite.config.ts`：`name` → `MiniCanvasPluginBottomBar`、`fileName` → `plugin-bottom-bar.js`，
   externals 照抄。
3. `tsconfig.json` / `vitest.config.ts` / `src/env.d.ts` 照抄（不含包名）。

然后 `pnpm install` 让 workspaces 认到新包。

- [ ] **Step 2: 写失败测试**

```ts
// packages/plugins/plugin-bottom-bar/src/__tests__/barRegistry.test.ts
import { describe, it, expect } from 'vitest'
import { BarRegistry } from '../barRegistry'
import type { BarAction } from '../barTypes'

function action(id: string, types?: string[]): BarAction {
  return { id, types, title: id, run: () => ({ ok: true }) }
}

describe('BarRegistry：底栏动作的纯逻辑容器', () => {
  it('按节点类型筛选：types 省略 = 所有类型都适用', () => {
    const reg = new BarRegistry()
    reg.add(action('all'))
    reg.add(action('img-only', ['image']))
    expect(reg.list({ type: 'image' }).map((a) => a.id)).toEqual(['all', 'img-only'])
    expect(reg.list({ type: 'text' }).map((a) => a.id)).toEqual(['all'])
  })

  it('同 id 重复注册 = 替换（热更语义，不抛错）', () => {
    const reg = new BarRegistry()
    reg.add(action('a'))
    reg.add({ id: 'a', title: '新版', run: () => ({ ok: true }) })
    expect(reg.list()).toHaveLength(1)
    expect(reg.get('a')?.title).toBe('新版')
  })

  it('排序：显式 order 升序在前，没给 order 的一律排最后（保插入序）', () => {
    const reg = new BarRegistry()
    reg.add({ id: 'no-order-1', title: 'a', run: () => ({ ok: true }) })
    reg.add({ id: 'late', title: 'b', order: 10, run: () => ({ ok: true }) })
    reg.add({ id: 'no-order-2', title: 'c', run: () => ({ ok: true }) })
    reg.add({ id: 'early', title: 'd', order: -5, run: () => ({ ok: true }) })
    expect(reg.list().map((a) => a.id)).toEqual(['early', 'late', 'no-order-1', 'no-order-2'])
  })

  it('remove 后不再出现（插件卸载走这条）', () => {
    const reg = new BarRegistry()
    reg.add(action('a'))
    expect(reg.remove('a')).toBe(true)
    expect(reg.list()).toEqual([])
    expect(reg.remove('a')).toBe(false)
  })

  it('写入器按 kind 唯一：同 kind 重复注册抛错', () => {
    const reg = new BarRegistry()
    reg.addApplier('image', () => {})
    expect(() => reg.addApplier('image', () => {})).toThrow()
  })

  it('写入器查不到返回 undefined（不静默造一个假的）', () => {
    const reg = new BarRegistry()
    expect(reg.applierOf('image')).toBeUndefined()
  })
})
```

- [ ] **Step 3: 跑测试确认失败**：`pnpm -C packages/plugins/plugin-bottom-bar test` → FAIL（模块不存在）
- [ ] **Step 4: 实现 `barTypes.ts` 与 `barRegistry.ts`**

`barTypes.ts` 只放类型 + 一段「为什么复用内核已有 Tool 词表」的注释。`barRegistry.ts` 用两个
`Map`；`list` 的排序键 = `order ?? Infinity`（缺省排最后），同键保插入序。

- [ ] **Step 5: 跑测试确认通过**（6 tests）
- [ ] **Step 6: 提交**

```bash
git add packages/plugins/plugin-bottom-bar pnpm-lock.yaml
git commit -m "feat(plugin-bottom-bar): 新包骨架 + 底栏动作注册表（纯逻辑）"
```

---

### Task 3: `nodeTask` —— 执行一个动作（提交 / 轮询 / 终态 / 写回 / 刷新恢复）

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/runState.ts`
- Create: `packages/plugins/plugin-bottom-bar/src/taskRuntime.ts`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/runState.test.ts`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/taskRuntime.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `doc.updateNodeRuntime`、Task 2 的 `BarRegistry`。
- Produces:
  - `runState.ts`：`interface NodeRunState { status: 'idle'|'running'|'done'|'error';
    progress?: number; message?: string; taskId?: string; actionId?: string; startedAt?: number }`、
    `readRunState(data)`、`runningState(actionId, message?)`、`progressState(base, p)`、
    `doneState(actionId, taskId?)`、`errorState(actionId, message)`
  - `taskRuntime.ts`：`runAction(args, deps): Promise<ToolResult>`，其中
    `args = { nodeId, nodeType, action, input, registry, signal? }`，
    `deps = { readData, writeRuntime, writeResult, interval?, timeoutMs?, throttleMs?, now? }`
  - `resumeAction({ nodeId, nodeType, registry, taskId, actionId }, deps): Promise<ResumeResult>`，
    `ResumeResult = { resumed: boolean; state: NodeRunState }`

- [ ] **Step 1: 写 `runState` 的失败测试**

```ts
// packages/plugins/plugin-bottom-bar/src/__tests__/runState.test.ts
import { describe, it, expect } from 'vitest'
import { readRunState, runningState, progressState, doneState, errorState } from '../runState'

describe('data.runState 的读写口径', () => {
  it('缺省 = idle', () => {
    expect(readRunState({}).status).toBe('idle')
    expect(readRunState(undefined).status).toBe('idle')
  })

  it('读回时收敛非法值：进度夹到 0-100，未知 status 当 idle', () => {
    expect(readRunState({ runState: { status: 'running', progress: 250 } }).progress).toBe(100)
    expect(readRunState({ runState: { status: 'running', progress: -3 } }).progress).toBe(0)
    expect(readRunState({ runState: { status: 'weird' } }).status).toBe('idle')
  })

  it('running：带上提交者（actionId）与排队文案', () => {
    const s = runningState('image.generate:x')
    expect(s).toMatchObject({ status: 'running', progress: 0, actionId: 'image.generate:x' })
    expect(s.message).toBeTruthy()
  })

  it('progressState：进度/文案/taskId 覆盖进上一帧，actionId 不丢', () => {
    const next = progressState(runningState('a'), { progress: 40, message: '跑着', taskId: 't1' })
    expect(next).toMatchObject({ status: 'running', progress: 40, message: '跑着', taskId: 't1', actionId: 'a' })
  })

  it('done / error：终态写进 actionId（刷新后知道是谁提交的）', () => {
    expect(doneState('a', 'task-1')).toMatchObject({ status: 'done', progress: 100, actionId: 'a', taskId: 'task-1' })
    expect(errorState('a', '炸了')).toMatchObject({ status: 'error', message: '炸了', actionId: 'a' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**：`pnpm -C packages/plugins/plugin-bottom-bar test runState`
- [ ] **Step 3: 实现 `runState.ts`**（纯函数，除归一外无副作用）
- [ ] **Step 4: 写 `taskRuntime` 的失败测试**

**注意**：每个用例只调一次 `harness()`，用同一个对象做断言（旧稿的 bug 就是这里调了两次、
断言看到的是另一个空数组）。

```ts
// packages/plugins/plugin-bottom-bar/src/__tests__/taskRuntime.test.ts
import { describe, it, expect, vi } from 'vitest'
import { BarRegistry } from '../barRegistry'
import { runAction, resumeAction } from '../taskRuntime'

function harness() {
  const runtime: Record<string, unknown>[] = []
  const written: Record<string, unknown>[] = []
  const deps = {
    readData: () => ({}),
    writeRuntime: (_id: string, data: Record<string, unknown>) => {
      runtime.push(data.runState as Record<string, unknown>)
    },
    writeResult: (_id: string, data: Record<string, unknown>) => {
      written.push(data)
    },
    interval: 1,
    timeoutMs: 5000,
    throttleMs: 0, // 测试关掉节流，逐帧可断言
  }
  return { runtime, written, deps }
}

describe('runAction：同步 / 异步 / 失败 都收敛到终态', () => {
  it('同步动作：先写 running，再写 done，最后把结果交给写入器', async () => {
    const reg = new BarRegistry()
    const seen: unknown[] = []
    reg.addApplier('image', (_id, r) => { seen.push(r) })
    reg.add({ id: 'a', types: ['image'], title: 'A', run: () => ({ ok: true, urls: ['x.png'] }) })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action: reg.get('a')!, input: {}, registry: reg },
      h.deps,
    )
    expect(out).toEqual({ ok: true, urls: ['x.png'] })
    expect(h.runtime[0]).toMatchObject({ status: 'running', actionId: 'a' })
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done', actionId: 'a' })
    expect(h.written).toHaveLength(1)
    expect(seen).toEqual([{ ok: true, urls: ['x.png'] }])
  })

  it('异步动作：轮询函数被驱动到 done，每一帧 progress 都写进 runtime', async () => {
    const reg = new BarRegistry()
    let step = 0
    reg.add({
      id: 'a', types: ['image'], title: 'A',
      run: () => () => {
        step += 1
        if (step < 3) return { status: 'running', progress: step * 30, message: '跑着呢' }
        return { status: 'done', result: { ok: true, urls: ['y.png'] } }
      },
    })
    const h = harness()
    await runAction({ nodeId: 'n1', nodeType: 'image', action: reg.get('a')!, input: {}, registry: reg }, h.deps)
    expect(h.runtime.filter((s) => s.status === 'running').length).toBeGreaterThanOrEqual(3)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' })
  })

  it('中间帧节流：节流窗口内进度值没变就不重复写（保住落盘代价）', async () => {
    const reg = new BarRegistry()
    let step = 0
    reg.add({
      id: 'a', types: ['image'], title: 'A',
      run: () => () => {
        step += 1
        if (step < 4) return { status: 'running', progress: 10, message: '同一进度' }
        return { status: 'done', result: { ok: true, urls: ['z.png'] } }
      },
    })
    const h = harness()
    h.deps.throttleMs = 10_000
    await runAction({ nodeId: 'n1', nodeType: 'image', action: reg.get('a')!, input: {}, registry: reg }, h.deps)
    expect(h.runtime.filter((s) => s.status === 'running')).toHaveLength(1) // 只有提交那一帧
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' }) // 终态不受节流影响
  })

  it('失败：写 error 终态，不调写入器（失败不产生产物）', async () => {
    const reg = new BarRegistry()
    const applied = vi.fn()
    reg.addApplier('image', applied)
    reg.add({ id: 'a', types: ['image'], title: 'A', run: () => { throw new Error('后端挂了') } })
    const h = harness()
    const out = await runAction({ nodeId: 'n1', nodeType: 'image', action: reg.get('a')!, input: {}, registry: reg }, h.deps)
    expect(out.ok).toBe(false)
    expect(out.error).toContain('后端挂了')
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
    expect(applied).not.toHaveBeenCalled()
  })

  it("apply:'self' 的即时动作（旋转/下载）：不经过写入器", async () => {
    const reg = new BarRegistry()
    const applied = vi.fn()
    reg.addApplier('image', applied)
    reg.add({ id: 'image.rotate', types: ['image'], title: '旋转', apply: 'self', run: () => ({ ok: true }) })
    const h = harness()
    const out = await runAction({ nodeId: 'n1', nodeType: 'image', action: reg.get('image.rotate')!, input: {}, registry: reg }, h.deps)
    expect(out.ok).toBe(true)
    expect(applied).not.toHaveBeenCalled()
    expect(h.written).toHaveLength(0)
  })

  it('没有同 kind 写入器：动作仍跑完，只是不写节点（不静默假装产物已落地）', async () => {
    const reg = new BarRegistry()
    reg.add({ id: 'a', types: ['image'], title: 'A', run: () => ({ ok: true, urls: ['z.png'] }) })
    const h = harness()
    const out = await runAction({ nodeId: 'n1', nodeType: 'image', action: reg.get('a')!, input: {}, registry: reg }, h.deps)
    expect(out.ok).toBe(true)
    expect(h.written).toHaveLength(0)
  })

  it('取消：signal 已中止时立即收敛成 error（不留悬挂 running）', async () => {
    const reg = new BarRegistry()
    const ctrl = new AbortController()
    ctrl.abort()
    reg.add({ id: 'a', types: ['image'], title: 'A', run: () => new Promise(() => {}) as never })
    const h = harness()
    const out = await runAction({ nodeId: 'n1', nodeType: 'image', action: reg.get('a')!, input: {}, registry: reg, signal: ctrl.signal }, h.deps)
    expect(out.ok).toBe(false)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
  })
})

describe('resumeAction：刷新后接着查', () => {
  it('动作声明了 resume 且拿到 taskId → 续查到终态', async () => {
    const reg = new BarRegistry()
    let step = 0
    reg.add({
      id: 'a', types: ['image'], title: 'A', run: () => ({ ok: true }),
      resume: () => () => {
        step += 1
        return step < 2 ? { status: 'running', progress: 60 } : { status: 'done', result: { ok: true, urls: ['r.png'] } }
      },
    })
    const h = harness()
    const out = await resumeAction({ nodeId: 'n1', nodeType: 'image', registry: reg, taskId: 't1', actionId: 'a' }, h.deps)
    expect(out.resumed).toBe(true)
    expect(h.written).toHaveLength(1)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' })
  })

  it('动作没声明 resume → 不悬挂：标成中断错误', async () => {
    const reg = new BarRegistry()
    reg.add({ id: 'a', types: ['image'], title: 'A', run: () => ({ ok: true }) })
    const h = harness()
    const out = await resumeAction({ nodeId: 'n1', nodeType: 'image', registry: reg, taskId: 't1', actionId: 'a' }, h.deps)
    expect(out.resumed).toBe(false)
    expect(out.state.status).toBe('error')
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
  })

  it('拿不到 taskId → 同样标中断，不去猜', async () => {
    const reg = new BarRegistry()
    reg.add({ id: 'a', types: ['image'], title: 'A', run: () => ({ ok: true }), resume: () => () => ({ status: 'running' }) })
    const h = harness()
    const out = await resumeAction({ nodeId: 'n1', nodeType: 'image', registry: reg, taskId: '', actionId: 'a' }, h.deps)
    expect(out.resumed).toBe(false)
    expect(out.state.status).toBe('error')
  })
})
```

- [ ] **Step 5: 跑测试确认失败**：`pnpm -C packages/plugins/plugin-bottom-bar test taskRuntime`
- [ ] **Step 6: 实现 `taskRuntime.ts`**

顺序：① `writeRuntime(runningState(actionId))`；② `signal` 已中止 → 直接 `errorState('已取消')`
收敛；③ `await action.run(input, runCtx)`（异常 → `errorState` + `writeRuntime` + 返回
`{ ok:false, error }`）；④ 返回值是函数 → 循环 `poll()`：`running` 就按**节流规则**
（距上一帧早于 `throttleMs`（默认 200）**且** `progress` 与上一帧相同 → 不写）决定是否
`writeRuntime`；超时 → `errorState('任务超时')`；`done` → 跳出；⑤ 终态（**不节流**）：
`ok` 且 `action.apply !== 'self'` → `writeRuntime(doneState)` + 有同 kind 写入器则
`applier(nodeId, result, { nodeType })`；`ok` 且 `apply === 'self'` → 只 `writeRuntime(doneState)`；
否则 `writeRuntime(errorState)`。

`resumeAction`：`action.resume` 缺失或 `taskId` 为空 → `errorState(actionId, '刷新后任务已中断')`
并 `writeRuntime`，返回 `{ resumed: false, state }`；否则同上驱动轮询到终态。

- [ ] **Step 7: 跑测试确认通过** / **Step 8: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): nodeTask 执行流（提交/轮询/终态/写回/刷新续查/节流）"
```

---

### Task 4: 服务与插件装配（`nodeBar` / `nodeTask` 上架 + 挂底栏宿主 + 挂覆盖层）

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts`
- Create: `packages/plugins/plugin-bottom-bar/src/index.ts`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/pluginAssembly.test.ts`

**Interfaces:**
- Consumes: Task 2/3 全部；`ctx.registryOf('node/bar')` 与 `ctx.registryOf('node/bar-applier')`
  两张场（内容落注册场，随本插件 scope 自动回收）。
- Produces: 服务名 `nodeBar` 与 `nodeTask`；插件名 `bottom-bar`；导出 `pluginBottomBar` 与
  `BOTTOM_BAR_SLOT = 'bottomBar'`。

- [ ] **Step 1: 写失败测试**

```ts
// packages/plugins/plugin-bottom-bar/src/__tests__/pluginAssembly.test.ts
import { describe, it, expect } from 'vitest'
import { Context, NodeRegistry, ThemeRegistry, NodeStore, EdgeStore, Selection, History,
  GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { pluginBottomBar } from '../index'

/** 与 nodeTextSmoke.test.ts 的 boot 同形：inject 是硬依赖，必须先把服务备齐 */
async function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: [] }),
    restore: () => {},
  })
  ctx.inject('selection', selection)
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.plugin(pluginBottomBar)
  await ctx.start()
  return ctx
}

describe('bottom-bar 插件装配', () => {
  it('上架 nodeBar / nodeTask 两个服务', async () => {
    const ctx = await boot()
    expect(ctx.get('nodeBar')).toBeTruthy()
    expect(ctx.get('nodeTask')).toBeTruthy()
    ctx.stop()
  })

  it('注册的动作能被 list 出来；卸载后一条不留（注册场自动回收）', async () => {
    const ctx = await boot()
    ctx.nodeBar.register({ id: 'a', types: ['image'], title: 'A', run: () => ({ ok: true }) })
    expect(ctx.nodeBar.list({ type: 'image' })).toHaveLength(1)
    ctx.stop()
    expect(ctx.nodeBar.list()).toHaveLength(0)
  })

  it('同 id 重复注册 = 替换，不变成两条', async () => {
    const ctx = await boot()
    ctx.nodeBar.register({ id: 'a', title: '旧', run: () => ({ ok: true }) })
    ctx.nodeBar.register({ id: 'a', title: '新', run: () => ({ ok: true }) })
    const list = ctx.nodeBar.list()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('新')
    ctx.stop()
  })

  it('同 kind 写入器重复注册抛错', async () => {
    const ctx = await boot()
    ctx.nodeBar.registerApplier('image', () => {})
    expect(() => ctx.nodeBar.registerApplier('image', () => {})).toThrow()
    ctx.stop()
  })

  it('底栏宿主挂 out:bottom、覆盖层挂 over:inset（都是 * 通配）', async () => {
    const ctx = await boot()
    const field = ctx.registryOf('node/region')
    expect(field.list('*/out:bottom')).toHaveLength(1)
    expect(field.list('*/over:inset')).toHaveLength(1)
    ctx.stop()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**：`pnpm -C packages/plugins/plugin-bottom-bar test pluginAssembly`
- [ ] **Step 3: 实现 `nodeBarPlugin.ts` + `index.ts`**

要点：

- `NodeBarService extends Service`（`super(ctx, 'nodeBar')`）：
  - `register(action)` → `field.add(action.id, action, { id: action.id })`。**必须显式传 `id`**：
    注册场缺省 id 是「键#条数」（`registry.ts:373-381`），不传就会变成追加，用户要的
    「同 id 替换」会失效。
  - `registerApplier(kind, fn)` → 先查场内该 kind 是否已存在，有则抛错，再
    `field.add(kind, fn, { id: kind })`。
  - `list(filter?)`：读场 → 按 `types` 过滤（省略 = 全类型）→ 按 `order ?? Infinity` 升序。
- `NodeTaskService extends Service`（`super(ctx, 'nodeTask')`）：`run` / `state` / `cancel` /
  `restoreAll()`；内部持 `Map<nodeId, AbortController>`。deps 接线：
  - `writeRuntime(nodeId, data)` → `ctx.doc.updateNodeRuntime(nodeId, { data })`（**不走历史**）；
  - `writeResult(nodeId, data)` → `ctx.doc.updateNode(nodeId, { data })`（**走历史**，那是作品）；
  - `readData(nodeId)` → `ctx.doc.getNode(nodeId)?.data ?? {}`。
  - `restoreAll()`：遍历全部节点，对 `runState.status === 'running'` 的调 `resumeAction`。
- `apply(ctx)`：`new NodeBarService(ctx)`、`new NodeTaskService(ctx)`、
  `ctx.nodes.attach('*', { region: 'out:bottom', component: BottomBarHost, id: 'bottom-bar/host' })`、
  `ctx.nodes.attach('*', { region: 'over:inset', component: NodeTaskOverlay, id: 'bottom-bar/overlay', order: 90 })`。
- `export const inject = ['doc', 'nodeRegistry', 'themeRegistry']`（`themeRegistry` 必须进 inject：
  `ctx.theme.register` 缺服务时静默 no-op，默认底栏会「装上了却没登记」——静默失效）。
- 声明合并：`declare module '@mini-canvas/kernel' { interface Services { nodeBar: NodeBarService; nodeTask: NodeTaskService } }`
  与 `declare module '@mini-canvas/canvas-data' { interface Context { nodeBar: NodeBarService; nodeTask: NodeTaskService } }`。

- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): nodeBar/nodeTask 服务上架，底栏宿主与覆盖层挂钩"
```

---

### Task 5: 默认底栏 UI（`NodeBottomBar.vue`）与可替换宿主

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/BottomBarHost.vue`
- Create: `packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue`
- Modify: `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts`（apply 里把默认皮登记进
  `themeRegistry` 的 `bottomBar` 槽）
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/bottomBarRender.test.ts`

**Interfaces:**
- Consumes: `useCanvasRender` / `useUiComponent` / `useSoleNodeSelected` / `useGenPanelMetrics`
  （`@mini-canvas/canvas-render`）、`ProseMirrorEditor`（`prosemirror-editor-bundle`）、
  `ctx.nodeBar` / `ctx.nodeTask` / `ctx.doc` / `ctx.tools`。
- Produces: 主题槽名 `bottomBar`。

- [ ] **Step 1: 写失败测试（SSR 渲染 + 可替换）**

照 `packages/plugins/plugin-node-text/src/__tests__/textGeneratePanelRender.test.ts` 的写法
（装真主题插件 + `createSSRApp` + `renderToString` + 最小 `RENDER_CONTEXT_KEY` 桩），断言：

1. 单选 image 节点 + 注册一条 image 动作（`fields: [{ key:'ratio', type:'select', options }]`
   + `needsPrompt: true`）→ HTML 含该动作标题、一个「执行」按钮、一个参数控件；
2. 该类型**一条动作都没有** → 渲染为空（不含任何底栏 DOM）；
3. 换皮：`ctx.theme.add('bottomBar', FakeBar, { order: -1 })` 后渲染的是 FakeBar
   （底栏整体可替换 —— 用户明确要的第一种形式）。

- [ ] **Step 2: 跑测试确认失败**：`pnpm -C packages/plugins/plugin-bottom-bar test bottomBarRender`
- [ ] **Step 3: 实现组件**

`BottomBarHost.vue` 照 `packages/canvas-render/src/components/SettingsHost.vue:36-57` 的写法
（初始读一次 `themeRegistry.winner('bottomBar')`，订阅 `ctx:plugin-installed` /
`ctx:plugin-uninstalled` / `themeRegistry.subscribe` 重读，`markRaw`，
`<component :is="winner" :id="id" :data="data" />`）。

**硬要求**：本节点类型没有任何可用动作时不渲染任何 DOM（`3d-preview` / `image-compare`
这类没有底栏的类型不能凭空多出一个空盒子）。

`NodeBottomBar.vue` 结构（照 `docs/design/ui-style-guide.md`）：动作专属面板（若有）
→ 提示词输入框（`needsPrompt`）→ 一行控件（动作下拉 / `fields` 控件 / 模板下拉 /
`info` 文案 / 执行按钮）→ 进度条（`status === 'running'`）。

- `visible = useSoleNodeSelected(props.id)`（多选/未选中时不出现，与既有三份面板同语义）。
- 动作列表 = `ctx.nodeBar.list({ type: props.type })` **并合上「按 produces 自动展开的工具」**：
  `ctx.tools.list({ produces: kindOf(props.type) })` 的每个工具变成一条动作
  （下拉 = 工具名、`fields` = 该工具的 `params`、`templates` = 该工具的 `templates`、
  `run` = 转发 `ctx.tools.invoke`）。`kindOf` 映射：text→text、image→image、video→video、
  audio→audio。**这一步是「加一个模型 = 装一个工具插件」这条既有承诺的保持点**。
- 插件热装卸后重读（订阅 `ctx:plugin-installed/uninstalled` 与 `registryOf('node/bar').subscribe`）。
- 当前动作 `ref`；切换动作时：旧动作 `onDeselect?`、新动作 `onSelect?`，并用该动作的
  `fields` 重置 `values`（`select` 无 default 取第一项 —— 与内核 `resolveToolParams` 同口径）。
- `promptBinding: 'text'` 的动作：输入框内容 = `props.data.text`，编辑即
  `ctx.doc.updateNode(id, { data: { text } })`（进历史，是作品）；`'none'`：只是临时输入。
- `fields` 一律交给 `useUiComponent('toolParamField')` 渲染（主题可替换目录）。
- 点「执行」：`ctx.nodeTask.run(props.id, action.id, { prompt, values, resources })`；
  `status === 'running'` 时按钮禁用并显示转圈。
- `info`：有该回调就渲染返回值（文本节点「12 字 · 3 行」走这条）。
- 宽度取 `useGenPanelMetrics().imageWidth`（沿用既有配置项，不新增配置键）。

- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): 默认底栏 UI + themeRegistry 可替换宿主"
```

---

### Task 6: 加载/进度覆盖层（`NodeTaskOverlay.vue`）

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/NodeTaskOverlay.vue`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/taskOverlayRender.test.ts`

**Interfaces:**
- Consumes: `props.data.runState`（单一来源，不额外读服务）与 `ctx.nodeTask.cancel`（取消按钮）。
- Produces: 无新 API。

- [ ] **Step 1: 写失败测试**

SSR 断言：

1. `data.runState` 缺省 / `idle` / `done` → 渲染为空（不占位、不拦截点击）；
2. `running` 且 `progress: 42` → 出现覆盖层，含 `42%` 与阶段文案；
3. `running` 且**没有** `progress`（外部只给阶段）→ 出现覆盖层且带不确定态标记；
4. `error` → 出现错误文案；
5. 同层顺序：把图片编辑浮层与覆盖层同时挂进 `image/over:inset`，断言覆盖层在编辑浮层**之后**。

- [ ] **Step 2: 跑测试确认失败** / **Step 3: 实现组件**

- 根元素 `position:absolute; inset:0`，半透明遮罩（用 ui-theme.css 既有 token，不新造颜色）
  + 居中卡片（转圈 + 百分比 + 文案 + 「取消」按钮 → `ctx.nodeTask.cancel(id)`）。
- `running` 时 `pointer-events:auto`（挡住卡片交互）；其余状态 `display:none` 且 `pointer-events:none`。
- 动效带 `prefers-reduced-motion` 降级。

**同层顺序的机制（照实写进注释，别说错）**：`BaseNode` 对 `over:inset` 是**一次 v-for**
（`BaseNode.vue:919-925`），DOM 顺序 = 「基座条目在前、注册场条目按 order 在后」；`order`
只在**同一条写路径内**排序，跨不过基座。所以结论是：**图片/视频的编辑浮层（基座）恒在下、
覆盖层（注册场）恒在上**，与 `order: 90` 无关；若第三方插件也往 `over:inset` attach 条目，
它会排在覆盖层之后（盖住覆盖层）—— 已知取舍，写进注释。

- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): 节点卡片上的加载/进度覆盖层"
```

---

### Task 6b: 上移上游素材 / @ 引用 / `buildToolInput`（删两个节点的重复实现）

**为什么单独一票：** 这是**所有**节点类型共用的能力（收集上游连线素材、@ 引用解析、
组装工具入参），今天在 `plugin-node-image/src/panelSource.ts`（318 行）与
`plugin-node-text/src/textPanelSource.ts`（193 行）各写一份。删掉两个面板后必须有接手方，
否则 image/text 的迁移会断链（`imageRun.ts:15` 直接 import `buildToolInput`）。

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/panelSource.ts`（合并版）
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/panelSource.test.ts`（两个旧测试合并）
- Delete: `packages/plugins/plugin-node-image/src/panelSource.ts` + `src/__tests__/panelSource.test.ts`
- Delete: `packages/plugins/plugin-node-text/src/textPanelSource.ts` + `src/__tests__/textPanelSource.test.ts`

**Interfaces:** 导出名与旧实现保持一致（迁移期少踩坑）：`UpstreamMaterial`、
`collectUpstreamMaterials`、`buildToolInput`、`makeResourceResolver`、`toEditorResources`、
`materialCards`、`toolOptions`、`paramDefs`、`paramOptions`、`paramRaw`、`paramValue`、
`paramsForTool`、`pickDefaultTool`、`templateOptions`、`templatePrompt`、`validateGenInput`、
`panelStatusText`。

- [ ] **Step 1: 先搬测试（先红）**：把两个旧测试合并到本包新测试，去掉重复用例。
- [ ] **Step 2: 跑测试确认失败**：`pnpm -C packages/plugins/plugin-bottom-bar test panelSource` → FAIL
- [ ] **Step 3: 实现合并版**：以 image 那份为骨架，把 text 那份独有的并进来；
  两个 `UpstreamMaterial` 只留一个定义。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: 提交**（**先不删旧文件** —— 旧文件在 T7/T8 里删，那时调用方已切走）

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): 上移上游素材收集与工具入参组装（合并两份重复实现）"
```

---

### Task 7: 迁移 text 节点（删 TextGeneratePanel，改注册动作）

**Files:**
- Modify: `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts`
- Modify: `packages/plugins/plugin-node-text/package.json`（bottom-bar 进 **devDependencies**）
- Delete: `packages/plugins/plugin-node-text/src/TextGeneratePanel.vue`
- Delete: `packages/plugins/plugin-node-text/src/textPanelSource.ts` + 其测试
- Delete: `packages/plugins/plugin-node-text/src/__tests__/textGeneratePanelRender.test.ts`
- Modify: `packages/plugins/plugin-node-text/src/__tests__/nodeTextSmoke.test.ts`
- Modify: `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`（text 的 `extraSegments` → `[]`）

**Interfaces:**
- Consumes: `ctx.nodeBar.register` / `registerApplier('text', …)`。
- Produces: text 底栏动作：
  1. `text.generate`：`types:['text']`、`needsPrompt:true`、`promptBinding:'text'`、
     参数与模板由底栏从 `ctx.tools.list({ produces:'text' })` 自动展开；
  2. `text.duplicate` / `text.delete`：`apply:'self'`，`run` 里调既有服务方法；
  3. `info: (data) => summarizeText(data.text)` → `'12 字 · 3 行'`（字数读数不丢）。
  - 写入器 `registerApplier('text', …)`：把 `result.text` 写进 `data.text`
    （走 `doc.updateNode`，是作品、可撤销）。

- [ ] **Step 1: 改测试（先红）**：`nodeTextSmoke` 区域断言改成只有「in」；
  `nodePluginsAssembly` 的 text `extraSegments` 改成 `[]`。
- [ ] **Step 2: 跑测试确认失败**（`plugin-node-text test nodeTextSmoke` + `ui test nodePluginsAssembly`）
- [ ] **Step 3: 改插件**：删 `segments` 整条字段、删 import 与文件；`apply` 里注册 3 条动作 +
  text 写入器；`inject` 加 `'nodeBar'`；文件顶部加
  `import type {} from '@mini-canvas/plugin-bottom-bar'`（类型增强只有进了编译单元才生效，
  否则 `ctx.nodeBar` 在 typecheck 里报未知属性）。
- [ ] **Step 4: 跑测试确认通过**（含 `typecheck` 与 `ui test`）
- [ ] **Step 5: 提交**

```bash
git add packages/plugins/plugin-node-text packages/ui
git commit -m "refactor(node-text): 底部生成栏搬到底栏插件，本包只注册动作与写入器"
```

---

### Task 8: 迁移 image 节点（删 ImageGeneratePanel，写回逻辑变写入器）

**Files:**
- Modify: `packages/plugins/plugin-node-image/src/nodeImagePlugin.ts`
- Modify: `packages/plugins/plugin-node-image/package.json`（bottom-bar 进 devDependencies）
- Delete: `packages/plugins/plugin-node-image/src/ImageGeneratePanel.vue`
- Delete: `packages/plugins/plugin-node-image/src/panelSource.ts` + 其测试
- Modify: `packages/plugins/plugin-node-image/src/imageRun.ts`
- Modify: `packages/plugins/plugin-node-image/src/__tests__/imageToolbarsRender.test.ts`
- Modify: `packages/plugins/plugin-node-image/src/__tests__/imageRun.test.ts`
- Modify: `packages/plugins/plugin-node-image/src/__tests__/nodeImageSmoke.test.ts`
- Modify: `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`（image `extraSegments` 去 `out:bottom`）

**Interfaces:**
- Consumes: `ctx.nodeBar.register` / `registerApplier('image', …)`。
- Produces: image 底栏动作：
  1. `image.generate`：`types:['image']`、`needsPrompt:true`，参数/模板由底栏按
     `ctx.tools.list({ produces:'image' })` 自动展开；
  2. `image.rotate` / `image.download`：`apply:'self'`，`run` 里用 `createImageOps(ctx)`
     （**在 apply 里建一次并闭包住**，因为 `BarAction.run` 拿不到 ctx）。
  - 写入器 `registerApplier('image', (nodeId, result) => writeGeneratedImage(nodeId, result.urls![0], deps, resourceId))`：
    量尺寸 → 一次 `updateNode` 写完 → 清旧描述字段。

- [ ] **Step 1: 改测试（先红）**
  - `imageToolbarsRender.test.ts`：删 ImageGeneratePanel 段（组件将不存在），保留 ImageTopToolbar。
  - `nodeImageSmoke.test.ts`：段断言去掉 `out:bottom`。
  - `imageRun.test.ts`：删 `runImageGeneration` 用例，保留 `writeGeneratedImage`。
  - `nodePluginsAssembly.test.ts`：image `extraSegments` 去掉 `'out:bottom'`。
- [ ] **Step 2: 跑测试确认失败**（`plugin-node-image test` + `ui test`）
- [ ] **Step 3: 改插件**：删 `out:bottom` 段与 `ImageGeneratePanel.vue`；`imageRun.ts` 删
  `runImageGeneration`（只留 `writeGeneratedImage` 与 `ImageRunDeps`，并把 `buildToolInput` 的
  import 改成从 `@mini-canvas/plugin-bottom-bar` 拿）；`apply` 里注册动作 + image 写入器；
  `inject` 加 `'nodeBar'`；顶部加 `import type {} from '@mini-canvas/plugin-bottom-bar'`。
- [ ] **Step 4: 跑测试确认通过**（含 `typecheck` 与 `ui test`）
- [ ] **Step 5: 提交**

```bash
git add packages/plugins/plugin-node-image packages/ui
git commit -m "refactor(node-image): 底部生成栏搬到底栏插件，写回逻辑变写入器"
```

---

### Task 9: 迁移 video 节点（剪辑面板改为动作 panel）

**Files:**
- Modify: `packages/plugins/plugin-node-video/src/nodeVideoPlugin.ts`
- Modify: `packages/plugins/plugin-node-video/package.json`（bottom-bar 进 devDependencies）
- Modify: `packages/plugins/plugin-node-video/src/VideoClipPanel.vue`
- Modify: `packages/plugins/plugin-node-video/src/__tests__/nodeVideoSmoke.test.ts`
- Modify: `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`

**Interfaces:**
- Produces: video 底栏动作：
  1. `video.generate`（若有对应工具）；
  2. `video.clip`：`types:['video']`、`panel: VideoClipPanel`、`needsPrompt:false`、
     `onSelect: (id) => beginOverlay(id, 'clip')`、`onDeselect: (id) => endOverlay(id)`、
     `apply:'self'`（剪辑结果由面板经命令 `video.clipConfirm` 提交）。
  - **`VideoClipPanel.vue` 的显隐门必须改**：今天它是 `visible = selected && isClipping(id)`
    （`VideoClipPanel.vue:32-34`，会话态由命令打开）。新流程下「选中动作 = 渲染 panel」，
    把门改成 `visible = selected`，会话态交给 `onSelect/onDeselect`。
- **顶部操作条（`out:top`）本次不动。**

- [ ] **Step 1: 改测试（先红）**：`EXPECTED` 里 video 的 `extraSegments` 去掉 `out:bottom`。
- [ ] **Step 2: 跑测试确认失败** / **Step 3: 改插件**（删段注册 → 注册 `video.clip` 动作；
  `inject` 加 `'nodeBar'`；顶部加 `import type {} from '@mini-canvas/plugin-bottom-bar'`）
- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-node-video packages/ui
git commit -m "refactor(node-video): 剪辑面板挂到底栏动作上，不再自占 out:bottom"
```

---

### Task 10: mock 后台插件 + 成品装配 + e2e 验证

**Files:**
- Create: `packages/plugins/plugin-mock-task-backend/`（骨架照 Task 2 模板改名）
- Create: `packages/plugins/plugin-mock-task-backend/src/{mockBackend.ts,mockTaskPlugin.ts,index.ts}`
- Test: `packages/plugins/plugin-mock-task-backend/src/__tests__/mockBackend.test.ts`
- Modify: `packages/ui/src/assembly.ts` / `packages/ui/package.json`
- Modify: `packages/ui/src/__tests__/entrypoint.test.ts`（21 → 23，或改成不写死数字）
- Modify: `packages/ui/e2e/canvas-e2e.mjs`（追加 4 条断言）
- Modify: `docs/STATUS.md`

**Interfaces:**
- Produces: 假后台（`createTask(kind, payload)` → `{ taskId }`；`queryTask(taskId)` →
  `{ status, progress, message, result }`）+ 两条图片动作：`mock-task:sync`（1.2s 后出结果）
  与 `mock-task:async`（0→100 分 10 帧，带 `taskId` 与 `resume`）。两条都带一个 `fields` 下拉。

- [ ] **Step 1: 写失败测试**（断言假后台契约）
- [ ] **Step 2–4: 实现 → 跑绿 → 提交。**
- [ ] **Step 5: 装配 + 改 e2e（人工验证降级为辅助）**

`assembly.ts` 里加 `pluginBottomBar` 与 `mockTaskPlugin`；`canvas-e2e.mjs` 追加：

1. 选中 image 节点后 `ctx.registryOf('node/region').list('*/out:bottom')` 只有一条，
   且底栏里能查到 mock 动作按钮；
2. 跑一次异步动作期间卡片上出现覆盖层且百分比文本可见；
3. 终态后 `localStorage` 里该节点 `data.runState.status === 'done'` 且带 `actionId`；
4. `reload` 后覆盖层不出现悬挂转圈（`status` 不是 running，或已收敛成中断错误）。

再起 `pnpm -C packages/ui dev` 人工看一眼观感（辅助证据，不作为唯一证据）。

- [ ] **Step 6: 提交**

```bash
git add packages/plugins/plugin-mock-task-backend packages/ui docs/STATUS.md
git commit -m "feat(mock-task-backend): 假后台插件 + 成品装配 + e2e 断言（底栏/覆盖层/落盘/刷新）"
```

---

### Task 11: 收尾验证与文档同步

**Files:** Modify `docs/STATUS.md`、`packages/plugins/README.md`、`docs/design/core-layers-and-registry.md`

- [ ] **Step 1: 全量验证**

```bash
pnpm -C packages/kernel test
pnpm -C packages/canvas-data test
pnpm -C packages/canvas-render test
pnpm -C packages/ui test
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/plugins/plugin-mock-task-backend test
pnpm -C packages/plugins/plugin-node-text test
pnpm -C packages/plugins/plugin-node-image test
pnpm -C packages/plugins/plugin-node-video test
pnpm -C packages/canvas-data typecheck
pnpm -C packages/plugins/plugin-bottom-bar typecheck
pnpm -C packages/plugins/plugin-mock-task-backend typecheck
pnpm -C packages/plugins/plugin-node-text typecheck
pnpm -C packages/plugins/plugin-node-image typecheck
pnpm -C packages/plugins/plugin-node-video typecheck
pnpm -C packages/ui typecheck
```

- [ ] **Step 2: 文档同步**：`core-layers-and-registry.md` `4.5 场种类总表补 `node/bar` 与
  `node/bar-applier` 两行；`plugins/README.md` 加「怎么注册底栏动作」（含底栏整体换皮的
  `themeRegistry.add('bottomBar', …)` 写法）。
- [ ] **Step 3: e2e 冒烟**：`pnpm -C packages/ui dev` + `node packages/ui/e2e/canvas-e2e.mjs`
  （原 40/40 不回归 + 新增 4 条通过）。
- [ ] **Step 4: 提交并交由 finishing-a-development-branch 收尾**（让用户选合并 / 建 PR / 保留分支）。

---

## 风险与拆票点

- **Task 7–9 是删旧件**：三份面板里的既有能力已逐条落到任务（见下表）；实现后对着表逐项点一遍防漏。
- **`over:inset` 与图片/视频编辑浮层同层**：基座恒在下、注册场条目恒在上（机制见 Task 6 Step 3）。
- **`data.runState` 与 mcp-server 撞名字**：**有意为之** —— 同一个含义用同一个键，
  云端后台（`mcp-server/src/tasks/TaskManager.ts:108-113`）写的进度前端能直接显示。
- **mock 动作会覆盖节点真图**：`mock-task:*` 经 image 写入器写 `imageUrl`，点了它当前图就被换成
  mock 产物。这是 demo 的预期行为，写进 `docs/STATUS.md` 免得误判。
- **写盘频率**：中间帧 200ms 节流（见「进度写盘：唯一口径」）；若实测仍觉卡，
  可把节流窗口调大或只写 progress 变化超过 5 的帧 —— 都要更新那份口径说明。

### 被删能力 → 去处对照表（实现时逐项打勾）

| 旧能力（现位置） | 去处 | 任务 |
|---|---|---|
| 上游素材收集 `collectUpstreamMaterials` | bottom-bar `panelSource.ts` | T6b |
| @ 引用素材 / 素材行 / 「+ 加素材」 | bottom-bar 提示词编辑器 + `materialCards` | T5 / T6b |
| `buildToolInput`（组装工具入参） | bottom-bar `panelSource.ts` | T6b |
| 图片旋转 / 下载 | image 节点 `apply:'self'` 动作 | T8 |
| 图片写回（量尺寸 + 一次 patch） | image 写入器（复用 `writeGeneratedImage`） | T8 |
| 文本字数 / 行数读数 | text 动作的 `info` 回调 | T7 |
| 文本复制 / 删除按钮 | text `apply:'self'` 动作 | T7 |
| 文本输入框直接编辑正文 | `promptBinding: 'text'` | T5 / T7 |
| 视频剪辑时间轴 | `video.clip` 动作的 `panel` + `onSelect` 开会话 | T9 |
| 工具/模型列表（原各面板自己拉 `ctx.tools`） | 底栏按 `produces` 自动展开 | T5 |
