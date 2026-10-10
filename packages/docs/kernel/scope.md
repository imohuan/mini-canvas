# 作用域 Scope 与副作用自动回收

**一句话定位**：**Scope 是插件的「回收袋」—— 插件凡是「建立了要清理的东西」（监听、定时器、上架的服务、注册的条目），都自动装进这个袋子，插件一卸载，袋子按登记顺序倒着一次清光。**

**它属于哪一档**：**内核自带（框架层）**。源码：`packages/kernel/src/Scope.ts`（`Scope` 独立小类）、`packages/kernel/src/fiber.ts`（`Fiber` 也是副作用容器，能力比 Scope 更强）、`packages/kernel/src/Context.ts`（`deriveScope`：插件 ctx 上每个方法的登记去向）。

## 它是什么

v1 里，插件卸载全靠**手写 `uninstall`**：自己记着「我 `on` 过哪几个事件、`setInterval` 过几次、`addEventListener` 挂过谁」，然后挨个 `off` / `clearInterval` / `removeEventListener`。**漏一个就留下僵尸**：监听还在响、定时器还在跳、内存慢慢涨，而且极难查。

v2 的做法是给**每个插件配一个回收袋**：

```
apply(ctx) 里做的每一件「建立」的事
        ↓ 自动
插件自己的回收袋（Scope / Fiber）
        ↓ 插件卸载 / ctx.stop()
倒序清光，一个不漏
```

按「数据 / 展示 / 能力 / 配置」分，Scope 不属于任何一类 —— 它是**框架的回收机制**，管的是「副作用」。

## 为什么需要它

举三个真实会漏的场景：

1. **监听**：插件 `ctx.on('some/event', handler)`，卸载时不 `off`。之后每次 emit 都会调到一个已经死掉的插件 —— 它读的数据可能已经不存在，报错信息还指不到出处。
2. **定时器**：插件起了个 `setInterval` 轮询，卸载时忘了 `clearInterval`。页面越用越卡，而且它还在改一个已经不显示的状态。
3. **上架的服务**：插件 `provide('my-svc', impl)` 之后被热卸，服务表里还留着那个 `impl`。新插件想用同名上架 → 直接抛 `already injected`。

三条都能被一圈 `ctx.effect` / `ctx.on` 的自动登记堵住。**作者的规矩只有一条：只要「建立了东西」，就走 `ctx` 的那些入口**（别绕过它直接操作全局）。

## 怎么用

### 一、`ctx.effect(() => cleanup)`：包住「创建了要清理的东西」

```ts
effect(fn: EffectFn): Disposable
// EffectFn = () => void | (() => void) | Disposable
```

**fn 里创建，返回清理函数**。登记是自动发生的：

```ts
// 文件：my-plugin/src/index.ts 里的一小段
export function apply(ctx: Context) {
  // ① 定时器：返回的清理函数会被自动登记
  ctx.effect(() => {
    const timer = setInterval(() => console.log('tick'), 1000)
    return () => clearInterval(timer)   // ← 别忘了 return！
  })

  // ② 把外部 API 的「取消函数」直接当清理函数返回
  ctx.effect(() => {
    const off = someExternalApi.onSomething(() => {})
    return off
  })

  // ③ 也可以返回一个带 dispose() 的对象
  ctx.effect(() => ({ dispose: () => console.log('disposed') }))
}
```

> **最常见的坑**：`ctx.effect(() => setInterval(fn, ms))` **忘了 `return`** —— 那不等于登记，定时器不会被回收。
> fn 返回了清理函数才叫「入袋」。

### 二、三条回收铁律

`Scope` 的 `dispose()` 语义（源码注释与测试都锁着）：

1. **逆序（LIFO）**：后登记的先清理。天然贴合「依赖方先卸」—— 后面的东西更可能依赖前面的。
2. **子作用域先于父**：`dispose()` 先递归清子 `Scope`，再清自己。
3. **每个清理独立 `try/catch`**：一个清理抛错**不阻断**其它清理；`dispose()` **幂等**（重复调用安全，只清一次）。

