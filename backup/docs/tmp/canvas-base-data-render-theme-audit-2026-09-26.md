# canvas-base、canvas-data、canvas-render 与 theme-default 架构审查

日期：2026-09-26
范围：

- packages/canvas-base
- packages/canvas-data
- packages/canvas-render
- packages/plugins/plugin-theme-default

审查方式：先读 docs/STATUS.md 和现行分层设计，再用 CodeGraph 检索符号和依赖，最后逐文件核对关键实现。本文是只读调查，没有修改生产代码。

## 结论先说

你的感觉基本正确：canvas-base 现在不是“没用”，而是只有门面，没有足够深度，也没有真正成为插件的唯一入口。

当前系统的主要问题不是某个包单独做错了，而是同一件事有多套入口：

- 插件可以从 ctx.nodes/theme/commands/slots/settings 注册；也可以直接拿 ctx.get；还可以直接用 useCanvasRender、useVueFlow 和旧的 Vue 注入令牌。
- 主题槽同时写入 ThemeRegistry 和通用注册场；节点区域也同时写入 NodeRegistry 和通用注册场。
- CanvasRenderContext、CanvasHostHandle、ctx 都暴露了部分相同能力。
- 默认主题既是主题实现，又被图片、文本、多选插件当作组件库使用。
- canvas-data 既是数据层，又放了画布语义、注册表、能力段和 Context。

所以现在最危险的地方是：代码看起来已经分层，真实的事实源和依赖边还没有完全分层。

## 1. 当前真实结构

### 1.1 依赖方向

当前主要依赖边如下：

    @mini-canvas/kernel
            ↑
    @mini-canvas/canvas-data
            ↑
    @mini-canvas/canvas-render
            ↑
    @mini-canvas/plugin-theme-default

但实际还有这些额外边：

| 包 | 当前依赖 | 说明 |
|---|---|---|
| canvas-base | canvas-data、kernel | 纯 TS 门面；没有 Vue 或 VueFlow |
| canvas-data | kernel | 名字像数据层，实际还包含画布 Context、能力段、主题/节点注册表、连接规则和节点工厂 |
| canvas-render | canvas-data、kernel；peer Vue、VueFlow | 既是渲染层，也是宿主、装配根和第三方 API 门面 |
| theme-default | peer canvas-render、Vue、VueFlow；依赖 canvas-data、kernel、@ckpack/vue-color；canvas-base 只有 devDependency | 主题实现仍直接知道数据层、内核和 VueFlow |

### 1.2 每层实际承担的工作

| 层 | 代码现在承担的工作 | 判断 |
|---|---|---|
| kernel | 插件装载、依赖、事件、作用域回收、注册场、工具 | 边界基本干净 |
| canvas-data | 节点/边/历史/保存/选择 + 画布注册表、能力段、连接校验、节点工厂、画布 Context | 数据和画布语义混在一起 |
| canvas-render | VueFlow 宿主、DOM、视口、坐标、节点布局、主题装配、插件装配、渲染上下文 | 渲染和组合根混在一起 |
| theme-default | 节点壳、边、背景、拖线、设置面板、设计系统组件、部分数据操作 | 主题实现和共享组件库混在一起 |
| canvas-base | 重导出类型、少量运行时 helper、define* 糖 | 有价值，但目前很浅且不完整 |

## 2. 问题清单

严重度说明：P1 会造成运行时错误、状态残留、行为不一致或阻止主题替换；P2 会持续放大耦合；P3 主要是维护成本。

### P1-1：canvas-base 的 defineNode 类型接受字段，但运行时丢字段

证据：

- packages/canvas-base/src/define.ts:14-15 的 DefineNodeDef 继承 NodeRegisterDef，因此类型上允许 icon、resizable、frameless、transparent 等字段。
- packages/canvas-base/src/define.ts:21-37 重新组装 reg 时只传了 type、label、size、description、in、title、inputs、outputs、create。

结果：作者写出的字段能通过 TypeScript，但在运行时被静默丢掉。图片的无边框、节点是否可调整大小等能力都可能因此失效。

建议：defineNode 只做必要的 size 到 defaultSize 和区域归并，其余字段全部透传；NodeRegisterDef 保持唯一字段来源；增加一条每个类型级字段都能从 defineNode 到注册表的测试。

### P1-2：theme 注册场双写，卸载后会留下幽灵条目

证据：

