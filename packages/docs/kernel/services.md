# 服务注入：`ctx.get` / `inject` / `provide` 与 Service 基类

**一句话定位**：**服务就是「一个挂上名字的能手」——一方把对象上架（`inject` / `provide`），另一方按名字取来用（`ctx.get`）。**

**它属于哪一档**：**内核自带（框架层）**。源码：`packages/kernel/src/Context.ts`（`inject` / `provide` / `get` / `tryGet` / `hasService` / 插件视图 `deriveScope`）、`packages/kernel/src/service.ts`（`Service` 基类）、`packages/kernel/src/types.ts`（`Services` 类型缝、`PluginScope`）。

## 它是什么

教室里有一台**公共工具箱**：

- **上架**：谁有本事，就把自己的工具写个名字挂到墙上（`provide` / `inject`）。
- **取用**：别人要干活，按名字从墙上拿（`ctx.get('名字')`）。
- **先声明再干活**：如果「没有那把工具我就干不了」，要提前在门口写一行「我需要它」（模块级 `export const inject = [...]`）——
  没挂出来之前，我就在门口等着，不进去。

按「数据 / 展示 / 能力 / 配置」分，服务管的是**能力**：一个有状态、有方法的对象（`doc`、`selection`、`view`……）。

它和**注册场**是两件事，记这条判据就行：

> **「一个能手」是服务（会换实现才做服务），「一张表」是场。**

## 为什么需要它

如果两个插件想互相用能力，又**不允许互相 import**（那是死结：以后换实现要改一片文件），那就只能靠「名字」约会：

```
插件 A 提供 'greeter'  ─────►  服务表（name → 对象）  ◄─────  插件 B 取 'greeter'
```

- **换实现不用改消费方**：只要新实现还叫 `greeter`、方法还叫 `greet`，B 一行都不用改。
- **顺序不用人肉保证**：B 把 `greeter` 写进 `inject`，框架会等 A 上架之后才跑 B。
- **回收不用手写**：B 放下监听、A 上架服务，卸载时都自动撤（见 [作用域 Scope](/kernel/scope)）。

## 怎么用

### 一、上架：`inject` 与 `provide` 完全等价

两个方法做的是**同一件事**：把对象以某个名字登记进服务表，返回一个「撤销函数」。

```ts
// 插件 ctx 上（推荐写法）
provide<Service>(name: string, impl: Service): () => void
inject<Service>(name: string, impl: Service): () => void   // 与 provide 逐字等价
```

源码里 `provide` 的实现就是一行 `return this.inject(name, impl)`；插件视图里两段代码也是逐字复制的（`packages/kernel/src/Context.ts` 的 `deriveScope`）。
**不用纠结用哪个**——`Service` 基类内部用的是 `provide`。

两条硬规矩：

1. **服务名全局唯一**：同名再上架抛 `[core] Service "xxx" is already injected`。
2. **插件 scope 上的上架自动回收**：撤销函数自动登记进本插件 fiber，插件卸载（热卸 / `stop()`）即撤下 —— 你**不用**接那个返回值。

```ts
// 文件：my-plugin/src/index.ts 里的一小段
export function apply(ctx: Context) {
  // 上架 'clock' 服务；插件卸载时它自动消失（不用手动调返回值）
  ctx.provide('clock', { now: () => Date.now() })
}
```

### 二、依赖声明：模块级 `export const inject = [...]`（硬依赖）

注意别被同名搞混：**`ctx.inject(name, impl)` 是「上架服务」**，而**模块级 `export const inject = [...]` 是「声明依赖」**。
写法不同、用途不同：

```ts
// 文件：my-plugin/src/index.ts
export const name = 'consumer'
export const inject = ['greeter']       // ← 依赖声明：我要 greeter 就绪才跑

export function apply(ctx: Context) {
  // 走到这里时，框架已经保证 greeter 在
  ctx.get('greeter').greet('world')
}
```

`inject` 数组里可以写两类名字（`packages/kernel/src/Context.ts` 的 `depSatisfied` 判定）：

| 写什么 | 什么时候算「满足」 |
| --- | --- |
| **服务名**（如 `greeter`、`doc`） | 已上架进服务表，或它是内核/能力层的内置服务 |
| **插件名**（如 `canvas-base`） | 那个插件已登记且它的 fiber 处于 `active` |

不满足就**停在 `pending`，安静等**——不报错。之后提供方一出现（`provide` 或那个插件被激活），内核的 `wakePending()` 会自动把它唤醒、跑起来。

