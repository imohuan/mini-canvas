# EventBus：可独立复用的事件总线组件

> 来源：`packages/kernel/src/EventBus.ts`（第 21 行 `EventBus`、第 17 行 `isBailed`、第 147 行 `registerEventName`、第 152 行 `hasKnownEvent`、第 162 行 `knownEventNames`）。

内核内部的事件底层是一个自研的 `EventBus`。它**不依赖 Context**，可以当成一个独立的事件中枢复用到任何地方（某个模块内部的发布订阅、跨模块通信等）。

---

## 1. 直接 new 一个 EventBus 用

```ts
import { EventBus, registerEventName, isBailed } from '@mini-canvas/kernel'

const bus = new EventBus() // 构造可选 { devWhitelistWarn?: boolean }

// 订阅 / 取消
const off = bus.on('tick', (n: number) => console.log(n))
bus.emit('tick', 5) // 5
off() // 取消订阅
bus.has('tick') // false

// once：只触发一次
bus.once('once', (x) => console.log('只一次', x))
bus.emit('once', 1)
bus.emit('once', 2) // 只打印一次

// 清空所有监听
bus.clear()
```

> 底层监听统一是 `(...args) => void`（rest-arg），所以单 payload 事件（`emit(name, obj)`）与多参事件（`emit('x', a, b)`）都能承载。

---

## 2. 五种分发模式（`emit` / `parallel` / `serial` / `bail` / `waterfall`）

```ts
// emit：同步广播，逐个跑，不等也不收集返回值；单个监听抛错不阻断其它
bus.emit('e', 1, 2)

// parallel：所有监听并发跑并一起等；有拒绝则抛 AggregateError
await bus.parallel('e', 'x')

// serial：顺序 await，第一个 bail 值（非 null/false/undefined）胜出并停
const r = await bus.serial('approve')

// bail：serial 的同步版（同步短路）
const r2 = bus.bail('pick')

// waterfall：环绕中间件。最后一个参数是“最内层 next”；不调 next 直接返回 = 短路（否决下游）
const inner = (s: string) => `default:${s}`
bus.on('demo', (input, next) => next().toUpperCase()) // 包外层
const out = bus.waterfall('demo', 'hello', inner) // 'DEFAULT:HELLO'
```

`isBailed(value)`：判断是否算 bail —— 不是 `null` / `false` / `undefined` 就算（注意 `0` 和 `''` 也算 bail）。

---

## 3. 事件名登记与 dev 警告

EventBus 内部维护一份"已知事件名"登记表（`knownEvents`，`EventBus.ts:144`），初始含内置四条：

`ctx:ready` / `ctx:plugin-installed` / `ctx:plugin-uninstalled` / `ctx:lifecycle-change`

后来 `modelTool.ts` 在模块加载时又登记了三条：`tools/registered` / `tools/unregistered` / `tools/result`（`modelTool.ts:439`）。

```ts
// 把一个新事件名登记进来
registerEventName('my:event')
hasKnownEvent('my:event') // true
knownEventNames() // 全部已登记事件名（返回副本，改不到内部表）
```

**dev 白名单警告**：`new EventBus({ devWhitelistWarn: true })` 时，`emit` 一个**未登记**的事件名，每个名字首次给一次 `console.warn`；默认（不传）就不 warn。

```ts
const bus = new EventBus({ devWhitelistWarn: true })
bus.emit('some/typo', 1) // console.warn 一次：emit 了未声明的事件名 ...
bus.emit('some/typo', 2) // 同名前已 warn 过，不再 warn
```

消除警告：先 `registerEventName('some/typo')`，或在 `Events` / `EventMap` interface 里 declare。

> **注意**：`Context` 构造时只有 `dev: true` 才会把这个开关打开（`Context.ts:260`）。
> 而"事件名是否已登记"是**全进程共用一张表**的（模块级 `knownEvents`），不是每个总线一份。

---

## 4. EventBus 公开 API 一览

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| 构造 | `new EventBus({ devWhitelistWarn? })` | 选项控制 dev warn |
| `on` | `on(name, handler): () => void` | 订阅，返回 off 函数 |
| `once` | `once(name, handler): () => void` | 订阅一次 |
| `off` | `off(name, handler): void` | 取消订阅 |
| `emit` | `emit(name, ...args): void` | 同步广播 |
| `parallel` | `parallel(name, ...args): Promise<void>` | 并发等全部 |
| `serial` | `serial(name, ...args): Promise<any>` | 顺序，bail 胜出停 |
| `bail` | `bail(name, ...args): any` | 同步短路 |
| `waterfall` | `waterfall(name, ...args): any` | 中间件环绕 |
| `clear` | `clear(): void` | 清空所有监听 |
| `has` | `has(name): boolean` | 某事件是否有监听者 |

模块级导出（**全部已进包顶层 barrel**，`packages/kernel/src/index.ts:18`）：

- `EventBus`（类）
- `registerEventName(name)` / `hasKnownEvent(name)` / `knownEventNames()`
- `isBailed(value)`
- 类型 `DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'`

---

## 5. EventBus 与 Context 事件的关系

- `Context` / `PluginScope` 的 `on/once/emit/parallel/serial/bail/waterfall` **只是转发**到它内部那个 `bus`（`this.bus`）。
- 区别在于：Context 的 `on` / `once` 把 off 包成 `Disposable` 并**自动挂到插件**（插件卸载自动 off）；
  EventBus 裸类返回的 off 是普通函数，调用方自己负责（或自己接 `scope.onDispose(off)`）。

所以：**插件里用 `ctx.on` / `ctx.emit`（有类型 + 自动回收）；模块内部或通用复用用裸 `EventBus`。**

---

## 6. 坑与速记

1. `emit` **不等待**监听返回值；要结果用 `parallel` / `serial` / `bail` / `waterfall`。
2. `bail` / `serial` 的 bail 判定只排除 null / false / undefined，`0` 和 `''` 也短路。
3. `parallel` 有监听 reject 抛 `AggregateError`；想吞错自己包。
4. `waterfall` 最后那个参数是"最内层 next"，监听别当普通 payload。
5. dev warn 只在 `devWhitelistWarn: true` 时有效，且每个名字只 warn 一次。
6. 裸 `EventBus` 不做自动回收，off 要自己管；要自动回收就用 `Context` / `PluginScope` 那套，或手动 `scope.onDispose(off)`。
