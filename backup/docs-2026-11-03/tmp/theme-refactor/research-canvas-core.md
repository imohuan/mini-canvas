# canvas-core v1 `Decoration` 组件与连接反馈机制 —— 移植调研报告

> 调研目标：把 `@mini-canvas/canvas-core` (v1) `Decoration/` 目录下 BaseNode/MovingHandle/BaseTitle 等组件
> 及它们驱动的"好效果"（3D 连接反馈倾斜、合法/非法连接提示、吸附区 debug、resize、浮动端口、标题反缩放、
> `--canvas-node-*` 主题变量）搬到 `@mini-canvas/plugin-theme-default`（走 `@mini-canvas/canvas-render` 的
> `useCanvasRender()` 统一上下文）。
>
> 本文档逐项记录 v1 参考实现（职责/props/逻辑/依赖）与 render 侧的差异，供直接据此写移植方案。
>
> 调研方式：codegraph + read_file 通读 v1 源码，并对照 v2/render 侧 `CanvasHost/CanvasSurface/canvas-core-v2` 实际能力。

---

## 0. 一句话结论（先看这个）

- **能搬**：MovingHandle 浮动端口（几何/状态机逐行可拷，render 侧 `handleParams` 恰好提供全部 5 个尺寸字段）；
  BaseTitle 标题条（纯 props 展示组件）；标题反缩放布局几何（`1/max(zoom,minZoom)` 公式）、3D 倾斜 / debug / tooltip
  的**纯 CSS + 定位数学**；resize 拖拽逻辑（`vf.updateNode` 可等价替换为 render 侧的 nodeWrite / nodeStore）。
- **搬不了 / 缺口大**：v1 那套"拖线过程中逐帧更新 `canvas.connectionState.hoverNode`（valid/invalid/snap/body +
  flowPosition）"的**反应式连接状态机**。render 侧 `CanvasHost`/`CanvasSurface` **完全没有** `@connect-start` /
  `@connect-end` / `#connection-line` slot，也不提供 pinia store 或等效的反应式 `connectionState`。v2 的
  `connection.ts` 只是**纯函数校验**（validateConnection），无任何"拖线过程反馈"状态。→ 3D 倾斜、invalid 气泡、吸附
  zone debug 这些**全部依赖拖线过程中的 hoverNode**，render 侧当前没有数据源能驱动它们。
- **节点类型定义缺字段**：render 侧 `CanvasNodeType` 没有 `titleIcon` / `resizable` / `canReceiveInput` /
  `canProduceOutput`（只有 `inputs`/`outputs` 声明）。BaseNode 里读 `nodeDef` 的字段（titleIcon、canReceiveInput）
  在 render 侧拿不到同名字段。

各效果的依赖缺口与替代方案见 §5、§6。

---

## 1. 组件与文件布局总览

### 1.1 v1 canvas-core `Decoration/` 目录（8 个文件）

| 文件 | 角色 | 被谁引用 |
|---|---|---|
| `BaseNode.vue` (28KB) | **节点壳（卡片）**，几乎所有"效果"的宿主 | `CustomNode.vue`（VueFlow nodeTypes.custom） |
| `MovingHandle.vue` (13KB) | 浮动端口（锚点+半圆区+圆球），左右各一个实例 | `BaseNode.vue`（同目录 `./MovingHandle`） |
| `BaseTitle.vue` (2.6KB) | 标题条展示（icon+label+extra 三段） | `BaseNode.vue`（同目录 `./BaseTitle`，在 `#title` slot 内） |
| `NodeToolbar.vue` (3.6KB) | 跟随节点浮动的工具栏（Teleport 到 viewport） | `CustomNode.vue`、`Toolbar/BaseToolbar.vue` |
| `ToolbarButton.vue` (6.8KB) | 工具条按钮 + 下拉 | `Toolbar/BaseToolbar.vue` |
| `ResizeHandle.vue` (1.7KB) | 8 向裁剪/扩展控制柄（**通用**，非 BaseNode 专用） | 仅 `nodes/image/ImageCropper.vue`、`ImageExpander.vue` |
| `node-theme.css` (1.5KB) | `--canvas-node-*` 变量默认值（`:root`） | `canvas-core/src/index.ts`（全局 import） |

### 1.2 BaseNode 的依赖链

```
BaseNode.vue
├── ./MovingHandle.vue
├── ./BaseTitle.vue
├── useCanvasStore()  →  canvas (pinia store: state.core.* / isConnecting / connectionState)
├── useVueFlow()      →  vf (viewport / getNodes / updateNode)
├── useCanvasRuntime()→  runtime.nodeRegistry.get(nodeType)
├── utils/viewportSpace → createNodeTitleLocalLayout / clamp
└── utils/constants   →  CONNECT_FEEDBACK
```

### 1.3 组装结构：CustomNode 是 BaseNode 的"容器"

- v1 里 VueFlow 每个节点 type 都指向 **`CustomNode.vue`**（nodeTypes.custom），`CustomNode` 再根据
  `nodeDef.selfRender` 决定：自渲染 or 组装 `<BaseNode>`。
- `CustomNode` 给 `BaseNode` 喂：`#top-toolbar`（NodeToolbar+TopToolbarComponent 或 BaseToolbar）、
  `#content`（ContentComponent）、`#bottom-toolbar`（NodeToolbar+BottomToolbarComponent 或 BaseToolbar）。
- **render 侧（v2）没有 CustomNode 这一层**：CanvasHost 直接把 themeRegistry 的 `nodeShell`（= 插件 BaseNode）
  作为 VueFlow 每个 type 的唯一 node 组件（`assembleTheme` → `nodeTypes[t] = shell`）。插件 BaseNode 自己
  `resolveSegment(registry, type, 'content'/'title'/'top-toolbar'/'bottom-toolbar')` 分段渲染。这段插件版已经做对。

---

## 2. 逐组件职责 / props / emits / 逻辑 / 依赖

### 2.1 BaseNode.vue（核心）

**Props**：`NodeProps & { cardWidth?: number; cardHeight?: number }`（NodeProps 含 id/type/data/selected/targetPosition/sourcePosition…）
**无 emits**（除给子组件透传）。**Imports**：Position/useVueFlow/@vue-flow、MovingHandle、BaseTitle、
useCanvasStore、useCanvasRuntime、createNodeTitleLocalLayout+clamp、CONNECT_FEEDBACK。

