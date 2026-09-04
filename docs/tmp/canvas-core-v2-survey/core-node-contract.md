# Canvas v1 节点显示/交互核心件 —— 行为契约（金标准）

> 用途：v2 重构（packages/canvas-core-v2）的金标准。**禁止改坏**下述任何行为。
> 检索纪律：所有结论逐行落到 `file:line`。文档基于 v1 源码逐行精读得出。
> 覆盖范围：BaseNode / MovingHandle / NodeToolbar / ResizeHandle / CustomNode / CustomEdge + 辅助件（useCanvasConnection 的交互段、ConnectionValidator）。
> 相关全局配置默认值：见 `packages/canvas-core/src/composables/useCanvasStore.ts:40-95`(读) / `:135-211`(初始值)。**CustomEdge/BaseNode 读的是 `canvas.state.core.*` 实时值，不是边/节点 data 快照。**

---

## 0. 全局配置默认值表（被本批件读取，v2 必须保留同 key 语义与默认值）

来源 `useCanvasStore.ts:40-95`(从 localStorage 恢复时的 fallback) 与 `:135-211`(内存初值)。**read/write 序列化均以 `core` 命名空间持久化到 localStorage `canvas-state`(`:223`)**，v2 照抄：

| key | 默认 | 被谁读 |
|---|---|---|
| handleDebug | false | BaseNode:203, MovingHandle debug prop |
| handleRadius | 86 | BaseNode:585,611 MovingHandle radius; connection snap |
| handleRestOffset | 36 | BaseNode:586,612 |
| handleCursorGap | 24 | BaseNode:586,613 (MovingHandle 默认值 22 会被此覆盖) |
| handleButtonSize | 32 | BaseNode:587,614 |
| handleOverlap | 16 | BaseNode:587,614 |
| connectionSnapDebugVisible | false | BaseNode:273 |
| connectionSnapOuterRatio | 0.75 | BaseNode:576-579, connection |
| connectionSnapInnerRatio | 0.6 | BaseNode:576-579 |
| connectionSnapHeightRatio | 1.35 | BaseNode:577-579 |
| edgeLineWidth | 2 | CustomEdge:322 |
| edgeColor | '#3b82f6' | CustomEdge:323 |
| edgeType | 'bezier' | CustomEdge:321 |
| edgeDashed | false | CustomEdge:324 |
| edgeAnimated | true | CustomEdge:325 |
| edgeMarkerEnd | false | CustomEdge:326 |
| edgeMarkerSize | 8 | CustomEdge:327 |
| edgeVisible | true | CustomEdge:328 |
| edgeStepOffset | 20 | CustomEdge step/smoothstep:203,238,245,278 |
| edgeSmoothRadius | 5 | CustomEdge:245,276 |
| edgeGlowEnabled | true | CustomEdge:329 |
| edgeGlowIntensity | 1 | CustomEdge:330 |
| edgeGlowColor | '#ffffff' | CustomEdge:331 |
| topToolbarOffset | 12 | CustomNode:41 (NodeToolbar offset) |
| bottomToolbarOffset | 12 | CustomNode:42 |
| nodeTitleOffset | 12 | BaseNode:51 |
| nodeTitleScaleMinZoom | 0.5 | BaseNode:51,66 |
| nodeLodLowDetailZoom | 0.4 | BaseNode:59 |

节点/边注册：`nodeTypes = { custom: CustomNode, tempTarget: TempTargetNode }`、`edgeTypes = { custom: CustomEdge }`（`useCanvasStore.ts:227-234`）。所有真实节点走 `type:'custom'`→CustomNode，真实边走 `type:'custom'`→CustomEdge。

---

## 1. CustomNode.vue（76 行）— 节点统一入口，决定"组装 / 自渲染 / 错误回退"

### 1.1 职责
按 `nodeDef`（注册表中节点类型定义）决定节点走哪条渲染路径：**自渲染(selfRender) / BaseNode 组装**；并充当单节点错误边界。

### 1.2 Props / 输入契约
- `props = defineProps<NodeProps>()`（`:16`）：VueFlow 传入的标准节点 props（含 `data`、`id`、`selected`、`targetPosition`、`sourcePosition` 等）。
- `defineOptions({ inheritAttrs: false })`(`:11`)：不把透传属性挂到根元素。
- 依赖注册表 `runtime.nodeRegistry`（`:17` `useCanvasRuntime()`）：`nodeDef = nodeRegistry.get(props.data.nodeType)`（`:20-24`）；取不到 nodeType 时 nodeDef=null。
- `defineEmits<{ updateNodeInternals: [id, internal] }>`（`:12-14`）声明但未使用。
- 读取 `canvas.state.core.topToolbarOffset / bottomToolbarOffset`（`:41-42`）。

### 1.3 渲染逻辑（组装路径 vs 自渲染 vs 错误）
- **错误优先**：`nodeError` 非空 → 渲染错误占位 div（`.custom-node--error`），固定 `width:256px; min-height:100px`，展示 `nodeError` 文本；其余全部逻辑不渲染（`:47-50`）。`onErrorCaptured` 捕获子树任意错误 → 记录 `err.message` 并 `return false` 阻断上抛（`:33-37`）。**捕获范围含 ContentComponent/工具栏内部错误。**
- **自渲染**：`selfRender = nodeDef.selfRender === true`（`:39`）。若 selfRender 且 ContentComponent 存在 → `<component :is="ContentComponent" v-bind="$props"/>` 直出，**不做 BaseNode 组装、无 slot 填充**（`:53`）。
- **组装路径（默认）**：`<BaseNode v-bind="$props">`（`:54`），向 BaseNode 三个具名 slot 传：
  - `top-toolbar`（`:55-62`）：优先覆盖 `TopToolbarComponent`(nodeDef.topToolbar) → `<NodeToolbar :node-id="id" :position="Position.Top" :offset="topOffset"><component/></NodeToolbar>`；否则 `<BaseToolbar v-bind toolbar-position="top"/>`。
  - `content`（`:63-65`）：`ContentComponent = nodeDef.node`（`:26`），不存在则不渲染。
  - `bottom-toolbar`（`:66-73`）：逻辑同 top，用 `Position.Bottom` 与 `bottomOffset`。
  - `selfRender===true` 但 `ContentComponent` 缺失 → 仍落入组装分支（因 `v-if="selfRender && ContentComponent"`，`:53`）。
- 组装路径下每个 slot 内容统一 `<component :is="..." v-bind="$props">`，把整套 NodeProps 传给内容件。

### 1.4 交互行为
无自身交互；纯分发。`_overlay`/选中/悬停交互都在 BaseNode 内。

### 1.5 与其它件数据契约
- nodeType 不在注册表 → 整卡无内容/无工具栏，但 BaseNode 外壳仍在（标题回落 `nodeType` 字符串或"节点"）。
- 内容件与工具栏件共用 `$props`（同一 NodeProps），**内容件不额外注入 store**。

### 1.6 边界 / 坑
- 错误边界是节点级：内容件崩不拖垮整画布，但**回退占位把自渲染节点的真实尺寸替换成固定 256×100**（v2 需保持，防整卡空白不可控）。

