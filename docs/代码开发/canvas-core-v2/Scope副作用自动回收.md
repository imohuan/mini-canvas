# Scope：副作用自动回收（为什么 on/effect/inject 不用手动清理）

> 来源：packages/canvas-core-v2/src/core/Scope.ts、fiber.ts、Context.ts

这是 v2 和 v1 最大的分水岭。读完你就能明白：**为什么插件作者几乎不用写 uninstall / 不用记着 off。**

---

## 1. 问题：v1 的坑

在 v1 里，插件卸载得靠人手写 `uninstall`，还要逐个 `off` 监听、逐个 `clearInterval`……只要漏一个，页面就留下僵尸监听/定时器，又难查又占内存。

**v2 的思路**：给每个插件配一个"垃圾袋"（Scope）。插件凡是"建立了要清理的东西"（监听事件、起了定时器、上了架服务、注册了节点……），内核都自动把它登记进这个插件的垃圾袋。插件一卸载（`stop()` / `uninstallPlugin()`），内核就把整袋按登记顺序倒序**一次清光**。作者啥都不用记。

---

## 2. Scope 是啥、怎么用

`Scope`（`Scope.ts`）本身是一个独立类，可以直接用：

```ts
import { Scope } from '@mini-canvas/canvas-core-v2'

const scope = new Scope()

// 往袋子里塞一个清理函数（模拟"我要在卸载时做 X"）
const off = scope.onDispose(() => console.log('清一次'))

// 或者用 effect：包一个"创建了要清理的东西"的场景
scope.effect(() => {
  const timer = setInterval(() => {}, 1000)
  return () => clearInterval(timer)   // 返回的清理函数自动入袋
})

// 释放：逆序把袋里所有清理函数跑一遍（后注册的先清）
scope.dispose()
```

但**你几乎不会直接 new Scope**——因为每个插件在 `apply(ctx)` 里拿到的 `ctx.on / ctx.effect / ctx.inject / ctx.nodes.register …` 都已经自动登记进它自己的 Scope（内核帮你包好了）。你只管用，卸载时内核统一清。

### Scope 的关键方法 / 属性（源码为准）

| 成员 | 签名 | 一句话 |
| --- | --- | --- |
| `onDispose` | `onDispose(fn: () => void): () => void` | 登记清理函数；返回句柄可手动提前执行并从队列移除（幂等） |
| `effect` | `effect(fn: EffectFn): () => void` | 执行 fn，若 fn 返回清理函数就登记进本 scope |
| `child` | `child(): Scope` | 派生子作用域（子先于父清理） |
| `dispose` | `dispose(): void` | 释放：先逆序清子，再逆序清本 scope；幂等 |
| `isDisposed` | `get isDisposed(): boolean` | 是否已释放 |

`EffectFn` 类型：`() => void | (() => void) | Disposable` —— 回调可返回清理函数或带 `dispose()` 的对象。

---

## 3. 回收的语义（三个铁律）

1. **LIFO 逆序**：后登记的先清理。这天然贴合"依赖方先卸"（依赖方通常后建自己的副作用，卸载时先清它，再清底层）。
2. **子作用域先于父**：`dispose()` 先递归清子作用域再清自己。
3. **每个清理独立 try/catch**：一个清理抛错不阻断其余；`dispose()` 幂等，重复调安全。

---

## 4. 插件的 ctx.on / ctx.effect / ctx.inject 都被自动回收

在插件 `apply(ctx)` 里：

```ts
ctx.plugin({
  name: 'demo',
  apply(c) {
    // —— 这三样都不用手动清理 ——
    c.on('my/event', () => {})            // 监听 → 自动入袋
    c.effect(() => () => console.log('清'))  // 副作用 → 自动入袋
    c.inject('mySvc', {})                 // 上架服务 → 自动入袋(卸载撤下)
    c.nodes.register({ type: 'x', label: 'X', size: { w: 10, h: 10 } })  // 注册 → 自动入袋
  },
})
```

`c.on(...)` 返回的 `Disposable` 只是给你**想提前取消**时手动用的；不手动调，插件卸载照样被清。内核在 `deriveScope` 里给每样能力都接了 `fiber.onDispose(...)` 或 `ctx.effect(...)`。

> 判定标准（源码注释原话）：**on / effect / inject 登记进本插件 scope → 插件卸载即自动清光；get / emit 是读操作 / 广播，不登记。**

---

## 5. effect 里包 timer / watch / DOM（典型用法）

`effect` 就是给你包"创建了就得清理的东西"的。写法统一：**fn 里创建 → 返回一个清理函数**。

```ts
apply(c) {
  c.effect(() => {
    const t = setInterval(() => console.log('tick'), 1000)
    return () => clearInterval(t)      // 卸载时自动清定时器
  })

  // 包一个"手动可 off 的东西"也可以，借助返回的清理函数 off 它
  c.effect(() => {
    const off = someExternalApi.onSomething(() => {})
    return off
  })
}
```

> 想更省事，可以写一个可复用的辅助，把 "订阅/建/清" 都藏进 effect：`c.effect(() => setInterval(fn, ms) 的话要记得 return 清理)`。千万别只 `setInterval` 不返回清理——那就漏了。

---

## 6. 一个 effect 的清理能有多复杂？（源码的兜底）

`Fiber.effect` 除了接受"函数返回清理函数"，还支持：

- **返回一个 Promise**（异步副作用）：主体 resolve 后才知道清理是啥；内核把它记进"在途"，卸载时会先等它在途效果完成再清。
- **返回一个可迭代对象**（generator/iterable）：逐个登记它产出的清理。

```ts
// 异步 effect：fn 是 async，返回一个 async 清理函数
c.effect(async () => {
  await setupSomething()
  return async () => { await teardownSomething() }
})
```

`dispose()` 会**同步先跑掉同步清理**（保证热卸/测试里同步断言生效），再把异步清理收集进返回的 Promise 等待完成。

---

## 7. ctx.effect（根 ctx 上）和 fiber.effect（插件 ctx 上）的区别

- **根 `Context.effect(fn)`**：登记进根 `rootScope`，服务"宿主/非插件的顶层副作用"。
- **插件 `ctx.effect(fn)`**（PluginScope.effect）：登记进**该插件自己的 fiber**，插件卸载即清。

所以宿主层级的副作用用 `ctx.effect`；插件里能用 `ctx.effect` 是插件 scope 版的（在 deriveScope 里被包成了 fiber.effect）。

---

## 8. 坑与速记

1. **必须 return 清理**才算登记。`c.effect(() => setInterval(...))` 不 return，计时器就不被回收（这是最常见的坑）。
2. effect 的清理函数也可以返回 **Promise**（async disposer），`stop()` 会触发并等待它跑完（不会丢掉）。
3. `Scope` 直接 new 时，`dispose()` 幂等，可重复调。
4. 手动提前执行 `onDispose` 返回的句柄后，该项从队列移除，卸载不会再跑它（幂等，不会跑两次）。
5. scope 已释放后再 `onDispose(fn)`，会立刻执行 fn（防泄漏）但幂等返回空操作。
6. 插件卸载时，若某清理抛错，不阻断其它清理（单错不阻断）。
