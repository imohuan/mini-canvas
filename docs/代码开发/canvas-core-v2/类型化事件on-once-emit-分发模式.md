# 类型化事件：ctx.on / once / emit / parallel / serial / bail / waterfall + 扩展自定义事件

> 来源：packages/canvas-core-v2/src/core/types.ts、Context.ts、EventBus.ts

内核内置一套**单源事件总线**（不碰 window、不碰全局 DOM）。插件之间靠 `on/emit` 传消息，还能用五种"分发模式"控制多个监听怎么跑。

---

## 1. 最基础：ctx.on 监听 + ctx.emit 广播

```ts
ctx.plugin({
  name: 'listener',
  apply(c) {
    c.on('my:event', (payload: { from: string }) => console.log(payload.from))
    c.once('my:one', (x) => console.log('只触发一次', x))  // once：触发一次后自动取消
  },
})
await ctx.start()

ctx.emit('my:event', { from: 'ctx' })   // 单 payload 形态（对象事件）
ctx.emit('my:one', 'hi')                // 多参形态（cordis 风格事件）
```

要点：

- `on` / `once` 都返回一个 `Disposable`，可手动提前取消（`{ dispose: off }`）。
- **监听随插件自动回收**：插件在 apply 里 `c.on(...)` 注册的，卸载时自动 off（不用手动）。插件卸载后，它的监听立刻失效。
- 单 payload 事件（传一个对象）与 cordis 多参事件（`emit('x', a, b)`）都支持。

```ts
// 手动提前取消（可选）
const sub = c.on('my:event', () => {})
sub.dispose()      // 现在取消
```

---

## 2. 五种分发模式（EventBus 的 rest-arg 底层）

除了最常用的 `emit`（同步广播、不等返回值），内核还有 4 种更精细的分发，用于"多个监听之间有先后/短路/中间件"逻辑：

| 方法 | 怎么跑 | 返回值 |
| --- | --- | --- |
| `emit` | 同步广播，逐个跑，不等/不收集返回值 | `void` |
| `parallel` | 所有监听**并发**跑并一起等 | `Promise<void>`（有拒绝抛 AggregateError） |
| `serial` | **顺序 await**，第一个 bail 值（非 null/false/undefined）胜出并停 | `Promise<any>`（胜出值） |
| `bail` | serial 的**同步版**（同步短路） | `any`（胜出值） |
| `waterfall` | **环绕中间件**：监听可转写 next() 返回值或短路 | `any` |

### 2.1 emit —— 同步广播

```ts
c.emit('evt', 1, 2)
```
监听抛错被捕获，**不阻断其它监听**。

### 2.2 parallel —— 并发一起等

```ts
await c.parallel('evt')
```
所有监听并发跑，等全部 settle；有监听 reject 则抛 `AggregateError`。

### 2.3 serial —— 顺序，第一个"真值"胜出停

```ts
const result = await c.serial('approve')
// 依次 await 每个监听；哪个先返回 非null/false/undefined 就返回它并停，不再跑后面的
```

### 2.4 bail —— 同步版短路

```ts
const picked = c.bail('pick')   // 同步；第一个 bail 值胜出
```
"bail 判定"（`isBailed`）：返回 `null` / `false` / `undefined` 算"不 bail 继续跑"，其它任何值（0、''、对象…）都算 bail 并停下。注意：**0 和空字符串也 bail**（只排除 null/false/undefined）。

### 2.5 waterfall —— 中间件环绕

waterfall 的最后一个参数是一个"最内层 next"回调。监听器从外层到内层依次跑，每个都可：
- 调 `next()` 进入下一层（最内层是传入的 `inner` 默认行为）；
- 不调 next 直接 return = **短路**（否决下游，最内层不会跑）。

```ts
// 用法：最后一个参是"最内层默认行为"
const inner = (s: string) => `default:${s}`

// 监听1：包外层，把结果转大写
bus.on('demo', (input, next) => next().toUpperCase())
// 监听2：含 blocked 就短路
bus.on('demo', (input, next) => input.includes('blocked') ? '** BLOCKED **' : next())

bus.waterfall('demo', 'hello', inner)       // 'DEFAULT:HELLO'（层层包）
bus.waterfall('demo', 'blocked', inner)     // '** BLOCKED **'（短路，inner 不跑）
```

> ctx 上这 4 种都直接可用：`ctx.parallel / ctx.serial / ctx.bail / ctx.waterfall`，它们只是转发到内部 `bus`。

---

## 3. 事件名怎么得到类型（Events 声明合并扩展自定义事件）

内核内置事件表有两个东西，长得像但用途不同：

### 3.1 `CanvasEventMap` —— 单 payload 对象事件表（向后兼容）

```ts
interface CanvasEventMap {
  'ctx:ready': { plugins: string[] }
  'ctx:plugin-installed': { name: string }
  'ctx:plugin-uninstalled': { name: string }
  'ctx:lifecycle-change': { name: string; lifecycle: Lifecycle }
}
```

