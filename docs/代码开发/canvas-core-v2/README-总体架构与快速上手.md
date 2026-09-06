# canvas-core-v2 开发手册 · 总览与快速上手

> 来源：packages/canvas-core-v2/src/index.ts、core/index.ts、core/Context.ts、core/types.ts

这份手册是给**写插件的人 / 用内核的人**看的。先搞懂内核是啥、怎么把插件装上去跑起来，后面每一篇再讲具体某个功能怎么用。

---

## 1. 内核是什么（一句话）

canvas-core-v2 是一个**纯 TypeScript 的"画布引擎内核"**。它自己不管画布长啥样（不碰 Vue、不碰 DOM），它负责三件事：

1. **管理插件**：谁来装、谁依赖谁、谁先启动、谁被卸载时该清理啥。
2. **管理数据**：节点数据、连线数据、选中、历史、命令、存储。
3. **暴露能力**：给插件一个 `ctx`，插件用它注册节点、换主题、发事件、声明配置……

内核是"零 Vue / 零 DOM 依赖"的纯逻辑，所以在 Node 里也能跑单元测试。

> 打个比方：内核像一套"乐高积木的说明书和底盘"，每个插件是插在底盘上的一块积木，宿主(浏览器里的画布页面)是最终拼出来给你看的那座城堡。

---

## 2. 核心流程（三步曲）

用内核就三句话：

1. `new Context()` 建一个上下文（底盘）。
2. `ctx.plugin(模块)` 把插件模块装上去（可以装很多个）。
3. `await ctx.start()` 启动（内核按依赖把每个插件跑起来）。

```ts
import { Context } from '@mini-canvas/canvas-core-v2'

// 1) 建底盘
const ctx = new Context()

// 2) 装一个最简单的插件（对象形态）
ctx.plugin({
  name: 'hello',
  apply() {
    console.log('我是 hello 插件，start 时我会被跑')
  },
})

// 3) 启动：会触发所有插件 apply
await ctx.start()          // 打印 "我是 hello 插件……"
```

启动之后如果想**整体停掉**，调用 `ctx.stop()`（会倒序把每个插件的副作用清理干净，可再 `plugin` + `start` 重新来过）。

> 模块的导出方式：`.ts` 文件**裸导出** `name`（唯一名）、可选的 `inject`（依赖）、可选的 `Config`（配置 schema）、以及 `apply`（注册函数）。内核靠这些字段知道"装的是谁、要等谁、跑什么"。

---

## 3. 三种插件写法（先认识，后面有专篇）

内核收三类"插件形态"，内部会归一成统一的 `PluginModule`（对象）来处理：

| 写法 | 长什么样 | 一句话 |
| --- | --- | --- |
| **对象形态（推荐）** | `{ name, inject, Config, apply }` | 最常用，本手册主推 |
| **类形态（Service）** | `class X extends Service` | 类本身就是一个插件，`new` 时顺手上架一个服务 |
| **函数形态** | 一个具名函数 | 直接当插件传，函数名就是插件名 |

三种都能直接 `ctx.plugin(...)` / `ctx.installPlugin(...)`。

```ts
import { Context, Service, type PluginScope } from '@mini-canvas/canvas-core-v2'

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

// —— 写法三：函数形态（要有名字，匿名函数会报错）——
function heartbeat(c: PluginScope) { c.on('ping', () => console.log('pong')) }

const ctx = new Context()
ctx.plugin(objPlugin)
ctx.plugin(Greeter)      // 直接传类
ctx.plugin(heartbeat)    // 直接传函数
await ctx.start()
```

---

## 4. 内核装 / 卸插件的三种时机

内核提供两个"装"的口子 + 一个"卸"的口子：

- `ctx.plugin(mod)`：**冷启动装载**，只能在 `start()` 之前用（装完登记，等 `start()` 才真正跑）。重复名字或 start 之后用会抛错。
- `ctx.installPlugin(mod)`：**运行中热装**，只能在 `start()` 之后用。依赖满足立刻可用，不满足就挂着等提供方（详见生命周期篇）。
- `ctx.uninstallPlugin(name)`：**运行中热卸**，把该插件所有副作用一次清光，返回 `true/false` 表示是否真卸到。

```ts
const ctx = new Context()
await ctx.start()                       // 先空内核启动
ctx.installPlugin({ name: 'hot', apply() {} })  // 运行中热装
ctx.uninstallPlugin('hot')              // 运行中热卸
```

> 冷启动 `plugin()` + `start()` = "一次都装好再统一跑"。热装 `installPlugin()` 适合"页面开着，插件后面才来 / HMR 重载代码"这种场景。

---

## 5. 插件拿到的 `ctx`（能力台）是啥

