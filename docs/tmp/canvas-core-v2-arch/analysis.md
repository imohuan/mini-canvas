# canvas-core-v2 架构分析

日期：2026-09-05 · 分支 feat/cordis-plugin-system
范围：packages/canvas-core-v2（纯内核，零 Vue/DOM，Node 可单测）

---

## 0. 一句话

canvas-core-v2 是对 **Cordis 的 service + plugin + event + scope 回收**模型的本地重实现，
教程 04-events / 07-into-harness 里的模式（`Service 类 + super(ctx,name)`、`ctx.plugin(类)`、
`ctx.xxx` 服务直读、`inject` 依赖编排、typed emit/on、waterfall 等）**已全部落地并被真实使用**，
不是画饼。下面逐条对照。

---

## 1. 分层架构

```
canvas-core-v2 (本包)          —— 纯逻辑内核（Service/Context/Scope/Fiber/EventBus/
                                    NodeStore/Command/History/Selection/NodeFactory/
                                    NodeRegistry/ThemeRegistry/SlotRegistry/SettingsStore/
                                    configSchema/connection 校验……）
        │  只依赖 vue/pinia 类型
        ▼
canvas-render createMiniCanvasHost —— 引导层：new Context() → ctx.inject(9 个内核服务)
                                       → ctx.plugin(cold)×N → await ctx.start()
        │  不 import 任何具体插件
        ▼
packages/plugins/*  (node-text/node-image/theme-default/canvas-commands)
        │  apply(ctx) 里 ctx.nodes/theme/commands/slots/settings + 服务直读
        ▼
demo-web / 业务宿主
```

依赖方向：内核 ← 宿主 ← 插件，单向无环，可插拔、可热装/热卸/热重载。

---

## 2. 与参考文档逐条对照

| 教程模式（04/07） | canvas-core-v2 实现 | 状态 |
|---|---|---|
| `class StatsService extends Service`，`super(ctx,'stats')` 即上架 | `core/service.ts` 构造里 `ctx.provide(name,this)` | ✅ |
| `ctx.plugin(StatsService)` 类形态插件 | `pluginClass.ts asPluginModule` 归一成 {name,inject,Config,apply} | ✅ |
| `declare module` 合并 `interface Context { stats }` 让 `ctx.stats` 有类型 | 事件走 `Events`/`Services` 声明合并；服务运行时靠 `deriveScope` 的 **Proxy** | ✅（能力够） |
| `export const inject=['stats']` 缺提供方则 PENDING 等 | `Context.drain/tryActivate/depSatisfied` 确定性多轮激活 | ✅ |
| `ctx.stats.bump()` 后 `ctx.emit('stats/report')` | typed `ctx.emit` + 5 种分发（emit/parallel/serial/bail/waterfall） | ✅ |
| **进入 harness：`ctx.tools.register/execute`、监听 `tools/result`** | 对应物 = `ctx.get('command').execute()` + `ctx.commands.register`；事件流 `ctx.on('…/result')` | ✅ 同构（画布没有“模型工具”，换成 command） |
| scope 副作用自动回收、不手写 removeListener/uninstall | 每插件一个 `Scope`，`on/effect/inject/nodes/theme/…` 全登记，卸载一次逆序清光 | ✅（v2 相对 v1 的分水岭核心） |
| 热重载 provider，消费者跟随自动重载 | `uninstallPlugin→retractUnsatisfiedActives` + `wakePending→drain` 传递链 | ✅ 且有测试覆盖 |

结论：**你问的 `ctx.xxx 直接加载插件`、`ctx.tools.execute` 这类逻辑已实现并真实跑通**，
不只存在于 v2，还被 `plugin-canvas-commands` 等真插件用上。

---

## 3. 架构优点

- 依赖方向干净、纯内核零 Vue，Node 全可测（193 测试 / 20 文件全绿，tsc 无错）。
- 确定性装载：依赖满足即激活、否则 PENDING，不依赖登记顺序。
- 作用域自动回收 + fiber FAILED 保留可重装，诊断（inspectPlugins/missingDeps/error）友好。
- 装配 config 走 schema 校验 + 默认补齐 + settings 单一数据源。
- connection 校验模块把 v1 严格规则原样吸收，独立可测。

---

## 4. 发现的问题（按价值排序）

### C1. `ctx.plugin()` 在运行期嵌套调用会抛错（误导性死分支）
`deriveScope` 里 `PluginScope.plugin` 直接调根 `ctx.plugin(mod)`，而根 `Context.plugin` 断言 `state==='created'`。
插件 `apply` 都在 `started` 态跑 → 插件想“在自身 apply 里装个子插件”必抛
`Cannot plugin when state is "started"`。这与 `PluginScope.plugin` 注释“嵌套插件/子作用域”相矛盾；
真正要热装只能用 `ctx.installPlugin`。当前无插件触发，属潜在误导。
建议：让 `PluginScope.plugin` 转发到 `installPlugin`（热装语义），或删掉该分支/注释改明。

