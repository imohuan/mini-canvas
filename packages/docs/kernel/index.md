# 内核

**一句话定位**：**`@mini-canvas/kernel` 是整套系统的插件框架 —— 它只管四件事：装插件、排依赖、发事件、回收副作用。画布上的东西（节点、连线、主题）它一概不认识。**

**它属于哪一档**：**框架层（最底下那一层）**。源码入口 `packages/kernel/src/index.ts`。它不依赖任何其它 `@mini-canvas/*` 包，也不依赖 Vue、不碰 DOM —— 纯 Node 里就能跑、能单测。

## 它是什么

打两个比方，记住一个就行：

- **像乐高底板**：底板只负责把插块卡住、卡牢。要房子、要小车、要飞机，是插块（插件）说了算。
- **像手机的系统**：手机买来只是块屏幕加个系统，能干什么取决于你装了哪些 App。

它管的四件事，每一件后面都有专篇：

| 管什么 | 靠什么 | 管的是哪一类 |
| --- | --- | --- |
| **装插件** | `ctx.plugin` / `ctx.installPlugin` / `ctx.uninstallPlugin` | 谁依赖谁、谁先跑、卸载时清什么 |
| **发消息** | `ctx.on` / `ctx.once` / `ctx.emit`（共五种分发） | 通知一声，想听的听 |
| **回收** | `ctx.effect` + Scope / Fiber | 插件放下的东西，卸载时自动清光 |
| **记位置** | `ctx.registryOf('种类')` | 按种类放一串条目（一张表） |

「加一个会换实现的能手」是**服务**，「加一批同类条目」是**注册场** —— 这条判据贯穿整套系统，见 [注册场：加功能不用加服务](/intro/registries)。

### 五个包谁是谁

内核站在最底下，上面每一层都只认识下面那层：

```
kernel  ←  canvas-data  ←  canvas-render  ←  plugins
（框架）    （数据+语义）     （渲染）          （具体功能）
```

| 包 | 一句话 | 装它的 ctx 长什么样 |
| --- | --- | --- |
| `@mini-canvas/kernel` | 插件框架（本文这一组） | `ctx.tools` + 六个原语，**不认识画布** |
| `@mini-canvas/canvas-data` | 数据层 + 画布语义 | 上面那些 + `ctx.nodes` / `ctx.theme` / `ctx.commands` / `ctx.slots` / `ctx.settings` |
| `@mini-canvas/canvas-render` | 渲染层（Vue / VueFlow / DOM） | 画布服务里再多 `nodeLayout` / `viewport` / `pluginManager` |
| `@mini-canvas/canvas-base` | 插件作者的薄入口（重导出 kernel + canvas-data） | 与 canvas-data 一样 |
| `@mini-canvas/ui` | 成品应用出口（一行 `CanvasHost` 出画布） | 与 canvas-render 一样 |

分层怎么分工看 [三层是怎么分工的](/intro/three-layers)；每个服务是谁提供的、怎么用，看 [内置服务](/services/)。

### 内核里到底导出了什么

从 `packages/kernel/src/index.ts` 一处就能全部导入。按用途分四拨：

| 这一拨 | 有什么 |
| --- | --- |
| **装载与生命周期** | `Context`、`runPlugin`、`Service`、`asPluginModule`、`Fiber`、`FiberState` |
| **回收与依赖** | `Scope`、`topoSort`、`depsOf` |
| **事件与注册场** | `EventBus`、`registerEventName`、`isBailed`、`hasKnownEvent`、`knownEventNames`、`RegistryImpl`、`SlotRegistry` |
| **内核自带能力** | `ToolRegistry`（`ctx.tools`）、`CommandRegistry`、`SettingsStore`、`resolveConfig`、`F`、`defineTool`、`runToolCall`、`setDefaultCapabilityLayerFactory` |

## 为什么需要它

如果没有一个统一的轴，写插件会遇到这四种乱法：

1. **插件之间互相 `import`**：A 想用 B 的能力就直接引用 B 的文件。结果是两个包装死在一起，换一个实现就要改一堆文件。
2. **顺序靠人肉保证**：「B 必须先启动」这件事只写在注释里，谁改一下装配顺序就炸。
3. **卸载全靠手写**：插件自己记着「我监听过什么、起过什么定时器」，漏一个就留下僵尸监听，越跑越慢。
4. **每加一类功能就加一个新服务**：API 越堆越多，最后没人记得全。

