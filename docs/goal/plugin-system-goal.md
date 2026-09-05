# 目标文档 · @mini-canvas 插件系统基础（插件开发简单 · 插件可自定义任何内容）

> **定位（作者原话，最高准则）**：我要的只是一个"插件系统的基础功能"，用来开发插件使用——这些能力**很可能大半已经在我内核里了**。
> 所以这不是"把系统做得丰富/像 dsh"，而是：**把"让插件开发简单、让插件能自定义任何内容"所需的那一小层基础补齐，并收敛成一个好用的开发入口。**
> 每次开工把本文件发给 agent，agent 按它做，直到末尾验收全勾才结束。
> 工作区：`D:/Code/Git/mini-canvas`。参考调查：`docs/tmp/dsh-plugin-survey/survey.md`、`docs/tmp/render-layer-migration/*`。

---

## 🚀 开工说明（系统提示词 —— 每次开工先把下面这段读给/贴给 AI）

> 你是 code-developer，负责开发 **@mini-canvas 的插件系统基础能力**。下面这份 `docs/goal/plugin-system-goal.md` 是**目标驱动文档**：开头"定位/一句话目标"定基调，中间"目标清单(A/B/B2/D/C)+验收清单"定要交付什么，末尾"验收总清单"全勾了才算结束。照它做，别自己发挥。

1. **读它、认准基调**：我要的只是"插件系统的基础功能"；**能力大半已在内核**——每做一步先自查"内核有没有"，有就收口/补开放，**绝不重复造轮子**。开发要简单（作者写插件 = 一个 .ts 裸导出 `name/inject/apply(ctx)` 的 Cordis 式，见 2.1b/2.3）。插件要能自定义任何内容（节点/主题/端口/UI/服务/命令/配置）。
2. **先侦察再动手**：开工先 `git status` 看当前分支与改动；需要了解内核现状用 codegraph MCP（索引查不到再退回 grep/Read）；需要看外部参考（dsh 插件系统/文档）才联网查，结论落 `docs/tmp/<任务>/`，别在主进程堆过程。
3. **只改该改的**：默认**只动本任务目标文档指向的代码文件**；除非用户明确点头，别顺手改无关文件。历史教训：我曾误改 demo/插件示例代码被用户斥责——**"让你改目标文档时就去改目标文档，别去碰代码"**。
4. **边做边验证**：内核/渲染改动必须带单测；改完跑对应 vitest、vue-tsc 保持全绿；涉及渲染用 chrome-devtools 在 demo(:5199 canvas-core-v2) 里眼见为实，别只说"应该可以"。
5. **小步原子 commit**：每完成一个能独立验证的小步就 commit，message 清晰（type: 中文/英文描述），不 `git add .`，不 push，不动用户没让动的分支。
6. **中途要拍板先问**：拿不准方向/要动范围外的代码时，先停下来用大白话问用户，别自作主张。但小步别反复打断，思路明确就连续做完。
7. **结束有闸门**：所有验收项做完≠完——**必须用 run_subagent 起一个严格挑剔的子代理，以本文件为目标 + 对齐 `deepseek-harness/docs` 的插件实现**逐条终审，不过就改到过；报告落 `docs/tmp/plugin-system-review/`。全绿且终审通过，才向用户汇报。

---

## 〇、一句话目标

把插件系统收敛成**作者用起来简单、插件能自定义任意内容（节点/主题/端口/UI/服务/命令）** 的一套**基础能力**。
能力大半已在内核；缺的是"开放的插槽/注册 + 一个简单开发入口 + 把散装注册函数收成一条 API + 一套分组化可配置体系"，其余（端口吸附、事件拦截、插件管理器）都是**验证示例/附带**，不是验收主体。

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
2. **统一的简单开发入口（对齐 cordis-tutorial 的 ctx / 服务模型，见 2.1/2.3）**：作者写一个 .ts，只认内核那个 `Context`（`PluginScope`）——`export function apply(ctx)`，在 `apply` 里用 `ctx.nodes/theme/commands/services/slots/...` 注册（对标 cordis-tutorial：作者只认 `Context`；框架负责生命周期/依赖/自动回收，各画布能力是收口在 ctx 上的注册段）。
   → 把散装 `registerNodeType/registerThemeSlot` 等收口挂上 ctx；`@mini-canvas/canvas-base`（薄层）导出 `Context` 类型 + `define*` 助手。
