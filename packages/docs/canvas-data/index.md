# 数据层

**一句话定位**：`@mini-canvas/canvas-data` 是画布的**账本** —— 它只管**数据**：有哪些节点、
哪条线连着谁、改了以后能不能撤销、存到哪里去。它**不认识 Vue，也不认识屏幕**。

**它属于哪一块**：四层里的第二层。依赖方向是 `kernel ← canvas-data ← canvas-render ← plugins`，
所以数据层可以用 `@mini-canvas/kernel` 的东西，但**反过来不行** —— 内核不知道"节点"是什么。

## 它是什么

把画布想成一家**小饭馆**：

| 角色 | 对应谁 | 管什么 |
| --- | --- | --- |
| 记账本与冷库 | 数据层 canvas-data（本页） | 谁点了什么菜、菜怎么存 |
| 大厅与装盘 | 渲染层 canvas-render | 把菜端出来、摆好看 |
| 菜单上的新菜 | 插件 | 加功能 |

数据层做四件事：

1. **图模型** —— 节点（`NodeStore`）、连线（`EdgeStore`）、选中（`Selection`）、撤销栈（`History`）。
2. **唯一写入口** —— `GraphDocument` 把"改图"收成一个口：每次写入自动记撤销、自动排队落盘、自动清理失效的选中。
3. **门面** —— `doc` 服务把上面四个收成一个名字，大家只跟它说话。
4. **存储** —— `SaveService` + 可插拔的 `StorageAdapter`（内存 / localStorage / IndexedDB / 云端）。

还有一层"画布语义"也住在本包（源码在 `packages/canvas-data/src/canvas/`）：
节点类型的注册、**十个区域词**、连接规则、建节点工厂、主题槽注册表。它们同样是纯逻辑、零 Vue。

## 为什么需要它

**因为"数据"和"画面"必须能分开换。**

早先画布数据和画面是缠在一起的：改一个节点位置有三条路可走（直接改节点表、走图写入口、走渲染层），
走错一条的表现就是"明明改了，刷新回来还是没有"，或者"能改，但撤销不了"。同一件事有多条路，迟早有人走错。

数据层把这些问题一刀切开：

- **写口只有一个**：`doc` 的写方法全部经 `GraphDocument`，于是"记撤销 + 排队落盘 + 清单选"这三件事
  永远一起发生，插件作者不必记住它们，也**不该**自己去做。
- **能脱离浏览器**：因为零 Vue、零 DOM，整层可以在 Node 里跑单测
  （`packages/canvas-data` 的 `vitest.config.ts` 就是 `environment: 'node'`）。
  想验证"连两条上游会不会被拒"，不用起浏览器。
- **存储是一个开关**：文本与资源都走同一个 `save`，换后端是 `useAdapter` 一行的事，
  业务代码一行不改（云插件就是这么切到服务器的）。

反例，不这么做会怎样：每个插件各自想办法存档 —— 有人改了不落盘、有人删节点不清牵连的线、
有人撤销只退一半。这些不是假想，是项目早期踩过的坑，注释都留在
`packages/canvas-data/src/graphDocument.ts` 的文件头。

## 从哪 import

本包的入口在 `packages/canvas-data/package.json` 的 `exports`：包根（全部符号）+ `./*` 子路径（对应 `src/` 下每个文件）。

~~~ts
// 文件：任意使用数据层的 .ts / .vue
// 格式：TypeScript 模块（import 语句片段）
// 位置：包根入口 —— 全部符号，与 src/ 一一对应
import {
  Context,                    // 画布版上下文（kernel 的 Context + 默认装好的画布能力层）
  createCanvasBasePlugin,     // 建基础插件（本页主角）
  CANVAS_BASE_PLUGIN_NAME,    // 'canvas-base'
  NodeStore, EdgeStore, Selection, History, GraphDocument,
  createDocService,           // 建 doc 门面
  SaveServiceImpl, MemoryStorageAdapter, LocalStorageAdapter,
  createIndexedDbResourceAdapter,
  GRAPH_KEY, GRAPH_EDGES_KEY, GRAPH_VIEWPORT_KEY,
  validateConnection, pickOverflowEvict, typeConnectionDef,   // 连接校验纯函数
  registerNodeType, NodeRegistry, ThemeRegistry,             // 画布注册表
  NODE_REGIONS, assertRegion, nodeRegionStackEntries,        // 区域词
  type DocService, type CanvasBaseAssembly,
} from '@mini-canvas/canvas-data'

