# v2 vs v1 组件差距审计

> 依据金标准 `docs/tmp/canvas-core-v2-survey/core-node-contract.md`（§1 CustomNode / §2 BaseNode / §3 MovingHandle / §4 NodeToolbar / §5 ResizeHandle / §6 CustomEdge / §8 校验清单）
> 对 **packages/canvas-core-v2**（BaseNode.vue / CustomEdge.vue / MovingHandle.vue / edgeContext.ts / nodeRegistryKey.ts / canvasParamKey.ts / demo-web/CanvasDemo.vue）做只读审计。
> 只审不改。落点 file:line 以 v1 原始源码为准。v2 现状基于逐行精读 v2 源码 + grep 全目录确认（**无**即文件/符号在 v2 整个包内不存在）。

---

## 一、架构级差异（v2 的根因问题）

### 1. v2 缺"节点统一入口"，把"分发 + 错误边界"整层删了
- **v1**：真实节点 `type:'custom'` → **CustomNode.vue（统一入口，76 行）**，它读 `data.nodeType` 到 `nodeRegistry` 查 `nodeDef`，然后三分支：错误占位 / selfRender 直出 / BaseNode 组装(带 top-toolbar / content / bottom-toolbar 三个具名 slot)。整卡内容 = 一个"自包含插件"（nodeDef.node 组件 + nodeDef 配置）。
- **v2**：`nodeTypes = { text: BaseNode, image: BaseNode }`（CanvasDemo.vue:73），即**业务 type 直接映射到 BaseNode**，没有 CustomNode 分发层、没有 nodeDef 统一查询、**没有单节点错误边界（onErrorCaptured）**。BaseNode 靠 `resolveSegment(registry, props.type, seg)`（nodeRenderer）自己按 `type` 拆段渲染。
- 后果：任何 content 组件抛错 → 无回退占位（v1 会固定 256×100 错误卡、其余正常），v2 会直接让节点段崩、且错误沿组件树上传可能拖垮整卡/画布。**缺 CustomNode 的"容器职责"。**

### 2. v2 节点注册"二分"、且 data 无 `nodeType`，跟 v1 范式对不上
- **v1**：`context.canvasNodes.register({ type, node: markRaw(Comp), label, defaultSize, canReceiveInput, canProduceOutput, resizable, selfRender, titleIcon })`（TextNodePlugin.ts:26-32 / ImageNodePlugin.ts:630-639）——UI 组件 + 节点能力**一体注册**，经 `markRaw` 注入运行时 nodeRegistry。data 里带 `nodeType`，CustomNode/BaseNode 都靠 `data.nodeType` 查 nodeDef。
- **v2**：能力与 UI 分离两套表——`nodeStore.registerType`（尺寸/端口声明）归内核，`NodeRegistry.register(type, {segments})`（content/title/toolbar **组件句柄**）归展示。VueFlow 节点的 `type` 直接是业务 type，**data 里没有 nodeType 字段**，BaseNode 用 `props.type` 而非 `data.nodeType` 查段组件（BaseNode.vue:101-104）。
- 后果：v2 的"节点"不是一个自包含插件实体，而是"内核数据模型 + 展示注册表 + 宿主手搓接线"三处拼凑；nodeDef 里 `canReceiveInput/canProduceOutput/selfRender/titleIcon/defaultSize/resizable` 等**能力字段全丢**，只有 4 段组件路由。**数据契约（nodeType）与注册范式（markRaw 一体注册）双走样。**

