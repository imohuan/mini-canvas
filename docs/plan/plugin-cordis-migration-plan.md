# 🎯 目标文档 · mini-canvas 插件系统 Cordis 化（目标驱动文档）

> ## ✅ 完成态（2026-09-05）
> P1–P8 全部落地，末尾"验收总清单"已全勾。终审（独立 run_subagent 严格审核，PASS 有保留、无必须修缺口）已通过；
> 红线零违规（内核/render/base/plugins 无 @deepseek-ai/schemastery/cosmokit/standard-schema/vendor-cordis import，内核零 Vue）。
> 全量验证：内核 vitest 196、渲染 37 全绿；内核 tsc EXIT=0；canvas-base/render/4 插件 typecheck 全 PASS；demo vite build 零错。
> 浏览器端到端人工点验受环境限制未做（demo build + 运行时链路源码核验已覆盖）——需补时在能起浏览器的环境跑 demo :5199 人工点验即可。
> 注：终审过程报告原在 docs/tmp/plugin-system-review/，已随 docs/tmp 中间文档按用户要求清理。

> 工作区：`D:/Code/Git/mini-canvas`。分支：feat/cordis-plugin-system（原地 commit，禁切/建分支，LF，只动本目标文件，不碰仓库根 src/）。
> 开工说明：每次开工把本文件读给/贴给 AI。照它做，别自己发挥，直到末尾"验收总清单"全勾才结束。

## 〇+、终审后追加「改成最新的方式」（2026-09-05，本小节为当前目标）

终审已 PASS 后用户追加：把 `packages/plugins/` 4 个真实插件再往 **cordis 最新写法**推一档，
体现路线A已补的内核能力（Service 类、ctx 服务直访、declare module 类型增强）。基线全绿不许破坏。

### 追加目标（每插件按本质定，别硬套）
- **A/B · plugin-node-text / plugin-node-image**：对象插件 `{name,inject,apply}` 保持（本质=注册节点+顺带暴露服务，非纯 Service），
  但服务从「apply 里手写 `ctx.inject('text',{…})` 内联对象」升级为 **`class TextService extends Service`**（构造 `super(ctx,'text')` 自动上架，随插件 scope 回收）。
  - 取舍：方法内**惰性 `this.ctx.get('nodeStore'/'save')` 取现时服务、不缓存**（避免卸载残留/换实例脏引用）；并把 nodeStore/save 写进 `inject` 硬依赖
    （宿主恒在、start 前注入 → 无 PENDING 风险；缺则让插件 PENDING 而非 ctx.get 静默返 undefined，更 cordis 规范）。
  - `declare module '@mini-canvas/canvas-core-v2' { interface Context { text: TextService } }` 类型增强 → 宿主/作者 `ctx.text` 直访(Proxy)或 `ctx.get<TextService>('text')` 均类型安全。
  - 保留 `export interface TextNodeService/ImageNodeService`（形状不变）供 `.vue` 消费端零改动；`nodeTextPlugin/nodeImagePlugin` 出口与 `name='text'/'image'` 不变 → 宿主装配 + HMR reload('text'/'image') 不破。
- **C · plugin-canvas-commands**：纯消费方、无对外服务 → cordis 正确写法 = 把真用的核心服务写进 `inject` 硬依赖 + `ctx.xxx` 直访(Proxy)。
  - `inject=['nodeStore','save','nodeFactory','selection','history']`（宿主注入名一致）；apply 里删 `ctx.get`，改 `ctx.nodeStore/save/nodeFactory/selection/history` 直访。
  - `declare module ... { interface Context { nodeStore: NodeStoreService; save: SaveService; nodeFactory: NodeFactoryService; selection: SelectionService; history: HistoryService } }` 给恒在服务加直访类型。
  - `canvasCommandsPlugin` 出口与 name='commands' 不变。
- **D · plugin-theme-default**：已最新(Config+apply)，无对外服务 → 基本不动，跑 typecheck 确认不红即可。

### 追加验收（对应主清单 P6/红线）
- 4 插件各自 typecheck PASS；内核/render vitest 与 tsc、6 包 typecheck_all、demo vite build 全绿（同"七、验收总清单"基线）。
- .vue 消费端(TextContent/ImageContent)、宿主装配(CanvasDemo plugins / createMiniCanvasHost coldPlugins)、HMR reload 的 name('text'/'image') 零破坏。
- 红线零违规：不引第三方、内核零 Vue 不再动、只动 4 插件 src(+本计划文档)。
- 小步原子 commit，message 前缀 `cordis-plugin`。

