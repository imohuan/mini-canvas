# research-canvas-render-conn —— 「拖线连接过程能力层」契约核实

> 目标架构：canvas-render 提供"拖线连接过程"能力（响应式 connectionState + 在 `<VueFlow>` 上接
> `@connect-start/@connect-end` + `#connection-line` 插槽 + `#node-*` 命中反馈），
> plugin-theme-default 的 BaseNode 消费 state 做 3D 倾斜 / 非法气泡 / 吸附 zone 渲染。
>
> 本文档精确核实 **@vue-flow/core 1.48.2** 与 **canvas-render / canvas-core-v2** 两侧契约，逐项给结论 + 文件:行号 + 类型签名。
> 核实地基：`node_modules/@vue-flow/core` 版本 1.48.2（monorepo 根 `node_modules/@vue-flow/core/package.json`）。
>
> 生成日期：2026-09-06（v2 分支 `feat/cordis-plugin-system`）。

---

## 〇、一句话总览（读前先看）

1. **`@connect-stop` 在 1.48.2 不存在**——本版本生命周期事件是 `connectStart` / `connectEnd` / `connect`
   （另加 click 系的 `clickConnectStart` / `clickConnectEnd`）。"松手清空反馈"只能接 `@connect-end`（别按文档写的 `connect-stop` 做）。
2. `connectionMode` 默认 **`Loose`**（line 6190），本能力层做非法反馈不受 VueFlow 自带的 strict 校验束缚，**必须自己接 `#connection-line` + 自算 reason**。
3. `#connection-line` 插槽（无槽时）默认画**一条贝塞尔 `<path>`**，丑；要好看必须给自定义连接线。
4. 拖线过程里"鼠标当前画布坐标"最轻的途径是 `useVueFlow().screenToFlowCoordinate`，或读 `useConnection().position`（store 的 `connectionPosition`，容器相对像素）。**`#connection-line` 的 scoped `props.targetX/Y` 本身就是每帧 flow 坐标**，比手绑 mousemove 更省。
5. 关键契约落差（写方案前必看 §6.3）：**1.48.2 的 `ConnectionLineProps` 没有 v1 代码里 `sourceHandleId/targetHandleId/fromHandle` 这些字段**——它们是 react-flow/旧版字段。v2 能力层不能照抄 v1 `buildConnectionEdgeProps` 的字段读法。

---

## 一、@vue-flow/core 1.48.2 的 VueFlow props / 事件 / 连接线能力

类型与实现位置：
- 组件 props 声明：`node_modules/@vue-flow/core/dist/container/VueFlow/VueFlow.vue.d.ts`
- 运行时 store 状态：`node_modules/@vue-flow/core/dist/vue-flow-core.mjs`（命名空间 `dist/vue-flow-core.mjs`）
- 类型汇总：`dist/types/`（connection.d.ts / hooks.d.ts / store.d.ts / flow.d.ts / handle.d.ts / node.d.ts）

### 1.1 VueFlow 上与连接相关的 props

来源 `VueFlow.vue.d.ts`（props 表）+ `dist/types/flow.d.ts`（`FlowProps`）+ 运行时默认值（mjs）。

| prop | 类型 | 默认 | 位置 | 说明 |
|---|---|---|---|---|
| `connection-mode` | `ConnectionMode` (enum `'strict'|'loose'`) | **`'loose'`** | .vue.d.ts:24-26；enum 定义 `types/connection.d.ts:58-61`；默认 mjs:6190 | **默认 Loose = 所有 handle 都当 source 能互连**。VueFlow 自带 strict 校验很弱，本能力层的合法性全靠自定义 `isValidConnection`+`#connection-line` 自算 |
| `connection-radius` | `number` | **`20`** | .vue.d.ts:38-40；默认 mjs:6195 | handle 吸附半径（px），决定"拖到某个 handle 算命中"。注意与 v1 的吸附 zone 是两码事（见 §6） |
| `connection-line-type` | `ConnectionLineType \| null` | `null`（回落 Bezier） | .vue.d.ts:27-29；**deprecated**，推荐 `connectionLineOptions.type` | 见 store.d.ts:84 标注 deprecated |
| `connection-line-style` | `CSSProperties \| null` | `undefined` | .vue.d.ts:30-33；deprecated（store.d.ts:86） | |
| `connection-line-options` | `ConnectionLineOptions` | `{type:Bezier}` | .vue.d.ts:34-37；默认 mjs:6186-6188 | 结构化，非 deprecated。含 `{type, style, class, markerEnd, markerStart}`（`connection.d.ts:15-21`） |
| `is-valid-connection` | `ValidConnectionFunc \| null` | `undefined` | .vue.d.ts:41-44 | `handle.d.ts:15-25` 定义：`(connection, {edges,nodes,sourceNode,targetNode}) => boolean`。**返回值仅控制 VueFlow 是否自己画连/触发 @connect，无法回传 reason**（这正是要在 CanvasHost 层重算 reason 的原因，见 §6.5） |

运行时 store 状态默认值块：mjs:6184-6197（`connectionLineStyle:{}`、`connectionLineType:null`、`connectionLineOptions:{type:Bezier}`、`connectionMode:Loose`、`connectionStartHandle:null`、`connectionEndHandle:null`、`connectionPosition:{x:NaN,y:NaN}`、`connectionRadius:20`、`connectionStatus:null`）。

> store 状态字段表见 `dist/types/store.d.ts:81-94`（`connectionMode/connectionLineOptions/connectionLineType(+deprecated)/connectionLineStyle(+deprecated)/connectionStartHandle/connectionEndHandle/connectionClickStartHandle/connectionPosition/connectionRadius/connectionStatus/isValidConnection/connectOnClick`）。

### 1.2 事件：确切 handler 参数类型 + 触发时机

事件集声明三处一致：
- VueFlow emits：`VueFlow.vue.d.ts` 段（事件 payload 类型）；mjs:9895 emits 名单
- 事件 payload 接口：`dist/types/hooks.d.ts` `FlowEvents`
- store hooks：mjs:6076-6077（`connectStart/connectEnd` extended hook）

**1.48.2 的 emits 名单（mjs:9895）**：`connect`, `connectStart`, `connectEnd`, `clickConnectStart`, `clickConnectEnd`, …… **没有 `connectStop`**。

payload 类型（hooks.d.ts）：

```ts
// hooks.d.ts
connect: Connection                                   // types/connection.d.ts:23-32
connectStart: { event?: MouseEvent|TouchEvent } & OnConnectStartParams
connectEnd:   MouseEvent | TouchEvent | undefined
clickConnectStart: { event?: MouseEvent|TouchEvent } & OnConnectStartParams
clickConnectEnd:   MouseEvent | TouchEvent | undefined
```