依赖的三个全局对象：
- `canvas = useCanvasStore()` —— pinia。读 `canvas.state.core.*`（几十个配置）、`canvas.isConnecting`、
  `canvas.connectionState.*`。
- `vf = useVueFlow()` —— 读 `vf.viewport.value.zoom`、`vf.getNodes`、调 `vf.updateNode(id,{data})`。
- `runtime = useCanvasRuntime()` —— 只 `runtime.nodeRegistry.get(nodeType)` 拿 `CanvasNodeDefinition`
  （字段见 §5.3）。

**卡片尺寸**：`cardWidth/cardHeight` 是两个本地 `ref`，初值 `data.cardWidth || prop.cardWidth || 256`；
watch `data.cardWidth/cardHeight`（非拖拽期同步）；**resize 拖拽会改写 cardWidth/cardHeight 并回写 data**。

各 computed/逻辑清单（全见 §3 BaseNode 效果清单）。

### 2.2 MovingHandle.vue（浮动端口）—— 可直接照搬

**Props**：`id / type('source'|'target') / position / visible? / disabled? / radius? / restOffset? / cursorGap? /
buttonSize? / overlap? / preview? / debug?`
**Emits**：`hover: [boolean]`、`connectStart: [{event, type}]`。
**依赖**：`Handle, Position`（@vue-flow/core）、`clamp`（viewportSpace）。**无 pinia、无 runtime 依赖** —— 这是它
能 100% 移植的关键。CSS 用了 `--canvas-node-*` 变量（v2 版已改成字面色值）。

关键机制：
- **锚点** `:is="preview ? 'span' : Handle"`，class `moving-handle-anchor`，1×1px、top 50%、`transform: translateY(-50%) !important`、
  `pointer-events: all`；source 贴右缘（`right:0`），target 贴左缘（`left:0`）。这就是真实 VueFlow 连接点。
- **半圆可移动区** `<span class="moving-handle-zone">`：`width/height=radius`、`transform: translate3d(0,-50%,0)`、
  source 用 `clip-path: inset(0 0 0 overlap)`（裁掉伸进节点内侧部分）向右侧露出、target 对称。mouseenter/leave/move 全在这里。
- **圆球** `.moving-handle-button`：`buttonStyle` 计算 left/top，source `left=buttonX`、target `left=buttonX+5`
  （补偿 `.vue-flow__handle` 自带 `min-width:5px`）；`transform: translate(-50%,-50%) scale(isMoving?1.06:1)`。
- 位置几何（`updatePosition`，注意**用区域本地坐标而非屏幕 px**，避开 VueFlow 缩放后 getBoundingClientRect 偏差）：
  - `outward = source? localX : radius-localX`，`rawY = localY - radius/2`（区域本地，圆心在 `(source?0:radius, radius/2)`）；
  - `mouseX = clamp(outward,0,radius)`，`mouseY = clamp(rawY,-radius/2,radius/2)`；
  - 圆球跟手距离 `followDistance = clamp(hypot(mouseX,mouseY)+cursorGap, 0, radius-buttonSize/2)`，
    `ballX = cos(angle)*followDistance`，`ballY = sin(angle)*followDistance`；
  - `commitPosition(direction*(ballX-overlap), ballY)`（经 rAF 写入 buttonX/Y，见注释防重复帧写入）。
- **归位动画**：`restoreDuration=180ms`；rest 偏移 = `direction*(restOffset-overlap)`（略缩进节点内侧）。
  - CSS：`.moving-handle-anchor.is-restoring` 过渡 `top/left/right 180ms ease-out`；`.moving-handle-button` 走
    `left/top 180ms cubic-bezier(.25,1,.5,1)`，出区后 180ms `setTimeout` 才把 `keepVisible=false` + emit hover false。
  - `handleLeave` 先 `restorePosition()` 再延时 hide，保证"先归位动画再淡出"。
- **disabled watch**：连接拖拽时源口 disabled → 清 hover/keepVisible/isMoving/isRestoring + emit hover false + restorePosition，
  避免连线释放后圆球因残留状态重新顶出（注释专门强调不能加 :hover 兜底）。
- `visible`（来自父 shouldShowHandles）决定是否常态显示；`isShown = !disabled && (visible || keepVisible)`。
- `preview` 模式：根是 `span`（非真实连接点），mousedown emit `connectStart`（供临时连线/端口区拖线用，v1 selection 批量连线用到）。
- debug 模式：绘制半圆路径/圆心/rest/mouse 辅助线（svg，`preserveAspectRatio:none`）。

### 2.3 BaseTitle.vue（标题条）—— 可直接照搬

**Props**：`label? / titleIcon?(Component|string|null|false) / titleStyle? / interactive? / editing?`
**无 emits、无外部依赖**（只 vue computed）。
模板：`title-icon` slot（titleIcon 组件 / HTML 字符串 v-html / 默认 svg）→ `title-label` slot（默认文本）→ `title-extra` slot。
CSS：`.base-title` 有 `pointer-events:none`，`interactive` 才 `auto`；`title-label` 占宽 80% 椭圆省略、`title-extra` 占 ≤20%。
用途：v1 BaseNode 把它放在**卡片内部**继承 3D transform 的标题容器里（见 §3-B5）。

### 2.4 NodeToolbar.vue —— v1 专供 toolbar，非卡片特效宿主

**Props**：`nodeId / isVisible / position / offset / align / alignOffset / zIndexOffset`（默认 Top,10,center,0,0）。
从 `inject(NodeIdInjection)` 取当前节点，`useVueFlow()` 拿 viewportRef/viewport/getSelectedNodes/findNode。
用 `getRectOfNodes` + viewport 算 transform 把工具条 **Teleport 到 `viewportRef`** 贴到节点外；只在
"单节点选中且是唯一选中"时 `isActive`。
依赖 pinia `canvasStore.isBoxSelecting`（框选时隐藏）。**render 侧无 isBoxSelecting 等价**——但 toolbar 一般宿主会关
VueFlow 原生框选或可忽略。
**结论**：NodeToolbar 是"跟随节点的工具条容器"，与"卡片特效"无关；插件 BaseNode 目前用 `top-toolbar/bottom-toolbar`
段 + slot 自渲染工具栏，不需要它。