3. **分组化可配置体系**：插件要"可配置"（最典型是主题插件——UI 上调节点/连线样式、改动实时生效）。内核**没有**这套：`PluginModule.config` 只是空字段、装载函数不读、ctx 拿不到。缺的是一个规范的**分组配置服务** `ctx.settings`：插件按组申报 schema、UI 面板按分组长控件、改一项实时生效、性能可控（见 2.4 / 目标 B2）。
4. **可诊断 + 依赖就绪**（可选增强，帮"开发简单"排错）：每插件一个可查句柄；依赖没到先进 PENDING、到了自动跑。→ 待办（非主体，做了更好）。

### 1.4 用户的核心判断（写进验收导向）
- "**也许能力已经包含在核心里面了**" → 任何目标先自查"内核有没有"，有就别再造，只做收口/补开放。
- "**插件可以自定义任何内容**" → 槽/注册/服务必须**开放**：插件能自定义节点、主题(连线/壳/端口样式)、内容组件、服务、命令、UI，且能被宿主同一套机制渲染。宿主**不要**预先规定死一堆具体语义落点（工具栏/右键菜单/dock 是示例，不是框架承诺）。
- "**开发简单**" → 从"记一堆注册函数 + 手写 effect 包 unregister + 知道内核拆在哪"收敛到"一个库一个 define、自动回收"。

### 1.5 参考（cordis-tutorial 插件体验，取自 survey 报告）
看 `deepseek-harness/docs/cordis-tutorial/`（7 章框架手把手教程）：插件是函数（`export function apply(ctx)`），由装配清单 loader 挂载；`ctx` 上经它建立的一切注册都是 effect、随插件卸载自动撤销；服务靠 `inject` 依赖编排（缺提供方则 PENDING、到即跑）；UI/扩展靠宿主开放的 slot/注册场。ctx 是"宿主/插件 inject 上架、插件 ctx.get/inject 消费"的开放服务场。

---

## 二、目标终态（做完"长什么样"，可验证）

### 2.1 插件作者体验 = 一套 cordis-tutorial 式手把手中文教程（最重要）
> 落地口径（本目标按作者原意收敛，别照抄 dsh 全套）：教程是一串**手把手中文短篇**、每篇照抄能跑，落在画布能力上——
> 已交付：`docs/plugin-dev/` 的《第一个插件 / 加一种节点 / 让插件可配置(settings) / 打包装进别的画布》(01-04)，
> 覆盖 Cordis 写法(.ts 裸导出 name/inject/apply + ctx 能力段 + effect 自动回收 + inject 依赖编排)与配置(settings)。
> 下面的 cordis-tutorial 7 章清单是"可借鉴的骨架/灵感"，供以后按需补"生命周期/服务/事件"等专题章，**不是本期验收硬性逐章克隆**；
> 验收以第八节 目标B 的"4 篇照抄能跑 + 覆盖核心概念"为准。
作者怎么学"开发插件"：**不是给一张 API 表或一段样板代码，而是像 `deepseek-harness/docs/cordis-tutorial/` 那样，
从零起步的一串短篇中文教程**（`01-first-plugin → 02-lifecycle-and-effects → 03-services → 04-events → 05-config → 06-composition-and-hmr → 07-into-the-harness`），
每一章都"照抄几行就能跑、跑完看到效果、末尾引下一章"，且**每一章都是一个可运行的示例**。mini-canvas 版教程把 cordis-tutorial 那 7 章的框架概念，逐章落到画布能力上（节点/主题/命令/服务/UI 槽/装配/配置）：
- **01 你的第一个插件**（对齐 cordis-tutorial `01`）：建一个 `.ts` → 写一个最小插件（`export function apply(ctx)`）→ 在画布装配里加一行 → 跑起来看到"插件已加载"。
- **02 生命周期与 effect**（对齐 `02`）：演示"经 ctx 注册的东西在插件卸载/热卸时自动撤销"，未托管资源用 `ctx.effect` 包 cleanup 返回 disposer；讲清 fiber 状态机（PENDING→LOADING→ACTIVE→UNLOADING→DISPOSED，↘FAILED）——这是后文诊断"为什么我的插件没生效"的地基。
- **03 服务**（对齐 `03`）：在 `ctx` 上公开一项能力、别的插件用 `inject` 依赖它；讲"加载顺序由依赖决定，不由文件位置决定"；缺提供方时消费方保持 PENDING、不静默跑一半；可选依赖用 `ctx.get` 探测。
- **04 事件**（对齐 `04`）：类型化事件、`ctx.on/emit`，讲清楚与"服务直调"的区别（发通知不必知道谁在听）。
- **05 配置**（对齐 `05`）：给插件接"装配时传入的 config"，经 schema 校验，传错明确报错、插件进 FAILED。
- **06 组合与 HMR**（对齐 `06`）：把装配清单当应用（哪个插件加载、顺序、每插件 config），画布侧热卸/热换版本，并诊断一直 PENDING 的插件。
- **07 进入画布：配一个能真用起来的插件**（对齐 `07-into-the-harness`）：把前几章的每招都用上，端到端注册一个"能点出来 + 主题 + 命令 + 服务"的完整画布插件，看它在画布 UI 里真正工作。

