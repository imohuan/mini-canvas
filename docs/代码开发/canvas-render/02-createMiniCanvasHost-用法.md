# canvas-render 开发手册 · createMiniCanvasHost 完整用法

> 来源：`packages/canvas-render/src/host/createMiniCanvasHost.ts`、`host/pluginManager.ts`，
> 测试 `host/__tests__/createMiniCanvasHost.test.ts`、`host/__tests__/fullchain.test.ts`、`host/__tests__/createMiniCanvasHostPersist.test.ts`。

## 一句话

`createMiniCanvasHost(opts)` 是一个 **工厂**：建 `Context` → 装画布基础插件 `canvas-base`（它自带画布数据与语义服务）→ 补渲染层两件（`nodeLayout` / `viewport`）→ 注册宿主标准能力包 → 按你给的方式冷启动插件 → `start()`。

它 **不 import 任何具体插件**——装什么插件由你决定。返回四样东西：

```ts
{ host, api, manager, exposeToWindow }
```

`host`（宿主句柄，给 Vue/测试读）、`api`（热装插件门面）、`manager`（统一安装句柄）、`exposeToWindow`（把 api 挂到 window）。

它是 `<CanvasHost>` 组件内部的实现基础，也是"非 Vue 环境想操作数据层"的入口。

---

## 传入什么（MiniCanvasOptions）

```ts
interface MiniCanvasOptions {
  adapter?: StorageAdapter              // 存储后端；缺省内存 adapter（刷新即丢）
  coldPlugins?: HostPlugin[]            // 冷启动要装的插件，顺序即装载序
  manifest?: PluginManifest             // 装配清单；与 coldPlugins 二选一，manifest 优先
  nodeRegistry?: NodeRegistry           // 展示注册表实例；缺省内部新建
  themeRegistry?: ThemeRegistry         // 主题注册表实例；缺省内部新建
  seedDefault?: () => CanvasNode[]      // 首次(存储空)生成默认画布
  persistSettings?: boolean             // 是否接入配置持久化桥；缺省 true（内置）
  dev?: boolean                         // 开发态开关，落到 ctx.isDev；缺省 false = 生产语义
}
```

`HostPlugin` = `PluginModule | PluginClassLike`。最常用的是 `PluginModule` 对象：形如 `{ name, inject?, Config?, apply(ctx, config?) }`（如 `nodeTextPlugin`）。也可以传一个 `Service` 子类（类形态插件）。

`dev` 的用途：能力包 `needs` 缺项时 **dev 当场抛错、prod 返回 undefined + warn**。它必须由调用方显式给——库不读打包器全局变量（原因见《03》里 `CanvasHost` 的 `dev` prop 说明）。

---

## 返回什么

**`host: CanvasHostHandle`** —— Vue/宿主拿它去渲染或读服务：

```ts
interface CanvasHostHandle {
  ctx: Context
  save: SaveServiceImpl                 // set/get/flush/isDirty
  doc: DocService                       // 数据唯一门面：节点+边+事务+撤销+快照+订阅
  nodeStore: NodeStore                  // 节点实例（渲染层订阅它）
  edgeStore: EdgeStoreService           // 边实例（渲染层读它画边）
  nodeRegistry: NodeRegistry            // 展示注册表 type→各区域组件
  themeRegistry: ThemeRegistry          // 主题注册表 slot→渲染器
  selection: SelectionService           // 选中（节点桶 + 边桶）
  command: CommandService               // 命令注册表
  history: HistoryService               // 撤销栈
  nodeFactory: NodeFactoryService       // 按 type 建节点
  graph: GraphDocumentService           // 图唯一写入口
  nodeLayout: NodeLayoutService         // 节点实测尺寸 + 绝对坐标（只读）
  viewport: ViewportService             // 视口读写 + 坐标换算
  settingsPersist?: SettingsPersistService  // persistSettings=false 时 undefined
  resources: ResourceService            // objectURL 生命周期
  stop(): void                          // 先 flush 再回收全部插件副作用
}
```

> **别搞混两件事**：`nodeStore` / `edgeStore` / `graph` / `history` 是 `host` 上的**实例字段**（合法，`host.nodeStore.getNodes()` 能跑）；
> 但它们**不再是 ctx 服务名**——拿这些老名去 `ctx.get` 取不到。数据读写统一用 `ctx.get('doc')` 或 `host.doc`。

**`api: MiniCanvasApi`** —— 热装插件门面：

```ts
interface MiniCanvasApi {
  installPlugin(mod: HostPlugin): string          // 热装，返回插件名
  uninstallPlugin(name: string): boolean          // 热卸，返回是否真卸到
  reloadPlugin(name: string, nextMod?: HostPlugin): void  // 先卸旧再装新（HMR 用）
  listPlugins(): string[]                         // 已装业务插件名（不含宿主自有的 canvas-base）
  inspectPlugins(): PluginRuntimeStatus[]         // 只读诊断（含 failed/pending 与缺哪个依赖）
  getContext(): Context
  getRegistry(): NodeRegistry
  getNodeStore(): NodeStore
  getEdgeStore(): EdgeStoreService
  getGraph(): GraphDocumentService
  getHost(): CanvasHostHandle
}
```

