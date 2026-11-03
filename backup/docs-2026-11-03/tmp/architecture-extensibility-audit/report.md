# v2 渲染架构 —— 可扩展点 / 渲染无关性 只读审计报告

- 审计人：code-developer（架构审计子代理）
- 日期：2026-09-06 · 分支：当前所在分支（只读，未改任何文件）
- 审计面：`packages/canvas-core-v2/src/**`、`packages/canvas-render/src/**`、`packages/plugins/**`
- 参照：`packages/canvas-core/src/**`（v1 老架构的"金标准"注册体系，做差距对照用）
- 意图文档：`docs/goal/plugin-system-goal.md`、`docs/plan/canvas-render-bare-ctx-plan.md`、`docs/plan/slot-host-plan.md`、`docs/adr/0001-*.md`、`docs/tmp/canvas-render-plugins-audit/report.md`（前置审计）

行号以审计当下文件为准。严重度：高 / 中 / 低 / 信息。

---

## 一、核心结论（TL;DR）

**1. 内核 `canvas-core-v2` 渲染无关性干净，方向正确，但偏"渲染前段"而非"渲染可换"完整。**
- 依赖方向 `kernel → render` 单向无环成立：内核零 `import *.vue` / 零 Vue 运行时（已核对 `src/**`，只 `env.d.ts` 是 .vue shim）。组件句柄在内核一律 `opaque`（`NodeRegistry/ThemeRegistry/SlotRegistry` 只存 `unknown` 值，浏览器侧喂 .vue、测试喂 stub）。
- 但"核心逻辑"目前只覆盖了**数据/状态/命令**这一侧；**图结构里"边(edge)"根本没有进内核**——`CanvasHost.vue:247` 自认"边目前是 VueFlow 视觉态(未落盘)——内核尚无 edge store"，`connection.ts` 只有校验。换 canvas 渲染时，**边的数据与历史/撤销/持久化是真空缺**，这是"换后端"最大的隐性坑（见 §三.2）。

**2. 你点名的那些 UI/能力，v2 比 v1 严重退步了"首类扩展机制"，只剩"通用槽 + demo 手写"。**
- v1（老 `packages/canvas-core`）有**类型化的 `MenuRegistry` / `ToolbarRegistry`**（`registry/MenuRegistry.ts`、`registry/types.ts`），支持按区域 `pane/node/connection/edge` 过滤、`areas/nodeTypes/visible/disabled/order/group/danger/shortcut`、动态 `resolveMenuItems` 合并创建类与操作类条目。
- v2（你现在的三件套）**没有等价物**：右键菜单被压成一个 `emit('context-menu',{kind,x,y})` 事件，菜单怎么建、建哪些条目、图标/禁用/分组全推到**宿主应用**（demo `CanvasDemo.vue:231-237` 手写一个 `v-if` 的 `.ctx-menu`）。设置面板、插件管理器 dock、工具栏、右键菜单、历史/项目管理**全部是 demo 层的裸 Vue 组件**，不是可被插件扩展的槽。→ 见 §二 A 列 + §三.1。

**3. "本该做成可扩展点"的，现状分三档：**
- ✅ **已是好扩展点**：`ctx.theme`（nodeShell/edge/background/edgeDefaultType/connectionLine）、`ctx.nodes`（content/title/top-toolbar/bottom-toolbar 段 + 段内叠加槽）、`ctx.slots`（任意字符串 UI 槽）、`ctx.commands`、`ctx.settings`。多 occupant + order + id 替换 + 热卸回退都做好了。
- ⚠️ **有通用机制但没建"语义落点"**（用户/宿主不知道往哪塞）：右键菜单、全局工具栏、各类面板/菜单——只有 `slots` 这口裸锅，没有像 v1 那种"菜单项定义(area/nodeType/visible)"的约束，谁都能塞但没准入规则、渲染要宿主自己找。
- ❌ **渲染层写死、宿主不背锅但也没下沉内核**：单壳 BaseNode 只支持"1 进 1 出固定左右端口"（硬编码 `Position.Left/Right` 两个 MovingHandle，`BaseNode.vue:153-176`），多端口/自定义端口布局的节点**做不出来**；键盘 Delete/Undo/Redo 硬编码在 `CanvasHost.vue:251-269`（这是"渲染层通用的交互"，本可抽象）；节点/边**外观参数是 props 注入 `cfg.edge/cfg.handle`**，不是内核可扩展条目。

