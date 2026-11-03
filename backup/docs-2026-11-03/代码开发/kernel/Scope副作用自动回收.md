# Scope：副作用自动回收（为什么 on / effect / inject 不用手动清理）

> 来源：`packages/kernel/src/Scope.ts`、`packages/kernel/src/fiber.ts`、`packages/kernel/src/Context.ts`（`effect` 与 `deriveScope`）。

读完你就能明白：**为什么插件作者几乎不用写 uninstall，也不用记着 off。**

---

## 1. 问题：老写法为什么会漏

老写法里，插件卸载要靠人手写 `uninstall`，还要逐个 `off` 监听、逐个 `clearInterval`。只要漏一个，页面就留下僵尸监听 / 定时器：难查，还占内存。

**现在的思路**：给每个插件配一个"回收袋"。插件凡是"建立了要清理的东西"（监听事件、起了定时器、上架了服务、注册了节点……），内核都自动登记进这个袋子里。
插件一卸载（`stop()` / `uninstallPlugin()`），整袋按登记顺序**倒着一次清光**。作者啥都不用记。

---

## 2. Scope 是什么、怎么用

`Scope`（`packages/kernel/src/Scope.ts:16`）是一个独立小类，可以直接 new 出来用：

```ts
import { Scope } from '@mini-canvas/kernel'

const scope = new Scope()

// 往袋子里塞一个清理函数
const off = scope.onDispose(() => console.log('清一次'))

// 或者用 effect：包住“创建了要清理的东西”的场景
scope.effect(() => {
  const timer = setInterval(() => {}, 1000)
  return () => clearInterval(timer) // 返回的清理函数自动入袋
})

// 释放：逆序把袋里所有清理函数跑一遍（后注册的先清）
scope.dispose()
```

但**你几乎不会直接 new Scope** —— 插件在 `apply(ctx)` 里拿到的 `ctx.on / ctx.effect / ctx.nodes.register …` 都已经自动登记进它自己的袋子了。

### Scope 的成员（源码为准）

| 成员 | 签名 | 一句话 |
| --- | --- | --- |
| `onDispose` | `onDispose(fn: () => void): () => void` | 登记清理函数；返回句柄可手动提前执行并从队列移除（幂等） |
| `effect` | `effect(fn: EffectFn): () => void` | 执行 fn；若 fn 返回清理函数就登记进本 scope |
| `child` | `child(): Scope` | 派生子作用域（子先于父清） |
| `dispose` | `dispose(): void` | 释放：先逆序清子，再逆序清本 scope；幂等 |
| `isDisposed` | `get isDisposed(): boolean` | 是否已释放 |

`EffectFn` 类型：`() => void | (() => void) | Disposable` —— 回调可以返回清理函数，也可以返回带 `dispose()` 的对象。

---

## 3. 回收的三条铁律

1. **逆序（LIFO）**：后登记的先清理。这天然贴合"依赖方先卸"。
2. **子作用域先于父**：`dispose()` 先递归清子作用域，再清自己。
3. **每个清理独立 try/catch**：一个清理抛错不阻断其它；`dispose()` 幂等，重复调安全。

---

## 4. 插件的 `ctx.on` / `ctx.effect` / `ctx.inject` 都被自动回收

```ts
ctx.plugin({
  name: 'demo',
  apply(c) {
    // —— 这几样都不用手动清 ——
    c.on('my/event', () => {}) // 监听 → 自动入袋
    c.effect(() => () => console.log('清')) // 副作用 → 自动入袋
    c.inject('mySvc', {}) // 上架服务 → 自动入袋（卸载撤下）
    c.nodes.register({ type: 'x', label: 'X', size: { w: 10, h: 10 } }) // 注册 → 自动入袋
  },
})
```

`c.on(...)` 返回的 `Disposable` 只是给你**想提前取消**时手动用的；不手动调，插件卸载照样被清。

**判定标准**（对齐 `Context.deriveScope` 的写法）：`on` / `once` / `effect` / `inject` / `provide` / `registryOf` 的放置 / `state` 都登记进本插件；**`get` / `emit` 是读操作和广播，不登记**。

---

## 5. effect 里包 timer / watch / DOM（典型用法）

写法统一：**fn 里创建 → 返回一个清理函数**。

```ts
apply(c) {
  c.effect(() => {
    const t = setInterval(() => console.log('tick'), 1000)
    return () => clearInterval(t) // 卸载时自动清定时器
  })

  // 包一个“手动可 off 的东西”，把 off 当清理函数返回
  c.effect(() => {
    const off = someExternalApi.onSomething(() => {})
    return off
  })
}
```

> **最常见的坑**：`c.effect(() => setInterval(fn, ms))` 忘了 `return` 清理，计时器就不被回收。

---

## 6. 清理能有多复杂？（Fiber 的兜底）

插件 `ctx.effect` 背后是 `Fiber.effect`（`packages/kernel/src/fiber.ts:128`），它除了"返回清理函数"，还支持：

- **返回一个 Promise**（异步副作用）：主体 resolve 后才知道清理是什么；内核把它记成"在途"，卸载时先等它在途完成再清。
- **返回一个可迭代对象**（数组 / generator）：逐个登记它产出的清理。
- **返回带 `dispose()` 的对象**：调它的 `dispose()` 当清理。

```ts
// 异步 effect：fn 是 async，返回一个 async 清理函数
c.effect(async () => {
  await setupSomething()
  return async () => { await teardownSomething() }
})
```

`dispose()` 会**同步先跑掉同步清理**（保证热卸 / 测试里的同步断言立刻生效），再把异步清理收集进返回的 Promise 等待完成。

---

## 7. 根 `ctx.effect` 和插件 `ctx.effect` 的区别

- **根 `Context.effect(fn)`**：登记进根 `rootScope`，服务"宿主 / 非插件的顶层副作用"；`stop()` 时随根作用域一起回收。
- **插件 `ctx.effect(fn)`**（`PluginScope.effect`）：登记进**该插件自己的 fiber**，插件卸载即清。

两者返回的都是 `Disposable`（`{ dispose() }`）；`Scope` 那层的 `onDispose` / `effect` 返回的则是普通函数。

---

## 8. 坑与速记

1. **必须 `return` 清理**才算登记。忘了 return，那个定时器 / 监听就不被回收。
2. 清理函数可以返回 **Promise**（异步清理）：`stopAsync()` 会等它跑完。
3. `Scope` 直接 new 时，`dispose()` 幂等，可重复调。
4. 手动执行 `onDispose` 返回的句柄后，该项从队列移除，卸载不会再跑它（幂等，不会跑两次）。
5. scope / fiber 已释放后再登记清理，会**立刻执行**（防泄漏），但幂等返回空操作。
6. 某个清理抛错不阻断其它清理（单错不阻断）。