### C2. `devWhitelistWarn` 是死代码（想做的“未知事件告警”没实现）
`Context` 把 `dev` 传进 `new EventBus({ devWhitelistWarn })`，但 `EventBus` 里该字段**只存不读**；
`knownEvents`/`registerEventName`/`hasKnownEvent` 都在，`EventBus` 却没在 `emit` 里调 `hasKnownEvent`。
于是“对未登记事件名 emit 给 warn（治静默漏转发）”这个设计目标实际等于没做——漏打事件名仍静默失效。
要么补上 `emit/on` 的 dev 检查，要么删掉死代码。

### C3. Fiber 与 Scope 两套“副作用容器”冗余，Fiber 大半是死代码
Context 装载路径里插件副作用全进每插件的 `Scope`；`Fiber` 自带的一套（`onDispose/effect/collectResult`、
异步 disposer、`inflight` 等待、`dispose()` 逆序 await）**从未被喂任何清理项**——Context 只用它的状态迁移
（markLoading/Active/Pending/Failed）+ `dispose()`（此时 scope 已清，等于空转置 DISPOSED）。
约 100 行异步 disposer 逻辑在主路径上是死代码，且两个“能装副作用”的抽象并存，清理归属不清。
建议：明确二选一——要么插件副作用登记进 Fiber、Scope 只做轻量包一层；要么删掉 Fiber 的清理队列，让 Fiber 只管状态机。

### C4. `History.withRecord` 遇 async 会漏记录（潜在 bug，当前没触发）
`withRecord` 在 `fn()` 前后**同步**各拍一次快照、`finally` 同步复位 `capturing`。
若 fn 是 async（微任务里才改 nodeStore），`after` 快照和复位都在改动落地前发生 → 实际变化不入历史，
且期间的嵌套改动不再被保护。当前调用方（canvas-commands 的 delete/create-node）都是同步体，暂不触发；
一旦有人用 async 命令（如 await fetch 后建节点）就翻车。建议在 withRecord 里对返回 Promise 的 fn 做 await-after 支持。

### C5. `apply(ctx, config)` 拿到的是快照，不是活的 config
运行时 `ctx.settings.set()` 只写 `SettingsStore` 并 notify；**当初 `resolveConfig` 塞给 `apply` 的那个
`config` 对象不会被更新**。插件若只读自身 `config` 而不主动 `settings.onChange(插件名, …)` 订阅，
面板改完它读到的仍是旧值 → “实时生效”实际靠插件自觉订阅才能成立，是个 footgun。
建议：文档里把“config 是初值快照、实时变化必须订阅 onChange”写清楚，或提供把两者绑定的助手。

### C6. capabilities 里 `theme.register` 用了 `this.add`（解构即炸）
`capabilities.ts` `theme.register` 内部 `this.add(...)`。正常 `ctx.theme.register()` 里 `this` 绑定到对象，
OK；但一旦有人 `const { register } = ctx.theme` 解构再调就 `this` 为 undefined 崩。低危，但属典型的
JS 方法坑，建议改成闭包引用 `add` 而不走 `this`。

### C7. 冷启动中途某插件抛错 → ctx 停在“半启动”态（无回滚）
`start()` 里逐个 `drain→tryActivate`，若中间某插件 config/setup 抛错，前面已激活的插件仍 ACTIVE、
`state='started'`，但 `start()` 已 reject，宿主没 try/catch 的话直接 unhandled。健壮性缺口。
建议宿主层包一层 try/catch 或在失败时把 ctx 回滚到可安全停掉的状态。

（低危备注）`SettingsStore.clamp` 只对 number 夹取、面板 set 的 value 类型松散（string 进 boolean/select 不做强校验）；
`settings.set` 若 key 未定义会抛，但对“尚未 define 就 set”的行为没有特别引导。

---

## 6. 全量覆盖补充（52/52 文件通读后追加）

本轮把 52 个文件全部读净（含全部 `__tests__`）。以下是对 §4 的修正/补充：

### 修正 §4-C5（config 快照）
读了 `configSchema.test` / `capabilities.test` / `b2SettingsHost.test` 后确认：**“apply(ctx,config) 收初值快照、实时变化靠 `settings.onChange(插件名,…)` 按作用域订阅”就是设计本意**，且有完整测试演示这套两段式契约。所以它不是 bug，只是需要把“config 是初值、实时必须订阅 onChange”写进给插件作者的口径里（已有测试当范本）。降级为“文档/接口约定需讲明”，非缺陷。

### 确认 §4-C3（Fiber 冗余）——从测试侧再次坐实
`fiber.test.ts` 里 Fiber 的异步 disposer / iterable / {dispose} 等能力**全部只在本类隔离测试里被覆盖**；Context/宿主路径（scope.test、context.test、cordisParity）一律走 `Scope`。即 Fiber 的清理队列在主路径确实是死代码——两套副作用容器并存实锤。建议收敛。

