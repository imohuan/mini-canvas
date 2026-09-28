# 节点底部状态栏：可替换底栏 + 注册式动作 + 进度覆盖层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 text/image/video 三份各自为政的底部控制栏收敛成一个可替换的
`plugin-bottom-bar`，其它插件用注册的方式往里加动作；执行进度与状态落到节点 data
并本地持久化，卡片上盖一层加载/进度覆盖。

**Architecture:** 新增 `packages/plugins/plugin-bottom-bar`：一个**读**服务 `nodeBar`
（列动作/查状态）、一个执行服务 `nodeTask`、两个**按调用方作用域落场**的注册糖
（`registerBarAction` / `registerBarApplier` / `publishToolActions`），以及三个组件
（宿主 `BottomBarHost`、默认皮 `NodeBottomBar`、覆盖层 `NodeTaskOverlay`）。底栏整体
可替换走 `themeRegistry` 的 `bottomBar` 槽（与 `settingsPanel` 同构）；条目落
`registryOf('node/bar')`，**归属注册方插件**，卸载自动摘除。`out:bottom` 基座段由
bottom-bar 一家挂，三个节点插件删掉自己的段。进度写 `data.runState`，走新增的
**静默写** API（落盘但不进撤销栈）。

**Tech Stack:** TypeScript / Vue 3 SFC / Vitest（node 环境为主，SSR 渲染测试用
`vue/server-renderer`）/ pnpm workspace。无第三方新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-28-node-bottom-bar-design.md`

## Global Constraints

- **中文注释**：所有新增代码的注释用中文，风格照现有文件（讲「为什么」而不是「是什么」）。
- **不写兼容代码**：旧的三份底栏组件直接删除，不做双轨、不留垫片、不留 deprecated。
- **不改红线件**：`packages/plugins/plugin-theme-default/src/components/node/` 下六个文件
  本次**一行不动**。
- **不碰 v1**：根 `src/` 与 `packages/canvas-core`。
- **词表复用**：动作的参数/进度/结果形状一律用内核已有 `ToolParamDef` / `ToolProgress` /
  `ToolResult` / `ToolOutcome`（`packages/kernel/src/toolRegistry.ts`），不新造平行词表。
- **UI 规范**：照 `docs/design/ui-style-guide.md`，不改 token 数值、不自造颜色。
- **验证命令**：每包各自跑 `pnpm -C <包> test` / `typecheck`，全绿才前进。

---

## `0 工程约定（先读这一节）

### 0.1 服务怎么取：组件里用 `ctx.get`，不要直访

服务解析 **Proxy 只存在于插件作用域**（`packages/kernel/src/Context.ts:1058`）；根 `Context`
只挂了能力段。所以：

| 位置 | 写法 |
|---|---|
| 插件 `apply(ctx)` 内 | `ctx.doc` / `ctx.nodeBar`（直访，有 Proxy） |
| **组件内**（`useCanvasRender().ctx` 是根 ctx） | `ctx.get('doc')` / `ctx.get('nodeBar')` |
| **根级测试**（`new Context()`） | `ctx.get('nodeBar')`（根 ctx 没有服务代理） |

### 0.2 底栏拿不到 `props` 的 type

区域条目经 `RegionEntryHost` 只下发 `{ id, data }`（`RegionEntryHost.vue:44`）。底栏要的
类型一律 `ctx.get('doc').getNode(props.id)?.type`，并订阅 `doc.subscribe` 跟随变化。

### 0.3 动作的**归属**：条目必须落在注册方的作用域（最容易写错的一条）

`NodeBarService` 是共享单实例，它的 `this.ctx` 恒为 bottom-bar 的 scope。若把
`register` 做成服务方法，条目就会挂在 **bottom-bar** 名下（`Context.ts:1018-1024` 的
`registryOf` 视图把撤销登记到**当前** scope 的 fiber）：别的插件卸载摘不掉自己的动作，
bottom-bar 热卸重装还会把别人的动作一起清掉。

**所以 `nodeBar` 只做读（`list` / `get` / `state`）；写走注册方自己的作用域**：

```ts
// 注册方 apply(ctx) 内 —— 两种等价写法
ctx.registryOf('node/bar').add(action.id, action, { id: action.id })
registerBarAction(ctx, action)          // bottom-bar 给的糖，可读性更好，实现就是上面那行

ctx.registryOf('node/bar-applier').add(kind, fn, { id: kind })
registerBarApplier(ctx, kind, fn)       // 同上（内部先查 has，同 kind 已存在则抛错）
```

工具映射成动作（「加一个模型 = 装一个工具插件」）走同一条路：

```ts
// 节点插件里发布「本类型可用的工具动作」，并在工具表变化时增量同步
publishToolActions(ctx, {
  types: ['text'], produces: 'text',
  needsPrompt: true, promptBinding: 'text', apply: 'applier',
})
```

**默认皮不做 tools 自动展开** —— 否则会与显式动作重复列出、且归属说不清（谁发布的归谁）。

### 0.4 进度写盘：唯一口径

**每一帧都写节点，走 `doc.updateNodeRuntime`（落盘，但**不进撤销栈**）。**

| 时刻 | 写什么 | 走哪条 API | 进撤销栈吗 |
|---|---|---|---|
| 提交那一刻 | `{ status:'running', progress:0, actionId, startedAt }` | `updateNodeRuntime` | 否 |
| 每次轮询有进展 | `{ status:'running', progress, message, taskId, actionId }` | `updateNodeRuntime` | 否 |
| 终态 | `{ status:'done' / 'error', … }` | `updateNodeRuntime` | 否 |
| 产物落到节点（图/文/视频地址） | `data` 真字段 | `doc.updateNode`（**作品写入，进历史**） | 是 |

为什么每帧都写：用户明确要求「进度与状态要保存到本地，不然刷新一下全完蛋」。
若 running 只在内存，刷新时 localStorage 里没有 running，「续查 / 判中断」永远命中不了。

代价与缓解：`scheduleCommit()`（`graphDocument.ts:405-417`）每次都全图 `snapshot()` 深拷贝并
触发 `save.set(GRAPH_KEY, …)`。所以中间帧做 **200ms 节流**（窗口内**不写**，不论进度是否变），
终态不节流、必写。

### 0.5 `restoreAll` 的触发时机（刷新续查）

`restoreAll()` 要等「动作都注册完了」才有意义，且**热装路径下 `ctx:ready` 已经错过**
（manifest 分支是先空 `start()` 再逐项 `installPlugin`，见 `createMiniCanvasHost.ts:210-217`）。
所以两条时机都挂，用一个 `restored` 位保证只跑一次：

```ts
let restored = false
const tryRestore = (): void => {
  if (restored) return
  if (!ctx.get('doc') || !ctx.get('nodeBar')) return
  restored = true
  void task.restoreAll()
}
ctx.on('ctx:ready', tryRestore)              // 冷启动
ctx.on('ctx:plugin-installed', tryRestore)   // 热装（manifest 那条链）
```

---

## 文件结构

**新增包 `packages/plugins/plugin-bottom-bar/`**

