# Goal A 阶段笔记（供后续 round 复用）

> 目标文档 `docs/goal/plugin-system-goal.md`；本文档记录已做决定/已完成/待办，防上下文压缩丢失。

## 已确认设计（与 deepseek-harness 对齐后）
- mini-canvas 的"开放插槽" = 基于已存在的 `SlotRegistry`（multi-occupant + order + id），
  themeRegistry 已改造为基于它（见下）。dsh 里 slot 属 web UI React 拼装（kind=single/list/keyed/chain），
  mini-canvas 走子集语义：单格换肤点取 `winner()`(order 最小)，可叠加装饰层取 `occupants()` 按序全量。
- 插件最终形态（Goal B 目标）＝ .ts 裸导出 `name/inject/apply(ctx)`；ctx 上挂 nodes/theme/commands/services/slots 能力段。
  现在 PluginModule 是 `{name,deps,setup(ctx)}`，散装 `registerNodeType/registerThemeSlot` 是 ctx 外的独立函数 —— 待收口到 ctx。
- registerNodeType/registerThemeSlot 返回 revoke 经 `ctx.effect` 挂插件 scope → 热卸自动回收（已具备，别重复造）。

## 已完成
- themeRegistry 基于 SlotRegistry 多 occupant：`addOccupant/removeOccupant/occupants(按order)/winner/hasOccupant/occupantIds`，
  旧 `register/get/unregister/set/has/slots` 语义不变（读写 default occupant order=0，register 重复抛错）。
  文件: `packages/canvas-core-v2/src/core/registry/themeRegistry.ts`（私有字段名 `reg`，勿与 slots() 方法重名）。
  commit: f75d044。内核测试 124 绿、canvas-render 25 绿、全仓 typecheck 绿。
- 关键：canvasHostCore `assembleTheme` 与 CanvasHost `applyTheme` 读 `theme.get(...)` = 现在即 `winner()`，
  且 CanvasHost 订阅 ctx:plugin-installed/uninstalled → applyTheme 重跑。所以**主题一键顶替/热卸回退已端到端生效，无需改渲染层**。
  验证方式：两插件 `registerThemeSlot(ctx,'nodeShell',A)`(默认) + `addOccupant('nodeShell',{id,order:-1,component:B})` → B 顶 A；卸 B → 回 A。
- nodeRegistry 段级多 occupant（开放叠加槽）：`registerContribution/unregisterContribution/contributionIds/contributionOccupants`
  + nodeRenderer `nodeSegmentStack`(基座+全部贡献按序) / activeSegments 纳入仅贡献段；SlotRegistry 加 `clearByPrefix`。
  基座单值 API 不变。commit: b67ef10。内核 128 绿。
- **ctx 能力段收口**（Goal B 关键一步）：`core/capabilities.ts` `buildCapabilities(ctx,pluginName)` 产出
  `ctx.nodes.register / ctx.theme.register(add/remove) / ctx.commands.register(has) / ctx.slots.register(remove/occupants)`，
  每个注册 revoke 经插件 scope effect 自动回收（作者不手写 uninstall）。PluginScope extends PluginCapabilities，
  Context.deriveScope 给每插件挂能力段；根 Context 也挂（宿主可用）。Context 内置 slots 槽容器：`ctx.get('slots')` 恒可读
  （不是 services map 成员，故 injectedServices() 空断言不变），字段 `builtinSlots`。
  commit: 57e068b。内核 134 绿（+6 能力段单测）、canvas-render 25、全仓 typecheck 绿。
- 插件形态现状：现同时支持 `{name,inject,apply(ctx)}`(Cordis 新式，apply 优先) 与 `{name,deps,setup(ctx)}`(旧式兼容)。
  topoSort 认 inject(knownServices 排除宿主注入服务)；runPlugin(mod,ctx) 分发。commit: c8b303e(内核 137 绿)。
- @mini-canvas/canvas-base 已建：重导出 Context 类型 + PluginModule 等 + define* 助手(defineNode/defineThemeSlot/defineCommand/defineSlot)，
  每个 define 返回 {name,inject,apply}。commit: 19ce99d。
