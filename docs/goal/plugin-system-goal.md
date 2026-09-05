# 目标文档 · @mini-canvas 插件系统完善（插件系统从"空壳"到"有血有肉 + 开发极简"）

> 本文件是**目标导向文档**：每次开工都把这份文件发给 agent，agent 按它工作，直到"验收"清单全勾才结束。
> 作者希望文档满足：①丰富上下文 ②结果到底长什么样写清楚 ③目标是什么写清楚。
> 适用工作区：`D:/Code/Git/mini-canvas`（pnpm monorepo）。
> 关联调查：`docs/tmp/dsh-plugin-survey/survey.md`（deepseek-harness 插件系统解剖）、
> `docs/tmp/render-layer-migration/*`（渲染层已抽成 canvas-render 包的证据）。

---

## 〇、一句话目标

把 `@mini-canvas` 画布从"内核机制在、插件却像空壳"改成：**插件开发一句话能上手、插件能往宿主塞进可见的 UI 槽（一个槽可叠多个、可排序、可替换），并把 v1 那一大批插件平滑迁进来**。目标是让"以后随便加插件都能有地方做可见的事、还能和别的插件协作"，且加的过程足够简单。

---

## 一、现状上下文（agent 开工必读，先对齐"现在在哪"）

### 1.1 monorepo 分层（已完成，勿推翻）
```
packages/
├─ canvas-core-v2       内核（纯逻辑，零 Vue）：core(Scope/Context/registry) + services(nodeStore/command/history/connection/...)+ contracts/edgeGeometry
├─ canvas-render        渲染宿主层（新，已抽成独立包）：CanvasHost.vue + canvasHostCore + createMiniCanvasHost + vueFlowBridge + 渲染注入令牌
└─ plugins/
   ├─ plugin-node-text / plugin-node-image     业务节点插件（content .vue + 逻辑）
   ├─ plugin-theme-default                     默认主题皮（nodeShell/edge/background，BaseNode/CustomEdge/MovingHandle/DefaultBackground）
   └─ plugin-canvas-commands                   画布命令插件（create/delete/undo/redo）
```
依赖方向（单向、无环，已实证）：
```
canvas-core-v2 ← canvas-render ← (theme-default / node-text 拿 vue-flow+令牌+edgeGeometry)
canvas-core-v2 ← node-image / canvas-commands
```

### 1.2 内核 ctx 现在给插件的能力（`src/core/types.ts` PluginScope）
- 事件：`on/once/emit`（**只有广播，无 waterfall/bail/serial/parallel**）
- 服务：`inject(name,impl)`(自动回收) / `get(name)`(缺抛错) / 插件间 `plugin(mod)`
- 副作用：`effect(fn)`（随 scope 自动回收）
- 插件模块：`{ name, setup(ctx) }`，`deps?: string[]` 只做 topo 排序 + 启动前校验
- 生命周期：Lifecycle 枚举 + `ctx:lifecycle-change` 事件（无 per-plugin 可诊断 fiber 句柄）

### 1.3 注册表现状（单格、opaque、防覆盖 —— 这是"空壳感"主因之一）
- `nodeRegistry`：`type → { content/title/top-toolbar/bottom-toolbar 组件句柄 }`，单格、重复抛错。
- `themeRegistry`：`ThemeSlot(nodeShell/edge/edgeDefaultType/background/connectionLine) → opaque`，单格、重复抛错。
- **共同缺点**：一个槽只能被填一个组件；没有"一个槽叠多个 + 排序(order) + 按 id 增量/替换"；组件收不到声明好的 props，只能裸 `ctx.get` 全局服务（耦合）。

### 1.4 v1 未来要迁的插件（`packages/canvas-core/src/plugins/`，现役 20 个，日后都要进新系统）
`align-arrange / align-guide / auto-layout / auto-save / backend-sync / canvas-export / clipboard /
context-menu / custom-handle / edge-cutting / file-drop / group / history / mini-map / multi-select /
node-find / shortcut-manager / storage / theme`
→ 新插件系统必须能容纳：**命令、快捷键、右键菜单、对齐/排列、迷你地图、框选、剪贴板、分组、导入导出、自动保存/后端同步** 等五花八门的"功能 + 可见 UI + 交互"，而不是只有"节点/主题/命令"三类。