| 文件 | 职责 |
|---|---|
| `package.json` / `tsconfig.json` / `vitest.config.ts` / `vite.config.ts` / `src/env.d.ts` | 照 `plugin-node-text` 模板抄**再改本包名**（Task 2 Step 1 三条改名要求） |
| `src/barTypes.ts` | 动作/写入器/运行上下文的**类型**（纯类型） |
| `src/barRegistry.ts` | 动作与写入器的**纯逻辑容器**（零 Vue，可单测） |
| `src/runState.ts` | `data.runState` 的读写/归一（纯函数） |
| `src/taskRuntime.ts` | 执行一个动作的**纯逻辑流程**（提交→轮询→终态→写回） |
| `src/toolActions.ts` | `publishToolActions`：把 `ctx.tools` 里的工具映射成底栏动作（纯逻辑 + 增量同步） |
| `src/panelSource.ts` | **从 image/text 上移合并**的上游素材收集 / @ 引用 / `buildToolInput` |
| `src/nodeBarPlugin.ts` | `NodeBarService`（读）+ `NodeTaskService`（执行）+ 注册糖 + 插件 apply |
| `src/BottomBarHost.vue` | 底栏宿主：读 `themeRegistry.winner('bottomBar')` 渲染赢家 |
| `src/NodeBottomBar.vue` | 默认皮 UI（动作/参数/提示词/执行/状态/进度条） |
| `src/NodeTaskOverlay.vue` | 卡片上的加载/进度覆盖层 |
| `src/index.ts` | 包出口（`pluginBottomBar` / `registerBarAction` / `registerBarApplier` / `publishToolActions` / `BOTTOM_BAR_SLOT` / 类型） |

**改动的现有文件**

| 文件 | 改什么 | 任务 |
|---|---|---|
| `packages/canvas-data/src/graphDocument.ts` | 新增 `updateNodeRuntime`（静默写） | T1 |
| `packages/canvas-data/src/docService.ts` | 门面转发 `updateNodeRuntime` | T1 |
| `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts` | 删 `out:bottom`，改注册动作 + 写入器 | T7 |
| `packages/plugins/plugin-node-image/src/nodeImagePlugin.ts` | 同上 + image 写入器 | T8 |
| `packages/plugins/plugin-node-video/src/nodeVideoPlugin.ts` | 同上 + 剪辑改 `panel` + `onSelect` | T9 |
| `packages/ui/src/assembly.ts` / `packages/ui/package.json` | 装配 `pluginBottomBar` 与 mock 插件 | T10 |
| `packages/ui/src/__tests__/nodePluginsAssembly.test.ts` | `EXPECTED` 段表随迁移更新 | T7–T9 |
| `packages/ui/src/__tests__/entrypoint.test.ts` | `APP_PLUGINS` 条数 21 → 23 | T10 |
| `packages/ui/e2e/canvas-e2e.mjs` | 追加 4 条断言 | T10 |

**删除**（新建合并版在 T6b，删旧件在 T7/T8）

| 文件 | 任务 |
|---|---|
| `plugin-node-text/src/TextGeneratePanel.vue` + `__tests__/textGeneratePanelRender.test.ts` | T7 |
| `plugin-node-text/src/textPanelSource.ts` + `__tests__/textPanelSource.test.ts` | T7 |
| `plugin-node-image/src/ImageGeneratePanel.vue` | T8 |
| `plugin-node-image/src/panelSource.ts` + `__tests__/panelSource.test.ts` | T8 |
| `plugin-node-image/src/imageRun.ts` 的 `runImageGeneration`（连带 `buildToolInput` 的 import） | T8 |
| `plugin-node-video/src/VideoClipPanel.vue` 的 `out:bottom` 段注册（组件本体保留） | T9 |

---

### Task 1: canvas-data 静默写 API（落盘但不进撤销栈）

**Files:**
- Modify: `packages/canvas-data/src/graphDocument.ts`
- Modify: `packages/canvas-data/src/docService.ts`
- Test: `packages/canvas-data/src/__tests__/docRuntimeWrite.test.ts`

