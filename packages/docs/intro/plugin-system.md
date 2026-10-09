# 插件系统：七个原语

写一个插件，要学的东西被砍到**七样**。前六样是 `ctx` 上的六个方法，
第七样是一张位置词表。学会这七样，你就能写任何插件。

先给一个"能跑起来"的最小插件，再逐个拆开讲：

```ts
// my-plugin.ts —— 一个把数据、换肤、命令、配置串起来的最小插件
import { F, type Context } from '@mini-canvas/canvas-base'
import MyBlockContent from './MyBlockContent.vue'

export const name = 'my-plugin'
export const inject = ['doc']        // ② 硬依赖：doc 没就绪我就等着
export const Config = {
  glow: F.boolean(true),             // ⑤ 我的配置项（设置面板会自动出现）
}

export function apply(ctx: Context, config: { glow: boolean }) {
  ctx.nodes.register({               // ⑤ 往注册场放东西
    type: 'my-block',
    label: '我的块',
    size: { w: 160, h: 90 },
    in: MyBlockContent,              // 区域词 in = 卡片内部
  })
  ctx.on('ctx:ready', () => {        // ④ 听事件
    console.log('画布就绪，glow =', config.glow)
  })
}
```

## 六个方法

### ① 装载：`ctx.plugin` / `installPlugin` / `uninstallPlugin`

**是什么**：把插件装上、卸下。

**为什么要它**：插件之间会互相依赖，谁先谁后不能靠人肉保证，得让框架去编排。

```ts
ctx.plugin(myPlugin, { glow: false })   // start 之前：登记（冷启动）
await ctx.start()                        // 按依赖，自动决定激活顺序

ctx.installPlugin(otherPlugin)           // start 之后：热装
ctx.uninstallPlugin('other')             // 热卸，它放的东西自动回收
```

**判据**：这东西"要不要被装进来" → 装载。

### ② 服务：`ctx.get` / `ctx.provide` + 模块级 `inject`

**是什么**：按**名字**拿一个**对象**。

**为什么要它**：插件 A 要调用插件 B 的能力，但它们不能互相 import（那样就绑死了）。
于是 B 把能力挂个名字上架，A 按名字取。

"上架"和"取"是两件事，用法也不同：

```ts
// 提供方：把对象挂上名字
ctx.provide('greeter', { greet: (w: string) => 'Hello ' + w })

// 消费方 · 必需依赖：模块级声明，内核等你依赖就绪才跑你
export const inject = ['greeter']
export function apply(ctx: Context) {
  const g = ctx.get('greeter')   // 一定拿得到，inject 保证了
  g.greet('world')
}

// 消费方 · 可选依赖：有就用，没有就算（get 缺了返回 undefined，不抛）
const maybe = ctx.get('maybe-svc')
if (maybe) maybe.doIt()
```

**一句话规矩**：**必需的用 `inject` 声明，可选的用 `ctx.get` 探测。**

**判据**：这东西是一个"会做事的能手" → 服务。

### ③ 事件：`ctx.on` / `ctx.once` / `ctx.emit`

**是什么**：喊一声，谁想听谁听。喊的人不关心有没有人听。

```ts
ctx.on('ctx:ready', () => { /* 画布就绪了 */ })
ctx.emit('my:something-happened', 42)   // 广播
```

**判据**：只是"通知一声"，不需要回话 → 事件。

### ④ 作用域：`ctx.effect`

**是什么**：登记"我放的东西"，卸我的时候自动帮我清掉。

**为什么要它**：这是整套系统最省心的一条 —— **插件作者几乎不用手写注销**。
你在 `apply` 里注册的、监听的、上架的，全都自动回收。

```ts
ctx.effect(() => {
  const timer = setInterval(tick, 1000)
  return () => clearInterval(timer)   // 返回的函数 = 清理动作
})
```

**判据**：需要"我走了就收拾干净" → `ctx.effect`。

### ⑤ 注册场：`ctx.registryOf(kind)`

**是什么**：按**种类**放一串**条目**。这是整套设计的核心，单独一篇讲
（[注册场：加功能不用加服务](/intro/registries)）。

```ts
const field = ctx.registryOf<MyThing>('my-kind')
field.add('some-key', value, { id: 'mine', order: 10 })
```

**判据**：这是"一张表"（一堆同类条目） → 注册场。
**这是"一个能手"（要换实现） → 服务。**

### ⑥ 状态：`ctx.state`

**是什么**：插件自己的私有数据，不占服务名，别人看不到。

```ts
const counter = ctx.state({ n: 0 })
counter.value.n++
```

**判据**：这是我自己的东西、不需要别人读 → `ctx.state`。
真要被别人读，才升成服务或注册场里的一条。

## 第七样：区域词表

前六样是 `ctx` 上的方法，第七样不是方法，是**一张位置表**：
往节点上放东西时，位置只能用下面这十个词。

| 区域词 | 位置 |
| --- | --- |
| `in` | 卡片**内部**（最常用） |
| `title` | 卡片**标题**那一行 |
| `out:top` / `out:bottom` / `out:left` / `out:right` | 卡片**外面**的上/下/左/右（节点**上控制栏**、**下控制栏**就在这） |
| `on:top` / `on:bottom` | 贴在卡片**边上**的上/下 |
| `over:inset` / `over:outset` | 卡片内/外的**覆盖层** |

为什么要固定成十个词？因为以前位置名有好几套叫法（`content` / `top-toolbar` 等），
作者和渲染层对不上，出问题特别难查。现在只有一张表，名字错了当场报错、还告诉你该用哪个。

## 一张对照表收尾

| 你想干的事 | 用哪个 |
| --- | --- |
| 加一个能做的事（换实现） | 服务 `provide` / `inject` |
| 加一批同类条目（表格） | 注册场 `registryOf` |
| 通知一声 | 事件 `on` / `emit` |
| 我走了要收拾 | `ctx.effect` |
| 我自己的数据 | `ctx.state` |
| 往节点某个位置放东西 | 注册场 + 十个**区域词** |
