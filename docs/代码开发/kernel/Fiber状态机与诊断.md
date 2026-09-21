# Fiber：插件运行时句柄 + 状态机 + 诊断

> 来源：`packages/kernel/src/fiber.ts`（`Fiber` / `FiberState`）、`packages/kernel/src/Context.ts`（`fiber()` / `registry` / `inspectPlugins`）、`packages/kernel/src/types.ts`（`CanUninstallResult`）。

每个插件在内核里都有一个 **Fiber**：把它当成该插件的“心电图 + 遥控器”——查它现在什么状态、卡在哪、拿到的是什么配置，也能手动 `dispose()`。

---

## 1. 怎么拿到某个插件的 Fiber

### 1.1 `ctx.fiber(name)` —— 按名取单个（**根 ctx 上的方法**）

```ts
const f = ctx.fiber('my-plugin')
f?.stateName // 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | 'disposed'
f?.name // 'my-plugin'
f?.deps // ['doc', ...]（依赖）
f?.config // 装配校验后的 config（激活后填好）
f?.error // FAILED 后可用（原始错误对象，不是字符串）
f?.isDisposed // 是否已 DISPOSED
```

没装过 / 已卸返回 `undefined`。

### 1.2 `ctx.registry` —— 只读 Map 视图（枚举所有插件）

每次访问**现算**返回一个只读 `Map<插件名, { status, fiber }>`（`Context.ts:642`）。纯只读，不改装载 / 激活逻辑。

```ts
for (const [name, { status, fiber }] of ctx.registry) {
  console.log(name, status.state, status.missingDeps)
}
```

### 1.3 `ctx.inspectPlugins()` —— 数组快照（最好读，**根 ctx 上的方法**）

返回 `PluginRuntimeStatus[]`（`Context.ts:622`）：

```ts
interface PluginRuntimeStatus {
  name: string // 插件名
  state: string // pending/loading/active/failed/unloading/disposed
  missingDeps: string[] // 此刻仍未满足的依赖（仅当 state 不是 active 才可能非空）
  error?: string // FAILED 时的错误 message（字符串，便于面板展示）
  core?: boolean // 是否核心插件（宿主据此禁用卸载按钮）；非核心不带本字段
}
```

```ts
ctx.plugin({ name: 'c', inject: ['late-svc'], apply() {} })
await ctx.start()
ctx.inspectPlugins().find((s) => s.name === 'c')
// => { name: 'c', state: 'pending', missingDeps: ['late-svc'] }
```

`inspectPlugins` 覆盖两类条目：插件表里的（active / pending…），以及已移出插件表但 fiber 仍保留的 **FAILED** 插件（供诊断，可重装）。

> **作用域提醒**：`ctx.fiber` / `ctx.inspectPlugins` / `ctx.installPlugin` / `ctx.uninstallPlugin` / `ctx.stop` 是**根 `Context` 上的方法**。
> 插件在 `apply(ctx)` 里拿到的是 `PluginScope`：它有 `ctx.registry`、`ctx.canUninstall`、`ctx.surface`，但**没有** `fiber` / `inspectPlugins`。
> 所以插件侧想做插件管理，要么把这些能力从宿主传进来，要么干脆在宿主侧调。

---

## 2. Fiber 状态机（FiberState）

`packages/kernel/src/fiber.ts:20`：

```
PENDING → LOADING → ACTIVE
   ↘        ↘
  （缺依赖）  FAILED（apply / config 抛错）
卸载：ACTIVE / FAILED / PENDING → UNLOADING → DISPOSED
```

| 状态 | 字符串 | 大白话 |
| --- | --- | --- |
| `PENDING` | `pending` | 已声明 / 在等所需服务 |
| `LOADING` | `loading` | `apply` / config 校验正在跑 |
| `ACTIVE` | `active` | 跑起来了，服务可用 |
| `FAILED` | `failed` | `apply` 或 config 校验抛错 |
| `UNLOADING` | `unloading` | 清理中 |
| `DISPOSED` | `disposed` | 已卸载，不可再启动 |