**4. 未来换 canvas 渲染的可行度：中高，但被"边无 store"和"CanvasHost 把交互/菜单/面板决策写死"拖累。** 详见 §四。

---

## 二、可扩展点现状总表

> 表格里的"现在在哪层"三层：**内核**(canvas-core-v2) / **渲染宿主**(canvas-render 的 CanvasHost/CanvasSurface/core) / **demo/应用**(CanvasDemo.vue 等消费方)。

| 能力 | 现在在哪层 | 是否可扩展(内核 ctx.*/theme槽/registry段) | 是否写死（文件:行） | 建议做成的扩展形态 |
|---|---|---|---|---|
| **节点内容段 content/title/top/bottom-toolbar** | 内核声明(registry) + 主题壳渲染 | ✅ `ctx.nodes.register` → NodeRegistry 段 + 段内叠加槽 | 否 | 已好。每 type 一段一壳，段可叠加多 occupant |
| **节点壳外观 nodeShell**（卡片/端口/选中环/LOD/就地改名） | theme 槽 + theme-default 插件实现 | ✅ `ctx.theme.register('nodeShell')`，single 赢家 | **壳内写死"单进单出左右端口"**：`BaseNode.vue:153-176` 硬编码 2 个 MovingHandle + `Position.Left/Right` | 壳做成"端口声明驱动渲染"：数据里声明 inputs/outputs，壳按声明生成 handle 位；否则多端口节点做不了 |
| **边外观 edge** | theme 槽 + theme-default 的 CustomEdge | ✅ `ctx.theme.register('edge')` single | 边**数据不在内核**（`CanvasHost.vue:247`"视觉态未落盘"）；外观参数走 props 注入 `edgeVisual` | edge 外观已是可扩展；**边数据/撤销/持久化需下沉内核**（见 §三.2） |
| **画布背景 background** | theme 槽 | ✅ | 否 | 已好 |
| **建边默认类型 edgeDefaultType** | theme 槽(字面值) | ✅ | 否 | 已好 |
| **节点外观参数(端口尺寸等 handle)** | CanvasHost props | ⚠️ 部分：`handleVisual` props 注入，BaseNode 读 `handleParams` | `CanvasHost.vue:73-76/127-134`、`BaseNode.vue:105` | 归到 settings/theme 语义值槽，而非硬 props；否则"第二宿主换另一套壳"还得重传全字段 |
| **右键菜单(context-menu)** | demo 层 | ❌ 无菜单项抽象；只有 `emit('context-menu')` | `CanvasHost.vue:89-91,272-280` 只透事件；**`CanvasDemo.vue:231-237` 手写菜单 UI+条目** | 造 v1 式 `MenuRegistry`(area/nodeType/visible/order 约束)或 `ctx.menus` 段；宿主渲染条目 |
| **节点上下文动作(在节点上点的操作)** | 无专门抽象 | ❌ | demo 右键菜单里三个硬编码动作 `CanvasDemo.vue:232-236` | 归入 menus(nodeType 过滤) 或 node top/bottom-toolbar 段已可承载部分 |
| **全局操控栏/toolbar** | demo 层 | ❌ 只有 `ctx.slots` 裸锅；demo 手写 `.toolbar` | `CanvasDemo.vue:181-188` | v1 有 `ToolbarRegistry`(position/group/nodeTypes)；v2 建议重建或明确给宿主预留标准槽 `slots.register('app.toolbar')` |
| **设置/配置面板** | 内核 settings + 渲染 PluginSettingsPanel + demo 接线 | ✅ `ctx.settings`(分组 schema) 是好机制 | **面板接线写死 demo**：`CanvasDemo.vue:195-197`；render 无默认槽/无 `settingsSourceFrom` | render 加薄导出 `settingsSourceFrom(ctx)` 或 `CanvasSettingsSlot`，让宿主一行接面板（见前置审计 #6） |
| **插件管理器 dock(历史/卸载/重载/诊断)** | demo 层 | ⚠️ 底层 `manager.list/diagnose` 好，但 UI 全在 demo | `CanvasDemo.vue:200-212`；`manager.diagnose` **无任何生产调用** | CanvasHost 在 boot 后 emit 'boot-warning' 或内置状态条；UI 用 `ctx.slots` 槽位化 |
| **快捷键(keyboard Delete/Undo/Redo)** | 渲染宿主硬编码 | ⚠️ 逻辑在内核 command 好，但**键绑定+判定写死在 CanvasHost** | `CanvasHost.vue:251-269`（含输入框豁免、Delete/`Ctrl/Cmd+Z`/Shift 分支） | 下沉内核为"命令×快捷键注册表"(ctx.shortcuts 或 v1 useCanvasShortcuts 那套)，再被渲染层读 |
| **历史记录菜单** | 内核 history 服务 | ✅ 数据在 `history`；**但无"历史列表/回放到某步"的 UI 或事件** | 只 `canUndo/canRedo` 布尔给 UI（`CanvasHost.vue:167-168/201-202`） | history 已是内核服务；如需"历史面板"走 ctx.slots 槽 + 内核补 list/snapshot 读 |
| **项目管理菜单(打开/保存/另存/清单)** | 无 | ❌ 无项目级抽象 | save 服务有 key 分区(`save.set(key,type)`)但无项目枚举/切换 | 若需要，是 app 层/内核 SaveService 上层；非画布内核职责，建议留在宿主 |
| **多 occupant 通用 UI 槽 slots** | 内核(ctx.builtinSlots) + SlotHost 渲染 | ✅ `ctx.slots.register(slot,…)` 任意字符串 | overlay 是 render 硬编码一处 `SlotHost slot="overlay"`（`CanvasSurface.vue:113`）——**槽位本身可扩展，但默认只建了 overlay 一个落点** | 已好；缺的是"预置语义落点"（toolbar/menu/panel），靠 SlotHost 一行即可加 |

