# 类型化事件与 EventBus

**一句话定位**：**事件就是「喊一嗓子」——喊的人不关心有没有人听；想听的人提前举手（`on`），喊出来时他们就收到。一次喊话可以有五种跑法。**

**它属于哪一档**：**内核自带（框架层）**。源码：`packages/kernel/src/EventBus.ts`（总线本体与五种分发）、`packages/kernel/src/types.ts`（`EventMap` / `Events` 两张类型表、`EventHandlerFor` / `EventArgsFor` 两个解析器）、`packages/kernel/src/Context.ts`（`ctx` 上的七个转发方法）。

## 它是什么

一个**单源事件总线**（不碰 `window`、不碰全局 DOM）：

- **举手**：`ctx.on('某事件', 回调)` —— 订阅；`ctx.once` 是「只听一次」。
- **喊话**：`ctx.emit('某事件', 参数…)` —— 广播；有没有人听都照样喊。
- **怎么跑**：听众多的时候，按顺序跑、还是一起跑、还是谁先答算谁的 —— 一共五种，见下。

按「数据 / 展示 / 能力 / 配置」分，事件管的是**通知**：不留数据、不做决定，只负责「这件事发生了，想知道的知道」。

它和「服务」的区别：服务是**取一个能手来干活**（有返回值、有状态），事件是**通知一声**（喊话的人不等待、不关心）。

## 为什么需要它

如果没有事件，插件之间想联动只有两条路：要么互相 import（死结），要么轮询（低效）。

事件把双方**拆开**：

```
提供方插件 ──emit('tools/result', …)──► 事件总线 ──► 观察方插件（on('tools/result', …)）
```

两个插件**互不认识**，只认识一个事件名。这正是仓库里「工具日志插件」能写出来的原因：它不需要 inject 任何服务，
只要 `ctx.on('tools/result', …)` 就能记录每一次模型工具调用。

## 怎么用

### 一、订阅与广播：`on` / `once` / `emit`

```ts
on<K extends string>(name: K, handler: EventHandlerFor<K>): Disposable
once<K extends string>(name: K, handler: EventHandlerFor<K>): Disposable
emit<K extends string>(name: K, ...args: EventArgsFor<K>): void
```

- `on` / `once` 返回 **`Disposable`**（`{ dispose() }`）。**插件里不用接它** —— 订阅会自动登记进本插件 fiber，
  插件卸载即自动取消。想提前取消才需要接住调 `.dispose()`。
- `emit` **同步**逐个跑监听，**不等也不收集返回值**。单个监听抛错会被吞掉，**不阻断其它监听**（源码里每个回调一个 `try/catch`）。
- 底层监听统一是 `(...args) => void`（rest-arg），所以「一个对象 payload」和「多个参数」两种形态都能承载。

```ts
// 文件：my-plugin/src/index.ts 里的一小段
ctx.on('ctx:ready', ({ plugins }) => console.log('就绪', plugins))   // 单 payload 形态
ctx.once('my:boot', (n: number) => console.log('只听一次', n))       // 只听一次
ctx.emit('my:boot', 1)
```

### 二、五种分发模式（逐个讲清语义与返回值）

`ctx` 上五个方法都是**转发到内部那条总线**，所以 `ctx.parallel` 与 `bus.parallel` 行为完全一致。

| 方法 | 怎么跑 | 返回值 | 出错会怎样 |
| --- | --- | --- | --- |
| `emit` | 同步**逐个**跑，不等、不收集 | `void` | 单个监听抛错被吞，不阻断其它 |
| `parallel` | **并发**跑所有监听，一起等 | `Promise<void>` | 有监听 reject → 抛 `AggregateError`（`errors` 里是各家原因） |
| `serial` | **顺序 `await`**，遇到 bail 值就停 | `Promise<any>`（胜出的那个值） | 监听抛错往上冒，后面的不跑 |
| `bail` | `serial` 的**同步版** | `any`（胜出的那个值） | 同上 |
| `waterfall` | **环绕中间件**：层层包住「最内层默认行为」 | `any`（最外层返回值） | 同上 |