### 3. v2 BaseNode 是"扁平自给壳"，不是 v1 的"组合外壳"
- **v1 BaseNode**：卡片外壳只负责布局 + 端口 + 标题容器 + resize + 连接反馈 + 透传 3 个 slot，标题内容由 `BaseTitle`（带 icon/label/extra 三段子 slot）承担，上下工具栏 slot 在 **CustomNode** 里用 NodeToolbar 包好再塞进来，**ResizeHandle/BaseTitle/NodeToolbar 是独立组件**，v2 里这些组件**一个都不存在**。
- **v2 BaseNode**：标题用自写 `<span>/<input>`（BaseNode.vue:202-216）、工具栏用裸 `<div>` 直接插 content（:162-164,:227-229）**不是浮层/Teleport**、无 BaseTitle/NodeToolbar/ResizeHandle 引用。目录里 `grep BaseTitle/NodeToolbar/ResizeHandle` → 0 命中。
- 后果：v1 的标题可扩展（title-icon/title-extra）、工具栏是"Teleport 到 viewport 的浮层 + nodrag/nopan + 选中态控制 + 框选隐藏"这些**结构性能力**在 v2 全部退化成内联静态 div，后续要补 overlay/裁剪等高级壳会处处重写。

### 4. v2 完全没有"连接交互"这一层（连接反馈/吸附/临时边全无）
- **v1**：`useCanvasConnection` + `canvas.connectionState`（isConnecting/hoverNode/suppressHandles/activeConnection）驱动 BaseNode 的连接 3D 反馈、无效气泡、吸附 debug 区、拖线起点隐藏端口；`buildConnectionEdgeProps` 产 `id:'__connection-line__'` 的 **temp 边**（targetX/Y 被 snap 吸附改写）进 `#connection-line` slot，交给 CustomEdge 渲染 + 强制流光。
- **v2**：`services/connection.ts` **只有纯校验逻辑**（normalize/toCanonical/环/去重/accepts/limit，逐条照抄 v1 校验规则），**没有任何 UI 交互层**：grep `connection-line / isConnecting / hoverNode / snap / suppressHandles / isCurrentConnectingNode` → v2 源码 **0 命中**。VueFlow 的 `#connection-line` slot 未用；CustomEdge 的 temp/forceFlow/`temporary` 通道**没有任何调用方**（唯一临时边靠 CanvasDemo seed 一条 demo 边 :282，不是拖线实时边）。
- 后果：CustomEdge 的 temp 流光/反侧 targetPos 是"能渲染但无输入"，BaseNode 的连接 3D 反馈/端口联动是"纯不存在"。v1 最核心的"拖线体验"（起点头隐藏、目标卡翘起/无效白雾/气泡、吸附）整体缺失。

### 5. v1 组件读"实时全局配置"，v2 读"注入 props/默认值"
- **v1**：CustomNode/BaseNode/CustomEdge/MovingHandle 全部读 `canvas.state.core.*`（handleRadius/各 offset/edge*/nodeTitleOffset/LOD 阈值…），面板一改全局实时生效、并持久化到 localStorage `canvas-state.core`（useCanvasStore.ts:40-95/:135-211）。
- **v2**：BaseNode 读 `inject(CANVAS_PARAMS_KEY)`（5 个 handle 尺寸，缺省回落 DEFAULT_HANDLE，BaseNode.vue:111-119）；CustomEdge 读 `inject(EDGE_VISUAL_KEY)`（缺省回落内置默认，CustomEdge.vue:54-66）；**这些默认值硬编码进 v2 组件**，且 v2 只取了 contract §0 里 BaseNode/MovingHandle/CustomEdge 用到的**子集**（如 nodeTitleOffset/LOD/topToolbarOffset/snap 三 ratio/edgeStepOffset 等散落在各处或未建模）。CanvasDemo 用 `reactive(cfg)` 手动 provide（CanvasDemo.vue:80-113）模拟"实时"，但**不是 store、不持久化 core 命名空间、读的是注入快照而非单一数据源**。
- 后果：v2 是"每组件自持一份默认值 + 宿主可注入覆盖"，与 v1 "一处全局配置、全组件实时读取"**数据流方向相反**；将来对接 v1 的 DynamicSettingsPanel 需重造一套 state。