---

## 2. BaseNode.vue（783 行）— 节点外壳（组装路径的骨架）

### 2.1 职责
渲染节点卡片 + 反向缩放标题 + 左右浮动端口(MovingHandle) + 可选 resize 拖拽句柄 + 连接 3D 反馈/无效提示/吸附调试可视化，并透传上/下工具栏 slot。

### 2.2 Props / 输入契约
- `props = defineProps<NodeProps & { cardWidth?: number; cardHeight?: number }>`（`:12-15`）。
- 端口可见性：读 `props.targetPosition / props.sourcePosition`（`:34-41`）。**显式 undefined 时回落到 nodeDef 的 `canReceiveInput`/`canProduceOutput`，两者都默认 true。**
- 本地响应式尺寸 `cardWidth/cardHeight` ref（`:80,86`）：初值 `data.cardWidth || props.cardWidth || 256`。
- watch `data.cardWidth/cardHeight` 同步（`:92-101`）：**仅当值非 undefined 且当前不在 resize 拖拽中才覆盖本地 ref**。
- `nodeDef` = `nodeRegistry.get(props.data.nodeType)`（`:22-26`）。

### 2.3 渲染逻辑（模板结构, 从外层到内层）
根：`<div class="custom-node-root relative">` 状态 class（`:516-525`）:
- `.is-selected`(showSelectionOutline)、`.is-pointer-hovered`(isHovered)、`.is-connection-hovered/snap-hovered/body-hovered/valid/invalid`。
- `@mouseenter="isHovered=true"`、`@mouseleave="isHovered=false; if(!canvas.isConnecting) suppressHandles=false"`（`:524-525`）。

内层结构顺序：
1. `<slot name="top-toolbar"/>`（`:527`）。
2. 卡片主体 `.custom-node-card`（`:530-532`）：relative/flex 居中/overflow-visible，class 追加 `is-connecting-hover`(showConnectFeedback)、`is-connection-invalid`、`is-low-detail`；`:style=cardInlineStyle`；`@mousemove=updateCardMousePosition`。
3. 标题 `.custom-node-title`（`:535-566`）：absolute，counter-scale 反向缩放（见 2.4 尺寸算法）；状态交互见 2.4 标题节。
4. 无效连接 tooltip `.invalid-connection-tooltip`（`:568-570`）。
5. 吸附调试可视化（`:573-581`，v-if `shouldShowTargetZones && debugHandle`）：`.target-feedback-zone--body` + `.target-snap-zone`，尺寸用 handleRadius×各 ratio。
6. 左侧 `MovingHandle` target（`:584-588`）。
7. 内容裁剪层 `.custom-node-content-clip`（`:591-599`，`<slot name="content">`，默认 svg 占位）——overflow hidden，圆角跟随。
8. resize 句柄（`:602-608`，v-if resizable）。
9. 右侧 `MovingHandle` source（`:611-615`）。

### 2.4 尺寸 / 缩放 / 定位算法
- `zoom = max(vf.viewport.value.zoom || 1, 0.01)`（`:48`）——**防 0/负缩放除零**。
- `lowDetail = zoom < (nodeLodLowDetailZoom ?? 0.4)`（`:59`）：低细节模式去掉卡片阴影/过渡（CSS `.is-low-detail` `transition:none; box-shadow:none !important`，`:636-639`），并隐藏端口/反馈。
- `cardBorderCompensation = max(1/zoom, 1)`（`:62`）。
- 标题反向缩放（`:50-73`）：
  - `createNodeTitleLocalLayout(zoom, {offset: nodeTitleOffset, minZoom: nodeTitleScaleMinZoom})` → 返回 `{scale, offset, style}`；其中 `scale = 1/max(zoom, minZoom)`，`offset = nodeTitleOffset * scale`（`viewportSpace.ts:117-141`）。
  - `titleCanvasWidth = cardWidth * max(zoom, minZoom)`（`:67`）——让标题反缩放后**屏幕宽度==卡片屏幕宽度**。
  - 定位 style：`left: -cardBorderCompensation`、`bottom: calc(100% + (titleOffset + cardBorderCompensation))`、`width: titleCanvasWidth`（`:68-73`）。
- 卡片尺寸 `cardWidth/cardHeight` 直接作为 width/height px（`:308-334`）。
- 边框 `borderWidth = 1/zoom` px（counter-scale，缩放后视觉恒 1px）；选中环 `--card-outline-width = 2/zoom`（若 showSelectionOutline），由 outline 叠加不占盒模型（`:314,331`）。
- `cardInlineStyle` 用 `shallowRef`+watch 稳定引用，避免每次 computed 新建对象（`:308-334`）。

### 2.5 端口显示（MovingHandle 集成）
- `shouldShowHandles = !lowDetail && !suppressHandles && !isCurrentConnectingNode && (isHovered || selected)`（`:217-222`）。
- `isCurrentConnectingNode = isConnecting && activeConnection.sourceNodeId === props.id`（`:208-211`）——**拖线起点隐藏自己端口并 disabled**。
- target/source MovingHandle 均传：`visible=shouldShowHandles`、`disabled=isCurrentConnectingNode`、`radius/rest-offset/cursor-gap/button-size/overlap`=canvas.core.*、`:node-size="cardWidth"`(见坑 2.9)、`debug=debugHandle`、`@hover="isHovered=$event"`（`:584-588, :611-615`）。
- `isHovered` 双向联动：hover 反馈由 MovingHandle 的 hover emit 同步回来，让端口 hover 时整卡也被视为 hovered。

### 2.6 连接 3D 反馈 / 无效提示 / 吸附调试
- `connectionHover = isConnecting && hoverNode?.nodeId===id ? hoverNode : null`（`:225-229`）。
- zone/状态拆分：`isConnectionSnapHovered(zone==='snap')`、`isConnectionBodyHovered(zone==='body')`、`isConnectionValidTarget(status==='valid')`、`isConnectionInvalidTarget(status==='invalid')`（`:231-234`）。
- `showConnectFeedback = isConnecting && 非起点 && !invalid && !lowDetail && (isHovered || validTarget)`（`:241-247`）。
- `cardTransform`（`:281-288`）：仅 valid 反馈时，按 `feedbackMousePosition`(0~1) 算 `perspective(800) rotateX((y-0.5)*18deg) rotateY(-(x-0.5)*18deg) translateZ(10px) scale(1.018)`（常数来自 `constants.ts` CONNECT_FEEDBACK）。**invalid 目标返回 ''（不加 3D），只用模糊效果。**
- `feedbackMousePosition`：鼠标在卡片内 0~1 归一化；从 `hoverNode.flowPosition`(画布坐标)减节点 position 除以宽高换算，clamp 到[0,1]（`:384-403`）。
- `updateCardMousePosition`（`:411-418`）：`@mousemove` 实时算物理鼠标相对位置，**仅在 showConnectFeedback 或 debug 时计算**（性能）；clamp[0,1]。
- 无效提示气泡：`invalidFeedbackPosition` 把无效点换算成卡片内 0~1 并 clamp `x∈[0.06,0.94], y∈[0.08,0.92]`，默认(0.08,0.5)（`:342-359`）；tooltip 以 left/top 百分比+`translate(-50%,-50%)` 居中（`:369-372`），文本用 `hoverNode.message || '无法连接'`（`:569`）。无效态卡片加 `.is-connection-invalid` + ::after 白雾 blur（`:693-706`）。
- 吸附调试可视化仅当 `shouldShowTargetZones && debugHandle`（`:573`）：`shouldShowTargetZones = showTargetHandle && (connectionSnapDebugVisible || showTargetZones)`，`showTargetZones = isConnecting && 非起点 && showTargetHandle`（`:257-274`）。快照矩形尺寸 = handleRadius×各 ratio，从卡左缘向左伸出 outer（`:575-580`）。