### 新增 C8. SaveService 的脏数据在 `dispose()`/`stop()` 时会丢
`SaveServiceImpl.dispose()` 只清防抖计时器、**不 flush**（saveContract.test 也这样断言：dispose 后 `isDirty()===true`）。
宿主 `createMiniCanvasHost` 的 `host.stop()` = `ctx.stop()`，并不调 `save.flush()`；命令里 `persist()` 走的是 `save.set`（入脏队列，靠 setTimeout 自动 flush）。
→ 若某次 `set` 后、自动 flush 触发前进程被 stop/关闭，最后一次写入会丢。本包没接 `pagehide/hidden`（注释说让宿主接），但宿主当前也没在 stop 前 flush。
建议：`host.stop()` 前 `await save.flush()`，或在命令 persist 后同步 flush，避免“最后一笔丢失”。

### 新增 C9. `normalizeKey` 注释与实现不符（小）
`keys.ts` 注释声称归一到“小写 kebab”，实现只有 `trim().toLowerCase()`，没有把空格/下划线转成中划线。调用方都传好了 kebab key 所以不影响现状，但注释“kebab”名不副实，易误导后来者在 key 里带空格。建议注释改“小写化”或补转换。

### 新增 C10. 服务名/插件名同 space 命名（设计取舍，需知悉）
服务注入表（`services` map）与插件表（`plugins` map）是**两套命名空间**，`depSatisfied` 对每个 dep 先查服务名、再查“已登记且 ACTIVE 的插件名”。
因此一个插件可以 `inject: ['someName']` 既可以指“别人提供的服务”，也可以指“另一个插件本身”——名字撞了语义易混。
`cordisParity`/`service.test` 里就混用了（consumer 有的 inject 服务名 'greeter'、有的 inject 插件名 'greeter-plugin'）。
不是 bug，但建议在 API 文档明确：**inject 优先解析服务名；想表达“等某插件”时名字要与任何服务名错开**，否则将来某服务叫了某插件同名会误配。

### 全量绿
- vitest：20 文件 / 193 用例全绿（node 环境）。
- tsc --noEmit：0 错误。
- 未被任何测试/宿主直接消费的“孤儿导出”：`topoSort`（Context 用的是自己的 drain/依赖满足扫描，不走 topoSort）、`ServiceClass`/`asPluginModule` 的 `provide` 数组形态、`registerThemeSlot`/`registerNodeType` 的低层接缝已被 capabilities 收口（仍导出兼容）。这些属“可选面”，不算缺陷，但说明 API 面比实际用到的宽，存在两套等价入口（如 `registerNodeType` 与 `ctx.nodes.register`），维护时留意双份实现。

---

## 7. 已落地修复与决策记录（后续轮）

### 已修复（commit 6c208e9 / 5f5e013）
- C1/C2/C6/C8/C9 五项低风险修复：见 §4/§5 与 commit message。canvas-core-v2 196 测试、canvas-render 37 测试、4 插件 tsc 全绿。
- **C3（Fiber 收敛）已按"对齐 cordis 02 原版"落地**：Context 删 `pluginScopes` map，插件副作用(on/once/effect/inject/provide/注册/Config 声明)全登记进各自 Fiber；
  卸载/回退走新增的 `fiber.runDisposers()`（同步 LIFO、不置 DISPOSED、可回退 PENDING 后重载）；
  保留 `rootScope` 供根 ctx.effect；Scope 类保留。验证全绿。
  - **有意延后项**：`ctx.plugin(子)` 目前仍返回父 ctx(self)，未改成 cordis 原版的"返回子插件 fiber"。
    因返回类型牵连根 `Context.plugin`(cold-start 链式返回 this)与 `PluginScope` 接口签名，且当前无任何调用点需要它，
    属低价值高牵连改动。若以后要"父插件可 `await 子fiber.dispose()` 单独卸子插件"，再单独做。

### C7（你选方案 2）：保持现状，仅文档注明
冷启动 `start()` 中途某插件 config/setup 抛错 → 前面已激活插件仍 ACTIVE、ctx 停在 `started`，`start()` 已 reject。
不改代码，由调用方负责 `start()` 失败后自行 `ctx.stop()`/`host.stop()` 收尾。
建议给宿主层(createMiniCanvasHost 的 `ctx.start()` 段)包 try/catch 的调用方留意：失败时调 `stop()` 回滚，勿留下半启动 ctx。

---

## 5. 建议的后续优化（可选）

1. 收敛 C3：把 Fiber 要么接进装载路径、要么删清理逻辑，别留两套。
2. 修 C1（嵌套 plugin 语义）+ C2（补 dev warn 或删）。
3. C4 加 async fn 支持；C5 在 API 文档/注释点明 config 快照语义。
4. 若希望把“tools 流水线”那种中间件/审批模型也搬进来，可在 EventBus 的 `serial/bail/waterfall`
   之上加一个 `ctx.commands.beforeEach/afterEach` 之类的通用命令拦截层（当前 command 无 middleware）。