内核用一条规矩回答这四件事：**插件只跟 `ctx` 说话**。依赖写进 `inject` 让框架排；副作用登记进 `ctx.effect` 让框架清；新位置用 `registryOf` 报个新种类，不动内核。

## 怎么用：三步曲

```ts
// 文件：quick-start.ts
// 格式：TypeScript 模块（可直接用 `npx tsx quick-start.ts` 跑）
// 位置：一个独立的 Node 脚本；不需要浏览器、不需要 Vue
import { Context } from '@mini-canvas/kernel'

// ① 建一个上下文：这就是「内核」。
//    纯内核 Context 只有六个原语 + ctx.tools，没有 ctx.nodes。
const ctx = new Context()

// ② 把插件装上去（可以装很多个；只登记，不执行）
ctx.plugin({
  name: 'hello',
  apply() {
    console.log('我是 hello 插件，start 时我会被跑')
  },
})

// ③ 启动：按依赖把能激活的插件逐个跑起来
await ctx.start() // 打印「我是 hello 插件，start 时我会被跑」

// 跑完想整体停掉：
ctx.stop() // 倒着把每个插件的副作用清干净；之后还能再 plugin + start 重来
```

三句话记牢：**建（`new Context`）→ 装（`ctx.plugin`）→ 启（`await ctx.start`）**。

> ⚠️ `@mini-canvas/kernel` 导出的是**纯插件内核**，`ctx.get('doc')` 之类画布服务一律是 `undefined`。
> 要带画布能力的 `ctx`，用 `@mini-canvas/canvas-data` 导出的 `Context`（构造参数一样，它默认装好画布能力层）。

## 三种插件写法

不管怎么写，内核都会先**归一成同一个对象** `PluginModule` 再处理（归一函数是 `asPluginModule`，源码 `packages/kernel/src/pluginClass.ts`）。

| 写法 | 长什么样 | 名字从哪来 | 什么时候用 |
| --- | --- | --- | --- |
| **对象形态**（最常用） | `{ name, inject, Config, apply }` | 自己写死 | 默认就写这种 |
| **类形态** | `class X extends Service` | 静态 `provide`，没有就取类名 | 这套插件的主要工作就是「上架一个服务」 |
| **函数形态** | 一个**具名**函数 | 函数名 | 极简插件、临时挂个监听 |

### 写法一：对象形态

```ts
// 文件：my-plugin/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个插件包的源码入口
import type { Context } from '@mini-canvas/kernel'

export const name = 'my-plugin'
export const inject = [] as string[] // 没有硬依赖就写空数组

export function apply(ctx: Context): void {
  ctx.on('ctx:ready', () => {
    console.log('[my-plugin] 画布就绪了')
  })
}

// 装配方（宿主/测试）拿这个模块当插件装：ctx.plugin(myPluginModule)
```

### 写法二：类形态（Service 子类）

```ts
// 文件：my-plugin/src/greeterPlugin.ts
// 格式：TypeScript 模块（类形态插件：类本身就是插件）
// 位置：需要「上架一个服务」时用这种写法
import { Service, type Context } from '@mini-canvas/kernel'

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter') // ① 上架服务名 'greeter'（内部就是 ctx.provide('greeter', this)）
  }
  greet(who: string): string {
    return `Hello, ${who}!`
  }
}
// ② 直接传类即可装载；内核 new 它一次就算跑起来了
// ctx.plugin(GreeterService)
// 之后任何地方 ctx.get('greeter').greet('world')
```

### 写法三：函数形态

```ts
// 文件：my-plugin/src/heartbeatPlugin.ts
// 格式：TypeScript 模块（函数形态插件：函数名就是插件名）
// 位置：极简插件
import type { Context } from '@mini-canvas/kernel'

export function heartbeat(ctx: Context): void {
  ctx.on('ping', () => console.log('pong'))
}
// ctx.plugin(heartbeat)
```

> **函数形态的两条限制**：必须**具名**（匿名函数会抛 `[core] 函数形态插件需具名（不能是匿名函数），以便装配寻址/诊断。`）；
> 返回值会被**直接丢弃**，不做 cleanup —— 要清理请用 `ctx.effect`。

## 装 / 卸的两个时机

「装」有两个入口，用错时机直接抛错（错误信息会告诉你期望哪个状态）：

