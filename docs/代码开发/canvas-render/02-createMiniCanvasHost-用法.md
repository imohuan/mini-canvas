# canvas-render 开发手册 · createMiniCanvasHost 完整用法

> 来源：`packages/canvas-render/src/host/createMiniCanvasHost.ts`、`host/pluginManager.ts`、
> 测试 `host/__tests__/createMiniCanvasHost.test.ts`、`host/__tests__/fullchain.test.ts`。

## 一句话

`createMiniCanvasHost(opts)` 是一个 **工厂**：帮你建好内核 Context、注入全部内核服务、建好 nodeRegistry/themeRegistry、再按你给的方式装载插件。它 **不 import 任何具体插件**——装什么插件由你决定。返回四样东西：`host`（内核宿主，给 Vue/测试渲染）、`api`（热装插件门面）、`manager`（统一安装句柄）、`exposeToWindow`（把 api 挂到 window）。

它是 `<CanvasHost>` 组件内部的实现基础，也是"非 Vue 环境想操作内核"的入口。

---

## 传入什么（MiniCanvasOptions）

```ts
interface MiniCanvasOptions {
  adapter?: StorageAdapter      // 存储后端；缺省内存 adapter（刷新即丢）
  coldPlugins?: HostPlugin[]    // 冷启动要装的插件，顺序即装载序
  manifest?: PluginManifest     // 装配清单；与 coldPlugins 二选一，manifest 优先
  nodeRegistry?: NodeRegistry   // 展示注册表实例；缺省内部新建
  themeRegistry?: ThemeRegistry // 主题注册表实例；缺省内部新建
  seedDefault?: () => CanvasNode[] // 首次(存储空)生成默认画布
}
```

`HostPlugin` = `PluginModule | PluginClassLike`。最常用的是 `PluginModule` 对象：形如 `{ name, inject?, Config?, apply(ctx, config?) }`（如 `nodeTextPlugin`）。也可以传一个 `Service` 子类（cordis 类形态）。

---

## 返回什么

**`host: CanvasHostHandle`** —— Vue/宿主拿它去渲染或读服务：

```ts
interface CanvasHostHandle {
  ctx: Context          // 内核上下文
  save: SaveServiceImpl
  nodeStore: NodeStore
  edgeStore: EdgeStoreService   // 边数据服务（画边读它）
  nodeRegistry: NodeRegistry    // 展示注册表 type→content/...
  themeRegistry: ThemeRegistry  // 主题注册表 slot→渲染器
  selection: SelectionService
  command: CommandService
  history: HistoryService
  nodeFactory: NodeFactoryService
  stop(): void          // 停掉全部插件副作用（先 flush 落盘再 ctx.stop）
}
```

**`api: MiniCanvasApi`** —— 热装插件门面：

```ts
installPlugin(mod)            // 热装，返回插件名
uninstallPlugin(name)         // 热卸，返回是否真卸到
reloadPlugin(name, nextMod?)  // 先卸旧再装新（开发期 HMR 用）
listPlugins(): string[]       // 已装插件名
inspectPlugins(): PluginRuntimeStatus[] // 只读诊断（含 FAILED/PENDING）
getContext() / getRegistry() / getNodeStore() / getEdgeStore() / getHost()
```

**`manager: PluginManager`** —— 统一安装句柄，更多来源（懒加载/URL/单文件文本）+ manifest。详见《04 pluginManager》。

**`exposeToWindow(key='MiniCanvas')`** —— 把 `api` 挂到 `globalThis[key]`（浏览器即 `window`）。插件包的 HMR 代码正是用它 `window.MiniCanvas.reloadPlugin(...)`。

---

## 最简用法（Node 测试里建宿主 + 放节点）

```ts
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'

async function boot() {
  const { host, api } = await createMiniCanvasHost({
    // 冷启动插件 = 主题?不，主题是外观；这里先装业务节点 + 命令
    coldPlugins: [nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin],
  })
  return { host, api }
}

const { host } = await boot()

// 直接经插件上架的服务加文本节点 → 返回短 id '1'
const text = host.ctx.get<TextNodeService>('text')
const id = text.addTextNode({ x: 0, y: 0 })          // '1'
text.editText(id, '你好 v2')                          // 改文本并落盘

// 读内核节点
const node = host.nodeStore.getNode(id)!
console.log(node.type)     // 'text'
console.log(node.data.text) // '你好 v2'

await host.save.flush()    // 确保落盘
host.stop()                // 卸载全部副作用
```