// 子路径入口 —— 画布语义层（节点类型 / 区域词 / 连接 / 建节点 / 展示注册表）
import { registerNodeType, validateConnection } from '@mini-canvas/canvas-data/canvas'
~~~

> **写插件的人一般不用直接引这里**：插件只引 `@mini-canvas/canvas-base`（薄入口，重导出内核 + 数据层的
> 类型与常用助手）。直接引 `canvas-data` 的是**宿主**（自己组织装配的人）和**渲染层**（要订阅数据、量尺寸）。

## 服务清单与宿主装配

先分清两件事：

- **服务** = `ctx.get('名字')` 能拿到的能手。本包的基础服务都由 `canvas-base` 这一件基础插件注入。
- **实例** = 对象本身。四个底层件（节点表 / 边表 / 图写入口 / 撤销栈）**还在**，但**不再是服务名**；
  它们挂在装配返回值 `services` 上，渲染层从宿主句柄拿它们。

### `createCanvasBasePlugin` 一次接好的东西

~~~ts
// 文件：packages/canvas-data/src/canvas/canvasBasePlugin.ts
// 格式：TypeScript 模块（工厂的返回形状，摘要）
// 位置：画布语义层的装配入口

const base = createCanvasBasePlugin({ adapter })
base.name      // 'canvas-base'
base.plugin    // PluginModule，交给 ctx.plugin(...)；core: true（拒绝动态热卸）
base.services  // 已建好的 12 件实例（外加条件注入的 settingsPersist）
~~~

| `ctx.get('名字')` | 是什么 | 谁在消费 | 专页 |
| --- | --- | --- | --- |
| `'save'` | 键值持久化（可插拔后端） | 宿主、配置桥、云插件 | [save](/services/save) · [本组 storage](/canvas-data/storage) |
| `'doc'` | **数据那一格唯一的名字**：节点 + 边 + 事务 + 撤销 + 快照 + 订阅 | 几乎每个插件 | [doc](/services/doc) |
| `'resources'` | 资源生命周期（object URL 的登记与回收） | 图片 / 视频 / 音频节点 | [resources](/services/resources) |
| `'nodeRegistry'` | 节点展示注册表（哪个 type 的哪个区域用哪个组件） | 节点插件、渲染宿主 | [nodeRegistry](/services/node-registry) |
| `'themeRegistry'` | 主题槽注册表（壳 / 边 / 背景的当前赢家） | 主题插件、渲染宿主 | [themeRegistry](/services/theme-registry) |
| `'selection'` | 选中集（节点 + 边两桶） | 右键菜单、群组框、删除 | [selection](/services/selection) |
| `'command'` | 命令注册表（菜单 / 快捷键 / 按钮都指向它） | 全部插件 | [command](/services/command) |
| `'nodeFactory'` | 建节点工厂（放一个 X 节点的唯一入口） | 菜单、右键、AI 工具 | [nodeFactory](/services/node-factory) |
| `'settingsPersist'` | 配置落盘桥（**条件注入**：`persistSettings` 为真且 ctx 有 `settings` 才有） | 宿主启动时 `restore()` | [settingsPersist](/services/settings-persist) |

只有 `services` 上才有、**不再是服务名**的四个实例：
`nodeStore`（节点表）、`edgeStore`（边表）、`graph`（图写入口）、`history`（撤销栈）。
渲染层要 `subscribe`、要按 id 反查，才直接拿它们；插件一律走 `doc`。

