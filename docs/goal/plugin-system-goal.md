# 目标文档 · @mini-canvas 插件系统基础（插件开发简单 · 插件可自定义任何内容）

> **定位（作者原话，最高准则）**：我要的只是一个"插件系统的基础功能"，用来开发插件使用——这些能力**很可能大半已经在我内核里了**。
> 所以这不是"把系统做得丰富/像 dsh"，而是：**把"让插件开发简单、让插件能自定义任何内容"所需的那一小层基础补齐，并收敛成一个好用的开发入口。**
> 每次开工把本文件发给 agent，agent 按它做，直到末尾验收全勾才结束。
> 工作区：`D:/Code/Git/mini-canvas`。参考调查：`docs/tmp/dsh-plugin-survey/survey.md`、`docs/tmp/render-layer-migration/*`。

---

## 〇、一句话目标

把插件系统收敛成**作者用起来简单、插件能自定义任意内容（节点/主题/端口/UI/服务/命令）** 的一套**基础能力**。
能力大半已在内核；缺的是"开放的插槽/注册 + 一个简单开发入口 + 把散装注册函数收成一条 API"，其余（端口吸附、事件拦截、插件管理器）都是**验证示例/附带**，不是验收主体。

## 一、现状上下文（开工必读）

### 1.1 monorepo 分层（已完成，勿推翻）
```
packages/
├─ canvas-core-v2     内核（纯逻辑零 Vue）：Scope/Context + services(nodeStore/command/history/connection…) + registry + contracts/edgeGeometry
├─ canvas-render      渲染宿主层（新独立包）：CanvasHost.vue + canvasHostCore + createMiniCanvasHost + vueFlowBridge + 渲染令牌
└─ plugins/           plugin-node-text / node-image / theme-default / canvas-commands（已做成独立插件包）
依赖方向单向无环：canvas-core-v2 ← canvas-render ← theme-default/node-text；canvas-core-v2 ← node-image/commands。
```

### 1.2 内核"基础能力"其实大半已有（别重复造）
- 插件生命周期：`installPlugin / uninstallPlugin / reloadPlugin` + Lifecycle 状态机 + Scope 作用域自动回收副作用 + `ctx:lifecycle-change` 事件。✅
- 服务注册/发现：`ctx.inject(name, impl)(自动回收) / ctx.get(name)`；插件间 `ctx.plugin(mod)`。✅
- 事件：`on/once/emit`。✅（waterfall/bail 属"示例级增强"，非基础必需）
- 注册机制：`nodeStore.registerType`（数据/尺寸/连接声明）、`nodeRegistry`（type→content/title 组件）、`themeRegistry`（nodeShell/edge/background/edgeDefaultType）、`registerNodeType/registerThemeSlot`。⚠️ 有，但**单格、收散、无统一入口**。
- 连接声明：`connection.ts` 的 `PortDef(port/accepts/limit)`、`NodeConnectionDef(inputs/outputs)` + `validateConnection`。✅（端口语义的内核底座已在）
- 渲染宿主：canvas-render 的 CanvasHost + `nodesFromStore` 等。✅

### 1.3 真正的缺口（基础层只补这几处）
1. **开放的插槽**：一个槽能叠多个 occupant、按 order 排序、按 id 增量/替换/remove，**且插件能自己声明新槽**（不只宿主预设那几格）。
   → 容器已做一半：`SlotRegistry`（`src/core/registry/slotRegistry.ts`，10 测试绿）。**待办**：让 nodeRegistry/themeRegistry 走它、开放"声明新槽"、渲染层按序渲染。
2. **统一的简单开发入口**：作者只 import 一个库、一个 `defineCanvasPlugin` 就够（对标 dsh 的 `@deepseek-ai/cordis`：作者只认 `Context`；各能力是 `define*` 助手）。
   → 待建 `@mini-canvas/canvas-base`。
3. **可诊断 + 依赖就绪**（可选增强，帮"开发简单"排错）：每插件一个可查句柄；依赖没到先进 PENDING、到了自动跑。→ 待办（非主体，做了更好）。

