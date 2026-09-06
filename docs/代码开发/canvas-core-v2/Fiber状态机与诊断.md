# Fiber：插件运行时句柄 + 状态机 + 诊断

> 来源：packages/canvas-core-v2/src/core/fiber.ts、Context.ts（inspectPlugins / registry / fiber()）、core/types.ts

每个插件实例在内核里都有一个 **Fiber** —— 你可以把它当成该插件的"心电图仪 + 遥控器"：查它现在是死是活、卡在哪、给了什么配置，也能手动 `dispose()`。

---

## 1. 怎么拿到某个插件的 Fiber

内核在 `Context` 上暴露两种取法：

### 1.1 `ctx.fiber(name)` —— 按名取单个

```ts
const f = ctx.fiber('my-plugin')
f?.stateName      // 'pending' | 'loading' | 'active' | 'failed' | ...
f?.name           // 'my-plugin'
f?.deps           // ['nodeStore', ...]（依赖）
f?.config         // 装配校验后的 config（激活后填好）
f?.error          // FAILED 后可用（出错原因）
f?.isDisposed     // 是否已 DISPOSED
```

未装/已卸返回 `undefined`。

### 1.2 `ctx.registry` —— 只读 Map 视图（诊断所有插件）

`ctx.registry` 每次访问现算返回一个只读 `Map<插件名, { status, fiber }>`。**纯只读**，不改装载/激活逻辑。`status` 用于 PENDING 诊断，`fiber` 供 await/dispose。

```ts
for (const [name, { status, fiber }] of ctx.registry) {
  console.log(name, status.state, status.missingDeps)
}
```

### 1.3 `ctx.inspectPlugins()` —— 数组快照（最好读）

返回 `PluginRuntimeStatus[]`，每项：

```ts
interface PluginRuntimeStatus {
  name: string            // 插件名
  state: string           // pending/loading/active/failed/unloading/disposed
  missingDeps: string[]   // 此刻仍未满足的依赖（仅当 state!=='active' 可能非空）
  error?: string          // FAILED 时错误信息（message 字符串）
}
```

```ts
ctx.plugin({ name: 'c', inject: ['late-svc'], apply() {} })
await ctx.start()
ctx.inspectPlugins().find(s => s.name === 'c')
// => { name: 'c', state: 'pending', missingDeps: ['late-svc'] }
```

`inspectPlugins` 覆盖两类条目：plugins 表里的（ACTIVE/PENDING…），以及已移出 plugins 表但仍保留的 **FAILED** 插件（供诊断，可重装）。

---

## 2. Fiber 状态机（FiberState）

源码里的 `enum FiberState`（用字符串名，方便展示/比较）：

```
PENDING → LOADING → ACTIVE
  ↘         ↘
 (缺依赖)   FAILED
卸载: ACTIVE/FAILED/PENDING → UNLOADING → DISPOSED
```

| 状态 | 字符串 | 大白话 |
| --- | --- | --- |
| `PENDING` | `'pending'` | 已声明 / 在等所需服务（依赖没到齐） |
| `LOADING` | `'loading'` | `apply`/config 正在跑 |
| `ACTIVE` | `'active'` | 加载完成，服务可用 |
| `FAILED` | `'failed'` | apply 或 config 校验抛错 |
| `UNLOADING` | `'unloading'` | disposer 正在跑（清理中） |
| `DISPOSED` | `'disposed'` | 已卸载，不可再启动 |

**状态推进你基本不用手动做**，内核（Context）在 start/install/uninstall/stop 时自动推。只有极少数"回退复用"场景内核内部会调 `markPending/markActive/markFailed`，作者不碰。

---

## 3. Fiber 的只读查询 & 等待稳定态

```ts
f.state          // FiberState 枚举
f.stateName      // 字符串名（诊断/展示用）
f.isDisposed     // 是否已释放
f.error          // FAILED 原因
```

**等它落到稳定态**：`f.settle()` 返回 Promise：

```ts
const f = ctx.fiber('p')
await f?.settle()
// - ACTIVE / DISPOSED → resolve(本 fiber)
// - FAILED → reject(error)
// - 仍 PENDING/LOADING/UNLOADING → resolve(当前态)；真正的装载/卸载由 ctx 驱动
```

**手动卸载**：`await f?.dispose()`（幂等，重复调用返回同一 Promise）。

---

## 4. Fiber 也是"副作用容器"

Fiber 除了当状态机，还是插件的副作用容器。`fiber.effect(fn)` / `fiber.onDispose(fn)` 把清理项按登记顺序收进来，`dispose()` 时**逆序**跑（支持 async disposer、单错不阻断）。插件 `ctx` 上那些自动回收，本质都是往 fiber 里登记。

作者通常不直接调 `fiber.effect`——用 `ctx.effect` 即可（已在 deriveScope 里接好 fiber）。直接调 fiber 的典型场景：做插件宿主/管理器，想精确控制某个插件的清理。

---

## 5. 典型诊断流程（怎么回答"插件为啥没跑起来"）

```ts
// 启动后逐插件看谁没 active、缺什么
for (const s of ctx.inspectPlugins()) {
  if (s.state !== 'active') {
    console.log(`${s.name}: ${s.state}`, '缺依赖:', s.missingDeps, s.error ?? '')
  }
}
// 例：
// consumer: pending  缺依赖: ['late-svc']
// bad:      failed   缺依赖: [] error: 'boom-config'
```

缺依赖的两种 PENDING 内核能区分：

- **缺的是"服务名"**（没上架的服务）→ `missingDeps` 报服务名。
- **缺的是"插件名"**（已登记但自身 PENDING/还没 ACTIVE）→ `missingDeps` 报插件名。

FAILED 的插件：已被移出可装载表（`listPlugins()` 不含它），但 `inspectPlugins()` / `registry` / `fiber()` 仍看得到它（带 `error`），可 `uninstallPlugin` 清掉再装同名复用。

---

## 6. Fiber 与 Context 状态别混淆

- **FiberState**：单个**插件**的运行时状态（pending/active/failed…）。用 `ctx.fiber(name).stateName` 看。
- **ContextState**：整个**内核**的状态，只有三种：`'created' | 'started' | 'stopped'`。用 `ctx.getState()` 看；`ctx.running`（state==='started'）判断是否运行中。

---

## 7. 坑与速记

1. `registry` / `inspectPlugins` 都是**只读**，别指望改它们能改变装载。
2. `ctx.fiber(name)` 对**已 ACTIVE / PENDING / FAILED / 刚卸完**的插件返回不同结果：ACTIVE/PENDING/FAILED 有 fiber；卸完 `fiber()` 返回 undefined（fiber 已移出 map）。
3. `stop()` 后 fiber 全清（重新 start 前 `fiber()` 都是 undefined）。
4. FAILED 插件仍在内存里留着供诊断；要彻底清掉/重装，先 `uninstallPlugin(name)`。
5. fiber 被 dispose 后再 `onDispose(fn)` 会立即执行 fn（防泄漏）但幂等。