另有三件不在本包，但画布上一定有，别找错门：

| `ctx.get('名字')` | 谁提供 | 专页 |
| --- | --- | --- |
| `'tools'` | **内核自带**（`new Context()` 就有） | [tools](/services/tools) |
| `'slots'` / `'settings'` | **画布能力层内置**（连 `new Context()` 也有） | [slots](/services/slots) · [settings](/services/settings) |
| `'nodeLayout'` / `'viewport'` / `'pluginManager'` | **渲染宿主**（要量 DOM、要拿 VueFlow 实例） | [nodeLayout](/services/node-layout) · [viewport](/services/viewport) · [pluginManager](/services/plugin-manager) |

### 装配骨架：四步

宿主自己组装（不借渲染层）时，顺序是这样的：

~~~ts
// 文件：我的宿主/src/host.ts
// 格式：TypeScript 模块（宿主装配骨架，逐行可跑）
// 位置：任何"想自己掌控装配"的宿主入口

import { Context, createCanvasBasePlugin, LocalStorageAdapter } from '@mini-canvas/canvas-data'

export async function boot() {
  // ① 建 ctx。画布版的 Context 默认装好画布能力层，
  //    于是 ctx 上本来就有 ctx.nodes / ctx.theme / ctx.commands / ctx.slots / ctx.settings。
  const ctx = new Context({ dev: true })

  // ② 建基础插件。它在**调用时就**把 12 件零件建好（不依赖 ctx），
  //    所以你可以在 start 之前就拿到实例 —— 渲染层要 nodeStore 才能量尺寸，正需要这一点。
  const base = createCanvasBasePlugin({ adapter: new LocalStorageAdapter() })

  // ③ 装基础插件（core: true，拒绝热卸）+ 你自己的业务插件（顺序即装载顺序）
  ctx.plugin(base.plugin)
  // ctx.plugin(myPlugin)

  // ④ 启动：按依赖激活。插件此刻才开始 apply，服务也在此前全部上架。
  await ctx.start()

  // 停机前把脏队列落盘（set 只是入队，真正写由防抖 flush 统一做）
  await base.services.save.flush()
  return { ctx, base }
}
~~~

想一行出画布（含渲染层）就用渲染层的 `createMiniCanvasHost`，它内部就是上面这四步，外加两件渲染层服务：

~~~ts
// 文件：宿主应用/src/main.ts
// 格式：TypeScript 模块（渲染宿主装配，摘要）
// 位置：成品应用启动处
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'

const { host, api, manager } = await createMiniCanvasHost({
  adapter: new LocalStorageAdapter(),
  coldPlugins: [themeDefaultPlugin, nodeTextPlugin],
  dev: import.meta.env.DEV,
})
~~~

**顺序上只有一条硬规矩**：`nodeLayout` / `viewport` 这两个渲染层服务要在 `ctx.plugin(base.plugin)` **之前**
`ctx.inject` 进去。理由很实际 —— 基础插件之后装的业务插件一 `start` 就会 `ctx.get('viewport')`，
晚注入的话它们只能拿到 `undefined`。细节见 [createMiniCanvasHost](/canvas-render/create-host)。

### 基础插件顺手做掉的三件事

装 `canvas-base` 不只是"上架服务"，它的 `apply` 里还做了：

1. **注册四条画布通用命令** —— `command:create-node` / `command:delete` / `command:undo` / `command:redo`
   （命令 id 常量是 `CANVAS_COMMAND`）。所以你不必再装一个"命令插件"才有 Delete 和 Ctrl+Z。
2. **接好落盘** —— `GraphDocument` 的提交回调把节点写 `GRAPH_KEY`、边写 `GRAPH_EDGES_KEY`，两个都在 `'canvas'` 域；
   中间态元素（拖线占位）被滤掉，刷新后不复活。
3. **条件装上配置落盘桥** —— `persistSettings !== false` 且 ctx 有 `settings` 时注入 `settingsPersist`；
   要不要恢复由宿主决定（`await base.services.settingsPersist?.restore()`）。

