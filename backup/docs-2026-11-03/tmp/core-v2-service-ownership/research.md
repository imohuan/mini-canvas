# canvas-core-v2 服务归属 调研 —— services 该不该放插件层 / core-v2 是不是该做成"基础插件"

日期：2026-09-13 · 分支：当前所在分支（**只读调研，未改任何生产代码**）
范围：`packages/canvas-core-v2`、`packages/canvas-render`、`packages/plugins/*`（24 个插件包）
问的人：项目作者

---

## 〇、一句话结论

你的直觉**方向对、落点要换**：

> 问题不在"services 放进了插件层"（它其实**不在**插件层），而在 **services 既不归框架内核、也不归任何插件 —— 它是渲染宿主 `createMiniCanvasHost` 手写 new 出来的 14 个对象**。
> 正确做法不是"把 services 塞给某个插件"，而是**反过来**：让"画布基础能力"成为一个**官方基础插件**（它自己 apply 里建服务并 provide），框架内核退回"纯插件内核"。
> 这条正是你最初那句"核心作为插件提供它的上下文" —— **今天只兑现了 3/17 个服务**（slots/settings/tools 是 `Context` 内置），其余全在宿主代码里硬塞。

---

## 一、现状：真实的分层（带证据）

代码里实际有四层，但**只有三层被显式命名**，第四层（画布能力层）今天是散在两个包里的。

| 层 | 物理位置 | 认识什么概念 | 证据 |
|---|---|---|---|
| **A 纯插件框架** | `canvas-core-v2/src/core/`（Context/Scope/Fiber/EventBus/topo/service/pluginClass/configSchema/settingsStore/registry 容器） | 插件名、依赖名、服务名、事件名、开槽 | `core/Context.ts` 只做装载/DI/事件/作用域回收 |
| **B 画布能力层** | `canvas-core-v2/src/services/` + `core/registry/*` + `core/capabilities.ts` | node / edge / selection / command / tool / theme / 菜单 | `services/nodeStore.ts`、`core/capabilities.ts`（把服务收口成 `ctx.nodes/theme/commands/slots/settings/tools`） |
| **C 渲染宿主** | `canvas-render/src/host/`（CanvasHost.vue / createMiniCanvasHost / vueFlowBridge / contracts 令牌） | VueFlow 实例、DOM、注入令牌 | `createMiniCanvasHost.ts` = `new Context()` + 14 次 `ctx.inject` |
| **D 插件** | `packages/plugins/*`（24 包） | 只调 `ctx.get` / `ctx.x` 与 render 令牌 | `plugin-clipboard`、`plugin-group` … |

A 与 B **今天在一个包里，且互相咬合**：

---

# 第二轮澄清（2026-09-13 作者追问）

> 作者澄清：**"插件核心层不管其他，其他全是插件；关于 render 渲染层的 services，感觉和插件没有关系。"**
> 问：这些 services 是不是该放进渲染层（canvas-render）？

## 先承认：第一轮答偏了

第一轮我回答的是"这 14 个服务**由谁 new 出来**"（宿主手写装配），
而作者问的是"这些服务**归哪一层**"。两回事。本轮重答。

## 1. "services 与插件核心无关" —— 这句完全正确

`src/core/`（Context/Scope/Fiber/EventBus/topo/pluginClass/configSchema/SlotRegistry 容器）
是插件框架：管装载、依赖、事件、作用域回收、开槽。
里面**不该出现** node/edge/command/tool/theme 这些画布词 —— 今天有，是历史遗留（4 处反向 import，见第一轮 §一）。

## 2. "services 该归渲染层" —— 这句不准确，会带来损失

关键事实：**canvas-render 里今天只有 2 个服务，其余 14 个不该跟过去。**

| 现在的服务 | 依赖 | 该归哪层 |
|---|---|---|
| `nodeLayout`（NodeLayoutService） | ResizeObserver 实测 DOM | ✅ **渲染层专有**（已在 render） |
| `viewport`（ViewportService） | VueFlow 后端 | ✅ **渲染层专有**（已在 render） |
| `nodeStore`/`edgeStore`/`graph`/`selection`/`history`/`command`/`save`/`nodeFactory`/`menu`/`resources`/`nodeRegistry`/`themeRegistry` | **零 Vue、零 DOM**，363 条测试跑在 `environment: 'node'` | ❌ 不是渲染，是**画布数据与行为** |

