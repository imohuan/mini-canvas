# @mini-canvas/kernel 开发手册 · 总览与快速上手

> 来源：`packages/kernel/src/index.ts`（包出口）、`packages/kernel/src/Context.ts`、`packages/kernel/src/types.ts`、`packages/kernel/src/capabilityLayer.ts`。

这份手册给**写插件的人 / 用内核的人**看。先搞懂内核是什么、怎么把插件装上去跑起来，后面每一篇再讲具体功能。

---

## 1. 内核是什么（一句话）

`@mini-canvas/kernel` 是一个**纯 TypeScript 的插件框架**。它只干三件事：

1. **装插件**：谁依赖谁、谁先启动、卸载时清什么。
2. **发消息**：类型化事件（`ctx.on` / `ctx.emit`）。
3. **回收**：插件注册的一切东西，卸载时自动清光。

它**不认识画布**：包里没有 node、edge、theme 这些字眼，也不依赖 Vue、不依赖 DOM，所以能在 Node 里直接跑单测。

画布能力（`ctx.nodes` 这些）由**能力层**从外面装进来，画布那一层就是 `@mini-canvas/canvas-data`。

> 打个比方：内核是"乐高底盘 + 说明书"，插件是插上去的积木，宿主（浏览器里的画布页面）是拼出来的城堡。

### 1.1 五个包谁是谁

| 包 | 职责 | 依赖 |
|---|---|---|
| `@mini-canvas/kernel` | 纯插件框架（装载 / 依赖 / 事件 / 回收 / 注册场） | 不依赖任何 `@mini-canvas/*` |
| `@mini-canvas/canvas-data` | 数据层 + 画布语义（节点/边/事务/选中/存储 + `ctx.nodes/theme/commands/slots/settings`） | kernel |
| `@mini-canvas/canvas-render` | 渲染宿主（把内核接到 Vue + VueFlow 上） | canvas-data |
| `@mini-canvas/canvas-base` | 插件作者薄入口（重导出 kernel / canvas-data 的类型，加 `define*` 助手） | kernel + canvas-data |
| `@mini-canvas/ui` | 成品应用出口（一行 `mountCanvasApp` 起动） | canvas-render + 各插件 |

依赖方向**单向**：`kernel ← canvas-data ← canvas-render ← plugins`。

> ⚠️ 仓库根目录的 `src/` 与 `packages/canvas-core` 是**已停用的 v1**，不要照它写代码。

---

## 2. 核心流程（三步曲）

```ts
import { Context } from '@mini-canvas/kernel'

// 1) 建一个上下文（纯插件内核）
const ctx = new Context()

// 2) 把插件装上去（可以装很多个）
ctx.plugin({
  name: 'hello',
  apply() {
    console.log('我是 hello 插件，start 时我会被跑')
  },
})

// 3) 启动：按依赖把每个插件跑起来
await ctx.start() // 打印“我是 hello 插件……”
```

跑完想整体停掉，调 `ctx.stop()`：它倒着把每个插件的副作用清干净，之后还能再 `plugin` + `start` 重来。

> **注意**：`@mini-canvas/kernel` 的 `Context` 是纯插件内核，**没有** `ctx.nodes` 这些画布段。
> 要带画布能力，用 `@mini-canvas/canvas-data` 导出的 `Context`（它默认装上画布能力层，构造参数一样）。

插件模块长什么样，看下面一节。

---

## 3. 三种插件写法（后面有专篇）

不管怎么写，内核内部都会先**归一成同一种对象** `PluginModule` 再处理：

| 写法 | 长什么样 | 一句话 |
| --- | --- | --- |
| **对象形态（推荐）** | `{ name, inject, Config, apply }` | 最常用，本手册主推 |
| **类形态（Service）** | `class X extends Service` | 类本身就是插件，`new` 时顺手上架一个服务 |
| **函数形态** | 一个**具名**函数 | 函数名就是插件名，函数体当 `apply(ctx, config)` 调 |

```ts
import { Context, Service, type PluginScope } from '@mini-canvas/kernel'

// —— 写法一：对象形态 ——
const objPlugin = {
  name: 'a',
  apply(c: PluginScope) { c.emit('my:event') },
}

// —— 写法二：类形态（Service 子类）——
class Greeter extends Service {
  constructor(c: PluginScope) { super(c, 'greeter') } // 顺手上架服务名 'greeter'
  greet(who: string) { return `Hello, ${who}` }
}

// —— 写法三：函数形态（必须具名，匿名函数会抛错）——
function heartbeat(c: PluginScope) { c.on('ping', () => console.log('pong')) }

const ctx = new Context()
ctx.plugin(objPlugin)
ctx.plugin(Greeter) // 直接传类
ctx.plugin(heartbeat) // 直接传函数
await ctx.start()
```