- packages/canvas-data/src/canvas/capabilities.ts:357-369 的 ctx.theme.register 先写 ThemeRegistry，再写 registryOf('theme')。
- 第二次写入返回的句柄没有登记进插件作用域；只有前面的 placeTheme 清理 ThemeRegistry。
- capabilities.ts:370-375 的 ctx.theme.add/remove 只操作 ThemeRegistry，不操作通用注册场。

结果：插件卸载后，主题槽可能已经回退，但 registryOf('theme') 仍然能看到旧条目。诊断、热替换和依赖该注册场的消费者会读到不存在的主题。

建议：选择一个事实源，推荐 registryOf('theme')；ThemeRegistry 改成只读消费适配器，负责映射 winner/occupants；所有 register/add/remove 都走同一条路径，统一 id、order、source 和 dispose；加测试锁住注册、替换、remove 和插件卸载。

### P1-3：nodes.contribute 的两张表可能采用不同 order

证据：

- packages/canvas-data/src/canvas/capabilities.ts:269-294 先在 registryOf('node/region') 自己计算 order，而且没有使用 opts.order。
- capabilities.ts:295-308 再把原始 opts.order 传给 NodeRegistry.registerContribution。
- BaseNode 会合并基座、段级贡献和 node/region 条目。

结果：同一个贡献在两张表里排序不同。最终页面顺序可能和注册者声明的不一样，热卸后顺序也可能改变。

建议：只保留一张规范注册场；过渡期先解析一次 id/order，再把同一份结果传给兼容适配器；用两个插件、显式 order、同 id 替换和卸载回退测试锁住顺序。

### P1-4：theme-default 的 inject 声明和真实运行依赖不一致

证据：

- packages/plugins/plugin-theme-default/src/index.ts:46-53 声明 inject=[]。
- BaseNode.vue:48-51 在组件挂载时依赖 useCanvasRender、VueFlow 和上下文。
- useNodeCapability.ts:19-24 直接读取 ctx.get('doc')。
- CustomEdge.vue:182-188 读取 command 和 doc。

结果：插件装载时会显示 ACTIVE，真正渲染组件时才因缺少服务而失败。依赖检查无法提前发现问题。

建议：主题插件声明真正需要的渲染环境，或由宿主提供明确的 render contract；组件不要自己用 ctx.get 猜服务形状；明确主题能否在无数据服务的极简宿主中运行，并用测试固定。

### P1-5：theme-default 不是只依赖 canvas-base，且主题被业务插件反向依赖

证据：

- packages/plugins/plugin-theme-default/package.json:21-24 声明 peer canvas-render、Vue、VueFlow。
- package.json:37-40 运行时依赖 canvas-data、kernel、@ckpack/vue-color。
- 主题源码直接 import canvas-render、canvas-data、kernel 和 Vue。
- plugin-node-image、plugin-node-text、plugin-node-video 直接依赖 theme-default。
- plugin-multi-select/SelectionFrame.vue:47 直接从 theme-default 引入 MovingHandle 和 ConnectionLine。
- theme-default/src/index.ts:680-693 主动导出这些渲染件。

结果：替换默认主题会牵连业务插件；业务插件不能脱离默认主题运行。主题已经不是可替换实现，而是事实上的共享基础库。

建议：主题只实现并注册主题槽，不作为业务插件的组件库；把 MovingHandle、ConnectionLine、通用按钮/下拉等拆到独立的 render contract 或标准渲染适配包；业务插件只依赖 canvas-base，必要时依赖稳定 render contract，并把 Vue 作为 peer dependency；禁止业务插件依赖 plugin-theme-default。

### P1-6：端口默认值仍有两套来源

证据：

- packages/canvas-render/src/host/canvasHostCore.ts:297-305 的宿主默认 portZoneWidth=86、heightRatio=.8、arcRatio=1。
- packages/plugins/plugin-theme-default/src/index.ts:84-92 的主题默认是 portZoneWidth=10、heightRatio=.55、arcRatio=.8。
- docs/STATUS.md 已明确记录这个漂移。

结果：不同启动路径、不同主题或不同设置恢复顺序可能得到不同端口几何。它会改变连接命中行为，不能当作普通配色差异处理。

建议：选一个规范来源，推荐放在 render contract 的默认配置中；主题只能覆盖样式，不再复制交互几何默认值；端口几何单独做行为变更和浏览器回归。

### P2-1：canvas-render 的上下文过大，并且与 host、VueFlow API 重复

证据：