### 6. v2 卡片尺寸模型不同（内容自适应 vs 显式 cardWidth/Height）
- **v1**：卡片固定 `width/height` = data.cardWidth/cardHeight（默认 256，useCanvasStore 外由 data 决定），支持**右下角 resize 拖拽**并把尺寸写回 data 持久化（BaseNode.vue:80-186）。
- **v2**：BaseNode **没有 cardWidth/cardHeight prop/data**，卡片尺寸完全内容自适应（`.v2-card` 只有 min-width/min-height:120×40，无 width/height，:246-247）；标题反缩宽度靠 ResizeObserver 实测卡片 DOM 宽度换算（BaseNode.vue:124-147），而 v1 直接 `cardWidth.value * max(zoom,minZoom)`。
- 后果：v1 的 resize 持久化、统一 256 默认布局、以及 image 这类定宽节点在 v2 无法表达；v2 标题测量多走一次真实 DOM（更慢、依赖挂载）。

---

## 二、缺失清单（v2 完全没有的功能/组件）

> v2 现状三态：**无** = 符号/文件在整个 v2 包不存在；**占位** = 有痕迹但非功能；**简化** = v1 复杂行为被 v2 砍成简单行为。

| # | 功能 | v1 位置 | 金标准章节 | v2 现状 |
|---|---|---|---|---|
| M1 | **CustomNode 统一入口组件**（nodeDef 分发 + 三分支） | components/CustomNode.vue | §1.3 | 无（nodeTypes 直接=BaseNode） |
| M2 | 单节点**错误边界** onErrorCaptured + 256×100 错误回退占位 | CustomNode.vue:30-50 | §8-CustomNode | 无 |
| M3 | selfRender 直出通道（`selfRender===true` → `<component :is="node" v-bind="$props"/>`） | CustomNode.vue:39,53 | §8-CustomNode | 无（image 本该 selfRender，v2 全走组装） |
| M4 | 上下工具栏 **NodeToolbar 浮层**（Teleport 到 viewport + nodrag/nopan + 选中态/框选显隐 + px 锚点+%二次位移定位） | components/Decoration/NodeToolbar.vue | §4 + §8-NodeToolbar | 无（v2 用静态 `<div class=top-toolbar>` 直接插） |
| M5 | **BaseTitle 组件**（title-icon/label/extra 三段、interactive/editing 态） | components/Decoration/BaseTitle.vue | §2.7(内部) | 无（v2 自写 span/input） |
| M6 | **ResizeHandle 通用裁剪/扩展 8 向控制柄** | components/Decoration/ResizeHandle.vue | §5 + §8-ResizeHandle | 无（v2 目录无此文件） |
| M7 | 节点右下角 **resize 拖拽句柄**（data.resizable===true 才出、min W120/H80、screen/zoom、pointer capture、updateNode 持久化） | BaseNode.vue:107,115-118,136-181 | §2.8 + §8-BaseNode | 无（v2 卡片不可 resize） |
| M8 | **连接 3D 反馈**（valid 时 perspective(800) rotateX/Y±18° translateZ scale；invalid 只 blur 无 3D） | BaseNode.vue:281-288 + constants.ts | §2.6 + §8-BaseNode | 无 |
| M9 | **无效连接气泡**（clamp 6%~94%x/8%~92%y、白雾 ::after blur、message/`无法连接`） | BaseNode.vue:342-359,369-372,568-570,693-706 | §2.6 + §8-BaseNode | 无 |
| M10 | **吸附调试可视化**（shouldShowTargetZones && debugHandle 时画 body zone + snap-zone 矩形 = handleRadius×三 ratio） | BaseNode.vue:257-274,573-581 | §2.6 + §8-BaseNode | 无（debug prop 有、实际 zone 无） |
| M11 | **拖线起点隐藏端口 + 禁用**（isCurrentConnectingNode → 自己端口隐藏并 disabled，MovingHandle watch 清残留） | BaseNode.vue:208-211,217-222 + MovingHandle.vue:57-75 | §2.5 + §7 | 无（v2 MovingHandle 从未被传 disabled=true） |
| M12 | **suppressHandles 全局抑制通道** + mouseleave 非连接才复位 | BaseNode.vue:217-222,525 | §2.5/§8 | 无 |
| M13 | **connection-line 临时拖线边**（buildConnectionEdgeProps 产 `id:'__connection-line__'`/temporary/forceFlow/selected/markerEnd:'')进 #connection-line slot、target 反侧、snap 吸附改写 targetX/Y） | useCanvasConnection.ts:748-914 + CustomEdge.vue:346-349 | §6.8 + §7 + §8-CustomEdge | 无（VueFlow #connection-line slot 未用；temp 边无来源） |
| M14 | **拖线中 snap/body 实时反馈**（hoverNode 写 connectionState、BaseNode 加 snap/body/valid/invalid class 与 3D、rAF 节流） | useCanvasConnection.ts:748-894 + BaseNode.vue:225-288 | §7 | 无（connection 层只有校验） |
| M15 | **放下连线路径**（onConnectEnd 用 findNearestConnectableNode/findNodeBodyAtPoint 找目标 → 校验 → createConnection） | useCanvasConnection.ts:300-455,522-554,603 | §7/§6.8 | 无（v2 用 VueFlow 原生 @connect，无吸附收线） |
| M16 | **反向 Title 的 cardBorderCompensation** 与 `left:-borderComp / bottom:calc(100%+offset+comp)` 精确定位 | BaseNode.vue:62,68-73 | §2.4 | 无（v2 title 用 left:-1px 硬编码） |
| M17 | **端口显隐按能力 gating**（showTarget/sourceHandle = 显式 target/sourcePosition ?? nodeDef.canReceiveInput/canProduceOutput 默认 true；nodeDef 无此字段） | BaseNode.vue:34-41 | §2.5 + §8 | 无（v2 两只 MovingHandle 无条件渲染） |
| M18 | 卡片**显式宽高**（data.cardWidth/cardHeight，默认 256）+ 外部同步 watch + resize 中抑制同步 | BaseNode.vue:80-101 | §2.2 | 无（内容自适应） |
| M19 | canvas **core 全局配置状态**（localStorage 持久化 core 命名空间、单一数据源、nodeTypes/edgeTypes 统一 {custom}） | useCanvasStore.ts:40-95,135-211,223,227-234 | §0 | 无（v2 用注入 key + 宿主 reactive cfg，不持久化 core） |
| M20 | v1 Canvas **节点类型 data.nodeType + nodeDef 能力字段**（canReceiveInput/canProduceOutput/selfRender/titleIcon/resizable/defaultSize/menuItem） | useCanvasStore/plugins 注册 | §1.2 | 无（v2 data 无 nodeType，只有 4 段组件路由） |
| M21 | **批量连线临时边**（`selection-batch-edge-` 前缀 + data.isTemp + id 前缀） | CustomEdge.vue:1205-1233(useCanvasConnection) | §6.9 | 无 |
| M22 | **真实 VueFlow Handle 精确 @connect 双通道去重**（lastNativeConnectAt 80ms 窗口防重复） | useCanvasConnection.ts:631-636,703-715 | §6.8 | 无（v2 走单一 onConnect） |
| M23 | **LOD 联动整壳**（zoom<0.4 隐端口/标题/反馈/选中环 + `.is-low-detail` 去阴影） | BaseNode.vue:59,217-222,636-639 | §2.4/§8 | 简化（v2 只隐标题 + 去卡片阴影：.v2-title display:none + is-low-detail） |
| M24 | **选中/裁剪 overlay 隐藏选中环**（showSelectionOutline = selected && !data._overlay） | BaseNode.vue:299-301 | §2.4 | 无（v2 无 _overlay 概念） |
| M25 | **标题 title-icon/title-extra 插槽与 nodeDef.titleIcon** | BaseTitle.vue + BaseNode.vue:539 | §2.7 | 无 |

