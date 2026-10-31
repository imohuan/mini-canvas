# Fiber 状态机与诊断

**一句话定位**：**Fiber 是「一个插件的运行时句柄」—— 它记录这个插件现在处于哪一步（在等依赖 / 正在跑 / 跑挂了 / 正在清），也是它全部副作用的容器。**

**它属于哪一档**：**内核自带（框架层）**。源码：`packages/kernel/src/fiber.ts`（`Fiber` / `FiberState`）、`packages/kernel/src/Context.ts`（`fiber()` / `inspectPlugins()` / `registry` 三个查询入口，以及 `tryActivate` / `retractUnsatisfiedActives` / `stop` 里的状态推进）。

## 它是什么

把 Fiber 想成插件的**病历卡 + 遥控器**：

- **病历卡**：现在是什么状态、依赖缺谁、配置有没有校验失败、错误是什么 —— 一眼看清。
- **遥控器**：`await fiber.settle()` 等它稳定、`fiber.dispose()` 手动清掉它。

它同时是**副作用容器**：插件在 `apply` 里做的每一件「建立」类的事（`on` / `effect` / `inject` / 各种 register），都堆进这个 fiber，
卸载时**逆序**逐个跑清理。

按「数据 / 展示 / 能力 / 配置」分，它是**诊断与生命周期**那一格 —— 只管「这个插件怎么样了」，不管业务。

## 为什么需要它

没有 Fiber 之前，「插件为什么没跑起来」只能靠猜：

- 是没装上？还是装了但在等依赖？
- 是 `apply` 里抛错了？还是配置校验没过？
- 缺的是哪个依赖？缺的是**服务名**还是**插件名**？

Fiber 把这些全部做成**可读的诊断数据**（`fiber.state` / `missingDeps` / `error`），
并且给出了「等稳定态」的能力（`fiber.settle()`），宿主面板与测试都靠它。

另外，它是**热卸连坐**能成立的底座：提供方被卸 → 依赖方 fiber 被 `runDisposers` 清干净 + `markPending`（**不置 DISPOSED**，保留登记可复用）→ 提供方装回来自动重载。

## 怎么用

### 一、拿到 fiber 的三个入口

```ts
// ① 按名取一个（根 ctx 上的方法）
const f = ctx.fiber('my-plugin')   // 没装过 / 已卸 → undefined
f?.stateName   // 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | 'disposed'
f?.deps        // 依赖名数组（初始化自插件 inject）
f?.config      // 激活后由 ctx 填好的「校验 + 补默认」后的 config
f?.error       // FAILED 后的原始错误对象
f?.isDisposed  // 是否已 DISPOSED

// ② 枚举所有插件（只读 Map，现算）
for (const [name, { status, fiber }] of ctx.registry) {
  console.log(name, status.state, status.missingDeps)
}

// ③ 数组快照（最好读；诊断面板 / console 用这个）
ctx.inspectPlugins()
// → [{ name: 'theme-default', state: 'active', missingDeps: [] },
//    { name: 'consumer', state: 'pending', missingDeps: ['greeter'] },
//    { name: 'bad', state: 'failed', missingDeps: [], error: 'config invalid' }]
```

`PluginRuntimeStatus` 的字段（`packages/kernel/src/Context.ts`）：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `name` | `string` | 插件名 |
| `state` | `string` | fiber 状态名（下表那六个） |
| `missingDeps` | `string[]` | 此刻**仍未满足**的依赖（`state === 'active'` 时恒为空） |
| `error` | `string?` | 只有 `failed` 才有：错误 `message` 字符串（便于面板显示） |
| `core` | `boolean?` | 是核心插件才带这个字段（宿主据此**禁用卸载按钮**） |