```ts
// types/connection.d.ts:49-56 —— OnConnectStartParams
interface OnConnectStartParams {
  nodeId?: string        // 源节点 id
  handleId: string | null // 源 handle id
  handleType?: HandleType // 'source'|'target'
}
// 注意：payload 里还带一个 event（MouseEvent|TouchEvent），v1 onConnectStart 从它取屏幕坐标
```

**触发时机（实测 mjs 源码）：**
- **`connect-start`**：在 **Handle 的 pointerdown** 且确认 fromHandle 合法后触发（mjs:5386 `emits.connectStart({ event, nodeId, handleId, handleType })`）。时机：已从 DOM 算出连接起点，**任何真实拖线**必然先触发。
- **`connect-end`**：在 pointerup 里**无条件**触发（mjs:5309 `emits.connectEnd(event2)`），**无论连接是否成功/是否落在节点上**。→ 清空反馈的最终兜底就放这（与 `@connect` 成对）。
- **`connect`**：仅在 pointerup 命中合法 handle 时触发（mjs:5302-5304），载荷是 `Connection`。**注意它只有在"拖到已注册 Handle 上"才触发**——v1/本能力层要的"拖到节点主体或空白"的反馈靠的是 `connect-end` + 手动找节点，不是 `connect`。
- click 系 `clickConnectStart/clickConnectEnd`：`connectOnClick`（默认 true，mjs:6196）开启"点一下 handle 即可连接"时用（mjs:5396+ / 5451）。**v2 能力层若不想管点选连接可不管，但要 aware**（默认开着）。

事件在 Vue 模板绑定名（Vue 事件名归一为 emit 名 `connectStart/connectEnd`，模板里 `@connect-start` / `@connect-end` 均可用——CanvasHost 现有 `@connect` 已是同套，见 §3）。**再次强调：别加 `@connect-stop`，1.48.2 不触发它。**

### 1.3 `#connection-line` 插槽的确切签名

- 槽声明：`dist/types/flow.d.ts:321-322`：`interface FlowSlots extends NodeSlots, EdgeSlots { 'connection-line': (connectionLineProps: ConnectionLineProps) => any }`
- **`ConnectionLineProps` 类型**：`dist/types/connection.d.ts:62-89`（导出为独立 interface，可从 `@vue-flow/core` 直接 import）。

**1.48.2 的 ConnectionLineProps 全字段**（connection.d.ts:62-89）：

```ts
interface ConnectionLineProps {
  sourceX: number
  sourceY: number
  sourcePosition: Position          // 源 handle 方向
  targetX: number                    // ← flow 坐标（连接线终点 = 当前鼠标在画布里的坐标，每帧更新）
  targetY: number
  targetPosition: Position
  sourceNode: GraphNode              // 源节点
  sourceHandle: HandleElement | null
  targetNode: GraphNode | null       // 拖到的目标节点（handle 命中时非空；悬空时 null）
  targetHandle: HandleElement | null
  markerStart: string
  markerEnd: string
  connectionStatus: ConnectionStatus | null  // 'valid'|'invalid'|null
}
```

**没有** v1 代码里读的 `sourceHandleId` / `targetHandleId` / `fromHandle` / `connectionLineType` / `connectionStatus?`（见 §6.3 落差）。

插槽实际塞给它的 props（ConnectionLine 组件源码 mjs:9207-9220）——**`targetX/targetY` 是 flow 坐标**（见下）：

```js
// mjs:9124-9128 —— toXY 换算
const toXY = computed(() => ({
  x: (connectionPosition.value.x - viewport.value.x) / viewport.value.zoom, // flow 坐标
  y: (connectionPosition.value.y - viewport.value.y) / viewport.value.zoom,
}))
// mjs:9207-9220 —— 有自定义 slot 时 h(component, {...})
//   传 sourceX/sourceY/sourcePosition/targetX(=toXY.x)/targetY(=toXY.y)/targetPosition/
//      sourceNode(=fromNode)/sourceHandle(=fromHandle)/targetNode(=toNode)/targetHandle/
//      markerEnd/markerStart/connectionStatus
```

> 结论：**`#connection-line` scoped `props` 里的 `targetX/targetY` 就是每一帧的鼠标画布(flow)坐标**，能力层在渲染该插槽内容时即可读到当前鼠标 flow 位置，无需额外绑 mousemove。这正是 v1 `buildConnectionEdgeProps` 依赖 connection-line 插槽每帧拿 `targetX/Y` 的机制（§6.4）。

### 1.4 默认连接线样式 —— 不给 `#connection-line` 时画什么

ConnectionLine 组件（mjs:9097-9235）：无 slot 时渲染一条 `dAttr` 路径（mjs:9221-9230）：

```js
h('path', {
  d: dAttr,  // bezier / step / smoothstep / simple-bezier / straight，按 connectionLineType 或 options.type
  class: [connectionLineOptions.value.class, connectionStatus.value, 'vue-flow__connection-path'],
  style: { ...connectionLineStyle.value, ...connectionLineOptions.value.style },
  'marker-end': markerEnd.value, 'marker-start': markerStart.value,
})
```

- 类型默认 **Bezier**（mjs:9177 `connectionLineType ?? options.type ?? Bezier`）。
- 包一层 `<svg class="vue-flow__edges vue-flow__connectionline vue-flow__container">`（mjs:9201-9203）。
- 样式：`dist/style.css:70` `.vue-flow__connection-path`（默认细灰线），:122 `:deep .vue-flow__connection`、:131 `.vue-flow__connectionline`。`.vue-flow__connection-path` 只设了 stroke 颜色之类，**没有动画/辉光/箭头**。
- `connectionStatus` 会被拼成 class（'valid'/'invalid' 态色），可做轻微红绿反馈，但**不含吸附 zone / 3D 倾斜 / 非法气泡**。

> 结论：**必须自定义 `#connection-line` 才能做 v1 级吸附线 + BaseNode 3D/气泡特效**。默认路径只是给你兜底"能看出在拖线"，谈不上好看。本能力层应把 themeRegistry 的 `connectionLine` 槽赢家渲染进 `#connection-line`，无赢家时回落成一条最简（可平滑消失的）路径或直接复用默认样式。

---

## 二、拖线过程里"拿鼠标当前画布坐标"的途径

Store 状态（store.d.ts:81-94）里有连接进行时的完整现场，可经 `useVueFlow()`（返回整份 `VueFlowStore`，useVueFlow.d.ts:14）或 `useConnection()`（只读进行中连接）拿：

### 2.1 `useConnection()` —— 拖线现场的最轻只读口（推荐给 BaseNode 读反馈）