### 2.5 ToolbarButton.vue —— 通用工具条按钮+下拉

props：icon/title/tooltip/variant/danger/disabled/dropdown/customRender/commandContext；emit action/dropdown-select。
纯展示 + 下拉菜单（Teleport to body），CSS 用 `--canvas-node-*`（有 `rgba(...)` fallback）。无 store 依赖。
与卡片特效无关，BaseToolbar（v1 节点上下文工具条）用它。插件不需要搬到 BaseNode。

### 2.6 ResizeHandle.vue —— **与 BaseNode 的 resize 无关**

**重要澄清**：BaseNode.vue **没有引用 ResizeHandle.vue**。BaseNode 的 resize 是**自己写在 BaseNode 内的**
右下角对角线句柄（`resizable` 为 true 时显示 `.resize-handle`，pointerdown/move/up 改 cardWidth/cardHeight）。
ResizeHandle（8 向白底黑边小方块）仅供 v1 `nodes/image/ImageCropper`、`ImageExpander` 这类"裁剪/扩展"面板复用。
→ 移植时**别把 ResizeHandle 混进卡片 resize**；卡片 resize 逻辑照 BaseNode 内的那套搬即可。

---

## 3. BaseNode "效果"完整清单（逐项：class/computed/watch/模板/触发/数据源）

### A. 基础状态派生

| computed | 公式 / 逻辑 | 数据来源 |
|---|---|---|
| `nodeDef` | `data.nodeType ? runtime.nodeRegistry.get(nodeType) : null` | **runtime.nodeRegistry** |
| `zoom` | `Math.max(vf.viewport.value.zoom \|\| 1, 0.01)` | **vf.viewport** |
| `lowDetail` | `zoom < (canvas.state.core.nodeLodLowDetailZoom ?? 0.4)` | **canvas.state.core.nodeLodLowDetailZoom** (默认 0.4) |
| `titleLayout` | `createNodeTitleLocalLayout(zoom, {offset: core.nodeTitleOffset, minZoom: core.nodeTitleScaleMinZoom})` | core.nodeTitleOffset(12) / core.nodeTitleScaleMinZoom(0.5) |
| `titleOffset` | `titleLayout.offset` | 上面 |
| `cardBorderCompensation` | `Math.max(1/zoom, 1)` | zoom |
| `titleMinZoom` | `core.nodeTitleScaleMinZoom \|\| 0.5` | core |
| `titleCanvasWidth` | `cardWidth * Math.max(zoom, titleMinZoom)` | cardWidth+zoom+minZoom |
| `titlePositionStyle` | 见 §3-B5 | — |
| `isHovered` | `ref(false)`，mouseenter=true / mouseleave=false | DOM 事件 |
| `mousePosition` | `ref({x:.5,y:.5})` 卡片内 0~1 | `updateCardMousePosition` |

### A2. 端口显示判定（showTargetHandle / showSourceHandle）— 依赖 props.position + nodeDef

```
showTargetHandle = props.targetPosition !== undefined ? Boolean(props.targetPosition)
                   : (nodeDef?.canReceiveInput ?? true)
showSourceHandle = props.sourcePosition !== undefined ? Boolean(props.sourcePosition)
                   : (nodeDef?.canProduceOutput ?? true)
```
含义：优先用节点数据显式带的 targetPosition（VueFlow node 级字段）；没显式设置时**按节点类型定义能力**决定，
而不是创建节点时附带的数据 —— 注释强调"端口由节点类型是否有输入/输出能力决定"。

### A3. 端口/连线反馈主开关组

```
debugHandle            = Boolean(core.handleDebug || data.debugHandle || data.debugHandles)
isCurrentConnectingNode= canvas.isConnecting && activeConnection.sourceNodeId === props.id
shouldShowHandles      = !lowDetail && !connectionState.suppressHandles && !isCurrentConnectingNode
                         && (isHovered || props.selected)
connectionHover        = canvas.isConnecting && connectionState.hoverNode?.nodeId === props.id
                         ? connectionState.hoverNode : null
isConnectionSnapHovered = connectionHover?.zone === 'snap'
isConnectionBodyHovered = connectionHover?.zone === 'body'
isConnectionValidTarget = connectionHover?.status === 'valid'
isConnectionInvalidTarget= connectionHover?.status === 'invalid'
```

### A4. 连接反馈/吸附 debug 显示开关

```
showConnectFeedback = canvas.isConnecting
  && activeConnection.sourceNodeId !== props.id
  && !isConnectionInvalidTarget
  && !lowDetail
  && (isHovered || isConnectionValidTarget)

showTargetZones    = canvas.isConnecting && activeConnection.sourceNodeId !== props.id && showTargetHandle
shouldShowTargetZones = showTargetHandle && (core.connectionSnapDebugVisible || showTargetZones)
```
`shouldShowTargetZones && debugHandle` 时渲染吸附 zone debug 层（§模板 T4）。zone 尺寸计算：
`width = handleRadius*(connectionSnapOuterRatio+connectionSnapInnerRatio)`、
`height = handleRadius*connectionSnapHeightRatio`、`left = -handleRadius*connectionSnapOuterRatio`、
`top = calc(50% - handleRadius*connectionSnapHeightRatio/2)`。
（对应 CSS 里 `.target-snap-zone`。v1 useCanvasConnection 的 snap 区域换算也完全同此，见 §4。）

### B. 具体"效果"分类

#### B1. 3D 连接反馈倾斜（核心效果）
- 触发：`showConnectFeedback`（拖线中 + 非本节点 + 非 invalid + 非低细节 + hover 或 valid target）。
- CSS transform（`cardTransform`）：
  ```
  isConnectionInvalidTarget → ''（invalid 不倾斜，只用模糊）
  showConnectFeedback false  → ''
  rotateX = (p.y-0.5) * CONNECT_FEEDBACK.rotateX      // 18
  rotateY = (p.x-0.5) * -CONNECT_FEEDBACK.rotateY     // 18
  → `perspective(800px) rotateX()deg rotateY()deg translateZ(10px) scale(1.018)`
  ```
  `p = feedbackMousePosition`（卡片内 0~1）。
