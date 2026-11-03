# 路线 A 增强 · cordis 逐字写法对齐（三能力终审后追加）

> 目标：让作者能**照 cordis 教程原文逐字抄**三类写法，本文件为本次追加任务的实施计划。
> 分支 feat/cordis-plugin-system，原地 commit（禁建/切分支），LF。内核纯逻辑零 Vue、不引第三方库。
> 完成后 196+37 测试不得红、内核 tsc EXIT=0、6 包 typecheck 全 PASS、demo build 零错。
> 关联目标文档：`docs/plan/plugin-cordis-migration-plan.md`（P1-P8 已完成态）。

## 一、三能力现状与缺口（已逐源码/类型核对）

### 能力 ① 类插件直接 `ctx.plugin(MyService)` / `installPlugin` / 宿主 plugins 装载
现状：内核 `plugin()`/`installPlugin()` 只认 `PluginModule` 对象（有 .name/apply）。传"类"时：
- 运行时会因读到继承的 `Function.prototype.apply`（typeof 函数）触发"new-without-new"语义，实际会被
  `runPlugin` 当 mod.apply 调用（apply 来自原型链非自有），`mod.apply.call` 崩溃；或 tsc 放行但运行才炸。
- 语义缺失：cordis 中类插件由 fiber `new 类(ctx, config)`（构造即 `super(ctx,name)` 上架服务）。

方案：在装配入口统一归一。加一个 `asPluginModule(plugin)`，把"类"（typeof function 且有 prototype）规整成
PluginModule：name=静态 `provide`(单串) ?? 类名、inject=静态 inject ?? []、Config=静态 Config、
apply=(ctx,config)=>{ new 类(ctx,config) }。`plugin()`/`installPlugin()`/宿主 `:plugins`/manager.install
参数放宽为 `PluginModule | ServiceClass`，内部一律先归一。归一后的对象走既有 plugin/installPlugin/deps/config/
scope 回收路径——依赖 PENDING、config 校验、卸载跟随与对象插件完全一致。Service 类把静态字段改为可带 `inject/Config`。

### 能力 ② `inject:['greeter']` 后 `ctx.greeter` 属性直访运行时可用（cordis proxy）
现状：插件拿到的 `ctx` 是 `deriveScope` 返回的**普通对象**，只有 `ctx.get('greeter')`；`ctx.greeter` 运行时
undefined、类型上也需 declare module 才有。cordis 的 ctx 是 Proxy，属性读命中服务即返回。

方案：`deriveScope` 返回的对象改为 **Proxy**（target 仍是原 api 对象 + 已 assign 的能力段 nodes/theme/...）。
get trap：若属性是 api 真实成员（on/emit/nodes/theme/commands/slots/settings/get/provide/effect…）→ 原样返回；
否则若名字命中"当前已上架服务名或内置 slots/settings"→ 返回 `ctx.get(prop)`；否则返回 undefined（不抛）。
目标保持纯逻辑零 Vue。能力段在 assign 进 target 后经 Proxy 读取不受影响；`ctx.get` 行为不变。
类型层靠 `interface Context`（与 class Context 合并）+ `interface PluginScope` 提供可合并缝（见下）。

### 能力 ③ `declare module { interface Events { 'stats/report'(...): void } }` 真正接线 + 类型化 on/emit
现状：内核事件类型走 `CanvasEventMap`（单 payload 对象）+ `EventName`；`interface Events` 不存在，
on/emit 对扩展名只有 `(name:string,...)` 松重载 → `ctx.emit('stats/report', a, b)` 无参数类型。
方案：新增**可合并全局 `interface Events {}`**（空，作者 declare module 扩展，事件名→监听函数签名）。
给 `PluginScope`/`Context` 的 on/once/emit/parallel/serial/bail/waterfall 加 `K extends keyof Events`
的重载：on(name, Events[K])、emit(name, ...Parameters<Events[K]>)。保留 CanvasEventMap 既有单 payload
重载与松 string 重载向后兼容。Events 里内置 internal 事件不必占位（CanvasEventMap 已覆盖）。

