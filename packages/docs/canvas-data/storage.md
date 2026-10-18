# 存储：SaveService 与 Adapter

**一句话定位**：`save` 是画布的**仓库管理员** —— 业务只说"把这份东西记下来、放进哪个抽屉"，
至于仓库在哪（内存 / 浏览器本地 / 服务器）由可插拔的 **Adapter** 决定。

**它属于哪一块**：数据层。源码在 `packages/canvas-data/src/storage/`
（`SaveService.ts` / `types.ts` / `keys.ts` 与三个适配器），服务由 `canvas-base` 注入（服务名 `'save'`）。

## 它是什么

把它想成一个**有四个抽屉的柜子**，外加一个"搬运工"：

| 抽屉（`SaveType`） | 装什么 |
| --- | --- |
| `'config'` | 配置：设置面板里那些值 |
| `'canvas'` | 画布本体：节点图、边、视口 |
| `'shortcut'` | 快捷键那份映射 |
| `'resource'` | **二进制资源**：图片 / 视频 / 音频（这一格特殊，见下） |

四个抽屉互相不干扰：同一个 key 名放在不同抽屉里是两份数据。
物理上，每个抽屉的 key 都会自动加上前缀（`canvas:graph`）—— 这是"抽屉隔离"的实现方式。

**搬运工（Adapter）**是真正干活的那个：它决定"抽屉里的东西放在哪"。
同一时刻每个抽屉只有一个搬运工，换云端就是整包换掉（不做双写）。

### 三件必须记住的设计

1. **`set` 只是排队，不立刻写盘。** 同步返回，真正写由防抖 flush 统一做
   （`setTimeout(…, 0)` 合并同一事件循环里的多次写）。
2. **key 由你给，前缀由它加。** 你传"裸 key"（`'graph'`），它会补成物理 key（`'canvas:graph'`）。
3. **资源那一格不同。** 前三个抽屉存 JSON（`get` / `set` / `remove`），
   资源抽屉存**字节流**（`putResource` / `resolveResource` / `removeResource`）——
   两种接口形状不一样，硬塞进一个会让两边都写废码（资源适配器被迫实现 get/set 再抛错）。

## 为什么需要它

**因为"存哪"和"存什么"必须能分开改。**

真实需求就是这么来的：本地开发用 localStorage，上线要存服务器，还想两台机器看到同一份。
如果业务代码里直接写 `localStorage.setItem(...)`，这三件事就锁死了 —— 换后端要翻遍全部插件。

`save` 把这件事变成一行：

~~~ts
// 云插件在 apply 里做的全部事情，就是换四个抽屉的搬运工：
save.useAdapter('canvas', adapter)                       // 画布本体 → 服务器
save.useAdapter('resource', createCloudResourceAdapter(api, CID))  // 资源 → 画布文件夹
save.useAdapter('config', createCloudKvAdapter({ baseUrl, type: 'config' }))     // 配置 → KV
save.useAdapter('shortcut', createCloudKvAdapter({ baseUrl, type: 'shortcut' })) // 快捷键 → KV
~~~

（上面四行来自 `packages/plugins/plugin-cloud-client/src/plugin.ts`，是真实代码。）

还有两件小事，但都很关键：

- **文本来回换后端要能重读**。云插件把 `config` 切到云端后，本地那份不是真身了 ——
  所以 `save` 提供 `onAdapterChange` 订阅，谁在启动阶段已经读过旧后端，就重读一次。
  没有它，用户会看到"改了设置、服务器上的 settings.json 也在变，刷新却回到旧值"。
- **资源里绝不存 URL**。本地资源每次刷新都会拿到**全新**的 `blob:` 地址，旧的自然作废；
  所以节点里只存**引用**（`resourceId`），显示地址每次现算（`resolveResource`）。

## 怎么用

### `SaveType` 四个抽屉