```ts
// composables/useConnection.d.ts —— 全 ref，响应式
function useConnection(): {
  startHandle: Ref<ConnectingHandle | null>   // ConnectingHandle: handle.d.ts:19-25
  endHandle:   Ref<ConnectingHandle | null>
  status:      Ref<ConnectionStatus | null>    // 'valid'|'invalid'|null
  position:    Ref<XYPosition>                 // = store.connectionPosition
}
```

- `position` 即 store.connectionPosition，是 **容器相对像素**（非 flow 坐标）——来源见 mjs:5230/5276-5283（Handle 用 `getEventPosition(event, containerBounds)` 算，container-relative px）。
- 但 store 里还暴露 `connectionStartHandle/connectionEndHandle/connectionStatus` 等（useVueFlow 直接解构可得）。若要"是否正在拖"的布尔，用 `connectionStartHandle !== null`（或 store 里 `connectionInProgress`：mjs:8234/8473 `toRef(() => connectionStartHandle.value !== null)`）。
- **约束**：`useConnection()` 只给**容器相对像素 position**，不是 flow 坐标；要 flow 坐标需经 `screenToFlowCoordinate` 或手除 viewport。

### 2.2 `useVueFlow().screenToFlowCoordinate` —— 事件回调里把 client 坐标转 flow（最省）

```ts
// store 坐标 action（真正实现 mjs:5727-5737，替换 5594 的占位）
screenToFlowCoordinate: (position: XYPosition) => XYPosition
// 内部：client 坐标 - 容器 getBoundingClientRect 左上角，再 pointToRendererPoint(÷zoom - 平移)（snapToGrid/snapGrid）
// 反函数 flowToScreenCoordinate（mjs:5738-5748）
```

- store action 包装：mjs:6920-6921；占位（viewport 未初始化时）：mjs:5593-5595。
- 用法：`connect-start` 后（或任意 mousemove 里）`const fp = vf.screenToFlowCoordinate({x: e.clientX, y: e.clientY})` 得到画布坐标。
- 约束：仅浏览器（`state.vueFlowRef` 存在才准），Node 单测里是占位恒等；需 `vueFlowRef` 挂载后（boot 完成、VueFlow mounted）才有效。

### 2.3 相比"事件回调里绑 mousemove"——推荐结论

三种取 flow 坐标途径对比：

| 途径 | 每帧/事件 | 坐标类型 | 成本 | 适用 |
|---|---|---|---|---|
| `#connection-line` scoped `props.targetX/targetY` | 每帧（连接线重渲染即给） | **flow** | 无额外监听 | **首选**：绘制连接线 / 算 hover zone / 吸附吸附点 |
| `useConnection().position` | 响应式 ref，随 updateConnection 更新 | 容器相对 px | 读 ref | BaseNode 里只想做"是否在拖/拖向哪"粗反馈，需再转 flow |
| `connect-start` 后自绑 `pane` mousemove + `screenToFlowCoordinate` | 事件回调 | 手动转 flow | 要自己 add/removeEventListener | 不适配 VueFlow 已接管拖线的情况，**不如直接读插槽 props** |

> **结论：能力层"hover/zone/吸附"计算应全部挂在 `#connection-line` 渲染里**（每帧已带 targetX/Y flow 坐标 + connectionStatus），不要另起 mousemove——省一份监听、也不会与 VueFlow 内部拖线抢事件。`useConnection()/screenToFlowCoordinate` 只作 BaseNode 或非插槽场景的补充口。

---

## 三、canvas-render 现状核对（复核 + 行号）

### 3.1 `packages/canvas-render/src/host/CanvasHost.vue`

| 关注点 | 行号 | 现状 |
|---|---|---|
| `isValidConnection` | **236-245** | **把 reason 丢了**：`const res = validateConnection(...); return res.ok`（244）。只当布尔用，原因被吞。这是"非法反馈"断链根因 |
| `onConnect` | **247-264** | `if (!isValidConnection(conn)||!conn.source||!conn.target) return`（248）→ 经 `host.history.withRecord` 调 `h.edgeStore.addEdge(...)`（253-261）→ 落盘（263）。**只处理合法建边**；用户从节点主体/空白释放的"想建却没接到 handle"流程根本不走到这（那要靠 connect-end + 手动找节点，见 §6.5） |
| `applyTheme` | **173-186** | `assembleTheme(h.themeRegistry, h.nodeStore.types.keys())`；`asm.nodeShell` 存在时**所有 `asm.nodeTypes` 的 type 都映射到同一个 `shell`**（180-181：`for (const t of asm.nodeTypes) nodeTypes.value[t] = shell`）；edge 固定塞 `custom`（183）；读 `edgeDefaultType`（184）、`background`（185）。**没读 `connectionLine` 槽** |
| `nodeTypes` 全 type 同 shell | **178-182** | 见上（180-181 三行即"全 type 同一壳"） |
| 渲染态 refs | 153-169 | `nodes/edges/nodeTypes(shallowRef)/edgeTypes/backgroundComp/edgeDefaultType/nodeEpoch/canUndo/canRedo` |
| 订阅 store | 197-209 `syncFromStore`；订阅点 319-323 | nodeStore/edgeStore.subscribe → syncFromStore；selection.onChange → syncSelected |
| 交互事件函数 | onNodeDragStop 213 / onNodeClick 226 / onPaneClick 231 / onKeydown 267 / onNodeContextMenu 288 / onPaneContextMenu 293 | 现有事件绑法参照 |
| 传给内层 CanvasSurface 的 props | **417-438** | 传入 `:nodes/:edges/:node-types/:edge-types/:background-comp/:node-epoch/:min-zoom/:max-zoom/:is-valid-connection/:on-connect/:on-node-click/:on-node-drag-stop/:on-pane-click/:on-node-context-menu/:on-pane-context-menu` 及 provide 数据 `host/registry/node-write/handle-params/edge-visual/edge-selection`。**无 connect-start/end/stop，无 connection-line 槽** |
| 生命周期 | onMounted 303-366 / onBeforeUnmount 397-407 | 订阅+热装热卸（336-349）+键盘+落盘；卸载回收 |

### 3.2 `packages/canvas-render/src/host/CanvasSurface.vue`