**反向也成立**（这条很多人不知道）：提供方被热卸后，依赖它的插件会自动**回退到 `pending`**（副作用先收干净），
等提供方装回来再自动重载。源码在 `Context.retractUnsatisfiedActives`。

### 三、取值：`ctx.get` 缺了返回 `undefined`，不抛

```ts
get<K extends keyof Services>(name: K): Services[K]          // 服务名在 Services 里声明过 → 自动推导类型
get<Service = unknown>(name: string): Service                // 扩展/可选依赖 → 显式给泛型
tryGet<Service = unknown>(name: string): Service | undefined // 语义相同的显式别名：这里是可选依赖
```

**取值顺序**（`Context.get`）：先看**内置服务**（内核自带的 `tools`、能力层提供的 `slots` / `settings`），再看服务表。
内置服务**不进服务表**，所以它们不会跟插件上架的重名检查冲突，而且依赖判定里**恒满足**。

```ts
const maybe = ctx.get('maybe-svc')   // 没有 → undefined，不抛
if (maybe) maybe.doIt()              // 可选能力：有就用，没有就算了
```

**选哪个，一句话**：

| 你的情况 | 用什么 |
| --- | --- |
| 没有它我就干不了 | 模块级 `export const inject = [...]` |
| 有它更好，没有也能跑 | 进 `apply` 里 `ctx.get(...)` 探测，或者 `ctx.tryGet(...)` 把"可选"写明白 |

> `ctx.tryGet` 与 `ctx.get` **运行行为完全一样**（就是一行转发），差别只在**意图**：看到 `tryGet` 就知道这里允许缺失。

### 四、类型增强：`declare module ... Services`

服务名写多了记不住类型？作者侧用**声明合并**把「服务名 → 类型」登记进 `Services` 接口，之后 `ctx.get('greeter')` 自带类型：

```ts
// 文件：my-plugin/src/types.ts
// 格式：TypeScript 声明文件（编译期生效，运行时零开销）
// 位置：跟着服务定义放在一起，被同包入口 import 进来即可
import type { GreeterService } from './greeterService'

declare module '@mini-canvas/kernel' {
  interface Services {
    greeter: GreeterService   // ← 名字 → 类型；之后 ctx.get('greeter') 就认识它了
  }
}
```

画布自带的那些服务（`doc` / `selection` / `save` …）就是在 `packages/canvas-data/src/canvas/serviceTypes.ts` 里这样登记一次的 —— 所以插件里
`ctx.get('doc')` 不用手写泛型。

**别写混两个接口**：

| 接口 | 管什么 | 谁在用 |
| --- | --- | --- |
| `Services` | 服务名 → 类型（`ctx.get('doc')` 的类型） | 想给服务补类型的作者 |
| `PluginCapabilities` | `ctx` 上的**能力段**（`nodes` / `theme` / `settings`…） | 能力层（画布层）声明合并进来 |

### 五、`Service` 基类：上架的类形态

「这套插件的主要工作就是上架一个服务」时，写一个 `Service` 子类最省事 —— `super(ctx, name)` 一句就完成上架：

```ts
// 文件：my-plugin/src/greeterService.ts
import { Service, type Context } from '@mini-canvas/kernel'

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')          // 等价于 ctx.provide('greeter', this)
  }
  greet(who: string): string {
    return `Hello, ${who}!`
  }
}
```

签名（`packages/kernel/src/service.ts`）：

```ts
abstract class Service {
  readonly ctx: PluginScope   // 所属上下文（上架服务表的那个）
  readonly name: string       // 服务名
  constructor(ctx: PluginScope, name?: string)  // 不传 name → 取子类静态 provide 字段
}
```

- **不传 `name`** → 取子类静态 `provide`（字符串）；**都没有** → 抛 `[core] Service 需传 name 或给子类静态 provide 字段`。
- **上架随所属插件回收**：`super()` 内部走的是插件 scope 的 `provide`，撤销挂本插件 —— 插件卸载，服务自动撤下。
- **类本身可以当插件**：`ctx.plugin(GreeterService)`。内核的归一规则（`asPluginModule`）会读类静态字段：
  `provide`（数组取第一个）或类名作插件名、静态 `inject` 作依赖、静态 `Config` 作配置 schema、静态 `core` 作核心标记。

### 六、根 `Context.inject` **不**自动回收（这条最容易混）