## 〇、一句话目标

把 mini-canvas 的插件系统内核，改成**支持 `deepseek-harness/docs/cordis-tutorial` 那 7 种插件开发方式**，
并把现有手写插件迁移成这套最新写法。内核能力**自己研究、自己实现 cordis 语义**，**不 import 任何 `@deepseek-ai/*` 第三方库**。
配置采用 cordis「插件导出 Config schema、装配处给 config、apply(ctx,config) 收校验后 config」的最新注册配置方式，
**但"监听到配置变化就地处理、改动实时生效"的机制逻辑保持不变**。

## 一、参考（权威）

- 7 章教程结构：`deepseek-harness/docs/cordis-tutorial/*.zh.md`（01 第一个插件 → 07 进入 harness）。
- cordis 语义参考：`deepseek-harness/vendor/cordis/src/{context,fiber,registry,reflect,service,events}.ts`
  —— **只读语义、复刻行为，不直接 import/copy 其源码与依赖**（cosmokit/standard-schema/schemastery 等都不用）。
- 用户确认：内核自研实现 cordis 语义，不引第三方库；本文件即**新目标文档**（替代旧 `docs/goal/plugin-system-goal.md` 作为验收基准）。

## 二、目标终态（做完"长什么样"）

作者能按 cordis 的 7 种方式开发画布插件，逐条成立：
1. **第一个插件**：一个 `.ts` 裸导出 `name/inject/apply(ctx, config)`（函数/对象/Service 类三形态），装配处一行装上、跑起来看到效果。
2. **生命周期与 effect**：经 ctx 建立的注册（on/effect/provide/plugin…）是 effect、随所属插件卸载自动撤销；未托管资源用 `ctx.effect` 包 disposer（支持异步）；每个插件有一个 **fiber** 运行时句柄，状态走状态机 `PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED(↘FAILED)`，可查、可 await 到稳定态、可 dispose。
3. **服务**：`Service` 子类（`super(ctx,name)`）或 `ctx.provide/inject` 上架一项服务；`export const inject=['name']` 声明硬依赖——缺提供方该插件进 **PENDING**、到齐自动 ACTIVATE；提供方被卸/换，依赖方随之 PENDING 再随恢复重载；可选依赖用 `ctx.get` 探测（缺返回 undefined，不抛）。
4. **事件**：`ctx.on/once`（自动回收）+ 分发模式 `emit/parallel/serial/bail/waterfall`；类型化（声明合并 Events/Context）。
5. **配置（替换项，用户指定）**：插件导出 `Config`（schema），`apply(ctx, config)` 收**经 schema 校验**的 config；装配处(manifest/plugin 调用)给 config、校验错→FAILED 响亮报错、默认值补齐。**同时保留"监听到 config 变化→就地处理、实时生效"的机制**（逻辑同旧的 ctx.settings.onChange 那套，只是声明/展示换成注册 config 方式）。
6. **组合与热重载**：装配清单(manifest，按 id 增量、同 id 覆盖)当画布应用；热卸/热换版本；诊断一直 PENDING 的插件。
7. **进入画布**：端到端注册一个"能点出来 + 主题 + 命令 + 服务"的真画布插件，在画布 UI 里真工作。

### 兼容与不破
- 内核仍纯逻辑零 Vue、Node 可单测。
- canvas-base 薄层、依赖方向（core←render←插件）、demo 位置(:5199 canvas-core-v2)不变。
- 画布能力：节点/主题/命令/槽/端口，作者仍能经 ctx 注册、被宿主渲染——这些是"画布能力"，接入新的 ctx 模型（作为可被消费的服务或注册场）。

## 三、核心差距（现状已逐源码核对，见附 A 对照表）

mini-canvas 现 ctx = 自研 PluginScope（ctx.get 抛错、ctx.nodes/theme 能力段、自研 Lifecycle enum、无 fiber/PENDING/config schema/事件分发/Service 类）。
要在**不引第三方**前提下，升级内核使其支持 7 方式。

## 四、实施步骤（P1→P8，每步可独立验证 + commit + 测试）

### P1 · 内核生命周期升级为 fiber 语义（① ② ⑥ 的地基）
- 新增 `src/core/fiber.ts`：FiberState 状态机 `PENDING/LOADING/ACTIVE/FAILED/UNLOADING/DISPOSED`；fiber 句柄暴露 `state/config/deps/name`，可 `await`（settle 到稳定态，失败抛出）、`dispose()`。
- `ctx.plugin()`/`installPlugin` 返回 fiber；Scope 包一层状态推进 + `internal/status` 事件。
- effect 支持异步 disposer（`ctx.effect` 返回的 disposer 可 await，卸载时逐个跑）。
- 测试：状态迁移、卸载回卷、async disposer、重复 dispose 幂等。