- packages/canvas-render/src/contracts/renderContext.ts:42-107 同时暴露 ctx、host、registry、写回、外观、连接反馈、交互、调试、吸附、DOM、视口、节点快照、坐标转换和视觉写入。
- CanvasHostHandle 在 createMiniCanvasHost.ts:87-119 又摊平一批相同服务。
- 组件还可以直接调用 useVueFlow，同时又能从 render context 取 viewport、screenToFlow 和 flowToScreen。
- CanvasSurface.vue:205-211 还同时提供旧的六个 InjectionKey。

结果：插件作者不知道该用哪个入口。上下文很强，但接口面太大；任何改动都可能影响很多组件。

建议拆成三层：CanvasPluginContext（数据服务、注册场、命令、事件、作用域）、CanvasRenderFacade（视口、坐标换算、节点视觉更新、DOM 锚点）、VueCanvasBridge（只有 Vue 组件使用的 provide/inject 和生命周期辅助）。CanvasHostHandle 只给宿主。

### P2-2：VueFlow API 尚未真正进入插件上下文

证据：

- packages/canvas-render/src/vueFlowBridge.ts:15-31 只精选导出 Handle、Position、路径工具、useVueFlow、useConnection 和少量类型。
- BaseNode 和 DefaultBackground 仍直接调用 useVueFlow。

结果：用户想要“上下文里可以使用 VueFlow API”，现在得到的只是一个 import 门面，而不是上下文能力。组件仍绑定 VueFlow 的组合式调用方式。

建议：不要把原始 VueFlow 实例塞进通用 Context；在 render contract 中定义稳定的 CanvasFlowApi，包括 viewport、坐标转换、fitView、zoom、updateNodeVisual、updateNodeInternals、实例级事件和 DOM 查询；canvas-render 在 CanvasSurface 中实现并挂到 ctx.render.flow；useVueFlow 只留给 render 内部或明确标记的逃生口。

### P2-3：服务类型靠插件自己 cast，容易出现同名不同形状

证据：

- packages/kernel/src/types.ts:115-119 的 Services 是空接口。
- PluginScope.get 在 types.ts:194-214 只有字符串和泛型，调用方可以任意指定返回类型。
- theme-default 多处写 ctx.get<{...}>；其它插件又自行 declare Context.doc、viewport、nodeLayout。

结果：TypeScript 可以通过，但不同插件对同一个服务的理解可能不一样；重命名或改方法时只能靠运行时发现。

建议：在 canvas-base 提供集中 CanvasServices 映射，并给 get/tryGet 增加按服务名推导返回值的重载。未知扩展服务仍允许声明，但只能有一个公开声明位置。

### P2-4：canvas-data 不是纯数据层

证据：

- packages/canvas-data/src/index.ts:4-10 自称数据层，却导出整个 canvas/。
- canvas/capabilityLayer.ts:4-10 管理 slots、settings 和能力段。
- canvasBasePlugin.ts:2-20 建立基础服务和画布命令。
- canvas/capabilities.ts:8-16 同时实现节点、主题、命令、槽和设置注册。

结果：headless 数据消费者也会看到画布 UI 语义；未来云端、MCP 或协同数据模型要么重复实现，要么被迫依赖渲染概念。

建议分成两个概念包，先不急着改目录：canvas-data 只保留节点、边、文档、历史、选择、保存、资源和纯连接规则；新增 canvas-foundation 承载 Context、注册场、节点类型/主题/命令/槽/设置契约和基础装配。迁移期间可由 canvas-data 重导出 foundation。

### P2-5：canvas-base 自引用，且 define* 没有真实生产消费者

证据：

- packages/canvas-base/src/define.ts:11-12 从 @mini-canvas/canvas-base 自己导入类型。
- 全仓生产代码没有 defineNode、defineThemeSlot、defineCommand、defineSlot 的实际调用，当前只有定义文件和文档语境。

结果：自引用会增加独立打包和类型解析的疑惑；define* 的维护成本目前没有对应收益。

建议：先把自引用改成包内相对类型或内部 contract 文件；define* 要么补真实示例和测试成为推荐入口，要么先降级为可选糖，不继续增加更多 helper。

### P3-1：第三方依赖边界没有按角色说明

theme-default 的 @ckpack/vue-color 属于主题内部实现，可以保留在主题包。问题是主题同时承担共享 UI、节点壳和业务插件公共依赖，第三方依赖的影响面被放大。