**Interfaces:**
- Produces: `GraphDocument.updateNodeRuntime(id, patch): void` 与 `DocService.updateNodeRuntime(id, patch): void`
  —— 语义 = `updateNode` 但在 `history.withRecord` **外面**执行，仍调 `scheduleCommit()`。
  节点不存在时同 `updateNode`：抛错。

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

  it('撤销栈深度不变（Ctrl+Z 退的是上一步真实操作，不是进度帧）', () => {
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

- [ ] **Step 2: 跑测试确认失败**：`pnpm -C packages/canvas-data test docRuntimeWrite` → FAIL
- [ ] **Step 3: 最小实现**

`graphDocument.ts` 接口 `GraphDocumentService` 加签名，实现加在 `updateNode` 旁边
（**不要在 `history.withRecord` 里**）：

```ts
  /**
   * 写节点的**运行期状态**：落盘，但**不进撤销栈**。
   *
   * 为什么单独一条：进度帧每几百毫秒一次，若每帧都 withRecord，撤销栈会被冲垮
   * （按一次 Ctrl+Z 只退一格进度条）。而这类状态又必须持久化 —— 刷新不能丢
   * （用户明确要求）。两条一起要，只能把「写」与「记一次操作」拆开。
   */
  updateNodeRuntime(id: string, patch: Parameters<NodeStoreService['updateNode']>[1]): void {
    this.nodeStore.updateNode(id, patch)
    this.scheduleCommit()
  }
```

`docService.ts`：`DocService` 加签名，`createDocService` 转发表加
`updateNodeRuntime: (id, patch) => need('graph').updateNodeRuntime(id, patch)`。

- [ ] **Step 4: 跑测试确认通过**：`pnpm -C packages/canvas-data test`（原 328 + 4）
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
- Produces: `BarAction` / `BarRunInput` / `BarRunContext` / `BarApplier` 与纯逻辑容器
  `class BarRegistry`（`list` / `get` / `kinds`；纯函数层，给测试与 `toolActions` 复用）。

```ts
/** 底栏动作：一个「能被用户点、点了有结果」的东西（模型 / 加工 / 工具，同一套形状） */
interface BarAction {
  /** 唯一 id（用户说的「标识」）：同 id 重复注册 = 替换（热更） */
  id: string
  /** 给哪些节点类型用；省略 = 所有类型都适用 */
  types?: string[]
  /** 按钮 / 下拉里显示的名字 */
  title: string
  description?: string
  /** 图标（opaque 句柄：SVG 字符串） */
  icon?: string
  group?: string
  /** 可视化配置：复用内核 ToolParamDef 词表，底栏自动长控件 */
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
   * - 'self'：本动作自己已经写好节点（旋转/下载/复制/删除），别让写入器再写一遍。
   */
  apply?: 'applier' | 'self'
  /** 排序（小者在先；没给的一律排最后） */
  order?: number
  /** 本动作在节点上显示的只读读数（「12 字 · 3 行」这类）；空串 = 不显示 */
  info?(data: Record<string, unknown>): string
  /** 本动作被选中 / 取消选中（video 剪辑会话靠它开合） */
  onSelect?(nodeId: string): void
  onDeselect?(nodeId: string): void
  /** 执行体：与内核工具同一个契约（同步 ToolResult，或返回轮询函数） */
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
  readData(): Record<string, unknown>
}
type BarApplier = (nodeId: string, result: ToolResult, ctx: { nodeType: string }) => void | Promise<void>
```

- [ ] **Step 1: 建包骨架**

复制 `packages/plugins/plugin-node-text/` 的 `package.json` / `tsconfig.json` /
`vitest.config.ts` / `vite.config.ts` / `src/env.d.ts`，然后**三处必须改**：

1. `package.json`：`name` → `@mini-canvas/plugin-bottom-bar`；`scripts` 收成
   `{ "build": "vite build", "test": "vitest run", "typecheck": "tsc --noEmit" }`；
   `dependencies` = `canvas-base / canvas-data / canvas-render / kernel / prosemirror-editor-bundle`；
   `devDependencies` 含 `@vitejs/plugin-vue / @vue/server-renderer / plugin-theme-default /
   typescript / vite / vitest / vue`（`plugin-theme-default` **只进 devDependencies**）。
2. `vite.config.ts`：`name` → `MiniCanvasPluginBottomBar`、`fileName` → `plugin-bottom-bar.js`。
3. `tsconfig.json` / `vitest.config.ts` / `src/env.d.ts` 照抄（不含包名）。

然后 `pnpm install`。

- [ ] **Step 2: 写失败测试**

```ts
// packages/plugins/plugin-bottom-bar/src/__tests__/barRegistry.test.ts
import { describe, it, expect } from 'vitest'
import { BarRegistry } from '../barRegistry'
import type { BarAction } from '../barTypes'

function action(id: string, types?: string[]): BarAction {
  return { id, types, title: id, run: () => ({ ok: true }) }
}

describe('BarRegistry：按节点类型筛 + 排序（纯逻辑）', () => {
  it('types 省略 = 所有类型都适用', () => {
    const reg = new BarRegistry()
    reg.add(action('all'))
    reg.add(action('img-only', ['image']))
    expect(reg.list({ type: 'image' }).map((a) => a.id)).toEqual(['all', 'img-only'])
    expect(reg.list({ type: 'text' }).map((a) => a.id)).toEqual(['all'])
  })

  it('排序：显式 order 升序在前，没给 order 的一律排最后（保插入序）', () => {
    const reg = new BarRegistry()
    reg.add({ id: 'no-order-1', title: 'a', run: () => ({ ok: true }) })
    reg.add({ id: 'late', title: 'b', order: 10, run: () => ({ ok: true }) })
    reg.add({ id: 'no-order-2', title: 'c', run: () => ({ ok: true }) })
    reg.add({ id: 'early', title: 'd', order: -5, run: () => ({ ok: true }) })
    expect(reg.list().map((a) => a.id)).toEqual(['early', 'late', 'no-order-1', 'no-order-2'])
  })
})
```

- [ ] **Step 3: 跑测试确认失败** / **Step 4: 实现 `barTypes.ts` 与 `barRegistry.ts`**

`barRegistry.ts` 用 `Map`，`list` 排序键 = `order ?? Infinity`，同键保插入序。
（`add`/`remove` 是**纯内存**容器方法，专供单测与 `toolActions` 用；跨插件落场的是
`registryOf('node/bar')`，见 `0.3。）

- [ ] **Step 5: 跑测试确认通过**（2 tests） / **Step 6: 提交**

```bash
git add packages/plugins/plugin-bottom-bar pnpm-lock.yaml
git commit -m "feat(plugin-bottom-bar): 新包骨架 + 动作容器（纯逻辑）"
```

---

### Task 3: `nodeTask` 执行流（提交 / 轮询 / 终态 / 写回 / 刷新续查）

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/runState.ts`
- Create: `packages/plugins/plugin-bottom-bar/src/taskRuntime.ts`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/runState.test.ts`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/taskRuntime.test.ts`

**Interfaces:**
- Produces:
  - `runState.ts`：`NodeRunState`、`readRunState(data)`、`runningState(actionId, message?)`、
    `progressState(base, p)`、`doneState(actionId, taskId?)`、`errorState(actionId, message)`
  - `taskRuntime.ts`：`runAction(args, deps): Promise<ToolResult>`、
    `resumeAction(args, deps): Promise<ResumeResult>`。
    `args = { nodeId, nodeType, action, input, registry, signal? }`；
    `registry` 是**只读查找口** `{ get(id), applierOf(kind) }`（由 `nodeBarPlugin` 用所在场的
    读取方式填，见 Task 4）；
    `deps = { readData, writeRuntime, writeResult?, runApplier?, interval?, timeoutMs?, throttleMs?, now? }`

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
    expect(runningState('image.gen')).toMatchObject({ status: 'running', progress: 0, actionId: 'image.gen' })
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

- [ ] **Step 2: 跑测试确认失败** / **Step 3: 实现 `runState.ts`**（纯函数）
- [ ] **Step 4: 写 `taskRuntime` 的失败测试**

```ts
// packages/plugins/plugin-bottom-bar/src/__tests__/taskRuntime.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runAction, resumeAction } from '../taskRuntime'
import type { BarAction } from '../barTypes'

/** 只读查找口：动作表 + 写入器表（把纯容器当查找源，贴近 Task 4 的接法） */
function registryOf(actions: BarAction[], appliers: Record<string, (id: string, r: never) => void> = {}) {
  const map = new Map(actions.map((a) => [a.id, a]))
  return { get: (id: string) => map.get(id), applierOf: (k: string) => appliers[k] }
}

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
    throttleMs: 0,
  }
  return { runtime, written, deps }
}

const imageAction = (extra: Partial<BarAction> = {}): BarAction => ({
  id: 'a', types: ['image'], title: 'A', run: () => ({ ok: true, urls: ['x.png'] }), ...extra,
})

describe('runAction', () => {
  it('同步动作：先写 running、再写 done，最后交给写入器', async () => {
    const seen: unknown[] = []
    const action = imageAction()
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action], { image: (_id, r) => seen.push(r) }) },
      h.deps,
    )
    expect(out).toEqual({ ok: true, urls: ['x.png'] })
    expect(h.runtime[0]).toMatchObject({ status: 'running', actionId: 'a' })
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done', actionId: 'a' })
    expect(seen).toEqual([{ ok: true, urls: ['x.png'] }])
  })

  it('异步动作：轮询被驱动到 done，逐帧写 runtime（throttleMs=0）', async () => {
    let step = 0
    const action = imageAction({
      run: () => () => {
        step += 1
        return step < 3
          ? { status: 'running', progress: step * 30, message: '跑着呢' }
          : { status: 'done', result: { ok: true, urls: ['y.png'] } }
      },
    })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action]) },
      h.deps,
    )
    expect(out.ok).toBe(true)
    expect(h.runtime.filter((s) => s.status === 'running').length).toBeGreaterThanOrEqual(3)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' })
  })

  it('中间帧节流：窗口内不写（不论进度是否变），终态不受节流影响', async () => {
    let step = 0
    const action = imageAction({
      run: () => () => {
        step += 1
        return step < 4
          ? { status: 'running', progress: step * 10, message: '跑着呢' }
          : { status: 'done', result: { ok: true, urls: ['z.png'] } }
      },
    })
    const h = harness()
    h.deps.throttleMs = 10_000
    await runAction({ nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action]) }, h.deps)
    expect(h.runtime.filter((s) => s.status === 'running')).toHaveLength(1) // 只剩提交那一帧
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' })
  })

  it('失败：写 error 终态，不调写入器', async () => {
    const applied = vi.fn()
    const action = imageAction({ run: () => { throw new Error('后端挂了') } })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action], { image: applied }) },
      h.deps,
    )
    expect(out.ok).toBe(false)
    expect(out.error).toContain('后端挂了')
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
    expect(applied).not.toHaveBeenCalled()
  })

  it("apply:'self' 的即时动作：不经过写入器", async () => {
    const applied = vi.fn()
    const action = imageAction({ id: 'image.rotate', apply: 'self', run: () => ({ ok: true }) })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action], { image: applied }) },
      h.deps,
    )
    expect(out.ok).toBe(true)
    expect(applied).not.toHaveBeenCalled()
    expect(h.written).toHaveLength(0)
  })

  it('取消：signal 已中止时收敛成 error', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const action = imageAction({ run: () => new Promise(() => {}) as never })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action]), signal: ctrl.signal },
      h.deps,
    )
    expect(out.ok).toBe(false)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
  })
})

describe('resumeAction：刷新后接着查', () => {
  it('动作有 resume 且有 taskId → 续查到终态', async () => {
    let step = 0
    const action = imageAction({
      resume: () => () => {
        step += 1
        return step < 2
          ? { status: 'running', progress: 60 }
          : { status: 'done', result: { ok: true, urls: ['r.png'] } }
      },
    })
    const h = harness()
    const out = await resumeAction(
      { nodeId: 'n1', nodeType: 'image', registry: registryOf([action]), taskId: 't1', actionId: 'a' },
      h.deps,
    )
    expect(out.resumed).toBe(true)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' })
  })

  it('动作没声明 resume → 标中断错误，不悬挂', async () => {
    const action = imageAction()
    const h = harness()
    const out = await resumeAction(
      { nodeId: 'n1', nodeType: 'image', registry: registryOf([action]), taskId: 't1', actionId: 'a' },
      h.deps,
    )
    expect(out.resumed).toBe(false)
    expect(out.state.status).toBe('error')
  })

  it('拿不到 taskId → 标中断错误', async () => {
    const action = imageAction({ resume: () => () => ({ status: 'running' }) })
    const h = harness()
    const out = await resumeAction(
      { nodeId: 'n1', nodeType: 'image', registry: registryOf([action]), taskId: '', actionId: 'a' },
      h.deps,
    )
    expect(out.resumed).toBe(false)
    expect(out.state.status).toBe('error')
  })

  it('**动作本身已不存在**（提交它的插件被卸载 / 版本变了）→ 标中断错误，不抛', async () => {
    const h = harness()
    const out = await resumeAction(
      { nodeId: 'n1', nodeType: 'image', registry: registryOf([]), taskId: 't1', actionId: 'gone.action' },
      h.deps,
    )
    expect(out.resumed).toBe(false)
    expect(out.state.status).toBe('error')
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
  })
})
```

- [ ] **Step 5: 跑测试确认失败**：`pnpm -C packages/plugins/plugin-bottom-bar test taskRuntime`
- [ ] **Step 6: 实现 `taskRuntime.ts`**

`runAction`：① `signal` 已中止 → `errorState('已取消')` + `writeRuntime`，返回 `{ok:false}`；
② `writeRuntime(runningState(actionId))`；③ `await action.run(input, runCtx)`（异常 → `errorState` +
`writeRuntime` + `{ok:false,error}`）；④ 返回值是函数 → 循环 `poll()`：`running` 时若「距上一帧
早于 `throttleMs`（默认 200）」→ **不写**（不看进度是否变）；超时 → `errorState('任务超时')`；
`done` → 跳出；⑤ 终态（不节流）：`ok` 且 `action.apply !== 'self'` → `writeRuntime(doneState)` +
存在 `registry.applierOf(nodeType)` 就调它；`ok` 且 `'self'` → 只 `writeRuntime(doneState)`；
否则 `writeRuntime(errorState)`。

`resumeAction`：**先查 `const action = registry.get(actionId)`**；
`!action?.resume` 或 `!taskId` → **同步**（第一个 `await` 之前）`writeRuntime(errorState(actionId, '刷新后任务已中断'))`
并返回 `{ resumed: false, state }`；否则驱动轮询到终态（终态写盘同上）。
**这条同步写盘很关键**：`restoreAll` 用 `void` 调用它，异步分支抛错会被吞掉，同步写下的错误态是
刷新场景唯一的兜底显示。

- [ ] **Step 7: 跑测试确认通过** / **Step 8: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): nodeTask 执行流（提交/轮询/终态/写回/刷新续查/节流）"
```

---

### Task 4: 服务与插件装配（读服务 `nodeBar` + `nodeTask` + 注册糖 + 挂宿主/覆盖层）

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts`
- Create: `packages/plugins/plugin-bottom-bar/src/index.ts`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/pluginAssembly.test.ts`

**Interfaces:**
- Consumes: Task 2/3；`ctx.registryOf('node/bar')` / `ctx.registryOf('node/bar-applier')`。
- Produces:
  - `NodeBarService`（**只读**）：`list(filter?)` / `get(id)` / `applierOf(kind)` / `state(nodeId)`
  - `NodeTaskService`：`run(nodeId, actionId, input?)` / `cancel(nodeId)` / `restoreAll()`
  - `registerBarAction(ctx, action)` / `registerBarApplier(ctx, kind, fn)` / `publishToolActions(ctx, opts)`
  - `pluginBottomBar`、插件名 `bottom-bar`、`BOTTOM_BAR_SLOT = 'bottomBar'`

- [ ] **Step 1: 写失败测试**

```ts
// packages/plugins/plugin-bottom-bar/src/__tests__/pluginAssembly.test.ts
import { describe, it, expect } from 'vitest'
import {
  Context, NodeRegistry, ThemeRegistry, NodeStore, EdgeStore, Selection, History,
  GraphDocument, createDocService,
} from '@mini-canvas/canvas-data'
import { pluginBottomBar, registerBarAction, registerBarApplier } from '../index'
import type { NodeBarService } from '../index'

/** 与 nodeTextSmoke.test.ts 的 boot 同形：先把 inject 声明的服务备齐 */
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
  ctx.inject(
    'doc',
    createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }),
  )
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.plugin(pluginBottomBar)
  await ctx.start()
  return { ctx, nodeStore, bar: () => ctx.get<NodeBarService>('nodeBar') }
}