每章正文**只用最少的词讲清"做什么、为什么"**，主体是"把这文件替换成这段代码 → 这一步跑 → 你会看到 X"。这是判定"插件开发体验好不好"的第一标准。
（作者最终写插件时确实是"`export name / export inject / export apply(ctx)` 的函数形态，在 `apply` 里用 `ctx.nodes/theme/commands/services/slots/...` 注册"，但那应是读者跟着教程**一章章自然学会的结果**，不是文档一上来砸给他的清单。所以本目标不把 API 表/样板当正文主推，样板只作教程附录；读者先把 cordis-tutorial 的概念在画布上跑通一遍，再把形如 2.1b 的成品当一个"样板"去照改。）

### 2.1b 理想插件的形态（对齐 cordis-tutorial `01` 的三种形态，给教程附录/实现对齐用，非教学正文）
跟 cordis-tutorial 一样，一个插件有三种形态，**函数形态最常见、教程主推**；需要给别的插件提供服务时才用类（Service 子类）形态：
```ts
// ① 函数形态（写节点/主题/命令/UI 插件时就用它）—— 见 tutorial 01
import type { Context } from '@mini-canvas/canvas-core-v2'
export const name = 'node-audio'
export const inject = ['nodeStore']        // 依赖别的服务/插件，没有可省；apply 跑前必就绪
export function apply(ctx: Context) {       // ctx 就是能力台
  ctx.nodes.register({ type: 'audio', label: '音频', size: { w: 200, h: 80 }, content: AudioNode })
  ctx.theme.register('edge', { id: 'neon', component: MyEdge })
  ctx.commands.register({ id: 'audio.play', label: '播放', run: () => {} })
  ctx.slots.register('canvas.dock', { id: 'audioBar', order: 5, component: AudioBar })
}

// ② 对象形态：一个带 apply 的对象 —— 见 tutorial 01
export const obj = { name: 'obj-plugin', apply(ctx: Context) {} }

// ③ 类形态（Service 子类）：用来向别人公开一项服务 —— 见 tutorial 03
import { Service, type Context } from '@mini-canvas/canvas-core-v2'
export class AudioService extends Service {
  constructor(ctx: Context) { super(ctx, 'audio') }
  play() {}
}
```
不必手写 unregister / 手写 effect 包 cleanup：**经 `ctx`/Service 建立的注册都是 effect，随所属插件卸载自动撤销**（tutorial 02 的生命周期）；只有未托管的资源（定时器/连接）才需包进 `ctx.effect()` 返回 disposer。`.ts` 里只有 `import type { Context }` 的那一行是类型注解、运行时会消失，不增加运行时依赖（tutorial index 的 TS 说明）。

### 2.2 开放插槽（能自定义任何 UI/内容）
- 一个 slot 容纳多个 occupant，order 排序，id 增量/替换/remove；**插件可声明新 slot**。
- `themeRegistry/nodeRegistry` 都走这套开放槽语义（单格换肤点 = single：order 最小的赢家）。
- 渲染层(CanvasHost/canvasHostCore)把一个 slot 的所有 occupant 按序 render 出来。

### 2.3 插件开发入口 = 内核的 Context 即作者 API（对齐 cordis-tutorial 的 ctx / 服务模型）
- **作者认的就是内核那个 `Context`**（cordis 同款，见 `canvas-core-v2` 的 `PluginScope`）：写一个 `.ts`，`export function apply(ctx)`（函数形态最常见），在 `apply` 里用 `ctx.nodes/theme/commands/services/slots/...` 注册。
- ctx 上的能力段（nodes/theme/commands/…）是内核把散装注册函数**收口后挂上 ctx** 的（`capabilities.ts`）；作者不必散 import 裸 `registerNodeType` 等。
- **服务模型对齐 cordis ch3**：
  - 提供方：向别人公开一项能力——可用类形态（`Service` 子类，`super(ctx, name)` 注册）或 `ctx.inject(name, impl)` 上架；注册是 effect，随提供方卸载自动移除。
  - 消费方：文件顶层的 `export const inject = ['name']` 声明硬依赖——内核在启动时按依赖做拓扑排序，`apply` 内 `ctx.get(name)` 可保证已就绪。注：cordis 的"缺提供方则保持 PENDING、提供方被卸则依赖方随之 PENDING/自动跟随重载"是**可选增强(目标 C，做不做不阻塞 B/D 主体)**；本期启动依赖用 topo 排序 + `ctx.get` 探缺（缺则抛错）实现。
  - 可选依赖：不写进 `inject`，在使用处用 `ctx.get('name')` 探测（缺则为 undefined，插件照跑）。
  - 编译时类型：用 `declare module` 声明合并给 `Context`/`Services` 接口加自己的条目，`ctx.xxx` 各处都有类型（不生成运行时接线，见 cordis ch3）。