### 2.7 标题就地重命名（F2 / 双击 / input）
- `nodeLabel = data.label || data.nodeType || '节点'`（`:430-434`）。
- 编辑态状态：`isEditingTitle/draftTitle/titleInputRef`（`:439-443`）。
- 选中时挂/收 `document keydown`（F2）监听（`:446-453`，watch selected immediate）；卸载移除（`:455-457`）。
- F2 进编辑：需节点 selected、`e.key==='F2'`、当前不在编辑、焦点不在 INPUT/TEXTAREA/contentEditable（`:462-469`）。
- `startTitleEdit`：`draft=nodeLabel`，置 editing，nextTick focus+全选（`:474-482`）。
- 模板（`:535-566`）：标题容器 `.custom-node-title`（select-none nodrag nopan）拦截鼠标（mouseenter 使卡 isHovered=false 防干扰、mouseleave 还原、move/pointerdown/up/click stop、**dblclick.stop → startTitleEdit**）。内部 `<slot name="title">` 默认 `<BaseTitle :interactive editing title-icon label>`，含 `title-icon`/`title-label`/`title-extra` 三个子 slot。
  - `title-label`：编辑态渲染 `<input class="custom-node-title-input" v-model=draft>`，`@keydown.enter.prevent=commitTitleEdit`、`@keydown.escape.prevent=cancelTitleEdit`、`@blur=commitTitleEdit`、pointerdown/dblclick stop；非编辑态渲染 `<span class=truncate>{{nodeLabel}}</span>`（`:543-560`）。
- `commitTitleEdit`（`:490-504`）：跳过 skipBlurCommit 后 `trim()`；空 → `data.label=undefined`(回落类型/默认名)，否则 `data.label=next`；通过 `vf.updateNode(id,{data:{...props.data,label}})` 写回。置 editing=false。
- `cancelTitleEdit`（`:507-510`）：置 `skipBlurCommit=true` 防随后的 blur 再提交，仅关编辑态不改 label。

### 2.8 Resize 拖拽（右下角）
- `resizable = data.resizable === true`（`:107`）→ 才渲染 `.resize-handle`（右下角 16×16，cursor nwse-resize，`:602-608, :749-763`）。
- 阈值：`MIN_WIDTH=120`、`MIN_HEIGHT=80`（`:115-118`）。
- pointerdown（`:136-148`）：preventDefault+stopPropagation，置 isResizing，快照 startScreenX/Y+startW/H，`setPointerCapture(pointerId)`。
- pointermove（`:154-163`）：`dx=(clientX-startX)/zoom`、`dy=(clientY-startY)/zoom`（**屏幕 delta 除以当前 zoom 还原 CSS px**）；`cardWidth=max(MIN_WIDTH, startW+dx)`、`cardHeight=max(MIN_HEIGHT,startH+dy)`。绑定在 handle 元素 pointermove/up 上 + 指针捕获。
- pointerup（`:169-181`）：releasePointerCapture，`vf.updateNode(id,{data:{...props.data,cardWidth,cardHeight}})` 持久化。
- onUnmounted 清理（`:183-186`）。
- **resize 拖拽中通过 2.2 的 watch 抑制 data 同步冲突**。

### 2.9 边界情况 / 坑（逐条）
- **zoom 除零/负值**：`zoom=max(zoom||1,0.01)`（`:48`）与 `createNodeTitleLocalLayout` 内 `max(zoom||1,0.01)`（`viewportSpace.ts:118`）双重防护。
- **负数/0 尺寸兜底**：invalid/feedback 用 `cardWidth||node.dimensions?.width||256`（`:352-353, :396-397`）。
- **isHovered 与端口联动**：端口 hover 同步卡 hover，但标题 hover 会临时置 false 防遮挡；`@mouseleave` 在非连接时才复位 `suppressHandles=false`（`:525`），避免拖线中途误清。
- **`node-size` prop 泄漏**：BaseNode 传 `:node-size="cardWidth"`（`:588,615`）但 MovingHandle 未声明该 prop → 落到 attrs 透传。v2 需保留"不崩溃"（若 MovingHandle 声明过 `nodeSize` 则删除即可）。**不能把此 attr 当功能依赖。**
- **handle target/source 默认全部显示**（canReceiveInput/canProduceOutput 默认 true）——除非 nodeType 定义关闭或显式 source/targetPosition。

---

## 3. MovingHandle.vue（468 行）— 移动式浮动端口（半圆吸附 + 圆球跟随）

### 3.1 职责
端口：非 preview 时注册真实 VueFlow `<Handle>` 连接点，preview 时仅外观。鼠标进入半圆区域时圆球从节点外缘"跳"出来跟随鼠标，离开后 180ms 内归位并淡出。

### 3.2 Props / 输入契约
- `id/type('source'|'target')/position(Position)`（`:6-8`）：传给底层 Handle。
- `visible?: boolean`（`:10`）、`disabled?: boolean`（`:11`）。
- 尺寸（均带默认，被 BaseNode 覆盖为 canvas.core 值）：
  - `radius?: 76`（`:48`）半圆可移动区半径 px
  - `restOffset?: 36`（`:49`）圆球离区后归位的默认外缘偏移 px
  - `cursorGap?: 22`（`:50`）圆球与鼠标错开距离 px（BaseNode 传 canvas.core.handleCursorGap=24 覆盖）
  - `buttonSize?: 32`（`:51`）
  - `overlap?: buttonSize/2=16`（`:52`）区域向节点内侧被裁剪的宽度 px
- `preview?: boolean`（`:23`）：只复用外观不注册真实连接点。
- `debug?: boolean`（`:25`）：显示半圆/圆心/rest/mouse 辅助线。
- emits（`:28-31`）：`hover:[boolean]`、`connectStart:[{event,type}]`。

### 3.3 渲染逻辑
- 根：动态 `<component :is="preview?'span':'Handle'">`，class `moving-handle-anchor` + 方向/状态 class（`:233-242`）：
  - `moving-handle-anchor--source`（`right:0`）/`--target`（`left:0`）（CSS `:310-316`）。
  - `is-visible`(isShown)、`is-moving`、`is-restoring`、`is-disabled`、`is-preview`。