### 1.5 端口/连接语义现状与用户想法
- 内核 `connection.ts` 已有**声明式端口约束**：`PortDef { port:'source'|'target', accepts?:string[], limit?:'single'|'multi' }`、
  `NodeConnectionDef { inputs?:PortDef[], outputs?:PortDef[] }`（经 `nodeStore.registerType` 声明）。校验有
  `validateConnection/typeConnectionDef`：missing-node/self-loop/bad-orientation/no-source-port/no-target-port/
  type-not-accepted/limit-reached。
- 用户**未来想法**（要能支撑，不是当下全实现）：一个节点多少个端口、哪些端口能连、拖线到节点某位置**吸附**到端口、
  松手即**快速连接**。这些大部分依赖内核 connection 已有能力 + 渲染层吸附几何（MovingHandle 已有）。

### 1.6 用户痛点（本轮要根治的）
1. **插件系统不够完善**：ctx 喂的宿主服务少、插件能挂的可见落点少。
2. **插件开发有点复杂**：作者希望像 deepseek-harness 那样，"写一个插件 = 一句话 setup + 往 slot 挂组件"就完事，
   不用理解一大堆注册函数 / 不用手写 effect 包 unregister / 不用纠结该在哪儿加。

### 1.7 参考对象（dsh 的插件体验，出自 survey 报告 H 节）
- 写插件 = `ctx.plugin({ name, inject, apply(ctx){ 注册命令/服务/slot } })`，一句 setup 搞定。
- UI 靠**类型化 Slots**：一个 slot 声明 cardinality(single/list/keyed/chain)+order，多个 occupant 可叠可排可换；
  host 从 `root` 渲染整棵 slot 树；inspect 可查谁填了哪个槽。
- 注册 API 本身就是 effect → 插件几乎不手写 uninstall。
- ctx 是"开放服务场"：宿主喂几十个具名服务，插件挑着 `ctx.get`。

---

## 二、目标终态（做完后"长什么样"，逐条可验证）

### 2.1 插件开发体验（最想达到的"简洁"）
未来的插件作者写一个功能插件，理想代码像这样（**目标形态，示意**）：
```ts
// packages/plugins/plugin-mini-map/index.ts
import { defineCanvasPlugin } from '@mini-canvas/canvas-base'
export default defineCanvasPlugin({
  name: 'mini-map',
  // 1. 注册一个可折叠/可拖拽的侧栏浮层（塞进画布 UI 的一个 slot，一槽可多 occupant）
  ui: [
    { slot: 'canvas.dock.top', id: 'minimap', order: 10, component: MiniMap, title: '小地图' },
  ],
  // 2. 注册命令（进右键菜单 / 快捷键）
  commands: [
    { id: 'minimap.toggle', label: '切换小地图', shortcut: 'M', run: (ctx) => toggle() },
  ],
})
```
即：**插件"想往宿主放可见东西"，只需声明"我挂哪个 slot + 我的组件"，宿主自动排好并渲染；不必手写 provide、不必手写装配、不必逐段注册**。

### 2.2 插槽系统（用户核心诉求，见下"目标 1"）
- 一个 slot 可以容纳**多个**插件的 occupant，能排序、能按 id 增量加或替换。
- 别的插件 `往某 slot 塞一个 Vue 组件` → 就显示在宿主对应位置；塞多个 → 按顺序排好。
- 主题/节点样式类 slot（连线、节点壳、端口）已能用（默认皮已实现），保留并纳入统一 slot 体系。

### 2.3 能力面（ctx / 扩展点，"有血有肉"）
- ctx 上能 `ctx.get` 到一组合插件真会用的宿主服务（命令、快捷键、选中、历史、右键菜单、文件拖放、剪贴板…）。
- 有一张"画布功能 → 扩展点"对照表（doc + inspect），作者一看就知道某功能该挂哪。
- 事件支持**协商/拦截**（waterfall/bail），用于 `before:node-create/connect/delete` 等可被插件否决的点。