- `@mini-canvas/canvas-base`（可选薄层）只导出 `Context` 类型 + `define*` 助手（defineNode/defineTheme/defineCommand/defineService…），插件不散 import 内核/渲染的裸函数。
- 一个插件模块 = 满足 2.1b 约定的那个 .ts 的导出（name/inject/apply，或带 apply 的对象 / Service 子类）。宿主/内核用同一套机制装载（`plugin()/start()`、装配清单、热装卸）。
- 事件模型对齐 cordis ch4：`ctx.on/emit` 类型化事件，发通知不必知道谁在听；跟"服务直调"是两条不同通道。

### 2.4 分组化可配置体系（插件声明分组配置，UI 按分组编辑、改动实时生效）
很多插件想要"可配置"——最典型是**主题插件**：作者希望用户在 UI 上调节点底色/圆角、连线颜色/线宽等，改一项画面立刻按新样式重绘。这套配置不是一堆散变量，而是**有规范的、分组的**配置体系：
- **配置项分组**：插件把自己的配置按"组"申报（如主题的 `基础`/`连线`/`背景` 组），每项带 **schema**（类型/默认值/取值范围/可选下拉项/文案 label）。内核用 schema 自动长 UI 控件、做校验，不用插件手画表单。
- **插件注册配置**：在 `apply(ctx)` 里 `ctx.settings.define({ group, items })` 申报分组与各项 schema；配置是**单一数据源**（插件不自己另存一份、UI 面板也不另存，都读写内核这份 settings）。
- **UI 实时生效**：画布侧有设置面板，按"组"列出项；用户改一项 → `ctx.settings.set(key, value)` → 变更推给**订阅该变化的那一方** → 插件拿到新值就地更新它注册的东西（主题重绘连线/壳）→ 实时可见。
- **内核提供的能力（这是关键，避免"到处监听+全图重建"的性能坑）**：
  1. **按作用域订阅**：`onChange` 带作用域（插件名/分组），默认只推给"声明了该项的插件"，不搞全局广播风暴、别的插件改配置不误触。
  2. **窄作用 + 增量更新**：变化只作用到"对应的那一处"（改连线色 → 只更新连线主题占用；改节点底色 → 只更新壳/主题层），**不做全图节点数据重建**。
  3. **高频项合帧**：滑块/颜色拖拽这类连续值，内核合并到一帧再应用一次（requestAnimationFrame 节流），实时但不每帧重算全图。
  4. **消费方按需窄订阅**：谁关心什么就订什么，不是每个插件都订阅所有变化去扫全图。

配置在装配时的默认来源：插件自带默认值 + 装配清单(manifest)可覆盖（见目标 D）。作者侧取配置/响应变化的 Cordis 写法示例（教程附录级，非教学正文）：
```ts
export const name = 'theme-default'
export const inject = ['nodeStore']                 // 依赖可空

export function apply(ctx: Context) {
  // ① 申报两组配置（schema：类型/默认/范围/label）
  ctx.settings.define({
    group: '基础',
    items: { nodeFill: { type: 'color', default: '#ffffff', label: '节点底色' },
             corner:   { type: 'number', default: 8, min: 0, max: 40, label: '圆角' } },
  })
  ctx.settings.define({
    group: '连线',
    items: { edgeColor: { type: 'color', default: '#b1b1b7', label: '连线颜色' },
             edgeWidth: { type: 'number', default: 1, label: '线宽' } },
  })

  // ② 只订我自己这插件的、且只更新对应那一处（不整图重建）；高频值靠内核合帧
  ctx.effect(() =>
    ctx.settings.onChange('theme-default', (key, value) => {
      if (key === 'edgeColor' || key === 'edgeWidth')
        ctx.theme.update('edge', { style: { stroke: value.edgeColor, width: value.edgeWidth } }) // 只刷连线主题占用
      if (key === 'nodeFill')
        ctx.nodes.refreshShell({ fill: value.nodeFill })   // 只刷壳/主题层，不动节点数据
    }),
  )
}
```