~~~ts
// 文件：packages/canvas-data/src/storage/types.ts
// 格式：TypeScript 模块（逐字摘录）
// 位置：抽屉名的定义

export type SaveType = 'config' | 'canvas' | 'resource' | 'shortcut'

/** 存储后端能力声明（云端 / 本地差异暴露给上层可感知） */
export interface StorageAdapterCapability {
  /** 是否支持列出全部 key */
  list?: boolean
  /** 是否支持原子 / 事务写 */
  transactional?: boolean
  /** 是否可离线 */
  offline?: boolean
}
~~~

### 方法清单

~~~ts
// 文件：packages/canvas-data/src/storage/types.ts
// 格式：TypeScript 模块（SaveService 接口，逐字摘录）
// 位置：ctx.get('save') 得到的形状

export interface SaveService {
  /** 入队写（同步返回，实际落盘经防抖 flush），type 默认 'config' */
  set(key: string, value: unknown, type?: SaveType): void
  /** 读 */
  get<T>(key: string, type?: SaveType): Promise<T | undefined>
  /** 删 */
  remove(key: string, type?: SaveType): Promise<void>
  /** 立即把脏队列落盘（可挂 hidden / pagehide / 切项目 / 手动） */
  flush(): Promise<void>
  /** 是否有未落盘的脏 key */
  isDirty(): boolean
  /** 切换某 type 的激活 adapter（如 config 从本地切云端） */
  useAdapter(type: SaveType, adapter: StorageAdapter | ResourceAdapter): void
  /** 订阅「某 type 的激活 adapter 被切换」；返回取消句柄 */
  onAdapterChange(cb: (type: SaveType) => void): { dispose(): void }
  /** 取某 type 当前的激活 adapter（只读） */
  adapterOf(type: SaveType): StorageAdapter | ResourceAdapter
}
~~~

实现类 `SaveServiceImpl` 另有两个**不在接口上**的方法（宿主才用得到）：

~~~ts
// 文件：packages/canvas-data/src/storage/SaveService.ts
// 格式：TypeScript 模块（逐字摘录）
// 位置：SaveServiceImpl 的两个额外方法

/** 所有 type 的 adapter 都切到同一后端（整包迁移场景） */
useAdapterForAll(adapter: StorageAdapter | ResourceAdapter): void

/** 释放：清掉未触发的防抖计时器（不再需要自动 flush 时调用） */
dispose(): void
~~~

> `useAdapterForAll` 对资源适配器有特殊处理：资源适配器**只属于 `'resource'` 那一格**
> —— 它没有 `get` / `set` / `remove`，铺到别处会让文本读写全炸。源码里显式挡住了这件事。

### key 规则

~~~ts
// 文件：packages/canvas-data/src/storage/keys.ts
// 格式：TypeScript 模块（逐字摘录，注释也是原文）
// 位置：key 规范的单一来源

export const SAVE_TYPES: readonly SaveType[] = ['config', 'canvas', 'resource', 'shortcut']

/** 画布节点图持久化裸 key（type='canvas'）。值为 CanvasNode[]（历史遗留）或 { nodes, edges } 信封 */
export const GRAPH_KEY = 'graph'
/** 画布边集独立持久化裸 key（type='canvas'）。值 = CanvasEdge[]；与 GRAPH_KEY 分存以兼容旧格式 */
export const GRAPH_EDGES_KEY = 'graph-edges'
/** 画布视口裸 key。值 = { x, y, zoom }；刷新后回到上次停的缩放 / 平移位置 */
export const GRAPH_VIEWPORT_KEY = 'graph-viewport'

/** 小写化 + 去首尾空白（不转分隔符，请直接传 kebab-case） */
export function normalizeKey(key: string): string
/** 生成某 type 作用域下的物理 key（= 存储 adapter 真正看到的 key） */
export function scopedKey(type: SaveType, key: string): string
~~~