- plugin-node-text 已迁 Cordis 式(name/inject/apply + ctx.nodes.register，import Context from canvas-base)，保留 nodeTextPlugin 对象出口；
  服务 addTextNode/editText 行为不变。canvas-render 25 绿复验通过。
- 教程 docs/plugin-dev/：index + 01-first-plugin + 02-add-a-node(对齐 dsh basic；第3/4篇待 B2/D 后补)。commit: ae78542。
- node-image / canvas-commands / theme-default 迁 Cordis 式(name/inject/apply + ctx.nodes/theme/commands)，commit 500a225。
  4 存量插件全用 ctx 能力段；canvas-render 集成 25 绿复验。
- 目标 B2 内核 settings 能力段(commit 8393305)：SettingsStore(define/set/get/onChange(scope)/groups；越界夹取、同key抛错、
  按作用域订阅不误触)；ctx.settings 挂根与插件 scope，define 记声明插件 scope；host/插件共享 ctx.get('settings')。内核 143 绿。
- B2 设置面板 UI：render 新增 PluginSettingsPanel(schema 驱动: 读 SettingsStore.groups()/groupOf() 按 type=color/number/
  boolean/select/text 长控件, 改即 settings.set, onChange 订阅刷新)；settingsPanelTypes.ts 独立 .ts 导出 SettingsPanelSource
  (plain tsc 不解析 .vue 具名导出)；render index 导出组件+类型; tsconfig.vue.json include 扩 src/**/*.vue。宿主级验收测试
  b2SettingsHost.test.ts 2 条(改 edgeColor 只刷 edge 样式无重建 / 另一插件改自己不误触)。commit dd206a6。内核 145 绿。
- B2 demo 接线(commit 7381633)：theme-default 在 apply 用 ctx.settings.define 申报'连线'(select/color/number)+
  '连线动效与箭头'(boolean)两组(导出 DEFAULT_THEME_EDGE/EDGE_SETTING_KEYS, 默认对齐引擎); CanvasDemo 于 ready 后取
  host.ctx.get('settings') 喂 PluginSettingsPanel(右下浮层), 订阅 set 变更只把 theme 声明的 edge 键窄更新到 cfg.edge 对应
  字段 → Vue 只重绘受影响连线、无全图重建; SettingsPanel 去掉'连线'组(改由插件面板接管), 保留浮动端口调试。全仓 typecheck/demo vite build 绿。
- Goal A 渲染收口(commit 8a8fd1e)：CanvasHost 读通用 UI 槽 'overlay'——插件 ctx.slots.register('overlay',{component,order})
  塞画布浮层, 宿主 onMounted + ctx:plugin-installed/uninstalled 时重读 slots.list('overlay') 按 order markRaw 渲染到
  .chost-overlay(absolute 铺满、默认不挡交互)。tsc/vue-tsc 绿、render 25 绿。
- demo overlay 两插件(commit 1669013)：demo-web/overlayPlugins.ts 定义 demo-overlay-a/b 各 register 'overlay' order 0/1
  渲染左上/左下角标; CanvasDemo coldPlugins 末尾加入 → 同槽按序同屏渲染(Goal A 渲染验收示例)。demo vite build 绿。

## 待办（下几轮）
- 中文教程 doc 第 3 篇(可配置，依赖 B2 已完成) / 第 4 篇(依赖 D)。
- Goal C: per-plugin 句柄 {name,state,deps,config} + PENDING 依赖编排。
- Goal D: manager 统一安装句柄 + 外部来源 + manifest。
- P6 验证示例；P7 全量回归 + run_subagent 终审。
- [done] Goal A 渲染按序(CanvasHost overlay 槽 + demo 两插件同屏, 8a8fd1e/1669013)。

## 验证命令
- 内核: `cd packages/canvas-core-v2 && pnpm vitest run && pnpm typecheck`
- 渲染: `cd packages/canvas-render && pnpm vitest run`
- 全仓: `pnpm -r typecheck`；demo 起 5199: `cd packages/canvas-core-v2 && pnpm dev`
