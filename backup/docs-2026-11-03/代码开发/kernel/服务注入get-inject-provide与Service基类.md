# 服务注入：`ctx.get` / `inject` / `provide` 与 Service 基类

> 来源：`packages/kernel/src/Context.ts`（`inject` / `provide` / `get` / `tryGet` / `hasService` / `deriveScope` 的服务解析 Proxy）、`packages/kernel/src/service.ts`、`packages/kernel/src/types.ts`（`Services` 接口）、`packages/kernel/src/pluginClass.ts`。

插件之间怎么互相"借能力"？内核用一套**服务注入**：一方把服务**上架**，另一方**声明依赖**或**按名取**。

---

## 1. 先分清三个词

| 词 | 是干嘛的 | 用什么 |
| --- | --- | --- |
| **上架 / 提供** | 把一个对象以某个名字存进服务表，别人能取 | `ctx.inject(name, impl)` / `ctx.provide(name, impl)` |
| **取服务** | 从服务表按名拿对象 | `ctx.get(name)`（缺了返回 `undefined`，不抛） |
| **硬依赖声明** | 告诉内核"我没它不启动" | 插件模块级的 `export const inject = [...]` |

- `inject(name, impl)` 与 `provide(name, impl)` **完全等价**（provide 内部就是调 inject）。`Service` 子类的 `super(ctx, name)` 内部调的是 `provide`。
- 服务名全局唯一，重复上架抛 `[core] Service "xxx" is already injected`。
- `ctx.get(name)` 命中顺序：**先看内核 / 能力层的内置服务**（如 `tools`），再看服务表。

```ts
// 提供方：把对象上架为 greeter
ctx.plugin({
  name: 'greeter-plugin',
  apply(c) {
    c.provide('greeter', { greet: (w: string) => `Hello, ${w}` })
    // c.inject('greeter', ...) 也一样
  },
})
```

> **自动回收的区别**（很重要）：
> - **插件 ctx**（`PluginScope`）上的 `inject` / `provide`，撤销自动挂本插件；插件卸载即撤下。
> - **根 `Context.inject` / `provide`**（宿主装配用）**不自动回收**，返回的撤销函数由调用方自己持有并执行。

---

## 2. 消费方两种吃法

### 2.1 硬依赖：`export const inject = [...]`

在插件模块级写服务名，内核会**等这个服务上架后才跑本插件**；缺提供方就停在 PENDING；提供方被卸 / 换还会连坐回退，恢复后自动重载。

```ts
import type { PluginScope } from '@mini-canvas/canvas-base'

export const inject = ['greeter']
export function apply(ctx: PluginScope) {
  const g = ctx.get<{ greet(w: string): string }>('greeter')
  g.greet('world') // 一定拿得到（inject 保证了它已就绪）
}
```

### 2.2 可选探测：`ctx.get(name)` / `ctx.tryGet(name)`

`ctx.get(name)` **缺服务返回 `undefined`（不抛）**，适合"有就用、没有就算了"。用可选依赖的插件，即使缺提供方也照常 apply。

```ts
apply(c) {
  const svc = c.get('maybe-svc') // 没有 → undefined，不抛
  if (svc) svc.doIt()
}
```

> 结论一句话：**必需的依赖用模块级 `inject` 字段声明（让内核编排）；可选的能力用 `ctx.get` 探测。**
> 根 `Context` 上还有个显式别名 `ctx.tryGet(name)`（同样缺了返回 `undefined`），用来把"这里是可选依赖"写清楚；
> `PluginScope` 上没有 `tryGet`，用 `ctx.get` 即可。

---

## 3. `ctx.get` 能拿到哪些内置服务

**内核自带，恒在**：

```ts
const tools = ctx.get('tools') // 生成工具注册表（ToolRegistry），不装能力层也有
```

**画布能力层提供的内置服务**（装了画布层才有）：`slots`（`SlotRegistry`）和 `settings`（`SettingsStore`）。
它们不进服务表，因此不会和插件 `provide` 的重名检查冲突；依赖判定上恒满足。

```ts
const slots = ctx.get('slots') // 画布内核上恒在（SlotRegistry）
const settings = ctx.get('settings') // 画布内核上恒在（SettingsStore）
```

**其它画布服务**（`doc` / `save` / `resources` / `nodeRegistry` / `themeRegistry` / `selection` / `command` / `nodeFactory` /
`nodeLayout` / `viewport`）**由宿主在装配时注入** —— 内核自己不认识它们。纯 `new Context()`（kernel 版）里 `ctx.get` 全返回 `undefined`。

> ⚠️ 老服务名 `nodeStore` / `edgeStore` / `graph` / `history` **已全部下线**（`ctx.get` 取不到，返回 `undefined`），
> 它们合并成了 **`doc`** 一个门面。
> 写法上要记牢：**数据一律走 `ctx.get('doc')`**；写 `inject: ['nodeStore']` 会让插件永久停在 PENDING。

**其它诊断辅助**：根 `Context` 上还有 `ctx.hasService(name)`（是否已注入，含内置）与 `ctx.injectedServices()`（已注入服务名列表，dev 用）。