~~~ts
scopedKey('canvas', 'graph')      // 'canvas:graph'
scopedKey('config', ' Theme ')    // 'config:theme'（小写 + 去空白）
~~~

作用域（比如多画布的项目 id）由**调用方自己拼进裸 key**：
`save.set('project:p1:theme', v, 'config')` → 物理 key `config:project:p1:theme`。
`normalizeKey` 只做小写 + 去空白，**不转分隔符**。

### `StorageAdapter` 与两个内置实现

~~~ts
// 文件：packages/canvas-data/src/storage/types.ts
// 格式：TypeScript 模块（StorageAdapter，逐字摘录）
// 位置：文本形式的物理落点契约

/**
 * StorageAdapter —— 一类 key 的物理落点。每个 adapter 只管自己的实现。
 * 同一 type 任一时刻只有一个激活 adapter（换云端 = 整包迁移，不做双写）。
 */
export interface StorageAdapter {
  readonly id: string
  readonly capability: StorageAdapterCapability
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}
~~~

| 实现 | `id` | capability | 存在哪 | 什么时候用 |
| --- | --- | --- | --- | --- |
| `MemoryStorageAdapter` | `'memory'` | `{ list: true, transactional: true, offline: true }` | 进程内存（`Map`） | **默认**；测试 / headless 跑全链 |
| `LocalStorageAdapter` | `'localStorage'` | `{ list: true, transactional: false, offline: true }` | 浏览器 localStorage | 浏览器里的默认本地落点 |
| `createIndexedDbResourceAdapter()` | `'indexeddb-resource'` | `{ list: false, transactional: false, offline: true }` | IndexedDB（存 `Blob`） | 本地**资源**后端（工厂函数，Node / SSR 返回 `undefined`） |

前两个：

~~~ts
// 文件：任意使用存储的 .ts
// 格式：TypeScript 模块（两个文本适配器的用法）
// 位置：测试 / 宿主装配

import { MemoryStorageAdapter, LocalStorageAdapter } from '@mini-canvas/canvas-data'

const mem = new MemoryStorageAdapter()
mem.id                        // 'memory'
await mem.set('canvas:graph', [])   // value 走 JSON.stringify
await mem.get('canvas:graph')
await mem.remove('canvas:graph')
mem.clear()                   // 测试辅助：清空

const ls = new LocalStorageAdapter()  // 可传自定义 Storage（测试注入 mock）
ls.available                  // Node 环境里没 localStorage 时为 false（此时三个方法静默 no-op）
~~~

第三个是**资源适配器**（形状完全不同）：

~~~ts
// 文件：packages/canvas-data/src/storage/types.ts
// 格式：TypeScript 模块（ResourceAdapter，逐字摘录）
// 位置：二进制资源的物理落点契约

export interface ResourceAdapter {
  readonly id: string
  readonly capability: StorageAdapterCapability
  /** 存一段二进制，返回**持久引用**（写进节点 data 的 resourceId） */
  putResource(blob: Blob, opts: ResourcePutOptions): Promise<string>
  /** 用持久引用换一个**当前可用的显示地址**；取不到返回 undefined */
  resolveResource(ref: string): Promise<string | undefined>
  /** 删掉一个资源（按持久引用） */
  removeResource(ref: string): Promise<void>
}

/** 判断一个 adapter 是不是资源适配器（有 putResource 即是） */
export function isResourceAdapter(a: unknown): a is ResourceAdapter
~~~

两者的差别一句话：**文本是 JSON，资源是字节流**。

| | 本地资源后端（IndexedDB） | 云端资源后端（`plugin-cloud-client` 的 `cloudResourceAdapter.ts`） |
| --- | --- | --- |
| `putResource` 返回什么 | `res-<n>-<uuid>` 这样的逻辑 id | 逻辑 id `<canvasId>/<hashName>`（**不是 URL**） |
| `resolveResource` 怎么算地址 | 取回字节 → 新建 `objectURL`（并缓存，避免每次漏一个 URL） | 拼 `/api/canvases/<canvasId>/resources/<hashName>`，HEAD 确认存在；迁移期也认旧 URL |
| `removeResource` | 删库里的记录 + 撤销 objectURL | 暂时 no-op（服务端按内容哈希去重，单方面删会删坏别处的引用） |