---

## 三、你点名的菜单/面板/外观 —— 逐项现状

### a) 右键菜单(context-menu)、节点上下文动作
- **有没有层抽象**：❌ 没有。v2 没有任何"菜单项注册表"。内核 `ctx.*` 能力段里只有 nodes/theme/commands/slots/settings，无 menus。
- **写死在**：canvas-render 只把坐标透出来——`CanvasHost.vue:272-280` `onNodeContextMenu/onPaneContextMenu` 内 `preventDefault` + `emit('context-menu',{kind:'node'|'pane',clientX,clientY,nodeId})`；真正菜单 UI + 条目在 **demo** `CanvasDemo.vue:231-237`（`.ctx-menu` 里 "+ 文本/+ 图片/删除选中/撤销"四个硬编码 div）。
- **结论**：同一个 CanvasHost 换到别的宿主，右键菜单**永远得重写一遍**，且插件**无法往任何宿主加菜单项**。这是用户诉求里最该"做成扩展点"却最没做成的一项。
- **参考**：v1 `packages/canvas-core/src/plugins/context-menu/builtinMenuItems.ts:69-102` + `registry/MenuRegistry.ts` 有现成范式（`ctx.menus.register('context-menu',{area,nodeTypes,commandId,order,visible})`）。

### b) 设置菜单 / 配置面板
- 机制是好的：内核 `ctx.settings`（分组 schema）→ 渲染 `PluginSettingsPanel` 按组自动长控件 → `set→onChange` 窄更新（`docs/goal` 目标 B2 已验收）。
- 问题在**接线**：面板不是 CanvasHost 自带槽，demo 要在 `onReady` 里手 `ctx.get('settings')` 再 `bindThemeSettings`（`CanvasDemo.vue:118-137,195-197`）。换宿主要重抄一遍同步逻辑。渲染包无 `settingsSourceFrom(ctx)` 复用入口（前置审计 §1.3 同判）。
- **结论**：内核配置能力可扩展✅；渲染侧"面板挂载点"是 demo 私有，未槽位化。

