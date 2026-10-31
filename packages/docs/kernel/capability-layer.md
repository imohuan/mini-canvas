# 能力层接缝：`capabilityLayer`

**一句话定位**：**能力层是内核留出的一道「外包接口」—— 内核只负责把插件框架跑起来，`ctx` 上那些它自己不认识的能力段（`ctx.nodes` / `ctx.theme` / `ctx.settings`…）由能力层从外面接进来。**

**它属于哪一档**：**内核自带（框架层）**。源码：`packages/kernel/src/capabilityLayer.ts`（`CapabilityLayer` 接口 + `setDefaultCapabilityLayerFactory` / `getDefaultCapabilityLayerFactory`）；画布侧的实现是 `packages/canvas-data/src/canvas/capabilityLayer.ts`。

## 它是什么

把内核想成**一台没有插孔的插座盒**：

- 内核出厂时只保证「能通电」：装载、依赖、事件、回收、注册场 —— 这些是**通用**的，跟画布没关系。
- 但插件作者确实想要 `ctx.nodes.register(...)` / `ctx.theme.register(...)` 这种画布专用写法。
- 于是内核在侧面留了一道**接缝**：一个叫 `CapabilityLayer` 的接口。谁想给 `ctx` 加东西，就实现这个接口，然后注册成「默认能力层」。
  之后每一台新 `Context` 都会自动接上它 —— 画布层就是干这个的。

它管的是「**能力段的来源**」：不是数据、不是展示，而是「`ctx` 上该长哪些段、这些段由谁建、卸载时怎么收」。

```
                     ┌────────────────────────────┐
   @mini-canvas/kernel │  Context（装载/事件/回收/注册场） │
                     └──────────────┬─────────────┘
                                    │ 需要能力段（ctx.nodes / theme / …）
                                    ▼
                     ┌────────────────────────────┐
   @mini-canvas/canvas-data │  createCanvasCapabilityLayer()      │
                     └────────────────────────────┘
```

## 为什么需要它

这是**「kernel 零画布概念」**之所以能成立的关键。

如果没有这道接缝，内核只能二选一：

1. **内核里硬写画布**：`Context` 里直接 `import` 节点注册表、主题注册表 —— 那内核就不再是「纯插件框架」，
   换个场景（比如云端后台、另一个产品）就没法复用，而且依赖方向会反转（kernel → canvas-data）。
2. **内核不给能力段**：每个插件的 `apply` 都得自己 `ctx.nodes.register(...)`，
   作者要记一堆服务名与底层调用姿势，还要手写回收 —— 这正是被否掉的旧写法。

接缝让两边各就各位：

| 谁 | 知道什么 | 不知道什么 |
| --- | --- | --- |
| **kernel** | 「有个 `CapabilityLayer` 接口会给我段、内置服务、配置登记」 | 不知道段叫什么、是什么意思 |
| **canvas-data** | 段是 `nodes` / `theme` / `commands` / `slots` / `settings`，各是什么含义 | 不需要改内核一行 |

所以 `packages/kernel/src/**` 里 **搜不到 `nodes` / `theme` / 画布这些字眼**（除了注释与类型缝），
这条边界有测试锁着（`packages/kernel/src/__tests__/kernelBoundary.test.ts`）。

## 怎么用

### 一、`CapabilityLayer` 接口（四个方法）

签名逐字来自 `packages/kernel/src/capabilityLayer.ts`：

```ts
export interface CapabilityLayer {
  /** 为某个 ctx 视图产出能力段（会被 Object.assign 到该视图上） */
  buildSegments(ctx: PluginScope, scopeName: string): Record<string, unknown>
  /** 内置服务实例（名 → 实例） */
  builtins(): Record<string, unknown>
  /** 生命周期重置（ctx.stop 时调用） */
  reset(): void
  /** 把插件 Config schema 的标量字段登记进「配置单一数据源」 */
  declareConfig(
    schema: ConfigSchema,
    config: Record<string, unknown>,
    pluginName: string,
    dev: boolean,
  ): () => void
}
```