- 内层两个子元素：
  - 半圆区 `.moving-handle-zone`（`:243-274`）：absolute，`@mouseenter/@mouseleave/@mousemove`；class 含 `--source`（`border-radius:0 9999px 9999px 0; clip-path:inset(0 0 0 var(--overlap))`）/`--target`；`:style=zoneStyle` 宽高=radius，CSS 变量 `--moving-handle-overlap`。
  - debug svg（v-if debug）画 arc/center/rest/mouse（`:249-272`）。
  - 圆球按钮 `.moving-handle-button`（`:277-281`，svg 十字图标）：`:style=buttonStyle`；`@mousedown=handlePreviewMouseDown`。
- 视觉状态机通过 class 驱动 CSS 过渡（`:303-411`）：restoring 时 top/left/right 过渡 180ms；按钮 opacity 只由 `.is-visible:not(.is-restoring)` 控制到 1（`:409-411`）——**刻意不加 :hover 兜底，防连线释放瞬间鼠标仍压区时把按钮顶出**。
- 端口按钮外观：32px 圆、白底、十字图标 16px；hover 变色（`:417-420`）；moving 时 scale(1.06)（按钮内联 transform `:89`）。

### 3.4 交互行为 / 几何算法（重点）
本地坐标以"半圆区自身"为基准（非屏幕 px，见 `:176-178` 注释：VueFlow 缩放后 getBoundingClientRect 是缩放后尺寸，直接用 radius(px)+clientX/Y 会错位）：
- `updatePosition(event)`（`:156-195`）：
  - `disabled` → 直接 return（`:157`）。
  - emit hover(true)、`keepVisible=true`、`isMoving=true`、`isRestoring=false`；清 hideTimer（`:163-166`）。
  - 取区 rect，`localX=(clientX-rect.left)/rect.width*radius`、`localY`同理，0 尺寸兜底 0 / 半径/2（`:168-174`）。
  - 归一化：source `outward=localX`、target `outward=radius-localX`；`rawY=localY-radius/2`。
  - `mouseX=clamp(outward,0,radius)`、`mouseY=clamp(rawY,-radius/2,radius/2)`（`:179-182`）。
  - 圆球位置：`maxDistance=radius-buttonSize/2`；`mouseDistance=hypot`；`mouseAngle=atan2(mouseY, mouseX||0.0001)`（防 X=0 atan2 除零）；`followDistance=clamp(mouseDistance+cursorGap,0,maxDistance)`；`ballX=cos(angle)*followDistance`、`ballY=sin(angle)*followDistance`；`commitPosition(direction*(ballX-overlap), ballY)`（`:184-194`）。
  - 由 cursorGap 让圆球跟鼠标拉开不遮挡，方向符由 source(+1)/target(-1) 决定（`:46-47`）。
- `commitPosition`（`:144-154`）：写 nextX/Y，用 `requestAnimationFrame` 合帧写回 buttonX/Y（`frameId` 防重入）。
- `handleLeave`（`:197-217`）：disabled return；置 isMoving=false、isRestoring=true、keepVisible=true；cancel rAF；`restorePosition()` 先归位（鼠标仍保持可见跟随方向快速归位）；`restoreDuration=180`(ms) 后 timer 内 `keepVisible=false; isRestoring=false; emit hover(false)`。
- `resetPosition`（`:129-136`，setup 即调 `:127`）：`nextX=direction*(restOffset-overlap)`、Y=0、mouse=restOffset。
- `restorePosition`（`:138-142`）：mouse 复位 + `commitPosition(direction*(restOffset-overlap),0)`。
- `handlePreviewMouseDown`（`:219-224`）：**仅 preview**，左键，stopPropagation+preventDefault，emit `connectStart`。
- disabled watch（`:57-75`）：变 true 时清 timer、清 moving/restoring/keepVisible、emit hover(false)、restorePosition；变 false 且 !visible 时清 keepVisible+emit hover(false)。——**这是"临时禁源端口后残留状态清理"关键。**
- onBeforeUnmount（`:226-229`）取消 rAF/timer。

### 3.5 与 VueFlow / 其它件数据契约
- 非 preview 时底层就是 VueFlow `<Handle :id :type :position>`：真实连接点 = 1×1px 的 `.moving-handle-anchor`，定位 `top:50%!important; transform:translateY(-50%)!important`（`:286-301` 覆盖 VueFlow 注入 transform），source 靠右、target 靠左。BaseNode 里 id 固定 `'source'/'target'`。
- `visible=false` 时 Handle 仍渲染但按钮透明度 0（端口连接点仍在，仍可 connect；仅视觉隐藏）。
- `preview` 模式用于只复用外观（如 SelectionFrame 连线源）——此时是 `<span>` 不带连接点。
- hover emit 由 BaseNode 回写 `isHovered`。

### 3.6 边界 / 坑
- **rAF 合帧**：大量 mousemove 不直接写响应式 buttonX/Y，避免每帧重渲染。
- **X=0 atan2 除零**用 `||0.0001`（`:186`）。
- **overlap 裁剪**：半圆向内进节点、clip-path 裁掉内侧，让端口按钮视觉半埋在节点边缘。
- 反向（target/左侧）几何全镜像：`direction=-1`、`button left` 补偿 `+5px`（因 VueFlow handle 样式 `min-width:5px`，`:95-96`）。

---

## 4. NodeToolbar.vue（111 行）— 节点工具栏浮层

### 4.1 职责
把一个 slot 内容（节点自定义工具栏）以绝对定位浮层 + Teleport 到 viewport 的形式，贴在目标节点的 Top/Right/Bottom/Left 侧，随视口缩放/平移定位。

### 4.2 Props / 输入契约
- Props（`:12-20`）：`nodeId?: string|string[]`、`isVisible?: boolean`、`position?: Position`(默认 Top)、`offset?: number`(默认10)、`align?: 'center'|'start'|'end'`(默认 center)、`alignOffset?: number`(默认0)、`zIndexOffset?: number`(默认0)。withDefaults(`:22-29`)。
- `contextNodeId = inject(NodeIdInjection, null)`（`:31`）——若没传 nodeId 用 VueFlow 注入的节点上下文 id。
- `useVueFlow()` 取 `viewportRef/viewport/getSelectedNodes/findNode`（`:33`）；`useCanvasStore()` 取 `isBoxSelecting`（`:35`）。

### 4.3 渲染逻辑
- `nodes = (props.nodeId 数组化 || [nodeId||contextNodeId])` → reduce `findNode` 去空（`:37-44`）。
- `isActive`（`:46-52`）：
  - **`canvas.isBoxSelecting` 为 true → 恒 false（框选时不显示工具栏）。**
  - `isVisible` 是 boolean → 直接用它。
  - 否则：**仅当 `nodes.length===1 && nodes[0].selected && getSelectedNodes.length===1`** 时显示（单节点选中且全局恰选中 1 个）。