同一个方法名，在**根 Context** 和**插件 ctx** 上是两种语义：

| | 根 `ctx.inject(name, impl)`（宿主装配用） | 插件 `ctx.inject / provide`（`apply(ctx)` 里的） |
| --- | --- | --- |
| 撤销怎么发生 | 返回撤销函数，**由调用方自己持有、自己调** | 撤销**自动登记进本插件 fiber**，卸载即撤 |
| 谁该用 | 宿主装配：`start()` 前注入常驻服务 | 插件作者：上架自己提供的能力 |
| 忘了调撤销会怎样 | 服务一直留在表里（`stop()` 时随生命周期清空） | 不存在这个问题（框架替你清了） |

源码注释写得很直白（`Context.inject`）：

> 提供服务（宿主/根层用）；返回撤销函数。注：本根方法不自动登记清理，撤销由调用方持有并执行；
> 插件层请走注入的 `PluginScope.provide`（撤销随插件 fiber 自动清）。

宿主侧的真实用法（`packages/canvas-render/src/host/createMiniCanvasHost.ts`）：

```ts
const view = new ViewService({ nodeStore })
ctx.inject('view', view)               // 根 ctx：注入几何 + 视口服务
// ……它跨整个生命周期，宿主不主动撤销；ctx.stop() 时服务表随生命周期清空
```

### 七、属性直读：`ctx.greeter`（插件专属的糖）

插件 ctx 是个 `Proxy`：读属性时先看真实成员，没有就当服务名查表。所以：

```ts
export const inject = ['greeter']
export function apply(ctx: Context) {
  ctx.greeter.greet('world')          // 与 ctx.get('greeter').greet('world') 运行时等价
}
```

这层糖**只在插件 ctx 上**（`deriveScope` 里包了 Proxy）。组件、宿主拿到的是根 `Context`，
那边**没有** Proxy，必须写 `ctx.get('greeter')`。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/canvas-data/src/canvas/canvasBasePlugin.ts` | 基础插件一次性 `ctx.inject(...)` 上架 `doc` / `save` / `selection` / `resources` |
| `packages/canvas-render/src/host/createMiniCanvasHost.ts` | 宿主用根 `ctx.inject` 注入 `view` / `canvas` / `nodeToolbar` |
| `packages/kernel/src/Context.ts` | 服务表本体：`inject` / `provide` / `get` / `tryGet` / `hasService` / `depSatisfied` / `wakePending` |
| `packages/kernel/src/service.ts` | `Service` 基类（`super(ctx, name)` → `provide`） |
| `packages/kernel/src/__tests__/service.test.ts` | 锁住三条实测行为：上架可取、卸载即消失、重名抛错 |
| `packages/kernel/src/__tests__/kernelBoundary.test.ts` | 锁住「纯内核只有 `tools`，画布服务一个都取不到」 |
| `packages/canvas-data/src/canvas/serviceTypes.ts` | 画布服务的类型登记（`Services` + `Context` 两处声明合并） |

## 完整例子

一个能在 Node 里直接跑的例子：一个插件**提供** `greeter` 服务，两个插件分别用**硬依赖**和**可选探测**去用它。

### 目录长这样

```
plugin-services-demo/
├── package.json            # 插件清单
└── src/
    ├── greeterService.ts   # 类形态插件：上架 'greeter' 服务
    ├── consumerPlugin.ts   # 对象形态：硬依赖 inject: ['greeter']
    ├── optionalPlugin.ts   # 对象形态：可选探测，缺了也照常跑
    └── main.ts             # 装配脚本：建 → 装 → 启 → 停
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/plugin-services-demo/`。

### 文件一：提供方（类形态 + 类型增强）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-services-demo/src/greeterService.ts
// 格式：TypeScript 模块（类形态插件：提供并上架一个服务）
// 位置：插件包里「提供方」的那一件
import { Service, type Context } from '@mini-canvas/kernel'

declare module '@mini-canvas/kernel' {
  interface Services {
    greeter: GreeterService           // ① 类型登记：ctx.get('greeter') 从此自带类型
  }
}

export class GreeterService extends Service {
  static provide = 'greeter'          // ② 插件名与服务名都用它（asPluginModule 读静态 provide）
  constructor(ctx: Context) {
    super(ctx)                        // 不传 name → 取静态 provide，等价于 super(ctx, 'greeter')
  }
  greet(who: string): string {
    return `Hello, ${who}!`
  }
}
```

