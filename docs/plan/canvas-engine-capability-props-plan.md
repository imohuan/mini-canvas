# 计划：默认渲染器收编进 default-theme + 连线能力 props 抽象

> 分支：feat/cordis-plugin-system。目标产物分两阶段，每阶段可独立验收、可回退。
> 本计划要落盘实现，改契约前先在此锁定决策。涉及 3 个插件包 + core 装配点，架构级。

---

## 背景 / 为什么

- `canvas-core-v2/src/components/{BaseNode,MovingHandle,CustomEdge,...}` 是"宿主默认渲染器"，却物理塞在 core、只被 demo 引用（不对外开放）——半成品。
- 主题替换路径 `registerThemeSlot(ctx,'edge'|'nodeShell'|'background')` 已经能换皮，但 DefaultEdge/ThemeShell 仍要插件作者自己 import VueFlow 原语、自己算贝塞尔 path（复杂度来源）。
- 目标（gap-audit 阶段 D + 用户方向）：
  1. **默认渲染器收编进 `plugin-theme-default`** —— core 只留"槽位 + 令牌"契约，不再硬编码任何 .vue 默认壳。
  2. **连线"能力 props"** —— core 提供连线槽位封装，把**算好的 path + 状态（selected / 是否流光 / 端点 / 外观）**当 props 喂给主题边"皮肤"，主题边不再自己 `getBezierPath`。

---

## 设计分叉（需你拍板，先改对再动码）

### 分叉 1：core 要不要留"无主题兜底"渲染？
- **A（推荐）**：不兜底。`plugin-theme-default` 就是"默认"，宿主 demo / 预览页必须装载它才有 UI。core 变成纯引擎契约（槽位+令牌），跟"一切皆插件"一致。空壳时画布只有节点裸内容，不假造默认样式。
- B：core 仍保留一份内置最小兜底（无主题插件时能看）。兜底代码留 core，跟"收编进主题插件"目标半冲突，代码重复。

### 分叉 2：连线"能力 props"的实现层怎么放？
- **A（推荐）**：core 内新增一个**边槽位封装组件**（如 `EdgeSlot.vue`），它注册进 `edgeTypes['custom']`，收 VueFlow 的 EdgeProps，用 core 已有的 `edgeGeometry.ts`（buildEdgePath/sampleEdgePath）算好 path 和状态，再渲染"主题提供的边皮肤组件"并传 `{ path, ...状态 }` 追加 props。主题插件只需写**皮肤**（一个纯展示 .vue），不碰 VueFlow 原语、不算 path。
- B：不给封装，只让主题边继续 `defineProps<EdgeProps>()` 自己算（现状）。省事但不达用户"别自己算"的诉求。

### 分叉 3：内容段分发给主题壳怎么给？
- 现状 ThemeShell inject `NODE_REGISTRY_KEY` 再按 type 解析 content。
- **A（推荐）**：保留 inject（内容组件句柄是运行时注册、随插件热更变，props 静态化不适合）。壳仍是 VueFlow NodeProps + inject 注册表。本轮不动这块（非本次痛点）。
- B：改成壳 props 传"本 type 的 content 句柄"。与"外壳只读 props"理想更近，但热更重建 nodeTypes 时 props 也要随 epoch 刷新，成本更高，且与 nodeRegistry 现有 inject 重复。本轮不选。

> 决策建议：分叉1选A、分叉2选A、分叉3选A。分叉2是本次核心交付，分叉1是收编的必然结果。

---

## 阶段一：连线能力 props（先做，独立可验收）

1. core 新增 `src/components/edgeSlot/EdgeSlot.vue`（或并入 components）：
   - 对外：一个"边皮肤"渲染容器。`defineProps<EdgeProps & { skin?: Component }>`，内部用 `edgeGeometry.buildEdgePath` 算 path、用现有高亮/流光规则算状态。
   - 把算好的东西以**追加 props** 传给皮肤：`{ d: path, selected, animated, sourceX...（透传）}`。皮肤根仍需 `<g>`。
   - `edgeGeometry.ts` 已在 core 且单测过（14 用例），直接复用。
2. 主题插件新增 `DefaultEdgeSkin.vue`（把现 DefaultEdge 的样式体抽成纯皮肤，只消费 `d` + 状态，不再 import getBezierPath）。
   - 可选：直接让 DefaultEdge 变成薄皮肤，`registerThemeSlot(ctx,'edge', DefaultEdgeSkin)`，同时提供 `registerEdgeSlot`/把 EdgeSlot 装配注册给宿主。
3. core 提供 `registerEdgeSlot`（或复用 registerThemeSlot + EdgeSlot 自动包装）让宿主把"皮肤→EdgeSlot(算路径)→edgeTypes"链路装好；host 装配点 `edgeTypes = { custom: EdgeSlot-with-skin }`。
4. 收尾：DefaultEdge.vue 从"自己算"改为"皮肤消费 props"，**删掉它的 getBezierPath/arrow 手算**（交给 EdgeSlot 或保留极简）。
   - 验收：core typecheck+121 测试过；theme build 过；demo 目验：edge 流光/箭头/选中仍正常。

> ⚠ 牵一发动全身点：EdgeSlot 必须是 VueFlow `edgeTypes` 里那个组件（VueFlow 只给 EdgeProps）。因此"喂算好 path"唯一可行是"EdgeSlot 收 EdgeProps→算→转发给皮肤"，不是让 VueFlow 直接渲染皮肤。计划按此做。

## 阶段二：默认渲染器收编进 default-theme（在阶段一验收后再动）

1. 把 core `src/components/` 的宿主默认渲染器（BaseNode/MovingHandle/CustomEdge/edgeGeometry/edgeContext/canvasParamKey）**搬到 `plugin-theme-default/src/`**，作为 default-theme 的默认 nodeShell/edge。
   - core 删除这些 .vue（保留纯令牌 contentBridge/nodeRegistryKey + edgeGeometry 若阶段一已用则归主题或留在 core 供 EdgeSlot）。
2. core 装配点（createMiniCanvasHost / CanvasDemo）改为"依赖主题插件提供 nodeShell/edge/background"，不再 import core 内默认壳；`applyTheme` 语义简化成"主题就是默认"。
3. demo-web / 预览页务必已把 theme-default 放冷启动插件（现在是，检查保留）。
   - 验收：demo 起，text/image 节点、边、背景样式与收编前一致；无主题插件时装 theme-default 即有默认皮；core 包内 grep 不再 import 已搬走的 .vue。

## 全局验收
- `pnpm -r run typecheck` 全绿；core `vitest run` 121 用例绿；theme/两节点插件 typecheck 绿。
- `plugin-theme-default` build(lib) 过；dev 起 5310 正常。
- git 每步一提交，原子、message 清晰。

## 风险与红线
- 依赖方向恒 插件→内核；内核不 import 插件、不 import content .vue。
- 不引入 v1 复杂件（ResizeHandle 八向/裁剪/蒙版等），本次只做"收编 + 边能力 props"，不扩功能。
- 改前先备份/保留演示可回退点；破坏性操作禁止。