- `nodeRect = getRectOfNodes(nodes)`（`:54`）合并所有节点矩形。
- `zIndex = max(node.computedPosition.z||1)+1 + zIndexOffset`（`:56`）。
- `wrapperStyle = absolute + transform(getTransform(...)) + zIndex`（`:58-62`）。
- `getTransform`（`:64-102`）：
  - align→alignmentOffset：start=0/end=1/center=0.5。
  - 依 position 分支算出 `pos`(translate px) 与 `shift`(translate %)：
    - Top：pos=(nodeRect.x+w*alignOff)*zoom+viewport.x+alignOffset, (nodeRect.y)*zoom+viewport.y-offset；shift=(-100*alignOff,-100)。→ 贴节点上缘外，上移 offset，水平按 align 偏移。
    - Right：贴右边缘右 offset；shift=(0,-100*alignOff)。
    - Bottom：贴下边缘下 offset；shift=(-100*alignOff,0)。
    - Left：贴左边缘左 offset；shift=(-100,-100*alignOff)。
  - 返回 `translate(px) translate(%)` 两级位移：px 定位到锚点，% 以自身尺寸做二次偏移（以 align 居中/靠边、并把浮层中心对准锚点）。
- 模板（`:105-111`）：`<Teleport :to="viewportRef" :disabled="!viewportRef">` → `v-if="isActive && nodes.length"` 的 `.vf-node-toolbar select-none nodrag nopan`（**nodrag/nopan：不触发节点拖拽、不触发画布平移**）`@dblclick.stop`；slot 内容。

### 4.4 交互行为
无拖拽自身逻辑；类上 nodrag nopan 保证在其上点击/拖拽不拖动节点/画布。Teleport 到 viewport 让其跟随视口 transform（VueFlow 的 `.vue-flow__viewport` 承载视口位移/缩放）。dblclick 阻断，防冒泡触发布局编辑器等的双击动作。

### 4.5 边界 / 坑
- 空 nodeId/contextNodeId → nodes 空 → 不渲染。
- 多节点(nodeId 数组)选中工具栏**仍只在单节点且全局唯一选中时显示**；多节点共用时工具栏实际显示条件由调用方兜住（此处默认隐藏）。
- 定位依赖 `node.computedPosition.z`（VueFlow 计算的堆叠），v2 需保留同语义。

---

## 5. ResizeHandle.vue（67 行）— 通用裁剪/扩展控制柄（非 BaseNode 的 resize）

### 5.1 职责
统一"裁剪/扩展"类交互框八方向控制柄外观与光标；**不含定位逻辑**（定位由调用方负责，避免 absolute vs fixed 冲突）。注意：**这不是 BaseNode 用的右下角 resize 句柄**（那个是 BaseNode 内联实现的）。这里供裁剪/扩展浮层复用。

### 5.2 Props / 输入契约
- `dir: 'nw'|'ne'|'sw'|'se'|'n'|'s'|'w'|'e'`（`:18-19`）决定光标。
- `style?: CSSProperties`（`:21`）调用方传 position/left/top/right/bottom。
- emits：`pointerdown:[PointerEvent]`（`:24-26`）。

### 5.3 渲染逻辑 / 交互
- `<div class="resize-handle" :style="{cursor:cursorMap[dir], ...(style||{})}" role=button @pointerdown.stop="onPointerDown">`（`:45-51`）——**stop** 后 emit pointerdown，防止冒泡。
- 外观：10×10px、白底、1.5px 半透明黑边、2px 圆角、z-index 15、pointer-events:auto、`touch-action:none`、box-sizing:border-box（`:55-66`）。绝对定位 absolute。
- cursorMap（`:28-37`）：dir→`nw-resize/ne-resize/sw-resize/se-resize/n-resize/s-resize/w-resize/e-resize`。
- aria-label `resize ${dir}`。

### 5.4 边界 / 坑
- 纯外观+转发事件件，真正拖拽逻辑在调用方（裁剪/扩展浮层），v2 别把拖拽逻辑塞进来。
- 无方向内置定位（absolute/fixed 由调用方传 style）。touch-action:none 允许触摸拖拽不被滚动拦截。

---

## 6. CustomEdge.vue（649 行）— 自定义边/连接线渲染（**用户极在意，写最细**）

### 6.1 职责
渲染全部边（真实边 + 临时拖线 connection-line）：依据全局 edgeType 生成路径（bezier/straight/step/smoothstep），画底线 + 可选箭头 + 选中/连接高亮流光，支持双击剪切删除，并提供加宽透明点击热区。

### 6.2 Props / 输入契约
- `props = defineProps<EdgeProps & { temporary?: boolean; forceFlow?: boolean }>`（`:308-313`）。
  - EdgeProps 提供：`id/source/target/sourceX/sourceY/targetX/targetY/sourcePosition/targetPosition/sourceHandleId/targetHandleId/data/selected` 等。
  - 自定义：`temporary`（临时拖线/批量临时边标记）、`forceFlow`（强制走流光）。
- 视觉/几何配置全部读 `canvas.state.core.*` 实时值（`:321-331`），**不读 edge.data**（见 6.9 数据契约）。
- `canvas = useCanvasStore()`（`:319`）；`useVueFlow()` 取 `removeEdges`（`:314`）。
- `isTemporaryEdge = Boolean(props.temporary || props.data?.isTemp)`（`:316`）。

### 6.3 路径计算（几何核心）
Position 枚举本地手写 `{Left:'left',Right:'right',Top:'top',Bottom:'bottom'}`（`:9`）。
- handleDirections（`:14-19`）：Left→(-1,0)、Right→(1,0)、Top→(0,-1)、Bottom→(0,1)。
- `getSourcePosition`（`:51-54`）：`sourceHandleId==='source'`→Right；否则 normalize(sourcePosition) ?? Right。
- `getTargetPosition`（`:56-59`）：`targetHandleId==='target'`→Left；否则 normalize(targetPosition) ?? Left。
- `normalizePosition`（`:61-68`）：字符串含 left/right/top/bottom 关键词映射，否则 null。
- **sourcePos/targetPos computed（`:346-349`）**：`targetPos` 在**临时边**时强改为 source 的反侧（source=Right→target=Left，反之 Right），使临时拖线始终横贯；真实边用 `getTargetPosition`。
- `buildCustomEdgePath`（`:228-260`）：
  - straight：`M sx sy L tx ty`。
  - step：`buildStepPath(borderRadius:0, offset=edgeStepOffset)`。
  - smoothstep：`buildStepPath(borderRadius:edgeSmoothRadius, offset=edgeStepOffset)`。
  - bezier(默认)：`distX=max(|tx-sx|*0.5, 80)`；`c1x=sx+sourceSign*distX`、`c2x=tx+targetSign*distX`（source/target 在 Left 时符号 -1，否则 +1）；`M sx sy C c1x sy, c2x ty, tx ty`——水平控制点曲线，**最小曲率半径 80px**。