- `feedbackMousePosition`：当 `connectionState.hoverNode.nodeId===props.id && hoverNode.status==='valid'` 时用
  `hoverNode.flowPosition` 换算节点内百分比：找 `vf.getNodes.find(id).computedPosition||position`，
  `x=clamp((flow.x-node.x)/cardWidth,0,1)`，`y=clamp((flow.y-node.y)/cardHeight,0,1)`；否则回落物理 mousePosition。
  → **数据源 = connectionState.hoverNode.status/flowPosition + vf.getNodes + cardWidth/Height**。
- `mousePosition`（物理鼠标在卡片内的 0~1）在 `updateCardMousePosition`（mousemove，仅在 showConnectFeedback 或 debug
  时计算）更新，是 3D 倾斜的 fallback 输入。
- class：卡片 `is-connecting-hover`（showConnectFeedback）、根 `is-connection-valid`。

#### B2. 合法/非法连接的视觉
- 合法：`is-connection-valid`（根）+ `is-connecting-hover`（卡片，仅改 `border-color: var(--canvas-node-border-selected)`）
  + 3D 倾斜（B1）+ 卡片 `scale(1.018)` 放大。
- 非法：`is-connection-invalid`（根+卡片）→ 卡片 `border-color: rgba(156,163,175,0.45)` 且
  `::after` 伪元素盖一层 `rgba(255,255,255,.25)` + `backdrop-filter: blur(1.5px)`（内容模糊），不倾斜。
- 非法气泡：模板 `<div class="invalid-connection-tooltip">` 只在 `isConnectionInvalidTarget` 渲染，
  文本 `connectionState.hoverNode?.message || '无法连接'`。

#### B3. invalid 气泡定位（invalidTooltipStyle / invalidFeedbackPosition）
```
point = hoverNode.status==='invalid' ? hoverNode.flowPosition : null
若非 invalid 或无 point → {x:0.08, y:0.5}（默认靠左中）
否则 node=vf.getNodes.find(id); position=computedPosition||position
x = clamp((point.x-position.x)/cardWidth , 0.06,0.94)
y = clamp((point.y-position.y)/cardHeight, 0.08,0.92)
style: left = x*100% , top = y*100%  （CSS transform: translate(-50%,-50%) 居中，圆角胶囊）
```
→ 数据源 = **connectionState.hoverNode.flowPosition** + vf.getNodes 位置 + cardWidth/Height。

#### B4. 目标吸附区 debug 可视化（T4 模板）
见 A4 + §3 模板 T4。zone 尺寸全由 `core.handleRadius` × `connectionSnap*Ratio` 算，配色走 CSS 变量。

#### B5. 标题条与反缩放（title 容器/位置几何）
模板里标题容器 `.custom-node-title` 是 **cardInlineStyle 卡片的直接子节点**（放卡片内部、继承卡片 3D transform），
绝对定位。
- `titlePositionStyle` = `{ ...titleLayout.style, left: -cardBorderCompensation px, bottom: calc(100% + titleOffset+cardBorderCompensation px), width: titleCanvasWidth px }`
- **反缩放几何公式**（注释写明推导）：
  - 标题**屏幕宽**应 == 卡片**屏幕宽**：标题屏幕宽 = `DOM宽 * zoom / max(zoom,minZoom)`；卡片屏幕宽 = `cardWidth * zoom`。
    解得 **标题 DOM 宽 = `cardWidth * max(zoom, minZoom)`**（= titleCanvasWidth）。
  - `createNodeTitleLocalLayout`（viewportSpace.ts）：
    `scale = 1 / max(safeZoom, minZoom)`；`offset = baseOffset * scale`；style `transform: scale(scale)` origin `left bottom`。
  - 注意 v1 BaseNode 用的是 **LocalLayout**（反缩放，卡内布局被 zoom 放大后靠 `1/max(zoom,minZoom)` 缩回）而非
    createNodeTitleLayout（那个是 `min(1, zoom/minZoom)` 纯衰减，用于画布/外层）。
- 容器 class 加 `nodrag nopan`；事件：mouseenter 清 isHovered、mouseleave 恢复、dblclick.start → startTitleEdit，
  pointerdown/up/click 全 stop（避免触发拖节点）。
- **就地重命名**：双击标题 / 全局 F2（仅选中时绑 document keydown）进入编辑；Enter/blur 提交（trim，空则删 label）、
  Esc 取消（skipBlurCommit 防 blur 二次提交）。提交用 `vf.updateNode(id,{data:{...props.data,label}})`。

#### B6. resize 拖拽逻辑（v1 BaseNode 内置，非 ResizeHandle 组件）
- 触发：`resizable = data.resizable === true`（nodeDef.resizable 不直接驱动，靠 data.resizable）。
- 句柄：卡片右下角 `.resize-handle`（16×16、nwse-resize、pointerdown/move/up）。
- 逻辑：
  - `onResizePointerDown`：preventDefault/stopPropagation、`isResizing=true`、记 `startScreenX/Y + startWidth/Height`、
    `setPointerCapture`。
  - `onResizePointerMove`：`z=vf.viewport.zoom`；`dx=(clientX-startScreenX)/z`、`dy=(clientY-startScreenY)/z`
    （**屏幕像素差除 zoom 还原成 CSS 像素**）；`cardWidth=max(120,startWidth+dx)`、`cardHeight=max(80,startHeight+dy)`。
  - `onResizePointerUp`：`releasePointerCapture`、写回 `vf.updateNode(id,{data:{...data,cardWidth,cardHeight}})`（持久化）。
  - MIN_WIDTH=120 / MIN_HEIGHT=80；卸载时清理。
- CSS：hover/选中时句柄透明度 0.85，图标色 `--canvas-node-resize-handle(-active)`。

#### B7. 选中环 / 卡片行内样式（cardInlineStyle）
- `showSelectionOutline = props.selected && !props.data?._overlay`（有 _overlay（裁剪/扩展等特殊模式）时隐藏选中环）。
- `cardInlineStyle` 用 `shallowRef` + watch 稳定引用：
  `{ width, height, transform: cardTransform, borderWidth: 1/zoom px, borderRadius: 8px, '--card-outline-width': sel?2/zoom:0 px }`
  （尺寸与边框按 zoom 反缩放：卡片在 VueFlow 内会随 zoom 放大，DOM 内联尺寸用 1/zoom 补偿，见 CSS `transform-origin:center`）。