- props：**29-59**，与 CanvasHost 传入一一对应（30-32 host、33 registry、34 nodeWrite、35 handleParams、36-37 edgeVisual/edgeSelection、39-50 渲染态、52-58 交互回调：isValidConnection / onConnect / onNodeClick / onNodeDragStop / onPaneClick / onNodeContextMenu / onPaneContextMenu）。
- **provide 裸渲染上下文**：**67-84**。`renderCtx` 组装 67-75 → `provide(RENDER_CONTEXT_KEY, renderCtx)`（76）；旧 6 令牌仍逐个 provide 同引用（79-84，NODE_REGISTRY_KEY/NODE_WRITE_KEY/CANVAS_PARAMS_KEY/EDGE_VISUAL_KEY/EDGE_SELECTION_KEY/HOST_KEY）。
- **`<VueFlow>` 绑的事件与 props 全清单**：**89-104**。
  - props：`:key=nodeEpoch`、`:nodes`、`:edges`、`:node-types`、`:edge-types`、`:is-valid-connection`、`:min-zoom`、`:max-zoom`。
  - events：`@connect="onConnect"`、`@node-click`、`@node-drag-stop`、`@pane-click`、`@node-context-menu`、`@pane-context-menu`。
  - **确认：无 `@connect-start` / `@connect-end` / `@connect-stop`，无 `#connection-line` 槽**。
  - 槽内只放了 `<component :is="backgroundComp">`（106）+ 透传默认 `<slot/>`（108）。
- 样式深坑提示：`:deep(.vue-flow__node)` 让 BaseNode 根背景透明（128-134）；`csurface-overlay` 浮层 `pointer-events:none`（135-141）——连接反馈若走 overlay 注意，但吸附 zone/3D 应在 BaseNode 内部或 connection-line，不用 overlay。

### 3.3 `packages/canvas-render/src/contracts/renderContext.ts`（加 connectionState 的位置）

`CanvasRenderContext` 接口：**33-48**，字段：`ctx` / `host` / `registry` / `nodeWrite` / `handleParams` / `edgeVisual` / `edgeSelection`。

```ts
export interface CanvasRenderContext {
  ctx: Context                 // 34-35
  host: CanvasHostHandle       // 36-37
  registry: NodeRegistry       // 38-39
  nodeWrite: NodeWrite         // 40-41
  handleParams: CanvasParams   // 42-43（响应式对象，属性改实时生效）
  edgeVisual: Partial<EdgeVisual>   // 44-45
  edgeSelection: EdgeSelection      // 46-47（含 ref：selectedNodeIds/selectedEdgeIds）
}
```

- 令牌 + 消费：`RENDER_CONTEXT_KEY`（51）、`useCanvasRender()`（57-63，不在宿主内抛错）。
- **加 connectionState 的顺位**：`handleParams/edgeVisual` 是"响应式对象属性改实时生效"范式，`edgeSelection` 是"含 ref 供追踪"范式。connectionState 需要"结构整体变化也能触发 BaseNode 重渲"（拖线时 hoverNode 换节点/清空），**更贴近 `edgeSelection` 的 ref 范式**：
  - 建议类型：`connectionState: ConnectionFeedbackState`，其中每个子字段用 `Ref`（如 `activeConnection: Ref<...>`），或整个 state 用 `readonly { active: ..., hoverNode: ... }` 由 CanvasHost 维护 reactive。注入方式与现有字段一致：CanvasSurface 组装 renderCtx 时带上，provide 同引用，BaseNode 经 `useCanvasRender().connectionState` 读。**接口字段加在 33-48 尾部 + CanvasSurface:67-75 组装处 + CanvasHost 准备处三处联动**。

### 3.4 `packages/canvas-render/src/contracts/edgeContext.ts` / `canvasParamKey.ts` 的 provide 形态（响应式对象怎么给子树）

**edgeContext.ts**（两段式，可作为 connectionState 设计模板）：
```ts
export interface EdgeVisual { edgeType?: 'bezier'|'straight'|'step'|'smoothstep'; edgeLineWidth?: number; ... edgeMarkerEnd?: boolean; edgeGlowEnabled?: boolean; ... } // 11-34
export const EDGE_VISUAL_KEY: InjectionKey<Partial<EdgeVisual>> = Symbol('canvas-edge-visual')      // 36
export interface EdgeSelection { selectedNodeIds: Ref<ReadonlySet<string>>; selectedEdgeIds: Ref<ReadonlySet<string>> }  // 38-41
export const EDGE_SELECTION_KEY: InjectionKey<Partial<EdgeSelection>> = Symbol('canvas-edge-selection')                 // 43
```
- `EdgeVisual` = 普通字段对象，宿主传 **reactive 对象**（CanvasHost:132 `reactive({...DEFAULT_EDGE_VISUAL})`），改属性实时生效（消费方 computed 追踪）。
- `EdgeSelection` = 含 **Ref** 字段，宿主整体替换 `selectedIds.value`（CanvasHost:145-149 `syncSelected`）触发消费追踪。
- provide：CanvasSurface:79-83 逐个；新 renderContext 里同引用。

**canvasParamKey.ts**：`CanvasParams`（10-21：handleRadius/handleRestOffset/handleCursorGap/handleButtonSize/handleOverlap，默认对齐 contract），`CANVAS_PARAMS_KEY`（23）。CanvasHost:133 `handleDefaultR = reactive({...DEFAULT_HANDLE_VISUAL})` 同样 reactive 对象。

> **供能力层参考**：connectionState 内部既有"结构整体变（hoverNode null↔对象）"又有"字段变（zone/status/message）"。用 `edgeSelection` 的 Ref 子字段（`hoverNode: Ref<HoverFeedback|null>` 整体替换）最干净；或整个 reactive，BaseNode 用 `computed(() => connectionState.hoverNode)` 追踪其嵌套字段。两种都可行，推荐前者（与现有 edgeSelection 一致，避免整 reactive 大对象频繁触发）。

### 3.5 canvas-core-v2 的 connection.ts / themeRegistry / nodeStore.types

**connection.ts**（`packages/canvas-core-v2/src/services/connection.ts`，纯逻辑零 Vue，Node 可测）：
- 返回类型：`ValidationResult`（84-89）：`{ ok: boolean; reason: InvalidReason|'ok'; canonical?: CanonicalEndpoints }`。
- `InvalidReason` 完整枚举：**73-82**：`'missing-node' | 'self-loop' | 'bad-orientation' | 'no-source-port' | 'no-target-port' | 'type-not-accepted' | 'limit-reached' | 'duplicate' | 'cycle'`。
- `validateConnection(conn, ctx, opts?): ValidationResult`：**178-226**。规则链 = toCanonical(bad-orientation) → missing-node/self-loop → 端口能力(no-source/no-target-port) → accepts(type-not-accepted) → 环(cycle) → 去重(duplicate) → limit:single(limit-reached)。
- `typeConnectionDef(def): NodeConnectionDef|undefined`：**229-232**（CanvasHost:242 已 import 用 `typeConnectionDef(h.nodeStore.types.get(t))`）。
- `normalizeConnection/toCanonicalConnection/wouldCreateCycle/findDuplicate` 等纯函数 96-168。
- 关键：**reason 现在可拿**（CanvasHost 丢了，需在能力层补透传）。