```ts
parallel<K extends string>(name: K, ...args: EventArgsFor<K>): Promise<void>
serial<K extends string>(name: K, ...args: EventArgsFor<K>): Promise<any>
bail<K extends string>(name: K, ...args: EventArgsFor<K>): any
waterfall<K extends string>(name: K, ...args: EventArgsFor<K>): any
```

#### `emit` —— 同步广播

```ts
bus.emit('e', 1, 2)   // 两个监听都被同步调到，返回值被忽略
```

#### `parallel` —— 并发跑，一起等

所有监听**同时**开始跑，等全部结束（`Promise.allSettled`）才返回。谁先跑完不影响顺序 —— 只是都等齐。

```ts
await ctx.parallel('sync:save')   // 三个插件同时保存；都完了才继续
```

有任意监听 reject 时抛 `AggregateError`，不是第一个错误 —— 谁错了全在 `errors` 里。

#### `serial` —— 顺序 await，第一个「有效答复」胜出并停止

这是最需要记准语义的一个。**判定函数是 `isBailed(value)`**（源码 `packages/kernel/src/EventBus.ts`）：

```ts
export function isBailed(value: any): boolean {
  return value !== null && value !== false && value !== undefined
}
```

也就是说：

| 监听返回 | 算不算「有效答复」 | 后果 |
| --- | --- | --- |
| `undefined` | 不算 | 继续问下一个 |
| `null` | 不算 | 继续 |
| `false` | 不算 | 继续 |
| `0` | **算** | 立即返回 `0` 并停止 |
| `''`（空串） | **算** | 立即返回 `''` 并停止 |
| 任何对象 / 非空串 / 非零数 / `true` | **算** | 立即返回它并停止 |

```ts
// 三个监听依次被问「能不能处理」
bus.on('approve', async () => undefined)   // 不算答复 → 继续
bus.on('approve', async () => 'STOP')      // 算答复 → 立即返回 'STOP'，第三个不再跑
bus.on('approve', () => { throw new Error('不该跑到这里') })

const winner = await bus.serial('approve') // 'STOP'
```

> 注意两个反直觉点：**`0` 和 `''` 都会被当成 «有效答复»**（因为只排除 `null` / `false` / `undefined`）；
> 想让「没人处理」的意思是「继续问下一个」，就返回 `undefined` / `false` / `null`。

#### `bail` —— `serial` 的同步版

一模一样，只是**不 `await`**：谁先同步返回有效值谁赢。

```ts
const picked = ctx.bail('pick:icon')   // 同步；返回第一个有效值
```

#### `waterfall` —— 环绕中间件

**最后一个参数是「最内层默认行为」**，监听器从外层到内层依次套上：

- 调 `next()` 进入下一层；
- **不调 `next()` 直接返回 = 有意短路**（否决下游，连最内层都不会跑）。

源码的拼装方式（`EventBus.waterfall`）：把最后一个参数 `pop` 出来当 `inner`，再把一个 `next` 函数 `push` 回参数列表的末尾；
`next()` 每调一次就往下取一个监听，取完了就用 `inner`。

```ts
// 内层默认行为：原样返回
const inner = (s: string) => `default:${s}`

// 监听 1：包外层，把下游结果转大写
ctx.on('demo', (input: string, next: () => string) => next().toUpperCase())

// 监听 2：看到 blocked 就短路（不调 next）
ctx.on('demo', (input: string, next: () => string) =>
  input.includes('blocked') ? '** BLOCKED **' : next(),
)

ctx.waterfall('demo', 'hello', inner)          // 'DEFAULT:HELLO'（层层包上去）
ctx.waterfall('demo', 'blocked words', inner)  // '** BLOCKED **'（inner 从未运行）
```

> **监听器要按多参写**：`waterfall` 事件里，监听的**最后一个形参**就是 `next`。别把它当普通 payload。

### 三、事件名类型从哪来：`EventMap` 与 `Events`

内核里有**两张**事件类型表，长得像但形状不同（都在 `packages/kernel/src/types.ts`）：