另外两条细节：

- 返回的**句柄可提前执行**：`const off = scope.onDispose(fn); off()` —— 跑完从队列移除，卸载时不会再跑它（幂等）。
- **已释放后再登记 → 立即执行**（防泄漏），且返回空操作。

`Scope` 的完整成员（`packages/kernel/src/Scope.ts`）：

| 成员 | 签名 | 一句话 |
| --- | --- | --- |
| `onDispose` | `onDispose(fn: () => void): () => void` | 登记清理函数；返回可提前执行的句柄 |
| `effect` | `effect(fn: EffectFn): () => void` | 执行 fn；返回清理就登记 |
| `child` | `child(): Scope` | 派生子作用域（子先于父清） |
| `dispose` | `dispose(): void` | 释放：先逆序清子，再逆序清自己；幂等 |
| `isDisposed` | `get isDisposed(): boolean` | 是否已释放 |

> 你**几乎不会直接 `new Scope()`** —— 插件 ctx 上那些方法已经指向它自己的袋子了。直接 new 的常用于：写单测、写宿主工具、给一个「不是插件」的模块配一个回收袋。

### 三、插件 ctx 上哪些东西自动回收

判定标准（对齐 `Context.deriveScope` 的实现）：

| 调用 | 回收吗 | 登记去哪 |
| --- | --- | --- |
| `ctx.on` / `ctx.once` | **回收** | 插件 fiber |
| `ctx.effect` | **回收** | 插件 fiber |
| `ctx.inject(name, impl)` / `ctx.provide(name, impl)` | **回收**（服务自动撤下） | 插件 fiber |
| `ctx.registryOf(kind)` 的 `add` / `wrap` / `subscribe` | **回收** | 插件 fiber |
| `ctx.state(initial)` | **回收**（卸载后 `value` 清空，状态不再可达） | 插件 fiber |
| 能力层的各种 `register`（`ctx.nodes` / `ctx.theme` / `ctx.commands` / `ctx.slots` / `ctx.tools`…） | **回收** | 插件 fiber（实现里用 `ctx.effect` 包的） |
| `ctx.get` / `ctx.tryGet` | **不回收** | —— 读操作，本来就不需要 |
| `ctx.emit` / `parallel` / `serial` / `bail` / `waterfall` | **不回收** | —— 广播，本来就不需要 |

`ctx.on(...)` 返回的 `Disposable` 只是给你**想提前取消**时用的；不接返回值，插件卸载照样自动 off。

```ts
// 把上面这张表写成代码，一眼看清
export function apply(ctx: Context) {
  ctx.on('some/event', () => {})         // ← 卸载自动 off
  ctx.once('other/event', () => {})      // ← 卸载自动 off
  ctx.provide('my-svc', {…})             // ← 卸载自动撤下服务
  ctx.effect(() => {…; return cleanup})  // ← 卸载自动跑 cleanup
  ctx.registryOf<Thing>('my-kind').add('k', v)   // ← 卸载自动摘除这条
  const st = ctx.state({ n: 0 })         // ← 卸载后 st.value 清空
  // 下面这些是读/广播，本来就不登记：
  ctx.get('doc'); ctx.emit('hi')
}
```

### 四、根 `ctx.effect` vs 插件 `ctx.effect`（这条要讲透）

两个同名方法，**袋子不同**：

| | 根 `Context.effect(fn)` | 插件 `ctx.effect(fn)`（`apply(ctx)` 里的那个） |
| --- | --- | --- |
| 登记进哪 | 根 `rootScope`（`Scope` 实例） | 本插件自己的 `Fiber` |
| 什么时候清 | `ctx.stop()` / `ctx.stopAsync()` 时随根作用域一起清 | **插件卸载时立刻清**（热卸 / `stop()` 都算） |
| 服务谁 | 「宿主 / 非插件的顶层副作用」：宿主装配代码、测试脚手架 | 插件自己的副作用 |
| 返回值 | `Disposable`（`{ dispose() }`） | `Disposable`（`{ dispose() }`） |