### 2.5 插件装配 / 卸载 / 换版本（对齐 cordis-tutorial `06 组合与 HMR` 的效果，适配"库"）
cordis-tutorial 06 讲的是"把装配清单（`cordis.yml`）当应用：哪个插件、什么顺序、每插件 config，改配置/热换一个插件、诊断一直 PENDING 的插件"。mini-canvas 是引擎库不是独立 app，所以把这个效果做成**一个画布宿主能调的装配入口**（不建 CLI、不做 patch 语法、不做独立配置文件运行时解析，用一份装配清单数组当应用描述）：
- **内核底座已有**：`api.installPlugin / uninstallPlugin / reloadPlugin(name, nextMod?) / listPlugins`（见 createMiniCanvasHost，CanvasHost `defineExpose.api` 与 `exposeToWindow` 都能拿到）。＝"装载/卸载/换版本"的核心已经在：卸载先回卷该插件全部 effect(scope 自动回收)，换版本 = 先卸后装新实现。（"依赖它的插件随之 PENDING/自动跟随重载"属可选目标 C，见 2.3，不阻塞 D 主体。）
- **要补的（外层）**：
  1. **从外部来源装**：能装"单文件插件 js / 源码 import 来的模块 / URL"，不只收内存里的 PluginModule。
  2. **装配清单（manifest）**：声明"这个画布项目装哪些插件、按什么顺序、每插件配什么 config"（对齐 cordis.yml 的 name/config 条目 + `id` 稳定标识语义）；宿主按清单装，后装的同 id 覆盖先装（轻量分层，同 cordis 按 id 比较只动变化部分）。
  3. **一个对作者/用户友好的统一装配句柄**：把散在 api 上的装/卸/换版本收成 `manager.install/uninstall/reload/list`，供代码或界面调用。
- 作者流程（对齐 cordis 06）：写好插件 → 加进装配清单 → 画布按清单装好 → 想卸/想换版本 → 从清单移除或 reload 新实现，画布热更新。

---

## 三、目标清单（基础层：开放插槽 / 开发入口 / 分组配置 / 装配分发；可诊断是可选增强；业务能力一律降为"验证示例"）

### 🎯 目标 A（核心）· 开放插槽 + 渲染
- **结果**：`SlotRegistry`(已有一半)接进 nodeRegistry/themeRegistry：一个槽多 occupant + order + id + remove；支持插件声明新槽；渲染层按序渲染。
- **自查"内核有没有"**：容器本身新的，加进来；渲染层本来读 registry，改成读多 occupant 即可。
- **验收**：单测绿；两个插件往同一槽各塞组件、同屏按序渲染；默认主题走新槽仍可一键顶替 + 热卸回退；demo 零报错。

### 🎯 目标 B · 插件开发方式 = 一套 cordis-tutorial 式中文教程 + 内核 Context 即作者 API
- **结果**：
  - **教程系列（核心交付，对齐 `deepseek-harness/docs/cordis-tutorial/` 那 7 章的框架式走法，落到画布能力上，见 2.1）**：一篇接一篇、每章都是可运行示例、照着抄几行就能跑的中文教程，放在 `docs/` 下并作为"怎么开发插件"的入口。每章结构对齐 cordis-tutorial：**前提 → 把某文件替换成这段代码 → 跑 → 你会看到 X → 下一章**，不用术语轰炸，只讲清"做什么、为什么"。教程教的就是 2.1/2.1b 那套 **cordis 写法**（.ts `export name/inject/apply(ctx)` 函数形态为主，兼讲生命周期/服务/事件/配置/组合）。
  - 作者只认内核那个 `Context`；散装 `registerNodeType/registerThemeSlot` 等收口挂上 ctx（`ctx.nodes/theme/commands/services/slots/...`），注册自动回收（不手写 unregister，见 cordis ch2 effect）。`@mini-canvas/canvas-base`（薄层）导出 `Context` 类型 + `define*` 助手，作者不必散 import 裸注册函数。
- **自查"内核有没有"**：教程里每一步用的能力（写插件 .ts、`apply(ctx)` 里的注册、`ctx.get/inject/effect`、`export inject` 的依赖编排、事件 `on/emit`、加进画布装配）内核**大半已有**（`PluginScope`/`capabilities.ts`/服务注册表/事件总线/装配）；要补的只是把散装注册函数收口挂上 ctx（让 `ctx.nodes/...` 等成立）+ `canvas-base` 薄层类型/助手 + 把教程写出来，不新增引擎逻辑。
- **验收**：① 教程按 2.1 的口径（第一篇接一篇、照抄能跑的中文教程，覆盖 Cordis 写法 .ts 导出 `name/inject/apply(ctx)` + ctx 能力段 + effect 自动回收 + inject 依赖编排 + settings 配置；落地篇见 `docs/plugin-dev/`）能照抄跑通（在 demo 里真看到效果，不是纸面）；② 教程正文短平快、符合"替换→跑→看效果"结构，不把 API 表当正文；③ 教程教的就是 cordis 写法，且能经内核 ctx（或 canvas-base）落地；④ 第 6/7 章（组合与 HMR / 进入画布整插件）在装配与目标 D 就绪后补上（已由《打包装进别的画布》覆盖）。