| 操作 | 方法 | 只能用在哪 | 说明 |
| --- | --- | --- | --- |
| 冷启动登记 | `ctx.plugin(mod, config?)` | `start()` **之前** | 只登记，等 `start()` 一起跑 |
| 启动 | `await ctx.start()` | 状态为 `created` | 按依赖多轮激活，最后广播 `ctx:ready` |
| 热装 | `ctx.installPlugin(mod, config?)` | `start()` **之后** | 依赖满足立刻可用，否则挂着等 |
| 热卸 | `ctx.uninstallPlugin(name): boolean` | `start()` **之后** | 清光副作用，返回是否真卸到 |
| 先问再卸 | `ctx.canUninstall(name)` | 随时 | 区分「核心插件不让卸」与「没这个插件」 |
| 停机 | `ctx.stop()` / `await ctx.stopAsync()` | 状态为 `started` | 倒序卸光，可重新 start |

```ts
import { Context } from '@mini-canvas/kernel'

const ctx = new Context()
await ctx.start()                                   // 先空内核启动
ctx.installPlugin({ name: 'hot', apply() {} })      // 运行中热装
ctx.uninstallPlugin('hot')                          // 运行中热卸
```

热卸还有「连坐」：A 依赖 B 的服务，卸掉 B 之后 A 会自动回退等重载；把 B 装回来，A 自己会重新跑。
详见 [Fiber 状态机与诊断](/kernel/fiber)。

## 插件拿到的 `ctx` 是什么

插件在 `apply(ctx)` 里拿到的是 **`PluginScope`**（能力视图），它有三拨东西。

**a) 六个原语**（内核给的、每个插件都有的）：

| 原语 | 签名要点 | 干什么 |
| --- | --- | --- |
| `ctx.plugin(mod)` | 返回 `PluginScope` | 装子插件（运行中自动走热装） |
| `ctx.get(name)` / `ctx.tryGet(name)` | 缺服务返回 `undefined`，不抛 | 取服务（可选依赖探测） |
| `ctx.inject(name, impl)` / `ctx.provide(name, impl)` | 两者**完全等价** | 上架一个服务 |
| `ctx.on` / `once` / `emit` / `parallel` / `serial` / `bail` / `waterfall` | 见 [事件篇](/kernel/events) | 监听与五种分发 |
| `ctx.effect(fn)` | 返回 `Disposable` | 登记副作用，卸载自动清 |
| `ctx.registryOf(kind)` | 返回 `Registry<T>` | 取一张注册场放条目 |

另外还有 `ctx.state(initial)`（插件私有状态，不占服务名）、`ctx.isDev`、`ctx.surface()`（自省）、
`ctx.registry`（插件运行态只读视图）、`ctx.canUninstall(name)`。

**b) 服务解析 Proxy（属性直读的糖）**：插件 ctx 是个 `Proxy`。读一个属性时，先看它是不是**真实成员**
（`on` / `emit` / `registryOf` / `nodes` / `theme` / `settings`…），不是的话就当**服务名**去查表 ——
查不到返回 `undefined`，不抛错。所以 `inject: ['greeter']` 之后，`ctx.greeter` 与 `ctx.get('greeter')` 运行时等价。

> 注意：这层糖**只在插件 ctx 上**。组件里拿到的一般是根 `Context`，请老老实实写 `ctx.get('...')`。

**c) 能力段**（由**能力层**产出，拼到每个 ctx 上）：纯内核只有 `ctx.tools`；
画布层会再给 `ctx.nodes` / `ctx.theme` / `ctx.commands` / `ctx.slots` / `ctx.settings`。
内核不认识这些字眼的原因见 [能力层接缝](/kernel/capability-layer)。

> `ctx.registryOf('种类')` 与 `ctx.registry` 是**两个不同的东西**：前者是「按种类放/取一串条目」的注册场；
> 后者是插件运行态诊断（`Map<插件名, { status, fiber }>`）。名字像，用途相反，别搞混。

## 内核内置的四个事件

这四个事件在 `packages/kernel/src/types.ts` 的 `EventMap` / `Events` 里都登记好了，装上就能用：

| 事件名 | 参数 | 什么时候发 |
| --- | --- | --- |
| `ctx:ready` | `{ plugins: string[] }` | `start()` 把能激活的插件全激活完后（`plugins` = 本批激活的名字） |
| `ctx:plugin-installed` | `{ name: string }` | 某个插件成功激活 |
| `ctx:plugin-uninstalled` | `{ name: string }` | 某个插件卸载完成（`stop()` 时逐个发） |
| `ctx:lifecycle-change` | `{ name: string; lifecycle: Lifecycle }` | 某插件生命周期状态变化 |