### 1.4 用户的核心判断（写进验收导向）
- "**也许能力已经包含在核心里面了**" → 任何目标先自查"内核有没有"，有就别再造，只做收口/补开放。
- "**插件可以自定义任何内容**" → 槽/注册/服务必须**开放**：插件能自定义节点、主题(连线/壳/端口样式)、内容组件、服务、命令、UI，且能被宿主同一套机制渲染。宿主**不要**预先规定死一堆具体语义落点（工具栏/右键菜单/dock 是示例，不是框架承诺）。
- "**开发简单**" → 从"记一堆注册函数 + 手写 effect 包 unregister + 知道内核拆在哪"收敛到"一个库一个 define、自动回收"。

### 1.5 参考（dsh 插件体验，取自 survey 报告）
写插件 = `ctx.plugin({ name, apply(ctx){ 注册服务/命令/slot } })` 一句 setup；UI 靠类型化 slots（multi + order + id）；注册 API 本身是 effect → 插件几乎不手写 uninstall；ctx 是"宿主 inject 上架、插件 ctx.get 拉取"的开放服务场。

---

## 二、目标终态（做完"长什么样"，可验证）

### 2.1 插件作者体验（最重要）
作者写一个"自定义某种节点/主题/服务/命令"的插件，理想代码（示意）：
```ts
// 只 import 这一个库
import { defineCanvasPlugin } from '@mini-canvas/canvas-base'

export default defineCanvasPlugin({
  name: 'my-node',
  deps: [],                       // 依赖其它插件/服务名（可空）
  // 可"自定义任何内容"：声明节点、主题槽、服务、命令、UI 槽
  nodes: [{ type: 'audio', label: '音频', size: { w: 200, h: 80 }, content: AudioContent }],
  theme: [{ slot: 'edge', id: 'mine', component: MyEdge }],   // 顶替默认连线(主题)
  services: { 'mySvc': (ctx) => makeMySvc() },
  commands: [{ id: 'myCmd', label: '…', run: (ctx) => {} }],
  ui: [{ slot: 'myOwnSlot', id: 'panel', component: Panel }], // 也能塞进任意槽/自带新槽
})
```
不必手写 provide、不必逐段注册、不必手写 unregister（自动回收）。

### 2.2 开放插槽（能自定义任何 UI/内容）
- 一个 slot 容纳多个 occupant，order 排序，id 增量/替换/remove；**插件可声明新 slot**。
- `themeRegistry/nodeRegistry` 都走这套开放槽语义（单格换肤点 = single：order 最小的赢家）。
- 渲染层(CanvasHost/canvasHostCore)把一个 slot 的所有 occupant 按序 render 出来。

### 2.3 统一开发入口 `@mini-canvas/canvas-base`
- `defineCanvasPlugin(...)` + 类型 + 各 `define*`/能力声明段，底层转发内核/render/令牌。
- 插件包只依赖这一个库，不散 import 内核/渲染。

### 2.4 打包 / 分发 / 安装（轻量入口，适配"库"，不照搬 dsh CLI/profile/patch）
参考 dsh `publish.zh.md`（bundle + profile + `dsh plugin add` + 从 npm/git/tarball 装），但 mini-canvas 是引擎库不是独立 app，
所以把它收敛成**适配库的两层轻量形态**（不建 CLI、不做 profile 目录、不做整树 patch 语法）：
- **插件包 = 可复用 bundle**：一个 `@mini-canvas/canvas-base` 写的插件，可 (a) 作为 workspace 包源码直接 import，
  也可 (b) 打包成**单文件插件 js**（复用 demo 已有的 UMD `plugin-node-text.js` 路径），宿主运行时加载。
- **装配清单 = 应用组合**：一份简单的有序清单（代码数组或一份 json/yaml）列出"按什么顺序装哪些插件 + 每插件配置"，
  画布应用(`CanvasHost`/`createMiniCanvasHost`)按它一次性装配。清单里后装的同 id 插件**覆盖**先装的（轻量分层，替代 dsh patch 的"后层胜出"），
  不做深度配置合并的复杂语法。
- **分发**：插件可发布为 npm 包、或交付单文件 js / workspace 源码，让别的画布应用 import/install 即用。