- 根 class `is-selected`（CSS `.custom-node-root.is-selected .custom-node-card { border-color: selected }`，原 outline
  注释掉，仅靠边框色）。

#### B8. 模板结构总览（BaseNode template）
```
div.custom-node-root.relative  (:class 状态; mouseenter/leave; mouseleave 顺带清 suppressHandles when !connecting)
  ├ slot#top-toolbar
  ├ div.custom-node-card  (:style cardInlineStyle; class is-connecting-hover/is-connection-invalid/is-low-detail; mousemove=updateCardMousePosition)
  │   ├ div.custom-node-title  (:style titlePositionStyle; 标题重命名事件)
  │   │   └ slot#title → BaseTitle(:interactive :editing :title-icon="nodeDef.titleIcon" :label="nodeLabel")
  │   │        #title-icon slot透传 / #title-label: 编辑态input 或 slot(默认 span.nodeLabel) / #title-extra slot透传
  │   ├ div.invalid-connection-tooltip (v-if isConnectionInvalidTarget; :style invalidTooltipStyle)   ← 非法气泡
  │   ├ template(v-if shouldShowTargetZones && debugHandle) → .target-feedback-zone--body + .target-snap-zone   ← 吸附debug
  │   ├ MovingHandle #target (v-if showTargetHandle; visible=shouldShowHandles; disabled=isCurrentConnectingNode;
  │   │    半径等全来自 core.handle*; node-size=cardWidth; debug=debugHandle; @hover=isHovered=$event)
  │   ├ div.custom-node-content-clip (overflow:hidden 圆角裁剪) → slot#content (默认 svg 占位)
  │   ├ div.resize-handle (v-if resizable)   ← 右下角拖拽
  │   └ MovingHandle #source (v-if showSourceHandle; 同上对称)
  └ slot#bottom-toolbar
```
**root mouseleave**：`isHovered=false; if(!canvas.isConnecting) canvas.connectionState.suppressHandles=false`
（拖线时不清 suppressHandles）。

### C. v1 BaseNode 用到 store 的每一项（对应 render 侧缺什么）

| BaseNode 读取 | 意义/默认 | render 侧等价物 |
|---|---|---|
| `canvas.isConnecting` | 是否拖线中 | **无**（render 不发布拖线过程状态） |
| `canvas.connectionState.activeConnection.sourceNodeId/sourceHandle` | 拖线源 | **无** |
| `canvas.connectionState.hoverNode.status/zone/flowPosition/message/nodeId` | 逐帧反馈 | **无** |
| `canvas.connectionState.suppressHandles` | 抑制端口 | **无**（拖线期源端口 disabled 也无从驱动） |
| `canvas.state.core.handleRadius`(86)/handleRestOffset(36)/handleCursorGap(24)/handleButtonSize(32)/handleOverlap(16) | 端口尺寸 | ✅ `useCanvasRender().handleParams`（5 字段齐全） |
| `core.handleDebug`(false) | debug 开关 | ❌ 无（CanvasParams 无此字段） |
| `core.nodeTitleOffset`(12) / `core.nodeTitleScaleMinZoom`(0.5) | 标题布局 | ❌ 无（插件里硬编码 TITLE_OFFSET=6/TITLE_MIN_ZOOM=0.5） |
| `core.nodeLodLowDetailZoom`(0.4) | LOD | ❌ 无（插件硬编码 LOW_DETAIL_ZOOM=0.4） |
| `core.connectionSnapDebugVisible`(false)/OuterRatio(.75)/InnerRatio(.6)/HeightRatio(1.35) | snap debug | ❌ 无 |
| `core.handleDebug` | debug | ❌ 无 |

---

## 4. 连接状态机：useCanvasConnection 如何驱动 BaseNode

### 4.1 connectionState 结构（store 里，非持久化）
```
connectionState = ref({
  activeConnection: null,   // {sourceNodeId, sourceHandle:'source'|'target'}，onConnectStart 写
  hoverNode: null,          // {nodeId, status:'valid'|'invalid', zone:'snap'|'body', flowPosition:{x,y}, message?}
  snapTarget: null,
  mouseFlowPosition: null,
  mouseScreenPosition: null,
  hoverTarget: null,
  tempConnection: null,
  suppressHandles: false,
})
isConnecting = computed(() => activeConnection !== null)
```

### 4.2 hoverNode 是谁写的（关键：逐帧反馈来源）
`buildConnectionEdgeProps(connectionLineProps)` —— 由 VueFlow 的 **`#connection-line` 模板 slot**（拖线中每帧渲染的
临时连接线组件）在 render 期间调用。它：
1. 遍历所有存活节点，算卡片画布矩形 + snap/body zone；
2. 判断鼠标（`connectionLineProps.targetX/Y`）落在哪个节点的 snap 区或 body 区；
3. 用 `getInvalidConnectionReason` 判 valid/invalid；
4. **rAF 节流**写 `canvas.connectionState.hoverNode`（每帧最多一次；注释说明为何不能用 nextTick —— 会形成
   "hoverNode→BaseNode 重渲染→connection-line slot 重渲染→再写 hoverNode" 的 Maximum recursive updates 死循环）。

BaseNode 里所有 3D/气泡/zone/valid/invalid 效果**全部消费这份 hoverNode**。也就是说：
**没有 buildConnectionEdgeProps 那个"拖线连接线槽 + 每帧几何判定"的循环，BaseNode 的这些效果就是死的。**

### 4.3 v1 的 VueFlow 接线（CustomNode 外，Canvas.vue / useCanvasFlow 里）
`@connect-start/onConnectStart`、`@connect-end/onConnectEnd`、`@connect/onConnect`、
`:is-valid-connection`、`#connection-line slot → CustomEdge v-bind="buildConnectionEdgeProps(props)"`。