---

## 三、走样清单（v2 有但跟 v1 不一致 / 自创）

| # | 功能 | v1 行为 | v2 现状 | 差异 |
|---|---|---|---|---|
| D1 | **节点注册/分发范式** | `data.nodeType` → nodeRegistry 查 nodeDef（含能力字段）；`markRaw` 一体注册 | 自创 `NODE_REGISTRY_KEY` + `props.type`（nodeRegistryKey.ts / BaseNode.vue:101）+ 4 段组件路由；data 无 nodeType | 架构级走样（见§一.2） |
| D2 | **组件读配置方式** | 全读 `canvas.state.core.*` 实时（pinia + localStorage） | 自创 `CANVAS_PARAMS_KEY`/`EDGE_VISUAL_KEY`/`EDGE_SELECTION_KEY` 注入默认值（canvasParamKey.ts / edgeContext.ts） | 数据流方向相反（§一.5）；且只含 core 子集 |
| D3 | **标题容器宽度** | `cardWidth * max(zoom,minZoom)` 纯计算 | ResizeObserver 实测卡片 DOM 宽再 /zoom（BaseNode.vue:124-147） | v2 多一次真实测量、依赖挂载，偏离 v1 公式 |
| D4 | **移动手柄默认光标间隙** | MovingHandle 默认 cursorGap=22，被 BaseNode 覆盖成 canvas.core.handleCursorGap=24 | v2 MovingHandle 默认 22，CanvasDemo 注入 24（MovingHandle.vue:60） | 与 v1 相同（22 默认被 24 覆盖）——**一致，无走样**，保留作对照 |
| D5 | **edgeGlowColor 默认** | v1 core 默认 `'#ffffff'`（白）；CustomEdge 直接 `canvas.state.core.edgeGlowColor` | v2 默认 `edgeGlowColor \|\| edgeColor` → 回落**线色蓝**（CustomEdge.vue:66） | **走样**：流光辉光默认白→蓝，观感不同；v1 白辉光 + 底蓝线 |
| D6 | **高亮集合读取** | `isHighlighted = isTemporaryEdge \|\| selectedNodeIds.has(source) \|\| selectedNodeIds.has(target) \|\| selectedEdgeIds.has(id)`（O(1) Set） | v2 相同 + 多读 `props.selected`（CustomEdge.vue:70-76） | v2 额外用 props.selected，语义更宽但非 v1 冲突；**基本一致** |
| D7 | **选中集合来源** | selectionState（pinia ref 单源） | 宿主 provide `selectedIds`（CanvasDemo.vue:113）；selectedEdgeIds 恒空 Set(:112) | 选中状态宿主手搓、未与内核 selection 双向闭环；**边自身选中永远为空** |
| D8 | **CustomEdge edgeVisible 整体 gating** | 整 `<template v-if=core.edgeVisible>`（含热区/箭头全无） | v2 外层 `<template v-if="edgeVisible">`（:189） | 基本一致（v2 箭头 v-if 重复 edgeVisible） |
| D9 | **临时边 targetPos 反侧** | temp 边 targetPos = source 反侧 | v2 相同（CustomEdge.vue:80-84） | 一致（无走样，列作对照） |
| D10 | **MovingHandle preview 语义** | preview=<span> 无连接点、左键 mousedown emit connectStart | v2 相同（MovingHandle.vue:206-211,220） | 一致（但 v2 无人用 preview 做 SelectionFrame 源） |
| D11 | **MovingHandle 端口按钮禁用联动** | BaseNode 传 disabled=isCurrentConnectingNode → 状态清理 | v2 MovingHandle disabled watch 逻辑齐全，但 BaseNode **从不传 disabled**（BaseNode.vue:168-191 无 disabled） | **disabled 通道空转**：watch 写了没用上 |
| D12 | **MovingHandle debug prop 传入** | BaseNode 传 `:debug="debugHandle"`（canvas.core.handleDebug 联动） | v2 BaseNode **不传 debug**（MovingHandle debug 默认 false，仅自身 prop 有） | v2 debug 可视化**无触发源** |
| D13 | **`node-size` prop 泄漏** | BaseNode 传 `:node-size="cardWidth"` 但 MovingHandle 未声明 → 落 attrs（v1 已知坑） | v2 BaseNode 不传 node-size，MovingHandle 也未声明 | v2 无此泄漏（干净但非刻意依赖），与 v1 等价可接受 |
| D14 | **target +5px 镜像补偿** | 左侧按钮 `left: buttonX+5px`（handle min-width:5px） | v2 相同（MovingHandle.vue:104-105） | 一致（对照） |
| D15 | **opacity 只由 is-visible:not(.is-restoring) 控制** | 刻意不加 :hover 兜底 | v2 相同（MovingHandle.vue:370-372） | 一致（对照，且注释点明原因） |
| D16 | **标题反缩放 scale 定义** | `1/max(zoom,minZoom)`（nodeTitleScaleMinZoom=0.5，offset=nodeTitleOffset*scale=12） | v2 `1/max(zoom,0.5)`，TITLE_OFFSET=6（BaseNode.vue:33-35） | **走样**：v1 nodeTitleOffset=12，v2 硬编码 6，标题离卡距离减半 |
| D17 | **卡 root mouseleave suppress 复位** | `mouseleave` 仅非连接时 reset suppressHandles | v2 `@mouseleave="isHovered=false"` 无连接态区分（BaseNode.vue:159） | 走样：缺连接上下文保护 |
| D18 | **moving scale 动画类** | `.moving-handle-button` moving 时 scale(1.06) | v2 相同（buttonStyle transform scale 1.06，MovingHandle.vue:99） | 一致 |
| D19 | **edgeAnimated 关闭/辉光关闭分支** | edgeAnimated=false → 只有底 line；edgeGlowEnabled=false → 只留热斑 | v2 相同分支结构（CustomEdge.vue:214-247） | 一致 |
| D20 | **剪切按钮 double-click 语义** | 双击仅**显示**剪切钮，document click 关闭，点钮才删 | v2 相同（CustomEdge.vue:129-151） | 一致 |
| D21 | **卡片尺寸/cardInlineStyle 稳定性** | shallowRef+watch 稳定引用 | v2 无 cardInlineStyle（尺寸自内容） | 见 §一.6，结构性差异 |
| D22 | **BaseNode 标题 hover 干扰处理** | 标题 mouseenter 置 isHovered=false 防干扰、mouseleave 还原 | v2 `.v2-title` 无 mouseenter/leave 处理（BaseNode.vue:194-217 只 dblclick/pointerdown.stop） | 走样：拖线/悬停态在标题上方可能误判 hover |
| D23 | **is-selected 用 showSelectionOutline** | outline 叠加 2/zoom、`selected && !_overlay` | v2 `.v2-node.is-selected` 用 box-shadow 0 0 0 2px（:263-268）非 outline、无 zoom 除 | 走样：选中环不随 zoom 恒定视觉 1-2px、且用阴影而非 outline |
| D24 | **编辑器 nodeLabel 回落** | `label \|\| data.nodeType \|\| '节点'` | v2 `label \|\| props.type \|\| '节点'`（BaseNode.vue:39-42） | 语义一致（因 v2 无 nodeType，用 type），行为对等 |
| D25 | **提交标题写回** | vf.updateNode(id,{data:{...label}}) 走 VueFlow | v2 经 `NODE_WRITE_KEY` 回调写内核 nodeStore + 整体替换 nodes（CanvasDemo.vue:55-65） | 写回机制不同（v2 因缺 store 走桥接），行为可接受但需宿主提供，缺省只读降级 |
| D26 | **isEditingTitle Esc 焦点残留** | cancel 带 skipBlurCommit 后**仍聚焦**（不主动 blur） | v2 cancelTitleEdit 只 skipBlurCommit + editing=false，未 blur input（BaseNode.vue:93-96） | 可能差一处：v1 依赖后续 blur 被吞；v2 输入框仍聚焦会触发下一次 blur 提交。需复核 |