建议把包角色写清楚：基础契约包零 Vue、零 VueFlow、零具体 UI 库；渲染实现包可以 peer Vue/VueFlow，但不向业务插件泄漏原始 VueFlow 类型；主题包可以使用具体 UI 第三方库，只负责实现主题槽和设计系统目录；业务插件不依赖主题包。

## 3. 对理想插件状态的判断

理想插件应该能做到：

    import type { CanvasPlugin } from '@mini-canvas/canvas-base'

    export const plugin: CanvasPlugin = {
      name: 'plugin-example',
      inject: ['doc', 'command'],
      apply(ctx) {
        ctx.nodes.register({ type: 'example', label: '示例', size: { w: 240, h: 120 }, in: ExampleView })
        ctx.nodes.attach('*', {
          id: 'example-toolbar',
          region: 'out:top',
          component: ExampleToolbar,
          needs: ['node', 'zoom'],
        })
        ctx.commands.register({
          id: 'example:run',
          keys: ['Enter'],
          when: run => run.canRun,
          run: run => run.execute(),
        })
        ctx.slots.register('overlay', { id: 'example-overlay', component: ExampleOverlay })
      },
    }

这段代码背后需要满足四条规则：

1. 注册动作返回统一句柄，包含 id、source、order 和 dispose；插件卸载后自动清理。
2. 数据通过类型化服务拿，通用能力通过 needs 获取；组件不自行寻找一堆服务。
3. 快捷键就是命令的一部分，不再另造 shortcut API。
4. 渲染能力通过可选的 render facade 获取，原始 VueFlow 不进入基础上下文。

## 4. 推荐的上下文形状

### 4.1 稳定的插件上下文

建议把当前分散的入口收成一个稳定契约：

    interface CanvasPluginContext {
      on(name: string, handler: (...args: unknown[]) => void): Disposable
      emit(name: string, ...args: unknown[]): void
      effect(fn: () => Disposable | void): Disposable
      state<T>(initial: T): { value: T }
      get<K extends keyof CanvasServices>(name: K): CanvasServices[K]
      tryGet<K extends keyof CanvasServices>(name: K): CanvasServices[K] | undefined
      registryOf<K extends RegistryKind>(kind: K): RegistryFor<K>
      nodes: NodeRegistrationApi
      theme: ThemeRegistrationApi
      slots: SlotRegistrationApi
      commands: CommandRegistrationApi
      settings: SettingsApi
      render?: CanvasRenderFacade
    }

### 4.2 VueFlow API 应该怎样回来

不要把 VueFlowInstance 原样放进 canvas-base。这样会让基础包被 Vue、VueFlow 和具体版本绑定。

建议只暴露项目真正需要的稳定能力：viewport、screenToFlow、flowToScreen、fitView、zoomIn、zoomOut、zoomTo、setViewport、updateNodeVisual、updateNodeVisualSize、updateNodeInternals、queryNodeEl，以及必要的实例级事件。

实现放在 canvas-render；组件侧的 useCanvasRender 只是把这个 facade 和 Vue 生命周期接起来。原始 useVueFlow 只留给 canvas-render 内部或明确标记的逃生口。

### 4.3 自有 API 应该放哪里

| 能力 | 归属 | 插件看到的形状 |
|---|---|---|
| 节点/边/事务/撤销/保存 | canvas-data | ctx.get('doc') 的类型化 facade |
| 节点类型、节点区域、主题、UI、命令 | canvas-foundation | ctx.nodes/theme/slots/commands |
| 视口、坐标、DOM、视觉位置/尺寸 | canvas-render | ctx.render |
| 节点按钮所需的 node/zoom/selected/tools | render capability registry | needs + useCapability |
| 主题换肤组件 | 主题插件 | registryOf('ui') 或 theme slot |

## 5. canvas-base 应该是什么

### 5.1 正确定位

canvas-base 应该是作者 SDK 和稳定类型入口，不是运行时宿主，也不是 VueFlow 包装器。

它应该提供：

- 插件模块类型和生命周期类型。
- 类型化服务表和注册场表。
- 节点、主题、插槽、命令、设置的声明类型。
- render facade 的 opaque 类型声明。
- 可选的 define helper。

它不应该提供 Vue 或 VueFlow 运行时、CanvasHostHandle、默认主题组件和具体第三方颜色选择器、编辑器或图标库。

### 5.2 “插件只依赖 canvas-base”需要分两类说

“所有插件都只依赖 canvas-base”在技术上不能完全成立，因为一个包含 Vue 组件的插件必须有 Vue 运行时。正确规则是：

