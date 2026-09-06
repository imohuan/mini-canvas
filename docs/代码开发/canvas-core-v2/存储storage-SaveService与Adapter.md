# 存储 storage：SaveService + StorageAdapter（localStorage / memory）+ keys 规则

> 来源：packages/canvas-core-v2/src/services/storage/SaveService.ts、types.ts、keys.ts、localStorageAdapter.ts、memoryAdapter.ts、services/index.ts

内核的 key-value 持久化层：业务只关心 `key/value/type`，物理落点交给**可插拔的 StorageAdapter**（本地 / 云端各自实现，随时能换）。

---

## 1. 核心思路（先讲清）

1. **四类 type**：`config` / `canvas` / `resource` / `shortcut`。业务存东西要指定是哪一类，四类互不干扰。
2. **key 规范**：裸 key 统一**小写 kebab-case**、带作用域前缀；存时内核自动加 type 前缀形成物理 key。
3. **set 先入脏队列**（同步返回），实际落盘经**防抖 flush**（不在 set 里立刻写）。
4. **每 type 一个激活 adapter**，默认内存 adapter；可用 `useAdapter` 换 localStorage/backend。
5. **绝不"卸载才存/手动才存"**：业务只负责 set，落盘时机由 flush 统一。

---

## 2. SaveService（ctx 服务名 'save'）

`SaveService` 接口（services/storage/types.ts）：

```ts
interface SaveService {
  set(key: string, value: unknown, type?: SaveType): void   // 入队写（同步返回），type 默认 'config'
  get<T>(key: string, type?: SaveType): Promise<T | undefined>   // 读
  remove(key: string, type?: SaveType): Promise<void>       // 删
  flush(): Promise<void>                                     // 立即把脏队列落盘
  isDirty(): boolean                                         // 是否有未落盘脏 key
  useAdapter(type: SaveType, adapter: StorageAdapter): void  // 切换某 type 的 adapter
}
```

### 2.1 最小用法

```ts
const save = ctx.get('save')     // 宿主注入 SaveServiceImpl

save.set('graph', nodes, 'canvas')          // 入队写（不同步落盘）
const saved = await save.get<CanvasNode[]>('graph', 'canvas')
await save.remove('graph', 'canvas')
await save.flush()                          // 想立即落盘就调（挂 hidden/pagehide/切项目也调）
```

### 2.2 flush 机制

`set` 内部 `scheduleFlush`：**微任务级防抖**——同一事件循环多次 set 合并一次 flush（setTimeout 0）。`flush()` 手动立即触发并清 timer。切项目/页面隐藏/关闭前记得手动 `flush()` 兜底。

### 2.3 切换 adapter

```ts
const svc = new SaveServiceImpl()                 // 默认每 type 都是 memory
svc.useAdapter('canvas', new LocalStorageAdapter())  // canvas 类切到 localStorage
svc.useAdapterForAll(new LocalStorageAdapter())    // 所有 type 都切到同一后端（整包迁移）
```

---

## 3. keys 规则

`keys.ts` 导出常量与函数：

```ts
const SAVE_TYPES = ['config', 'canvas', 'resource', 'shortcut']  // 四类枚举
const GRAPH_KEY = 'graph'        // 画布节点图持久化裸 key（type='canvas'）
const GRAPH_EDGES_KEY = 'graph-edges'  // 画布边集独立裸 key（type='canvas'）

normalizeKey(key)    // 小写化 + 去首尾空白
scopedKey(type, key) // = `${type}:${normalizeKey(key)}`，adapter 真正看到的物理 key
```

```ts
scopedKey('canvas', 'graph')        // 'canvas:graph'
scopedKey('config', ' theme ')      // 'config:theme'（小写+去空白）
```

作用域（如项目级 pid）由调用方拼进裸 key：`save.set('project:p1:theme', v, 'config')` → 物理 `config:project:p1:theme`。`normalizeKey` 不转分隔符，请直接传 kebab-case key。

> GRAPH_KEY 的值是 `CanvasNode[]`（历史遗留）或 `{ nodes, edges }` 信封（边下沉后用）；GRAPH_EDGES_KEY 的值 = `CanvasEdge[]`，与 GRAPH_KEY 分存以兼容旧节点图数组。

---

## 4. StorageAdapter 接口 & 两个内置实现

```ts
interface StorageAdapter {
  readonly id: string
  readonly capability: StorageAdapterCapability   // { list?, transactional?, offline? }
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}
```

### 4.1 MemoryStorageAdapter（默认，测试/headless 用）

```ts
import { MemoryStorageAdapter } from '@mini-canvas/canvas-core-v2'
const mem = new MemoryStorageAdapter()
mem.id               // 'memory'
mem.capability       // { list:true, transactional:true, offline:true }
await mem.set('canvas:graph', nodes)
const v = await mem.get('canvas:graph')
await mem.remove('canvas:graph')
mem.clear()          // 测试辅助：清空
```
纯内存、无持久化（进程内存活），行为模拟 localStorage。

### 4.2 LocalStorageAdapter（浏览器本地落点）

```ts
import { LocalStorageAdapter } from '@mini-canvas/canvas-core-v2'
const ls = new LocalStorageAdapter()    // 可传自定义 Storage（测试注入 mock）
ls.available          // node 环境没 localStorage 时为 false
await ls.set('canvas:graph', nodes)     // JSON 序列化存
const v = await ls.get('canvas:graph')
await ls.remove('canvas:graph')
```
- `id='localStorage'`，capability `{ list:true, transactional:false, offline:true }`。
- value 一律 `JSON.stringify` 存储。key 已由 SaveService 带 type 前缀。

两个实现**同接口可互换**（本地/云端可插拔）。SaveService 实现类是 `SaveServiceImpl`（services/index 导出 `SaveServiceImpl`）。

---

## 5. 如何注入 & 装配示例

```ts
import { SaveServiceImpl, LocalStorageAdapter } from '@mini-canvas/canvas-core-v2'

const ctx = new Context()
const save = new SaveServiceImpl(new LocalStorageAdapter())  // 默认 local 落点
ctx.inject('save', save)
await ctx.start()

// 存节点图
const graphKey = 'graph'
save.set(graphKey, nodeStore.getNodes(), 'canvas')
save.set(GRAPH_EDGES_KEY, edgeStore.getEdges(), 'canvas')
await save.flush()
```

---

## 6. 坑与速记

1. **set 不入盘**：要落盘记得 `flush()`（防抖合并）；挂 pagehide/hidden/切项目前 flush。
2. **默认 memory adapter**，进程一没就没了；想持久化用 `LocalStorageAdapter`（或换后端）。
3. 每个 type 一个激活 adapter；`useAdapter(type, adapter)` 只切那一类，`useAdapterForAll` 切全部。
4. adapter 只看到**物理 key**（`type:normalizedKey`）；作用域 pid 要你自己拼进裸 key。
5. key 请传 kebab-case（`normalizeKey` 只小写+去空白，不转分隔符）。
6. `remove` 同步会清脏队列里对应项再删底层。
7. localStorage 在 node 里不可用（`available=false`，操作静默 no-op）；测试用 Memory 或 mock Storage。