### 2.4 未来的端口/吸附/快速连接（作为 slot/能力目标的验证场景，能支撑即可）
- 换节点壳/端口主题 = 换一个 slot 的 occupant（已能，纳入统一 slot）。
- 一个节点"几个端口、哪些能连、吸附、松手快速连接"的语义由**插件声明的 connection def + 槽组件**共同决定，
  内核 connection 规则引擎不改。

### 2.5 v1 插件可迁
- 新系统提供 v1 20 个插件所需的扩展点类别（见 2.3 + 1.4），迁移时每个 v1 插件能对号入座，不用再造新机制。

### 2.6 结构（类比 dsh-base）
- 抽一个**"插件基础库"**作为单一依赖源（类比 `@deepseek-ai/dsh-base`），把"写插件要 import 的一堆注册函数/类型"
  收进一个包，让插件作者 `import { defineCanvasPlugin } from '<这个库>'` 一个入口就够，不用知道内核内部怎么拆包。

---

## 三、目标清单（分 Goal，每个 Goal 有独立验收）

### 🎯 目标 0 · 建立"插件基础库"底座（先做，其余都挂它上面）
- **结果长啥样**：新增一个 workspace 包（建议 `packages/canvas-base`，名 `@mini-canvas/canvas-base`），
  `export` 一个作者友好的面：`defineCanvasPlugin(...)` + 类型 `CanvasPlugin/CanvasPluginContext` +
  底层转发内核/render/令牌的符号。插件包今后只依赖这一个库（`@mini-canvas/canvas-base`），不直接散 import 内核/渲染。
- **目标**：给插件作者一个单一、好认的 import 源，隐藏"内核在哪个包、渲染在哪个包"的细节。
- **验收**：示例插件只 import 这一个库就能写出完整可运行插件；`docs` 里新插件脚手架基于它。

### 🎯 目标 1 · 插槽系统：单格 → 多 occupant + 排序 + id 增量/替换（本次最核心）
- **结果长啥样**：把 `themeRegistry/nodeRegistry` 从"单格 map"升级成统一的**槽容器**：
  ```ts
  slot.add({ slot:'canvas.dock.top', id:'minimap', order:10, component:MiniMap }) // 叠加
  slot.add({ slot:'edge', id:'myEdge', order:0, component:MyEdge })               // 顶替默认(主题)
  slot.list('canvas.dock.top') // 按 order 排好的一串 occupant
  slot.remove(slotName, id)    // 移除某一个 occupant（不影响同槽其它）
  ```
  一个槽渲染多个 = 宿主把 `slot.list(slotName)` 按序 render；主题/单格类 slot 语义 = `single`（当前 order 最小的赢家）。
- **目标**：任何 slot 都能"多填 + 排序 + 显式替换"，插件能往别的插件开的槽里塞东西并显示在对应位置。
- **验收**：①单元测试覆盖 add/list(order 排序)/remove/replace/重复 id 策略；②demo 里两个插件往同一槽各塞一个组件、按序同屏渲染；③默认主题(连线/节点壳/端口)改走该 slot 体系仍能一键顶替与热卸回退。

### 🎯 目标 2 · 事件加"可协商/可拦截"分发（waterfall/bail）
- **结果长啥样**：`EventBus` 增加 `waterfall`（环绕中间件，可包装/短路）与 `bail`（首个拒绝即停）两种分发，
  并给画布语义点接上：`before:node-create` / `before:connect` / `before:node-delete`（bail：任一插件可否决）、
  `node:render`（waterfall：让主题/节点包装默认渲染）。
- **目标**：让"多个插件对一个动作协商/拦截"成为可能，取代 connection 里纯手写策略的部分场景。
- **验收**：单测覆盖 waterfall 包装/短路、bail 首个拒绝即停；一个插件能通过 `before:connect` 否决某种连接（拦截生效）。