---

## 4. 装 / 卸插件的两个时机

| 操作 | 方法 | 只能用在哪 | 说明 |
| --- | --- | --- | --- |
| 冷启动装载 | `ctx.plugin(mod, config?)` | `start()` **之前** | 只登记，等 `start()` 一起跑 |
| 启动 | `await ctx.start()` | 状态为 `created` | 按依赖多轮激活 |
| 停机 | `ctx.stop()` / `await ctx.stopAsync()` | 状态为 `started` | 倒序清光，可重新 start |
| 运行中热装 | `ctx.installPlugin(mod, config?)` | `start()` **之后** | 依赖满足立刻可用，否则挂着等 |
| 运行中热卸 | `ctx.uninstallPlugin(name): boolean` | `start()` 之后 | 清光副作用，返回是否真卸到 |

```ts
const ctx = new Context()
await ctx.start() // 先空内核启动
ctx.installPlugin({ name: 'hot', apply() {} }) // 运行中热装
ctx.uninstallPlugin('hot') // 运行中热卸
```

> 时机用错会直接抛错，错误信息会说明"期望哪个状态"。

---

## 5. 插件拿到的 `ctx` 是什么

每个插件在 `apply(ctx)` / `setup(ctx)` 里拿到的是 **`PluginScope`**（能力视图）。它有两拨东西：

**a) 框架基础能力**：

| 成员 | 干什么 |
| --- | --- |
| `ctx.on` / `once` / `emit` / `parallel` / `serial` / `bail` / `waterfall` | 事件监听与五种分发 |
| `ctx.effect(fn)` | 包住"创建了就要清理的东西"，自动回收 |
| `ctx.inject(name, impl)` / `ctx.provide(name, impl)` | 上架一个服务（两者等价，自动回收） |
| `ctx.get(name)` | 按名取服务；缺了返回 `undefined`（不抛） |
| `ctx.plugin(mod)` | 装子插件（运行中会自动转成热装） |
| `ctx.registryOf(kind)` | 取某"种类"的注册场 |
| `ctx.state(initial)` | 插件私有状态，`{ value }`，不占服务名 |
| `ctx.isDev` | 是否开发态（只读布尔） |
| `ctx.surface()` | 自省快照：一次列出这台内核上注册了什么 |
| `ctx.canUninstall(name)` | 卸载前先问"能不能卸"（只读） |
| `ctx.registry` | 插件运行态只读视图（诊断用） |

**b) 能力层产出的能力段**（自动回收，作者不用手写 uninstall）。在画布内核上就是：

- `ctx.nodes.register(...)` —— 注册一种节点
- `ctx.theme.register(...)` / `ctx.theme.add(...)` —— 往主题槽换肤 / 叠一层
- `ctx.commands.register(...)` —— 注册命令
- `ctx.slots.register(...)` —— 往通用 UI 槽叠东西
- `ctx.settings` —— 读 / 改 / 订阅本插件装配好的配置

```ts
ctx.plugin({
  name: 'demo',
  apply(c) {
    // 这些副作用都不用手动清，插件卸载自动回收
    c.on('some/event', () => {})
    c.effect(() => () => console.log('插件被清理了'))
    c.nodes.register({ type: 'x', label: 'X', size: { w: 100, h: 80 } })
  },
})
```

> **关键点**：`on` / `effect` / `inject` / 各种 `register` / `attach` 都是"建立了东西"的调用，会自动登记进这个插件自己的回收袋；
> `get` / `emit` 是读操作和广播，不登记。

---

## 6. 三根轴：装载 / 服务 / 注册

内核的扩展点归成三根轴，别搞混：

| 轴 | 往里放 | 读出来 | 什么时候用 |
| --- | --- | --- | --- |
| **装载** | `ctx.plugin(mod)`（根 ctx 上还有 `ctx.installPlugin(mod)`） | `ctx.registry`；根 ctx 上另有 `ctx.inspectPlugins()` | 装 / 卸 / 热重载一整块功能 |
| **服务** | `ctx.inject(name, impl)` / `ctx.provide(name, impl)` | `ctx.get(name)` | 按**名字取一个对象**（有状态、有方法） |
| **注册** | `ctx.registryOf(kind).add(key, value)` | `ctx.registryOf(kind).list/top/resolve` | 按**种类放一串条目**（一张表） |

一句话判据：**按名取一个能手 = 服务；按种类放一串东西 = 注册场。**