### 4.4 render 侧对比（CanvasSurface / CanvasHost）
```
CanvasSurface <VueFlow>
  :is-valid-connection="isValidConnection"   ← 仅释放瞬间 VueFlow 自己判
  @connect="onConnect"                        ← 仅释放瞬间
  #connection-line slot           ← ❌ 不存在
  @connect-start / @connect-end   ← ❌ 不存在
```
- render 侧**没有临时连接线槽**，所以**没有逐帧 feedback 几何**，也就没有 hoverNode 反应式对象。
- v2 `connection.ts` 只是纯函数校验器，被 `isValidConnection`/`onConnect` 复用；**不含拖线过程状态**。
- 连线释放时 VueFlow 默认走 handle→handle 精确匹配 → `@connect`；v1 里"松到节点主体/吸附区也能连"的行为（靠
  onConnectEnd 手工 findNearestConnectableNode + 建边）**在 render 侧没有**，render 只靠 VueFlow 原生 handle 落点。

---

## 5. `--canvas-node-*` CSS 变量

### 5.1 定义位置（全局）
`canvas-core/src/components/Decoration/node-theme.css`，**在 `canvas-core/src/index.ts` 顶部 `import`**（第 4 行），
即包加载即生效于全局 `:root`。变量名全部 `--canvas-node-*`。

### 5.2 完整变量清单 + 默认值
| 变量 | 默认值 | 用在 |
|---|---|---|
| `--canvas-node-surface` | `#f9fafb` | 卡片背景（BaseNode card background） |
| `--canvas-node-panel-surface` | `#ffffff` | MovingHandle 圆球背景 / ToolbarButton 面板 |
| `--canvas-node-panel-surface-hover` | `#f3f4f6` | toolbar hover |
| `--canvas-node-panel-surface-active` | `#e5e7eb` | toolbar primary hover |
| `--canvas-node-text-muted` | `#64748b` | MovingHandle 图标 / 默认文本色 |
| `--canvas-node-text` | `#4b5563` | 常规文本（title 输入等） |
| `--canvas-node-text-strong` | `#111827` | hover 强调文本 |
| `--canvas-node-border` | `rgb(209 213 219 / .95)` | 卡片默认边框 |
| `--canvas-node-border-subtle` | `#e5e7eb` | 圆球边框 |
| `--canvas-node-border-hover` | `#d1d5db` | 圆球 hover 边框 |
| `--canvas-node-border-selected` | `rgb(17 24 39 / .85)` | 卡片选中/connecting 边框 |
| `--canvas-node-ring` | `rgb(17 24 39 / .92)` | （预留选中环） |
| `--canvas-node-ring-soft` | `rgb(17 24 39 / .38)` | （预留） |
| `--canvas-node-ring-transparent` | `rgb(17 24 39 / 0)` | （预留） |
| `--canvas-node-shadow-strong` | `rgb(17 24 39 / .2)` | （预留） |
| `--canvas-node-shadow-soft` | `rgb(17 24 39 / .12)` | 圆球阴影 0 8px 18px |
| `--canvas-node-shadow-subtle` | `rgb(0 0 0 / .06)` | 圆球阴影 0 1px 2px |
| `--canvas-node-shadow-panel` | `rgb(15 23 42 / .12)` | （面板） |
| `--canvas-node-resize-handle` | `#9ca3af` | resize 图标默认色 |
| `--canvas-node-resize-handle-active` | `#111827` | resize 图标 hover 色 |
| `--canvas-node-target-zone-surface` | `rgb(17 24 39 / .08)` | `.target-feedback-zone--body` 背景 |
| `--canvas-node-target-zone-border` | `rgb(17 24 39 / .55)` | body zone 边框 |
| `--canvas-node-snap-zone-surface` | `rgb(17 24 39 / .1)` | `.target-snap-zone` 背景 |
| `--canvas-node-snap-zone-border` | `rgb(17 24 39 / .9)` | snap zone 边框 |
| `--canvas-node-snap-zone-highlight` | `rgb(255 255 255 / .75)` | snap zone inset 高亮 |
| `--canvas-node-snap-zone-shadow` | `rgb(17 24 39 / .28)` | snap zone 外阴影 |
| `--canvas-node-debug-danger` | `rgb(17 24 39 / .65)` | MovingHandle debug arc 描边 |
| `--canvas-node-debug-danger-fill` | `rgb(17 24 39 / .04)` | debug arc 填充 |
| `--canvas-node-debug-center` | `#111827` | debug 圆心 + label 色 |
| `--canvas-node-debug-rest` | `#4b5563` | debug rest 点 |
| `--canvas-node-debug-mouse` | `#6b7280` | debug mouse 点 |
| `--canvas-node-debug-label-stroke` | `#ffffff` | debug label 描边 |

> 有配套主题插件 `canvas-core/src/plugins/theme`：`applyPreset(name)`（slate/blue/green/warm/custom）按
> accent/surface 计算并覆盖这些变量，`patchVariables` 单项覆盖。**render 侧插件版目前没有这套 CSS 变量主题**，
> MovingHandle 插件版已把颜色硬编码为字面色值（见其文件头注释"v2 CSS 走字面色值(未建 CSS 变量主题)"）。

---

## 6. v2/render 侧依赖对照 —— 能拿到 / 拿不到 / 替代

render 侧统一入口 = `useCanvasRender()` 返回：
`{ ctx, host, registry, nodeWrite, handleParams, edgeVisual, edgeSelection }`。
`useVueFlow()` 仍可用（返回 `viewport/getNodes/updateNode/…`）。

### 6.1 逐依赖核对