### c) 快捷键菜单
- 快捷键**行为**写死在 CanvasHost（§二表）：Delete/Undo/Redo。没有"快捷键→命令"注册表，也没有"给某命令配快捷键/展示快捷键"的机制。
- **结论**：命令已内核化（`command`），但**键位映射是渲染层私有**；菜单/按钮想显示"快捷键"（如 v1 菜单项的 `shortcut`）无数据可读。

### d) 历史记录菜单 / 项目管理菜单
- 历史：内核 `History` 服务在（undo/redo/withRecord），UI 只有 `canUndo/canRedo` 布尔。无"历史快照列表/跳到某版本"抽象。
- 项目管理：内核 `SaveService` 有 key 分区（`save.set(key,val,type)` 四类），无"项目文件枚举/打开/切换"。
- **结论**：这两者更像**应用层业务**，不必然属于画布内核；但它们要能被某宿主复用，同样缺"菜单/面板可扩展点"去承载。

### e) 全局操控栏/toolbar
- 无内核 ToolbarRegistry（v1 有：`context.toolbars.register('node:image',{position:'top'|'bottom',nodeTypes,group,order})`，见 v1 `ImageNodePlugin.ts:665`）。v2 的 BaseNode 段 `top-toolbar/bottom-toolbar` **只到"某一 type 节点内"**，不是全局画布操控栏。
- demo 顶部 `.toolbar`（`CanvasDemo.vue:181-188`）纯手写。全局工具条要么走 `ctx.slots.register('app.toolbar')` + SlotHost，要么重建 v1 ToolbarRegistry。

### f) 节点样式 / 边(edge)样式（外观）
- 节点整体外观= `ctx.theme.register('nodeShell')` single 赢家 → **可换肤可顶替**✅（换一套主题注册更小 order 即可整体替换节点壳/边/背景）。
- 但**单一壳内部不可插拔**：BaseNode 是"上帝壳"，端口布局、选中环、标题反缩、LOD、浮动端口全部硬编码在一个 .vue 里（`BaseNode.vue`），外部插件无法只换"端口渲染"或"选中环"。
- 边外观 `ctx.theme.register('edge')` 同理 single——整条边可换，但"流光/箭头/虚线"这些子件都在 CustomEdge 内部不可拆。

### g) 现有 theme 槽够不够支撑"节点/边样式做成可插拔"
- **已注册的主题槽名（ThemeSlot，`themeRegistry.ts:24-30`）**：`nodeShell` / `edge` / `edgeDefaultType` / `background` / `connectionLine`。
- **够不够换肤/多 occupant**：够做"整皮替换"（一个插件把 nodeShell+edge+background 一起填 = 一套新皮，已由 theme-default 验证；多 occupant 语义+热卸回退已就绪）。
- **不够做"样式级可插拔"**：这套槽的粒度是"整个壳/整条边"，不是"壳的一个样式特征"（端口/选中环/标题/LOD/流光/箭头各自成槽）。想让"节点样式/edge 样式"像 v1 那样按属性细粒度可配、或多插件各改一段，现有 5 个槽**粒度太粗**，得靠 BaseNode/CustomEdge 内部的 props/settings 通道（目前 handle 走 props 注入，edge 走 settings）。

---

## 四、内核独立性：kernel → render 依赖方向 与"换 canvas 渲染"可行度