### 文件二：消费方（硬依赖）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-services-demo/src/consumerPlugin.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：插件包里「依赖方」的那一件
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'consumer'
export const inject = ['greeter'] as string[]   // ① 硬依赖：greeter 没就绪，本插件停在 pending

export function apply(ctx: Context): void {
  // ② 走到这里，框架已保证 greeter 在（inject 编排过了）
  const greeter = ctx.get('greeter')            // 类型自动推导成 GreeterService（文件一登记过）
  console.log('[consumer]', greeter.greet('world'))

  // ③ 属性直读糖：与上一行运行时等价（插件 ctx 专属）
  console.log('[consumer]', ctx.greeter.greet('proxy'))
}

export const consumerPlugin: PluginModule = { name, inject, apply }
```

### 文件三：可选探测（缺了也能跑）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-services-demo/src/optionalPlugin.ts
// 格式：TypeScript 模块（插件入口，但依赖是可选的）
// 位置：插件包里「有就用、没有就算了」的那一件
import type { Context, PluginModule } from '@mini-canvas/kernel'
import type { GreeterService } from './greeterService'

export const name = 'optional'
export const inject = [] as string[]            // ① 不写 greeter：它不是硬依赖

export function apply(ctx: Context): void {
  // ② 可选探测：缺服务返回 undefined，不抛
  const greeter = ctx.get<GreeterService>('greeter')
  const byTry = ctx.tryGet<GreeterService>('greeter')
  console.log('[optional] greeter 在不在：', !!greeter, '（tryGet 一样：', !!byTry, '）')
  if (greeter) console.log('[optional]', greeter.greet('optional'))
}

export const optionalPlugin: PluginModule = { name, inject, apply }
```

### 文件四：装配脚本

```ts
// 文件：packages\docs\public\examples\kernel\plugin-services-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：把提供方与两个消费方装进同一个内核
import { Context } from '@mini-canvas/kernel'
import { GreeterService } from './greeterService'
import { consumerPlugin } from './consumerPlugin'
import { optionalPlugin } from './optionalPlugin'

const ctx = new Context({ dev: true })  // ① 建

ctx.plugin(consumerPlugin)              // ② 故意先装依赖方：顺序无所谓，框架会排
ctx.plugin(optionalPlugin)
ctx.plugin(GreeterService)              //    装提供方（类形态）

await ctx.start()                       // ③ 启：多轮激活，consumer 等 greeter 就绪后才跑

console.log('[main] 插件状态：', ctx.inspectPlugins().map((p) => `${p.name}=${p.state}`).join(', '))

ctx.uninstallPlugin('greeter')          // ④ 热卸提供方
console.log('[main] 卸完 greeter 后，服务还在吗：', !!ctx.get('greeter'))
console.log('[main] consumer 现在：', ctx.inspectPlugins().find((p) => p.name === 'consumer')?.state)

ctx.stop()
```

预期行为：`consumer` 即便先注册也会等到 `greeter` 就绪才跑；`uninstallPlugin('greeter')` 之后
`ctx.get('greeter')` 变成 `undefined`，且 `consumer` **自动回退成 `pending`**（连坐语义）。

## 常见坑

1. **`ctx.get` 缺服务返回 `undefined`，不抛**。所以「取不到」永远不报错 —— 想要硬依赖必须用模块级
   `export const inject = [...]`，别指望 `get` 帮你判错。
2. **同名重复上架会抛错**（`already injected`）。要换实现，先撤销旧的（插件 scope 的撤销随卸载自动发生；根 ctx 的要自己调返回的撤销函数）。
3. **根 `Context.inject` 不自动回收**；插件 ctx 的 `inject` / `provide` 自动回收。诊断「为什么服务卸不掉」时先看这一点。
4. **老服务名已下线**：`nodeStore` / `edgeStore` / `graph` / `history` 取不到（合并成 `doc`）。写进 `inject` 会让插件**永久停在 pending**，且不报错 —— 排查卡住时先核对服务名。
5. **属性直读 `ctx.greeter` 只在插件 ctx 上成立**。宿主 / 组件里的 ctx 没有 Proxy，写 `ctx.get(...)`。
6. **依赖可以写插件名**，但判定条件是「那个插件此刻 `active`」。写插件名会让耦合更紧；能用服务名就用服务名。
7. **`tryGet` 和 `get` 是一回事**（运行行为相同），选 `tryGet` 只是为了让人一眼看出「这里允许缺」。