describe('bottom-bar 插件装配', () => {
  it('上架 nodeBar / nodeTask 两个服务', async () => {
    const { ctx, bar } = await boot()
    expect(bar()).toBeTruthy()
    expect(ctx.get('nodeTask')).toBeTruthy()
    ctx.stop()
  })

  it('登记的动作能被 list 出来；卸载后干净（stop 会清服务与注册场）', async () => {
    const { ctx, bar } = await boot()
    registerBarAction(ctx, { id: 'a', types: ['image'], title: 'A', run: () => ({ ok: true }) })
    expect(bar()!.list({ type: 'image' })).toHaveLength(1)
    ctx.stop()
    // stop 后服务已清、注册场已重置；这里断言的是「不留幽灵」
    expect(ctx.get('nodeBar')).toBeUndefined()
    expect(ctx.registryOf('node/bar').list('a')).toHaveLength(0)
  })

  it('同 id 重复登记 = 替换，不变成两条', async () => {
    const { ctx, bar } = await boot()
    registerBarAction(ctx, { id: 'a', title: '旧', run: () => ({ ok: true }) })
    registerBarAction(ctx, { id: 'a', title: '新', run: () => ({ ok: true }) })
    const list = bar()!.list()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('新')
    ctx.stop()
  })

  it('写入器按 kind 唯一：同 kind 重复登记抛错', async () => {
    const { ctx } = await boot()
    registerBarApplier(ctx, 'image', () => {})
    expect(() => registerBarApplier(ctx, 'image', () => {})).toThrow()
    ctx.stop()
  })

  it('底栏宿主挂 out:bottom、覆盖层挂 over:inset（* 通配）', async () => {
    const { ctx } = await boot()
    const field = ctx.registryOf('node/region')
    expect(field.list('*/out:bottom')).toHaveLength(1)
    expect(field.list('*/over:inset')).toHaveLength(1)
    ctx.stop()
  })

  it('启动时把刷新前 running 的节点接回来；动作已不在 → 收敛成中断错误（不悬挂）', async () => {
    const ctx = new Context()
    const nodeStore = new NodeStore()
    nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 10, h: 10 } })
    const id = nodeStore.addNode('image', { x: 0, y: 0 })
    nodeStore.updateNodeData(id, { runState: { status: 'running', taskId: 't1', actionId: 'gone.action' } })
    const edgeStore = new EdgeStore()
    const selection = new Selection()
    const history = new History({ snapshot: () => ({ nodes: [], edges: [] }), restore: () => {} })
    ctx.inject('selection', selection)
    ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
    ctx.inject('nodeRegistry', new NodeRegistry())
    ctx.inject('themeRegistry', new ThemeRegistry())
    ctx.plugin(pluginBottomBar)
    await ctx.start()
    // restoreAll 经 ctx:ready 触发；gone.action 查不到 → 中断错误
    await Promise.resolve()
    expect(nodeStore.getNode(id)?.data.runState).toMatchObject({ status: 'error' })
    ctx.stop()
  })
})
```

- [ ] **Step 2: 跑测试确认失败** / **Step 3: 实现 `nodeBarPlugin.ts` + `index.ts`**

要点：

- `NodeBarService extends Service`（`super(ctx, 'nodeBar')`，**只读**）：`list(filter?)` 读
  `ctx.registryOf('node/bar')` 的场并按 `types` 过滤 + `order ?? Infinity` 升序；
  `get(id)`；`applierOf(kind)` 读 `node/bar-applier`；`state(nodeId)` 读 `doc` 里该节点的 `runState`。
- 三个注册糖（**关键：落场用调用方 ctx**，见 `0.3）：