## 会在哪里用到

| 谁 | 在哪 | 用它干什么 |
| --- | --- | --- |
| 渲染宿主门面 | `packages/canvas-render/src/host/createMiniCanvasHost.ts` | 调 `createCanvasBasePlugin`、注入 `nodeLayout`/`viewport`、装业务插件、恢复存档 |
| 渲染宿主组件 | `packages/canvas-render/src/host/CanvasHost.vue` | `host.graph.connectEdge(...)` 落边、写 `GRAPH_VIEWPORT_KEY` |
| 渲染装配核心 | `packages/canvas-render/src/host/canvasHostCore.ts` | 从 `nodeRegistry` / `themeRegistry` 读整幅画布的外观装配 |
| 文本节点插件 | `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts` | `ctx.nodes.register` 注册类型、`doc` 事务建节点 |
| 云客户端插件 | `packages/plugins/plugin-cloud-client/src/plugin.ts` | `save.useAdapter('canvas' \| 'resource' \| 'config' \| 'shortcut', …)` 整包切云端 |
| 自动保存插件 | `packages/plugins/plugin-auto-save/src/autoSavePlugin.ts` | `doc.subscribe` 置脏 + 周期 `save.flush()` |
| 成品应用装配清单 | `packages/ui/src/assembly.ts` | 声明 `APP_PLUGINS`、给 `createDefaultStorageAdapter()` |

## 完整例子

下面这个小项目做两件事：**只装数据层就把画布跑起来**（没有 Vue、没有屏幕），
以及**用 Node 单测验证"数据层真的能脱离浏览器"**。

同样的文件在仓库里也放了一份，可直接打开对照：
`packages/docs/public/examples/canvas-data/index/plugin-ledger-demo/`。

### 目录树

~~~
plugin-ledger-demo/
├── package.json                  # 清单：包名 / 入口 / miniCanvas 元信息
└── src/
    ├── host.ts                   # 宿主装配：建 ctx → 建基础插件 → 装插件 → start（无渲染）
    ├── ledgerPlugin.ts           # 业务插件：注册一个节点类型 + 两条命令
    └── __tests__/
        └── ledger.test.ts        # Node 单测：不装浏览器也能验完整链路
~~~

### `package.json`（全文）

~~~json
{
  "name": "@mini-canvas/plugin-ledger-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "演示：账本（只数据层）",
    "description": "不装渲染层，把数据层单独跑起来：建节点、连边、撤销、落盘，并有 Node 单测",
    "pluginName": "ledger-demo",
    "installable": true
  },
  "main": "./src/host.ts",
  "types": "./src/host.ts",
  "exports": {
    ".": {
      "types": "./src/host.ts",
      "default": "./src/host.ts"
    },
    "./*": "./src/*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*",
    "@mini-canvas/kernel": "workspace:*"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vitest": "^3.0.0"
  }
}
~~~

### `src/ledgerPlugin.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/index/plugin-ledger-demo/src/ledgerPlugin.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口；这里故意**不注册任何组件**（数据层不认识屏幕）

import type { Context } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'

export const name = 'ledger-demo'
// ① 硬依赖：doc 没就绪，本插件停在 PENDING（而不是跑起来后拿到 undefined）
export const inject = ['doc'] as string[]