---

## 四、UI 复刻 + dsh 插件化的最小施工顺序建议

> 目标：v2 节点 = v1 式"自包含插件"，1:1 复刻核心件。按依赖排序、每步可独立验收，复用现有 MovingHandle/CustomEdge 几何（已逐行对齐）。

### 阶段 A —— 把"统一入口"补回来（架构根，最先）
1. 新增 **CustomNode.vue**：读 `data.nodeType`（v2 节点 data 需补 nodeType）→ 重建 `nodeDef` 能力模型 → 三分支（错误/selfRender/组装）。节点类型改为只 `type:'custom'`，业务节点全部带 `nodeType`。
2. 补 **单节点错误边界**（onErrorCaptured + 256×100 回退占位）。
3. NodeRegistry 升级为 v1 语义：注册项含 `{ node(content组件), topToolbar, bottomToolbar, titleIcon, canReceiveInput, canProduceOutput, selfRender, resizable }`，从 dsh 插件的 `markRaw` 注册；废弃纯 4 段 segments 模型。
4. CustomNode 负责 3 个具名 slot：top(content/toolbar 组件或 BaseToolbar 回落)、content、bottom。

### 阶段 B —— BaseNode 对齐 v1 外壳
5. BaseNode 加回 `cardWidth/cardHeight`（data 驱动、默认 256、resize 抑制同步 watch）+ 内容裁剪层 `.content-clip` + 状态 class（is-selected/is-pointer-hovered/低细节/连接各态）。
6. 标题容器换用 **BaseTitle**（重建：title-icon/label/extra 三段、interactive/editing），nodeTitleOffset 对齐 v1=12、加 cardBorderCompensation 精确定位。
7. 补 **NodeToolbar**（重建浮层 + Teleport + 选中/框选显隐 + px+%定位）给上下工具栏用；新增 ResizeHandle（纯 8 向外观件）备用。