### 🎯 目标 3 · 补"插件真会用的宿主服务 + 语义扩展点"，收敛复杂度
- **结果长啥样**：ctx 上能 `ctx.get` 到一批服务（至少把 command/shortcuts/selection/history/save 当服务上架），
  并新增几个**有语义的落点**供插件挂可见 UI/交互（示例，非穷举）：`canvas.toolbar`（工具栏按钮）、
  `canvas.contextmenu`（右键菜单项）、`canvas.dock.*`（可折叠侧栏/浮层）、`node.actions`（节点卡片上的操作钮）。
- **目标**：v1 那 20 个插件需要的"类别"都有对号入座的扩展点；作者做新功能不用再造轮子。
- **验收**：提供"功能 → 扩展点"对照 doc；至少命令/右键菜单/工具栏/dock 四类能由插件注入并在 demo 可见。

### 🎯 目标 4 · 生命周期可诊断 + 依赖就绪（PENDING）+ 插件开发指南
- **结果长啥样**：
  - 每插件一个可查句柄：`installPlugin` 返回/记录 `{ name, state, deps, config }`，setup 抛错统一走 `reportFailure`。
  - 依赖未就绪的插件进"待命"，服务 `inject` 上架的瞬间再执行 setup；服务被卸时依赖它的插件自动卸载/待命。
  - 一份 `docs` 插件作者教程（形似 dsh cordis-tutorial）：最小 text 插件 → effect/生命周期 → 服务共享 → 事件 → 完整 node+主题+命令插件。
- **目标**：动态加装互相依赖的插件可用；作者有照抄的教程。
- **验收**：①单测：先装依赖 A 后装 B 正常；先装 B(依赖 A) 进 PENDING、A 上架后 B 自动跑起来；卸 A 后 B 自动卸/待命；
  ②教程文档存在、能被照着一步步跑通一个最小插件。

### 🎯 目标 5 · 端口/吸附/快速连接 能力对齐（验证场景，不强推重写）
- **结果长啥样**：确认内核 connection 声明式约束 + 渲染吸附(主题 MovingHandle)已能支撑"端口数量/谁能连/吸附/松手快速连接"，
  用 demo/示例节点 + 主题验证一遍；缺的部分补齐（尽量在 slot/连接定义层，不动 connection 规则引擎核心）。
- **目标**：用户日后要做的"端口/吸附/快速连接"有现成落点，不阻塞。
- **验收**：一个自定义节点声明"2 输入 1 输出、某输出只接指定类型、limit single"，在 demo 里拖线吸附/松手连接行为符合声明。

---

## 四、约束与原则（动工前必守）

1. **内核 canvas-core-v2 保持纯逻辑、零 Vue、Node 可单测** —— 任何把 .vue / reactive 塞回内核的改动一律拒绝。
2. **不推翻已完成的渲染层迁移**（canvas-render 独立包、依赖方向）。目标 0 的"基础库"是**在其上加一层作者友好收口**，
   不是重拆包、不是再造第三个渲染层。
3. **slot 体系放内核（纯逻辑容器）还是渲染层？** 槽的**容器/排序/增删**是纯逻辑 → 内核 `registry`；
   槽的**渲染**(把 occupant 组件 render 出来)在渲染层 canvas-render / 宿主。两者用现有令牌/服务桥接，不破单向依赖。
4. **兼容存量**：现有 `registerNodeType/registerThemeSlot/registerThemeSlot` 语义（单格、scope 自动回收、热卸回退）要保留或平滑迁移，
   不能让 theme-default/node-text/image/commands 现有插件坏掉、不能破坏已绿的 134 个测试语义。
5. **小步提交**：每个 Goal 拆成原子 commit（feat(canvas-*)/refactor(plugin-*) 前缀 + 中英描述），每步有测试/验证。
6. **LF 行尾、pnpm workspace、vue-tsc 查 .vue**（按 `docs/tmp/render-layer-migration/monorepo-conventions.md`）。
7. 中间调查文档落 `docs/tmp/`；任务完成后再问是否清理，不擅自删。

---

## 五、实施路径（建议顺序；每步可独立验证）

- **阶段 P0 · 目标 0**：建 `packages/canvas-base`（作者友好面 + 转发），写脚手架 doc。
- **阶段 P1 · 目标 1**：内核把 registry 升级成"多 occupant 槽容器(slot + order + id + single/list 语义)"；
  渲染层 CanvasHost 据此渲染；迁移 theme-default / node-text 走新槽；跑 demo 验证多 occupant 同屏。