```ts
/** 注册一个底栏动作。条目归**调用方插件**（卸载自动摘除、同 id 覆盖） */
export function registerBarAction(ctx: PluginScope, action: BarAction): void {
  ctx.registryOf<BarAction>('node/bar').add(action.id, action, { id: action.id })
}

/** 注册某节点类型的结果写入器（一个 kind 只允许一个） */
export function registerBarApplier(ctx: PluginScope, kind: string, fn: BarApplier): void {
  const field = ctx.registryOf<BarApplier>('node/bar-applier')
  if (field.has(kind)) throw new Error('[bottom-bar] applier already registered: ' + kind)
  field.add(kind, fn, { id: kind })
}
```

- `NodeTaskService extends Service`（`super(ctx, 'nodeTask')`）：`run` / `cancel` / `restoreAll()`；
  `Map<nodeId, AbortController>`。deps 接线：
  - `writeRuntime` → `doc.updateNodeRuntime(nodeId, { data: { runState } })`（**不走历史**）；
  - `writeResult` → `doc.updateNode(nodeId, { data })`（**走历史**，那是作品）；
  - `readData` → `doc.getNode(nodeId)?.data ?? {}`；
  - `registry` → `{ get: (id) => bar.list().find(a => a.id === id), applierOf: (k) => bar.applierOf(k) }`。
  - `restoreAll()`：遍历 `doc.getNodes()`，对 `readRunState(n.data).status === 'running'` 的
    调 `resumeAction`（`void`，内部同步写下错误态兜底）。
- `apply(ctx)`：

```ts
const bar = new NodeBarService(ctx)
const task = new NodeTaskService(ctx)
ctx.nodes.attach('*', { region: 'out:bottom', component: BottomBarHost, id: 'bottom-bar/host' })
ctx.nodes.attach('*', { region: 'over:inset', component: NodeTaskOverlay, id: 'bottom-bar/overlay' })
// 刷新续查（`0.5）：冷启动与热装两条时机都挂，只跑一次
let restored = false
const tryRestore = () => { if (restored || !ctx.get('nodeBar')) return; restored = true; void task.restoreAll() }
ctx.on('ctx:ready', tryRestore)
ctx.on('ctx:plugin-installed', tryRestore)
```

- `export const inject = ['doc', 'nodeRegistry', 'themeRegistry']`（`themeRegistry` 必须进 inject：
  `ctx.theme.register` 缺服务时静默 no-op）。
- 声明合并：`Services` 加 `nodeBar`/`nodeTask`；`Context` 加 `nodeBar`/`nodeTask`。

- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): 读服务 nodeBar + nodeTask + 按作用域落场的注册糖"
```

---

### Task 5: 默认皮 UI（`NodeBottomBar.vue`）与可替换宿主

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/BottomBarHost.vue`
- Create: `packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue`
- Modify: `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts`（apply 里把默认皮登记进
  `themeRegistry` 的 `bottomBar` 槽）
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/bottomBarRender.test.ts`

**Interfaces:**
- Consumes: `useCanvasRender` / `useUiComponent` / `useSoleNodeSelected` / `useGenPanelMetrics`、
  `ProseMirrorEditor`、`ctx.get('nodeBar')` / `ctx.get('nodeTask')` / `ctx.get('doc')`。
- Produces: 主题槽名 `bottomBar`。

- [ ] **Step 1: 写失败测试（SSR 渲染 + 可替换）**

照 `plugin-node-text/src/__tests__/textGeneratePanelRender.test.ts` 的写法（装真主题插件 +
`createSSRApp` + `renderToString` + 最小 `RENDER_CONTEXT_KEY` 桩）。**注意断言对象要分清**：