若把这 14 个搬进 `canvas-render`，等于宣布"画布数据模型 = 渲染库的一部分"。后果是具体的：

- **headless 用不了**：无界面跑画布（MCP 操控、批量处理、服务端同步）必须引来整个渲染库 + VueFlow + Vue。
  证据：`packages/mcp-server` 今天**不 import 任何 @mini-canvas 包**，自己维护了一份 `ln` 节点模型（`src/graph/GraphModel.ts`）——
  说明"无渲染消费画布数据"是真实存在的场景。
- **拆不开**：以后想把 `nodeStore` 换成协同版本（CRDT/多人），得连渲染层一起动。

## 3. 真正的分层（四块，而不是两块）

1. **插件核心** `canvas-core-v2/src/core/` → 插件装载/依赖/事件/作用域/开槽。**不认识画布**（作者的诉求）。
2. **画布基础** `canvas-core-v2/src/services/` + `core/registry` + `capabilities.ts` → 画布数据与行为。**不认识 Vue**。
3. **渲染层** `canvas-render/` → VueFlow/DOM/注入令牌 + **只属于它的 2 个服务**（nodeLayout/viewport）。
4. **业务插件** `plugins/*` → 消费 1/2/3。

作者说的"插件核心层不管其他"= 第 1 块；"其他的全归插件/渲染"= 第 4 块；
但第 2 块既不是插件核心、也不是渲染 —— 它是**画布能力**，今天是"住在插件核心里的一段画布代码"。

## 4. 三个选项

| 选项 | 做法 | 结果 | 评价 |
|---|---|---|---|
| 1 | 14 个服务全搬进 `canvas-render` | "services 与插件核心无关"兑现 | ❌ 画布数据绑死渲染库；headless/多后端要引 VueFlow |
| 2 | 留在 `canvas-core-v2`，只把 `core/` 洗净（剪反向 import） | 插件核心变纯；服务仍与插件框架同包 | ⚠️ 可接受，但不干净：一个包装了两件事 |
| **3（建议）** | 画布基础独立成包：`kernel`(纯框架) + `canvas-core`(画布数据与行为) + `canvas-render`(渲染) + `plugins/*` | 作者诉求完全兑现，且 headless 只依赖前两块 | ✅ 但改动面大，需分步 |

补充一条硬约束（决定了"谁提供"必须有唯一答案）：
`Context.inject(name, impl)` 对重名**抛错**，服务表是**一 ctx 一份的扁平 Map**。
所以"nodeStore 归谁提供"不能有两个答案 —— 独立成包正是给这个答案一个物理位置。

## 5. 与既有铁律的关系

`docs/goal/plugin-system-goal.md` §五.1："内核保持纯逻辑零 Vue、Node 可单测；任何把 .vue/reactive 塞回内核的改动拒绝"。
这条**不禁止**画布服务住在内核包里，只禁止 Vue —— 也就是说，把画布服务独立成包
不是"违反铁律"，而是把铁律想表达的意思（核心要纯）真正落地。