---

## 4. `ctx.属性名` 直读（Proxy 糖）

插件 ctx 是个 Proxy（`Context.ts:1047`）：读一个属性时，先看它是不是**真实成员**（`on` / `emit` / `nodes` / `theme` / `settings`…），
不是的话就当**服务名**去查表（查不到返回 `undefined`，不抛错）。所以声明 `inject: ['greeter']` 之后：

```ts
// 与 c.get('greeter').greet('hi') 运行时等价
c.greeter.greet('hi')
```

> **开发注意**：内核自己新增 `ctx` 成员时，必须**显式挂到真实对象上**（像 `registryOf` / `state` / `isDev` / `surface` 那样）。
> 漏挂不会抛错，插件里只会静默拿到 `undefined` —— 这类 bug 最难查，所以新增成员要补一条"挂没挂上"的测试。
> 能力段（`nodes` / `theme` / `commands` / `slots` / `settings`）是真实成员，不受这个 Proxy 影响。

---

## 5. 类型增强：`declare module ... Services` 让 `ctx.get` 有类型

想让 `ctx.get<X>('foo')` / `ctx.foo` 有类型提示，作者侧声明合并 `Services` 空接口：

```ts
import type { PluginScope } from '@mini-canvas/kernel'
import { Service } from '@mini-canvas/kernel'

declare module '@mini-canvas/kernel' {
  interface Services { greeter: GreeterService } // 名 → 服务类型
}

export class GreeterService extends Service {
  constructor(ctx: PluginScope) { super(ctx, 'greeter') }
  greet(who: string) { return `Hello, ${who}!` }
}
```

之后 `ctx.get('greeter')` 就知道返回 `GreeterService`。

> 注意：**`PluginCapabilities`（能力段）与 `Services`（服务表）是两个不同的接口**，别写混：
> 画布段（`nodes` / `theme` / `commands` / `slots` / `settings`）由 `@mini-canvas/canvas-data` 的 `canvas/capabilityTypes.ts`
> 声明合并进 `PluginCapabilities`；作者加服务类型走 `Services`。

---

## 6. Service 基类 = "上架服务"的类形态写法

最省事的写法：**继承 `Service`，构造里 `super(ctx, name)`** —— 它替你调 `ctx.provide(name, this)`，把实例上架。

```ts
import { Service, type PluginScope } from '@mini-canvas/kernel'

class GreeterService extends Service {
  constructor(ctx: PluginScope) { super(ctx, 'greeter') } // 上架 'greeter'
  greet(who: string) { return `Hello, ${who}!` }
}

// 作为插件装载
ctx.plugin({
  name: 'greeter-plugin',
  apply(c) { new GreeterService(c) },
})
await ctx.start()
ctx.get('greeter').greet('world') // 'Hello, world!'
```

签名（`packages/kernel/src/service.ts:26`）：

```ts
abstract class Service {
  readonly ctx: PluginScope
  readonly name: string
  constructor(ctx: PluginScope, name?: string) // 不传 name 就取子类静态 provide
}
```

- 不传 name → 取子类静态 `provide` 字段；
- 都没有 → 抛 `[core] Service 需传 name 或给子类静态 provide 字段`；
- Service 子类也可以**直接当插件**传：`ctx.plugin(GreeterService)`（见《插件形态篇》）。此时内核读的是类静态字段 `provide` / `inject` / `Config` / `core`。

> Service 随提供插件卸载自动撤下（上架撤销挂在插件 scope）。实测：装 → `get` 有；卸 → `get` 返回 `undefined`。

---

## 7. 宿主 / 根层直接注入的口子

宿主在 `start` 之前给内核塞"常驻服务"，用根 `Context.inject`：

```ts
import { Context } from '@mini-canvas/canvas-data'

const ctx = new Context()
ctx.inject('doc', doc)
ctx.inject('themeRegistry', themeRegistry)
await ctx.start()
```

> **区别再强调一次**：根 `Context.inject` 的撤销由调用方持有并手动执行（**不自动登记清理**）；
> 插件 ctx 的 `inject` / `provide` 撤销**自动挂插件**。要自动回收，就用插件 ctx 上那套。

---

## 8. 坑与速记

1. **重复上架抛错**（`already injected`）。想换实现，先撤销旧的再上架。
2. **`get` 缺服务返回 `undefined`，不抛**。所以别指望用 get 判错——硬依赖请用模块级 `inject` 字段让内核编排，或自己判 `undefined`。
3. **根 `Context.inject` 不自动回收**；插件 `ctx.inject` / `provide` 自动回收。别搞混。
4. `provide` 和 `inject` 完全一样，不用纠结用哪个；`Service` 内部用的是 `provide`。
5. `tools` 由内核自带（恒在）；`slots` / `settings` 由画布能力层提供（装了画布层才有）；其余画布服务需宿主手动注入。
6. 想把"能取什么服务"一次看全，用 `ctx.surface().services`（只读、零副作用）。