### 4.1 依赖方向干净性：✅ 单向无环，内核零 Vue
- `createMiniCanvasHost.ts:14-33` 从 `@mini-canvas/canvas-core-v2` 只 import 内核服务/类；`canvasHostCore.ts:7` 注释明示"不 import @vue-flow/core，不 import Vue 运行时"。组件句柄一律 opaque。
- `canvas-core-v2/src/**` 我核对过：生产代码无 .vue import，无 `reactive/ref`，Node 可单测（内核 146 测试绿佐证）。
- **这半边的设计是合格的**：把状态/命令/注册/装配全放内核，渲染层只做"读内核 → 画"。

### 4.2 换 canvas 渲染，内核会不会被破坏：**不会**，但会**暴露缺口**。要动的点：
1. **边(edge)必须先下沉内核（最大缺口）**：现在边是 `CanvasHost.vue:243-247` 里一个本地 `edges` ref，创建/删除/清理悬挂边全在宿主内存，**不落盘、不进 history、无法 undo 边**。VueFlow 的画布自管边还能凑合，换成 canvas 你没有任何"边数据源"可画。→ 建议内核加 `EdgeStore`（或 nodeStore 扩展 edges），含 create/remove/prune + 历史 + 持久化。
2. **键盘交互语义化**：`CanvasHost.vue:251-269` 的 Delete/Undo/Redo 判定、输入框豁免逻辑是通用的"画布交互"，本可放内核/一个 render 无关的 controller，而不是 VueFlow 组件的私有方法。
3. **nodeWrite 回写回调**：BaseNode 就地改名经 `nodeWrite(props.id, patch)`（props/令牌注入）。这是"渲染→内核数据写"的口子，目前是渲染层提供的 prop 约定，非内核接口——换后端时这套令牌协议（NODE_WRITE/CANVAS_PARAMS/EDGE_VISUAL/EDGE_SELECTION，`CanvasSurface.vue:79-84`）要么换掉要么抽象成"渲染无关的 host 接口"。
4. **右键菜单/端口声明驱动**（§二/§三）不改，canvas 后端也还是把这些写死。

### 4.3 CanvasHost 把哪些"业务/UI 决策"写死、难被别的渲染后端复用
- 它是**一份写死的 VueFlow 渲染装配**：节点映射 `nodesFromStore`、主题填 VueFlow `node-types/edge-types`、键盘、右键、点选同步、连边校验、overlay 槽。对"另一个 VueFlow 宿主"它可复用；对"canvas 宿主"它基本整层要换（CanvasHost/CanvasSurface/vueFlowBridge）。
- 但它把**内核不该有的取舍**混进来了：边不放内核（省事但失去持久/历史/可换后端）、快捷键写死、菜单不做注册表、外观用 props 注入而非注册。
- **哪些逻辑其实更该下沉内核/抽象成渲染无关接口**：
  - 边数据 + 边增删/清理/落盘/撤销（§4.2.1）
  - 快捷键→命令映射与判定（§3.c）
  - 菜单项注册表与解析（area/nodeType/visible，参照 v1 MenuRegistry）
  - "选中集"单源已做对（内核 Selection 是单源，`CanvasHost.vue:139-148,220-227` 订阅投影），这点是干净的 ✅

### 4.4 结论：可行度评估
- **"内核不被破坏 + 单测不动"：可行度 ~90%**。内核零 Vue，换后端只要新建一个渲染适配器，内核服务原样 `ctx.get`。这是这套架构最大的价值。
- **"端到端换 canvas 就上生产"：可行度 ~55%**。卡点按影响排序：① 边无内核 store（必须补）② 菜单/快捷键/交互决策仍写死在 VueFlow 宿主（需先抽象）③ 节点端口布局硬编码单进单出（多端口节点 canvas 一样做不了）④ render 令牌协议(HOST/NODE_WRITE…)是 Vue 专用。
- **建议顺序**：先补"边下沉内核 + 端口声明驱动壳"，再做"menu/shortcut 注册表下沉内核"，把 CanvasHost 收薄成"一个纯 VueFlow 适配器 + 内核标准接口"，届时换 canvas 只需写第二个适配器。