core/Context.ts:5        import { ToolRegistry } from '../services/toolRegistry'   // 真实例化：new ToolRegistry()
core/capabilities.ts:18  import { ToolRegistry } from '../services/toolRegistry'
core/capabilities.ts:15  import type { NodeStoreService } from '../services/nodeStore'
core/types.ts:18         import type { ToolRegistry } from '../services/toolRegistry'
services/settingsPersist.ts   import from '../core/settingsStore'                  // 反向一条
```

也就是：**框架层认识画布业务**（`Context` 构造里 `private builtinTools = new ToolRegistry()`），
而它的挂载函数 `deriveScope` 还顺手把 6 个**画布**能力段焊到每个插件 ctx 上（`core/Context.ts` 末尾 `Object.assign(api, buildCapabilities(...))`）。

---

## 二、实测数据：服务到底由谁提供、谁消费

### 2.1 提供方：17 个服务，只有 3 个是"核心提供"，14 个是宿主手写

- **内核内置（`Context` 里 `new`）：** `slots`、`settings`、`tools` —— 3 个（`core/Context.ts` 的 `builtinSlots/builtinSettings/builtinTools`）。
- **渲染宿主手写注入（`packages/canvas-render/src/host/createMiniCanvasHost.ts`）：**
  `save`、`nodeStore`、`nodeLayout`、`viewport`、`edgeStore`、`resources`、`nodeRegistry`、`themeRegistry`、`selection`、`history`、`graph`、`command`、`menu`、`nodeFactory` —— **14 个**，每个都是 `const x = new Xxx(); ctx.inject('x', x)`。

结论：**"core 作为插件提供上下文"这句设想，今天成立的比例是 3/17。**

### 2.2 消费方：插件重度依赖这 14 个服务

插件生产代码里 `ctx.get('...')` 的频次（不含测试）：

| 服务 | 出现次数 | 典型消费方 |
|---|---|---|
| `graph` | 12 | clipboard / group / align-arrange / node-image / node-3d / file-drop |
| `selection` | 8 | clipboard / multi-select / canvas-export / align-arrange / context-menu |
| `nodeStore` | 7 | 多数节点与工具插件 |
| `viewport` / `settings` | 各 6 | mini-map / node-find / auto-layout / 各插件配置 |
| `edgeStore` | 5 | clipboard / context-menu / auto-save / image-compare |
| `nodeLayout` | 5 | group / auto-layout / multi-select / node-find |
| `command` / `nodeFactory` / `save` | 各 3 | 命令与建节点路径 |

插件声明硬依赖 `export const inject = [...]` 的共 20 包，声明内容全部落在这 14 个服务 + 自己的插件服务名里。
**没有一个插件"提供" nodeStore/selection/graph 这类基础服务** —— 全是消费。

### 2.3 依赖方向实测（这是回答"能不能搬到插件层"的关键）

```
插件 → canvas-core-v2    ✅ 类型 + Context（每个插件都有）
插件 → canvas-render     ✅ 20/24 包声明依赖；其中真 runtime import 的有：
                            useCanvasRender（十几个 .vue）
                            Handle / Position / useVueFlow（theme-default 的 BaseNode、MovingHandle）
                            RenderEvents（context-menu / align-guide / node-3d）
                            createV2Logger / createCoalescer / oldestIncomingToEvict
canvas-core-v2 → 插件     ✅ 零（内核不 import 任何插件）
canvas-render  → 插件     ✅ 零（宿主不 import 具体插件，冷启动靠 coldPlugins/manifest 传入）
```

一处与目标文档不一致的事实：目标文档 `docs/goal/plugin-system-goal.md` 2.1b 写"作者只认**一个** Context"，
但**编译期最少要认两个包**（数据面 `canvas-core-v2`、UI 面 `canvas-render`）。
这不是 bug（Vue 组件必须拿 VueFlow 原语），但**契约上必须写明"两面包"**，否则作者会以为只 import 一个就够。

---

## 三、逐条回答你的三个判断

### 判断 1：「这个核心是作为插件提供它的上下文」

**成立、而且就该这么做，但今天没做全。** 3/17 兑现（见 §2.1）。
`slots/settings/tools` 走的就是这条路（`Context` 内置单实例，插件 `ctx.get` 取到同一份）；
`nodeStore/selection/graph` 等 14 个**同样应该是**这样，只是被塞进了宿主。

### 判断 2：「core-v2 的这些 services 不应该放在插件层中？」

**你不该担心"放进了插件层" —— 它们现在根本没在插件层**（插件层是纯消费者，见 §2.3，零提供）。
真正的问题是它们**在宿主层被手写装配**：只要换宿主（headless/MCP、第二个渲染后端、多画布实例），
这 200 行 `new Xxx() + ctx.inject()` 就得抄一遍，而且抄漏一个就静默少一个服务。

顺带一个更硬的反向证据：**框架层确实已经认识画布业务**（`Context` 里 `new ToolRegistry()`、`deriveScope` 硬挂 6 个画布能力段）。
这一条你是对的。

### 判断 3：「core-v2 作为一个单纯的基础插件构建？」

**这是正确方向，但要注意"纯"有两半，别只改一半：**

- 一半是把 **A 框架层** 洗净：不认识 node/edge/command/tool/theme，只留"插件 + 服务 + 事件 + 作用域 + 开槽"。
- 另一半是把 **B 画布能力层** 收成一个**官方基础插件**：它自己 `apply(ctx)` 里建那 14 个服务并 `provide`，宿主变一行。

**但不能把基础服务做成"普通可热卸插件"** —— 这是这条路上最容易踩的坑，见 §5-①。

---

## 四、三个可选方案（推荐 C，目标态是 B）

### 方案 A · 只立契约，不动包（最低成本）

保持三层包不变，把"服务归谁"写成明文契约，并修掉 `core → services` 那 4 条反向 import
（`ToolRegistry` 从 `Context` 内置挪走，改成可注入的"内置服务钩子"）。

- 改动：`core/Context.ts`、`core/capabilities.ts`、`core/types.ts` + 文档。
- 收益：框架层不再认识 `ToolRegistry`；作者面契约写清"两面包"。
- 没解决：宿主那 14 行装配照旧。

### 方案 B · 真拆包（目标态）

```
canvas-kernel        纯框架：Context/Scope/Fiber/EventBus/configSchema/SlotRegistry 容器
                     + 新增开放扩展点 ctx.defineCapability(name, builder)  ← 框架不再硬编码 6 个画布能力段