- **阶段 P2 · 目标 2**：EventBus 加 waterfall/bail + 画布语义点接线 + 单测。
- **阶段 P3 · 目标 3**：补宿主服务上 ctx + 语义落点(toolbar/contextmenu/dock/node.actions) + 功能→扩展点 doc。
- **阶段 P4 · 目标 4**：per-plugin 句柄 + PENDING 依赖编排 + 插件作者教程 doc。
- **阶段 P5 · 目标 5**：端口/吸附/快速连接能力对齐验证 + 补缺。
- **阶段 P6 · 收尾**：全量回归（内核+渲染+各插件 typecheck / vitest / vue-tsc / 两个 demo 浏览器端到端零报错），
  更新本文档验收勾选，`docs/tmp` 清理征询。

> 每个 Goal 都"先写验收用例 → 再实现 → 浏览器验证 → commit"。一次会话尽量推进多个 Goal，但**目标 1 是核心**，优先做好。

---

## 五·五、强制终审闸门（任务结束的硬性前提，违反则不予通过）

**本任务"判定完成"前，主 agent 必须启动一个子代理对本实现的插件系统做终审。** 这是硬性规定：
- **必须用 `run_subagent` 起一个独立子代理审核**。若主 agent 不通过子代理、而只靠自己（或任何非子代理方式）审核就宣布完成 —— **一律不予通过**，视为未结束。
- **子代理要非常严格、挑剔**：以 `D:/Code/Git/mini-canvas/deepseek-harness/docs` 里的插件/扩展实现（尤其
  `docs/cordis-primer*.md`、`docs/cordis-api/*`、`docs/subsystems/slots*.md`、`docs/subsystems/extensions*.md`、
  `docs/capability-seams*.md`、`docs/cordis-tutorial/*`）为对齐基准，逐条对照本实现。
- **审核不通过 → 子代理必须说明原因**，主 agent 据此继续修改，改完**再次启动子代理复审**，直到通过为止。
- 主 agent 给子代理的 prompt 需自报身份（`Caller agent: code-developer`），并明确要求：审核是否"简洁、可对齐 dsh、
  插件开发体验达标、没有破坏纯逻辑内核/没有推翻渲染层迁移/存量插件没坏"，同时指出**该抄未抄**与**过度设计**之处，
  输出"通过 / 不通过 + 原因 + 修改清单"。
- 子代理审核结论与报告放 `docs/tmp/plugin-system-review/`，保留备查。

---

## 六、验收总清单（全勾 = 本任务才结束）

- [ ] 目标0：`@mini-canvas/canvas-base` 存在，示例插件只 import 它就写全完整插件。
- [ ] 目标1：注册表支持多 occupant + order 排序 + id 增量/替换 + remove；单测绿；两个插件往同一槽各塞组件同屏按序渲染；默认主题走该体系仍可一键顶替/热卸回退。
- [ ] 目标2：EventBus 有 waterfall/bail；`before:connect` 等语义点单测 + demo 拦截生效。
- [ ] 目标3：ctx 上能 get 命令/快捷键/选中/历史等服务；工具栏/右键菜单/dock/节点操作钮可由插件注入并在 demo 可见；有"功能→扩展点"doc。
- [ ] 目标4：per-plugin 可诊断句柄 + PENDING 依赖编排单测绿；插件作者教程可照抄跑通一个最小插件。
- [ ] 目标5：端口/吸附/快速连接能力对齐验证通过（自定义节点连接声明在 demo 行为正确）。
- [ ] 全量：内核+渲染+全部插件 tsc / vue-tsc / vitest 全绿；两个 demo 浏览器端到端零 console 报错。
- [ ] **终审闸门：已用 `run_subagent` 启动严格挑剔的子代理，对齐 `deepseek-harness/docs` 插件实现审核，审核通过；审核报告在 `docs/tmp/plugin-system-review/`。**
- [ ] 这份文档更新为"完成态"。

---