| | `EventMap` | `Events` |
| --- | --- | --- |
| 形状 | **事件名 → payload 类型**（单对象） | **事件名 → 监听函数签名**（支持多参） |
| 例子 | `'ctx:ready': { plugins: string[] }` | `'ctx:ready'(payload: { plugins: string[] }): void` |
| 扩展写法 | `declare module '@mini-canvas/kernel' { interface EventMap { 'x:y': { n: number } } }` | `declare module '@mini-canvas/kernel' { interface Events { 'stats/report'(name: string, count: number): void } }` |

四个内置事件在两张表里**都有**（同键），保证 `keyof Events` 非空，`ctx.on` / `emit` 的类型化重载才有落点。

**解析规则**（`EventHandlerFor` / `EventArgsFor`，逐字来自源码）：

1. 事件名在 `Events` 里（含内置与作者 declare 扩展）→ 用 `Events[K]`，**参数与返回值都按它推**；
2. 只在 `EventMap` 里（单 payload 形态）→ 用 `EventListener<K>`，参数就是那一个 payload；
3. 都不在（任意字符串）→ 松类型 `(...args: any[]) => any`。

想给自己新造的多参事件补类型，就 declare `Events`：

```ts
// 文件：my-plugin/src/events.d.ts（或任意被加载的 .ts 里）
declare module '@mini-canvas/kernel' {
  interface Events {
    'my:progress'(done: number, total: number): void
  }
}
// 之后 ctx.on('my:progress', (done, total) => …) 与 ctx.emit('my:progress', 1, 10) 都有类型
```

### 四、dev 下未登记事件名会 warn

`new Context({ dev: true })` 时，总线开了 `devWhitelistWarn`。此时：

- **第一次** `emit` 一个**没登记过**的事件名 → 打一条 `console.warn`（提示你可能拼错名字导致静默失效）；
- **同一个名字只 warn 一次**（防刷屏）；
- `dev: false`（缺省）时完全不 warn。

```ts
const ctx = new Context({ dev: true })
ctx.emit('ctx:ready', { plugins: [] })  // 内置登记名 → 不 warn
ctx.emit('some/typo', 1)                // 未登记 → warn 一次
ctx.emit('some/typo', 2)                // 同名已 warn 过 → 不再 warn
```

**消除 warn 有两条路**（选一条即可）：

```ts
import { registerEventName, hasKnownEvent, knownEventNames } from '@mini-canvas/kernel'

registerEventName('my:event')   // ① 运行时显式登记
hasKnownEvent('my:event')       // → true
knownEventNames()               // → 全部已登记事件名（返回副本，改不到内部表）

// ② 或在 interface Events / EventMap 里 declare（编译期登记）
```

> **登记表是全进程共用一张**（模块级 `knownEvents`），不是每条总线各一份。所以一个插件登记过，别处的总线也不 warn。
> 想知道「这台内核上都有哪些事件可监听」，读 `ctx.surface().events`（`surface.ts` 的 events 轴取的就是 `knownEventNames()`）。

三条工具事件（`tools/registered` / `tools/unregistered` / `tools/result`）在 `packages/kernel/src/modelTool.ts`
**模块加载时**就登记好了，不用你操心。

### 五、`EventBus`：可以单独拿出来用的总线类

内核内部用的是 `EventBus` 这个类，它**不依赖 `Context`**，可以 `new` 出来当独立的事件中枢（模块内部的发布订阅、跨模块通信都行）：

```ts
import { EventBus } from '@mini-canvas/kernel'

const bus = new EventBus()   // 可选参数：{ devWhitelistWarn?: boolean }

const off = bus.on('tick', (n: number) => console.log(n * 2))
bus.emit('tick', 21)         // 42
off()                        // 取消订阅
bus.has('tick')              // false（没有监听者了）

bus.clear()                  // 清空所有监听
```