export function apply(ctx: Context) {
  const doc = ctx.get<DocService>('doc')

  // ② 注册一个节点类型。in 区域放哪个组件是渲染层的事 ——
  //    纯数据场景只落"数据那一半"：类型名 / 标题 / 默认尺寸 / 连接约束。
  doc.registerType({
    type: 'ledger-entry',
    label: '账目',
    defaultSize: { w: 200, h: 100 },
    nameTemplate: '账目 {{ID}}',
    // 不声明 capacity = 不限条数；这里只收文本类型的上游
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'text' }],
  })

  // ③ 一条命令：记一笔账。写操作包在事务里 —— 一次撤销退掉整批。
  ctx.commands.register({
    id: 'ledger-demo:add-entry',
    title: '记一笔账',
    run: () => {
      doc.transaction('ledger:add-entry', (tx) => {
        const id = tx.createNode('ledger-entry', { x: 0, y: 0 }, { text: '', amount: 0 })
        return id
      })
      return true
    },
  })

  // ④ 一条命令：把账本念出来（读操作不需要事务，也不改任何东西）
  ctx.commands.register({
    id: 'ledger-demo:report',
    title: '账本：念一遍',
    run: () => {
      const rows = doc.getNodes().filter((n) => n.type === 'ledger-entry')
      const edges = doc.getEdges()
      console.log(
        '[ledger-demo] 账目 ' + rows.length + ' 笔，连线 ' + edges.length +
          ' 条，可撤销：' + String(doc.canUndo()) + '，撤销栈深度：' + String(doc.undoDepth),
      )
      return true
    },
  })
}
~~~

**① ② ③ ④ 是什么意思**：

1. `inject = ['doc']` 是硬依赖。写错依赖名（比如老名字 `nodeStore`）会让插件**永远停在 PENDING**，
   这比运行到一半炸掉好查得多。
2. `doc.registerType` 只落"数据那半边"。带 UI 的插件请改用 `ctx.nodes.register({ type, label, size, in, … })`，
   它一次把数据与展示两处都落表 —— 见 [注册节点类型与区域词](/canvas-data/node-types)。
3. `doc.transaction` 把"建节点"包成**一条**撤销记录 —— 想撤销就整条退掉。
4. 读操作（`getNodes` / `getEdges` / `canUndo`）不进历史、不落盘。

### `src/host.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/index/plugin-ledger-demo/src/host.ts
// 格式：TypeScript 模块（宿主装配函数）
// 位置：把"只装数据层"的最小画布跑起来的入口