> **作用域提醒**：`ctx.fiber` / `ctx.inspectPlugins` / `ctx.installPlugin` / `ctx.uninstallPlugin` / `ctx.stop` 是**根 `Context` 上的方法**。
> 插件里拿到的 `PluginScope` 有 `ctx.registry` / `ctx.canUninstall` / `ctx.surface`，但**没有** `fiber` 与 `inspectPlugins`。
> 插件侧要做插件管理，得从宿主把能力传进来，或者干脆让宿主来做。

### 二、状态机（六个状态）

```
PENDING → LOADING → ACTIVE
   ↘         ↘
 （缺依赖）    FAILED（apply 或 config 校验抛错）

卸载：ACTIVE / FAILED / PENDING → UNLOADING → DISPOSED（不可再启动）
```

| 状态 | 字符串 | 大白话 | 怎么走到这里 |
| --- | --- | --- | --- |
| `PENDING` | `pending` | 已登记，在等依赖 | `ctx.plugin` / `ctx.installPlugin` 后依赖不满足；或被连坐回退 |
| `LOADING` | `loading` | `apply` / config 校验正在跑 | `tryActivate` 里 `fiber.markLoading()` |
| `ACTIVE` | `active` | 跑起来了，服务可用 | `apply` 正常返回后 `fiber.markActive()` |
| `FAILED` | `failed` | `apply` 或 config 校验抛错 | `fiber.markFailed(err)`（**fiber 保留**供诊断） |
| `UNLOADING` | `unloading` | 正在清理 | `fiber.dispose()` 开头 |
| `DISPOSED` | `disposed` | 已卸载，**不可再启动** | 清理跑完 |

**这些状态不用你手动推** —— 内核在 `plugin` / `start` / `installPlugin` / `uninstallPlugin` / `stop` 时自动推。
只有内核内部的「回退复用」路径会调 `markPending` / `markActive` / `markFailed`（对应 `Fiber` 上的三个公开方法）。

### 三、两套状态词，别搞混

内核里有**两套**状态词，诊断时主要看 Fiber 那套：

| | `FiberState`（插件运行时） | `Lifecycle`（业务生命周期，`ctx:lifecycle-change` 事件用） |
| --- | --- | --- |
| 取值 | `pending` / `loading` / `active` / `failed` / `unloading` / `disposed` | `installing` / `installed` / `activating` / `active` / `uninstalling` / `uninstalled` / `error` |
| 怎么查 | `ctx.fiber(name)?.stateName`、`ctx.inspectPlugins()` | `ctx.on('ctx:lifecycle-change', …)` 订阅 |
| 用途 | 诊断卡在哪、等依赖、看错误 | 观察装载/卸载的**阶段事件** |

两条实测细节：

- `Lifecycle` 枚举里有 `INSTALLED`，但 `Context.setLifecycle` **从不下发它** —— 实际只发 `installing / activating / active / uninstalling / uninstalled / error`。
- `ContextState`（整个内核的状态）类型上有 `created` / `started` / `stopped` 三种，但 `stop()` 直接回到 **`created`**，所以实际只观察到 `created` 与 `started`。

### 四、等稳定态：`fiber.settle()`

```ts
settle(): Promise<this>
// ACTIVE / DISPOSED             → resolve(本 fiber)
// FAILED                        → reject(error)
// PENDING / LOADING / UNLOADING → 也 resolve(本 fiber，当前态)
```

注意最后一条：**pending / loading / unloading 都会立刻 resolve**，不做等待 —— `settle()` 只在三种「有确定结论」的态上给结果。
所以它的用法是「拿这一次装载 / 卸载的结果」：

```ts
const f = ctx.fiber('bad')
try {
  await f?.settle()      // FAILED → 这里会抛
} catch (err) {
  console.log('它挂了：', (err as Error).message)
}
```

**手动卸载**：`await fiber.dispose()` —— 幂等（重复调用返回同一个 Promise），
同步清理**立即执行**、异步清理被收集进返回的 Promise 里等完。

### 五、典型诊断流程（「插件为啥没跑起来」）