### 谁在什么时候写什么

这一节从源码里逐条抄出来 —— 想知道"某份数据是谁存进去的"，查这张表：

| 谁 | 写什么 | key / type | 源码位置 |
| --- | --- | --- | --- |
| `canvas-base` 的图提交回调 | 节点图（滤掉中间态元素） | `GRAPH_KEY` / `'canvas'` | `packages/canvas-data/src/canvas/canvasBasePlugin.ts` |
| 同上 | 边集（滤掉中间态元素） | `GRAPH_EDGES_KEY` / `'canvas'` | 同上 |
| 渲染宿主 `CanvasHost.vue` | 视口 `{ x, y, zoom }` | `GRAPH_VIEWPORT_KEY` / `'canvas'` | `packages/canvas-render/src/host/CanvasHost.vue` |
| 配置持久化桥 `settingsPersist` | 整份配置值快照 | `'settings'` / `'config'` | `packages/canvas-data/src/settingsPersist.ts` |
| 快捷键插件 | 重映射表 | `SHORTCUT_SAVE_KEY` / `'shortcut'` | `packages/plugins/plugin-shortcut-manager/src/shortcutRemapEngine.ts` |
| 资源服务 `resources` | 二进制字节（经资源适配器） | `'resource'` 抽屉 | `packages/canvas-data/src/resourceService.ts` |

**画布本体不是你手动存的。** `GraphDocument` 每次提交都会调那个回调，把整图写进 `'canvas'` 抽屉。
你要做的是**别绕过 `doc` 直接写 `save.set('graph', …)`** —— 那会和自动落盘打架。
手动写只用于"整份覆盖 / 导入 / 迁移"这类场景。

### `flush` 的机制与一个已知缺口

`set` 内部走 `scheduleFlush`：**微任务级防抖** —— 同一事件循环里的多次 `set` 合并成一次 flush。
`flush()` 手动立即触发并清掉 timer；它先给脏队列拍快照再清空，避免落盘期间的并发 `set` 被吞掉。

它还做了**串行化**（源码注释里写明了为什么）：

> 之前的写法是并发调用各写各的 —— 定时器那一轮把脏队列快照走了，守卫再调 flush 时队列已空、
> 立刻返回，于是「await flush 完再导航」根本没等到真正的写。导航一发生，那次在飞的请求被打断，
> 改动就丢了（用户实测：编辑后立刻切画布，回来发现没保存）。

现在 `flush` 会先 `await` 上一次在飞的写，再处理新脏数据。**写失败**（典型是浏览器存储配额不足）
那一项会**放回脏队列**并 `console.warn`，下一次 flush 还能重试 —— 不会变成未捕获的 Promise。

### 云端接线思路

云插件（`packages/plugins/plugin-cloud-client/src/plugin.ts`）的做法值得照抄，因为顺序有讲究：

1. **`canvas` 抽屉先换**（之后所有读写才走网络）。
2. **换资源抽屉之前先抓住本地那个**（`save.adapterOf('resource')`）—— 首次上云时要用它把本地已存的字节捞出来传到云端。
   源码注释写着："换完就够不着本地库了 —— 那正是‘本地画布里已有的图，上云后全丢’的成因"。
3. **`config` / `shortcut` 也切云端**（用户要求：云端时配置与快捷键也用云端的，否则换台机器设置全丢）。
4. **装载以云端为准**：服务器上有存档就用服务器的（否则用户看到的是本地那份而不是真身）；
   服务器上什么都没有就反过来，把本地这份推上去（首次上云）。