- `getPoints`（`:79-182`，vue-flow 的 getPoints 移植）：算 step/smoothstep 的中间折点。反向端口(源方向×目标方向=-1)分垂直/水平中线交叉；同侧/混合端口时按源目标相对方位选折点；同 position 且间距≤offset 时加 gapOffset 反向回缩避免自交；sourcePosition!==targetPosition 时做 flip 判定（`:147-158`）。返回 pathPoints + labelX/labelY。
- `buildStepPath`（`:202-226`）：`offset = params.offset ?? edgeStepOffset`（**注意：v-if 用的默认在调用处均已传 edgeStepOffset**）；用 getPoints 折点，中段经 `getBend` 圆角（半径 borderRadius）拼接；首点 M、尾点 L。
- `getBend`（`:184-200`）：折点 b 处圆角半径=`min(|ab|/2,|bc|/2,size)`；共线则直 L；水平→垂直或垂直→水平时画 Q 圆弧（bendSize 决定弧起点）。
- 真实边两端 handle 位置：见 6.9（createConnection 只在 sourceHandle/targetHandle 为 source/target 时才会创建，故这里几何默认即 source→Right、target→Left 方向）。

### 6.4 样式 / 状态渲染（模板 6.4-6.7 结构）
根 `<g class="custom-edge" :class="{highlight, 'is-temporary'}" :style>`（`:444-455`）绑定 CSS 变量：
- `--ce-da`=dashArray||'none'、`--ce-color`=edgeColor、`--ce-linew`=lineWidth+'px'、`--ce-arrow-opacity`=animateFlow?1:0.35。
- `@dblclick="showCutButtonAtPointer"`、`@mousemove="onMouseMove"`（`:453-454`）。

分两态（`edgeVisible` 为 true 才整体渲染 `:456`）：
**默认态（非高亮）**：单条淡灰底线 `.ef-base--dim`（`opacity:0.3`，`:578-580`），按 edgeColor/lineWidth/dashArray，`fill:none; stroke-linecap:round`（`:459-469`）。

**高亮态（animateFlow=true）**（`:472-519`）：
1. 底层原始连接线 `.ef-base`（`opacity:0.45`，`:576-577`）完整颜色宽度（`:474-482`）。
2. 若 `edgeAnimated && edgeGlowEnabled`：辉光 `.ef-runner-glow`（`opacity:0.55`，滤境 drop-shadow 半径=5×intensity、10×intensity；`:484-496`）+ 热斑 `.ef-runner-hot`（`opacity:0.92`，宽=max(1,lineWidth*0.65)，`:497-505`）。两者 `pathLength="300"` 使 dash 周期统一。
3. 否则若 `edgeAnimated && !edgeGlowEnabled`：仅热斑 `.ef-runner-hot`（`:508-518`）。
- 流光动画：`.ef-runner` 上 `stroke-dasharray:24 76; animation: ef-dash 1.2s linear infinite, ef-breathe 1.6s ease-in-out infinite`（`:589-595`）；ef-dash→stroke-dashoffset:-100、ef-breathe 0.55↔1 opacity（`:614-622`）。高亮路径底宽=lineWidth，热斑宽=lineWidth*0.65。

**箭头（marker，手绘非 SVG marker）**（`:420-440, :522-531`）：
- `if (edgeMarkerEnd && edgeVisible)` 渲染 `.ef-arrow`（`:523`）。
- `arrowPath`：从路径采样 `samplePath(0.92)`(尖端前)与 `samplePath(1.0)`(终点) 算角度；`len=edgeMarkerSize`；`halfOpen=π/6.5`(≈28°)；尖端回退 `len*0.15` 防被节点遮挡；两翼从尖端沿±halfOpen 反方向各 len。返回 `M w1 L tip L w2`（`:420-440`）。
- stroke=edgeColor、宽=lineWidth、圆头/圆接（`:522-531`）；颜色/宽度经 CSS `!important` 覆盖（`.ef-arrow` `:608-612`），opacity 由 `--ce-arrow-opacity`（高亮 1、默认 0.35）。

**点击热区**（`:534-542`）：透明 `.edge-hit-area`，`:d=edgePath`、`stroke:transparent`、`stroke-width:max(12,lineWidth)`、`pointer-events:stroke`（`:570-572`）——加宽不可见命中带，保证易点中。

**剪切按钮（双击）**（`:545-558, foreignObject`）：双击后显示 32×32 `<foreignObject>` 按钮 `.cut-btn`（悬停红底白叉），`@click.stop=cutEdge`、`@mousedown.stop`。样式（`:624-641`）：白底圆钮、hover 背景 #ef4444。

### 6.5 高亮判定 / 选中态
- `isHighlighted = isTemporaryEdge || selectedNodeIds.has(source) || selectedNodeIds.has(target) || selectedEdgeIds.has(id)`（`:338-343`）——**O(1) 读 selectionState Set**；临时边恒高亮；源/目标任一节点被选即高亮；边自身被选也高亮。
- `animateFlow = forceFlow || isHighlighted`（`:417`）。
- 全局 CSS 覆盖（`:644-649`）：`.vue-flow__edge.animated .custom-edge path { stroke-dasharray: var(--ce-da)!important }`，**覆盖 VueFlow 自带 `.animated path{dasharray:5}`**，走 CSS 变量。
- `<g>` 上 `stroke`/`stroke-width` 过渡 0.2s（`.custom-edge path { transition: stroke 0.2s, stroke-width 0.2s }`，`:567-569`）。

### 6.6 交互行为
- **双击 → 显示剪切按钮**：`showCutButtonAtPointer`（`:392-397`）：temp 边 return；stopPropagation；`updateCutButtonPosition`（从 `ev.currentTarget.closest('svg')` 取 screenCTM 反算画布坐标再 `findClosestPoint` 归到路径上）；showCutButton=true。
- `findClosestPoint`（`:370-378`）：把路径按 `t∈[0,50]/50` 采样 51 点，取离鼠标最近点作为按钮锚点。
- `onMouseMove`（`:399-402`）：按钮显示期间，鼠标在 `<g>` 上移动持续重算按钮位置（跟随）。
- `cutEdge`（`:404-408`）：stopPropagation+preventDefault；`removeEdges([props.id])`；hide。
- `closeCutButton`（`:410-414`）：`document click` 全局关闭（onMounted add / onUnmounted remove）。
- **`<g>` 自身无 pointerdown 阻止逻辑**——选中/拖拽由 VueFlow 外层处理；temp/高亮边仍可交互但 temp 边 dblclick 被跳过。
- 说明：双击是"显示剪切钮"，**不是直接删除**；点剪切钮才删。

### 6.7 尺寸 / 定位
无固定尺寸。路径纯 SVG d 数据。剪切按钮 foreignObject 以剪下最近点为中心 ±16px（32×32）。热区 stroke-width=max(12,lineWidth)。