> 这里的插件 `apply` 会在启动时把 `text`/`image` 节点类型注册进 nodeStore、把 content 组件注册进 nodeRegistry、并 `ctx.provide` 出 `text`/`image` 服务。`nodeFactory` 会拿到各 type 的 `create` 实现，所以 `command:create-node` 能用。

---

## 建图 + 命令 + 撤销/重做 + 落盘（全链路）

```ts
import { GRAPH_EDGES_KEY } from '@mini-canvas/canvas-core-v2'  // 边独立持久化的裸 key
import type { TextNodeService } from '@mini-canvas/plugin-node-text'

const { host } = await createMiniCanvasHost({
  coldPlugins: [nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin],
})
const text = host.ctx.get<TextNodeService>('text')   // 取 text 插件上架的服务

// 经命令建节点（可撤销）
const createdId = host.command.execute('command:create-node', {
  type: 'text', position: { x: 10, y: 10 },
}) as string            // '1'

// 拉一条边（写 edgeStore，包进历史 → 可 undo/redo）
const a = text.addTextNode({ x: 0, y: 0 })   // '2'
const b = text.addTextNode({ x: 30, y: 30 }) // '3'
host.history.withRecord(() => {
  host.edgeStore.addEdge({ source: a, target: b, type: 'custom' })
})

// 选中 + 删除（读内核 selection；删节点连带清边，一次删除一条历史）
host.selection.set([a, b])
host.command.execute('command:delete')

// 撤销全部回来（含边）
host.command.execute('command:undo')

// 落盘（节点存 'graph'、边独立存 'graph-edges'）
host.save.set('graph', host.nodeStore.getNodes(), 'canvas')
host.save.set(GRAPH_EDGES_KEY, host.edgeStore.getEdges(), 'canvas')
await host.save.flush()
host.stop()
```

---

## 刷新恢复 & seedDefault

- 节点存在 `GRAPH_KEY`（旧存储是 `CanvasNode[]`，新可能是 `{nodes,edges}` 信封），边独立存 `GRAPH_EDGES_KEY`。
- 恢复逻辑兼容三种形态：旧数组 / 新信封 / 空。
- `seedDefault` 只在"存储为空"的首次启动跑，返回的节点会被 `replaceAll`。**第二次用同一存储 boot 时会自动恢复，不再跑 seedDefault。**

```ts
const storage = new MemoryStorageAdapter() // 或 LocalStorageAdapter
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

`manager.list()` 能看到每个插件带 `config` / `state` / `missingDeps` / `error`。

---

## 热装 / 热卸 / 热重载

```ts
const { host, api } = await createMiniCanvasHost()

// 热装
api.installPlugin(myPlugin)                 // 依赖满足立即可用
host.ctx.get('demoSvc')                     // 有值

// 热卸：副作用/服务/nodeStore type 自动回收
api.uninstallPlugin('demo')                 // true
host.ctx.get('demoSvc')                     // undefined

// 热重载：先卸旧再装新（同 name 更新实现，用于开发期 HMR）
api.reloadPlugin('demo', newVersionOfPlugin)
```

插件包的 `index.ts` 里写的 HMR 就是这样工作的：源码一改 → vite 触发 `import.meta.hot.accept` → 拿到新模块 → `window.MiniCanvas.reloadPlugin(name, nextModule)`。

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

1. **停用要 `host.stop()`**：它先 `save.flush()` 把脏数据进落盘流程，再 `ctx.stop()` 回收全部插件副作用。组件卸载时记得调（CanvasHost 已在 onBeforeUnmount 处理）。
2. **`createMiniCanvasHost` 是 async**：内核 `start()` 是异步装载（依赖扫描多轮），必须 await。
3. **同名插件重装会报错吗？** 分两种情况：
   - `api.installPlugin(mod)` 直通内核 `ctx.installPlugin`，**同名已装会抛 `Duplicate plugin name`**（不会自动卸载，要先 `api.uninstallPlugin(name)` 再装）。
   - `manager.install(source)`（统一安装句柄）则**自带"同名先卸再装"**（`installOne` 里若 `listPlugins()` 含同名先 `uninstallPlugin` 再装新），换版本/覆盖用 manager 最顺手。
4. **无 VueFlow**：此工厂返回的是纯内核宿主，不含 `<VueFlow>`。要让屏幕出画布，用 `<CanvasHost>`（见《03/09》），它是本工厂 + VueFlow 装配 + 令牌提供的合体。
5. **id 是短数字**（'1'、'2'…），不是 v1 那种长字符串。边 id 由 `edgeId(source,target)` 生成 `e-1-2`。