每个插件在 `apply(ctx)` / `setup(ctx)` 里拿到的 `ctx` 叫 **PluginScope**（能力视图）。它暴露两拨东西：

**a) 基础能力**（on/once/emit/effect/inject/get/provide/plugin/registry…）
**b) 能力段收口**（都带"自动回收"，插件卸载自动清，作者不用手写 uninstall）：

- `ctx.nodes.register(...)` —— 注册一个节点类型（数据+展示+建节点）
- `ctx.theme.register(...)` —— 往主题槽换肤 / 叠 occupant
- `ctx.commands.register(...)` —— 注册命令
- `ctx.slots.register(...)` —— 往通用 UI 槽叠东西
- `ctx.settings` —— 读/改/订阅本插件装配好的配置

> 关键点：**凡是 `on/effect/inject/nodes.register/...` 这种"建立了东西"的调用，内核都自动登记进这个插件自己的 Scope**，插件被卸载（`stop()` / `uninstallPlugin()`）时全部自动清光。作者**不用写 uninstall**，这是 v2 和 v1 最大的不同。

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

---

## 6. 内核内置事件（启动/停机时会广播）

内核启动、装插件、卸插件时会自动广播一些事件（名字在 `CanvasEventMap` / `Events` 里），你可以用 `ctx.on` 去听：

| 事件名 | payload | 何时触发 |
| --- | --- | --- |
| `ctx:ready` | `{ plugins: string[] }` | start() 把能激活的插件全激活完后 |
| `ctx:plugin-installed` | `{ name: string }` | 某插件成功激活 |
| `ctx:plugin-uninstalled` | `{ name: string }` | 某插件卸载完成 |
| `ctx:lifecycle-change` | `{ name: string; lifecycle: Lifecycle }` | 某插件生命周期状态变化 |

```ts
ctx.on('ctx:ready', ({ plugins }) => console.log('就绪，已激活插件：', plugins))
```

关于事件怎么扩展自定义类型、怎么声明，详见《事件篇》。

---

## 7. 装"宿主/内核服务"是怎么来的

上面例子里的 `ctx.nodes.register` 会真的去调用 `nodeStore`（存节点数据）和 `nodeRegistry`（存展示组件）。这些服务**由谁提供**？两种来源：

- **宿主在 start 之前用 `ctx.inject(name, 实例)` 注入**（例如 `ctx.inject('nodeStore', new NodeStore())`）。
- **内核自带两个内置实例**：`slots` 和 `settings`（不用注入，永远在）。

`ctx.get(name)` 取服务；缺服务返回 `undefined`（不抛），适合做"可选依赖探测"。

> 想完整知道"内核有哪些服务名约定"（nodeStore/nodeRegistry/themeRegistry/command/nodeFactory/edgeStore/selection/history/save…），看《数据服务与存储篇》和《service / get / provide 篇》。注意：**内核本身不把 NodeStore 等自动注入**，需要在装配处手动 `inject`（宿主负责；纯逻辑测试里也是手动注入的）。

---

## 8. 坑与注意（速记）

1. `ctx.plugin` 只能在 `start()` 前用；`installPlugin` 只能在 `start()` 后；用错时机直接抛错（错误信息会说明期望状态）。
2. 插件名全局唯一，重名抛 `Duplicate plugin name`。
3. 插件 `apply` 里抛错 → 该插件置 FAILED，错误会往上抛（`start()`/`installPlugin` 会 reject/throw）；半成品副作用已被清理，可重装同名插件。
4. 一个插件若只写了 `deps`（旧式）没写 `inject`，也能用；`inject` 优先。
5. 插件可以写 `setup(ctx)`（旧式）或 `apply(ctx, config)`（推荐，`apply` 优先）。返回的 cleanup 函数会被登记，卸载自动跑。

---

## 9. 从这里往哪看

| 你想干嘛 | 去读哪篇 |
| --- | --- |
| 插件怎么写、生命周期、热装热卸 | `插件形态与生命周期.md` |
| 为什么 on/effect 不用手动清 | `Scope副作用自动回收.md` |
| 插件状态怎么查/诊断 | `Fiber状态机与诊断.md` |
| 服务注入/类形态 Service | `服务注入get-inject-provide与Service基类.md` |
| 事件 on/emit 及分发模式 | `类型化事件on-once-emit.md` |
| 依赖排序 | `依赖拓扑排序topoSort-depsOf.md` |
| 注册一个节点 | `注册节点类型ctx.nodes与registerNodeType.md` |
| 换肤 / UI 槽 | `主题换肤ctx.theme.md`、`通用UI槽ctx.slots.md` |
| 配置 | `配置装配configSchema与ctx.settings.md` |
| 数据/历史/命令/存储 | `数据服务nodeStore-edgeStore.md` 等 |
| 连线校验 | `连接校验内核connection.md` |