| v1 BaseNode 依赖 | render 侧是否可等价拿到 | 说明 / 替代 |
|---|---|---|
| `canvas.state.core.*` 端口 5 字段 | ✅ | `handleParams`（reactive，含 handleRadius/RestOffset/CursorGap/ButtonSize/Overlap），默认值同 v1（86/36/24/32/16） |
| `canvas.isConnecting` | ❌ | 无反应式拖线状态。替代：VueFlow 无内置 isConnecting；需自建，或用 VueFlow `connectionStart/connectionEnd` 事件?（见 §6.2） |
| `canvas.connectionState.*` | ❌ | **最大缺口**，无等效反应式 hover/active |
| `vf.viewport.value.zoom` | ✅ | `useVueFlow().viewport` |
| `vf.getNodes`（取位置/尺寸算反馈百分比） | ✅ | `useVueFlow().getNodes` |
| `vf.updateNode(id,{data})`（标题写回/resize 写回） | ✅ 替换 | 用 `nodeWrite(id, patch)`（写 store data+落盘），或 `host.nodeStore.updateNodeData`。render 的 nodeWrite 只写 data（nodeWrite 语义见 nodeRegistryKey.ts） |
| `runtime.nodeRegistry.get(nodeType)` → titleIcon/canReceiveInput/canProduceOutput | ❌ 不同 | render `registry` 是"段组件注册表"，无这些字段；`host.nodeStore.types.get(type)` 有 `inputs/outputs/defaultSize/label`（无 titleIcon/resizable，canReceiveInput≈inputs 声明，见 §6.3） |
| `cardWidth/cardHeight`（data.cardWidth 等，resize 尺寸） | ⚠️ 需新增 | v2 节点 data 无 cardWidth 约定；`.v2-card` 目前是内容自适应（min 120×40）。做 resize 需在 data 上定义并自管宽度 |
| `--canvas-node-*` 变量 | ❌ | 插件版未建主题变量；已用字面色值硬编码。若想恢复，需在插件里自己 `:root{...}` 定义并 scope |
| CustomEdge（v1）读的 edge 配置 | ✅ | 插件版已改用 `edgeVisual` + `edgeSelection`（edgeContext） |

### 6.2 缺失项与替代方案建议（重点）

**(a) 连接反馈状态机（3D 倾斜 / invalid 气泡 / snap zone debug 的引擎）——最大缺口**
- v1 靠 `#connection-line` slot 的 `buildConnectionEdgeProps` 每帧算 hoverNode。render 侧 CanvasSurface 未接 slot。
- **替代方案三选一**（需写方案时定夺）：
  1. **在 canvas-render 侧补全接线**（最正统）：CanvasHost/Surface 增加 `@connect-start/@connect-end` + `#connection-line`
     slot，并新增一个反应式 feedback store / 注入，把 v1 useCanvasConnection 的 buildConnectionEdgeProps 几何移植过来。
     这属于改 canvas-render（宿主层），插件不越权。需宿主给"每帧拖线反馈数据"。
  2. **插件侧自建轻量反馈**（不动宿主）：BaseNode/插件内监听 VueFlow 的
     `connectionStart/connectionEnd`/`mouseMove`，自己用 `vf.getNodes` + 几何判 zone + 写本地 ref hoverNode，
     经 provide 在 BaseNode 间共享。可行性存疑：VueFlow 默认拖线是画布层行为，节点组件未必每帧拿到 target 位置
     （v1 靠 connection-line slot 拿 targetX/Y）。需实验 VueFlow 是否暴露当前连接鼠标画布坐标。
  3. **退而求其次**：只做"物理 hover"版反馈（isHovered 时 tilt / 卡片高亮），不做拖线目标驱动的 3D/气泡/zone——
     即放弃与拖线过程强耦合的部分，仅保留纯悬停特效。这是最省力但损失最大的路线。

**判断**：方案 1 才是能让插件 BaseNode"完全达到 v1 Decoration 效果"的路径，且因为 MovingHandle 端口本身是真实
VueFlow Handle，拖线确实会经过 handle → @connect；只是**过程反馈**缺失。建议方案 1：canvas-render 侧补 `#connection-line`
槽 + feedback 状态注入（类似把 v1 的 useCanvasConnection.buildConnectionEdgeProps 拆成宿主提供 + 插件消费的契约）。

**(b) nodeDef 语义（titleIcon / canReceiveInput / canProduceOutput / resizable）**
- v1 `CanvasNodeDefinition`：type/node/label/defaultSize/menuItem/canReceiveInput/canProduceOutput/acceptsInputs/
  resizable/topToolbar/bottomToolbar/titleIcon/selfRender。
- render 侧两个表：
  - `registry`（NodeRegistry，段组件）只存 type→segments 组件，无这些。
  - `host.nodeStore.types.get(type)` = `CanvasNodeType{type,label,defaultSize:{w,h},inputs?,outputs?}`。
    - `canReceiveInput` ↔ 该 type 是否有 input 能力：`!inputs` 默认都可收（人人 source→target），与 v1 `??true` 接近；
      或 `inputs?.length>0`。
    - `canProduceOutput` ↔ `!outputs`（默认有 source 口）/ `outputs?.length>0`。
    - `titleIcon`：**v2 没有**。v2 标题一般就是 type 名文本，title 段可有独立组件；若要做图标标题需在
      CanvasNodeType 扩 titleIcon 或约定 data.titleIcon。
    - `resizable`：v2 没有；需扩字段或用 `data.resizable` 约定。
- **建议**：插件 BaseNode 的 `showTargetHandle/showSourceHandle` 无法像 v1 那样从 nodeDef 拿 booleans，应改为
  `props.data.sourcePosition/targetPosition` 显式决定，或从 `host.nodeStore.types.get(type)` 的 inputs/outputs 派生，
  或直接总是渲染两个口（v2 语义=人人可连，默认都有 source+target，见 connection.ts 注释）。

**(c) LOD / title 布局 / snap zone 等配置项**
- v1 读 `state.core.nodeLodLowDetailZoom/nodeTitleOffset/nodeTitleScaleMinZoom/connectionSnap*Ratio/handleDebug`。
- render 侧 handleParams 只有 5 个端口字段，CanvasSurface/CanvasHost 也没有 node LOD / title / snap 配置注入。
- 插件 BaseNode 现用常量 `LOW_DETAIL_ZOOM=0.4 / TITLE_MIN_ZOOM=0.5 / TITLE_OFFSET=6` 硬编码 —— 无配置化。若需配置化，
  要么 canvas-render 扩 CanvasParams（加 nodeTitleOffset 等），要么插件内自建 reactive 配置。

### 6.3 插件 BaseNode 现状 vs v1（移植前基线）
插件版 BaseNode（318 行）已具备：
- `useCanvasRender()` → `{registry,nodeWrite,handleParams}`；`resolveSegment` 分段渲染 content/title/top/bottom-toolbar。
- 缩放/LOD（常量）、标题反缩放（用 ResizeObserver 实测卡片 DOM 宽再除 zoom 得画布宽，公式 `cardCanvasW*max(zoom,minZoom)`，
  与 v1 `cardWidth*max(zoom,minZoom)` 本质一致，只是 v1 用已知 cardWidth、插件版实测 DOM）。