import { Context, createCanvasBasePlugin, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import type { CanvasBaseAssembly } from '@mini-canvas/canvas-data'
import * as ledgerPlugin from './ledgerPlugin'

/**
 * 建一个**只有数据层**的画布。
 *
 * 这是理解 canvas-data 最快的姿势：没有 Vue、没有 VueFlow、没有屏幕，
 * 但节点、边、撤销、落盘一应俱全 —— 因为那些本来就不需要浏览器。
 *
 * @param adapter 存储后端；缺省给内存后端（测试 / 试跑用）。要真持久化就换
 *                `new LocalStorageAdapter()`（浏览器）或云端适配器。
 */
export async function bootLedger(adapter = new MemoryStorageAdapter()) {
  // ① 建 ctx（画布版默认装好能力层 → ctx.nodes / ctx.theme / ctx.commands / ctx.slots / ctx.settings）
  const ctx = new Context({ dev: true })

  // ② 建基础插件。它在**调用时就**把实例建好：这一步之后
  //    base.services.nodeStore / doc / save … 就能用了（哪怕还没 start）。
  const base: CanvasBaseAssembly = createCanvasBasePlugin({ adapter })

  // ③ 装基础插件 + 业务插件（顺序即装载顺序）
  ctx.plugin(base.plugin)
  ctx.plugin(ledgerPlugin)

  // ④ 启动
  await ctx.start()

  return {
    ctx,
    base,
    /** 停机：先把脏队列落盘，再回收全部插件副作用 */
    async stop() {
      await base.services.save.flush()
      ctx.stop()
    },
  }
}
~~~

### `src/__tests__/ledger.test.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/index/plugin-ledger-demo/src/__tests__/ledger.test.ts
// 格式：TypeScript 测试（vitest，environment: 'node'）
// 位置：证明"数据层脱离浏览器也能完整验证"

import { describe, expect, it } from 'vitest'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import type { DocService } from '@mini-canvas/canvas-data'
import { bootLedger } from '../host'

describe('只装数据层的画布', () => {
  it('建节点、连边、撤销、落盘都能在 Node 里跑', async () => {
    const adapter = new MemoryStorageAdapter()
    const { ctx, base, stop } = await bootLedger(adapter)
    const doc = ctx.get<DocService>('doc')

    // 一次事务：建两个账目 + 连一条边
    const [a, b] = doc.transaction('test:two', (tx) => {
      const x = tx.createNode('ledger-entry', { x: 0, y: 0 })
      const y = tx.createNode('ledger-entry', { x: 240, y: 0 })
      const r = tx.connectEdge({ source: x, target: y })
      expect(r.status).toBe('ok')
      return [x, y]
    })

    // 重复边会被守门人挡下（同一个 canonical 连接只允许一条）
    expect(doc.connectEdge({ source: a!, target: b! }).status).toBe('duplicate')

    expect(doc.getNodes()).toHaveLength(2)
    expect(doc.canUndo()).toBe(true)

    // 一次撤销要能把"两个节点 + 一条边"整批退掉
    doc.undo()
    expect(doc.getNodes()).toHaveLength(0)

    // set 只是入队；flush 之后才真的写到 adapter 上（物理 key 已带 canvas: 前缀）
    await base.services.save.flush()
    await stop()
  })
})
~~~

跑起来：

~~~bash
pnpm -C packages/docs/public/examples/canvas-data/index/plugin-ledger-demo test
~~~

> 这个例子的价值不在代码量，而在**它没有任何浏览器 API**。当你想验证一条规则
> （"这条边到底能不能连""撤销是不是退了一整批"），照着它写一段 Node 测试，比在界面上点半天快得多。

## 自省：一次问清"这台画布装了什么"

`ctx.surface()` 只读、零副作用，随时可调：它回答"有哪些服务、谁注入的、注册场里各有什么"。
展开看 [自省：看清装了什么](/core/self-inspect)。

~~~ts
const s = ctx.surface()
s.services.filter((x) => x.source === 'canvas-base').map((x) => x.name)
// → ['save', 'doc', 'resources', 'nodeRegistry', 'themeRegistry', 'selection', 'command', 'nodeFactory', ...]
~~~

## 常见坑

1. **四个老服务名已经下线。** `ctx.get('nodeStore')` / `'edgeStore'` / `'graph'` / `'history'`
   现在全部返回 `undefined`，四个都并进了 `doc`。
   `ctx.get` 缺服务**不抛错**（它的设计就是"可选依赖"），所以写错名字不会报错 —— 只会安静地给你 `undefined`，
   然后你在某个莫名其妙的地方看到 `Cannot read properties of undefined`。
   硬依赖请一律写成模块顶层的 `export const inject = ['doc']`。

2. **`createCanvasBasePlugin` 的零件在"调用时"就建好，不是 start 时。**
   所以渲染层可以先拿 `base.services.nodeStore` 去建 `nodeLayout`，再 `ctx.plugin(base.plugin)`。
   反过来（先 start 再找实例）也行，但**服务**必须在上架之后才能 `ctx.get` —— 早了插件会停在 PENDING。

3. **数据层不认识渲染，别在这里找 `nodeLayout` / `viewport`。**
   这两个要量 DOM、要拿 VueFlow 实例，只有渲染宿主才有。数据层能告诉你"节点在哪"（`getNode(id).position`），
   但给不了"这个节点在屏幕上有多宽"。

4. **`set` 不入盘，只是排队。**
   `save.set` 同步返回，真正写由防抖 flush 统一做；关页 / 切项目前请 `await save.flush()`。
   谁在什么时候写什么，见 [存储：SaveService 与 Adapter](/canvas-data/storage)。

5. **一个名字只对应一件事：数据那一格叫 `doc`。**
   想加"一类新的可扩展点"，正确做法是往注册场里放（`ctx.registryOf('种类')`），而不是再发明一个服务名。
   界定标准：**"一个能手"是服务（会换实现才做服务），"一张表"是场** —— 见 [注册场](/intro/registries)。