| 方法 | 什么时候被内核调 | 干什么 | 返回什么 |
| --- | --- | --- | --- |
| `buildSegments(ctx, scopeName)` | 造根 `Context` 时（`scopeName = '<host>'`）、以及**每个插件**拿到 `PluginScope` 时（`scopeName = 插件名`） | 产出这一份视图上的能力段 | 段对象（如 `{ nodes, theme, commands, slots, settings }`） |
| `builtins()` | `ctx.get(name)` 每次查内置服务时 | 给出「恒可取、不进服务表、依赖判定恒满足」的内置服务 | 名 → 实例 |
| `reset()` | `ctx.stop()` 时 | 重置内置服务（哪些重建、哪些跨 stop 保留由实现决定） | —— |
| `declareConfig(...)` | 插件激活、config 校验通过后 | 把标量字段登记进设置面板数据源 | **清理函数**（内核登记进该插件 fiber） |

**三段语义补注**：

- `buildSegments` 每次调用都**先造再挂**：同一个插件视图上每个段只建一次（`Object.assign` 到那个视图对象上）。
- `builtins()` 的语义是「`ctx.get` 恒可取到、依赖判定恒满足、**不进服务表**」—— 所以它不会跟插件 `provide` 的重名检查冲突。
- `declareConfig` 返回的清理函数非常关键：它让「热卸插件 → 它的配置项从设置面板消失 → 重装不撞 key」自动成立。

### 二、装上 / 取用：两个模块级函数

```ts
export type CapabilityLayerFactory = () => CapabilityLayer

export function setDefaultCapabilityLayerFactory(factory: CapabilityLayerFactory | undefined): void
export function getDefaultCapabilityLayerFactory(): CapabilityLayerFactory | undefined
```

`Context` 的构造逻辑（`packages/kernel/src/Context.ts`）：

```ts
constructor(options: { dev?: boolean; capabilityLayer?: CapabilityLayer } = {}) {
  // 来源优先级：构造时显式传入 > 组合根装的全局默认
  this.capabilityLayer = options.capabilityLayer ?? getDefaultCapabilityLayerFactory()?.()
  // …
}
```

所以有**三条**接上能力层的路：

| 方式 | 怎么写 | 典型场景 |
| --- | --- | --- |
| 显式传实例 | `new Context({ capabilityLayer: myLayer })` | 单测、特殊宿主 |
| 装全局默认，让工厂每次新建一份 | `setDefaultCapabilityLayerFactory(() => createMyLayer())` | 组合根（包入口 / 服务端框架） |
| 什么都不装 | `new Context()` | **纯插件内核**：只有 `ctx.tools` + 六个原语 |

**为什么是「工厂」而不是「单例」**（源码注释原话）：

> 能力层持有 slots / settings / tools 这些「每画布一份」的实例，若全局共用一个实例，两个画布会串数据。
> 工厂保证 `new Context()` 各拿各的。

真实装配点：

- 画布侧：`packages/canvas-data/src/canvas/context.ts` 里 `new Context()` **默认装画布层**（`capabilityLayer: options.capabilityLayer ?? createCanvasCapabilityLayer()`）；
- 服务端侧：`packages/cloud-server/src/serverFramework/index.ts` 调 `setDefaultCapabilityLayerFactory(() => createServerCapabilityLayer({ app }))`
  —— 云端那套 `ctx` 因此有自己的段（路由 / MCP 工具），跟画布完全不是一回事。

### 三、画布层实现长什么样（`createCanvasCapabilityLayer`）

`packages/canvas-data/src/canvas/capabilityLayer.ts` 的实现要点：

```ts
export function createCanvasCapabilityLayer(): CapabilityLayer {
  const slots = new SlotRegistry()          // 每 Context 一份
  let settings = new SettingsStore()
  const builtins: Record<string, unknown> = { slots, settings }

  return {
    buildSegments(ctx, scopeName) {
      const segs = buildCapabilities(ctx, scopeName)   // ← 真正的段实现在 capabilities.ts
      delete segs.tools                                // ← 剥掉 tools：它已由框架自带，避免两处各建一份
      return segs
    },
    builtins() { return builtins },                    // 画布层只给 slots / settings
    reset() {                                          // stop 时：settings 重建、slots 保留
      settings = new SettingsStore()
      builtins.settings = settings
    },
    declareConfig(schema, config, pluginName, dev) { /* 见 config 篇 */ },
  }
}
```

几条值得记的事实：

- `builtins()` **只有 `slots` 与 `settings`**。`tools` 由框架自带（`Context.builtinTools`，恒在）；
  `doc` / `save` / `selection` 是 **canvas-base 插件注入的真服务**（不是内置服务）。