### 阶段 C —— 连接交互层（重头，承接已写好的校验 + CustomEdge 几何）
8. 建 v2 的 `connectionState` + useCanvasConnection 交互：isConnecting/hoverNode/suppressHandles；BaseNode 接 isCurrentConnectingNode → 给 MovingHandle 传 `disabled`。
9. BaseNode 补连接 3D 反馈、无效气泡、snap/body 可视化（读 core 三 ratio）。
10. 接 **#connection-line slot**：buildConnectionEdgeProps 产 temp 边（snap 吸附改写 targetX/Y、target 反侧）→ CustomEdge 强制流光；onConnectEnd 吸附找目标。

### 阶段 D —— 收尾对齐
11. canvas **core 状态**落位（localStorage core 命名空间单源），edgeGlowColor 默认改回 `#ffffff`；nodeTypes/edgeTypes 收敛为 `{custom}`。
12. 数据契约迁移：节点 data 补 `nodeType`；卡片尺寸持久化 cardWidth/cardHeight；移除非 v1 的自创注册/注入 key 或收敛为对 core 的兼容别名。

### 验收
- 每阶段用金标准 §8 校验表逐条核对；CustomNode(§1)、MovingHandle(§3)、CustomEdge(§6) 当前已对齐的（MovingHandle 几何、CustomEdge 几何/流光/剪切钮）不因迁移改坏。

---

*审计方式：逐行读 v2 BaseNode/CustomEdge/MovingHandle/edgeGeometry + 三个 key 文件 + CanvasDemo + nodeRegistry/nodeRenderer/connection.ts；对 v1 关键文件（CustomNode/BaseNode/NodeToolbar/ResizeHandle/BaseTitle/TextNodePlugin/ImageNodePlugin/useCanvasStore）精读交叉。缺项以 v2 包内 grep 0 命中佐证。*
