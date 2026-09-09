# 拖线吸附到"同类型 source 口"——静态根因侦察

日期：2026-09-09
任务：拖 source→ 时线端点仍吸到另一节点 source（右下）。v-if 摘掉 MovingHandle/snap-band 无效。
结论性质：静态代码走读，未跑运行时。真正方向需一条运行时日志钉死（见文末"待确认"）。

---

## 1. aimedTarget 的全部写入路径 —— 结论：只有 plugin BaseNode 的 watch，且 forward 拖 source 根本无法吸到 source

`connectionState.aimedTarget` 定义：`packages/canvas-render/src/host/connectionState.ts:22`
写入点（全仓 src 内 grep aimedTarget）：
- `connectionState.ts:42`（beginConnection 置 null）、`:50`（endConnection 置 null）——只清空。
- `plugin-theme-default/src/components/node/BaseNode.vue:246-269` watch —— 唯一"填值"路径。
  - 依赖 [aimPortSide, aimBody, isConnecting, isCurrentConnectingNode]（:246-247）。
  - aimPortSide 只被本节点 snap-band 的 mouseenter/leave 写（:205 onInputSnapEnter、:208 onOutputSnapEnter、:211 onSnapLeave）；aimBody 只被卡片根 enter/leave 写（:194-201）。
- 测试文件除外。没有全局/其它组件/其它 composable 直接写 aimedTarget。

**snap 条件（CanvasHost resolveFromAim）**：`CanvasHost.vue:605-608`
```
if (aim.side !== 'body') {
  const expectSide = reverse ? 'output' : 'input'
  if (aim.side !== expectSide) return { point: flowPoint, hover: null }   // 方向不符 → 跟鼠标不吸
}
```
forward（拖 source，dragSourceHandle='source'）expectSide='input' → 只有 aim.side==='input' 才会吸。
anchor：BaseNode `snapAnchorFor('input')` 返回 `{x: pos.x, y: pos.y+cardHeight/2}`（左缘中点，:242），
即 forward 拖 source 若吸，端点只可能在**目标节点左缘**，不可能到右(source)口。
CanvasHost 侧 anchorX 回落 `rect.x`（forward）也是左缘（:616-618）。
body 永不吸（snapped = !msg && zone==='snap'，:629）。

**因此：纯 forward 的 source 拖拽，aimedTarget/resolveFromAim 这条 v2 定制路径在逻辑上不可能把端点吸到同类型的 source(右)口。** snap-band 摘不摘都不会是它干的。它与"吸附到 source 口"矛盾。

---

## 2. 视觉端点来源 dragFlowPoint —— 确认唯一可见"吸附"来源是 resolveFromAim

- `CanvasHost.onDragMouseMove`(:495) → rAF 内 `resolveFromAim`(:507) → `dragFlowPoint`(:509)。
- `onDragMouseUp`(:547-549) 同源。
- `ConnectionLineHost.vue:36`：`end = dragFlowPoint ?? {lineProps.targetX,targetY}` → 拖线期间 dragFlowPoint 非空即赢。
- 渲染线 = 主题 connectionLine 或回退贝塞尔（ConnectionLineHost:50-73），其 target-x/y = end。

所以线端一旦"吸在某端口锚点"= dragFlowPoint 被 resolveFromAim 置成 snapped 锚点。见 §1，forward 只可能吸 input(左)。
除非 —— dragSourceHandle 实际是 'target'（reverse，此时 expectSide='output'，才会吸到右/source 口）。

## VueFlow 原生 connection line 会不会自己把端点吸到 handle？
`vendor/vueflow/.../ConnectionLine/index.ts:33-38, 104-105`：原生线 target = `connectionPosition`（光标→flow），
**不吸任何 handle**；`toHandle`（:73-88）只喂 slot props 的 targetHandle，不改 targetX/Y。
即 VueFlow 原生线端点只是跟鼠标，从不"吸附到端口坐标"。全栈里唯一会视觉吸附的 = 本项目 dragFlowPoint。

---

## 3. vue-flow Handle 残影 / 真实 handle 是否还在 —— 关键发现：handleBounds 是 VueFlow store 里的数据，v-if 摘 DOM 不会清它

`MovingHandle.vue:325`：非 preview 时组件根就是 VueFlow 真 `<Handle>`（.vue-flow__handle.source / .target）。
BaseNode v-if 摘掉 MovingHandle = 摘掉真 Handle 的 DOM。

**VueFlow 的端口几何数据 `node.handleBounds` 独立于 DOM**：
- 由 `updateNodeDimensions` 重算：`store/actions.ts:158-162`，仅当
  `node.dimensions` 变了 **或 forceUpdate**（:152-156）才 `getHandleBounds`。