- `buildSegments` 剥掉了 `tools`：段与内置服务只能有一个来源，否则两处各建一份、互相不好收。
- `reset()` 的取舍：**settings 随 stop 重建**（重启可重新声明），**slots 跨 stop 保留**（它是宿主的容器）。
- 段实现在 `packages/canvas-data/src/canvas/capabilities.ts`（`buildCapabilities`）：`ctx.nodes` / `theme` / `commands` / `slots` / `settings` / `selectionRegion`。

### 四、能力段的类型从哪来：`PluginCapabilities` 声明合并

内核的 `types.ts` 里有一个空的能力段接口：

```ts
export interface PluginCapabilities {
  tools: { /* … */ }        // ← 内核自带那一段（恒在）
}
export interface Context extends PluginCapabilities {}
```

画布层在 `packages/canvas-data/src/canvas/capabilityTypes.ts` 里 declare 合并，把画布段补进去：

```ts
declare module '@mini-canvas/kernel' {
  interface PluginCapabilities {
    nodes: { register(def: NodeRegisterDef): void; attach(…): Disposable; /* … */ }
    theme: { register(…): void; add(…): void; remove(…): void }
    commands: { register(def: CommandDef): Disposable; has(id: string): boolean }
    slots: { register(…): string; remove(…): boolean; occupants(…) }
    settings: { set(…): boolean; get(…); onChange(scope, cb); groups(): string[] }
    // …
  }
}
```

**为什么用「继承空接口」而不是在类里重声明**：类的类型只含它自己声明的成员，`implements PluginScope` 不会把属性带进来。
让 `interface Context extends PluginCapabilities`，能力层经声明合并补进来的段就自动出现在 `ctx` 的类型上 ——
于是**框架包不必写下任何画布字眼**，而作者写 `ctx.nodes.register(...)` 仍有完整提示。

> 这也是为什么加载顺序有意义：`capabilityTypes.ts` 必须被 import 进来（`canvas-data` 包入口 import 了它），
> 声明合并才会生效。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/kernel/src/capabilityLayer.ts` | `CapabilityLayer` 接口 + 工厂注册/读取两个函数 |
| `packages/kernel/src/Context.ts` | 构造时选层（`options.capabilityLayer ?? 默认工厂()?.()`）；挂段、调 `declareConfig`、`stop` 时 `reset()` |
| `packages/kernel/src/types.ts` | `PluginCapabilities`（能力段接口，内核只声明 `tools`）+ `Context extends PluginCapabilities` |
| `packages/canvas-data/src/canvas/capabilityLayer.ts` | 画布层：`slots` / `settings` 内置服务 + `declareConfig` 标量登记 + `reset` 策略 |
| `packages/canvas-data/src/canvas/capabilities.ts` | `buildCapabilities`：`nodes` / `theme` / `commands` / `slots` / `settings` 段的实现 |
| `packages/canvas-data/src/canvas/capabilityTypes.ts` | 声明合并把画布段补进 `PluginCapabilities` |
| `packages/canvas-data/src/canvas/context.ts` | 画布版 `Context`：`new Context()` 默认装画布层 |
| `packages/cloud-server/src/serverFramework/index.ts` | **另一端**：服务端装自己的能力层（`createServerCapabilityLayer`），证明这道接缝可复用 |
| `packages/kernel/src/__tests__/kernelBoundary.test.ts` | 锁住「不装能力层时，ctx 上没有画布段」 |

## 完整例子

一个能在 Node 里直接跑的例子：**自己写一个迷你能力层**，给 `ctx` 加上一个 `ctx.notes` 段 + 一个内置服务 `clock`，
然后验证「装了层有段、不装层没有」。

### 目录长这样

```
plugin-capability-demo/
├── package.json          # 清单
└── src/
    ├── miniLayer.ts      # 一个迷你能力层：notes 段 + clock 内置服务
    └── main.ts           # 装配脚本：装层 / 不装层，两种结果对照
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/plugin-capability-demo/`。

### 文件一：迷你能力层

```ts
// 文件：packages\docs\public\examples\kernel\plugin-capability-demo/src/miniLayer.ts
// 格式：TypeScript 模块（自定义能力层实现）
// 位置：演示「内核不认识段，段由能力层产出」
import type { CapabilityLayer, PluginScope } from '@mini-canvas/kernel'