**themeRegistry.ts**（`packages/canvas-core-v2/src/core/registry/themeRegistry.ts`）：
- `ThemeSlot` 联合类型：**24-30**。`connectionLine` **在第 29 行**（确凿）。
- 读取 API：`winner(slot)` 60-62（single 赢家）/ `occupants(slot)` 55-57 / `get(slot)` 98-100（= winner）。
- **assembleTheme 目前有没有读 connectionLine 槽**：没有。`canvasHostCore.ts:67-83` 只读 `nodeShell/edge/background/edgeDefaultType`（71-75）。→ 能力层需在 `assembleTheme` 加 `connectionLine: theme?.get('connectionLine')` 并扩 `ThemeAssembly`（canvasHostCore.ts:50-61）。

**nodeStore.types 的 CanvasNodeType 结构**（`packages/canvas-core-v2/src/services/nodeStore.ts:19-26`）：
```ts
export interface CanvasNodeType {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  inputs?:  Array<{ port?: string; accepts?: string[]; limit?: 'single'|'multi' }>  // 24
  outputs?: Array<{ port?: string }>                                                // 25
}
// inputs/outputs 即 NodeConnectionDef 的输入源，typeConnectionDef 转换（connection.ts:229）
```
- `NodeStore.types: ReadonlyMap<string, CanvasNodeType>`（29-31）；CanvasHost 拉 map 方式见 CanvasHost:239。

### 3.6 其它 host 侧相关

- `createMiniCanvasHost.ts` `CanvasHostHandle`（65-81）：ctx/save/nodeStore/edgeStore/nodeRegistry/themeRegistry/selection/command/history/nodeFactory/stop。themeRegistry 在句柄上（74），CanvasHost applyTheme 经 `hostRef.value.themeRegistry` 读（CanvasHost:176）。供能力层注册 connectionLine 赢家/读它。
- 热装热卸重装配：CanvasHost:336-343（plugin-installed/uninstalled → applyTheme + nodeEpoch++）。若 applyTheme 新增读 connectionLine，这里自动覆盖。
- 主题默认皮 theme-default 目前注册槽：`index.ts:118-124` nodeShell/edge/background/edgeDefaultType + settingsPanel，**没注册 connectionLine**。

---

## 四、canvas-render 现有测试清单 + 加接线会破坏哪些

测试目录 `packages/canvas-render/src/**/__tests__/`：