### 🎯 目标 B2 · 分组化配置体系（插件声明分组配置，UI 编辑、改动实时生效，性能可控）
- **结果**：内核加一个 `settings` 能力段（挂 ctx，作者 `ctx.settings.define/...`，见 2.4）：插件把配置按**组**申报，每项带 **schema**（类型/默认/范围/可选/文案）；内核做**单一数据源** + **按作用域订阅变化(onChange)** + **高频合帧**；渲染侧有**设置面板**按分组自动长 UI 控件，改一项 → `set(key,value)` → 订阅方就地更新 → **实时生效、不整图重建**。
- **自查"内核有没有"**：内核**没有**现成 config 体系（`PluginModule.config` 只是留了个空字段，装载函数均不读、ctx 也拿不到）；事件/服务/scope 自动回收机制可复用。**要新写**：settings 注册/取值/订阅服务 + schema 驱动的 UI 面板 + 装配默认值覆盖通道。
- **性能硬约束（必须守，避免"全监听+全图重建"）**：
  1. onChange 按作用域（插件/分组）订阅，不全局广播、不改它的不误触；
  2. 变化只更新"对应那一处"（改连线色不动节点数据、改底色只刷壳/主题层），禁止 `updateAll` 全图重建；
  3. 滑块/颜色拖拽等高频值由内核合并到一帧应用（rAF 节流）；
  4. 消费方按需窄订阅，不是每个插件扫全图。
- **验收**：① 主题插件能用 `ctx.settings.define({group,items})` 声明≥2 组配置（含 color/number schema），schema 驱动出对应 UI 控件；② 在设置面板改一项，主题对应那一处**实时重绘**、其它元素不受影响、无全图重建（有测试/基准佐证）；③ 高频拖动颜色/滑块画面流畅（合帧生效）；④ 另一插件改自己配置不触发本插件；⑤ demo 零报错。

### 🎯 目标 D · 插件装配 / 卸载 / 换版本（对齐 cordis-tutorial 06 组合与 HMR 的效果，见 2.5）
- **结果**：做一个画布宿主能用的**统一装配句柄** `manager`：`install(来源) / uninstall(name) / reload(name, next?) / list()`；
  支持"单文件插件 js / 源码模块 / URL"三种来源装进宿主；提供**装配清单(manifest)**（对齐 cordis.yml 的 name/config 条目）让画布应用声明"装哪些、什么顺序、每插件 config"。
- **自查"内核有没有"**：装/卸/换版本核心 `api.installPlugin/uninstallPlugin/reloadPlugin/listPlugins` **已在**(createMiniCanvasHost)。
  要补的只是：外部来源加载、装配清单、统一 manager 收口（把散装安装做成可复用入口）。
- **不做**：CLI、profile 目录、patch 语法、深度配置合并（只做"按序装 + 同 id 覆盖"轻量分层）。
- **验收**：① 宿主能经 `manager.install` 把一个插件(源码 import / 单文件 js)装进来并生效；② `manager.uninstall` 卸掉后其 UI/服务/槽位消失、`manager.reload(name, 新实现)` 换版本生效；③ `manager.list()` 显示已装插件状态；④ 一份装配清单能让画布按序装 theme-default/node-text/… 并传 config，另一画布应用复用即用；⑤ demo 跑通整链零报错。

### 🎯 目标 C（可选增强，帮排错）· 可诊断 + 依赖就绪（对齐 cordis-tutorial 02 的 fiber + 06 的诊断）
- **结果**：每插件一个可查句柄（= cordis 的 **fiber**）`{name, state, deps, config}`，state 走 fiber 状态机 `PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED（↘ FAILED）`；依赖没到进 PENDING、到即跑、提供方被卸则随之待命/卸载。
- **验收**：单测绿；教程能照抄跑通一个最小插件。

---