> **最常见的错误**：每加一个新功能就新增一个服务。
> 正确做法是往注册场里 `ctx.registryOf('新种类').add(...)` —— 不占服务名，还自带叠层 / 替换 / 回收 / 诊断。

**自省**：`ctx.surface()` 一次把三根轴读出来（只读、零副作用，随时可调）：

```ts
const s = ctx.surface()
s.state // 内核状态（ContextState：created / started；类型里还有个 stopped，实现里不产生）
s.services // [{ name, source, methods? }] —— 能 ctx.get 什么、谁放的
s.registries // [{ kind, keys: [{ key, count }] }] —— 每个场有哪些键、几条
s.registryEntries // [{ kind, key, id, order, source, fields? }] —— 每条谁放的、值有哪些字段
s.commands // [{ id, title, keys, areas, group, origin }]
s.tools // 生成工具（ctx.tools）+ 声明式参数
s.modelTools // 模型可调用工具（tool 场）
s.events // 已登记的事件名（能 ctx.on 监听什么）
```

### 6.1 注册场怎么用（`ctx.registryOf`）

这是"新增一类扩展点"的正规做法 —— **不是新增一个服务**：

```ts
// 放一条（同 id 再放 = 替换那条）；source 自动记成本插件名
ctx.registryOf<MyThing>('我的种类').add('某个键', value, { id: 'me', order: 0 })

// 读
const reg = ctx.registryOf<MyThing>('我的种类')
reg.list('某个键') // 按 order 升序（order 小者在外）= 整摞
reg.top('某个键') // order 最小者（“谁盖住了谁”的答案）
reg.keys() // 这个场里有哪些键

// 叠加：wrap 收到下面那层，返回新的值；resolve 给出从里到外套完的结果
reg.wrap('某个键', (inner) => wrapIt(inner), { id: 'decorate' })
reg.resolve('某个键', 兜底值) // 空键则返回兜底值

// 变了通知我（渲染侧重绘 / 面板刷新）
reg.subscribe(() => redraw())
```

**三个要点**：

1. **同一个 kind 全内核只有一张表**：别的插件放的东西你看得见，你放的别人也看得见（"在别人放的东西上继续包"就靠这个）。
   你拿到的视图只多两件事：写进条目的 `source` = 你的插件名，以及你放的东西**随你卸载自动回收**。
2. **`ctx.registry` 是另一回事**：那是插件运行态诊断（`Map<插件名, { status, fiber }>`），跟注册场无关，名字别改。
3. 画布上在用的 kind：`command` / `node/type` / `node/shell` / `node/creator` / `node/region` / `theme` / `slot` / `setting` / `ui` / `capability` / `tool`
   （权威清单见 `docs/design/core-layers-and-registry.md` §4.5）。

---

## 7. 内核内置事件（启动 / 装 / 卸时自动广播）

| 事件名 | 参数 | 何时触发 |
| --- | --- | --- |
| `ctx:ready` | `{ plugins: string[] }` | `start()` 把能激活的插件全激活完后 |
| `ctx:plugin-installed` | `{ name: string }` | 某插件成功激活 |
| `ctx:plugin-uninstalled` | `{ name: string }` | 某插件卸载完成 |
| `ctx:lifecycle-change` | `{ name: string; lifecycle: Lifecycle }` | 某插件生命周期状态变化 |

```ts
ctx.on('ctx:ready', ({ plugins }) => console.log('就绪，已激活插件：', plugins))
```

**开发态下还有一个硬约束**：`emit` 一个没登记过的事件名会 `console.warn`。生成工具那三条内置事件已经登记好了；
你自己新造的事件名要先 `registerEventName(name)`（或写进 `Events` 类型）。详见《事件篇》。

---

## 8. 服务名速查（`ctx.get`）

**内核自带，恒在**：

| 服务名 | 是什么 |
| --- | --- |
| `tools` | 生成工具注册表（文生图 / 图生文等外部能力，按名调用） |

**画布内核（装了画布能力层）额外有**：

| 服务名 | 谁提供 | 是什么 |
| --- | --- | --- |
| `slots` / `settings` | 能力层内置 | 通用 UI 槽容器 / 配置单一数据源 |
| `doc` | canvas-data | **数据唯一门面**：节点 + 边 + 事务 + 撤销 + 快照落盘 + 订阅 |
| `save` | canvas-data | 存储适配器 |
| `resources` | canvas-data | Blob / objectURL 生命周期 |
| `nodeRegistry` / `themeRegistry` | canvas-data | 节点展示段 / 主题槽注册表 |
| `selection` | canvas-data | 选中态 |
| `command` | canvas-data | 命令注册表 |
| `nodeFactory` | canvas-data | 建某类型节点的实现表 |
| `nodeLayout` / `viewport` | canvas-render 宿主 | 节点几何只读 / 视口读写 |
| `settingsPersist` | canvas-data（条件注入） | 配置落盘桥 |

