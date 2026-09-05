# 2 · 生命周期与 effect（fiber）

> 目标：弄懂"经 ctx 建的注册为什么自动回收"，把没被托管的东西用 `ctx.effect` 包住，
> 并认识每个插件身上那个能查状态、能停的 **fiber** 句柄。
> 建立在第 1 篇跑通的基础上。

## 一句话

插件可能被卸载：宿主关掉、你热卸它、或它的依赖服务消失（第 3 篇讲）。
凡是你**经 `ctx` 注册**的东西（命令 / 节点 / 事件监听 / 服务 / 子插件…）都属于 **effect**，
会在所属插件卸载时**自动撤销**，不用你写清理。没被托管的东西（定时器、连接、watcher…）
要自己用 `ctx.effect` 包一个 disposer（清理函数），卸载时内核会替你调用。

## 已经属于 effect 的操作（你很少要手写清理）

| 你写的 | 卸载时会发生 |
|---|---|
| `ctx.on(name, h)` | 监听器自动移除 |
| `ctx.nodes.register(...)` | 该节点类型自动注销 |
| `ctx.commands.register(...)` | 该命令自动移除 |
| `ctx.inject('svc', impl)` / `ctx.provide(...)` | 该服务自动下架（第 3 篇） |
| `ctx.plugin(child)` | 子插件随父一起卸 |

看一个真的：`plugin-node-text` 的 `apply` 里用 `ctx.nodes.register({ type:'text', … })` 注册了
text 节点——它**没有**写任何注销代码。等 text 插件被卸载（第 6 篇热卸试给你看），
画布里的 text 类型会跟着消失，不会残留。

## 没被托管的东西：用 ctx.effect 包一个 disposer

举个例子，你希望每次插件装载后起一个心跳，每 1 秒往控制台打一拍；插件卸载时把定时器清掉。

新建 `packages/canvas-core-v2/demo-web/heartbeatPlugin.ts`，照抄：

```ts
import type { Context } from '@mini-canvas/canvas-base'

export const name = 'heartbeat'
export const inject = [] as string[]

export function apply(ctx: Context) {
  console.log('[heartbeat] 插件装载')

  // ctx.effect 的"清理函数"返回式：卸载/热卸时自动调用，帮你清掉 timer
  ctx.effect(() => {
    const timer = setInterval(() => console.log('[heartbeat] tick'), 1000)
    return () => {
      clearInterval(timer)
      console.log('[heartbeat] 已清理 timer ✓')
    }
  })

  // 也演示一个"异步 disposer"：清理函数可以返回 Promise，卸载时会等它完成
  ctx.effect(() => {
    return async () => {
      await new Promise((r) => setTimeout(r, 200))
      console.log('[heartbeat] 异步清理完成')
    }
  })
}

export const heartbeatPlugin = { name, inject, apply }
```

把它装进 demo 有两条路（同第 1 篇方式 A / B），或直接在控制台热装：

```js
// 浏览器控制台（demo 已暴露 window.MiniCanvasManager）
window.MiniCanvasManager.install({
  name: 'heartbeat',
  inject: [],
  apply(ctx) {
    ctx.effect(() => {
      const timer = setInterval(() => console.log('[heartbeat] tick'), 1000)
      return () => { clearInterval(timer); console.log('[heartbeat] 已清理 timer ✓') }
    })
  },
})
// 停掉它（等价于卸载插件 → 上面那个清理函数被调用，timer 被清）
window.MiniCanvasManager.uninstall('heartbeat')
```

## 你会看到

- 装上后每 1 秒打一拍 `[heartbeat] tick`。
- 执行 `uninstall('heartbeat')` 后：先打 `[heartbeat] 已清理 timer ✓`，然后 **tick 不再出现**——
  证明定时器被自动清掉了，没泄漏。

## 每个插件身上有个 fiber 句柄

每个已装载的插件实例都有一个 **fiber**（运行时句柄），状态走一套状态机：

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
               ↘ FAILED
```

- **PENDING**：已声明，但在等所需服务（第 3 篇的 `inject`）——这是"为什么它没输出"最常见的答案。
- **LOADING / ACTIVE**：`apply` 正在跑 / 已跑完。
- **FAILED**：`apply` 或配置校验（第 5 篇）抛了异常。
- **UNLOADING / DISPOSED**：清理中 / 一切已拆除。

你一般不用手拿 fiber 去操作它——宿主和工具会替你管。**想查看状态**（尤其"某个插件是不是卡着没起来"），
demo 已给了现成入口：

- 画布左下角那块 **「插件管理器」** 面板，每行显示该插件的 fiber 状态徽标：
  `ACTIVE`（绿）/ `PENDING 缺: xxx`（黄）/ `FAILED: 报错`（红）。
- 浏览器控制台 `window.MiniCanvasManager.list()`——每行带 `state` / `missingDeps` / `error`；
  或 `window.MiniCanvas.getContext().inspectPlugins()` 拿内核只读诊断。

```js
// 看所有插件的 fiber 状态（谁 ACTIVE、谁 PENDING、谁 FAILED）
console.table(window.MiniCanvas.getContext().inspectPlugins())
```

## 这背后发生了什么（一句话）

内核给每个插件一个"副作用容器"（fiber + scope）：凡是经 `ctx` 注册 / `ctx.effect` 包的东西
都登记进它；插件一卸载就**按登记逆序逐个跑清理**（支持异步 disposer、单错不阻断），
所以你从不需要记得手动注销。第 6 篇讲热卸 / 换版本时，这套自动回卷会让"旧实例被清干净、新代码干净起"。

## 下一步

一个插件通常还要用别人提供的能力。下一篇讲**服务**：怎么公开一项能力、怎么声明硬依赖等它到齐、
缺了它插件会停在 PENDING（就是上面那个状态的来处）→ [第 3 篇 · 服务（Service 类 + inject）](./03-services-inject.md)。