```ts
// ① 一眼看全：谁没 active、缺什么、报什么错
for (const s of ctx.inspectPlugins()) {
  if (s.state === 'active') continue
  console.log(s.name, s.state, '缺依赖:', s.missingDeps, s.error ?? '')
}
// 例：consumer: pending  缺依赖: ["greeter"]
//     bad:      failed   缺依赖: []        boom-config
```

按状态分流排查：

| 看到的 | 大概率是什么原因 | 下一步 |
| --- | --- | --- |
| `pending` + `missingDeps: ['xxx']` | 没人提供 `xxx`（服务名）或那个插件没 ACTIVE | 核对服务名拼写（老名 `nodeStore` 会永久 pending）；确认提供方插件装没装 |
| `failed` + `error` | `Config` 校验没过，或 `apply` 里抛错 | 读 error 消息；config 错误形如 `[config] invalid config: …` |
| 根本没出现在 `inspectPlugins()` | 没装上（`ctx.plugin` 没调 / 名字不同） | 用 `ctx.listPlugins()` 核对名字 |
| `disposed` | 已经被卸了 | 要重装：`ctx.installPlugin`（同名可复用） |

拿到 fiber 后可以更细地看：

```ts
const f = ctx.fiber('bad')
f?.error           // 原始错误对象（inspectPlugins 里给的是 message 字符串）
f?.config          // 校验后填进去的 config（能反向确认「我传的值去哪了」）
f?.deps            // 依赖清单（和 inspectPlugins 的 missingDeps 对照看）
```

### 六、FAILED 之后能干什么

config 校验失败或 `apply` 抛错时，内核做的是：**把插件移出可装载表**（`ctx.listPlugins()` 不再包含它），
**但保留 fiber**（`inspectPlugins()` / `ctx.fiber(name)` 仍看得到，带 `error`）。

所以：

- 想彻底清掉它 → `ctx.uninstallPlugin(name)`（fiber 会被 dispose）；
- 想重来一遍 → 直接 `ctx.installPlugin(修好的同名插件)`（名字已经空出来了）。

```ts
// 修好配置，重新装同名的
ctx.uninstallPlugin('bad')                 // 清掉 FAILED 的残留
ctx.installPlugin(fixedPlugin, { width: 6 })
```

### 七、热卸「连坐」：Fiber 的复用路径

卸掉一个提供方插件之后，内核会扫描「现在依赖不满足」的 ACTIVE 插件，把它们**回退到 PENDING**：

```
P 被卸 → A 依赖 P 的服务 → A 的副作用被 runDisposers() 清干净 → A 的 fiber markPending()
                                                    ↑ 不置 DISPOSED —— 保留登记，可复用
P 装回来 → wakePending() → drain() → A 自动重载（同一个 fiber 再次 markActive）
```

这条路径由 `retractUnsatisfiedActives` / `retractPlugin` 实现，能一层层传递下去。

### 八、核心插件：`core: true` 拒卸

插件可以声明 `core: true`（对象形态）或 `static core = true`（类形态）。被标记者：

- `ctx.uninstallPlugin(name)` **直接返回 `false`**，而且**一次真副作用都不产生**：
  不 dispose fiber、不发 `ctx:plugin-uninstalled`、不触发依赖方回退；
- 想知道「是被拦了还是根本没这个插件」，用 `ctx.canUninstall(name)` 先问：

```ts
type CanUninstallResult =
  | { ok: true }
  | { ok: false; reason: 'core' | 'not-found' | 'not-started' }
```