一句话：**根 `ctx.effect` 活到整个内核停止；插件 `ctx.effect` 活到这个插件被卸载。**
所以诊断「为什么我卸了插件资源还在」时，先看那行 `ctx.effect` 是不是写在**根 ctx** 上（比如宿主装配里），它本来就不会随插件走。

源码里这两条路是分开的：

```ts
// 根 Context
effect(fn: EffectFn): Disposable {
  const off = this.rootScope.effect(fn)     // ← 根作用域
  return { dispose: off }
}

// 插件视图（deriveScope）
effect(fn: EffectFn): Disposable {
  const off = fiber.effect(fn)              // ← 本插件 fiber
  return { dispose: off }
}
```

### 五、Fiber 是「更强的 Scope」：异步清理、多产物

插件 `ctx.effect` 背后其实是 `Fiber.effect`（`packages/kernel/src/fiber.ts`），它比 `Scope` 多三种形态：

| fn 返回什么 | 会发生什么 |
| --- | --- |
| 清理函数 | 登记，卸载时跑 |
| `{ dispose() }` 对象 | 调它的 `dispose()` 当清理 |
| **Promise**（async effect） | 主体 resolve 后才拿到清理；期间记成「在途」，卸载时**先等它在途完成再清** |
| **可迭代对象**（数组 / generator） | 逐个登记它产出的清理 |

**异步清理**会被 `await`：`fiber.dispose()` 会**同步先跑掉同步清理**（保证热卸 / 测试里的同步断言立刻生效），
再把异步清理收集进返回的 Promise 等待完成。宿主关闭页面用 `ctx.stopAsync()` 就是为了等最后一批异步清理（比如异步保存）跑完。

```ts
// 异步 effect：fn 是 async，返回一个 async 清理函数
ctx.effect(async () => {
  await setupSomething()
  return async () => { await teardownSomething() }
})
```

### 六、`stop()` 的顺序

`ctx.stop()` 做的事（`Context.stop`）：

1. 把已登记的插件 fiber **倒序**（依赖方先卸）逐个 `dispose()`；
2. 释放**根作用域**（宿主 `ctx.effect` 注册的顶层副作用也在这里清）；
3. 清插件表、fiber 表、服务表、注册场表，调能力层 `reset()`；
4. 状态回到 `created` —— 可以再 `plugin` + `start` 重来。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/kernel/src/Scope.ts` | `Scope` 本体（LIFO / 子先于父 / 单错不阻断 / 幂等） |
| `packages/kernel/src/fiber.ts` | `Fiber` 的 `onDispose` / `effect` / `runDisposers` / `dispose`（异步清理与在途结算） |
| `packages/kernel/src/Context.ts` | `deriveScope`：插件 ctx 每个方法的登记去向；`stop()` 的倒序卸载与根作用域释放 |
| `packages/kernel/src/__tests__/scope.test.ts` | 锁住 Scope 的八条行为（LIFO、幂等、子先于父、防泄漏…） |
| `packages/kernel/src/__tests__/fiber.test.ts` | 锁住 fiber 的异步 disposer、单错不阻断、幂等 |
| `packages/plugins/plugin-theme-default/src/index.ts` | 真实插件：`ctx.theme.register(...)` / `ui.add(...)` 全靠自动回收，一个 uninstall 都不写 |
| `packages/kernel/src/__tests__/contextRegistryState.test.ts` | 锁住「注册场放置随插件卸载自动摘除」 |

## 完整例子

一个能跑的插件：故意制造四种「要清理的东西」（定时器、事件监听、注册场条目、上架服务），
热卸一次，看它们全部自动消失。

### 目录长这样

```
plugin-scope-demo/
├── package.json           # 插件清单
└── src/
    ├── index.ts           # 插件入口：四种副作用 + 一个 uninstall 都不写
    └── main.ts            # 装配脚本：装 → 启 → 卸 → 检查
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/plugin-scope-demo/`。

### 文件一：插件入口

```ts
// 文件：packages\docs\public\examples\kernel\plugin-scope-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / apply）
// 位置：演示「作者不写 uninstall」的四种副作用
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'scope-demo'