```ts
// 文件：my-plugin/src/index.ts 里的一小段
ctx.on('ctx:ready', ({ plugins }) => console.log('就绪，本批激活：', plugins))
```

内核之外还有三条工具事件（`tools/registered` / `tools/unregistered` / `tools/result`），
由 `packages/kernel/src/modelTool.ts` 在模块加载时登记，见 [模型工具](/kernel/model-tool)。

## 服务名速查：内核自带只有 `tools`

| 服务名 | 谁提供 | 是什么 |
| --- | --- | --- |
| `tools` | **内核自带，恒在** | 外部能力注册表（文生图 / 图生文这类「生成工具」，按名调用） |

`slots` / `settings` 由画布能力层提供；`doc` / `save` / `selection` / `command` 等由基础插件注入；
`nodeLayout` / `viewport` / `pluginManager` 由渲染宿主注入。**完整清单和每个服务的用法，看 [内置服务总览](/services/)。**

```ts
// 想看这台内核上「有什么能取」：一次读全（只读、零副作用）
const report = ctx.surface()
report.services // [{ name: 'tools', source: '<builtin>', methods: [...] }, ...]
report.events   // 已登记的事件名
```

## `ctx.isDev` 从哪来

`ctx.isDev` **只认构造时显式传的** `dev` 选项，缺省 `false`（= 生产语义）：

```ts
const ctx = new Context({ dev: true })
```

它决定了「dev 白名单警告」这类开关：`dev: true` 时，`emit` 一个**没登记过**的事件名会在控制台给一条 warn（每个名字只给一次）。

画布链路上的来源是：宿主组件 `CanvasHost` 把 `import.meta.env.DEV` 传给 `createMiniCanvasHost({ dev })`，
工厂里落到 `new Context({ dev: opts.dev ?? false })`（`packages/canvas-render/src/host/createMiniCanvasHost.ts:164`）；
成品应用在 `packages/ui/src/App.vue:69` 写 `const DEV = import.meta.env.DEV`。

> **库侧为什么不自己读 `import.meta.env`**：打包器的环境替换只作用于**应用自身的源码**，
> workspace 包读出来可能是 `undefined`，dev 判定会静默失效。所以内核与渲染层都以「调用方显式传参」为准。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/kernel/src/Context.ts` | 内核本体：装载 / 依赖多轮激活 / 服务表 / 注册场表 / 自省 |
| `packages/kernel/src/__tests__/kernelBoundary.test.ts` | 边界测试：锁住「纯内核只有 `tools`，没有画布服务」这条铁律 |
| `packages/canvas-data/src/canvas/context.ts` | 画布版 `Context`：`new Context()` 默认装画布能力层 |
| `packages/canvas-render/src/host/createMiniCanvasHost.ts:164` | 宿主装配点：`new Context({ dev })` + 注入渲染层两件服务 + 启动 |
| `packages/ui/src/App.vue:171` | 成品应用：`<CanvasHost :dev="DEV" window-key="MiniCanvasUI">` |

## 完整例子

一个能在 Node 里直接跑的小例子：三种插件写法各来一个，装进同一个内核，启动后看控制台。

### 目录长这样

```
plugin-hello/
├── package.json            # 插件清单
└── src/
    ├── index.ts            # 对象形态插件：听 ctx:ready
    ├── greeterPlugin.ts    # 类形态插件：上架 greeter 服务
    ├── heartbeatPlugin.ts  # 函数形态插件：听得懂 ping
    └── main.ts             # 装配脚本：建 → 装 → 启 → 停
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/plugin-hello/`。

### 文件一：对象形态

```ts
// 文件：packages\docs\public\examples\kernel\plugin-hello/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context } from '@mini-canvas/kernel'

export const name = 'hello'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 监听内核内置事件：启动完成时打一声招呼
  ctx.on('ctx:ready', ({ plugins }) => {
    console.log('[hello] 就绪，本批激活：', plugins.join(', '))
  })
}
```

### 文件二：类形态（Service 子类）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-hello/src/greeterPlugin.ts
// 格式：TypeScript 模块（类形态插件）
// 位置：插件包里「提供一项服务」的那一件
import { Service, type Context } from '@mini-canvas/kernel'

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter') // 上架服务名 'greeter'；卸载随插件自动撤下
  }
  greet(who: string): string {
    return `Hello, ${who}!`
  }
}
```