而"配置切了云端要重读"这件事，由 `settingsPersist` 的 `save.onAdapterChange` 订阅兜住：
新后端有存档就以它为准注入 store；没有存档就把当前值整份推上去（别把云端当空覆盖本地）。

## 会在哪里用到

| 谁 | 在哪 | 用它干什么 |
| --- | --- | --- |
| 基础插件 | `packages/canvas-data/src/canvas/canvasBasePlugin.ts` | 建 `SaveServiceImpl`、`useAdapterForAll(host adapter)`、接图提交回调、装本地资源后端 |
| 渲染宿主门面 | `packages/canvas-render/src/host/createMiniCanvasHost.ts` | 从存档恢复画布（`save.get(GRAPH_KEY, 'canvas')`）、`persistSettings` 桥 |
| 渲染宿主组件 | `packages/canvas-render/src/host/CanvasHost.vue` | 读写视口键、在 hidden / pagehide 时 flush |
| 配置持久化桥 | `packages/canvas-data/src/settingsPersist.ts` | 整份配置快照存 `'config'`、订阅 `onAdapterChange` 重读 |
| 资源服务 | `packages/canvas-data/src/resourceService.ts` | 现取 `save.adapterOf('resource')` —— 不自己攥后端 |
| 自动保存插件 | `packages/plugins/plugin-auto-save/src/autoSavePlugin.ts` | 周期调 `save.flush()` 兜底 |
| 云客户端插件 | `packages/plugins/plugin-cloud-client/src/plugin.ts` | 四个抽屉整体切云端 + 首次上云迁移 |
| 快捷键插件 | `packages/plugins/plugin-shortcut-manager/src/shortcutRemapEngine.ts` | 重映射表存 `'shortcut'` 抽屉 |
| 成品应用 | `packages/ui/src/assembly.ts` | `createDefaultStorageAdapter()` 返回 `LocalStorageAdapter` |

## 完整例子

下面这个小插件做三件事：**把自己的草稿按 'canvas' 抽屉存起来**、**记住用户上次选的面板**、
**换后端时自动重读**。

同样的文件在仓库里也放了一份，可直接打开对照：
`packages/docs/public/examples/canvas-data/storage/plugin-draft-note/`。

> 顺带说一句：仓库里已有一份同主题的例子 `packages/docs/public/examples/save/plugin-remember-panel/`，
> 那是从 `save` 服务视角写的；这里从**数据层的存储栈**视角写，多讲 key 与 adapter。

### 目录树

~~~
plugin-draft-note/
├── package.json           # 清单：包名 / 入口 / miniCanvas 元信息
└── src/
    ├── index.ts           # 插件入口：两条命令（存草稿 / 念草稿）
    ├── draftStore.ts      # 薄封装：裸 key 从哪来、adapter 被换时怎么办
    └── __tests__/
        └── draftStore.test.ts   # Node 单测：两个抽屉互不干扰 + 换后端能重读
~~~

### `package.json`（全文）