- `getHandleBounds`（`utils/node.ts:13`）扫 `nodeElement.querySelectorAll('.vue-flow__handle.${type}')`。
- v-if 摘 source Handle 时卡片尺寸不变 → `doUpdate=false` → **`node.handleBounds.source` 不重算，残留旧 source handle 几何**。
- 本项目自己的 `useNodeMeasure`（CanvasSurface）只量 `.vue-flow__node` 尺寸写自己的 nodeLayout（:38-47），
  **不触发 VueFlow updateNodeDimensions**，救不了这个 stale bounds。

**原生 mousemove 命中（useHandle.onPointerMove）**：`vendor/.../composables/useHandle.ts:178-260`
- `getClosestHandle`（:181，实现 `utils/handle.ts:74-124`）读 `node.handleBounds.source/target`（:86）→ 只要 stale 在就会把它当候选。
- 但要真正 snap/valid，`isValidHandle`（useHandle.ts:193，实现 `utils/handle.ts:127-204`）要求
  鼠标下有个活 `.vue-flow__handle` DOM（`handleDomNode` querySelector :147 / `elementFromPoint` :151-154）。
  Strict 下还要求 handleType 是相对 type（:185-189）。

**合成判断（Q3 真正修复点候选）**：
- 若 v-if 真把该 Handle 从 DOM 摘干净 → `elementFromPoint`/querySelector 找不到 → isValidHandle 判无效 → VueFlow 原生不会真的吸。
- **但 stale `handleBounds` + 仍活着的同款 Handle DOM（见下）** 会构成 VueFlow 把鼠标附近的 source handle 认作连接目标。

**最可疑的不对称（用户没查到的真凶候选）**：源节点 A 自己的端口**没有被摘**。
BaseNode：`blockedSourcePort = dragSameTypeBlocked && sourceHandle==='source'`，而
`dragSameTypeBlocked = isConnecting && !isCurrentConnectingNode`（:289-297）→ 对源自身 A（isCurrentConnectingNode=true）
两个端口(MovingHandle+snap-band)都保留在 DOM（只是 MovingHandle disabled）。这不是目标 B 的问题，但 A 的 source/target 口
在整个拖线期间都是活 DOM、且 A 的 handleBounds 里 source+target 都齐 —— 若鼠标折回 A 附近，VueFlow getClosestHandle 会命中 A 的 source/target。

---

## 汇总：用户看到的"吸到 source 口"，到底是哪条路径在干

静态上只有两条能吸，且 forward(source 拖)都不该吸到同类型 source：
1. 本项目 dragFlowPoint（resolveFromAim）—— 只有 aim.side 匹配 expectSide 才吸；forward 只认 input。
   → 若真发生"吸到 source 口"，只能解释为 **dragSourceHandle 实为 'target'（reverse）**，此时 expectSide='output'。
2. VueFlow 原生 line —— 端点只跟鼠标不吸；真要建边走 isValidHandle+Strict，source→source 被禁。

**这意味着报告的症状与"我拖的是 source"这个前提，二者必有一假**，最可能是：
- 拖拽源 handle 的 handleType 上报，或本次手势里 CanvasHost `dragSourceHandle` 存成了 'target'；
- 或"A 的 source 是某节点左口、B 的 target 在右"这类端口朝向与代码预设(Position.Left=input)不一致的布局；
- 或你描述成"另一个节点的 source 口"的那个点，其实命中走的是 reverse 语义/残留连接。

## 待确认（最小改动前必须跑一次运行时日志）
在 CanvasHost 的 onDragMouseMove 已打印处（:528-531 `drag hover client=.. flow=.. → node/status/zone`）确认 snap 触发那一帧：
- `dragSourceHandle` 的值（决定 forward/reverse）—— 若为 'target' 则全解释通了；
- snap 时 hoverNode.portSide（'input' 还是 'output'）与 nodeId；
- 该 nodeId 是否 == 源节点 A（若是，= A 自身端口残留，走 §3 不对称）。
加一行 `console.log('dragSourceHandle', dragSourceHandle)` 即可分辨。改这里（CanvasHost.vue onConnectStart :479 / onConnectEnd :697）不破坏任何现有逻辑。

真正修复点应落在"让 resolveFromAim 无论如何不产生 source→source / target→target 的 snapped"这一层
（例如 resolveFromAim 末尾对 candidate 再按 checkConnection 类型/朝向兜底，snap 前一帧强制失效），
而不是继续在 BaseNode 摘 DOM——因为摘 DOM 只影响 VueFlow 原生 isValidHandle，影响不到也管不住 dragFlowPoint 这条定制吸附。