`EventBus` 的完整成员（签名逐字来自 `packages/kernel/src/EventBus.ts`）：

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| 构造 | `new EventBus(options?: { devWhitelistWarn?: boolean })` | 缺省不 warn |
| `on` | `on(name: string, handler: (...args: any[]) => any): () => void` | 订阅，返回**取消函数** |
| `once` | `once(name: string, handler: (...args: any[]) => any): () => void` | 订阅一次 |
| `off` | `off(name: string, handler: (...args: any[]) => any): void` | 精确取消某一个 handler |
| `emit` | `emit(name: string, ...args: any[]): void` | 同步广播 |
| `parallel` | `parallel(name: string, ...args: any[]): Promise<void>` | 并发一起等 |
| `serial` | `serial(name: string, ...args: any[]): Promise<any>` | 顺序，bail 值胜出停 |
| `bail` | `bail(name: string, ...args: any[]): any` | 同步短路 |
| `waterfall` | `waterfall(name: string, ...args: any[]): any` | 环绕中间件 |
| `clear` | `clear(): void` | 清空所有监听 |
| `has` | `has(name: string): boolean` | 某事件有没有监听者（决定要不要造昂贵 payload） |

**和 `ctx` 那套的两个差别**：

1. `EventBus` 的 `on` 返回的是**普通取消函数**（不是 `Disposable`，也不自动回收）—— 要自动回收请自己 `scope.onDispose(off)`；
2. `ctx.on` / `ctx.once` 返回 `Disposable`，且**自动登记进插件 fiber**。

### 六、内核内置的四个事件

| 事件名 | 参数 | 何时发 |
| --- | --- | --- |
| `ctx:ready` | `{ plugins: string[] }` | `start()` 把能激活的插件全激活完后（`plugins` = 本批激活的名字） |
| `ctx:plugin-installed` | `{ name: string }` | 某插件成功激活 |
| `ctx:plugin-uninstalled` | `{ name: string }` | 某插件卸载完成 |
| `ctx:lifecycle-change` | `{ name: string; lifecycle: Lifecycle }` | 某插件生命周期状态变化 |

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/kernel/src/EventBus.ts` | 总线本体 + `isBailed` + `registerEventName` / `hasKnownEvent` / `knownEventNames` |
| `packages/kernel/src/Context.ts` | `ctx` 的七个事件方法（转发到 `this.bus`）；`devWhitelistWarn` 由构造选项决定 |
| `packages/kernel/src/modelTool.ts` | 登记 `tools/registered` / `tools/unregistered` / `tools/result` 三条事件；`runToolCall` 在结果物化时发 `tools/result` |
| `packages/kernel/src/__tests__/events.test.ts` | 锁住五种分发与 dev warn 的实测行为 |
| `packages/canvas-render/src/host/renderEvents.ts` | 渲染层自己登记 + 广播的渲染事件（真实消费点示例） |
| `packages/plugins/plugin-theme-default/src/index.ts` | `registerEventName('settings:ui-close')`：插件登记自己的事件名，消掉 dev warn |

## 完整例子

一个能在 Node 里直接跑的示例：一个插件喊话，两个插件听；`serial` 用「谁能处理就谁处理」的方式选出处理者。

### 目录长这样

```
plugin-events-demo/
├── package.json           # 插件清单
└── src/
    ├── speakerPlugin.ts   # 喊话方：emit 一个多参事件 + 一个 serial 请求
    ├── listenerPlugin.ts  # 听众 1：听广播；serial 里先「放弃」
    ├── handlerPlugin.ts   # 听众 2：听广播；serial 里接住（胜出）
    └── main.ts            # 装配脚本
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/plugin-events-demo/`。

### 文件一：喊话方

```ts
// 文件：packages\docs\public\examples\kernel\plugin-events-demo/src/speakerPlugin.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：插件包里「喊话」的那一件
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'speaker'

export function apply(ctx: Context): void {
  // ① 启动完成后广播一条普通通知（ctx:ready 是内置登记名，不会 warn）
  ctx.on('ctx:ready', () => {
    ctx.emit('demo:hello', 'speaker', 42)
    void askWhoCanHandle(ctx)
  })
}

async function askWhoCanHandle(ctx: Context): Promise<void> {
  // ② serial：顺序问每个听众「你能处理吗」，谁先给出有效答复就停
  const winner = await ctx.serial('demo:handle')
  console.log('[speaker] 抢到处理权的是：', winner)
}

