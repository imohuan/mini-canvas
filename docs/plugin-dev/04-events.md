# 4 · 事件（五种分发）

> 目标：弄懂事件——插件之间**不用知道对方是谁**就能打招呼的通知机制，
> 以及 `emit / parallel / serial / bail / waterfall` 五种分发模式各自什么时候用。
> 建立在第 1/2/3 篇跑通的基础上。

## 一句话

服务和事件是两种"插件沟通"方式：服务是**点对点直接调用**（我要 `greeter.greet()`），
得知道对象在谁那；事件是**广播通知**（"有插件装了/某个数字变了"），发出去谁爱听谁听。
服务适合"我要你的返回值"，事件适合"我不在乎谁在处理、甚至处理好几次都行"。

## 听内置事件：ctx.on 自动回收

内核自己会发一批内置事件，你 `ctx.on` 订阅即可（属于 effect，第 2 篇讲过：卸载自动移除监听，不用手写 off）。
最常用的几个：

| 事件名 | payload | 什么时候发 |
|---|---|---|
| `ctx:ready` | `{ plugins: string[] }` | 宿主装载完、全部插件激活 |
| `ctx:plugin-installed` | `{ name: string }` | 有插件装上 |
| `ctx:plugin-uninstalled` | `{ name: string }` | 有插件被卸 |
| `ctx:lifecycle-change` | `{ name, lifecycle }` | 某插件状态变化 |

浏览器控制台热装一个"旁观者"插件，它监听"有插件装上"并打印：

```js
// 监听内置事件：谁装插件都会在这里被看到
window.MiniCanvasManager.install({
  name: 'plugin-watcher',
  inject: [],
  apply(ctx) {
    ctx.on('ctx:plugin-installed', ({ name }) => {
      console.log(`[watcher] 有插件装上了: ${name}`)
    })
    ctx.on('ctx:plugin-uninstalled', ({ name }) => {
      console.log(`[watcher] 有插件被卸了: ${name}`)
    })
  },
})
```

再随便热装/热卸一个插件（比如第 1 篇的 `hello`），你会看到 watcher 把它打印出来——
watcher 完全不知道 `hello` 是谁，是事件把它们连起来的。

## 自己定一个事件：emit 发出、别人 on 收到

除了听内核事件，插件之间也能自己定事件名。名字用一个 `命名空间/动作` 的写法（如 `stats/report`），
让扁平的事件池好读。发起方在合适的时机 `ctx.emit`，监听方 `ctx.on`。

一个最小自洽例子（发起 + 监听在同一插件里，先看机制；真用是两个插件）：

```js
window.MiniCanvasManager.install({
  name: 'event-demo',
  inject: [],
  apply(ctx) {
    // 监听方：收到 'stats/report' 就打印
    ctx.on('stats/report', (name, count) => {
      console.log(`[stats] ${name} 次数 -> ${count}`)
    })

    // 发起方：连发三次（第一次会触发 ctx:ready 之外、自己 on 的回调）
    ctx.emit('stats/report', 'tool_call', 1)
    ctx.emit('stats/report', 'tool_call', 2)
    ctx.emit('stats/report', 'prompt', 1)
  },
})
```

你会看到三行 `[stats] …`。注意 `ctx.emit` 传的是**多个参数**（`emit(name, ...args)`），
监听回调按位置收。这就是 cordis 式的多参事件（跟第 3 篇 CanvasEventMap 那种单 payload 对象事件不同）。

> 想监听**只触发一次**就用 `ctx.once(name, h)`——和 `on` 一样自动回收，只是收到一次后自动移除。

## 五种分发模式：什么时候用哪个

`emit` 只是五种之一。选哪种是事件**约定的一部分**——它决定监听器能不能返回值、能不能并发、
能不能互相短路：

| 模式 | 调用 | 语义 | 用在哪 |
|---|---|---|---|
| emit | `ctx.emit(name, …)` | 同步广播；不等也不收集返回值 | 纯通知、fire-and-forget（"状态变了"） |
| parallel | `await ctx.parallel(name, …)` | 所有监听**并发**跑、一起等 | 多个独立耗时任务都要跑完才继续 |
| serial | `await ctx.serial(name, …)` | 顺序 await；第一个非空返回值**胜出并停止** | 谁先给出答案就用谁（缓存→网络） |
| bail | `ctx.bail(name, …)` | serial 的**同步**版（同步短路） | 同步判断，"有人认领就停" |
| waterfall | `ctx.waterfall(name, …, next)` | 环绕中间件，可转写或短路 | 拦截/加装：装饰下游、或替下游作答 |