| 测试 | 测什么 | 加接线的影响 |
|---|---|---|
| `host/canvasHostCore.test.ts` | 纯逻辑：nodesFromStore 浅拷贝（23-40）、pruneDanglingEdges（42-52）、assembleTheme 读槽+回落（54-76）、默认外观常量（78-89）、edgeId（91-94） | **assembleTheme 若加 `connectionLine` 字段**，测试 54-76 需补断言（否则 TS/缺字段可能不过——vitest 只测已有字段，加字段不会挂，但建议补 case）。**其余不受影响**（不测 CanvasHost/CanvasSurface DOM） |
| `host/createMiniCanvasHost.test.ts` | host 装配（未读，属 host 层） | 不受 CanvasHost 接线影响（不经 CanvasHost.vue） |
| `host/fullchain.test.ts` | 内核+插件全链：建节点/持久化/命令/hot reload/**edgeStore 建边+撤销重做+边 id `e-1-2`** | **不经 CanvasHost.vue**（用 createMiniCanvasHost 直接 `host.edgeStore.addEdge`）。**不受接线影响** |
| `host/pluginManager.test.ts` | 安装句柄 | 不受影响 |
| `components/settingsSource.test.ts` / `utils/coalesce.test.ts` | 设置源适配 / 合帧 | 不受影响 |

**canvasHostCore.test / fullchain.test 里的连接相关断言：**
- canvasHostCore.test：**没有**直接连边断言；只有 assembleTheme 槽位读取（读 shell/edgeDefaultType/nodeTypes）。→ **这是你加 connectionLine 槽读取要补断言的地方**。
- fullchain.test：连接相关集中在 **252-368** 的"边下沉内核"与"边撤销"两块：
  - 建边写 edgeStore（258-259）、删端点节点连带清边（262-265）、undo 恢复边（268-270）；
  - 边 id 稳定 `e-1-2`（314 `expect.stringMatching(/^e-1-2$/)`）；
  - 拉边记历史 undo/redo（330-354）；
  - 重复连一边不新增历史（356-368）。
  - **这些都是直接调 `host.edgeStore`/`history`，不经 VueFlow / isValidConnection**。所以你在 CanvasHost/CanvasSurface 加接线（connect-start/end、connection-line 槽、isValidConnection 丢 reason 修复）**不会破坏 fullchain.test**——它根本不 mount VueFlow。

> **结论**：唯一会被"能力层新增代码"波及的是 `canvasHostCore.test.ts`（若给 `ThemeAssembly`/`assembleTheme` 加 `connectionLine` 字段与读取，建议补一条"读 connectionLine 槽 + 无槽回落 undefined"的 case）。CanvasHost/CanvasSurface 的接线改动无现有测试覆盖（这俩是 .vue 无组件级单测），测试面主要是纯逻辑。

---

## 五、v1 useCanvasConnection 纯几何/判定函数清单（供提取进能力层）

文件：`packages/canvas-core/src/composables/useCanvasConnection.ts`（v1 参考）。注意 v1 是**屏幕像素坐标 + DOM 查询**混合实现，能力层要抽的只是**不依赖 DOM 的纯算法**部分（改喂 flow 坐标）。

依赖比例常量（v1 canvas.state.core，来自 `useCanvasStore.ts`）：
```ts
handleRadius: 86            // useCanvasStore.ts:165
connectionSnapOuterRatio: 0.75   // :171
connectionSnapInnerRatio: 0.6    // :172
connectionSnapHeightRatio: 1.35  // :173
```
> 注意：v2 的 `CanvasParams`（canvasParamKey.ts）目前**只有 handleRadius 等 5 个端口尺寸**，**没有这 3 个 snap 比例**。能力层要么给 CanvasParams 加 `connectionSnapOuterRatio/InnerRatio/HeightRatio`（默认 0.75/0.6/1.35），要么能力层自建默认常量。

### 5.1 关键纯几何/判定函数 + 行号

| v1 函数 | 行号 | 作用 | 是否纯算法可抽 | 备注 |
|---|---|---|---|---|
| `getNodeSize(node)` | 118-127 | 取卡片逻辑尺寸（cardWidth/cardHeight data 优先，否则 width/DEFAULT） | 半纯（读 node.dimensions/data） | 依赖 DEFAULT_NODE_SIZE 常量 |
| `getNodeCardFlowRect(...)` | 130-145 | 节点卡片在 flow 坐标的矩形（直接用 position+size，无 DOM） | ✅ 纯 | **这版已是纯数据**，可整段带走 |
| `getNodeCardRectFromNodeElement(el)` | 148-150 | DOM getBoundingClientRect | ❌ DOM | v2 不用（改 flow 坐标 + nodeStore 尺寸，或经 VueFlow node.dimensions） |
| `findNearestValidTarget` | 303-357 | 屏幕坐标找吸附区最近可连 target | 半纯（DOM `.vue-flow__node` 遍历） | **算法可抽**：核心是 snap zone 判定 341-345 + 距离 350 |
| `findNearestValidSource` | 360-406 | 找 source（反向拖） | 半纯 | zone 判定 391-395 |
| `findNearestConnectableNode` | 409-422 | 按 startHandle 路由 target/source | ✅ 纯路由 | **用户点名要**；只是按 source/target 转发 |
| `findNodeBodyAtPoint` | 425-450 | 屏幕坐标是否落某节点 body | 半纯（DOM 遍历 + getBoundingClientRect） | **用户点名要**；算法=rect 内判断 441-445 |
| `getInvalidConnectionReason` | 457-484 | 返回"为何连不上"中文文案 | 纯（依赖 nodesById/edges/getNodeDefinition） | **用户点名要**；返回 `string` 文案（空串=合法）。**v2 用 `validateConnection().reason` 枚举替代**，文案可映射 |
| `buildConnectionEdgeProps` | 748-909 | 每帧算吸附线终点 + hover 反馈写回 | 大杂烩（含纯区 + reactive 写回区） | **吸附 zone 计算 752-787 纯可抽**；hoverNode 写回 858-886 是副作用 |
| `setInvalidConnectionFeedback`/`clear...` | 565-570 / 558-562 | 写 hoverNode | 副作用（写 canvas.connectionState） | v2 改写成 CanvasHost 维护的 state |
| `toFlowPosition(cx,cy)` | viewportSpace 工具 | client → flow | 纯 | v2 可用 useVueFlow().screenToFlowCoordinate 或自带函数 |

**吸附 zone 公式（v1 核心，buildConnectionEdgeProps 752-787 + BaseNode 576-579 一致）：**
```ts
const handleRadius = 86
const snapOuter = handleRadius * 0.75   // 朝节点外侧（从节点外沿往外的吸附带宽）
const snapInner = handleRadius * 0.6    // 朝节点内侧的吸附带深
const snapHeight = handleRadius * 1.35  // 纵向吸附带高（围绕端口中线的竖条）
const snapWidth  = snapOuter + snapInner
// snap zone 矩形（连到 target 端口，锚点在节点左缘中点）：
centerY = position.y + height/2
anchorX = isReverse ? position.x + width : position.x   // target 连点在左缘，source 连点在右缘
snapX   = isReverse ? anchorX - snapInner : position.x - snapOuter
snapY   = centerY - snapHeight/2
zone = { id, x: snapX, y: snapY, width: snapWidth, height: snapHeight, anchorX, anchorY: centerY }
// body zone（3D 反馈用）= 节点整卡矩形
body  = { id:`${id}-body`, nodeId:id, kind:'body', x:position.x, y:position.y, width, height }
```
BaseNode 同款 CSS 用法（`packages/canvas-core/src/components/Decoration/BaseNode.vue:576-579`）：吸附条宽 `handleRadius*(outer+inner)`、高 `handleRadius*heightRatio`、left 负 outer 倍。

**hoverNode 写回逻辑（v1 buildConnectionEdgeProps 858-886，重点坑）：**
- 逐帧比对当前 hover vs 下一帧候选（nodeId/status/zone/message/flowPosition 五项，860-866 判断 hoverChanged），变了才写。
- **用 rAF 节流写 reactive**（868-885 `requestAnimationFrame`），注释明确："render 阶段不能用 nextTick 写 reactive state，否则 hoverNode 变→BaseNode 重渲→connection-line 重渲→再写→Maximum recursive updates exceeded"。这是**在 connection-line 渲染函数里写 reactive 必须保留的防死循环手段**（能力层照搬 rAF 节流）。
- 命中优先级：snap zone（合法→吸附端点 endX/Y=anchor；非法→标 invalid）→ body zone（拖到卡上，非法→invalid message）→ 兜底 message='无法连接'。

### 5.2 纯算法部分建议落到 canvas-render 哪个文件/怎么组织

- 抽一个**纯函数模块**（零 Vue、Node 可测），放：
  `packages/canvas-render/src/connection/connectionFeedback.ts`（或 `src/connection/geometry.ts` + `reasonText.ts`）。命名与 `host/canvasHostCore.ts`、`utils/` 并列皆可；**避免塞进 canvasHostCore.ts**（那是 store→flow + 主题装配职责）。
- 该纯模块**接收 flow 坐标 + nodeStore 数据**（不是 DOM/屏幕坐标）：
  - `getNodeRectFlow(id, position, size)`（搬 130-145 版）；
  - `computeSnapZones(nodes, {isReverse, handleRadius, ratios})`（纯，搬 752-787）→ 返回 `{id,x,y,width,height,anchorX,anchorY}`；
  - `computeBodyZones(nodes)` → body rect；
  - `hitTest(zones, flowPoint) → zone|null`（点是否在矩形内）；
  - `resolveFeedback(nodes, flowPoint, startHandle, sourceId, validateFn)` → `{snappedTo?, invalidNode?, zone, reason}` 纯决策；
  - reason → 中文文案的 `reasonText(reason: InvalidReason): string`（映射 connection.ts 枚举到用户文案）。
- CanvasHost 维护 **reactive state**（供注入 + BaseNode 读），并**只做副作用**：connect-start 置 active、连接线渲染时经 rAF 写 hoverNode、connect-end/connect 清空。
- 这样纯算法可 Node 单测（vitest），reactive 副作用留在 CanvasHost.vue（与现架构 canvasHostCore 纯逻辑 / CanvasHost 接线一致）。

---

## 六、建议的"能力层"最小契约草案（只列签名/字段，不写实现）

> 这是研究结论，不是已实现。字段/命名可按你喜好调整，关键是把**坐标单位（一律 flow）**与**reason 透传链路**钉死。

### 6.1 一个响应式 `ConnectionFeedbackState`

新契约文件建议 `packages/canvas-render/src/contracts/connectionContext.ts`（或塞进 renderContext.ts）：

```ts
// flow 坐标系下的点（复用 edgeContext 无现成，自建最小）
export interface FlowPoint { x: number; y: number }

/** 拖线时悬停的目标节点反馈（给 BaseNode 做 3D/气泡/吸附带） */
export interface HoverFeedback {
  nodeId: string
  status: 'valid' | 'invalid'
  /** 命中区域：'snap'=吸附带内(可吸附)，'body'=落在卡上(非端口精确命中) */
  zone: 'snap' | 'body'
  /** 鼠标当前画布坐标（供 BaseNode 定位气泡等） */
  flowPosition: FlowPoint
  /** invalid 时的文案（非法气泡用） */
  reason?: string
}