- `ctx.stop()` / `ctx.stopAsync()` **不走这个守卫** —— 整体生命周期终结不是动态卸载，核心插件也必须正常回收。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/kernel/src/fiber.ts` | `Fiber` 本体：状态机 + 副作用容器 + `settle` / `dispose` |
| `packages/kernel/src/Context.ts` | `fiber()` / `inspectPlugins()` / `registry`；`tryActivate` / `retractUnsatisfiedActives` / `stop` 里的状态推进 |
| `packages/kernel/src/__tests__/fiber.test.ts` | 锁住 settle / 幂等 / 异步 disposer / 单错不阻断等行为 |
| `packages/canvas-render/src/host/pluginManager.ts` | 画布插件管理器：把 `inspectPlugins()` 的 `missingDeps` / `error` 并进 `list()` / `diagnose()`（真实诊断消费点） |
| `packages/docs/canvas-render/create-host.md` | 宿主安装句柄 `host.manager` 怎么用这些诊断数据 |
| `packages/docs/.vitepress/theme/components/SurfaceReport.vue` | 文档站「活快照」页：把每个插件的 state / missingDeps 直接画成表 |

## 完整例子

一个能在 Node 里直接跑的诊断脚本：故意制造四种「没跑起来」的情形，再逐一定位。

### 目录长这样

```
plugin-fiber-demo/
├── package.json            # 清单
└── src/
    ├── demoPlugins.ts      # 四个插件：正常的 / 缺依赖的 / config 错的 / apply 抛错的
    └── main.ts             # 诊断脚本：跑一遍，逐个诊断出来
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/plugin-fiber-demo/`。

### 文件一：四个插件

```ts
// 文件：packages\docs\public\examples\kernel\plugin-fiber-demo/src/demoPlugins.ts
// 格式：TypeScript 模块（四个插件模块，用于诊断演示）
// 位置：演示用，集中放一起
import type { Context, PluginModule } from '@mini-canvas/kernel'

/** ① 正常插件：提供一个服务 */
export const healthyPlugin: PluginModule = {
  name: 'healthy',
  apply(ctx: Context) {
    ctx.provide('healthy-svc', { ok: true })
  },
}

/** ② 缺依赖：等一个永远不来的服务 → 停在 pending */
export const waitingPlugin: PluginModule = {
  name: 'waiting',
  inject: ['never-provided-svc'],
  apply() {
    console.log('这行永远不会打印')
  },
}

/** ③ config 校验失败：装了也没跑起来，fiber 进 failed */
export const badConfigPlugin: PluginModule = {
  name: 'bad-config',
  Config: { width: { type: 'number', default: 2, min: 1, max: 6 } },
  apply() {},
}

/** ④ apply 里抛错：fiber 同样进 failed，但错误来自运行期 */
export const throwingPlugin: PluginModule = {
  name: 'throwing',
  apply() {
    throw new Error('boom-apply')
  },
}
```

### 文件二：诊断脚本

```ts
// 文件：packages\docs\public\examples\kernel\plugin-fiber-demo/src/main.ts
// 格式：TypeScript 模块（诊断脚本，`npx tsx src/main.ts` 即可跑）
// 位置：把四个插件装进同一个内核，逐个诊断
import { Context } from '@mini-canvas/kernel'
import { badConfigPlugin, healthyPlugin, throwingPlugin, waitingPlugin } from './demoPlugins'

const ctx = new Context({ dev: true })

// ① 先装两个「正常 / 缺依赖」的，启动看结果
ctx.plugin(healthyPlugin)
ctx.plugin(waitingPlugin)
await ctx.start()
console.log('[main] 启动后：healthy =', ctx.fiber('healthy')?.stateName, ' waiting =', ctx.fiber('waiting')?.stateName)

// ② 热装一个 config 越界的：installPlugin 会把错误抛出来（fiber 留在 failed）
try {
  ctx.installPlugin(badConfigPlugin, { width: 999 })
} catch (err) {
  console.log('[main] 装 bad-config 抛出来的错误：', (err as Error).message)
  // → [config] invalid config: "width" = 999 exceeds max 6
}

// ③ 再热装一个 apply 里抛错的：同样抛出来，fiber 也是 failed
try {
  ctx.installPlugin(throwingPlugin)
} catch (err) {
  console.log('[main] 装 throwing 抛出来的错误：', (err as Error).message)   // boom-apply
}