| 插件类型 | 推荐依赖 |
|---|---|
| 逻辑/数据插件 | canvas-base；其它业务库按需依赖 |
| 组件插件 | canvas-base + peer Vue + 一个稳定的 render contract |
| 主题实现插件 | canvas-base + render contract + peer Vue；可在内部使用第三方 UI 库 |
| canvas-render 宿主 | canvas-data/foundation + Vue + VueFlow |

业务插件不应直接依赖 plugin-theme-default；主题替换时，业务插件仍然应该能运行。

## 6. 推荐改造顺序

### 阶段 0：先锁事实源和失败行为

优先修三个 P1：修 defineNode 丢字段；修 theme 双写和卸载幽灵条目；修 nodes.contribute 的 order 双源。每项先补失败测试，再改最小代码。这个阶段不改包名、不移动目录，风险最低。

### 阶段 1：确定唯一插件上下文入口

1. 在 canvas-base 增加 CanvasServices、RegistryKind、CanvasPluginContext 类型。
2. 给 ctx.get 增加按服务名推导返回类型的重载。
3. 把 render 的 nodeLayout、viewport、flow 类型集中到一个 contract 文件。
4. 保留旧入口一段迁移期，但新代码和教程只允许使用新入口。

### 阶段 2：拆小 render context

1. 从大 CanvasRenderContext 中抽出 CanvasFlowApi、CanvasDomApi、CanvasInteractionState。
2. CanvasHostHandle 只给宿主，不再当插件上下文使用。
3. 默认主题改成只调用 render facade，不直接 useVueFlow。
4. 逐步删除旧六个 InjectionKey，最后只留兼容层。

### 阶段 3：拆主题和共享渲染件

1. 把 MovingHandle、ConnectionLine、通用 UI 组件移到标准 render-adapters 包，或只通过注册场提供。
2. 删除业务插件对 theme-default 的依赖。
3. theme-default 只注册 nodeShell、edge、background、connectionLine、settingsPanel 和 UI 目录。
4. @ckpack/vue-color 只留在主题或颜色适配包内部。

### 阶段 4：拆 canvas-data 的语义层

1. 先建立 canvas-foundation 兼容出口。
2. 把 Context、能力段、注册表和画布注册契约逐步迁入 foundation。
3. canvas-data 保留数据、保存、历史、选择和纯连接规则。
4. 迁移完成前由 canvas-data 重导出，避免一次性打断插件。

### 阶段 5：统一默认值和验证

1. 端口几何只留一份默认值。
2. 增加包依赖守卫：业务插件不能依赖 theme-default；theme-default 不直接暴露 VueFlow 给业务插件。
3. 增加真实插件样例：注册节点、区域、槽、命令和能力，并验证卸载后全部回收。
4. 跑各包测试、typecheck、UI e2e，并用“替换主题后业务插件不改代码”的浏览器用例验收。

## 7. 验收标准

改造完成后，至少应满足：

- 一个逻辑插件只需要 canvas-base 就能声明节点、槽、命令、快捷键和配置。
- 组件插件不直接 import @vue-flow/core；它使用 typed render facade。
- theme-default 卸载后，所有主题槽、UI 目录和能力注册都消失，没有幽灵条目。
- 同一注册动作只有一个事实源，id/order/source/dispose 一致。
- 业务插件不依赖 theme-default，替换默认主题不会修改业务插件代码。
- ctx.get('doc')、ctx.get('viewport') 等服务有集中类型，不再由每个插件手写 cast。
- canvas-data 可以在没有 Vue 和 VueFlow 的环境中独立测试和使用。
- 端口默认值、主题默认值和设置恢复顺序只有一份可追踪来源。

## 最终判断

canvas-base 值得保留，但要从“重导出 + 几个糖”升级成稳定的作者契约。它不应该吞掉 VueFlow，也不应该把所有真实运行时都塞进自己；它要做的是让插件只学习一套类型化注册和服务接口。

canvas-render 需要继续负责 VueFlow 和 DOM，但应通过窄的 render facade 向外提供能力。canvas-data 需要逐步收回纯数据职责，画布语义放到 foundation。plugin-theme-default 应该是可替换的默认实现，而不是业务插件的公共依赖。

最先做的三件事就是：修正注册场的双写生命周期、修正 defineNode 字段丢失、收紧并类型化 render/context 入口。做完这三件，后面的拆包和主题替换才会有稳定基础。