`ctx.get(name)` 取服务；缺服务返回 `undefined`（不抛），适合做可选依赖探测。

> ⚠️ 老服务名 `nodeStore` / `edgeStore` / `graph` / `history` **已全部下线**（`ctx.get` 取不到，返回 `undefined`）——
> 它们合并成了 `doc` 一个门面。那几个**类**还在（由 canvas-base 建好后交给 `doc` 持有），但**它们不是服务名**。
> 写 `inject: ['nodeStore']` 会让插件**永久停在 PENDING**，这是最容易踩的坑。

---

## 9. `ctx.isDev` 从哪来

`ctx.isDev` 只认**构造时显式传的** `dev`：

```ts
const ctx = new Context({ dev: true }) // 内核侧
```

宿主侧是 `MiniCanvasOptions.dev` / `<CanvasHost :dev="...">`；`packages/ui` 的 `App.vue` 显式传 `import.meta.env.DEV`。

> **库内自己读 `import.meta.env` 不可靠**：vite 的环境替换只作用于应用包自身的源码，workspace 包（如 canvas-render 的 `.vue`）
> 拿不到替换，读出来是 `undefined`，dev 判定会静默失效。所以库侧缺省 `false` = 生产语义。

---

## 10. 坑与速记

1. `ctx.plugin` 只能在 `start()` 前用；`installPlugin` 只能在 `start()` 后；用错直接抛错。
2. 插件名全局唯一，重名抛 `Duplicate plugin name`。
3. 插件 `apply` 里抛错 → 该插件置 FAILED，错误往上抛（`start()` / `installPlugin()` 会 reject / throw）；半成品副作用已回收，可重装同名插件。
4. 只写 `deps`（老写法）没写 `inject` 也能用；**两者都有时 `inject` 优先**。
5. 写 `setup(ctx)`（老写法）或 `apply(ctx, config)`（推荐）都行，**`apply` 优先**。返回值（cleanup 函数或带 `dispose()` 的对象）会被登记，卸载自动跑。
6. **插件 ctx 是个 Proxy**：属性读先看"真实成员"，没有再当服务名去查表（查不到返回 `undefined`，不抛错）。
   对新写法 `declare module '@mini-canvas/kernel' { interface Context { ... } }` 补出来的服务类型，运行时靠这个 Proxy 提供。
   内核自己新增 `ctx` 成员时，必须**显式挂到真实对象上**（`ctx.registryOf` / `ctx.state` / `ctx.isDev` / `ctx.surface` 都挂好了）；
   漏挂不会报错，插件里只会静默拿到 `undefined` —— 所以新增成员要补一条"挂没挂上"的测试。

---

## 11. 从这里往哪看

| 你想干嘛 | 去读哪篇 |
| --- | --- |
| 插件怎么写、生命周期、热装热卸 | `插件形态与生命周期.md` |
| 为什么 on / effect 不用手动清 | `Scope副作用自动回收.md` |
| 插件状态怎么查、卡住怎么诊断 | `Fiber状态机与诊断.md` |
| 服务注入 / 类形态 Service | `服务注入get-inject-provide与Service基类.md` |
| 事件 on / emit 及五种分发 | `类型化事件on-once-emit-分发模式.md` |
| 只想单独用一个事件总线 | `EventBus独立事件总线组件.md` |
| 依赖排序 | `依赖拓扑排序topoSort-depsOf.md` |
| 配置 Config / settings | `配置装配configSchema与ctx-settings.md` |
| 注册节点类型 | `../canvas-data/注册节点类型ctx-nodes与registerNodeType.md` |
| 换肤 / 主题槽 | `../canvas-data/主题换肤ctx-theme与ThemeRegistry.md` |
| 通用 UI 槽 + 命令 | `../canvas-data/通用UI槽ctx-slots与命令ctx-commands.md` |
| 数据读写（节点 / 边 / 事务 / 撤销） | `../canvas-data/数据门面doc与建节点nodeFactory.md` |
| 选中 / 命令 / 撤销重做 | `../canvas-data/服务selection-command与撤销重做.md` |
| 连线为什么被拒 | `../canvas-data/连接校验connection.md` |
| 持久化存储 | `../canvas-data/存储SaveService与Adapter.md` |
| 服务清单 + 宿主装配全集 | `../canvas-data/服务清单与宿主装配总览.md` |