/** 拖线进行中的源端信息 */
export interface ActiveConnection {
  sourceNodeId: string
  sourceHandle: 'source' | 'target'   // 决定连线方向(isReverse)
}

/** 能力层对外暴露的响应式反馈状态（字段可用 Ref 或整体 reactive，推荐 Ref 子字段，参照 EdgeSelection） */
export interface ConnectionFeedbackState {
  isConnecting: boolean                       // 派生：activeConnection !== null
  activeConnection: ActiveConnection | null
  hoverNode: HoverFeedback | null             // 供 BaseNode 读 3D/气泡
  suppressHandles: boolean                    // 拖线期间压住其它端口（v1 语义）
}
```

**放哪**：`CanvasRenderContext`（renderContext.ts:33-48）尾部加一个字段 `connectionState: ConnectionFeedbackState`。**注入**：CanvasSurface 组装 renderCtx（67-75）时带同一引用并 `provide`；`useCanvasRender()`（renderContext.ts:57-63）返回自然包含它，theme-default BaseNode 直接 `const { connectionState } = useCanvasRender()`（其现有解构见 BaseNode.vue:20 模式）。旧令牌无需新加（RENDER_CONTEXT 已收口）；BaseNode 就加这一行解构。

> 备选放 renderContext 之外的方案不推荐：BaseNode 已经统一走 useCanvasRender，散出去又要 inject。

### 6.2 CanvasHost 新增内部 handler 与 CanvasSurface 新增模板接线

**CanvasHost.vue 侧（新增函数，进 props 传下）**
```ts
// connect-start：写 active + 压端口
function onConnectStart(p: OnConnectStartParams & { event?: MouseEvent|TouchEvent }): void
//   → connectionState.activeConnection = { sourceNodeId: p.nodeId!, sourceHandle: p.handleId as 'source'|'target' }
//   → isConnecting=true, suppressHandles=true, hoverNode=null
function onConnectEnd(e?: MouseEvent|TouchEvent): void
//   → 兜底清空（connect 走不到时）：active=null, suppressHandles=false, hoverNode=null, isConnecting=false
//   （如需"拖到节点主体/空白也想建边/上报"在这里用 screenToFlowCoordinate 找节点——v1 释放逻辑所在，按需取舍）
function onConnect(conn: Connection): void        // 现有 247-264 保留，加 finally 清空反馈
```

**连接线渲染时的 hover 计算**（不是新事件，是 `#connection-line` 插槽内容里每帧算）：
```ts
// CanvasSurface 内 #connection-line 模板里调用（见 6.5），每帧算一次：
function renderConnectionFeedback(props: ConnectionLineProps): void
//  纯算：resolveFeedback(...)（§5.2 纯模块）→ 若 hoverChanged，rAF 节流写 connectionState.hoverNode
//  返回当前连接线终点（吸附或鼠标 flow 点）
```

**CanvasSurface.vue 模板接线（89-104 处增补）**
```html
<VueFlow ... @connect-start="onConnectStart" @connect-end="onConnectEnd">
  <!-- #connection-line 插槽：渲染 themeRegistry connectionLine 赢家或默认 -->
  <template #connection-line="connProps">
    <ConnectionLineFeedback :props="connProps" :state="connectionState"
                             :nodes="flowNodes" :get-reason="..." />
  </template>
  ...
</VueFlow>
```

### 6.3 给 `themeRegistry` 的 `connectionLine` 槽留渲染位（assembleTheme 补读）

- `canvasHostCore.ts`：
  - `ThemeAssembly`（50-61）加 `connectionLine: unknown`；
  - `assembleTheme`（67-83）加 `connectionLine: theme?.get('connectionLine')`（74-75 附近）；
- `CanvasHost.applyTheme`（173-186）加 `const cl = markRaw(asm.connectionLine)` → 塞进一个新 `connectionLineComp = shallowRef()` 传入 CanvasSurface；
- CanvasSurface 收到后，`#connection-line` 槽内 `<component :is="connectionLineComp || DefaultConnectionLine" v-bind="connProps" .../>`。
- theme-default（index.ts:118-124）再补 `ctx.theme.register('connectionLine', MyConnectionLine)` 即成默认皮。

### 6.4 vueFlowBridge.ts 需补的导出（精确项）

`packages/canvas-render/src/vueFlowBridge.ts` 目前（13-16）只 re-export `Handle/Position/getBezierPath/useVueFlow` + `type EdgeProps/NodeProps`。能力层/插件（connection-line 自定义组件、BaseNode、CanvasHost 模板）要碰的类型补齐：

```ts
// 运行时（若 connection-line 组件要 getBezierPath 等已足够；补齐需要的）
// 类型（从 @vue-flow/core）：
export type {
  ConnectionLineProps,        // 渲染 #connection-line 组件/插槽必须
  OnConnectStartParams,       // connect-start handler 参数
  Connection,                 // connect/connect-end handler
  ConnectionMode,             // 读 connectionMode / 给 <VueFlow> 传
  ConnectionStatus,           // 'valid'|'invalid'|null
  ConnectionLineType,         // 默认线型枚举
  HandleElement, ConnectingHandle,  // 若 BaseNode 读 useConnection().startHandle
  ValidConnectionFunc,        // isValidConnection 签名
} from '@vue-flow/core'
```
> 需不需要运行时 `useConnection`：BaseNode 想读"是否在拖/拖向哪"可 `export { useConnection } from '@vue-flow/core'`（index.d.ts 已导出，见前面）。按需补。注意 index.ts 里 `export * from './vueFlowBridge'`（index.ts:25），补的导出自动对外。
> **声明 clash 提示**：vueFlowBridge 未导出 `Node`/`Edge` 顶层别名（@vue-flow/core index 的 Node 与内核 CanvasNode 可能撞名），建议只补上述具名类型，不 `export *` 整类型命名空间，保持"精选出口"边界（见 vueFlowBridge 顶部注释 9-11）。

### 6.5 validateConnection 的 reason 怎么透传成反馈（关键决策）