canvas-domain       画布能力层：全部 services + Node/Theme registry + capabilities 段
                     + 导出 canvasBasePlugin（apply 里 new 服务并 provide）
canvas-render       渲染宿主：new Context() → plugin(canvasBasePlugin, {adapter}) → plugin(主题/节点插件…) → start()
plugins/*           不变（消费方）
```

- 收益：① 换宿主（headless/MCP/第二后端）零成本；② 框架层彻底不认识画布；
  ③ "服务谁提供"有唯一答案，于是**能换实现**（nodeStore 换成 CRDT/协同版本才真正可行）——
  这才是"可插拔"的实义。
- 代价：见 §5 的四个真问题 + 363 个内核测试需按拆分重新落位。

### 方案 C · 包内分层（推荐先做，B 的前置）

不拆包，只在 **canvas-core-v2 包内**画出边界：

1. `src/core/` **禁止** import `src/services/`（去掉 4 条反向依赖；`tools` 改由外部注入或加"内置服务钩子"）。
2. 新增 `src/canvas/index.ts`：导出 `canvasBasePlugin`（或 `createCanvasBase({adapter})`），
   **把 `createMiniCanvasHost` 里那 14 行 `new + inject` 整块搬进来**，宿主改调它。
3. 文档写死"两面包"契约（数据面 core、UI 面 render）。

- 收益：**"core 作为插件提供上下文"这句设想用最小改动变成事实**；换宿主只装一个基础插件；
  将来要拆包时，`src/canvas/` 整块搬走即可，零返工。
- 成本：低。风险集中在"服务从宿主搬到插件后，生命周期语义变了"（见 §5-①）。
- 建议：**先 C、后 B**。C 做完就是"基础插件"的形态，只是还住在同一个包目录里。

---

## 五、四个真问题（动手前必须先定，否则会踩）

### ① 基础服务不能是"可热卸的普通插件"

`Context.retractUnsatisfiedActives()`（`core/Context.ts`）的既有语义是：
**提供方一卸，依赖它的插件全部回退 PENDING**。若 `nodeStore` 由一个普通插件提供，
那个插件一被卸，`clipboard/group/multi-select/…` 会连带停摆 —— 画布等于停摆。

必须二选一：
- 给基础插件打"**核心不可卸**"标记（`uninstallPlugin` 拒绝卸核心层）；或
- 插件系统加"层级/优先级"概念（基础层 > 业务层）。

**这是这个改造的技术核心，不是搬代码。**

### ② 服务表是全局扁平单命名空间（无 isolate）

`Context` 的服务表是一张 `Map<string, unknown>`，一个 ctx 只有一份 `nodeStore`。
由插件提供后，"谁拥有画布数据"变成可替换的，语义上是好事；
但**同日要保证"一个 ctx 恰好一份"**，不能让两个基础插件同时 provide 成功（今天 `inject` 会因重名抛错，这点是好的）。

### ③ `tools` 今天住在框架里，谱系最脏

`Context` 直接 `new ToolRegistry()` 并让 `depSatisfied('tools')` 恒真。
这是"框架认识业务"最硬的一处，搬到画布层时要同时处理：
`get()` 的三条硬编码分支（`slots`/`settings`/`tools`）、`depSatisfied` 的三条恒真分支、`stop()` 里的重建。
**一处漏改 = 插件静默停在 PENDING 或拿到 undefined。**

### ④ `declare module Context { nodeStore: … }` 散在多个包

现在类型增强散落：`canvas-render/src/index.ts`（nodeLayout/viewport）、各插件（自己的服务）、`canvas-base`。
统一给基础包后必须检查**重复声明冲突**（同一个键两处 declare 会编译报错或悄悄取错类型）。

---

## 六、结论与建议动作

1. 你的直觉对：**框架内核不该认识画布业务；画布服务不该由宿主手写装配。**
2. 但解法不是"services 放进插件层"（它们本来就不在插件层），而是**把画布能力收成一个官方基础插件**。
3. 建议路径：**先方案 C（包内分层 + canvasBasePlugin），再视需要走 B（真拆包）**。
4. 优先级最高的两个前置决策：① 基础服务"不可卸"如何表达；② `tools/slots/settings` 三个内置实例如何迁出框架。

## 附：本次核对用到的命令

```powershell
# 服务被谁消费（次数）
rg -o --pcre2 "ctx\.(get|tryGet)(<[^>]*>)?\s*\(\s*'([a-zA-Z-]+)'" packages/plugins -g '!**/node_modules/**' -g '!**/__tests__/**'

# 插件对 render 的真 runtime import
rg --pcre2 "^import (?!type).*from '@mini-canvas/canvas-render'" packages/plugins -g '!**/node_modules/**'

# 框架层是否反向认识业务
rg -n "from '\.\./services" packages/canvas-core-v2/src/core

# 基线（本次实测全绿）
cd packages/canvas-core-v2; node ./node_modules/vitest/vitest.mjs run   # 38 文件 / 363 测试通过
```

---

## 6. 命名（作者指出，2026-09-13）

> 作者原话：**"packages/canvas-kernel/ ... 你这个就不需要使用 canvas 前缀啊"**

对。**名字是契约**：包叫 `canvas-kernel`，就等于允许内核认识画布。要内核不认识画布，名字就不该带 canvas。

- scope `@mini-canvas/` = 项目归属（正常，如 `@vue/runtime-core`），**不是**领域；
  真正要改的是斜杠后面那个包名。
- 建议：`@mini-canvas/kernel`（纯插件框架）+ `@mini-canvas/canvas-core`（画布数据层）+ `@mini-canvas/canvas-render`（渲染）。

**今天的现状恰好印证了这条**：`core/Context.ts` 直接 `new ToolRegistry()`，
而 `ToolRegistry` 的字段里有 `nodeId` / `canvasId`（`src/services/toolRegistry.ts:163,165`）。
一个"插件框架"里出现 `canvasId` —— 所以现在叫 canvas-kernel 是**诚实的**。
**改名的前提是先把代码改对**；两件事是同一件事。

---

## 7. 动手记录 · 第 1 步（2026-09-13）

**已做：把"画布专属"的注册表从 `src/core/` 搬到新建的 `src/canvas/`。**

搬走的 5 个文件（旧路径留一行转发垫片，存量 import 与测试零改动）：

| 原位置 | 新位置 | 为什么属画布 |
|---|---|---|
| `core/registry/nodeRegistry.ts` | `canvas/registry/nodeRegistry.ts` | 全是"节点展示段"概念 |
| `core/registry/nodeRenderer.ts` | `canvas/registry/nodeRenderer.ts` | 解析 content/title/toolbar |
| `core/registry/registerNodeType.ts` | `canvas/registry/registerNodeType.ts` | 节点类型注册 |
| `core/registry/themeRegistry.ts` | `canvas/registry/themeRegistry.ts` | nodeShell/edge/background 槽 |
| `core/registry/registerThemeSlot.ts` | `canvas/registry/registerThemeSlot.ts` | 主题槽注册 |

留在 core 的 `registry/slotRegistry.ts` **是通用容器**（任意字符串槽 + order + occupant），不含画布概念，属插件框架能力，故不搬。

依赖方向现在是：`canvas/registry/*` → `core/registry/slotRegistry`（canvas 认识 core，正确方向）。

**验证（全绿，测试一条未改）**：canvas-core-v2 363 / canvas-render 215 / theme-default 91 / node-text 64 / node-image 148 / ui 23；core 与 render 的 `tsc --noEmit` 均 0 错。

## 8. 第 2 步的岔路口（需要拍板）

还剩 4 条 `core → services` 的反向引用，它们集中在同一个点上：**`Context` 构造时硬挂画布能力**。

```
core/Context.ts:5       import { ToolRegistry } from '../services/toolRegistry'   // 构造里 new 一个
core/Context.ts:140     Object.assign(this, buildCapabilities(this, '<host>'))
core/capabilities.ts    import NodeStoreService/NodeFactoryService/CommandDef/ToolRegistry
core/types.ts           import ToolDef/ToolFilter/...  from '../services/toolRegistry'
```

难点不在搬代码，在于：**今天每个 `new Context()` 都会自带 `ctx.nodes/theme/commands/slots/settings/tools`**，
而内核的 6 个测试文件直接用 `new Context()` + `c.nodes.register(...)`。

于是有两条路，代价不同：

| 路 | 做法 | 结果 | 代价 |
|---|---|---|---|
| **甲** | `core` 只保留通用扩展点 `ctx.defineCapability()`；画布能力段整体搬到 `src/canvas/capabilities.ts`，由画布基础插件装 | 真正的"插件核心不认识画布" | **要改约 6 个内核测试**（它们得先装画布基础层）→ 触碰铁律 4 |
| **乙** | `capabilities.ts` 搬进 `src/canvas/`，但 `core/Context.ts` 仍 import 它作默认 | 代码位置对了、core 里再无画布实现 | core 仍"知道画布存在"（一条默认装配线）→ 目标只达成一半 |

**甲是终点，乙是准备动作。** 我倾向先做乙（第 1 步已把注册表搬完，乙是同一手法的延续），
等第 3 步做"画布基础插件"时再一次性把默认装配线翻过去、同时更新那 6 个测试——
这样"改测试"和"改默认"是同一件事，只发生一次。

**需要作者定**：是否允许我在第 3 步改那 6 个内核测试（铁律 4 的例外）。

---

## 10. 第 2 步：新建 kernel 库并接线（2026-09-14）

按作者指示落地，分两段：

### 第一段：新建 `packages/kernel`（`@mini-canvas/kernel`）——纯插件框架

| 内容 | 说明 |
|---|---|
| `Context.ts` | 装载 / 依赖编排 / 事件 / 作用域回收；**不认识的画布能力段由"能力层"接缝提供** |
| `capabilityLayer.ts` | 能力层接缝（`CapabilityLayer` 接口 + 每 Context 一份的工厂） |
| `toolRegistry.ts` | **框架自带**的 `ctx.tools`（工具注册表：注册外部能力、按名调用） |
| `types.ts` | 插件模块形态 / 生命周期 / 事件表（`EventMap`，不再是 `CanvasEventMap`）/ 能力段合并缝 |
| EventBus / Scope / Fiber / topo / service / pluginClass / configSchema / settingsStore / registry/slotRegistry | 通用设施 |
| `__tests__/kernelBoundary.test.ts`、`serviceRegistration.test.ts` | 9 条边界/服务契约测试 |

**关键决定（作者拍板）**：`tools` 归内核自带（通用能力，与画布无关）。
**措辞纠正（作者指正）**：`inject` 是首选写法（硬依赖），`ctx.get` 才是可选依赖探测——此前写反了。

### 第二段：canvas-core-v2 接到 kernel

- `canvas-core-v2` 依赖 `@mini-canvas/kernel`（workspace:*）。
- `src/core/*` 全部变成 **8 行转发垫片** → `@mini-canvas/kernel`（画布注册表那几个转发到 `src/canvas/`）。
- `src/core/Context.ts`：`class Context extends KernelContext`，**默认装画布能力层**
  → `new Context()` 依旧自带 `ctx.nodes/theme/commands/slots/settings`，包内 363 条测试**零改动**。
- `src/canvas/capabilityLayer.ts`：画布能力层（提供 slots/settings，产出画布能力段；剥掉 tools 因框架已自带）。
- `src/canvas/capabilityTypes.ts`：把画布能力段**声明合并**回 kernel 的 `PluginCapabilities`。
- `src/services/toolRegistry.ts`、`core/capabilities.ts` 里重复的 tools 段：已删（单一来源在 kernel）。

### 验证基线（全绿）

| 包 | tsc | 测试 |
|---|---|---|
| kernel | 0 错 | 9 |
| canvas-core-v2 | 0 错 | 363 |
| canvas-render | 0 错 | 215 |
| canvas-base | 0 错 | — |
| ui | vue-tsc 0 错 | 23 |
| 24 个插件包 | 23/24 类型 OK（theme-default 的 .vue raw-tsc 属既有问题，vue-tsc 无关） | 全部通过 |

另：`packages/ui` 生产构建通过（366 模块）。

### 已知遗留

- `plugin-theme-default` 用 raw `tsc` 报 `.vue` 相关错（该包 typecheck 脚本如此，与本次改动无关）。
- `canvas-base` 仍是"作者友好薄层"，尚未决定是否也搬到 kernel 之上。

---

## 11. 第 3 步：新建数据层 `@mini-canvas/canvas-data` + 全下游接线（2026-09-14）

按作者定的整体架构落地为四层：

```
@mini-canvas/kernel         纯插件框架（装载/依赖/事件/作用域回收/自带 tools）   ✅ 新建
@mini-canvas/canvas-data    数据层（保存/读取/图模型）                           ✅ 新建
@mini-canvas/canvas-core-v2 画布能力层（节点/主题/命令/槽/配置 + 画布域服务）      ✅ 已接线
@mini-canvas/canvas-render  渲染层（VueFlow/DOM/令牌 + nodeLayout/viewport）      ✅ 已接线
packages/plugins/*          插件库（24 个）                                      ✅ 已接线
```

### 数据层搬了什么（新建包，实现+测试一起走）

| 从 `canvas-core-v2/src/services` | 到 `canvas-data/src` |
|---|---|
| `nodeStore` / `edgeStore` / `graphDocument` | 图数据与唯一写入口 |
| `selection` / `history` | 选中态 / 撤销栈 |
| `storage/`（SaveService / keys / adapters / types） | **保存相关**（作者点名的"数据保存"） |
| `resourceService` / `settingsPersist` / `transient` | 资源、配置落盘桥、中间态判定 |

数据层**只依赖 kernel**，不依赖画布能力层与渲染层（已核对）。测试也随之搬过去：`canvas-data` **75 条**。

### 全下游接线（机械重写 + 依赖声明）

- 按符号归属把 93 个文件的 import 拆到正确的层：
  - 框架符号（`Service`/`SettingsStore`/`Tool*`/`PluginModule`…）→ `@mini-canvas/kernel`
  - 数据符号（`NodeStore`/`CanvasNode`/`GraphDocument`/`SaveService`…）→ `@mini-canvas/canvas-data`
  - 画布能力与画布域服务（`NodeRegistry`/`ThemeRegistry`/`CommandRegistry`/`NodeFactory`/`iconRenderMode`/`registerNodeType`…）→ 仍走 `canvas-core-v2`
  - 特别修正：`Context` 归**画布**（画布消费方要的是"带画布能力段的 ctx"），27 处已拨正
- 25 个 package.json 补上真实依赖声明

### 最终验证（全绿）

| 包 | 类型检查 | 测试 |
|---|---|---|
| kernel | 0 错 | 9 |
| canvas-data | 0 错 | 75 |
| canvas-core-v2 | 0 错 | 363 |
| canvas-base | 0 错 | — |
| canvas-render | 0 错 | 215 |
| ui | vue-tsc 0 错 | 23 |
| 24 个插件包 | 23/24 OK（theme-default 的 raw-tsc 处理 .vue 属既有问题） | 全部通过 |

另：`packages/ui` 生产构建通过。

### 未做/待定

- `canvas-base`（作者友好薄层）仍架在 canvas-core-v2 之上，未改从 kernel 取框架符号。
- `plugin-theme-default` 的 `typecheck` 用 raw `tsc` 处理 `.vue`，既有问题（非本次引入）。
- 本次所有改动未提交（工作区）。



---

## 12. 浏览器运行时验证（2026-09-14）

前面都是 node 环境测试；本轮补上**真实浏览器**验证（`packages/ui` dev server + 内置浏览器）。

| 验证项 | 结果 |
|---|---|
| 页面渲染 | 文本 + 图片两节点渲染成卡片；工具栏/品牌/设置按钮齐全 |
| 控制台 | **零 error / 零 warn** |
| 建节点 | 点「+ 文本」→ 节点数 2 → 3（id 1/2/3） |
| 拖动节点 | `translate(176px,80px)` → `translate(270px,160px)`（位移正确） |
| 连线 | 从节点1 输出口拖到节点2 输入口 → 边 `e-1-2` 建立 |
| 连接校验 | 重复连接被拒并有日志：`checkConnection 1→2 非法:duplicate` |
| 撤销 | Ctrl+Z → 边消失（3 节点仍在） |
| 重做 | Ctrl+Shift+Z → 边恢复 |
| **刷新恢复** | F5 后 3 节点 + 边 `e-1-2` **完整回来**（数据层核心价值） |
| 设置面板 | 打开正常，分组齐全（布局/常规/边/节点/导出/诊断），含各插件配置项 |

这条把"render 可视化渲染"从"测试通过"提升到"**运行时确实能画、能操作、能持久化**"。

## 9. 中间过程记录 · 乙（2026-09-14，已被第 10/11 节取代）

作者指示"按推荐来"，故只执行到**乙**（准备动作），**甲（翻转）未落地**。

### 已落地（乙，测试零改动、全绿）

把"画布专属"的实现从 `src/core/` 搬到 `src/canvas/`，旧路径留一行转发垫片：

| 原位置 | 新位置 |
|---|---|
| `core/registry/nodeRegistry.ts` | `canvas/registry/nodeRegistry.ts` |
| `core/registry/nodeRenderer.ts` | `canvas/registry/nodeRenderer.ts` |
| `core/registry/registerNodeType.ts` | `canvas/registry/registerNodeType.ts` |
| `core/registry/themeRegistry.ts` | `canvas/registry/themeRegistry.ts` |
| `core/registry/registerThemeSlot.ts` | `canvas/registry/registerThemeSlot.ts` |
| `core/capabilities.ts`（buildCapabilities 实现） | `canvas/capabilities.ts` |

留在 `core` 的 `slotRegistry.ts` 是**通用容器**（任意字符串槽 + order + occupant），不含画布概念，属插件框架能力。

**验证**：canvas-core-v2 **363** / canvas-render **215** / theme-default **91** / node-text **64** / node-image **148** / ui **23** 全绿；
core 与 render `tsc --noEmit` 均 0 错。**测试一条未改。**

### 试做后撤回（甲，需先拍板）

甲 = 让 `core` 运行时不再依赖画布实现（新增 `core/capabilityLayer.ts` 接缝 + `canvas/capabilityLayer.ts` 实现
+ `canvas/capabilityTypes.ts` 声明合并），并让 `new Context()` 默认从画布层取能力段。

实测结果是**内核 6 个测试文件、23 条用例变红**——因为"裸 `new Context()` 自带画布能力"这条隐含前提被取消了：

- `core/__tests__/capabilities.test.ts`（12 条）
- `core/__tests__/b2SettingsHost.test.ts`（3 条）
- `core/__tests__/configSchema.test.ts`（2 条）
- `core/__tests__/context.test.ts`（2 条）
- `core/__tests__/cordisParity.test.ts`（2 条）
- `services/__tests__/toolRegistry.test.ts`（3 条）

**结论（比第 8 节更精确）**：甲不是"改 6 个测试"那么轻——它改的是这些测试**如何构造 ctx** 这一前提，
且 `canvas-core-v2` 内既有测试都从相对路径（`../Context`）导入，绕过了包入口，无法用入口装配自动兜住。
可行做法是给包内测试加 vitest `setupFiles`（装默认层），这样测试文件本身仍可一字不改；
但这本质上是"用测试配置替测试代码"来保留旧前提，**是否接受需作者拍板**。

**未落地**：新文件 `core/capabilityLayer.ts`、`canvas/capabilityLayer.ts`、`canvas/capabilityTypes.ts`、`canvas/index.ts` 已删除，
`core/Context.ts` 与 `core/types.ts` 已还原，避免留下未接线的死代码。

### 当前 4 条 `core → services` 反向引用的真实状态

```
core/Context.ts:5     import { ToolRegistry } from '../services/toolRegistry'   // 仍在
core/types.ts:?       import Tool* from '../services/toolRegistry'              // 仍在
core/capabilities.ts  → 已变垫片（实现搬到 canvas/），引用转移
core/types.ts         NodeRegisterDef → './capabilities'（垫片路径，实现在 canvas/）
```

即：**实现层已搬走，装配层仍连着**。再往前一步就是甲。