- 标题就地重命名（F2/双击/Enter/Esc），经 nodeWrite 写回。
- MovingHandle 两侧（target 左/source 右），尺寸全来自 handleParams；`shouldShowHandles = !lowDetail && (hover||selected)`。
- 有 `.v2-card`，宽度内容自适应，**无固定 cardWidth、无 resize**。

插件版缺失（相对 v1 需要补的"效果"）：
1. 3D 连接反馈倾斜 + is-connecting-hover / valid/invalid class（引擎缺，见 §6.2a）
2. invalid 气泡 + 定位（缺 hoverNode）
3. 目标吸附 zone debug（缺 connectionSnapDebug + hoverNode）
4. 卡片 resize（缺 cardWidth 数据模型 + 可配 resizable）
5. showTargetHandle/showSourceHandle 按类型能力（缺 nodeDef booleans）
6. `--canvas-node-*` CSS 变量主题（现为字面色值）
7. BaseTitle 组件（插件现用内联 title，v1 拆成 BaseTitle 组件）——纯展示可选搬

---

## 7. CustomEdge（v1 vs 插件版差异）——顺带记录

- **v1 canvas-core 存在 `components/CustomEdge.vue`**（642 行），插件版 `CustomEdge.vue` 是其移植。
- v1 读 `useCanvasStore()`（state.core.* 边配置 + selectionState.selectedNodeIds/Edges）；插件版读
  `useCanvasRender().edgeVisual + edgeSelection`（edgeContext，形状与 v1 core.* 一一对应）。边高亮判断逻辑一致：
  临时恒高亮 / 相连任一节点被选 / 边自身被选。
- 几何逻辑 v1 内嵌在组件（getPoints/getBend/buildStepPath 等）；插件版抽到 `edgeGeometry.ts`（可单测，`buildEdgePath/
  sampleEdgePath/findClosestPointOnPath`），组件只装配。插件版额外支持 `props.visual` / `props.geometry` 覆盖（优先级高于 provide）。
- 两者都支持：bezier/straight/step/smoothstep、默认淡线、选中流光(辉光+热斑 ef-runner)、手绘箭头(采样角度)、加宽点击热区、
  双击弹剪切钮删除。CSS 类名相近（ef-base/ef-runner-glow/ef-runner-hot/ef-arrow）。
- **差异要点**：数据源从 pinia → props+provide(edgeVisual)；几何抽纯函数；渲染壳更薄。功能等价。
- 注意：插件版 CustomEdge 是静态边；v1 CustomEdge 还被当作拖线临时连接线用（`#connection-line` slot 里 `buildConnectionEdgeProps`
  返回的 temporary 边 props 传给 CustomEdge 渲染）——插件版不含这条拖线实时渲染路径（与 §6.2a 同一缺口）。

---

## 8. 建议的移植优先级与抓手（供写方案参考）

按"改动小、见效大、依赖缺口小"排：

1. **MovingHandle + BaseTitle + 标题反缩放 + CSS**：纯组件 + props，render 侧 handleParams 齐备，**直接照搬**。
   - MovingHandle 需把 CSS 从 `--canvas-node-*` 换成字面色值（插件已做）或引入插件自己的 `:root` 变量。
   - 若想用 v1 BaseTitle，替换插件内联 title 即可。
2. **卡片 resize + cardWidth 数据模型**：逻辑照 v1（pointer capture + 除 zoom + nodeWrite 写回 data.cardWidth/Height），
   需约定 data 字段 + `resizable`。不需要宿主改。
3. **showTargetHandle/showSourceHandle 按类型能力**：从 `host.nodeStore.types.get(type).inputs/outputs` 派生，或 data 显式。
4. **`--canvas-node-*` 主题变量**：插件自建 `:root` 变量集（照 node-theme.css），或引入 CanvasParams/nodeWrite 无法触达的
   CSS 覆盖接口。
5. **连接反馈特效（3D/气泡/zone/valid-invalid）**：依赖宿主层补 `#connection-line` slot + feedback 注入（改 canvas-render）
   或插件自建拖线反馈（有风险）——**需要单独立方案/与宿主协调**，是本任务最重的一块。

---

## 9. 附：参考文件清单（v1 侧）与行号要点
- `components/Decoration/BaseNode.vue`：端口判定 A2(L34-41)、zoom/lowDetail(L48-59)、title 布局(B5 L50-73)、
  cardWidth/Height+LOD(L80-101)、resizable(L107)、resize(L109-186)、hover/mousePosition(L190-197)、debug/connecting 组(A3 L203-234)、
  showConnectFeedback(L241)、showTargetZones(L257-274)、cardTransform 3D(B1 L281-288)、selectionOutline(L299)、cardInlineStyle(L308-334)、
  invalid tooltip(B3 L342-372)、feedbackMousePosition(B1 L384-403)、updateCardMousePosition(L411)、重命名(B5 L436-510)、模板(B8 L514-621)、
  CSS(L623-783)。
- `useCanvasConnection.ts`：findNearestValidTarget(L303)、findNearestConnectableNode(L409)、findNodeBodyAtPoint(L425)、
  getInvalidConnectionReason(L457)、onConnectStart(L577)、onConnectEnd(L597)、onConnect(L723)、buildConnectionEdgeProps(L748-909)、
  isValidConnection(L487)。hoverNode rAF 写入(L868-886)。
- `useCanvasStore.ts`：state.core 全部默认值(L135-212)、connectionState(L251-260)、isConnecting(L346)、serializer 兜底默认(L32-111)。
- `runtime/useCanvasRuntime.ts` + `registry/NodeRegistry.ts`：CanvasNodeDefinition 字段(L12-39)。
- `utils/viewportSpace.ts`：createCappedStyle(L62)、createNodeTitleLayout(L98)/**createNodeTitleLocalLayout(L117)**、clamp(L161)。
- `utils/constants.ts`：DEFAULT_NODE_SIZE(256×256)、CONNECT_FEEDBACK{rotateX:18,rotateY:18,perspective:800,scale:1.018}。
- `components/Decoration/node-theme.css`：§5.2 全表。
- `index.ts`：L4 import node-theme.css（全局）。
- `components/CustomEdge.vue`：§7。