export const speakerPlugin: PluginModule = { name, apply }
```

### 文件二：听众 1（先放弃）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-events-demo/src/listenerPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：插件包里「听」的那一件
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'listener'

export function apply(ctx: Context): void {
  // ① on：听多参广播（ctx.on 的订阅随本插件自动回收）
  ctx.once('demo:hello', (who: string, n: number) => {
    console.log(`[listener] 收到 ${who} 的问候，数字是 ${n}`)
  })

  // ② serial 的第一棒：返回 undefined = 不算有效答复 → 内核继续问下一个
  ctx.on('demo:handle', () => {
    console.log('[listener] 我处理不了，让给下一个')
    return undefined
  })
}

export const listenerPlugin: PluginModule = { name, apply }
```

### 文件三：听众 2（接住，胜出）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-events-demo/src/handlerPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：插件包里「接活」的那一件 —— 它在 serial 链上排在 listener 后面
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'handler'

export function apply(ctx: Context): void {
  // ① 同一个事件名，第二个听众。serial 按**注册序**依次问：listener 先（放弃），我后（接住）
  ctx.on('demo:handle', () => {
    console.log('[handler] 我来处理')
    return { by: 'handler' }   // ② 非 null/false/undefined → 有效答复，serial 立即返回它并停止
  })

  console.log('[handler] 已挂上 demo:handle 监听')
}

export const handlerPlugin: PluginModule = { name, apply }
```

### 文件四：装配脚本

```ts
// 文件：packages\docs\public\examples\kernel\plugin-events-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：把喊话方与两个听众装进同一个内核
import { Context } from '@mini-canvas/kernel'
import { handlerPlugin } from './handlerPlugin'
import { listenerPlugin } from './listenerPlugin'
import { speakerPlugin } from './speakerPlugin'

const ctx = new Context({ dev: true })   // ① dev: true → 未登记事件名会 warn

// ② 未登记的自定义事件名：dev 下 console.warn 一次（不影响运行）
ctx.emit('demo:not-registered', 1)

// ③ 注册序决定 serial 的询问顺序：listener 先、handler 后
ctx.plugin(speakerPlugin)
ctx.plugin(listenerPlugin)
ctx.plugin(handlerPlugin)

await ctx.start()
ctx.stop()
```

跑起来会看到（实测输出）：

```
[handler] 已挂上 demo:handle 监听
[EventBus:dev] emit 了未声明的事件名 "demo:hello"。若是有意的新事件，请先调用 registerEventName 登记…
[listener] 收到 speaker 的问候，数字是 42
[listener] 我处理不了，让给下一个
[handler] 我来处理
[speaker] 抢到处理权的是： { by: 'handler' }
```

> 注意 `demo:hello` 这条 warn：它说明「名字没登记」。不想看到它就 `registerEventName('demo:hello')`，
> 或者在 `interface Events` 里 declare 一下（见上文「dev 下未登记事件名会 warn」）。

## 常见坑

1. **`emit` 不等返回值**。想等结果或收集答复，用 `parallel` / `serial` / `bail` / `waterfall`。
2. **bail 判定只排除 `null` / `false` / `undefined`**。`0`、`''`、空数组都会**立刻胜出并停止**后面的监听 ——
   想表达「不处理」，返回 `undefined` / `false` / `null` 之一。
3. **`waterfall` 的最后一个参数是「最内层 next」**，不是 payload。监听里不调 `next()` = 有意短路（否决下游）。
4. **`parallel` 有监听 reject 就抛 `AggregateError`**。想吞错得自己包 `try/catch`。
5. **dev warn 要 `dev: true` 才生效**，而它只能提醒「名字没登记」，管不了「名字拼对了但没人听」。要类型保障就 declare `Events`。
6. **`EventBus` 的 `off` 要自己管**。要自动回收就用 `ctx.on`（挂 fiber），或自己把取消函数登记进 `scope.onDispose`。
7. **订阅回调里抛错在 `emit` 路径上被吞掉**（不阻断其它监听）。所以「我明明 emit 了但没反应」时，
   先在回调第一行打日志，别假设异常会浮上来。