**状态推进你基本不用手动做**，内核在 start / install / uninstall / stop 时自动推。只有内核内部的“回退复用”路径会调 `markPending` / `markActive` / `markFailed`，作者不碰。

---

## 3. Fiber 的只读查询 与 等稳定态

```ts
f.state // FiberState（值就是上面的字符串）
f.stateName // 同上，字符串名（诊断 / 展示用）
f.isDisposed // 是否已释放
f.error // FAILED 原因（原始错误对象）
```

**等它落到稳定态**：`f.settle()` 返回 Promise（`fiber.ts:278`）：

```ts
const f = ctx.fiber('p')
await f?.settle()
// - ACTIVE / DISPOSED → resolve(本 fiber)
// - FAILED → reject(error)
// - 仍 PENDING / LOADING / UNLOADING → 也 resolve(本 fiber，当前态)；真正的装载/卸载由 ctx 驱动
```

**手动卸载**：`await f?.dispose()`（幂等，重复调用返回同一个 Promise）。

---

## 4. Fiber 也是“副作用容器”

Fiber 除当状态机，还是插件的副作用容器：`fiber.effect(fn)` / `fiber.onDispose(fn)` 把清理项按登记顺序收进来，
`dispose()` 时**逆序**跑（支持异步清理、单错不阻断）。插件 `ctx` 上那些“自动回收”，本质都是往 fiber 里登记。

作者通常不直接调 `fiber.effect` —— 用 `ctx.effect` 即可。直接调 fiber 的典型场景是“做插件宿主 / 管理器，要精确控制某个插件的清理”。

---

## 5. 典型诊断流程（回答“插件为啥没跑起来”）

```ts
// 启动后逐插件看谁没 active、缺什么
for (const s of ctx.inspectPlugins()) {
  if (s.state !== "active") {
    console.log(s.name, s.state, "缺依赖:", s.missingDeps, s.error ?? "")
  }
}
// 例：
// consumer: pending  缺依赖: ["late-svc"]
// bad:      failed   缺依赖: [] error: "boom-config"
```

缺依赖有两种，`missingDeps` 都能报出来：

- 缺的是**服务名**（没人上架这个服务）→ 报服务名；
- 缺的是**插件名**（已登记但自身还没 ACTIVE）→ 报插件名。

FAILED 的插件：已被移出可装载表（`listPlugins()` 不含它），但 `inspectPlugins()` / `registry` / `fiber()` 仍看得到它（带 `error`），
可以 `uninstallPlugin(name)` 清掉，再装同名复用。

---

## 6. Fiber 与 Context 状态别混淆

- **FiberState**：单个**插件**的运行时状态（pending / active / failed…）。用 `ctx.fiber(name)?.stateName` 看。
- **ContextState**：整个**内核**的状态，类型上有三种：`created` / `started` / `stopped`。用 `ctx.getState()` 看；
  `ctx.running` 等价于（`ctx.getState()` 等于 `started`）。

> 冷知识一：Context 内部状态字段叫 `_state`（带下划线），因为新原语 `ctx.state()` 要占这个名字（`Context.ts:230` 的注释）。
> 冷知识二：`stopped` 虽然在类型里，但看 `stop()` 的实现，它**直接回到 `created`** —— 所以实际观察到的只有 `created` 和 `started`。

---

## 7. 坑与速记

1. `registry` / `inspectPlugins` 都是**只读**，别指望改它们能改变装载。
2. `ctx.fiber(name)` 对 ACTIVE / PENDING / FAILED 的插件都有 fiber；卸完之后返回 `undefined`（fiber 已移出表）。
3. `stop()` 之后 fiber 全清（重新 start 前 `fiber()` 都是 `undefined`）。
4. FAILED 插件仍留在内存供诊断；要彻底清掉或重装，先 `uninstallPlugin(name)`。
5. fiber 已 dispose 后再 `onDispose(fn)` 会立刻执行 fn（防泄漏），但幂等。
6. `fiber.error` 是原始错误对象；`inspectPlugins()` 里的 `error` 才是字符串。