### 6.8 与 useCanvasConnection 的校验/吸附配合（关键链路）
CustomEdge 本体不校验。完整链路：
1. **拖线实时边**：VueFlow `#connection-line` slot 用 `buildConnectionEdgeProps`（`useCanvasConnection.ts:748`）产出 props → `id:'__connection-line__'`、`temporary:true`、`forceFlow:true`、`type:'custom'`、`selected:true`、`animated:false`、`markerEnd:''`、`sourceHandleId/targetHandleId` 按起始端口（`:897-914`）——它被 CustomEdge 当 temp 边：恒高亮、箭头恒显示(animateFlow=1)、强制流光、target 反侧。**拖线边端点 targetX/Y 被吸附改写**（buildConnectionEdgeProps 内 snap 命中就把 endX/Y 吸到锚点，`:830-860`），配合 BaseNode 的 snap zone 可视化反馈。
2. **拖线校验反馈**：buildConnectionEdgeProps 单次遍历算全部 live 节点卡片数据 → connectable(有反向端口)与 feedback(非 temp)两种集合 → 依鼠标落在 snapZones(窄条,近端口) 还是 feedbackZones(卡片主体) 决定 zone；对 snap 命中查 `getInvalidConnectionReason`，合法则把线端点 snap 到锚点并置 `feedbackNodeId/zone='snap'`；body 命中仅设 zone='body' 反馈；非法给 invalid message（`:748-889` 全段）。据此驱动 BaseNode 的 snap/body/valid/invalid class 与 3D 反馈。
3. **放下连线**：`onConnectEnd`（`:603`区）用屏幕坐标 `findNearestConnectableNode`(snap 窄条) 或 `findNodeBodyAtPoint`(卡片主体) 找目标 → 校验 `getInvalidConnectionReason` → 合法则 `createConnection`。
4. **createConnection**（`:522-554`）：`toCanonicalConnection` 归一方向；重复/循环/类型/端口校验；`edgeId=e-{source}-{target}-{Date.now()}`、`type:'custom'`、`data:makeEdgeData(core)`(见 6.9)、`addEdges`。**只有源 handle='source'且目标='target'方向的连接会被创建**（其余方向经 toCanonical 翻转或拒绝，`:183-203`）。
5. VueFlow `@connect`(Handle 精确匹配 `onConnect`, `:715` 区) 与 `@connect-end` 双通道，防重复（`lastNativeConnectAt` 80ms 窗口，`connect-end` 判定 `:703-707, :631-636`）。
6. **ConnectionValidator**（`plugins/custom-handle/ConnectionValidator.ts`）：`normalizeConnection` 补 handle 默认('source'/'target')；`isValidCanvasConnection(connection,getNodes,getEdges)` 校验：两端存在、source/target 端口存在(`sourcePosition`/`targetPosition`)、非自连、sourceHandle==='source' 且 targetHandle==='target'、**排除 data.isTemp 边**后无重复（`:7-25`）。**这决定 VueFlow 内部对"放到真实 Handle 上"的边是否放行**；而 useCanvasConnection 的 isValidConnection(`useCanvasConnection.ts:522` 区)是自定义拖线路径的校验。二者 isTemp 语义一致（temp 边不占重复名额）。

### 6.9 数据契约 / edge.data 字段
CustomEdge **渲染只依赖 canvas.state.core（实时），不读 edge.data 作视觉**。真实边 `data` 由 `makeEdgeData` 生成，仅含 `{edgeType, edgeLineWidth, edgeColor, edgeDashed}`（`useCanvasFlow.ts:66-70` 与 `Canvas.vue:73-79` 同构）——用于持久化恢复；`data.isTemp` 标记 temp 边（ConnectionValidator/useCanvasConnection 判断）。批量连线临时边（`:1205-1233`）`data:{isTemp:true}` + id 前缀 `selection-batch-edge-`。拖线连接线临时 props（`temporary:true`）不含进 VueFlow 边表（只是 connection-line slot 的 props，id `__connection-line__`）。
- 读 `selectedEdgeIds/selectedNodeIds`（高亮）；`removeEdges`(删除)；`props.source/target`(高亮关联)。

### 6.10 边界 / 坑
- **edgeVisible=false 时整 `<template v-if>` 不渲染**（连热区也没有，边不可点、不可选、不可删）（`:456`）。
- temp 边(sourceX/Y=起点, targetX/Y=吸附点或鼠标)：targetPos 强制反侧保证始终横贯能看（`:347-349`）。
- **bezier 曲率最小 80px**（`:254`），source/target 任一在 Left 侧符号变负。
- 流光只在高亮/临时边跑（性能：普通边不跑 CSS animation）。
- **marker 由采样画，非 SVG marker**：箭头方向=路径末端实际方向，避免 marker-end 在弯线/多段线上的错向。
- `getBend` 圆角半径受限于相邻段长一半，防止过短段圆弧越界（`:185`）。
- **双击→剪切**与 VueFlow 默认双击行为共存需 stopPropagation（`:394`）；document click 关闭剪切钮（点它自身 button 前会先被 document click 关？——button `@click.stop` 拦截后 cutEdge 照常执行，顺序安全）。
- temp/高亮边标记 class 供 CSS 区分（`.is-temporary`）。

---

## 7. MovingHandle / BaseNode / CustomEdge 之间的关键协作（含辅助件，交叉核对）

| 场景 | 发起方 | 承接方 | 契约点 |
|---|---|---|---|
| 拖线起点隐藏端口 | BaseNode:isCurrentConnectingNode `:208-211` | MovingHandle `disabled`（watch `:57-75`）| 源节点 disabled 端口并清残留 hover 状态 |
| 实时拖线边渲染 | VueFlow connection-line → `buildConnectionEdgeProps`(`useCanvasConnection.ts:748`) | CustomEdge temp+forceFlow | id `__connection-line__`、target 反侧、吸附改写 targetX/Y |
| 拖线中 snap/body 反馈 | buildConnectionEdgeProps 写 `canvas.connectionState.hoverNode`（rAF 节流 `:878-894`） | BaseNode connectionHover class/3D/tooltip `:225-288` | zone/status 语义：snap/body、valid/invalid |
| 放下创建 | onConnectEnd/onConnect → createConnection(`:522`) | 真实边 CustomEdge | 仅 source→target 方向；edgeId 规则；data=makeEdgeData |
| 复用规则去重 | isValidConnection(`useCanvasConnection.ts:522区`)、ConnectionValidator `:19-25` | — | data.isTemp 边不占重复名额 |
| 删除边 | CustomEdge cutEdge `removeEdges` | useCanvasConnection? 不参与 | — |

---

## 8. v2 不可改坏行为清单（金标准校验表）

**CustomNode.vue**
- 单节点错误边界：内容件崩只回退该卡（固定 256×100 占位），不拖垮画布（CustomNode.vue:33-50）。
- 分发路径三分支：错误占位 / selfRender 直出 / BaseNode 组装(带 3 slot)（CustomNode.vue:39,47-74）。
- Content/TopToolbar/BottomToolbar 全部由 `nodeDef.node/topToolbar/bottomToolbar` 决定，组件统一 `v-bind="$props"`（CustomNode.vue:26-28,53-73）。
- selfRender===true 但无 ContentComponent → 走组装分支不白屏（CustomNode.vue:53）。