1. **默认皮 `NodeBottomBar`**：注册一条 image 动作（`fields` + `needsPrompt: true`）→ HTML 含
   该动作标题、「执行」按钮、参数控件；
2. **默认皮 `NodeBottomBar`**：该类型一条动作都没有 → 渲染为空；
3. **宿主 `BottomBarHost`**：`ctx.theme.add('bottomBar', FakeBar, { order: -1 })` 后渲染的是
   FakeBar，**与该类型有没有动作无关**（可替换性不依赖默认皮的判空）。

- [ ] **Step 2: 跑测试确认失败** / **Step 3: 实现组件**

`BottomBarHost.vue` 照 `canvas-render/src/components/SettingsHost.vue:36-57`（初始读一次
`themeRegistry.winner('bottomBar')`，订阅 `ctx:plugin-installed` / `ctx:plugin-uninstalled` /
`themeRegistry.subscribe` 重读，`markRaw`，`<component :is="winner" :id="id" :data="data" />`）。
**宿主只按赢家渲染，判空留给皮。**

`NodeBottomBar.vue`（默认皮）：动作专属面板（若有）→ 提示词输入框（`needsPrompt`）→
一行控件（动作下拉 / `fields` 控件 / 模板下拉 / `info` 文案 / 执行按钮）→ 进度条（`running`）。

- 节点类型：`const nodeType = computed(() => doc?.getNode(props.id)?.type)`（`props` 没有 type，
  见 `0.2）；订阅 `doc.subscribe` 跟随。
- `visible = useSoleNodeSelected(props.id)`；**没有可用动作时自身返回空**（壳的
  `.v2-slot--bottom` 包裹层不算底栏产出）。
- 动作列表 = `bar.list({ type: nodeType.value })`（**不做 tools 自动展开**，见 `0.3；模型类动作由
  节点插件经 `publishToolActions` 发布）。
- 热装卸后重读：订阅 `ctx:plugin-installed` / `ctx:plugin-uninstalled` 与
  `ctx.registryOf('node/bar').subscribe`。
- 当前动作 `ref`；切换时旧动作 `onDeselect?`、新动作 `onSelect?`，并用该动作 `fields` 重置
  `values`（`select` 无 default 取第一项，与内核 `resolveToolParams` 同口径）。
- `promptBinding: 'text'`：输入框 = `props.data.text`，编辑即
  `ctx.get('doc').updateNode(id, { data: { text } })`（进历史，是作品）；`'none'`：临时输入。
- `fields` 交给 `useUiComponent('toolParamField')` 渲染。
- 执行：`ctx.get('nodeTask').run(props.id, action.id, { prompt, values, resources })`；`running` 禁用+转圈。
- `info`：有回调就渲染返回值。宽度取 `useGenPanelMetrics().imageWidth`。

- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): 默认皮 UI + themeRegistry 可替换宿主"
```

---

### Task 6: 加载/进度覆盖层（`NodeTaskOverlay.vue`）

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/NodeTaskOverlay.vue`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/taskOverlayRender.test.ts`

**Interfaces:**
- Consumes: `props.data.runState`（单一来源）与 `ctx.get('nodeTask').cancel`。

- [ ] **Step 1: 写失败测试**

SSR 断言：① 缺省/`idle`/`done` → 渲染空；② `running` + `progress:42` → 含 `42%` 与文案；
③ `running` 无 `progress` → 有不确定态标记；④ `error` → 有错误文案；
⑤ 同层顺序：编辑浮层与覆盖层同时挂 `image/over:inset` → 覆盖层在编辑浮层**之后**。

- [ ] **Step 2: 跑测试确认失败** / **Step 3: 实现组件**

- 根元素 `position:absolute; inset:0`，半透明遮罩（既有 token）+ 居中卡片（转圈 + 百分比 +
  文案 + 「取消」按钮 → `ctx.get('nodeTask').cancel(id)`）。
- `running` 时 `pointer-events:auto`；其余 `display:none` + `pointer-events:none`。
- 动效带 `prefers-reduced-motion` 降级。

**同层顺序机制（照实注释）**：`BaseNode` 对 `over:inset` 是**一次 v-for**（`BaseNode.vue:919-925`），
DOM 顺序 = 「基座条目在前、注册场条目按 order 在后」；`order` 只在**同一条写路径内**排序。
结论：**编辑浮层（基座）恒在下、覆盖层（注册场）恒在上**；第三方插件再往 `over:inset` attach
会盖住覆盖层 —— 已知取舍。

- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): 节点卡片上的加载/进度覆盖层"
```

---

### Task 6b: 上移上游素材 / @ 引用 / `buildToolInput`（合并两份重复实现）

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/panelSource.ts`（合并版）
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/panelSource.test.ts`（两个旧测试合并）

**Interfaces:** 导出名与旧实现一致：`UpstreamMaterial`、`collectUpstreamMaterials`、`buildToolInput`、
`makeResourceResolver`、`toEditorResources`、`materialCards`、`toolOptions`、`paramDefs`、
`paramOptions`、`paramRaw`、`paramValue`、`paramsForTool`、`pickDefaultTool`、`templateOptions`、
`templatePrompt`、`validateGenInput`、`panelStatusText`。

- [ ] **Step 1: 先搬测试（先红）**（合并两处重复用例）
- [ ] **Step 2: 跑测试确认失败**：`pnpm -C packages/plugins/plugin-bottom-bar test panelSource`
- [ ] **Step 3: 实现合并版**（以 image 那份为骨架，并入 text 独有部分；两个 `UpstreamMaterial`
  只留一个定义）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**（**本票不删旧文件** —— 调用方在 T7/T8 切走后由 T7/T8 删）

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): 上移上游素材收集与工具入参组装（合并两份重复实现）"
```

---

### Task 6c: `publishToolActions`（工具 → 底栏动作）

**为什么单独一票：** 「加一个模型 = 装一个工具插件」这条既有承诺要靠它落地；
它要处理「工具晚于节点插件注册」「工具卸载后动作要消失」两件事，是独立可测的一小块。

**Files:**
- Create: `packages/plugins/plugin-bottom-bar/src/toolActions.ts`
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/toolActions.test.ts`

**Interfaces:**
- `publishToolActions(ctx: PluginScope, opts: { types: string[]; produces: ToolResourceKind;
  needsPrompt?: boolean; promptBinding?: 'none'|'text'; apply?: 'applier'|'self';
  kindOf?: (type: string) => ToolResourceKind }): () => void`