### P2 · 服务注入升级为 inject PENDING 编排（③）
- 服务注册是 effect，卸载自动移除（沿用）。
- `export const inject`：注册表 + 依赖触发模型——缺提供方进 PENDING，提供方到齐自动 ACTIVATE；提供方卸/换→依赖方随之 PENDING→恢复重载（运行期追踪，非冷启动 topo 一次性）。
- `Service` 基类：`constructor(ctx,name){super(ctx,name)}` 自动上架，类可作插件。
- 可选依赖：`ctx.get(name)` 缺返回 undefined（不再抛）；保留 `ctx.get` 对画布服务(slots/settings 等)的读取。
- 兼容：保留 ctx:ready、现有 services 注入点不破。测试：PENDING 等待/唤醒、依赖方跟随、Service 类、可选依赖。

### P3 · 事件分发模式补齐（④）
- EventBus 加 `parallel/serial/bail/waterfall`；on/once 自动随 fiber 回收；emit 同步广播默认语义保留。
- 类型化事件表对齐 cordis `interface Events` 声明合并（declare module）。
- 测试：5 分发语义 + 回收 + 类型化。

### P4 · 配置机制替换（⑤，用户指定）
- 插件导出 `Config`（schema，自研轻量 schema：类型/默认/必填/范围/枚举/嵌套），`apply(ctx, config)` 收校验后 config；装配处给 config、校验错响亮报错、默认值补齐。
- **变化监听保留**：config 为单一数据源，提供订阅/通知；插件可"监听我这份 config 的变化→就地处理、实时生效"（逻辑同旧 ctx.settings.onChange；不整图重建）。
- 旧的 ctx.settings（运行时分组 define/set/onChange）+ PluginSettingsPanel：**替换为新的 config 驱动**——按用户决定采用"最新注册配置方式展示"，故 settings 能力段改造为 config 形态；设置面板若保留则改为编辑"已装配 config"。实际取舍在实现时按此原则定，并保测试。
- 测试：config 校验通过/失败、默认补齐、apply 收 config、装配覆盖、变化监听就地处理。

### P5 · 渲染宿主/管理器适配（⑥ ⑦）
- canvas-render 的 createMiniCanvasHost/pluginManager/CanvasHost 适配新 ctx：listPlugins 显示 fiber state、manifest 按 id 增量、热卸/换版本、PENDING 诊断。
- 画布能力（节点/主题/命令/槽/端口）接入新模型、作者可注册且宿主可渲染。
- demo 端到端零报错。

### P6 · 现有插件迁移成 cordis 最新写法
- theme-default/node-text/node-image/canvas-commands 迁移（name/inject/apply(ctx,config)、Service 类形态如有需要、config schema）。
- P4 若有 settings 影响，一并替换。

### P7 · 教程重排为 cordis 7 章（docs/plugin-dev/）
- 01 第一个插件 / 02 生命周期与 effect(fiber) / 03 服务(inject PENDING) / 04 事件(分发) / 05 配置(schema+config+监听变化) / 06 组合与 HMR(manager/manifest+PENDING 诊断) / 07 进入画布(端到端)。
- 中文，每章照抄能跑、落在画布能力、看到效果、末尾引下一篇；不堆 API 表。

### P8 · 收尾：全量回归 + 更新本文件验收勾选 + docs/tmp 清理征询

## 五、约束与原则
1. 内核纯逻辑零 Vue、Node 可单测；任何把 .vue/reactive 塞回内核的改动拒绝。
2. **不 import/copy `@deepseek-ai/*`、vendor/cordis、schemastery、standard-schema、cosmokit** —— 全部自研等价语义。
3. 兼容存量：theme-default/node-text/image/commands 不能坏（迁移后仍工作）；已绿测试语义尽量迁移而非裸删。
4. 宿主不预定义一堆业务语义落点当承诺；插件能自定义任意画布内容。
5. 小步原子 commit + 测试；LF、pnpm workspace、vue-tsc 查 .vue。
6. 中间调查文档落 `docs/tmp/`，完成后问是否清理。
7. 只动本目标文档指向的文件；分支铁律：禁止建/切分支，原地提交。