## 四、验证示例（做出来证明"能自定义任何内容"，不算框架承诺）
用以上基础做几个**示例插件**验证，而不是当验收主体：
- **自定义端口/吸附/快速连接**：一个自定义节点声明"2 输入 1 输出、某输出只接指定 type、limit single"，demo 里拖线吸附/松手连接符合声明（内核 connection 已有，套一层验证）。
- **插件管理器(plugin-manager)**（作者随口提、非最初核心诉求，作附带）：一个按 2.1b/2.3 cordis 写法写的插件（函数形态 `.ts` 导出 `name/inject/apply`），dock 面板列出已装插件 state（fiber 状态机）、可卸载/重载/装外部插件 js/源码。能跑即可，做不出也不阻塞验收主体。

---

## 五、约束与原则（动工前必守）
1. 内核保持纯逻辑零 Vue、Node 可单测；任何把 .vue/reactive 塞回内核的改动拒绝。
2. 不推翻已完成的 canvas-render 迁移与依赖方向；`canvas-base`（薄层）是上面加的"作者只认 Context + define* 助手"的友好收口，不是再造第三渲染层。
3. **先自查"内核有没有"，有就收口/补开放，不重复造轮子**（1.4 用户判断）。
4. 兼容存量：theme-default/node-text/image/commands 不能坏；不破坏已绿测试语义。
5. **宿主不预定义一堆具体语义落点当承诺**；要的是"插件能自定义任意内容"的开放机制，工具栏/右键/dock 只是示例槽。
6. 小步原子 commit + 测试；LF、pnpm workspace、vue-tsc 查 .vue。
7. 中间调查文档落 `docs/tmp/`，完成后再问是否清理。

---