- 行为：把 `ctx.get('tools').list({ produces })` 的每个工具发布成一条动作
  （`id = 'tool:' + tool.name`、`title = tool.title ?? tool.name`、`fields = tool.params`、
  `templates = tool.templates`、`needsPrompt`/`promptBinding`/`apply` 取 opts、
  `run = (input) => tools.invoke(tool.name, input)`），**落场用调用方 ctx**（`0.3）；
  订阅 `ctx:plugin-installed`（工具表可能变化）做增量同步：新增的发布、消失的移除。
  返回一个「立即重新同步」的句柄（测试用）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { publishToolActions } from '../toolActions'

/** 造一个带 tools 服务的 ctx；工具表用内核 ToolRegistry（真实现） */
async function boot() {
  const ctx = new Context()
  await ctx.start()
  return ctx
}

describe('publishToolActions：把工具表映射成底栏动作', () => {
  it('发布 produces 匹配的工具，id 前缀 tool:；同 id 重复同步不重复', async () => {
    const ctx = await boot()
    ctx.tools.register({ name: 't.image', title: '图模型', produces: 'image', run: () => ({ ok: true }) })
    publishToolActions(ctx, { types: ['image'], produces: 'image', needsPrompt: true })
    const ids = ctx.registryOf('node/bar').list('tool:t.image').map((e) => e.id)
    expect(ids).toEqual(['t.image'])
    ctx.stop()
  })

  it('later 注册的工具：重新同步后出现', async () => {
    const ctx = await boot()
    publishToolActions(ctx, { types: ['image'], produces: 'image' })
    expect(ctx.registryOf('node/bar').list('tool:late')).toHaveLength(0)
    ctx.tools.register({ name: 'late', title: '晚到', produces: 'image', run: () => ({ ok: true }) })
    ctx.emit('ctx:plugin-installed', { name: 'someone' })  // 触发增量同步
    expect(ctx.registryOf('node/bar').list('tool:late')).toHaveLength(1)
    ctx.stop()
  })
})
```

（若 `ctx.emit` 在测试里不便触发订阅，直接让 `publishToolActions` 返回的句柄＝同步函数，
测试里调一次即可 —— 实现时保持这一条可测。）

- [ ] **Step 2: 跑测试确认失败** / **Step 3: 实现**
- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-bottom-bar
git commit -m "feat(plugin-bottom-bar): publishToolActions —— 工具映射成底栏动作（含增量同步）"
```

---

### Task 7: 迁移 text 节点（删 TextGeneratePanel，改注册动作）

**Files:**
- Modify: `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts`
- Delete: `TextGeneratePanel.vue` / `textPanelSource.ts` + `__tests__/textPanelSource.test.ts` /
  `__tests__/textGeneratePanelRender.test.ts`
- Modify: `packages/plugins/plugin-node-text/src/__tests__/nodeTextSmoke.test.ts`
- Modify: `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`（text `extraSegments` → `[]`）

**Interfaces:**
- Consumes: `registerBarAction` / `registerBarApplier` / `publishToolActions`（**不进 inject**，
  见 `0.3；bottom-bar 缺席时这些调用整体跳过）。
- Produces: text 底栏动作：① 由 `publishToolActions` 发布的「每个文本工具一条」
  （`needsPrompt:true`、`promptBinding:'text'`）；② `text.duplicate` / `text.delete`
  （`apply:'self'`）；③ 每条动作的 `info` 显示字数/行数。写入器把 `result.text` 写进 `data.text`。

- [ ] **Step 1: 改测试（先红）**：`nodeTextSmoke` 区域断言改成只有 `in`；
  `nodePluginsAssembly` 的 text `extraSegments` 改成 `[]`。
- [ ] **Step 2: 跑测试确认失败**（`plugin-node-text test nodeTextSmoke` + `ui test nodePluginsAssembly`）
- [ ] **Step 3: 改插件**

删 `segments` 整条字段、删 import 与三个文件；`apply` 里「取得到就注册、取不到等上架」：

