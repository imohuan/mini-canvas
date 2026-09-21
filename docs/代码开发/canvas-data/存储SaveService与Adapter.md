# 存储：SaveService + StorageAdapter + keys 规则

> 来源：`packages/canvas-data/src/storage/`（`types.ts`、`keys.ts`、`SaveService.ts`、
> `memoryAdapter.ts`、`localStorageAdapter.ts`）、`packages/canvas-data/src/canvas/canvasBasePlugin.ts`、
> `packages/canvas-data/src/settingsPersist.ts`、`packages/canvas-render/src/host/CanvasHost.vue`

数据层的 key-value 持久化：业务只关心 `key / value / type`，物理落点交给**可插拔的 `StorageAdapter`**
（本地 / 云端各自实现，随时能换）。

---

## 1. 核心思路（先讲清）

1. **四类 type**：`config` / `canvas` / `resource` / `shortcut`。业务存东西要指定属于哪一类，四类互不干扰。
2. **key 规范**：裸 key 统一**小写 kebab-case**；存时内核自动加 type 前缀形成物理 key（`canvas:graph`）。
3. **`set` 先入脏队列**（同步返回），实际落盘经**防抖 flush**（不在 `set` 里立刻写）。
4. **每个 type 一个激活 adapter**，默认内存 adapter；可用 `useAdapter` 换 localStorage / 后端。
5. **不靠"卸载才存 / 手动才存"**：业务只负责 `set`，落盘时机由 flush 统一。

---

## 2. SaveService（服务名 `'save'`）

接口在 `packages/canvas-data/src/storage/types.ts:33`：

```ts
interface SaveService {
  set(key: string, value: unknown, type?: SaveType): void          // 入队写（同步返回）；type 默认 'config'
  get<T>(key: string, type?: SaveType): Promise<T | undefined>      // 读
  remove(key: string, type?: SaveType): Promise<void>               // 删
  flush(): Promise<void>                                            // 立即把脏队列落盘
  isDirty(): boolean                                                // 是否有未落盘脏 key
  useAdapter(type: SaveType, adapter: StorageAdapter): void         // 切换某 type 的 adapter
}
type SaveType = 'config' | 'canvas' | 'resource' | 'shortcut'
```

实现类 `SaveServiceImpl`（`storage/SaveService.ts:14`）另有两个不属于接口的方法：

```ts
useAdapterForAll(adapter: StorageAdapter): void   // 所有 type 都切到同一后端（整包迁移）
dispose(): void                                   // 清掉未触发的防抖计时器
```

### 2.1 最小用法

```ts
const save = ctx.get('save')                 // canvas-base 已注入

save.set('graph', nodes, 'canvas')           // 入队写（不同步落盘）
const saved = await save.get<CanvasNode[]>('graph', 'canvas')
await save.remove('graph', 'canvas')
await save.flush()                           // 想立即落盘就调（切项目 / pagehide / 关页兜底）
save.isDirty()                               // 还有没有没落盘的
```

### 2.2 flush 机制

`set` 内部走 `scheduleFlush`：**微任务级防抖** —— 同一事件循环里多次 `set` 合并成一次 flush
（`setTimeout(…, 0)`）。`flush()` 手动立即触发并清掉 timer；它先给脏队列拍快照再清空，
避免落盘期间的并发 `set` 被吞掉。

> ⚠️ **当前已提交实现的已知缺口**：`flush` 里逐个 `adapter.set()` **没有 try/catch** ——
> 某个 key 写失败（典型是浏览器存储配额不足）会让整次 flush 以 rejected Promise 结束，那一条改动会丢。
> 工作区里有一份未提交的补丁把失败项放回脏队列 + `console.warn`，下次 flush 重试；合上之前，
> 依赖持久化可靠性的场景请自己在 `flush()` 外兜一层。

### 2.3 切换 adapter

```ts
import { SaveServiceImpl, LocalStorageAdapter } from '@mini-canvas/canvas-data'
const svc = new SaveServiceImpl()                    // 缺省每 type 都是 MemoryStorageAdapter
svc.useAdapter('canvas', new LocalStorageAdapter())  // 只把 canvas 类切到 localStorage
svc.useAdapterForAll(new LocalStorageAdapter())      // 所有 type 切到同一后端
```

---

## 3. keys 规则（`storage/keys.ts`）

```ts
const SAVE_TYPES: readonly SaveType[] = ['config', 'canvas', 'resource', 'shortcut']

GRAPH_KEY = 'graph'                  // 画布节点图裸 key（type='canvas'）
GRAPH_EDGES_KEY = 'graph-edges'      // 画布边集，独立裸 key（type='canvas'）
GRAPH_VIEWPORT_KEY = 'graph-viewport'// 视口（{ x, y, zoom }），type='canvas'

normalizeKey(key)      // 小写化 + 去首尾空白
scopedKey(type, key)   // = `${type}:${normalizeKey(key)}` —— adapter 真正看到的物理 key
```

```ts
scopedKey('canvas', 'graph')      // 'canvas:graph'
scopedKey('config', ' Theme ')    // 'config:theme'（小写 + 去空白）
```

作用域（比如项目级 pid）由**调用方自己拼进裸 key**：
`save.set('project:p1:theme', v, 'config')` → 物理 key `config:project:p1:theme`。
`normalizeKey` 只做小写 + 去空白，**不转分隔符**，所以请直接传 kebab-case。