**BaseNode.vue**
- 端口默认全显：target/source 显隐 = 显式 target/sourcePosition ?? nodeDef.canReceiveInput/canProduceOutput(默认 true)（BaseNode.vue:34-41）。
- zoom 反缩放全套防 0/负：`zoom=max(zoom||1,0.01)`（BaseNode.vue:48）；边框 1/zoom、选中环 2/zoom（:62,314,331）。
- 标题反向缩放 + 居中 + counter-border：屏幕宽度==卡片宽度、transform-origin left bottom（BaseNode.vue:50-73 + viewportSpace.ts:117-141）。
- LOD：zoom<nodeLodLowDetailZoom(0.4) 时简化（去阴影过渡、隐端口/反馈/选中环外反馈）（BaseNode.vue:59, 217-222, 636-639）。
- 端口显示条件 `!lowDetail && !suppressHandles && !是拖线起点 && (hover||selected)`（BaseNode.vue:217-222）。
- resize：data.resizable===true 才出句柄；min W120/H80；screen delta/zoom；pointer capture；结束时 updateNode 持久化 cardWidth/Height（BaseNode.vue:107,115-118,136-181）。
- resize 拖拽中抑制外部 data.cardWidth/Height 同步（防冲突）（BaseNode.vue:92-101）。
- 连接 3D 反馈：仅 valid 时 perspective(800) rotateX/Y(±18°) translateZ(10) scale(1.018)；invalid 只 blur 无 3D（BaseNode.vue:281-288 + constants.ts）。
- 无效气泡 clamp 卡内 6%~94% x / 8%~92% y（BaseNode.vue:342-359）。
- 标题重命名：双击/F2 进编辑、input 失焦/回车提交、Esc 取消(带 skipBlurCommit)、空 label→删 data.label 回落（BaseNode.vue:462-510）。
- 根元素 mouseleave 仅在非连接时复位 suppressHandles=false（BaseNode.vue:525）。
- 吸附调试矩形 geometry = handleRadius×三 ratio、从左缘伸 outer（BaseNode.vue:573-581）。
- 卡 transform-origin:center、box-sizing:border-box（BaseNode.vue:624-625）。

**MovingHandle.vue**
- 非 preview 时是真实 VueFlow Handle 连接点，锚点 1×1px、top50%/translateY(-50%)!important（MovingHandle.vue:233,286-301, 覆盖注入 transform）。
- source 靠右 right:0、target 靠左 left:0（MovingHandle.vue:310-316）。
- 按钮仅由 `.is-visible:not(.is-restoring)` 控 opacity 到 1，**不加 :hover 兜底**（防释放瞬间残留显示）（MovingHandle.vue:407-411）。
- 圆球几何：半圆本地坐标（非屏幕px）、outward 依方向、Y 中心偏移、followDistance=clamp(mouseDist+cursorGap,0,maxDistance)、atan2 X 除零保护 ||0.0001（MovingHandle.vue:176-194）。
- rAF 合帧写 buttonX/Y（MovingHandle.vue:144-154）。
- 离开归位 + restoreDuration=180ms 后淡出并 emit hover(false)（MovingHandle.vue:197-217）。
- disabled watch：清 timer/状态/emit hover(false)/归位；临时禁用源端口后状态清理（MovingHandle.vue:57-75）。
- target 按钮 left 补偿 +5px（VueFlow handle min-width:5px 坑）（MovingHandle.vue:95-96）。
- overlap 裁剪：半圆向内覆盖区 clip-path 裁内侧（MovingHandle.vue:331-341）。
- preview 模式 = `<span>` 无连接点、mousedown 左键 emit connectStart（MovingHandle.vue:219-224,233）。

**NodeToolbar.vue**
- 框选(isBoxSelecting)时工具栏恒不显示（NodeToolbar.vue:46-48）。
- 默认显隐：仅 `nodes.length===1 && 单节点selected && 全局恰选1个` 显示；isVisible boolean 可覆盖（NodeToolbar.vue:46-52）。
- Teleport 到 viewport + nodrag nopan + dblclick.stop（NodeToolbar.vue:107）。
- 定位：px 锚点(依 zoom/offset/align) + %二次位移居中；Top offset 向上、Right 向右、Bottom 向下、Left 向左（NodeToolbar.vue:64-102）。

**ResizeHandle.vue**
- dir→光标 8 向映射；外观 10×10 白底 1.5px 边 2px 圆角 z15、touch-action:none；pointerdown stop 后转发；纯外观无定位（ResizeHandle.vue:28-51,55-66）。

**CustomEdge.vue（用户最在意，最严）**
- edgeType：bezier(默认)/straight/step/smoothstep；bezier 控制点水平、最小 distX 80px（CustomEdge.vue:250-259）。
- source/target 位置：sourceHandleId==='source'→Right、targetHandleId==='target'→Left；临时边 targetPos 强制反侧（CustomEdge.vue:51-59,346-349）。
- 视觉全部读 canvas.state.core 实时值，不读 edge.data（CustomEdge.vue:321-331）。
- 渲染分两态：默认淡灰线 opacity0.3；高亮(temporary/forceFlow/源/目标/自身任一选中)→ 底 line(opacity.45)+流光(辉光宽=lineWidth drop-shadow + 热斑宽=lineWidth*0.65)，流光 pathLength=300、dash 24/76、ef-dash 1.2s + ef-breathe 1.6s（CustomEdge.vue:338-343,417,456-519,589-622）。
- edgeGlowEnabled=false 时只留热斑（CustomEdge.vue:508-518）。
- 箭头：edgeMarkerEnd 才画；采样 0.92/1.0 算角、半开角 ~28°、尖端回退 len*0.15、颜色宽度 !important；高亮 opacity1/默认 0.35（CustomEdge.vue:420-440,607-612）。
- 热区：透明 stroke-width=max(12,lineWidth)、pointer-events:stroke（CustomEdge.vue:534-542,570-572）。
- 双击显示剪切钮(非直接删)；按钮 32×32 foreignObject 定位在路径最近采样点；document click 关闭（CustomEdge.vue:392-414）。
- 覆盖 VueFlow `.animated path{dasharray:5}` → var(--ce-da)!important（CustomEdge.vue:644-649）。
- edgeVisible=false 整体不渲染（连热区/箭头都没有）（CustomEdge.vue:456）。
- 与连接配合：temp 边(id `__connection-line__`、temporary、forceFlow、selected、markerEnd:'')经 buildConnectionEdgeProps 产出（useCanvasConnection.ts:897-914）；吸附改写 targetX/Y（:830-860 附近）；真实边仅 source→target 方向创建（edgeId `e-{s}-{t}-{Date.now()}`，data=makeEdgeData {edgeType,edgeLineWidth,edgeColor,edgeDashed}）（useCanvasConnection.ts:522-554）。
- 去重排除 temp：isTemp/data.isTemp 边不算重复（ConnectionValidator.ts:19-25、useCanvasConnection.ts:230,202）。

---

*已核对辅助件落点：useCanvasStore 默认值 useCanvasStore.ts:40-95/135-211；nodeTypes/edgeTypes :227-234；connectionState/isConnecting :249, :342 区；buildConnectionEdgeProps useCanvasConnection.ts:748-914；createConnection :522-554；toCanonicalConnection :183-203；getInvalidConnectionReason :457-521 区；findNearest* / findNodeBodyAtPoint :300-455；moveTo snap 常量 :769-783 区。*