export function apply(ctx: Context): void {
  // ① 定时器：返回清理函数 → 自动入袋
  ctx.effect(() => {
    const timer = setInterval(() => console.log('[scope-demo] tick'), 1000)
    return () => {
      clearInterval(timer)
      console.log('[scope-demo] 定时器已清')
    }
  })

  // ② 事件监听：订阅自动登记进本插件 fiber（不用接返回值）
  ctx.on('ping', () => console.log('[scope-demo] pong'))

  // ③ 注册场条目：放置随本插件回收（source 会写成本插件名）
  ctx.registryOf<{ note: string }>('scope-demo/things').add('one', { note: '我在场里' })

  // ④ 上架服务：卸载自动撤下
  ctx.provide('scopeDemoClock', { now: () => Date.now() })

  // ⑤ 私有状态：卸载后 value 清空，状态不再可达
  const counter = ctx.state({ n: 0 })
  counter.value.n += 1

  console.log('[scope-demo] 装载完成，四种副作用都登记好了')
}

// ⑥ 一个手写 cleanup 都不需要 —— 全交给框架
export const scopeDemoPlugin: PluginModule = { name, apply }
```

### 文件二：装配脚本（装 → 启 → 卸 → 检查）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-scope-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：验证「热卸之后一个不留」
import { Context } from '@mini-canvas/kernel'
import { scopeDemoPlugin } from './index'

const ctx = new Context({ dev: true })
await ctx.start()

// ① 热装
ctx.installPlugin(scopeDemoPlugin)
ctx.emit('ping')                                    // → [scope-demo] pong
console.log('服务在不在：', !!ctx.get('scopeDemoClock'))          // true
console.log('场里有没有：', ctx.registryOf('scope-demo/things').has('one'))  // true

// ② 热卸：一次调用，四种副作用全部自动回收
ctx.uninstallPlugin('scope-demo')

// ③ 检查
console.log('服务在不在：', !!ctx.get('scopeDemoClock'))          // false
console.log('场里有没有：', ctx.registryOf('scope-demo/things').has('one'))  // false
console.log('监听还在吗：', ctx.bus.has('ping'))                   // false
// 并且控制台会打印一次「定时器已清」—— 那是 ctx.effect 登记的清理函数跑了

ctx.stop()
```

> 注意第 ③ 步里 `ctx.bus` 是**根 Context 上的公开字段**（`readonly bus: EventBus`）。
> 平时用不到它；写测试 / 诊断「还有没有人在听」时很有用。

## 常见坑

1. **`ctx.effect` 里必须 `return` 清理函数**才算登记。忘了 return，那个定时器 / 监听**不会**被回收。
2. **只有「建立」类操作进袋子**。`get` / `emit` / `tryGet` 不进 —— 但你也别绕开 ctx 自己去 `window.addEventListener`；
   真需要就直接 `ctx.effect(() => { window.addEventListener(...); return () => window.removeEventListener(...) })`。
3. **根 `ctx.effect` 与插件 `ctx.effect` 不是一个袋子**。写在宿主装配里的 `ctx.effect` 活到 `ctx.stop()`，不随某个插件卸载。
4. **清理是逆序的**（后登记的先进）。如果你的清理之间有依赖（A 必须等 B 之后才能清），靠登记顺序表达。
5. **单个清理抛错不阻断其它**，而且错误会被吞掉 —— 所以清理里的异常不会冒出来。要看到就自己在清理里 `try/catch` + 打日志。
6. **异步清理要用 `stopAsync()` 等**：`stop()` 只保证同步清理跑完；异步清理（如异步保存）请 `await ctx.stopAsync()`。
7. **`ctx.state` 的 `value` 在卸载后被清空**，但那个对象本身还可能被别处引用着。要判断「插件还活着吗」，看 `ctx.fiber(name)?.stateName`，别靠 state 对象。
8. **能力层的注册（`ctx.nodes.register` 等）已经自带 effect 登记**，不用你额外包一层 —— 重复包也不会错，只是多余。