**`manager: PluginManager`** —— 统一安装句柄，支持更多来源（懒加载/URL/单文件文本）+ manifest。详见《04 pluginManager》。

**`exposeToWindow(key='MiniCanvas')`** —— 把 `api` 挂到 `globalThis[key]`（浏览器即 `window`）。`host.stop()` 时自动摘除，防旧画布残留。插件包的 HMR 代码正是用它 `window.MiniCanvas.reloadPlugin(...)`。

---

## 最简用法（Node 测试里建宿主 + 放节点）

```ts
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'

async function boot() {
  const { host, api } = await createMiniCanvasHost({
    // 冷启动插件 = 业务节点。画布通用命令（建/删/撤销/重做）由数据层自带，宿主 boot 时默认注册
    coldPlugins: [nodeTextPlugin, nodeImagePlugin],
  })
  return { host, api }
}

const { host } = await boot()

// 直接经插件上架的服务加文本节点 → 返回短 id '1'
const text = host.ctx.get<TextNodeService>('text')
const id = text.addTextNode({ x: 0, y: 0 })          // '1'
text.editText(id, '你好')                             // 改文本并调度落盘

// 读节点数据（host 上的实例字段，合法）
const node = host.nodeStore.getNode(id)!
console.log(node.type)      // 'text'
console.log(node.data.text) // '你好'

await host.save.flush()     // 确保落盘完成
host.stop()                 // 卸载全部副作用
```

> 插件 `apply` 会在启动时把 `text`/`image` 节点类型注册进 `doc` 的类型表（`doc.types`）、把 `in` 区域组件注册进 nodeRegistry、并 `ctx.inject` 出 `text`/`image` 服务。`nodeFactory` 会拿到各 type 的 `create` 实现，所以 `command:create-node` 能用。
> 画布通用命令（`command:create-node` / `command:delete` / `command:undo` / `command:redo`）由 `@mini-canvas/canvas-data` 的 `registerCanvasCommands` 提供，`canvas-base` 插件内部已默认注册，**无需装插件、也不要重复注册**（重复注册会撞 id 抛错）。

---

## 建图 + 命令 + 撤销/重做 + 落盘（全链路）

```ts
import { GRAPH_EDGES_KEY } from '@mini-canvas/canvas-data'
import type { DocService } from '@mini-canvas/canvas-data'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'

const { host } = await createMiniCanvasHost({
  coldPlugins: [nodeTextPlugin, nodeImagePlugin],
})
const text = host.ctx.get<TextNodeService>('text')
// 数据统一门面：节点/边/事务/撤销/快照都在它一处
const doc = host.ctx.get<DocService>('doc')

// 经命令建节点（可撤销）
const createdId = host.command.execute('command:create-node', {
  type: 'text', position: { x: 10, y: 10 },
}) as string            // '1'

// 拉一条边（全路径统一入口：校验 → 满额挤出 → 落边，一条历史）
const a = text.addTextNode({ x: 0, y: 0 })   // '2'
const b = text.addTextNode({ x: 30, y: 30 }) // '3'
doc.connectEdge({ source: a, target: b, type: 'custom' })   // 等价于 host.graph.connectEdge(...)

// 选中 + 删除（删节点连带清边，一次删除一条历史）
host.selection.set([a, b])
host.command.execute('command:delete')

// 撤销全部回来（含边）
host.command.execute('command:undo')

// 手动整图落盘（节点存 'graph'、边独立存 'graph-edges'，作用域 'canvas'）
host.save.set('graph', host.nodeStore.getNodes(), 'canvas')
host.save.set(GRAPH_EDGES_KEY, host.edgeStore.getEdges(), 'canvas')
await host.save.flush()
host.stop()
```

> 正常情况下**不用自己落盘**：`graph` 每次变更后都会经它的 commit 回调把整图 `save.set(...)` 进脏队列，`SaveService` 自带微任务级防抖 `flush`。上面两行只是"手动整图落盘"的写法示例（测试里常用）。

---

## 刷新恢复 & seedDefault

- 节点存 `GRAPH_KEY`（旧存储是 `CanvasNode[]`，新可能是 `{nodes,edges}` 信封），边独立存 `GRAPH_EDGES_KEY`，作用域都是 `'canvas'`。
- 恢复逻辑兼容三种形态：旧数组 / 新信封 / 空；边独立存的那份一律并入。**关键判定：`saved === undefined` 才是"从未保存"**——保存过空数组也必须原样恢复（否则用户删光节点后刷新会重新长出默认 seed）。
- 恢复时还会按节点数据里的 `resourceId` 重建各媒体字段的可用地址（经 `resources` 服务）；资源找不到就把失效地址删掉，避免挂载媒体元素时触发控制台报错。
  这一步在数据层完成（`packages/canvas-data/src/resourceService.ts`），宿主只负责把 `resources` 交给它。
