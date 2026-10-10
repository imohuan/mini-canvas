# 上下文 ctx

`ctx` 是插件的唯一入口对象。前端与后端插件拿到的都是它，只是"能力段"不同。

## 生命周期与装载

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `plugin` | `plugin(mod: PluginModule \| PluginClassLike, config?: unknown): this` | 登记一个插件（登记期不 apply，`start()` 时才跑） |
| `start` | `start(): Promise<void>` | 激活全部插件；跑完发 `ctx:ready` |
| `stop` | `stop(): void` | 回收全部插件作用域（定时器 / 注册场条目 / 订阅一起清） |
| `installPlugin` | `installPlugin(mod, config?): string` | 运行期热装（返回插件名） |
| `uninstallPlugin` | `uninstallPlugin(name: string): boolean` | 热卸 |
| `canUninstall` | `canUninstall(name: string): CanUninstallResult` | 能不能卸（核心插件不可卸） |
| `listPlugins` | `listPlugins(): string[]` | 已登记插件名 |
| `inspectPlugins` | `inspectPlugins(): PluginRuntimeStatus[]` | 每个插件的运行态（state / missingDeps） |
| `getState` | `getState(): ContextState` | 根上下文状态（created / active / stopped…） |

## 服务

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `inject` | `inject<Service>(name: string, impl: Service): () => void` | 上架一个服务；返回撤销函数 |
| `provide` | `provide<Service>(name: string, impl: Service): () => void` | 同上（别名） |
| `get` | `get<Service = unknown>(name: string): Service` | 按名取服务；**缺了返回 `undefined`，不抛** |
| `tryGet` | `tryGet<Service>(name: string): Service \| undefined` | 显式可选取法，等价语义 |
| `hasService` | `hasService(name: string): boolean` | 这个服务在不在 |
| `injectedServices` | `injectedServices(): string[]` | 已上架的全部服务名 |

硬依赖要写在模块顶层：`export const inject = ['doc']`（缺提供方时插件停在 PENDING，而不是运行时拿到 `undefined`）。

## 注册场

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `registryOf` | `registryOf<T>(kind: string): Registry<T>` | 取某个"种类"的注册场（`Context` 上按 kind 各一份） |

注册场的完整方法见 [注册场](/api/registry)。画布那套 `ctx.nodes` / `ctx.theme` / `ctx.commands` /
`ctx.slots` / `ctx.settings` 都是它的语法糖，落点是对应的场。

## 事件

事件分发有五种模式，`ctx.on` 返回的 `Disposable` 自动挂在本插件作用域上（卸载即解除）。

| 方法 | 签名 | 分发方式 |
| --- | --- | --- |
| `on` | `on(name, handler): Disposable` | 订阅 |
| `once` | `once(name, handler): Disposable` | 订阅一次 |
| `emit` | `emit(name, ...args): void` | 同步广播，不等返回值 |
| `parallel` | `parallel(name, ...args): Promise<void>` | 全部并发并一起等 |
| `serial` | `serial(name, ...args): Promise<any>` | 顺序 await，第一个非 null/false/undefined 胜出 |
| `bail` | `bail(name, ...args): any` | `serial` 的同步版 |
| `waterfall` | `waterfall(name, ...args): any` | 环绕中间件（最后参数是 `next`） |

内置事件（`EventMap`）：`ctx:ready`、`ctx:plugin-installed`、`ctx:plugin-uninstalled`、`ctx:lifecycle-change`。
自定义事件用 `declare module '@mini-canvas/kernel' { interface Events { ... } }` 扩展，**单 payload** 形态
（`emit(name, obj)`）。未登记的事件名在 dev 下 `emit` 会给一次 warn。

## 作用域与状态

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `effect` | `effect(fn: EffectFn): Disposable` | 登记副作用；`fn` 返回的清理函数随插件卸载自动跑 |
| `state` | `state<T>(initial: T): State<T>` | 建一份响应式状态（供宿主读） |
| `fiber` | `fiber(name: string): Fiber \| undefined` | 取某插件的 fiber（诊断用） |

`ctx.effect` 是"插件碰外部世界"的统一姿势：监听、定时器、订阅都包在它里面，卸载时统一拆。

## 自省

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `surface` | `surface(): SurfaceReport` | 只读快照：服务 / 注册场 / 条目 / 命令 / 工具 / 事件 —— 见 [自省](/core/self-inspect) |