> `GRAPH_KEY` 的值历史上是 `CanvasNode[]`，边下沉后也接受 `{ nodes, edges }` 信封形态；
> `GRAPH_EDGES_KEY` 的值是 `CanvasEdge[]`，与它**分存**以兼容旧的节点图数组格式。

---

## 4. StorageAdapter 接口与两个内置实现

```ts
interface StorageAdapter {                     // storage/types.ts:24
  readonly id: string
  readonly capability: StorageAdapterCapability // { list?, transactional?, offline? }
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}
```

同一 type 任一时刻只有一个激活 adapter（换云端 = 整包迁移，不做双写）。adapter 只看到**物理 key**。

### 4.1 MemoryStorageAdapter（默认，测试 / headless 用）

```ts
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
const mem = new MemoryStorageAdapter()
mem.id           // 'memory'
mem.capability   // { list: true, transactional: true, offline: true }
await mem.set('canvas:graph', nodes)
const v = await mem.get('canvas:graph')
await mem.remove('canvas:graph')
mem.clear()      // 测试辅助：清空
```

纯内存、无持久化（进程内存活），value 走 `JSON.stringify` 存取。

### 4.2 LocalStorageAdapter（浏览器本地落点）

```ts
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'
const ls = new LocalStorageAdapter()      // 可传自定义 Storage（测试注入 mock）
ls.available                             // node 环境没 localStorage 时 false
await ls.set('canvas:graph', nodes)
const v = await ls.get('canvas:graph')
await ls.remove('canvas:graph')
```

- `id = 'localStorage'`，capability `{ list: true, transactional: false, offline: true }`。
- value 一律 `JSON.stringify`；`get` 时 `JSON.parse` 失败返回 `undefined`（不抛）。
- `available === false`（Node 环境）时，三个方法静默 no-op。

两个实现**同接口可互换**。

---

## 5. 谁在什么时候写什么（现状）

`canvas-base` 插件把**整图落盘**接在 `doc` 的提交回调上（`canvasBasePlugin.ts`）：

> 下面 `new GraphDocument(nodeStore, edgeStore, …)` 里的 `nodeStore` / `edgeStore` 是**局部变量**
> （`new NodeStore()` / `new EdgeStore()` 的实例），不是 `ctx` 服务名。

```ts
const graph = new GraphDocument(nodeStore, edgeStore, selection, history, (envelope) => {
  // 中间态元素（拖线占位）不落盘：刷新后不该复活
  save.set(GRAPH_KEY, sanitizeTransientResourceUrls(envelope.nodes.filter((n) => !isTransient(n))), 'canvas')
  save.set(GRAPH_EDGES_KEY, envelope.edges.filter((e) => !isTransient(e)), 'canvas')
})
```

其余各处：

| 谁 | 写什么 | key / type |
| --- | --- | --- |
| `canvas-base`（`GraphDocument` 的提交回调） | 节点图 + 边集 | `GRAPH_KEY` / `GRAPH_EDGES_KEY`，`'canvas'` |
| 渲染宿主 `CanvasHost.vue` | 视口 `{ x, y, zoom }` | `GRAPH_VIEWPORT_KEY`，`'canvas'` |
| `settingsPersist` 桥 | 整份配置值快照 | `SETTINGS_SAVE_KEY = 'settings'`，`'config'` |

> `settingsPersist` 是 `canvas-base` 条件注入的服务（`persistSettings !== false` 且 ctx 有 `settings` 时才有）：
> 启动 `restore()` 把上次的值注入 `SettingsStore`，运行期任一配置变更自动并入快照并 `save.set`。
> 于是插件只 `define / set`，恢复与保存由桥代劳。

---

## 6. 装配示例

```ts
import { Context, createCanvasBasePlugin, LocalStorageAdapter } from '@mini-canvas/canvas-data'

const ctx = new Context()
const base = createCanvasBasePlugin({ adapter: new LocalStorageAdapter() })
// 等价于：内部 new SaveServiceImpl() 之后 save.useAdapterForAll(adapter)
ctx.plugin(base.plugin)
await ctx.start()

const save = base.services.save
save.set('graph', base.services.doc.getNodes(), 'canvas')
save.set('graph-edges', base.services.doc.getEdges(), 'canvas')
await save.flush()
```

> 用 `createMiniCanvasHost({ adapter })` 时，`adapter` 就是这么一路传到底层 `SaveServiceImpl` 的。

---

## 7. 坑与速记

1. **`set` 不入盘**：要立刻落盘记得 `flush()`（自动 flush 是 `setTimeout 0` 的防抖合并）。切项目 / `pagehide` / `hidden` 前手动 flush 兜底。
2. **默认 memory adapter**：进程一没就没了；要持久化用 `LocalStorageAdapter`（或换后端）。
3. **每 type 一个激活 adapter**：`useAdapter(type, adapter)` 只切那一类，`useAdapterForAll` 切全部。
4. adapter 只看到**物理 key**（`type:normalizedKey`）；作用域 pid 要自己拼进裸 key。
5. key 传 kebab-case（`normalizeKey` 只小写 + 去空白，**不转分隔符**）。
6. `remove` 先清脏队列里对应项，再删底层。
7. 写失败**目前不会自动重试**（`flush` 未兜异常）—— 见 §2.2 的缺口说明。
8. localStorage 在 Node 里不可用（`available === false`，操作静默 no-op）；测试用 Memory 或注入 mock Storage。
9. 别绕过 `doc` 直接 `save.set('graph', …)` 当"日常写图"用 —— 整图落盘已由 `GraphDocument` 的提交回调接好；手动写只用于"整份覆盖 / 导入 / 迁移"这类场景。
