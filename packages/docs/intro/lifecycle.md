# 插件的生命周期

这篇讲两件事：**一个插件能写成哪几种样子**，以及**它从被装到被卸都经过哪些状态**。

## 一、三种写法，最后都是同一个东西

不管你写成哪种，内核内部都先把它看成同一个对象：

```ts
interface PluginModule {
  name: string        // 唯一名，必须给，全内核不能重名
  core?: boolean      // 核心插件：不允许热卸
  inject?: string[]   // 硬依赖（服务名 / 插件名）
  Config?: ConfigSchema
  apply?(ctx, config?)  // 真正的注册函数
}
```

### 写法一：对象形态（推荐）

一个 `.ts` 文件裸导出几样东西，就是插件：

```ts
export const name = 'my-plugin'
export const inject = ['doc']
export const Config = { speed: { type: 'number', default: 1 } }
export function apply(ctx, config) {
  // 在这里注册东西
}
```

### 写法二：类形态（继承 Service）

**只有"这个插件的主要工作就是提供一项服务"时才用这种写法。** 它是少数派 ——
大多数插件用的是写法一（对象形态）+ 注册场，**根本不提供任何服务**。

继承 `Service`，`super(ctx, name)` 会顺手把它挂上服务表：

```ts
import { Service } from '@mini-canvas/kernel'

export class GreeterService extends Service {
  constructor(ctx) {
    super(ctx, 'greeter')   // 上架服务名 'greeter'
  }
  greet(who: string) { return 'Hi ' + who }
}

// 装配：直接传类
ctx.plugin(GreeterService)
```

> **别把它当默认写法。** 判断标准还是那句：这是"一个能手"（将来会换实现）才做服务；
"一张表"就老老实实放注册场。像 `theme-default` 这种只往主题槽放组件、
一个服务都不提供的插件，才是常态。

### 写法三：函数形态

一个**具名**函数也能当插件，函数名就是插件名：

```ts
export function heartbeat(ctx) {
  ctx.on('ping', () => console.log('pong'))
}
```

> **坑**：必须具名。匿名函数会报错。函数形态的返回值会被丢弃，
> 要做清理请用 `ctx.effect`。

## 二、状态机：插件现在处于哪一步

诊断插件问题，主要看这个状态（`ctx.inspectPlugins()` 读到的就是它）：

```
PENDING → LOADING → ACTIVE
   ↘         ↘
  （缺依赖）  FAILED（apply 或配置校验抛错）

卸载：ACTIVE / FAILED / PENDING → UNLOADING → DISPOSED
```

| 状态 | 大白话 |
| --- | --- |
| `pending` | 已登记，在等它要的依赖 |
| `loading` | `apply` 正在跑 |
| `active` | 跑起来了，它的服务可用 |
| `failed` | `apply` 或配置校验抛错了（保留着，方便你查） |
| `unloading` | 正在清理 |
| `disposed` | 已卸载，不能再启动 |

**这些状态不用你手动推**，内核在装 / 启 / 卸 / 停的时候自己推。

## 三、冷启动：顺序由依赖决定，不由登记顺序决定

```ts
ctx.plugin(需要 doc 的插件)   // 先登记它
ctx.plugin(basePlugin)        // doc 由这个提供
await ctx.start()             // 启动
```

你可能担心"依赖方先登记，提供方后登记，会不会出问题"。不会 ——
`start()` 做的是**多轮激活**：

```
第 1 轮：谁的依赖此刻满足，就激活谁
第 2 轮：上一轮激活后又满足了新的依赖，继续激活
……直到没有插件可以再激活
然后广播 ctx:ready
```

所以依赖方和提供方的登记顺序无所谓，**框架会自己排好**。

## 四、热装 / 热卸 / 热重载

`start()` 之后，画布是**活的**，可以随时装卸插件：

```ts
ctx.installPlugin(otherPlugin)      // 热装，返回插件名
ctx.uninstallPlugin('other')        // 热卸，它放的东西自动回收

// 热重载 = 先卸再装（开发期改完插件代码，让它立刻生效）
ctx.uninstallPlugin('my-plugin')
ctx.installPlugin(newVersionOfMyPlugin)
```

## 五、config：插件怎么拿到自己的配置

模块级导出 `Config`（一个 schema），装配时传值，内核校验 + 补默认后交给 `apply`：

```ts
export const Config = {
  edgeColor: { type: 'color', default: '#3b82f6' },
  glow: { type: 'boolean', default: true },
}

export function apply(ctx, config /* 已经被填好默认值 */) {
  console.log(config.edgeColor)
}
```

这些字段还会**自动出现在设置面板**里，不用再手写一遍 UI。

## 六、清理：几乎不用手写

这是整套系统最省心的一条。你在 `apply` 里做的注册、监听、上架，
**全部随插件卸载自动回收**：

```ts
export function apply(ctx) {
  ctx.provide('my-svc', service)     // 卸 → 服务自动撤下
  ctx.on('some-event', handler)      // 卸 → 监听自动摘掉
  ctx.effect(() => { /* ... */ })    // 卸 → 清理自动跑
  ctx.nodes.register({ /* ... */ })  // 卸 → 注册自动移除
}
```

作者不需要记得"我注册过什么、要挨个撤销"。少写一样就是少一个 bug。

## 一句话总结

**插件 = 一个名字 + 一份依赖声明 + 一个 `apply`。**
装进去之后，它放的所有东西都由框架管生死，作者只管写功能。