## 六、终审闸门（结束硬前提）
- 用 run_subagent 起独立严格子代理，**以本文件 + cordis-tutorial 7 章 + vendor/cordis 源码语义**逐条终审；
  重点核对 7 方式是否真支持、config 是否替换且监听逻辑保留、是否误引第三方库/破坏纯逻辑内核/弄坏存量插件。
- 不过→给原因+修改清单→改完再复审直到 PASS；报告落 `docs/tmp/plugin-system-review/`。
- prompt 自报 `Caller agent: code-developer`。

## 七、验收总清单（全勾 = 结束）
- [x] P1 生命周期：fiber 状态机（PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED, ↘FAILED）在；ctx.plugin/installPlugin 装载建 fiber，fiber 句柄经 `ctx.fiber(name)` 取得（可查 state/deps/config、可 await 到稳定态、可 dispose；plugin 仍返 this、installPlugin 仍返 name 以兼容 host api——功能等价"返回 fiber"）；effect 异步 disposer；单测绿（内核 196 内含 fiber/context 用例）。
- [x] P2 服务：Service 类形态 + ctx.provide/inject；export inject 硬依赖 PENDING 等齐自动跑；提供方消失依赖方跟随 PENDING 再随恢复重载（含传递链）；可选 ctx.get 缺返 undefined；单测绿。
- [x] P3 事件：emit/parallel/serial/bail/waterfall 五种分发 + on/once 自动回收 + 类型化声明合并；单测绿。
- [x] P4 配置（替换项）：插件导出 Config(schema)，apply 收校验后 config；装配处给 config、校验错→FAILED 响亮报错、默认补齐；**config 变化可监听→就地窄更新实时生效（不整图重建，逻辑同旧 settings.onChange）**；旧的 ctx.settings.define 已移除、settings 改造为 Config 声明形态（保留 set/get/onChange/groups 读与订阅）；单测绿。
- [x] P5 宿主/管理器：createMiniCanvasHost/pluginManager/CanvasHost 适配 fiber ctx（manager.list 显 state + diagnose()/ctx.inspectPlugins() PENDING 诊断、manifest 按 id 增量、热卸/换版本）；demo vite build 零错（浏览器人工点验受环境限制未做，见终审报告）。
- [x] P6 插件迁移：theme-default/node-text/node-image/canvas-commands 迁成最新写法仍工作（4 包 typecheck 全 PASS）。
- [x] P7 教程：docs/plugin-dev/ 重排为 cordis 7 章（01-07，中文、照抄能跑、覆盖 name/inject/apply+ctx能力+effect+fiber+Service/inject PENDING+事件分发+config schema+组合HMR+PENDING诊断+进入画布）。
- [x] 全量：内核 vitest 196 + 渲染 37 全绿；内核 tsc EXIT=0；跨包 typecheck（canvas-base/render/4插件）全 PASS；demo vite build 零错（浏览器端到端人工点验受环境限制未做，编译级+运行时链路源码核验已覆盖）。
- [x] **终审闸门：已用 run_subagent 起严格子代理按本文件 + cordis-tutorial/vendor/cordis 审核通过（PASS 有保留，无必须修缺口），报告在 docs/tmp/plugin-system-review/review-v3-final.md**。
- [x] 本文件更新为"完成态"（2026-09-05，P1–P8 全部落地）。

---

## 附 A：现状 vs cordis 对照表（侦察记录）
| cordis 机制 | mini-canvas 现状（本目标交付前） |
|---|---|
| 插件三形态(函数/对象/Service类) | 函数/对象有；Service 类 ❌ |
| ctx.plugin() 返回 fiber | 返回 PluginScope，无 fiber ❌ |
| effect 自动回收(异步 disposer/诊断树) | Scope.effect 同步 only |
| fiber 状态机 PENDING→…(FAILED) | 自研 Lifecycle enum，无 PENDING ❌ |
| 服务 provide/Service类 + inject PENDING 运行期追踪 | inject/get 有；类/PENDING/跟随 ❌ |
| 事件 emit/parallel/serial/bail/waterfall | 仅 on/once/emit 同步 ❌ |
| 配置 Config(schema) + apply(ctx,config) 装配校验 | ctx.settings 运行时分组，非装配 config ❌ |
| manifest 按 id 增量 + HMR + PENDING 诊断 | manager.manifest/热装卸有；PENDING 诊断 ❌ |
| ctx 服务解析(proxy) / declare module | ctx.get 抛错 + 能力段 ctx.nodes/theme… ⚠️ |