/** 段 / 内置服务的运行时状态（每 Context 一份 —— 所以要用工厂产出） */
export function createMiniCapabilityLayer(): CapabilityLayer {
  /** ① 内核会通过 builtins() 看到它：ctx.get('clock') 恒可取到 */
  const clock = { now: () => Date.now() }

  /** ② 每个插件各自记一份「它的笔记」（演示段随视图产出、逐插件隔离） */
  const notes = new Map<string, string[]>()

  return {
    buildSegments(_ctx: PluginScope, scopeName: string): Record<string, unknown> {
      // ③ 产出一个 notes 段：会被 Object.assign 到该视图上 → ctx.notes 可用
      return {
        notes: {
          add(text: string): void {
            const list = notes.get(scopeName) ?? []
            list.push(text)
            notes.set(scopeName, list)
          },
          list(): string[] {
            return [...(notes.get(scopeName) ?? [])]
          },
        },
      }
    },

    builtins(): Record<string, unknown> {
      return { clock }                  // ④ 恒可取、依赖判定恒满足、不进服务表
    },

    reset(): void {
      notes.clear()                     // ⑤ ctx.stop() 时由内核调用
    },

    // ⑥ 本演示不做配置登记：返回一个空清理函数即可（真层在这里把标量字段登记进设置面板）
    declareConfig() {
      return () => {}
    },
  }
}
```

### 文件二：装配脚本（两种对照）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-capability-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：演示「装层 / 不装层」两种结果
import { Context } from '@mini-canvas/kernel'
import { createMiniCapabilityLayer } from './miniLayer'

// ① 装层：显式传实例
const withLayer = new Context({ capabilityLayer: createMiniCapabilityLayer() })
withLayer.plugin({
  name: 'writer',
  apply(ctx) {
    // ctx.notes 是层产出的段；ctx.get('clock') 是层提供的内置服务
    ;(ctx as unknown as { notes: { add(t: string): void; list(): string[] } }).notes.add('第一条笔记')
    console.log('[writer] 笔记：', (ctx as any).notes.list())
  },
})
withLayer.plugin({
  name: 'reader',
  apply(ctx) {
    console.log('[reader] clock 能取到吗：', !!ctx.get('clock'))
    console.log('[reader] 我的笔记（逐插件隔离）：', (ctx as any).notes.list())   // [] —— 别人写的看不到
  },
})
await withLayer.start()
withLayer.stop()                        // 触发层的 reset()

// ② 不装层：纯插件内核，段不存在、内置服务也不存在
const bare = new Context()
bare.plugin({
  name: 'probe',
  apply(ctx) {
    console.log('[probe] 没有层时 clock：', ctx.get('clock'))            // undefined
    console.log('[probe] 没有层时 notes：', (ctx as any).notes)          // undefined
  },
})
await bare.start()
bare.stop()

// ③ 也可以装成全局默认：之后每次 new Context() 各拿一份新层
// setDefaultCapabilityLayerFactory(() => createMiniCapabilityLayer())
```

## 常见坑

1. **能力层是「每 Context 一份」，所以必须写成工厂**。直接把一个层实例传给所有 `Context`（或者 `setDefaultCapabilityLayerFactory` 返回同一个实例），
   多个画布会串数据 —— 源码注释里点名了 `slots` / `settings` / `tools` 这类。
2. **`builtins()` 里的名字不进服务表**：它们不能被 `ctx.surface().services` 从服务表读出来（会以 `source: '<builtin>'` 单列），
   也**不参与重名检查**。所以别把「应该被插件替换实现的东西」放内置 —— 那种要用真服务。
3. **`declareConfig` 的返回值必须登记进插件 fiber**（内核已经替你做了：`fiber.onDispose(disposeDeclared)`）。
   自己实现层时若返回的不是清理函数，热卸插件就会在设置面板留下幽灵配置项。
4. **段与内置服务只能有一个来源**。画布层在 `buildSegments` 里 `delete segs.tools`，就是因为 `ctx.tools` 已由框架自带 ——
   两处各建一份会导致「谁是谁」说不清。
5. **声明合并要显式 import 才生效**。`capabilityTypes.ts` 没被加载时，`ctx.nodes` 在**类型上**也不存在（运行时仍可拿到 —— `buildSegments` 挂的是真实属性）。
6. **`reset()` 决定「stop 之后还剩什么」**。画布层的策略是 settings 重建、slots 保留；自己写层时要想清楚这一条，
   否则重启动后要么丢数据、要么留脏数据。
7. **纯内核 `Context` 上拿不到画布段是设计如此**，不是 bug（有测试锁着）。要画布能力请用 `@mini-canvas/canvas-data` 导出的 `Context`。