## 二、类型合并缝设计（关键取舍）
核心事实：canvas-base 只 `export type { Context }`（重导出 core 的 **class**）；core 没有同名 `interface Context`。
实测：在 core 内 `declare module './core/Context' { interface Context { greeter } }` 会与 `class Context`
**声明合并**（class+interface 合并），`ctx.greeter` 编译通过。故合并缝放 **core**：
- Context.ts：加 `export interface Context {}`（空，作合并缝，与 class 同名合并）。
- types.ts：加 `export interface Events {}`（可合并），保留 CanvasEventMap。
- 已有的 `Services`、`PluginScope` interface 本就是可合并缝。
作者对 `@mini-canvas/canvas-core-v2` 增强即可得 ctx.greeter/typed Events；canvas-base 透传该类型。
（取舍说明：任务示例写 `declare module '@mini-canvas/canvas-base'`，但 canvas-base 对 Context 是 `export type`
重导出，非真实声明，直接对 canvas-base 增强会新建无关 interface 而不命中 class。已与仓库既有写法一致——service.ts
docstring/context.test 都增强 core。故本次把权威合并缝放 core，报告里明说此取舍；canvas-base 作为类型透传面。）

## 三、改动文件清单
1. `packages/canvas-core-v2/src/core/types.ts` — PluginScope/Context 事件重载加 Events 键；`export interface Events {}`。
2. `packages/canvas-core-v2/src/core/Context.ts` — `export interface Context {}` 合并缝；class 方法加 typed 重载；
   `plugin`/`installPlugin` 参数放宽为 `PluginModule | PluginClass` 并在入口归一；`deriveScope` 返回 Proxy。
3. `packages/canvas-core-v2/src/core/service.ts` — 类插件形态支持说明 + 静态 `inject/Config` 字段标注 + 
   `ServiceClass`/`asPluginModule` 归一助手（放 service.ts，避免 types↔service 环）。
4. `packages/canvas-core-v2/src/core/index.ts` — 导出新增类型/助手。
5. `packages/canvas-base/src/index.ts` — 透传新类型/助手。
6. `packages/canvas-core-v2/src/core/__tests__/cordisParity.test.ts` — 新增三能力单测 + 类型断言。
7. 宿主/管理器装配参数类型：`canvas-render/src/host/*` 的 `PluginModule` 宽成 `PluginModule | PluginClass`
   （仅装配入口参数与冷启数组类型，最小改动；运行逻辑靠 core 归一）。
8. docs/plugin-dev/01、03、04 各补"照 cordis 原文抄"一节（不删原内容）。

## 四、测试方案
- 新增 `cordisParity.test.ts`：① 冷启动 ctx.plugin(类) 与 installPlugin(类) 均 ACTIVE、`super` 上架服务可被
  `inject:[name]` 等到、卸载跟随；② 同一服务经 proxy 被 `ctx.greeter` 读到、能力段不被 proxy 破坏、
  未命中属性返 undefined；③ declare Events 后 ctx.on/emit 多参运行时正确 + `@ts-expect-error`/正确类型断言。
- 回归：内核 196+37、内核 tsc、6 包 typecheck、demo vite build 全绿。

## 五、风险与注意
- Proxy get trap 需防破坏 `Object.assign` 后读取、`Symbol.*`/`then` 等 JS 探针；能力段务必先 assign 到 target。
- 不破坏旧"apply 里 new Service(ctx)"（service.test 别红）——归一仅新增路径，不动对象插件路径。
- 类插件 name 取 provide ?? 类名，保证唯一且可诊断；配置/依赖路径复用，不重复实现。
- 改动小步原子 commit，message 带 `cordis-parity` 前缀中文清晰。