~~~json
{
  "name": "@mini-canvas/plugin-draft-note",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "演示：草稿便签",
    "description": "把草稿与面板记忆分别放进 canvas / config 两个抽屉，并演示换后端后重读",
    "pluginName": "draft-note",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
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

### `src/draftStore.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/storage/plugin-draft-note/src/draftStore.ts
// 格式：TypeScript 模块（薄封装：一处管住 key 与换后端重读）
// 位置：插件包里唯一碰 save 的地方

import type { SaveService } from '@mini-canvas/canvas-data'

/** 裸 key 统一小写 kebab —— 前缀由 save 自己加（canvas:draft-note / config:draft-note-panel） */
export const DRAFT_KEY = 'draft-note'
export const PANEL_KEY = 'draft-note-panel'

export interface DraftStore {
  /** 读草稿（'canvas' 抽屉） */
  load(): Promise<string[]>
  /** 存草稿（'canvas' 抽屉）—— 同步入队，落盘由防抖 flush 做 */
  save(lines: string[]): void
  /** 记住上次用的面板名（'config' 抽屉） */
  rememberPanel(name: string): void
  /** 念出上次的面板名 */
  lastPanel(): Promise<string | undefined>
  /** 解除订阅（插件卸载时调） */
  dispose(): void
}

/**
 * 建一个草稿仓。
 *
 * 两个抽屉刻意分开：草稿是**画布内容**（跟画布一起迁移），
 * 面板名是**用户习惯**（跟配置一起迁移）—— 它们该跟着不同的东西走。
 */
export function createDraftStore(save: SaveService, onReload: (lines: string[]) => void): DraftStore {
  const store: DraftStore = {
    async load() {
      const raw = await save.get<string[]>(DRAFT_KEY, 'canvas')
      return Array.isArray(raw) ? raw : []
    },
    save(lines) {
      save.set(DRAFT_KEY, lines, 'canvas')
    },
    rememberPanel(name) {
      save.set(PANEL_KEY, name, 'config')
    },
    async lastPanel() {
      const raw = await save.get<string>(PANEL_KEY, 'config')
      return typeof raw === 'string' ? raw : undefined
    },
    dispose() {
      off.dispose()
    },
  }

  // 换后端（比如云插件把 canvas 切到服务器）后要把新后端里那份读回来，
  // 否则用户看到的是本地旧值。订阅在这里建立，dispose 时解除。
  const off = save.onAdapterChange((type) => {
    if (type !== 'canvas') return
    void store.load().then(onReload)
  })

  return store
}
~~~

### `src/index.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/storage/plugin-draft-note/src/index.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import type { SaveService } from '@mini-canvas/canvas-data'
import { createDraftStore } from './draftStore'

export const name = 'draft-note'
// 硬依赖 save：本插件做的事就是存东西
export const inject = ['save'] as string[]

export function apply(ctx: Context) {
  const save = ctx.get<SaveService>('save')
  let cached: string[] = []
  const store = createDraftStore(save, (lines) => {
    cached = lines
    console.log('[draft-note] 后端换了，重读到 ' + lines.length + ' 行草稿')
  })

  // ① 启动时先把已有草稿读进来（异步：save.get 是 Promise）
  void store.load().then((lines) => {
    cached = lines
    console.log('[draft-note] 启动恢复 ' + lines.length + ' 行草稿')
  })

  // ② 一条命令：把当前草稿追加一行并落盘（记住调 flush，不然关页可能丢）
  ctx.commands.register({
    id: 'draft-note:append',
    title: '草稿：加一行',
    run: () => {
      cached = [...cached, '第 ' + (cached.length + 1) + ' 行']
      store.save(cached)
      store.rememberPanel('main')
      // set 只是入队；这里显式 flush 让"命令一执行就写下去"这件事可见
      void save.flush()
      return true
    },
  })

  // ③ 一条命令：念一遍（读的是内存缓存 + 两个抽屉各读一次对照）
  ctx.commands.register({
    id: 'draft-note:report',
    title: '草稿：念一遍',
    run: async () => {
      const fromCanvas = await store.load()
      const panel = await store.lastPanel()
      console.log('[draft-note] 内存里有 ' + cached.length + ' 行；canvas 抽屉里有 ' + fromCanvas.length + ' 行')
      console.log('[draft-note] 上次的面板：' + String(panel))
      console.log('[draft-note] 现在还有未落盘的脏数据？' + String(save.isDirty()))
      return true
    },
  })

  // ④ 卸载时解除 adapter 订阅（本插件的副作用全随 scope 回收）
  ctx.effect(() => () => store.dispose())
}
~~~

### `src/__tests__/draftStore.test.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/storage/plugin-draft-note/src/__tests__/draftStore.test.ts
// 格式：TypeScript 测试（vitest，environment: 'node'）
// 位置：验证“两个抽屉互不干扰”与“换后端能重读”

import { describe, expect, it, vi } from 'vitest'
import { MemoryStorageAdapter, SaveServiceImpl } from '@mini-canvas/canvas-data'
import { createDraftStore, DRAFT_KEY, PANEL_KEY } from '../draftStore'

describe('draftStore', () => {
  it('草稿进 canvas 抽屉、面板名进 config 抽屉；物理 key 带前缀', async () => {
    const adapter = new MemoryStorageAdapter()
    const save = new SaveServiceImpl(adapter)
    const store = createDraftStore(save, () => {})

    store.save(['a', 'b'])
    store.rememberPanel('panel-x')
    await save.flush()   // set 是入队，flush 才落盘

    // 读回来：两个抽屉各自独立
    expect(await store.load()).toEqual(['a', 'b'])
    expect(await store.lastPanel()).toBe('panel-x')

    // adapter 只看到带前缀的物理 key（这就是“四个抽屉互不干扰”的实现）
    expect(await adapter.get('canvas:' + DRAFT_KEY)).toEqual(['a', 'b'])
    expect(await adapter.get('config:' + PANEL_KEY)).toBe('panel-x')
  })

  it('切到新后端后能重读（onAdapterChange）', async () => {
    const save = new SaveServiceImpl(new MemoryStorageAdapter())
    const onReload = vi.fn()
    const store = createDraftStore(save, onReload)

    // 新后端里已经有一份“服务器上的真身”
    const cloud = new MemoryStorageAdapter()
    await cloud.set('canvas:' + DRAFT_KEY, ['来自云端']) 
    save.useAdapter('canvas', cloud)

    // 订阅是异步触发的：等一个微任务
    await new Promise((r) => setTimeout(r, 0))
    expect(onReload).toHaveBeenCalledWith(['来自云端'])
    store.dispose()
  })
})
~~~

跑起来：

~~~bash
pnpm -C packages/docs/public/examples/canvas-data/storage/plugin-draft-note test
~~~

## 常见坑

1. **`set` 不入盘。** 要立刻写下去得 `await save.flush()`。
   自动 flush 是"微任务级防抖"，所以正常编辑没问题；但**关页 / 切项目 / 导航之前**要显式 flush 兜底 ——
   这正是 `CanvasHost` 在 hidden / pagehide 时做的事。

2. **默认后端是内存。** `new SaveServiceImpl()` 不传参时，四个抽屉都用 `MemoryStorageAdapter` ——
   进程一没就全没了。要持久化必须显式给 `LocalStorageAdapter` 或云端适配器
   （成品应用走 `packages/ui/src/assembly.ts` 的 `createDefaultStorageAdapter()`）。

3. **key 传 "裸 key"。** 前缀（`canvas:`）由 `save` 自己加；你自己加会让 key 变成
   `canvas:canvas:graph` 这种。作用域（多画布 id）要拼进裸 key：`project:p1:theme`。

4. **别把资源适配器铺到别的抽屉。** `useAdapterForAll(resourceAdapter)` 在源码里被显式挡住：
   资源适配器没有 `get` / `set` / `remove`，铺到 `config` 上会让文本读写全炸。

5. **换了后端要重读，否则看到的是旧值。** `useAdapter` **不是**"迁移工具"（它不做双写、也不搬数据），
   它只是换了落点。谁在换之前读过旧后端，就得靠 `onAdapterChange` 重读一次 ——
   云插件 + settingsPersist 就是这么接的。

6. **资源里只存引用，绝不存 URL。** 本地的 `blob:` 地址每次刷新都是新的，存进去下次就失效；
   正确做法是存 `putResource` 返回的持久引用，显示时用 `resolveResource(ref)` 现算。
   这条不变量在 IndexedDB 适配器的文件注释里写着"用户明确要求"。

