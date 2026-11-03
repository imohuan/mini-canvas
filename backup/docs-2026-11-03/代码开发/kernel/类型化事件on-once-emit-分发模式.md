# 类型化事件：`ctx.on` / `once` / `emit` / `parallel` / `serial` / `bail` / `waterfall`

> 来源：`packages/kernel/src/types.ts`（`EventMap` / `Events` / `EventHandlerFor` / `EventArgsFor`）、`packages/kernel/src/EventBus.ts`、`packages/kernel/src/Context.ts`（事件转发）。

内核内置一套**单源事件总线**（不碰 window、不碰全局 DOM）。插件之间靠 `on` / `emit` 传消息，还能用五种分发模式控制多个监听怎么跑。

---

## 1. 最基础：`ctx.on` 监听 + `ctx.emit` 广播

```ts
ctx.plugin({
  name: 'listener',
  apply(c) {
    c.on('my:event', (payload: { from: string }) => console.log(payload.from))
    c.once('my:one', (x) => console.log('只触发一次', x)) // once：触发一次后自动取消
  },
})
await ctx.start()

ctx.emit('my:event', { from: 'ctx' }) // 单 payload 形态
ctx.emit('my:one', 'hi') // 多参形态
```

要点：

- `on` / `once` 都返回一个 `Disposable`，可手动提前取消（`{ dispose: off }`）。
- **监听随插件自动回收**：插件在 `apply` 里 `c.on(...)` 注册的，卸载时自动 off。
- 单 payload 事件（传一个对象）与多参事件（`emit('x', a, b)`）都支持。

```ts
// 手动提前取消（可选）
const sub = c.on('my:event', () => {})
sub.dispose() // 现在取消
```

---

## 2. 五种分发模式

| 方法 | 怎么跑 | 返回值 |
| --- | --- | --- |
| `emit` | 同步广播，逐个跑，不等也不收集返回值 | `void` |
| `parallel` | 所有监听**并发**跑并一起等 | `Promise<void>`（有拒绝则抛 `AggregateError`） |
| `serial` | **顺序 await**，第一个 bail 值胜出并停止 | `Promise<any>`（胜出值） |
| `bail` | `serial` 的**同步版**（同步短路） | `any`（胜出值） |
| `waterfall` | **环绕中间件**：监听可转写 `next()` 返回值或短路 | `any` |

### 2.1 `emit` —— 同步广播

```ts
c.emit('evt', 1, 2)
```

监听抛错会被捕获，**不阻断其它监听**。

### 2.2 `parallel` —— 并发一起等

```ts
await c.parallel('evt')
```

所有监听并发跑，等全部 settle；有监听 reject 则抛 `AggregateError`（`errors` 里是各家的原因）。

### 2.3 `serial` —— 顺序跑，第一个“真值”胜出停

```ts
const result = await c.serial('approve')
// 依次 await 每个监听；谁先返回 bail 值就返回它并停，后面的不再跑
```

### 2.4 `bail` —— 同步版短路

```ts
const picked = c.bail('pick') // 同步；第一个 bail 值胜出
```

**bail 判定**（`isBailed`，`packages/kernel/src/EventBus.ts:17`）：返回 `null` / `false` / `undefined` 算"没 bail，继续跑"，其它任何值都算 bail 并停下。
注意 **`0` 和空字符串 `''` 也算 bail**（只排除 null / false / undefined）。

### 2.5 `waterfall` —— 中间件环绕

**最后一个参数是"最内层的默认行为"**，监听器从外层到内层依次跑，每个都可以：

- 调 `next()` 进入下一层；
- 不调 next 直接 return = **短路**（否决下游，最内层不会跑）。

```ts
// 最后一个参是“最内层默认行为”
const inner = (s: string) => `default:${s}`

// 监听 1：包外层，把下游结果转大写
c.on('demo', (input, next) => next().toUpperCase())
// 监听 2：含 blocked 就短路
c.on('demo', (input, next) => (input.includes('blocked') ? '** BLOCKED **' : next()))

c.waterfall('demo', 'hello', inner) // 'DEFAULT:HELLO'（层层包）
c.waterfall('demo', 'blocked', inner) // '** BLOCKED **'（短路，inner 不跑）
```

> ctx 上五种都有：`ctx.emit / ctx.parallel / ctx.serial / ctx.bail / ctx.waterfall`，它们只是转发到内部那个总线。