### 文件三：函数形态

```ts
// 文件：packages\docs\public\examples\kernel\plugin-hello/src/heartbeatPlugin.ts
// 格式：TypeScript 模块（函数形态插件：函数名就是插件名）
// 位置：插件包里的极简插件
import type { Context } from '@mini-canvas/kernel'

export function heartbeat(ctx: Context): void {
  ctx.on('ping', () => console.log('[heartbeat] pong'))
}
```

### 文件四：装配脚本

```ts
// 文件：packages\docs\public\examples\kernel\plugin-hello/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：把三种形态的插件装进同一个内核
import { Context } from '@mini-canvas/kernel'
import * as helloPlugin from './index'
import { GreeterService } from './greeterPlugin'
import { heartbeat } from './heartbeatPlugin'

const ctx = new Context({ dev: true })   // ① 建

ctx.plugin(helloPlugin)                  // ② 装：对象形态（整个模块就是插件）
ctx.plugin(GreeterService)               //    装：类形态（直接传类）
ctx.plugin(heartbeat)                    //    装：函数形态（直接传函数）
ctx.plugin({                             //    装：消费方，硬依赖 greeter 服务
  name: 'consumer',
  inject: ['greeter'],
  apply(c) {
    // inject 保证了 apply 跑的时候 greeter 已就绪
    console.log('[consumer]', c.get<GreeterService>('greeter').greet('world'))
  },
})

await ctx.start()                        // ③ 启：多轮激活 + 广播 ctx:ready
ctx.emit('ping')                         // 广播一个自定义事件（dev 下未登记会 warn）

console.log(ctx.get<GreeterService>('greeter').greet('kernel'))
console.log(ctx.inspectPlugins().map((p) => `${p.name}:${p.state}`).join(' '))

ctx.stop()                               // ④ 停：倒序清光，可重新 start
```

预期：`consumer` 在 `hello` 之后跑（依赖决定顺序），`ctx:ready` 在本批插件全激活后广播。

## 常见坑

1. **`ctx.plugin` 只能在 `start()` 之前调，`ctx.installPlugin` 只能在 `start()` 之后调。** 用错直接抛错，
   错误信息会写明当前状态与期望状态（形如 `Cannot installPlugin when state is "created" (expected "started")`）。
2. **别在纯内核里找画布服务。** `new Context()`（kernel 版）没有 `ctx.nodes`，`ctx.get('doc')` 是 `undefined`；
   这条边界有测试锁着（`packages/kernel/src/__tests__/kernelBoundary.test.ts`）。要画布能力请用 canvas-data 的 `Context`。
3. **插件名全局唯一**，重名抛 `Duplicate plugin name`。热重载要「先卸旧、再装同名的新的」。
4. **`apply` 里抛错 = 该插件进 `failed`，错误继续往上抛**（`start()` / `installPlugin()` 会 reject / throw）。
   半成品副作用已被回收，可以用同一个名字重装。
5. **老服务名坑**：`inject: ['nodeStore']` 会让插件**永久停在 PENDING** —— 那几个名字已下线合并成 `doc`，
   写依赖前先查 [内置服务](/services/)。
6. **属性直读（`ctx.greeter`）只在插件 `apply(ctx)` 里成立**。写组件、写宿主时请用 `ctx.get('greeter')`。

## 接下来读哪篇

| 你想搞懂 | 去读 |
| --- | --- |
| 服务怎么上架、怎么取、硬依赖 vs 可选依赖 | [服务注入](/kernel/services) |
| 事件怎么发、五种分发什么区别 | [类型化事件与 EventBus](/kernel/events) |
| 插件配置怎么写、面板怎么长出来 | [配置装配](/kernel/config) |
| 为什么不用手写 uninstall | [作用域 Scope](/kernel/scope) |
| 插件卡住了怎么查 | [Fiber 状态机与诊断](/kernel/fiber) |
| 依赖顺序怎么算 | [依赖拓扑](/kernel/topo) |
| 内核为什么「不认识画布」 | [能力层接缝](/kernel/capability-layer) |
| 给模型调用的工具 | [模型工具](/kernel/model-tool) |