---

## 五、最重要的问题清单（带文件:行）

1. **[高] 边(edge)无内核 store**：创建/删除/悬挂清理全在渲染宿主内存 `CanvasHost.vue:241-248`（`edges.value` 本地 ref），不落盘不进历史；`CanvasHost.vue:247` 自注"边目前是 VueFlow 视觉态(未落盘)——内核尚无 edge store"。→ 换 canvas 后端没有边数据可画，撤销/持久化边全部缺失。

2. **[高] 右键菜单/节点动作没有可扩展抽象**：内核 ctx.* 无 menus；只 `CanvasHost.vue:272-280` 透 `emit('context-menu')`；真正菜单在 demo `CanvasDemo.vue:231-237` 手写。→ 插件无法给任意宿主加菜单项，换宿主必重写。v1 有 `MenuRegistry`(area/nodeType/visible) 可参照重建。

3. **[高] 全局工具栏/toolbar 无内核机制**：v1 有 `context.toolbars.register`（`packages/canvas-core/src/nodes/image/ImageNodePlugin.ts:665`）与 `ToolbarRegistry`；v2 只剩 demo 手写 `.toolbar`（`CanvasDemo.vue:181-188`）+ BaseNode 内 `top-toolbar/bottom-toolbar`（仅到节点级）。v2 相对 v1 在此项退步。

4. **[中] 节点壳"上帝壳" + 端口硬编码单进单出**：BaseNode 整壳一个组件（`BaseNode.vue`），端口只 2 个 `MovingHandle` 硬编码 `Position.Left/Right`（`BaseNode.vue:153-176`），选中环/LOD/标题反缩/浮动端口不可拆、不可只换端口。→ 多端口/自定义端口节点做不出；外观粒度太粗不可细插拔。

5. **[中] 快捷键行为硬编码在渲染宿主**：`CanvasHost.vue:251-269` 把 Delete/Undo/Redo、输入框豁免、meta/ctrl 判定写死在 VueFlow 宿主里，无"快捷键→命令"注册表。命令已在内核，键位映射却是 render 私有。

6. **[中] CanvasHost 把外观当 props 注入，非内核注册**：`edgeVisual`/`handleVisual` 走 props（`CanvasHost.vue:73-76,127-134`），BaseNode 读 `handleParams`（`BaseNode.vue:105`）；`nodeWrite` 是 prop 回写回调约定（`CanvasHost.vue:72,125`）。→ 换渲染后端这套令牌协议要重设计。

7. **[中] manager.diagnose 无生产出口 + 设置面板接线只在 demo**：`manager.diagnose()` 全仓无调用（`pluginManager.ts:173-175` 定义了没人用）；`PluginSettingsPanel` 唯一用处在 demo（`CanvasDemo.vue:195-197`），渲染包无 `settingsSourceFrom(ctx)` 复用入口（前置审计 §1.3）。→ 宿主拿不到"插件没起来"告警、接配置面板要抄 demo 逻辑。

8. **[低/信息] 通用槽(slots)只建了 overlay 一个默认落点**：内核 slots 任意字符串可扩展是好的，但渲染默认只在 `CanvasSurface.vue:113` 挂了 `SlotHost slot="overlay"` 一处；toolbar/menu/panel 等语义落点未预置，导致"谁都能塞但不知道塞哪"。

---

## 附：可参考的 v1 资产（重建时别重新发明）
- 菜单：`packages/canvas-core/src/registry/MenuRegistry.ts` + `registry/types.ts`（MenuRegistryAPI）+ `plugins/context-menu/builtinMenuItems.ts`
- 工具栏：`packages/canvas-core/src/registry/`（ToolbarRegistry）
- 快捷键：`packages/canvas-core/src/composables/useCanvasShortcuts.ts`
> 注意：这些是 v1 里混了 Vue(组件/markRaw) 的实现，v2 若要接需抽成"纯逻辑注册表 + 宿主渲染"两段，别把 Vue 拉回内核。