---

## 3. 事件名怎么拿到类型

内核里有**两个**事件表，长得像但用途不同（都在 `packages/kernel/src/types.ts`）：

### 3.1 `EventMap` —— 单 payload 对象事件表

```ts
interface EventMap {
  'ctx:ready': { plugins: string[] }
  'ctx:plugin-installed': { name: string }
  'ctx:plugin-uninstalled': { name: string }
  'ctx:lifecycle-change': { name: string; lifecycle: Lifecycle }
}
```

作者也可以声明合并扩展它：

```ts
declare module '@mini-canvas/kernel' {
  interface EventMap { 'hello:ping': { from: string } }
}
```

### 3.2 `Events` —— “事件表”（推荐入口）

`Events` 里每个键 = 事件名，值 = **监听函数签名**（参数就是事件参数，支持多参）。

```ts
interface Events {
  'ctx:ready'(payload: { plugins: string[] }): void
  // ...
}
```

作者扩展自定义**多参事件**，`on` / `emit` 就有参数类型提示：

```ts
declare module '@mini-canvas/kernel' {
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}
// 之后 c.on('stats/report', (name, count) => ...) 有类型；c.emit('stats/report', 'tool', 1) 也有类型
```

**事件名解析规则**（`EventHandlerFor` / `EventArgsFor`）：

1. 事件名在 `Events` 里（含内置与作者扩展）→ 用它声明的监听函数签名；
2. 事件名只在 `EventMap`（单 payload）→ 用单 payload 形态；
3. 都不在（未登记的任意事件名）→ 松类型 `(...args) => any`。

---

## 4. dev 白名单警告：emit 未登记事件名会 `console.warn`

`new Context({ dev: true })` 会打开总线的 `devWhitelistWarn`。此时 `emit` 一个**未登记**的事件名，**每个名字首次**会给一次 `console.warn`
（防刷屏），提示你可能拼错了事件名导致静默失效。

```ts
const ctx = new Context({ dev: true })
ctx.emit('some/typo', 1) // dev 下 console.warn 一次
ctx.emit('some/typo', 2) // 同名前已 warn 过，不再 warn
```

消除警告的办法：

1. 在 `Events` / `EventMap` 里 declare 这个事件名；
2. 或运行时调 `registerEventName(name)` 显式登记。

```ts
import { registerEventName } from '@mini-canvas/kernel'
registerEventName('my:event')
```

> 生成工具那三条内置事件（`tools/registered` / `tools/unregistered` / `tools/result`）已在模块加载时登记好了，不会 warn。
> 现在想查"这台内核上都有哪些事件可监听"，用 `ctx.surface().events`（或直接 `knownEventNames()`）。

---

## 5. 事件底层：独立的 `EventBus` 类

内核内部用一个 `EventBus`（`packages/kernel/src/EventBus.ts:21`）。它**不依赖 Context**，可以直接 new 出来当独立事件中枢用：

```ts
import { EventBus, registerEventName, isBailed } from '@mini-canvas/kernel'

const bus = new EventBus({ devWhitelistWarn: false })

const off = bus.on('ping', (n: number) => console.log(n * 2))
bus.emit('ping', 21) // 42
off() // 取消
bus.has('ping') // false（没有监听者了）
```

完整成员表与用法见《EventBus 独立事件总线组件》那一篇。

**包顶层导出**（`packages/kernel/src/index.ts:18`）：`EventBus`、`registerEventName`、`isBailed`、`hasKnownEvent`、`knownEventNames`、以及类型 `DispatchMode`。
都从 `@mini-canvas/kernel` 一处导入即可（不需要子路径）。

---

## 6. 坑与速记

1. **`emit` 不等监听返回值**：想等或想收集结果，用 `parallel` / `serial` / `bail` / `waterfall`。
2. **bail 判定只排除 null / false / undefined**：`0` 和 `''` 也会短路，别意外。
3. **`parallel` 有监听 reject 会抛 `AggregateError`**；想吞错得自己包 try/catch。
4. **`waterfall` 最后一个参数是“最内层 next”**，监听别把它当普通 payload。
5. 事件名拼错在 dev 下会 warn（要 `dev: true` 才有效）；上线关 dev 就静默，所以更要靠类型或 `registerEventName` 防手滑。
6. 插件里 `on` / `once` 自动回收；`emit` 是广播，不登记也不回收（本来就不需要）。