```ts
// `0.3：nodeBar 是插件服务（不是宿主恒在服务），故不进 inject；没装 bottom-bar 的宿主照常工作。
// 注册糖把条目落在**本插件** scope（卸载自动摘除），所以这里不自己 ctx.effect。
const registerBar = (): boolean => {
  if (!ctx.tryGet('nodeBar')) return false
  publishToolActions(ctx, { types: ['text'], produces: 'text', needsPrompt: true, promptBinding: 'text' })
  registerBarAction(ctx, { id: 'text.duplicate', types: ['text'], title: '复制', apply: 'self', order: 90,
    run: (_input, runCtx) => { text.duplicateTextNode(runCtx.nodeId); return { ok: true } } })
  registerBarAction(ctx, { id: 'text.delete', types: ['text'], title: '删除', apply: 'self', order: 100,
    run: (_input, runCtx) => { ctx.doc.removeNodes([runCtx.nodeId]); return { ok: true } } })
  registerBarApplier(ctx, 'text', (nodeId, result) => { ctx.doc.updateNode(nodeId, { data: { text: result.text ?? '' } }) })
  return true
}
if (!registerBar()) {
  const off = ctx.on('ctx:plugin-installed', () => { if (registerBar()) off.dispose() })
}
```

（`run` 里拿不到组件里的 `props`：节点 id 一律用 `runCtx.nodeId`。）

`inject` **保持不变**（`['doc']`）。文件顶部写
`import { registerBarAction, registerBarApplier, publishToolActions } from '@mini-canvas/plugin-bottom-bar'`
—— 这是**值导入**（不是 `import type`），所以 `package.json` 必须把
`@mini-canvas/plugin-bottom-bar` 放进 **dependencies**（放 devDependencies 会在真正打包/运行时缺件）。
这不违反 T08 依赖方向守卫（那条只拦 `plugin-theme-default`）。

- [ ] **Step 4: 跑测试确认通过**（含 `typecheck` 与 `ui test`）
- [ ] **Step 5: 提交**

```bash
git add packages/plugins/plugin-node-text packages/ui
git commit -m "refactor(node-text): 底部生成栏搬到底栏插件，本包只发布动作与写入器"
```

---

### Task 8: 迁移 image 节点（删 ImageGeneratePanel，写回逻辑变写入器）

**Files:**
- Modify: `packages/plugins/plugin-node-image/src/nodeImagePlugin.ts`
- Delete: `ImageGeneratePanel.vue` / `panelSource.ts` + `__tests__/panelSource.test.ts`
- Modify: `packages/plugins/plugin-node-image/src/imageRun.ts`
- Modify: `__tests__/imageToolbarsRender.test.ts` / `__tests__/imageRun.test.ts` / `__tests__/nodeImageSmoke.test.ts`
- Modify: `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`（image `extraSegments` 去 `out:bottom`）

**Interfaces:**
- Produces: image 底栏动作：① `publishToolActions(ctx, { types:['image'], produces:'image', needsPrompt:true })`；
  ② `image.rotate` / `image.download`（`apply:'self'`，`run` 用 apply 里闭包住的 `createImageOps(ctx)`）。
  写入器 `registerBarApplier(ctx, 'image', (nodeId, result) => writeGeneratedImage(nodeId, result.urls![0], deps, resourceId))`。

- [ ] **Step 1: 改测试（先红）**：`imageToolbarsRender` 删 ImageGeneratePanel 段（保留 ImageTopToolbar）；
  `nodeImageSmoke` 段断言去 `out:bottom`；`imageRun.test.ts` 删 `runImageGeneration` 用例、保留
  `writeGeneratedImage`；`nodePluginsAssembly` image `extraSegments` 去 `'out:bottom'`。
- [ ] **Step 2: 跑测试确认失败**（`plugin-node-image test` + `ui test`）
- [ ] **Step 3: 改插件**

删 `out:bottom` 段与 `ImageGeneratePanel.vue`；`imageRun.ts` 删 `runImageGeneration` **并连同
`buildToolInput` 的 import 一起删**（它只被 `runImageGeneration` 用，见 `imageRun.ts:15,76`；
不要改成值的 redirect，那会把依赖说不清），只留 `writeGeneratedImage` 与 `ImageRunDeps`；
`apply` 按 T7 同一套写法发布动作 + 写入器；`inject` **保持 `['doc']` 不变**；
`package.json` 把 `@mini-canvas/plugin-bottom-bar` 放进 **dependencies**。

- [ ] **Step 4: 跑测试确认通过**（含 `typecheck` 与 `ui test`）
- [ ] **Step 5: 提交**

```bash
git add packages/plugins/plugin-node-image packages/ui
git commit -m "refactor(node-image): 底部生成栏搬到底栏插件，写回逻辑变写入器"
```

---

### Task 9: 迁移 video 节点（剪辑面板改为动作 panel）

**Files:**
- Modify: `packages/plugins/plugin-node-video/src/nodeVideoPlugin.ts` / `src/VideoClipPanel.vue`
- Modify: `__tests__/nodeVideoSmoke.test.ts` / `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`
- Modify: `packages/plugins/plugin-node-video/package.json`（bottom-bar 进 **dependencies**）

**Interfaces:**
- Produces: `video.clip` 动作：`types:['video']`、`panel: VideoClipPanel`、`needsPrompt:false`、
  `onSelect: (id) => beginOverlay(id, 'clip')`、`onDeselect: (id) => endOverlay(id)`、`apply:'self'`；
  以及 `publishToolActions(ctx, { types:['video'], produces:'video', needsPrompt:true })`。
  **`VideoClipPanel.vue` 的显隐门改成 `visible = selected`**（会话态交给 `onSelect/onDeselect`）。
- 顶部操作条（`out:top`）本次不动。

- [ ] **Step 1: 改测试（先红）**：`EXPECTED` 里 video 的 `extraSegments` 去 `out:bottom`。
- [ ] **Step 2: 跑测试确认失败** / **Step 3: 改插件**（按 T7 同一套写法）
- [ ] **Step 4: 跑测试确认通过** / **Step 5: 提交**

```bash
git add packages/plugins/plugin-node-video packages/ui
git commit -m "refactor(node-video): 剪辑面板挂到底栏动作上，不再自占 out:bottom"
```

---

### Task 10: mock 后台插件 + 成品装配 + e2e 验证

**Files:**
- Create: `packages/plugins/plugin-mock-task-backend/`（骨架照 Task 2 模板改名）
- Create: `src/{mockBackend.ts,mockTaskPlugin.ts,index.ts}` / `src/__tests__/mockBackend.test.ts`
- Modify: `packages/ui/src/assembly.ts` / `packages/ui/package.json`
- Modify: `packages/ui/src/__tests__/entrypoint.test.ts`（21 → 23）
- Modify: `packages/ui/e2e/canvas-e2e.mjs`（追加 4 条断言） / `docs/STATUS.md`

**Interfaces:**
- Produces: 假后台（`createTask` → `{taskId}`；`queryTask` → `{status,progress,message,result}`）+
  两条图片动作：`mock-task:sync`（1.2s 后出结果）、`mock-task:async`（0→100 分 10 帧，带
  `taskId` 与 `resume`），都带一个 `fields` 下拉。
- 装配顺序：`pluginBottomBar` 放三个节点插件**之前**，`mockTaskPlugin` 放其后。

- [ ] **Step 1: 写失败测试**（断假后台契约）
- [ ] **Step 2–4: 实现 → 跑绿 → 提交**
- [ ] **Step 5: 装配 + 改 e2e**

`canvas-e2e.mjs` 追加：① 选中 image 节点后 `registryOf('node/region').list('*/out:bottom')` 只有一条，
且底栏里能查到 mock 动作按钮；② 跑异步动作期间卡片上有覆盖层且可见百分比；③ 终态后 localStorage
里该节点 `runState.status === 'done'` 且带 `actionId`；④ `reload` 后覆盖层不悬挂。再起
`pnpm -C packages/ui dev` 人工看一眼观感（辅助证据）。

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

- [ ] **Step 2: 文档同步**：`core-layers-and-registry.md` `4.5 场种类总表补 `node/bar` /
  `node/bar-applier` 两行；`plugins/README.md` 加「怎么注册底栏动作」（含归属规则、组件里
  `ctx.get`、底栏整体换皮 `themeRegistry.add('bottomBar', …)`）。
- [ ] **Step 3: e2e 冒烟**（原 40/40 不回归 + 新增 4 条通过）
- [ ] **Step 4: 提交并交由 finishing-a-development-branch 收尾**

---

## 风险与拆票点

- **`nodeBar` 只读、写走注册方作用域**（`0.3）：这是本计划最易写错的一处；验收 3 的
  「卸载后消失」完全依赖它。
- **工具动作的唯一来源是 `publishToolActions`**（默认皮不自动展开）：避免「generate 动作 +
  N 个工具动作」重复列出。
- **`over:inset` 与编辑浮层同层**：基座恒在下、注册场条目恒在上。
- **`data.runState` 与 mcp-server 撞名**：**有意为之**（同含义同键，云端写的进度前端能直接显示）。
- **mock 动作会覆盖节点真图**：经 image 写入器写 `imageUrl` —— demo 预期行为，写进 `STATUS`。
- **写盘频率**：中间帧 200ms 节流；调大窗口或改判据都要同步更新 `0.4。

### 被删能力 → 去处对照表（实现时逐项打勾）

| 旧能力（现位置） | 去处 | 任务 |
|---|---|---|
| 上游素材收集 `collectUpstreamMaterials` | bottom-bar `panelSource.ts` | T6b |
| @ 引用素材 / 素材行 / 「+ 加素材」 | bottom-bar 提示词编辑器 + `materialCards` | T5 / T6b |
| `buildToolInput` | bottom-bar `panelSource.ts`（image 侧随 `runImageGeneration` 一起删） | T6b / T8 |
| 图片旋转 / 下载 | `image.rotate` / `image.download`（`apply:'self'`，闭包 `createImageOps`） | T8 |
| 图片写回（量尺寸 + 一次 patch） | image 写入器（复用 `writeGeneratedImage`） | T8 |
| 文本字数 / 行数 | 动作的 `info` 回调 | T7 |
| 文本复制 / 删除 | `text.duplicate` / `text.delete`（`apply:'self'`） | T7 |
| 文本输入框直接编辑正文 | `promptBinding: 'text'` | T5 / T7 |
| 视频剪辑时间轴 | `video.clip` 的 `panel` + `onSelect` 开会话 | T9 |
| 工具/模型列表 | `publishToolActions` 发布成动作 | T6c / T7 / T8 / T9 |