作者也可 `declare module` 扩展它（有些测试这么干）：

```ts
declare module './types' {   // 或按你的包路径
  interface CanvasEventMap { 'hello:ping': { from: string } }
}
```

### 3.2 `Events` —— "事件表"（cordis ch4 声明合并缝），推荐扩展入口

`Events` 里每个键 = 事件名，值 = **监听函数签名**（参数即事件参数，支持多参）。

```ts
interface Events {
  'ctx:ready'(payload: { plugins: string[] }): void
  ...
}
```

作者扩展自定义**多参事件**，这样 `on/emit` 就有了参数类型提示：

```ts
declare module '@mini-canvas/canvas-core-v2' {
  interface Events {
    'stats/report'(name: string, count: number): void   // 多参自定义事件
  }
}
// 之后 c.on('stats/report', (name, count) => ...) 有类型；c.emit('stats/report', 'tool', 1) 有类型
```

**事件名解析规则**（`EventHandlerFor` / `EventArgsFor`）：

1. 事件名在 `Events` 里（含内置 + 作者扩展）→ 用它声明的监听函数签名（参数 = 事件参数）。
2. 事件名只在 `CanvasEventMap`（单 payload）→ 用单 payload 形态（`EventListener`）。
3. 两者都不在（未登记的松事件名）→ 松类型 `(...args) => any`。

> 推荐：**自定义事件在 `declare module ... interface Events` 里加**，顺手拿类型。只监听不发射的话，也可仅在 CanvasEventMap 里加单 payload 形态。

---

## 4. dev 白名单警告：emit 未声明事件名会给 console.warn

`new Context({ dev: true })` 会开启 EventBus 的 `devWhitelistWarn`。此时若 `emit` 一个**未在 Events/CanvasEventMap/登记表**里声明的事件名，首次会给一次 console.warn（每个名字只 warn 一次，防刷屏），提示你可能**拼错事件名导致静默失效**。

```ts
const ctx = new Context({ dev: true })
ctx.emit('some/typo', 1)   // dev 下 console.warn 一次，提示未声明
```

消除警告的两种方式：
1. 把事件名在 `Events` / `CanvasEventMap` 里 declare。
2. 调 `registerEventName(name)` 显式登记：

```ts
import { registerEventName } from '@mini-canvas/canvas-core-v2'
registerEventName('my:event')   // 运行时登记，配合 dev 白名单
```

> dev=false（默认）时即使 emit 未声明名也不 warn。内置四事件名默认已登记（不 warn）。

---

## 5. 事件底层：独立的 EventBus 类（可作为独立组件复用）

内核内部用一个 `EventBus`（`EventBus.ts`）。它**不依赖 Context**，可直接 `new` 当独立事件中枢用：

```ts
import { EventBus } from '@mini-canvas/canvas-core-v2'

const bus = new EventBus({ devWhitelistWarn: false })

const off = bus.on('ping', (n: number) => console.log(n * 2))
bus.emit('ping', 21)         // 42
off()                        // 取消
bus.has('ping')              // false（没有监听者了）

// once / off / clear / has / parallel / serial / bail / waterfall 都在 bus 上
```

`EventBus` 公开成员（源码为准）：

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `on` | `on(name, handler): () => void` | 订阅；返回 off 函数 |
| `once` | `once(name, handler): () => void` | 订阅一次 |
| `off` | `off(name, handler): void` | 取消订阅 |
| `emit` | `emit(name, ...args): void` | 同步广播（dev 下可 warn 未声明名） |
| `parallel` | `parallel(name, ...args): Promise<void>` | 并发等全部 |
| `serial` | `serial(name, ...args): Promise<any>` | 顺序，bail 胜出停 |
| `bail` | `bail(name, ...args): any` | 同步短路 |
| `waterfall` | `waterfall(name, ...args): any` | 中间件环绕 |
| `clear` | `clear(): void` | 清空所有监听 |
| `has` | `has(name): boolean` | 某事件是否有监听者 |

顶层导出 `registerEventName`；`isBailed`（bail 判定的纯函数）也在 `EventBus.ts` 里导出，但未进包顶层 barrel，
需要时从子路径 `@mini-canvas/canvas-core-v2/core/EventBus` 导入。

---

## 6. 坑与速记

1. **emit 不等监听返回值**：想等/收集结果用 parallel/serial/waterfall/bail。
2. **serial/bail 的 bail 判定只排除 null/false/undefined**：0 和 '' 也会短路，别意外。
3. **parallel 有监听 reject 会抛 AggregateError**；想吞错需自己包 try/catch。
4. **waterfall 最后那个参数是"最内层 next"**，监听别把它当普通 payload。
5. 事件名拼错在 dev 下会有 warn（开 `dev: true` 才有效）；上线关 dev 就静默，记得依赖类型或 registerEventName 防手滑。
6. 插件里 `on/once` 自动回收；`emit` 是广播，不登记不回收（本就不需要）。