// ④ 一眼看全：谁 active、谁 pending（缺什么）、谁 failed（错什么）
console.log('\n=== 诊断表 ===')
for (const s of ctx.inspectPlugins()) {
  const deps = s.missingDeps.join(',') || '-'
  console.log(s.name + '  state=' + s.state + '  缺依赖=' + deps + '  error=' + (s.error ?? '-'))
}

// ⑤ 拿到单个 fiber 看细节
const w = ctx.fiber('waiting')
console.log('\nwaiting 的 deps：', w?.deps)          // ['never-provided-svc']
console.log('waiting 当前态：', w?.stateName)         // 'pending'

const b = ctx.fiber('bad-config')
console.log('bad-config 的原始错误：', (b?.error as Error)?.message)

// ⑥ 修好配置，重装同名的（FAILED 的已经被移出可装载表，名字空出来了）
ctx.uninstallPlugin('bad-config')
ctx.installPlugin(badConfigPlugin, { width: 3 })
console.log('\n重装后 bad-config：', ctx.fiber('bad-config')?.stateName)   // 'active'

// ⑦ 等稳定态：FAILED 时 settle() 会 reject
const t = ctx.fiber('throwing')
if (t) {
  try {
    await t.settle()
  } catch (err) {
    console.log('settle 捕获到：', (err as Error).message)             // boom-apply
  }
}

// ⑧ 先问再卸
console.log('\n能不能卸 healthy：', JSON.stringify(ctx.canUninstall('healthy')))   // {"ok":true}
console.log('能不能卸没装的：', JSON.stringify(ctx.canUninstall('ghost')))         // {"ok":false,"reason":"not-found"}

ctx.stop()
```

实测输出（节选）：

```
[main] 启动后：healthy = active  waiting = pending
[main] 装 bad-config 抛出来的错误： [config] invalid config: "width" = 999 exceeds max 6
[main] 装 throwing 抛出来的错误： boom-apply

=== 诊断表 ===
healthy  state=active  缺依赖=-  error=-
waiting  state=pending  缺依赖=never-provided-svc  error=-
bad-config  state=failed  缺依赖=-  error=[config] invalid config: "width" = 999 exceeds max 6
throwing  state=failed  缺依赖=-  error=boom-apply

重装后 bad-config： active
settle 捕获到： boom-apply
能不能卸 healthy： {"ok":true}
能不能卸没装的： {"ok":false,"reason":"not-found"}
```

## 常见坑

1. **`ctx.fiber` / `ctx.inspectPlugins` 是根 `Context` 的方法**，插件 `PluginScope` 上没有。
   插件里想自诊断，请宿主把数据传进来，或让宿主侧查。
2. **`ctx.fiber(name)` 在 `stop()` 之后返回 `undefined`**（fiber 表已清空）。重新 start 前查不到任何 fiber。
3. **FAILED 的插件不在 `ctx.listPlugins()` 里，但 `inspectPlugins()` / `ctx.fiber()` 里还在** ——
   这是刻意的（保留供诊断、可重装同名）。别用两者之差当「装没装」的判据。
4. **`settle()` 对 `pending` / `loading` / `unloading` 立刻 resolve**，不做等待 ——
   只在 ACTIVE / DISPOSED / FAILED 三种态上有确定结论。要真的等到 ACTIVE，请用事件或轮询 `stateName`。
5. **`fiber.error` 是原始错误对象，`inspectPlugins()[i].error` 是字符串**。面板展示用后者，看堆栈用前者。
6. **`missingDeps` 在 ACTIVE 时恒为空数组**（实现里直接按状态短路）。想确认「声明了哪些依赖」要看 `fiber.deps`。
7. **核心插件的 `uninstallPlugin` 返回 `false` 时什么都没发生**（不是「卸一半」）—— 想知道原因先 `ctx.canUninstall`。