作者流程（对齐 dsh basic 教程手感）：① 写个插件（源码）本地注入宿主试跑 → ② 声明配置 → ③ 打包成可分发插件包
→ ④ 别处通过"装配清单"或"运行时安装"把它用起来。

---

## 三、目标清单（基础层：开放插槽 / 开发入口 / 打包分发；可诊断是可选增强；业务能力一律降为"验证示例"）

### 🎯 目标 A（核心）· 开放插槽 + 渲染
- **结果**：`SlotRegistry`(已有一半)接进 nodeRegistry/themeRegistry：一个槽多 occupant + order + id + remove；支持插件声明新槽；渲染层按序渲染。
- **自查"内核有没有"**：容器本身新的，加进来；渲染层本来读 registry，改成读多 occupant 即可。
- **验收**：单测绿；两个插件往同一槽各塞组件、同屏按序渲染；默认主题走新槽仍可一键顶替 + 热卸回退；demo 零报错。

### 🎯 目标 B · 统一开发入口 `@mini-canvas/canvas-base` + 作者教程（对齐 dsh basic 形态）
- **结果**：建包，`defineCanvasPlugin` 一条 API + 能力段(nodes/theme/services/commands/ui) + **插件可声明 Config(schema+默认值)** + 转发；注册自动回收（插件不手写 unregister）。
- **自查"内核有没有"**：内核各 register* 已有，base 只是**收口 + 自动回收 + 接配置**，不新增引擎逻辑。
- **作者教程（对齐 dsh basic/index→config→publish 那套成体系中文教程）**：一篇照着就能跑的文档——① 写第一个插件并本地注入宿主跑起来 → ② 自定义节点/主题/服务/命令 → ③ 插件声明配置 → ④ 打包/分发到别的画布应用。
- **验收**：示例插件只 import `@mini-canvas/canvas-base` 写出可跑通的自定义节点+主题+命令插件（注册自动回收）；插件能声明并读取配置；脚手架 + 中文作者教程 doc 在、照着能一步步跑通。

### 🎯 目标 D · 打包 / 分发 / 安装（轻量入口，见 2.4）
- **结果**：支持"插件包 → 单文件插件 js / npm / workspace 源码"三种可分发形态；提供**装配清单**让画布应用按序安装插件 + 传配置；支持运行时把单文件插件装进宿主。
- **自查"内核有没有"**：安装机制 `installPlugin/uninstallPlugin/reloadPlugin` 已有；demo 已有 UMD 加载(`plugin-load`)验证。要补的只是"把散装安装收成可复用入口 + 单文件打包范式 + 装配清单"。
- **不做**：CLI、profile 目录、cordis.yml/patch 整树语法、深度配置合并（只做"按序装 + 同名覆盖"的轻量分层）。
- **验收**：①一个插件可打成单文件 js 并被宿主运行时 install 生效（复用/对齐 demo 现有 UMD 验证）；②装配清单能把 theme-default/node-text/image/commands 按序装配并传配置，另一画布应用 import 该清单即用；③整条"作者打包 → 别处安装"流程在 demo 跑通零报错。

### 🎯 目标 C（可选增强，帮排错）· 可诊断 + 依赖就绪
- **结果**：每插件一个可查句柄 `{name,state,deps,config}`；依赖没到进 PENDING、到即跑、卸则待命/卸。
- **验收**：单测绿；教程能照抄跑通一个最小插件。

---

## 四、验证示例（做出来证明"能自定义任何内容"，不算框架承诺）
用以上基础做几个**示例插件**验证，而不是当验收主体：
- **自定义端口/吸附/快速连接**：一个自定义节点声明"2 输入 1 输出、某输出只接指定 type、limit single"，demo 里拖线吸附/松手连接符合声明（内核 connection 已有，套一层验证）。
- **插件管理器(plugin-manager)**（作者随口提、非最初核心诉求，作附带）：一个用 `defineCanvasPlugin` 写的插件，dock 面板列出已装插件 state、可卸载/重载/装外部插件 js/源码。能跑即可，做不出也不阻塞验收主体。

---