**serial / bail 的"短路值"**：返回非 `null` / `false` / `undefined` 就胜出并停止后续监听。

### bail：有人认领就停（适合画布）

想表达"这个节点该不该能被删，谁认领了就停"——用 bail。三个监听按序跑，谁先返回 `true`（或任何
非空值）后面就不跑了：

```js
window.MiniCanvasManager.install({
  name: 'bail-demo',
  inject: [],
  apply(ctx) {
    // 监听1：节点 id 是 'locked' 就"认领"并返回 true(短路)
    ctx.on('node:can-delete', (nodeId) => {
      if (nodeId === 'locked') return true
      return undefined            // 不认领 → 放行给下一个
    })
    // 监听2：默认都能删（只有锁定的被拦住）
    ctx.on('node:can-delete', () => false)

    // 广播：locked 节点 → 监听1 认领返回 true，停
    const r1 = ctx.bail('node:can-delete', 'locked')
    console.log('[bail] locked 能删吗 ->', r1)   // true
    // 普通节点 → 监听1 不认领，落到监听2 返回 false，停
    const r2 = ctx.bail('node:can-delete', 'node-42')
    console.log('[bail] node-42 能删吗 ->', r2)  // false
  },
})
```

### serial：谁先给答案用谁（异步版 bail）

监听器可返回 Promise，`await ctx.serial` 会等第一个给答案的：

```js
window.MiniCanvasManager.install({
  name: 'serial-demo',
  inject: [],
  apply(ctx) {
    // 缓存优先：命中就直接返回
    ctx.on('data:load', async (key) => {
      if (key === 'cached') return '来自缓存'
      return undefined
    })
    // 兜底：没命中就异步拉（假装网络）
    ctx.on('data:load', async (key) => {
      await new Promise((r) => setTimeout(r, 10))
      return `来自网络 ${key}`
    })

    void (async () => {
      console.log(await ctx.serial('data:load', 'cached')) // '来自缓存'(短路，不走网络)
      console.log(await ctx.serial('data:load', 'fresh'))  // 缓存未命中 → 落网络
    })()
  },
})
```

### waterfall：环绕中间件（装饰 / 短路）

waterfall 适合"拦截"。每个监听器收到参数和一个 `next()`；可以**调 next 拿下游结果再转写**，
也可以**不调 next 直接返回**来短路（相当于否决下游）。

```js
window.MiniCanvasManager.install({
  name: 'waterfall-demo',
  inject: [],
  apply(ctx) {
    // 监听1(最外层)：调 next 拿到结果，转成大写
    ctx.on('msg:transform', async (input, next) => {
      const downstream = await next()
      return String(downstream).toUpperCase()
    })
    // 监听2：看到 blocked 就直接短路(不调 next)，否则放行给最内层默认
    ctx.on('msg:transform', async (input, next) => {
      if (input.includes('blocked')) return '** 被拦截 **'
      return next()
    })

    void (async () => {
      const a = await ctx.waterfall('msg:transform', 'hello', async () => 'hello')
      const b = await ctx.waterfall('msg:transform', 'blocked words', async () => 'blocked')
      console.log(a)   // HELLO(监听1 转大写)
      console.log(b)   // ** 被拦截 **(监听2 短路，最内层默认没跑)
    })()
  },
})
```

> **waterfall 的纪律**：只想"看一眼/记个日志"的监听器**必须调用 `next()`**；不调就代表你有意短路。
> 日志监听器若忘了调 next，会悄悄吞掉下游所有默认行为——这是最常见的坑。

## 这背后发生了什么（一句话）

事件让插件**解耦**沟通：发起方 `emit/parallel/serial/bail/waterfall`，谁都不需要知道听众是谁。
`ctx.on/once` 是 effect，监听随插件卸载自动移除。选哪种分发 = 这个事件承诺的语义：
纯通知用 emit，要并发等齐用 parallel，谁先答用谁用 serial，同步短路用 bail，拦截/加装用 waterfall。

## 下一步

一个插件总要让用户能调点什么。下一篇讲**配置**：给插件导出 Config schema 声明可配置项，
宿主自动长面板；改一项只刷对应那一处、实时生效、不整图重建 →
[第 5 篇 · 配置（Config schema + 监听变化实时生效）](./05-config.md)。