**现状断链**：CanvasHost.isValidConnection（236-245）把 `res.ok` 当布尔返回，reason 丢弃。VueFlow 只在 handle 精确命中时才会拿 isValidConnection 结果触发 @connect，且**不把 reason 给 UI**。

**方案（推荐：不是只在 connect 算一次，而是连接线渲染时逐帧重算）**：
- 正因为 reason 判定依赖"鼠标当前落在哪个节点上/吸附区"，而鼠标位置只在 `#connection-line` 渲染时每帧可知，所以**在 `#connection-line` 内容里每帧调用纯模块**：
  ```ts
  // 伪签名（纯模块，§5.2）
  function resolveFeedback(args: {
    sourceId: string; sourceHandle: 'source'|'target';
    nodes: FlowNode[];            // flow 节点(position + size + type)
    flowPoint: FlowPoint;         // = connProps.targetX/Y
    validate: (conn: ConnectionInput, edges) => ValidationResult;  // 复用内核 validateConnection
    handleRadius: number; ratios: SnapRatios;
  }): { end: FlowPoint; hover: HoverFeedback | null }
  ```
  - 内部：先算 snapZones/bodyZones，命中哪个 → 用该 (sourceId, candidateId, handle) 调 `validateConnection(...)` 拿 `reason`（枚举）→ 组装 `HoverFeedback{status, zone, reason: reasonText(reason)}` → rAF 节流写 `connectionState.hoverNode`。
- **每帧重算 vs connect 算一次**：拖线中要的是**实时** hover（从合法区拖进 body 立刻变 3D/气泡、拖出立刻消失），只在 connect 时算一次拿不到过程反馈。所以走插槽每帧重算。最终建边合法性仍交给现有 @connect（Handle 精确命中）或 connect-end 兜底（VueFlow 不触发 connect 的节点主体/空白释放场景）。
- **reason 是内核枚举**（connection.ts:73-82），文案映射 `reasonText(reason: InvalidReason): string` 放纯模块（可映射为 v1 的中文：type-not-accepted→"××不接受××输入"、duplicate→"已连接"、cycle→"会成环"、self-loop→"不能连自己"、default→"无法连接"）。**避免把内核枚举字符串直接塞给 BaseNode 当文案**——BaseNode 气泡显示 reasonText 结果。

### 6.6 BaseNode（theme-default）消费示意（非本能力层实现，仅对齐契约）

BaseNode.vue 已 `const { registry, nodeWrite, handleParams } = useCanvasRender()`（20 行）；补 `const { connectionState } = useCanvasRender()`（或合并解构）。据此做：
- 3D 倾斜/非法气泡/吸附带：`computed` 追踪 `connectionState.hoverNode`，命中本节点 id → 上 zone/status/message；
- 用 `props` 里选中的 `isConnecting`/自己的 nodeId 判断是否是"当前源节点"，抑制本卡浮动端口（suppressHandles）。
- 不用再自建全局 state / 不用碰 @vue-flow/core 内部——canvas-render 已把反馈投影成它认识的 hoverNode。

---

## 七、风险 / 注意事项清单

1. **`@connect-stop` 不存在**（1.48.2）：清空逻辑只放 `@connect-end` / `@connect` / `onBeforeUnmount`。若目标是更新版本再查，但锁定的 1.48.2 就是 connectStart/connectEnd/connect(+click 系)。
2. **`ConnectionLineProps` 无 sourceHandleId/targetHandleId/fromHandle**（1.48.2）：v1 代码对 connectionLineProps 的这些读法不能照抄；改读 `sourceHandle.id/type`、`connectionStatus`、`sourceNode.id`。逆连判断（source/target 谁先）以 `activeConnection.sourceHandle` 为准（v1 也这么干，useCanvasConnection.ts:750-751）。
3. **在 connection-line 渲染函数里写 reactive 会死循环**：必须保留 v1 的"hoverChanged 比对 + rAF 节流"（858-886），否则 Maximum recursive updates。
4. `connectionPosition`（useConnection().position）是**容器相对像素**非 flow；`#connection-line` 的 targetX/Y 才是 flow。别混用。
5. VueFlow `connectionMode` 默认 **Loose**：非法反馈不能依赖 VueFlow 自动判定，得能力层自算（isValidConnection + 每帧 resolveFeedback）。
6. VueFlow 自带 `connectOnClick`（默认 true）+ `connectionClickStartHandle`：点选连接也会走 clickConnectStart/clickConnectEnd，能力层若只接 connect-start/end 不覆盖点选连接，可能漏清状态——建议 connect-end 统一清（click 也触发 connect-end？需实测确认，clickConnect* 独立 emit，**留意点选路径要另接 clickConnectStart/clickConnectEnd 或关 connectOnClick**）。
7. `screenToFlowCoordinate` 在 Node 单测/未挂载时是占位恒等，别在纯逻辑里依赖它；能力层纯模块只收 flow 坐标。
8. CanvasHost 的 `<VueFlow>` 在 CanvasSurface（boot 完成后挂载）。connection 事件/插槽都在 VueFlow 里，天然 boot 后生效，无时序坑。
9. 测试仅 canvasHostCore.test 会因新增 `connectionLine` 装配字段建议补 case；fullchain.test 等不经 VueFlow 不受影响。

---

## 八、给写能力层方案的下一步清单（对照本文档即可动笔）

- [ ] 新契约 `connectionContext.ts`：ConnectionFeedbackState/HoverFeedback/ActiveConnection（§6.1），挂 `CanvasRenderContext` + CanvasSurface 组装 + useCanvasRender。
- [ ] 纯算法模块 `src/connection/*`（flow 坐标 + nodeStore，Node 可测）：zone 计算 / hitTest / resolveFeedback / reasonText（§5.2、§6.5）。
- [ ] canvasHostCore `ThemeAssembly`+`assembleTheme` 补 `connectionLine`（§6.3）+ canvasHostCore.test 补 case。
- [ ] CanvasHost：onConnectStart/onConnectEnd + 现有 onConnect 加清空 + applyTheme 读 connectionLine + 维护 reactive connectionState（§6.2）。
- [ ] CanvasSurface `<VueFlow>`：绑 @connect-start/@connect-end；加 `#connection-line` 槽渲染 winner/默认 + 每帧 resolveFeedback（rAF 节流写 hoverNode）（§6.2、§6.5）。
- [ ] vueFlowBridge 补 ConnectionLineProps/OnConnectStartParams/ConnectionMode/ConnectionStatus/ValidConnectionFunc 等具名类型导出（§6.4）。
- [ ] theme-default：注册 connectionLine 槽默认皮；BaseNode 消费 connectionState 做 3D/气泡/吸附带。