- `seedDefault` 只在"从未保存过"的首次启动跑，返回的节点会被 `nodeStore.replaceAll`。**第二次用同一存储 boot 时会自动恢复，不再跑 seedDefault。**

```ts
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'

const storage = new MemoryStorageAdapter()   // 或 LocalStorageAdapter
const mk = () => createMiniCanvasHost({
  adapter: storage,
  seedDefault: () => [
    { id: '1', type: 'text', position: { x: 160, y: 160 }, data: { text: '双击我' } },
  ],
})

// 第一次：seed 出来并落盘
const { host } = await mk()
await host.save.flush()
host.stop()

// 第二次（模拟刷新页面）：同一存储 → 自动恢复那一个节点
const { host: h2 } = await mk()
console.log(h2.nodeStore.getNode('1')!.data.text) // '双击我'
h2.stop()
```

---

## manifest 冷启动（装配清单）

`manifest` 比 `coldPlugins` 更细：支持 `disabled`（登记但关闭）、per-plugin `config` 覆盖、同 id 换版本覆盖。给了 manifest 则走 `manager.applyManifest`（热装语义），`coldPlugins` 被忽略。

```ts
const { host, manager } = await createMiniCanvasHost({
  manifest: {
    plugins: [
      { id: 'plain', source: plainPlugin },
      { id: 'off', source: somePlugin, disabled: true },      // 跳过不装
      { id: 'theme-default', source: themeDefaultPlugin, config: { edgeColor: '#16a34a' } },
    ],
  },
})
```

`manager.list()` 能看到每个插件带 `config` / `state` / `missingDeps` / `error`。宿主自有的 `canvas-base` 从这份清单里隐去（它是"环境"，不是"应用可装卸的业务插件"）。

---

## 热装 / 热卸 / 热重载

```ts
const { host, api } = await createMiniCanvasHost()

// 热装
api.installPlugin(myPlugin)                 // 依赖满足立即可用
host.ctx.get('demoSvc')                     // 有值

// 热卸：副作用/服务/节点类型注册自动回收
api.uninstallPlugin('demo')                 // true
host.ctx.get('demoSvc')                     // undefined
host.nodeStore.types.has('demo')            // false

// 热重载：先卸旧再装新（同 name 更新实现，用于开发期 HMR）
api.reloadPlugin('demo', newVersionOfPlugin)
```

插件包的 `index.ts` 里写的 HMR 就是这样工作的：源码一改 → vite 触发 `import.meta.hot.accept` → 拿到新模块 → `window.MiniCanvas.reloadPlugin(name, nextModule)`。

> **核心插件不可热卸**：`canvas-base` 声明了 `core: true`，拿它调 `reloadPlugin` 会**明确抛错**（不是静默失败）。`ctx.canUninstall(name)` 可先行判问，返回 `{ ok:false, reason:'core' }`。

---

## 把 api 暴露到 window

```ts
const { exposeToWindow } = await createMiniCanvasHost({ /* ... */ })
exposeToWindow()          // window.MiniCanvas = api
exposeToWindow('Foo')     // window.Foo = api（自定义 key）
```

`<CanvasHost>` 的 `window-key` prop 就是透传这里。

---

## 坑

1. **停用要 `host.stop()`**：它先 `save.flush()` 把脏数据推进落盘流程，再 `ctx.stop()` 回收全部插件副作用，同时清掉 `exposeToWindow` 挂的 API 句柄。组件卸载时记得调（CanvasHost 已在 `onBeforeUnmount` 处理）。
2. **`createMiniCanvasHost` 是 async**：内核 `start()` 是异步装载（依赖扫描多轮），必须 await。
3. **同名插件重装会报错吗？** 分两种情况：
   - `api.installPlugin(mod)` 直通内核 `ctx.installPlugin`，**同名已装会抛 `Duplicate plugin name`**（不会自动卸载，要先 `api.uninstallPlugin(name)` 再装）。
   - `manager.install(source)`（统一安装句柄）则**自带"同名先卸再装"**（换版本/覆盖用 manager 最顺手）。
4. **无 VueFlow**：此工厂返回的是纯宿主，不含 `<VueFlow>`。要让屏幕出画布，用 `<CanvasHost>`（见《03/09》），它是本工厂 + VueFlow 装配 + 上下文提供的合体。
5. **id 是短数字**（'1'、'2'…）。边 id 由 `edgeId(source, target)` 生成 `e-1-2`；带显式端口时会纳入端口（`e-1:source-2:target`），避免同端点不同端口互相覆盖。
6. **数据写入走 `doc` / `graph`，不要直改 `nodeStore`**：直改会绕过历史与落盘调度，导致"改了不刷新"或"撤销不回来"。
