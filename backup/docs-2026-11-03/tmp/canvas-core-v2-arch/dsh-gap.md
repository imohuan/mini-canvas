# canvas-core-v2 插件系统 vs DSH(Cordis) —— 差距对照

日期：2026-09-05
对照源：deepseek-harness/docs/cordis-tutorial 01–07 + cordis-api (context/registry/fiber/service/events)

结论：canvas-core-v2 已实现 Cordis 的**核心运行模型**（插件三种形态/service+inject 依赖编排/
PENDING 编排/事件分发/作用域自动回收/Config schema 校验/HMR 热装热卸热重载/诊断查询）。
差距集中在 **①加载器/组合层（cordis.yml ↔ manifest）②配置 schema 表达力 ③若干运行期能力**。

---

## 一、已对齐（读 01-07 后逐一确认，含测试）

| DSH 教程要点 | canvas-core-v2 | 备注 |
|---|---|---|
| ch1 插件=模块导出 name/apply，loader 挂载 | ✅ apply/name + cold 装配 | 见下"加载器"差距 |
| ch1 三种形态：函数/对象/类 | ✅ 对象 + 类(Service)；裸函数**未真支持**(见 §二-1) | |
| ch1 apply 抛错→响亮失败、不静默跳过 | ✅ fiber FAILED + 抛 | |
| ch2 effect 自动回收、无需手 uninstall | ✅ 副作用归 fiber，卸载 runDisposers | 已按原版收敛 |
| ch2 fiber.dispose 等全部清理(含 async) | ⚠️ async disposer 不等(见 §二-2) | 实测缺口 |
| ch3 Service super(ctx,name)=provide、declare module 增强 ctx.greeter | ✅ | |
| ch3 inject 硬依赖、PENDING 等待、顺序无关 | ✅ | |
| ch3 加载后仍跟踪依赖：提供方消失→依赖方卸载回退→恢复后重载 | ✅ P6 传递链 | |
| ch3 可选依赖 ctx.get 返回 undefined 不抛 | ✅ | |
| ch3 服务名共享扁平命名空间、加前缀 | ⚠️ 有前缀提醒但没有"生成注册表参考" | 见 §二-4 |
| ch4 事件 emit/parallel/serial/bail/waterfall + typed | ✅ 全 5 分发 + 声明合并 | |
| ch5 Config schema 校验+默认补齐、错则 FAILED | ✅ | 见 §二-3 表达力差距 |
| ch6 HMR 先卸再装、effect 回卷 | ✅ uninstallPlugin/installPlugin/manager.reload | |
| ch6 PENDING 诊断(哪缺谁/FAILED 报错) | ✅ inspectPlugins + manager.diagnose | |
| ch7 进 harness：服务是 tools/llm/agents，ctx.tools.register/execute | ✅ 同构：command 服务 + 注册/execute | 见 §二-4 |

## 二、差距（按重要度）

### 1. 裸函数插件未被正确支持（低，潜伏）
DSH ch1/ch2：`ctx.plugin(heartbeat)` 传**裸函数**，Cordis 直接以 `apply(ctx)` 调用它；
函数插件不需要 apply。canvas-core-v2 的 `asPluginModule` 把任何可 new 的函数一律当**类** `new fn(ctx,config)`
——裸函数会被构造而非以 ctx 调用。实测 fn 体虽执行（构造副作用），但它拿不到 ctx 当普通函数用，
语义与 DSH 不符。canvas-core-v2 实际插件都走 name+apply，故暂未踩坑，但属支持面缺口。
（pluginClass.ts 注释"mini-canvas 无函数插件，故一律按类 new"——是有意取舍，非 bug。）

### 2. async 副作用/async apply 卸载不等待（中，实测缺口）
DSH/Cordis：`fiber.dispose()` 会**等全部 disposer（含 async）完成才 settle**；异步 disposer 会并发跑完。
canvas-core-v2 我新加的 `runDisposers()` 是同步的，async disposer fire-and-forget——实测 `stop()`/`uninstallPlugin()`
后 async 清理回调没跑完（order 少了 'clean'）。当前真实插件副作用全同步所以不炸，但：
- 一旦有插件在 effect 里 `async`（如 await 定时器/IO 后清理），stop 不会等它。
- async `apply` 的后续注册也会被漏（卸载发生在其 resolve 前）。
属对 Cordis "fiber.dispose settle" 语义的真实偏差。修复方向：给 fiber 记 in-flight async disposer，卸载时 await。

### 3. Config schema 表达力弱于 Schemastery/Standard Schema（中）
DSH ch5 用 Schemastery：可嵌套对象、**数组**、字符串/数字细分类（min/max/length/regex）、联合等，
并接受任意 Standard Schema。canvas-core-v2 的 configSchema 只支持扁平 5 型：
string/color/number/boolean/select，无数组/嵌套/复杂约束。真实插件(theme/node)当前够用，
但做"多目标列表/嵌套选项"这类配置会受限。

### 4. 缺"加载器/Loader 插件 + cordis.yml 组合层"（大，但可能超出画布内核职责）
DSH 的加载链是：根 Context 挂 **Loader 插件** → 读 `cordis.yml` → 把每个配置项(含相对路径/NPM 包、
id/config/disabled/组/isolate)作为**子插件**挂载。yaml 的 id 用于 diff/HMR。
canvas-core-v2 已有等价物：`pluginManager.applyManifest`(id+source+config+同 id 覆盖) 与 reload/热装。
但 canvas-core-v2 **没有 Loader 运行时/plugin 自身**：装配是由宿主代码 `createPluginManager` 手动喂，
不是"一个插件读 manifest"。这更接近"把 manifest 当数据喂 API"而非 DSH 的"loader 即插件"。对画布宿主
（JS 组合而非 YAML 文件）未必需要 YAML，但 `disabled`/组/`isolate`(服务隔离)/相对路径加载这些 Loader 能力没有对应物。

### 5. ctx.registry 枚举 / 服务隔离 / 组（小~中）
DSH：`ctx.registry`(可枚举每插件 fiber)、上下文可 `isolate(name)` 给服务独立作用域、配置项可组嵌套。
canvas-core-v2 有 `inspectPlugins()`(相当于 registry 只读) + `ctx.fiber()`，够诊断；但无 `ctx.registry` 对象、
无服务隔离(一个 ctx 全局一套服务表)、无嵌套组。对单画布宿主当前够用。

### 6. ctx.inject(deps, cb) 简写 / ctx.plugin 返回 Fiber（小）
DSH registry API：`ctx.inject(['x'], cb)` 简写、`ctx.plugin()` 返回 Fiber&PromiseLike。
canvas-core-v2 无 inject 简写；ctx.plugin() 返回 this/self（前面有意延后改 fiber）。

---

## 三、建议（按画布项目实际取舍）

- **高价值**：#2 async 卸载 settle——补 fiber in-flight await，让 Fiber 语义真对齐原版 02/06(卸载等异步清完)。
- **中价值**：#3 Config 支持数组/嵌套——若要更复杂可配项再做；否则维持。
- **看定位**：#4 是"要不要把装配做成一个 Loader 插件读清单 + 支持 disabled/组/isolate"。若画布只要 JS 组合，
  现有 applyManifest 足够；若要 YAML/跨端清单再引入 Loader 层。
- **低/暂缓**：#1 裸函数、#5 registry 对象+isolate、#6 inject 简写/plugin 返回 Fiber。
- 每次对齐改动都补测试，canvas-core-v2 196 + canvas-render 37 作护栏。