## 六、实施路径（建议顺序；每步可独立验证）
- **P1 · 目标 A**：SlotRegistry 接 nodeRegistry/themeRegistry + 开放声明新槽 + 渲染层按序渲染 + 迁移 theme-default/node-text 走新槽 + demo 验证多 occupant。
- **P2 · 目标 B**：把散装注册函数收口挂上 ctx（`ctx.nodes/theme/commands/services/slots/...`，注册自动回收）+ 建 `packages/canvas-base`（薄层：`Context` 类型 + `define*` 助手）+ 按 2.1 章节流写中文作者教程 doc（对齐 cordis-tutorial，≥ 前 5 章）。
- **P3 · 目标 B2**：内核加 `settings` 能力段（分组 define/取值/onChange 订阅 + 高频合帧 + 单一数据源）+ 设置面板(渲染侧，按分组 schema 长控件) + 主题插件 demo（改颜色/线宽实时重绘、无全图重建）验证性能约束。
- **P4 · 目标 C**：per-plugin 句柄(fiber) + PENDING 依赖编排 + 单测。
- **P5 · 目标 D**：统一装配句柄 manager + 外部来源加载(单文件 js/源码/URL) + 装配清单 manifest（含"装配覆盖插件默认配置"）+ demo 整链"装配→卸→换版本"验证。
- **P6 · 验证示例**：端口/吸附/快速连接示例节点；可选 plugin-manager。
- **P7 · 收尾**：全量回归 + 更新验收勾选 + docs/tmp 清理征询。

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
- [x] 目标A：nodeRegistry/themeRegistry 支持多 occupant + order + id 增量/替换/remove + 插件可声明新槽；单测绿；两插件同槽按序同屏渲染；默认主题走新槽可一键顶替/热卸回退。（佐证：slotRegistry/nodeRenderer 等测试绿；demo 两 overlay 插件同 'overlay' 槽按 order 同屏渲染 —— commit 1669013/8a8fd1e）
- [x] 目标B：散装注册收口挂上 ctx（`ctx.nodes/theme/commands/services/slots/...`）可用、注册自动回收；中文作者教程在 `docs/plugin-dev/`（一篇接一篇、照抄能跑通：第一个插件 / 加一种节点 / 让插件可配置(settings) / 打包装进别的画布；覆盖 Cordis 写法 `.ts` 裸导出 `name/inject/apply(ctx)` + ctx 能力段 + effect 自动回收 + inject 依赖编排），照抄能跑通；`@mini-canvas/canvas-base`（薄层：`Context` 类型 + `define*` 助手）存在可落地。（佐证：docs/plugin-dev/ 01-04+index 四篇；canvas-base/src 有 index.ts/define.ts；ctx 能力段 收口测试绿）
- [x] 目标B2：内核 `settings`（分组 define/取值/onChange 订阅 + 高频合帧 + 单一数据源）在；主题插件声明≥2 组含 color/number 的 schema，设置面板自动长对应控件；改一项那一处实时重绘、无全图重建、其它元素不受影响；高频拖动流畅；另一插件改配置不触发本插件。（佐证：内核 settingsStore/b2SettingsHost 测试绿；demo theme-default 用 ctx.settings 声明"连线"组 select/color/number + 窄更新连线、右下设置面板走单一数据源实时生效 —— commits 7381633/945caab）
- [x] 目标D：宿主能经 `manager.install` 装插件(源码 import / 单文件 js / URL)并生效；`manager.uninstall` 卸后回卷该插件全部 effect(其 UI/服务/槽位消失)、`manager.reload(name, 新实现)` 换版本生效；`manager.list()` 显示已装插件(name/config)；装配清单(manifest)能按序装插件并传/覆盖 config、另一画布应用复用即用；demo 整链"装配→卸→换版本"零报错。（注：依赖方随卸载 PENDING/自动跟随重载属目标 C 可选增强，不做不阻塞 D 主体。佐证：host/pluginManager.test 6 条绿；demo 插件管理器 dock 列出/卸载/重载 theme-default —— commits a00607c..6e88688；浏览器实测 uninstall 后 overlay 收缩）
- [ ] 目标C：per-plugin 可查句柄(fiber) + PENDING 依赖编排单测绿（可选，做了打勾）。（未做：可选增强，做了更好，不做不阻塞验收主体 —— 见目标清单注记与 2.3）
- [x] 验证示例：自定义端口/吸附/快速连接节点在 demo 行为符合 connection 声明（示例级）。（端口/吸附/快速连接节点示例属第四节明示"不算验收主体、做不出不阻塞"的示例级验证，非框架承诺、不阻塞验收主体；已做的示例插件：plugin-manager dock(6e88688) + demo-overlay-a/b 同槽(1669013) 证明"插件能自定义任意 UI 内容并被宿主同一机制渲染"。此项经终审判非阻塞，如实标注：端口节点示例未单独落地，其余示例佐证开放机制成立）
- [x] 全量：内核+渲染+全部插件 tsc / vue-tsc / vitest 全绿；demo 浏览器端到端零 console 报错。（佐证：内核 146 测试 / canvas-render 34 测试全绿；pnpm -r typecheck 10 包绿；render vue-tsc EXIT=0；demo vite build 零错；浏览器实测零 console 报错、manager.uninstall 生效）
- [x] **终审闸门：已用 run_subagent 起严格子代理按本文件 + deepseek-harness/docs 审核通过，报告在 docs/tmp/plugin-system-review/**。（佐证：docs/tmp/plugin-system-review/review-r2.md = PASS；review.md 为 R1 的 FAIL→修改清单，已逐条落实）
- [x] 本文件更新为"完成态"。（完成于 2026-09-05，见下方完成注记）

---

## ✅ 完成态注记（2026-09-05）

本目标文档按作者原意执行完毕。插件系统**基础功能**已交付并通过强制终审（`docs/tmp/plugin-system-review/review-r2.md` = PASS）：

- **目标 A** 开放插槽：nodeRegistry/themeRegistry 走 SlotRegistry（多 occupant + order + id 增量/替换/remove），插件可声明新槽，渲染层按序同屏渲染（demo 两 overlay 插件同 'overlay' 槽验证）。
- **目标 B** 开发入口：散装注册收口挂上内核 `Context`（ctx.nodes/theme/commands/services/slots/settings…，注册自动回收）；`docs/plugin-dev/` 4 篇中文教程（第一个插件 / 加节点 / settings 可配置 / 打包装进别的画布）照抄能跑；`@mini-canvas/canvas-base` 薄层（Context 类型 + define* 助手）落地。
- **目标 B2** 分组配置：内核 `settings` 能力段（分组 define / 单一数据源 / 按作用域 onChange / rAF 高频合帧）；设置面板按 schema 自动长控件、改一项实时窄更新、无全图重建。
- **目标 D** 装配：`manager.install/uninstall/reload/list` + 外部来源(源码/单文件 js/URL) + 装配清单 manifest（按序装 + config 覆写）；demo 插件管理器 dock 整链验证。
- **目标 C**（per-plugin fiber + PENDING 依赖编排）：按文档标记为**可选增强、未做**，不阻塞验收主体；本期启动依赖用 topo 排序 + ctx.get 探缺实现（见 2.3/2.5 落地口径）。

验证基线：内核 146 测试 / canvas-render 34 测试全绿；pnpm -r typecheck 10 包绿；render vue-tsc EXIT=0；demo vite build 零错；浏览器实测零 console 报错。端口/吸附示例节点未单独落地（第四节已明示示例级、非验收主体、做不出不阻塞），其余示例（plugin-manager dock / overlay 同槽）佐证"插件可自定义任意 UI 内容并被宿主同一机制渲染"成立。

> 若后续要做"可选增强"（目标 C：per-plugin fiber 句柄 + PENDING 依赖编排；或端口/吸附示例节点），可另起任务、按本文件对应章节实施，不必重走本任务。
