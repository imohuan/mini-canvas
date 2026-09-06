# 服务注入：ctx.get / inject / provide 与 Service 基类

> 来源：packages/canvas-core-v2/src/core/Context.ts、service.ts、pluginClass.ts、core/types.ts（Services interface）

插件之间怎么互相"借能力"？内核用一套**服务注入**机制：一方把服务**上架**，另一方**声明依赖或直接取**。

---

## 1. 先分清三个词

| 词 | 是干嘛的 | 归属 |
| --- | --- | --- |
| **上架 / 提供** | 把一个对象以名字存进内核的服务表，别人能取 | `inject` / `provide`（两者等价） |
| **取服务** | 从服务表按名拿对象 | `get` |
| **硬依赖声明** | 告诉内核"我没它不启动"，等它到了再跑我 | 插件的 `inject: [...]` 字段 |

- `inject(name, impl)` 与 `provide(name, impl)` **完全等价**（provide 内部就是调 inject）。Service 子类 `super(ctx, name)` 内部调的是 `provide`。
- 服务名全局唯一，重复上架抛 `already injected`。
- 上架后返回一个撤销函数；**插件 ctx 上上架的服务，撤销自动挂本插件 fiber**（卸载自动撤下）。

```ts
// 提供方：把对象上架为 'greeter'
ctx.plugin({
  name: 'greeter-plugin',
  apply(c) {
    c.provide('greeter', { greet: (w: string) => `Hello, ${w}` })
    // c.inject('greeter', { ... }) 也一样
  },
})
```

---

## 2. 消费方两种吃法

### 2.1 硬依赖：`export const inject = ['greeter']`

在插件的 `inject` 里写服务名，内核会**等这个服务上架后才跑本插件**；缺提供方就停 PENDING，提供方被卸/换还会连坐回退并自动重载。这是"我没它不行"时用的。

```ts
export const inject = ['greeter']
export function apply(ctx: PluginScope) {
  const g = ctx.get<{ greet(w: string): string }>('greeter')
  g.greet('world')   // 一定拿得到（inject 保证了它已就绪）
}
```

### 2.2 可选探测：`ctx.get('name')`

`ctx.get(name)` **缺服务返回 `undefined`（不抛）**，适合"有就用、没有就算了"的可选依赖。用可选依赖的插件，即使缺提供方也照常 apply 运行。

```ts
apply(c) {
  const svc = c.get('maybe-svc')   // 没有 → undefined，不抛
  if (svc) svc.doIt()
}
```

> 结论一句话：**必需的依赖用 `inject` 字段声明（让内核编排）；可选的能力用 `ctx.get` 探测。**

---

## 3. ctx.get 的内置恒在服务

有两个名字永远拿得到，不用注入：**`'slots'`** 和 **`'settings'`** —— 它们由内核在构造时自建，宿主和插件共享同一实例。

```ts
const slots = ctx.get('slots')      // 永远在（SlotRegistry）
const settings = ctx.get('settings')  // 永远在（SettingsStore）
```

其它内核约定名（nodeStore/nodeRegistry/themeRegistry/command/nodeFactory/edgeStore/selection/history/save…）**需要宿主在装配时用 `ctx.inject` 手动注入**——内核本身不自动注这些。这也解释了为什么前面例子要自己 `ctx.inject('nodeStore', new NodeStore())`。

---

## 4. ctx 属性名直读（Proxy 糖）

插件声明 `inject: ['greeter']` 后，除了 `ctx.get('greeter')`，还能直接 `ctx.greeter` 读（deriveScope 里用 Proxy 包了一层：字符串属性名会尝试解析为已上架服务，没有则返回 undefined）。

```ts
// inject: ['greeter'] 之后
c.greeter.greet('hi')   // 等价于 c.get('greeter').greet('hi')
```

> 能力段（on/emit/nodes/theme/commands/slots/settings…）是真实成员，不受这个 Proxy 影响；只有不存在的属性名才走服务解析。

---

## 5. 类型增强：`declare module ... Services` 让 ctx.get 有类型

想让 `ctx.get<X>('foo')` / `ctx.foo` 拿到类型提示，在作者侧声明合并 `Services` 空接口：

```ts
import type { Context, Service } from '@mini-canvas/canvas-core-v2'

declare module '@mini-canvas/canvas-core-v2' {
  interface Services { greeter: GreeterService }   // 名 → 服务类型
}

export class GreeterService extends Service {
  constructor(ctx: PluginScope) { super(ctx, 'greeter') }
  greet(who: string) { return `Hello, ${who}!` }
}
```

之后别处 `ctx.get('greeter')` 就知道返回 `GreeterService`。

---

## 6. Service 基类 = "上架服务"的类形态最顺手写法

写服务的最省事方式：**继承 `Service`，构造里 `super(ctx, name)`** —— 它替你调 `ctx.provide(name, this)`，把实例上架。

```ts
import { Service, type PluginScope } from '@mini-canvas/canvas-core-v2'

class GreeterService extends Service {
  constructor(ctx: PluginScope) { super(ctx, 'greeter') }  // 上架 'greeter'
  greet(who: string) { return `Hello, ${who}!` }
}

// 作为插件装载
ctx.plugin({
  name: 'greeter-plugin',
  apply(c) { new GreeterService(c) },
})
await ctx.start()
ctx.get('greeter').greet('world')   // 'Hello, world!'
```

`Service` 抽象类签名：

```ts
abstract class Service {
  readonly ctx: PluginScope
  readonly name: string
  constructor(ctx: PluginScope, name?: string)  // name 缺省取子类静态 provide
}
```

- 不传 name → 取子类静态 `provide` 字段。
- 都没有 → 抛错 `[core] Service 需传 name 或给子类静态 provide 字段`。
- Service 也是"类形态插件"，可直接 `ctx.plugin(GreeterService)`（见插件篇）。

**Service 类形态静态声明**（`ServiceClass`）：子类可用静态字段标注，供装配/依赖编排读取：

```ts
class GreeterService extends Service {
  static provide = 'greeter'        // 默认服务名（可多个：string | string[]）
  static inject = [] as string[]    // 依赖
  static Config = { ... }           // 配置 schema
}
```

> Service 随提供插件卸载自动撤下（上架撤销挂在插件 scope）。实测：装→get 有；卸→get 返回 undefined。

---

## 7. 供宿主 / 根层直接注入的口子

宿主在 start 前给内核塞"常驻服务"，用根 `Context.inject`：

```ts
const ctx = new Context()
ctx.inject('nodeStore', new NodeStore())
ctx.inject('themeRegistry', new ThemeRegistry())
await ctx.start()
```

> **区别**：根 `Context.inject` 的撤销由调用方持有并手动执行（**不自动登记清理**）；插件 ctx（PluginScope）的 `inject`/`provide` 撤销**自动挂插件 fiber**。要用插件自动回收，请用插件 ctx 上的那套。

其它诊断辅助：`ctx.injectedServices()` 返回已注入服务名列表（dev 用）。

---

## 8. 坑与速记

1. **重复上架抛错**（`already injected`）。想"换服务"先撤销旧的再上架。
2. **`get` 缺服务返回 undefined，不抛**。硬依赖判断别指望 get 抛错——用插件 `inject` 字段让内核编排，或自己判 undefined。
3. **根 Context.inject 不自动回收**；插件 ctx.inject/provide 自动回收。别搞混。
4. `provide` 和 `inject` 完全一样，别纠结用哪个；Service 内部用的是 provide。
5. `'slots'` 和 `'settings'` 恒在；其它内核约定服务需宿主手动注入。