## 五、约束与原则（动工前必守）
1. 内核保持纯逻辑零 Vue、Node 可单测；任何把 .vue/reactive 塞回内核的改动拒绝。
2. 不推翻已完成的 canvas-render 迁移与依赖方向；`canvas-base` 是上面加的一层作者收口，不是再造第三渲染层。
3. **先自查"内核有没有"，有就收口/补开放，不重复造轮子**（1.4 用户判断）。
4. 兼容存量：theme-default/node-text/image/commands 不能坏；不破坏已绿测试语义。
5. **宿主不预定义一堆具体语义落点当承诺**；要的是"插件能自定义任意内容"的开放机制，工具栏/右键/dock 只是示例槽。
6. 小步原子 commit + 测试；LF、pnpm workspace、vue-tsc 查 .vue。
7. 中间调查文档落 `docs/tmp/`，完成后再问是否清理。

---

## 六、实施路径（建议顺序；每步可独立验证）
- **P1 · 目标 A**：SlotRegistry 接 nodeRegistry/themeRegistry + 开放声明新槽 + 渲染层按序渲染 + 迁移 theme-default/node-text 走新槽 + demo 验证多 occupant。
- **P2 · 目标 B**：建 `packages/canvas-base`（defineCanvasPlugin + 能力段 + 配置 + 转发 + 自动回收）+ 中文作者教程 doc。
- **P3 · 目标 C**：per-plugin 句柄 + PENDING 依赖编排 + 单测。
- **P4 · 目标 D**：打包/分发/安装轻量入口 —— 单文件插件打包范式 + 装配清单 + 运行时 install + demo 整链验证。
- **P5 · 验证示例**：端口/吸附/快速连接示例节点；可选 plugin-manager。
- **P6 · 收尾**：全量回归 + 更新验收勾选 + docs/tmp 清理征询。

> 每个 Goal"先写验收用例 → 实现 → 浏览器验证 → commit"。目标 A 是核心，优先。

---

## 七、强制终审闸门（结束的硬性前提）
- **必须用 `run_subagent` 起一个独立子代理终审**；不派子代理只靠自己审核就宣布完成 = 不予通过、视为未结束。
- 子代理要非常严格挑剔，**以本文件为目标基准 + 对齐 `deepseek-harness/docs` 的插件实现**（cordis-primer/cordis-api/subsystems slots+extensions/capability-seams/cordis-tutorial），逐条对照。
- 重点核对：是否守住"作者原意"（基础功能、能力多已在内核、开发简单、插件可自定义任何内容、**没有为了丰富而过度设计/没有把业务能力当验收主体**）、是否破坏纯逻辑内核/推翻渲染层迁移/弄坏存量插件。
- 不通过 → 子代理给原因 + 修改清单 → 主 agent 改完**再次启子代理复审**直到通过；报告落 `docs/tmp/plugin-system-review/`。
- 主 agent 给子代理 prompt 需自报身份（`Caller agent: code-developer`）。

---

## 八、验收总清单（全勾 = 本任务才结束）
- [ ] 目标A：nodeRegistry/themeRegistry 支持多 occupant + order + id 增量/替换/remove + 插件可声明新槽；单测绿；两插件同槽按序同屏渲染；默认主题走新槽可一键顶替/热卸回退。
- [ ] 目标B：`@mini-canvas/canvas-base` 存在；示例插件只 import 它写出可跑通的自定义节点+主题+命令插件（注册自动回收，不手写 unregister）；插件能声明并读取配置；中文作者教程 doc 照着能跑通。
- [ ] 目标D：插件可打成单文件 js 并被宿主运行时 install 生效；装配清单能把默认插件按序装配并传配置、另一画布应用 import 即用；整条"打包→安装"在 demo 跑通零报错。
- [ ] 目标C：per-plugin 可查句柄 + PENDING 依赖编排单测绿（可选，做了打勾）。
- [ ] 验证示例：自定义端口/吸附/快速连接节点在 demo 行为符合 connection 声明（示例级）。
- [ ] 全量：内核+渲染+全部插件 tsc / vue-tsc / vitest 全绿；demo 浏览器端到端零 console 报错。
- [ ] **终审闸门：已用 run_subagent 起严格子代理按本文件 + deepseek-harness/docs 审核通过，报告在 docs/tmp/plugin-system-review/**。
- [ ] 本文件更新为"完成态"。
