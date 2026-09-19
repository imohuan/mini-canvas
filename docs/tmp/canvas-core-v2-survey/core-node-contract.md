
# 核心节点件行为契约金标准（v2 现行实现）

> 用途：在改动下列六个文件之前必读。**禁止改坏**本文列出的任何行为。
> 依据：2026-09-17 对 `codex/registry-refactor` 分支现行源码的逐行精读（本文所有行号即该分支现状）。
> 历史说明：本文档的前身（v1 金标准，commit a37d4de）写的是 `packages/canvas-core` 的 v1 实现，
> 2026-09-05 随 docs/tmp 清理被删（commit c052633）。代码注释里引用的「core-node-contract §3 / §6 / §6.3」
> 指 v1 版文档的章节号；本文按 v2 现行实现重建，章节编号与 v1 版不一致（本文 §1=BaseNode、
> §2=MovingHandle、§3=BaseTitle、§4=CustomEdge、§5=ConnectionLine、§6=DefaultBackground）。
>
> 范围：`packages/plugins/plugin-theme-default/src/components/` 下的
> `node/BaseNode.vue`、`node/MovingHandle.vue`、`node/BaseTitle.vue`、
> `edge/CustomEdge.vue`、`edge/ConnectionLine.vue`、`background/DefaultBackground.vue`。
> 旁证规范：`docs/规则/节点区域与连接线拖拽规范.md`（节点三区域职责，下称「三区域规范」）。

---

## 0. 装配总图（六个件从哪来、到哪去）

### 0.1 注册与消费链

六个件全部由主题插件注册（`plugin-theme-default/src/index.ts`）：

| 件 | 注册槽 | 注册处 | 消费方 |
|---|---|---|---|
| BaseNode | `themeRegistry("nodeShell")` | index.ts:637 | CanvasHost.applyTheme → 每 type 的 `nodeTypes[t]`（canvasHostCore.ts:210-238 解析 `nodeShell:<type>` 优先、回落全局 nodeShell；CanvasHost.vue:255-258 markRaw 后喂 VueFlow） |
| CustomEdge | `themeRegistry("edge")` | index.ts:638 | CanvasHost → `edgeTypes.custom`（CanvasHost.vue:259）；另被 ConnectionLine 内部委托 |
| DefaultBackground | `themeRegistry("background")` | index.ts:639 | CanvasSurface 模板 `<component :is="backgroundComp">`（CanvasSurface.vue:347） |
| ConnectionLine | `themeRegistry("connectionLine")` | index.ts:640 | CanvasSurface `#connection-line` 槽 → ConnectionLineHost 渲染赢家（CanvasSurface.vue:349-356 + ConnectionLineHost.vue:50-63） |
| MovingHandle | 不进 themeRegistry | index.ts:671 直接导出 | BaseNode 内部渲染（BaseNode.vue:752/777）；外部复用：plugin-multi-select 批量连线端口（preview 模式，SelectionFrame.vue:1053-1099） |
| BaseTitle / TitleLabel | 不注册 | —（同目录静态 import） | 仅 BaseNode 默认标题条使用（BaseNode.vue:698-704） |

### 0.2 注入上下文（单令牌）

渲染子树统一走 `useCanvasRender()`（renderContext.ts:116-122，令牌 `RENDER_CONTEXT_KEY`，
由 CanvasSurface provide，CanvasSurface.vue:203）。六个旧令牌（NODE_REGISTRY_KEY 等）仍逐个 provide
兼容（CanvasSurface.vue:206-211）。CanvasRenderContext 全字段表见 renderContext.ts:42-107。

### 0.3 外观默认值（两处来源，勿混）

- 宿主回落默认：`DEFAULT_EDGE_VISUAL` / `DEFAULT_HANDLE_VISUAL` / `DEFAULT_DEBUG_VISUAL`
  （canvasHostCore.ts:245-283，portZoneWidth=86 / heightRatio=0.8 / arcRatio=1）。
- 主题插件 Config 默认：`DEFAULT_THEME_EDGE` / `DEFAULT_THEME_HANDLE`（index.ts:43-75，
  edgeColor=#1f2937、线宽 1.5、glow #0891b2、flow count 3 / ratio 20 / speed 1 / fade 35 / intensity 0.9；
  portZoneWidth=**10** / heightRatio=0.55 / arcRatio=0.8 —— 与宿主回落值不同，见 §9 可疑点）。

---

## 1. BaseNode.vue（1108 行）— 节点壳

### 1.1 是什么 / 谁用

所有未注册 `nodeShell:<type>` 专属壳的节点类型的统一外壳（孤儿 type 也映射到它，CanvasHost.vue:246-248）。
职责五件套：段组件路由（content/title/top/bottom/overlay）、卡片外观（边框/选中环/圆角/尺寸/resize）、
标题条与就地改名、端口显隐与拖线反馈、LOD 简化（文件头注释 BaseNode.vue:2-8）。

### 1.2 对外接口

- **props**：`NodeProps`（@vue-flow/core 全量节点 props，经 canvas-render re-export，vueFlowBridge.ts:17）。`defineOptions({ inheritAttrs: false })`（:40）——透传属性不落到根元素。
- **emits / slots：无**。它是"槽的渲染方"而非槽的提供方：区域条目组件收到 `{ id, data }`，
  另可收到注册时声明的 `props`（`attach`/`contribute` 的 props；没有就不传 —— 模板经
  RegionEntryHost 统一 `v-bind="entry.props"`）。
  ⚠️ **2026-09-19 更新（步骤十·能力包，commit d6dffae）**：十个区域渲染位从内联 `<component>`
  改为 `<RegionEntryHost>`（包一层 provide 能力袋，**不产生任何 DOM**）。
  区域条目组件**还**可经 `useCapabilities()` 取到自己 `needs` 声明过的能力包 ——
  这是新增的读取路径，原有的 `{ id, data, ...props }` props 契约一字未动。
- **注入读取**：
  - `useCanvasRender()`（:44）：ctx / registry / nodeWrite / handleParams / connectionState / interaction / debug / snapZone / updateNodeVisualSize / visibleRect。
  - `useVueFlow()`（:45）：`viewport.zoom` 是缩放唯一来源（:58）。
  - ctx 字符串服务：`settings`（:62-97）、`selection`（:288-295）、`nodeLayout`（:256）、`viewport`（:263）。全部可缺省降级（极简宿主/单测桩里缺了不抛错）。
- **注册表读取**：`resolveSegment(registry, type, "content" | "title")`（:307-308）、`nodeSegmentStackEntries(registry, type, "top-toolbar" | "bottom-toolbar" | "overlay")`（:313/314/326）。

### 1.3 模板层级与 z-index 表（改渲染位前必看）

```
.v2-node（根，flex column；is-selected/is-pointer-hovered/is-low-detail/is-connection-*）
├─ .v2-slot--top / --bottom   z:30  绝对定位浮层（上下插槽，定位在壳层）
├─ .v2-card（卡片本体，transform-origin:center）
│   ├─ .v2-multi-radio        z:26  多选标记（纯指示 pointer-events:none）
│   ├─ .v2-title              z:3   标题条（卡片内部 + 反向缩放）
│   ├─ .invalid-connection-tooltip / .will-evict-tooltip  z:60
│   ├─ .v2-debug-overlay      z:22  吸附调试 SVG（overflow:visible 可出卡）
│   ├─ .snap-band--input/output  z:21  吸附带（is-active 时才 pointer-events:auto）
│   ├─ MovingHandle(target)   anchor z:10 / zone z:11 / button z:2
│   ├─ .v2-content-clip       内容裁剪层（overflow:hidden，圆角继承）
│   ├─ .resize-handle         z:30  resize 拖柄（反缩放，origin 右下）
│   └─ MovingHandle(source)
└─ .v2-overlay                z:25  编辑浮层（卡片外、不反缩放）
```

### 1.4 不变量（改动时禁止破坏）

1. **缩放防零**：`zoom = max(vf.viewport.zoom || 1, 0.01)`（:58）。所有 `1/zoom` 反缩放共用它。
2. **反缩放三件套同一阈值**：标题条 `scale = 1/max(zoom, titleScaleMinZoom)`（:101/184-190）、
   多选标记（multiRadio.ts:133-144）、resize 拖柄（:154）共用 `titleScaleMinZoom`（默认 0.5）。
   baseNodeSlotsRender.test.ts:398-410 锁死"改阈值三处同源"，改一处必须核对另两处。
3. **LOD 是总开关**：`zoom < nodeLodLowDetailZoom`（默认 0.4，:69/100）同时隐藏标题条与 resize 拖柄
   （CSS :1104-1106）、去阴影与过渡（:845-848）、压端口与吸附带（:518-528/437-440）、压 3D 反馈
   （:401-408）、隐多选标记（默认，:130-134）。新增显隐一律挂进这个开关。
4. **选中环与边框独立**：环是 `.v2-card::after` 的 box-shadow，走 `--card-outline-width`（:855-862），
   宽 `2px/zoom`；边框 `1px/zoom`（cardFrame.ts）。frameless 类型边框为 0 时**环必须仍然可见**
   （cardFrame.test.ts:71-81）。
5. **两套选中来源不合并**：选中环读 `props.selected && !data._overlay`（:648）；多选判定走 ctx
   `selection` 服务 + selTick 手动触发（:286-305）。前者是 VueFlow 投影，后者是内核单源。
6. **卡片 hover 与端口 hover 互不覆写**：`isHovered` 只由卡片根 enter/leave 写（:415-424），
   `portHovered` 只由 MovingHandle `@hover` 写（:459-461）。历史上合并成一个 ref 是"端口随机显隐"
   的根因（注释 :454-458）。显示门取 `isHovered || portHovered || selected`（:527）。
7. **端口显示门禁止使用 isBusyDragging**：
   ```ts
   const shouldShowHandles = computed(() =>
     !lowDetail.value && !suppressHandles.value && !isCurrentConnectingNode.value &&
     !interaction.isNodeDragging.value && !isMultiSelected.value &&
     (isHovered.value || portHovered.value || props.selected))   // :518-528
   ```
   paneDragging 由 pan 与滚轮缩放共用事件写入且可能漏配对（CanvasHost.vue:410-433 有自愈兜底），
   用 isBusyDragging 会把端口永久压死（注释 :509-514）。
8. **拖线源判定必须走 isConnectionSource**（:384-386）：多选批量连线一次拖出多个源
   （ActiveConnection.sourceNodeIds，connectionContext.ts:29-45），直接比 sourceNodeId 会漏压其余源节点。
9. **端口禁用用 :disabled，禁止切 v-if**：blocked 同类型端口（:530-543）与源自身（:753/778）都传
   disabled；DOM 常驻保证 VueFlow handleBounds 稳定（注释 :545-548 + CanvasSurface 用
   ConnectionMode.Strict，:312）。
10. **三区域规范落地**（三区域规范 §一/§四/§五）：
    - 吸附带 `.snap-band`（:741-747）是唯一上报 aim 的端口区域；几何与 SnapZoneConfig 判定同源
      （useNodeDebugOverlay + computeSideBandRect，geometry.ts:113-141）。
    - 端口跟随区 `.port-follow-zone`（MovingHandle 内）**不上报 aim**，只管按钮跟随。
    - 卡片根 enter/leave 上报 body。
    - aimedTarget 写入规则：仅拖线中 && 非源自身；无端口能力的类型忽略 body（:473-499）；
      只清属于自己的 aimed，不覆盖别的节点（:478-480/493-496）。
11. **吸附锚点用真实渲染高度**：snapAnchorFor 用 `computedPosition + cardHeight/2`（:462-471），
    不用存储 dimensions —— 保证吸附点与画出来的端口垂直居中一致。
12. **3D 反馈只由数据层 valid 驱动**（三区域规范 §二）：
    ```ts
    const showConnectFeedback = computed(() => isConnecting.value && !isCurrentConnectingNode.value
      && !isConnectionInvalidTarget.value && !lowDetail.value && isConnectionValidTarget.value)  // :401-408
    ```
    invalid 时 cardTransform 返回空串（:596-603）。物理 hover 绝不触发 3D。
13. **气泡定位 clamp**：非法/满额气泡 x∈[0.06,0.94]、y∈[0.08,0.92]，默认 (8%,50%)（:632-645）。
14. **改名提交顺序**：先置 `isEditingTitle=false` 再 `nodeWrite` 写回（:270-279）——写回引发 label
    变化时组件已是非编辑态，插值才能刷成归一化结果。
15. **改名聚焦要"适当"**：只有节点矩形（含上方 32px 标题余量 TITLE_FOCUS_PAD，:261-268）不完全
    可见才 setCenter，且保留当前 zoom（:255-265）。
16. **resize 一次写回两份尺寸**：useNodeCardSize.onCommit 同一 patch 带 `cardWidth/cardHeight` 与
    保留键 `size`（useNodeCardSize.ts:104-116），宿主 splitNodeWritePatch 拆分后同一条历史提交
    （canvasHostCore.ts:29-41 + CanvasHost.vue:160-168）。拆成两次写会产生两条撤销记录。
17. **resize 拖拽中不回灌外部尺寸**：watch data.cardWidth/Height 时 `!isResizing` 才覆盖本地值
    （useNodeCardSize.ts:70-83）；move/up 绑全局 document（:91-118，绑元素会"拖一半断掉"）。
18. **上/下插槽定位全在壳层**：`resolveNodeSlotStyle` = 贴边 + `left:50%` + `translateX(-50%) scale(1/zoom)`，
    transformOrigin 朝卡片一侧（nodeLayoutSettings.ts:209-216）。"居中"与"反缩放"必须在同一个
    transform 里，分开写会互相顶掉（注释 :329-343，图片面板因此错位过）。
19. **overlay 段画在卡片外、不反缩放**：与 .v2-card 同级（:797-803），尺寸=卡片尺寸（:351-354）。
    放进 .v2-content-clip（overflow:hidden）会被裁掉——用户实测修过的缺陷，
    baseNodeSlotsRender.test.ts:141-192 整组锁死。
20. **段渲染 key 用注册 id**：top/bottom/overlay 的列表 key = `seg.id`（基座固定 "base"，:671/791/802）。
    用下标做 key 会在插件热装卸时让 Vue 错位复用组件实例（nodeRenderer.ts:41-58 注释）。
21. **插槽/浮层压制条件**：`hideToolbars = interaction.isSelecting || 多选`（:117-119）；标题另受
    `multiSelectHideTitles`（multi-select 插件声明的 key，:76-78）与 LOD 控制（:109）。
22. **设置订阅按 key 过滤**（:94-97）：全局平面 key 表，不按插件 scope 过滤（避免命名/装配差异
    导致不触发）。键名带前缀防撞（multiRadio.ts:29-40）。

### 1.5 已知易碎点（作者注释明示）

1. `isHovered` 与 portHover 曾合并导致端口随机显隐（:454-458 注释，历史 bug，勿复活）。
2. isBusyDragging 陷阱（:509-514 注释）：滚轮缩放抬位 + 漏发 moveEnd 永久压死端口。
3. "blocked → updateNodeInternals" 兜底曾存在、已刻意移除（:545-548 注释）：恢复会重新引入
   stale bounds 把线吸到错位置。
4. cardBorderComp 与 frameless 联动（:181-183）：frameless 类型边框补偿必须是 0，否则标题偏 1px。
5. 标题编辑用 contenteditable 不换 input（模板注释 :700；TitleLabel 文件头三条决策：同元素切属性
   防行高跳变、模板不写文本节点防 patch 覆盖草稿、草稿存 draft 防重挂载丢输入）。
6. 每个 BaseNode 实例都挂一份全局 settings.onChange（:95-97）：热路径靠 MULTI_RADIO_KEY_SET Set
   查询 + 不认识的键返回同一引用（multiRadio.ts:95-110）避免无谓重渲染。
7. 容器型（transparent）类型 body 瞄准被忽略（:483-485 注释）：否则出现"目标没有输入口"提示。
8. 卡宽/卡高 >0 才算反馈与气泡位置（:617-645），0/未量测时回落，禁止除零。

### 1.6 依赖方向 / 数据层关系

- **依赖**：canvas-render（useCanvasRender/useVueFlow/Position/isConnectionSource/resolveNodeSlotStyle/
  useToolbarOffsets/createV2Logger/NodeProps）；canvas-data（resolveSegment/nodeSegmentStackEntries）；
  同目录 MovingHandle/BaseTitle/TitleLabel + cardFrame/titleEdit/multiRadio 纯函数；
  ../../composables/{useNodeCapability, useNodeCardSize, useNodeDebugOverlay}。
- **被依赖**：CanvasHost（nodeTypes 装配）；无反向依赖。
- **数据层**：`nodeStore.types[type]`（经 useNodeCapability 读 hasTarget/hasSource/icon/frameless/
  transparent/resizable/defaultSize，useNodeCapability.ts:19-61；类型声明链见 registerNodeType.ts:61-100
  与 nodeStore.ts:77-111）；`selection` 服务；节点实例数据 props.data（label/cardWidth/resizable/
  _overlay 都是 data 字段）；写回统一 nodeWrite → 宿主 graph.updateNode（CanvasHost.vue:160-168）。
  selection 深度投影：nodesFromStore 给 VueFlow 节点打 selected 标记（canvasHostCore.ts:74-82）。

---

## 2. MovingHandle.vue（660 行）— 浮动端口

### 2.1 是什么 / 谁用

非 preview 时是**真实 VueFlow Handle 连接点**（1×1px 锚点）；半圆/矩形跟随区 + 浮动圆球按钮。
鼠标进入跟随区圆球从卡边"跳出"跟随，离开 180ms 归位淡出（文件头 :2-8）。使用者：BaseNode（左右各
一个，id 固定 "target"/"source"）；plugin-multi-select（preview 模式批量连线端口）；index.ts:671 对外导出。

### 2.2 对外接口

- **props**（:21-49）：

| prop | 类型/默认 | 含义 |
|---|---|---|
| id / type / position | string / "source"\|"target" / Position | 传给底层 Handle；BaseNode 固定 id=target/source |
| visible / disabled | boolean | 上层显示门 / 硬压制（disabled 时永不显示且清 hover 状态） |
| radius | 76（仅兜底） | 跟随区半径；BaseNode 传 zoneWidth/zoneHeight 后基本不用 |
| restOffset | 36 | 球静止位距卡边 px（handleRestOffset） |
| cursorGap | 24 | 跟随时球心与鼠标的间隙 px |
| buttonSize | 32 | 球直径 px |
| overlap | buttonSize/2 | 仅进入参数变更监听（:360），几何上 v2 已不 tuck（:231 注释） |
| zoneWidth / zoneHeight / zoneOffset | number | 跟随区矩形宽 / 高 / 偏移（卡内缩进为正） |
| zoneShape | "rect"\|"arc" | 形状；arc = 矩形 + 半椭圆耳朵（rx 由 arcRatio 控制，ry=带高/2 固定） |
| zoneArcRatio | 0.2~1 | 半椭圆水平饱满度（:91-104/175-206 几何注释） |
| preview | boolean | 只复用外观、渲染 span 不注册真实连接点；此时按钮可点并 emit connectStart |
| debug | boolean | 画 zone/center/rest/mouse 辅助线 |

- **emits**（:51-54）：`hover(bool)`（zone hover 状态，含 180ms 残留窗口）、`connectStart({event,type})`（仅 preview）。
- **slots：无**。**defineExpose**：`handleCardLeave(fromInside)`（:422）——BaseNode 卡片根 mouseleave 时调用做兜底归位。
- **注入读取：无**（纯 props 组件；只有 createV2Logger）。VueFlow 原语 Handle/Position 来自 canvas-render（:10）。

### 2.3 不变量

1. **显隐状态机**：`isShown = !disabled && visible && (selected || keepVisible)`（:112-115）。
   只亮"鼠标靠近的那个端口"——各实例只看自己的 keepVisible，整卡 hover 不许喂进来（:109-110 注释）。
2. **按钮可见性只由状态 class 控制，禁止加 :hover 兜底**（CSS 注释 :589-593）：连线释放瞬间鼠标
   仍压在区上，:hover 会绕过状态机把按钮重新顶出。
3. **disabled 置 true 必须清残留**：清 hideTimer、isMoving/isRestoring/keepVisible、emit hover(false)、
   restorePosition（:118-138）——否则松开后球因残留 keepVisible 再次显示。
4. **归位时序**：leave → isMoving=false、isRestoring=true、keepVisible=true、cancel rAF、
   restorePosition()（滑回静止位）、180ms 后 keepVisible=false + emit hover(false)（:373-398）。
   restoreDuration=180 与 CSS transition 180ms 一致（:67 + :496）。
5. **enter 不重置坐标**（:298-302 注释）：球停在静止位等第一条 mousemove，避免 enter 瞬间闪跳。
6. **鼠标坐标必须换算成区域本地坐标**（:331-340 注释）：VueFlow 缩放后 getBoundingClientRect 是
   缩放后尺寸，直接用屏幕 px 会错位。outward 统一为"距卡边距离"（source 正向 / target 反向，:337）。
7. **跟随目标几何**（handleFollow.ts 纯函数，可单测）：
   - `followTarget(mouse, gap, maxOut)`：沿"锚点→鼠标"射线外推 gap；总距离封顶 maxOut（球心不越区）；
     鼠标压锚点时 atan2 用 `mouse.out || 0.0001` 防退化（handleFollow.ts:16-27）。
   - `stepFollow(cur, tgt, ease)`：每帧按 0.18 比例逼近（滞回手感，:69-77 注释 + :262-272 tickFollow）。
   - `needsMoreFrames`：差距 ≤0.25 停 rAF，不空转。
8. **rAF 单帧排队**：`setTarget` 只在无 frameId 时 requestAnimationFrame（:274-280）；
   `commitPosition` 瞬移时先 cancel（:283-296）；unmount 取消 rAF 与 hideTimer（:424-427）。
9. **zone 层叠**：anchor 是 0×0 定位元素 z:10，有面积的 zone 必须显式 z:11 才能压住 pane，
   否则 elementFromPoint 命中 pane、mouseenter 永不触发（CSS 注释 :514-518）。
10. **Handle 强制样式**：`min-width/min-height:0 !important` + `transform: translateY(-50%) !important`
    （:473-493）。VueFlow 的 handle 默认 min 5px，不压回会让 zone 整体缩 5px、两侧不对称（:477-479 注释）。
11. **CSS 变量挂在 anchor 根**（:140-147 注释）：zone 与 debug svg 是兄弟元素，各自定位都读同一组
    `--port-zone-*` 变量；只写在 zone 的 inline style 上 debug 会取不到值。
12. **参数变化即时复位**：restOffset/buttonSize/zone 几何变化 → 非拖拽中 resetPosition（:354-371），
    设置面板改完实时生效，不等下一次 hover。
13. **卡片方向离场兜底**：起点在卡内、往卡内深处走的鼠标出不了 zone 的 mouseleave（zone 从卡内
    端起就在区内），BaseNode 卡片根 mouseleave 调 handleCardLeave(true) 把球拉回（:400-412 注释）。
14. **arc 几何"改弧不改半径"**：ry = 带高/2 永远撑满卡边垂直高度，rx = (h/2)×zoneArcRatio
    （:175-206）；矩形永远满高 h，耳朵端点贴在矩形外缘中央。
15. **卡边锚点（端口锚点）= source x=0 / target x=W（svg-local 卡缘处）**（:207-211），
    debugCenter/debugRestPoint/debugMousePoint 都以此为基准。

### 2.4 已知易碎点（作者注释明示）

1. preview 与真实 Handle 的分支只能靠 `component :is`（:431-440），分支判断散开会出现"外观在、
   连接点不在"或反向。
2. zone 的 clip 视觉（v1 用 clip-path）与 debug svg 裁剪冲突：v2 把 debug svg 放 zone 外兄弟节点
   （:454-455 注释），动 zone 结构时别把 debug 一起挪回去。
3. `handleLeave` 在 disabled 时直接 return（:374）：disabled 变化路径必须自己清状态（§2.3.3）。
4. 按钮尺寸/样式与 connectStart 只在 preview 生效（:414-419 + CSS :595-597）：非 preview 时按钮
   pointer-events:none，mousedown 不应触发任何连接逻辑。

### 2.5 依赖方向 / 数据层关系

- **依赖**：canvas-render（Handle/Position/createV2Logger）；同目录 handleFollow.ts（纯几何）。
- **被依赖**：BaseNode（内部）、plugin-multi-select/SelectionFrame（preview 批量端口）、index.ts 导出。
- **数据层：不直接读任何 store**。所有外观参数由 BaseNode 从 handleParams（CanvasParams）读出后以
  props 下传；连接能力显隐由 BaseNode 的 useNodeCapability 决定（hasTarget/hasSource）。

---

## 3. BaseTitle.vue（126 行）— 标题条（纯展示）

### 3.1 是什么 / 谁用

节点标题条，移植自 v1 Decoration/BaseTitle，纯展示组件（文件头 :2-5）。三段布局：图标 → 标签（80%）
→ extra（≤20%）。仅 BaseNode 默认标题条使用（BaseNode.vue:698-704，自定义 title 段注册时不走它）。

### 3.2 对外接口

- **props**：`label?: string`、`titleIcon?: unknown`（opaque 句柄）、`titleStyle?: CSSProperties`、
  `interactive?: boolean`（开 pointer-events）、`editing?: boolean`（样式钩子）。
- **slots**：`title-icon`（默认图标渲染）、`title-label`（默认 label 文本；BaseNode 在这里放 TitleLabel）、
  `title-extra`（右侧附加内容，max-width 20%）。
- **emits：无**。**注入：无**（唯一 import 是 kernel 的 iconRenderMode）。

### 3.3 不变量

1. **图标形态判定全局唯一**：iconRenderMode（kernel/iconKind.ts:20-28）——null/undefined/false/空串
   → "none"（**连图标位都不渲染**，:24 模板 `v-if="iconMode !== none"`），非空字符串 → v-html，
   其它 → `<component :is>`。baseTitleIcon.test.ts 锁死五种输入。
2. **标签槽宽恒 80% / extra ≤20%**（CSS :88-103/105-116）：文字省略 + 单行；extra 里多个 span
   也可收缩省略（:118-124）。
3. **默认不可交互**：根元素 `pointer-events:none`，interactive 才 auto（CSS :68-79）；
   BaseNode 传 interactive=true。
4. **纯展示**：无状态、无副作用；编辑态样式（base-title--editing）只是视觉钩子，真正编辑逻辑
   在 TitleLabel + BaseNode。

### 3.4 已知易碎点（作者注释明示）

1. 标签块内行内盒基线修正（CSS 注释 :83-90）：flex 居中只管块级盒，行内盒按基线对齐会下方多 4px
   空隙；标签容器必须是 `display:flex + align-items:center`。
2. 组件图标尺寸约束（CSS 注释 :60-64）：作者给的组件不必自带尺寸，外层统一约束到图标槽大小
   （`__icon > :deep(svg)` 100%）。
3. `title-icon` 声明为 unknown 是刻意（内核 opaque 句柄），收窄只允许经 iconRenderMode，
   不许手写 typeof 分支（避免与菜单层判定漂移）。

### 3.5 依赖方向 / 数据层关系

- **依赖**：@mini-canvas/kernel（iconRenderMode）、vue（computed/类型）。零 canvas-render、零 store。
- **被依赖**：仅 BaseNode。icon 数据链：nodeStore.types[type].icon（registerNodeType.ts:41+68）→
  useNodeCapability().icon → BaseNode titleIcon → BaseTitle。

---

## 4. CustomEdge.vue（684 行）— 自定义边 / 拖线临时线

### 4.1 是什么 / 谁用

全部边的渲染器（真实边 + ConnectionLine 委托的临时拖线）。导轨 + 固定 N 个胶囊渐变光斑沿路径流动、
箭头、双击剪切、加宽透明热区（文件头 :2-17）。装配：edgeTypes.custom（宿主）；被 ConnectionLine、
index.ts:673 直接导出。

### 4.2 对外接口

- **props**（CustomEdgeProps :38-56，withDefaults :58-63）：id/source/target/sourceX/Y/targetX/Y
  （默认 0）、sourcePosition/targetPosition（string）、sourceHandleId/targetHandleId、data、selected、
  `temporary`（拖线临时语义）、`forceFlow`（已声明未消费，见 §4.6）、`visual`（EdgeVisual 覆盖）、
  `geometry`（EdgeAppearance：minCurvature/stepOffset/smoothRadius）。
- **emits / slots：无**。
- **注入读取**：useCanvasRender 两次解构（:64-65）：`ctx / edgeVisual / edgeSelection / connectionState`。
- **数据读取**：canvas-data 的 `isTransient / DocService`（:20-21）。
  ⚠️ **2026-09-19 更新（步骤 5c）**：原写 `GRAPH_EDGES_KEY / EdgeStoreService / SaveService` ——
  这四个老名（nodeStore/edgeStore/graph/history）已从 ctx 服务表下线，数据统一经 `ctx.get('doc')`。

### 4.3 不变量

**可见性与临时语义**

1. `isTemporaryEdge = props.temporary || isTransient({data})`（:71）——内核通用契约 data.transient/
   data.isTemp（transient.ts:21-40）。
2. 临时线永远显示（隐藏连线不影响预览，:85-97）；不渲染点击热区与剪切钮（:634/166-168）；
   所有子元素 pointer-events:none（CSS :654-660 注释：否则偷走下方节点/端口的 hover 造成闪烁）。
3. 隐藏连线（edgeVisible=false）+ edgeVisibleOnSelect=true 时，只有端点被选中才显示（:88-95）。

**路径几何（edgeGeometry.ts，"与 v1 逐字节一致，禁止顺手改进"）**

4. 方向归一：`getSourcePosition/getTargetPosition`——handle==="source"/"target" 强制 Right/Left，
   否则 normalizePosition 关键词匹配（先命中先赢），缺省 Right/Left（edgeGeometry.ts:86-111；
   单测 edgeGeometry.test.ts "port 方向归一化" 组）。
5. 临时拖线的 sourcePosition/targetPosition 由 VueFlow 透传真实方向（ConnectionLine 不再硬编码，
   :119-121 注释），组件层不许做位置翻转。
6. bezier：控制点水平，distX = max(|Δx|/2, minCurvature=80)，source=Left 时符号取负
   （edgeGeometry.ts:390-401）。step/smoothstep 首尾伸出 stepOffset=20、圆角 smoothRadius=5
   （:341-389）。

**光斑（胶囊渐变渲染器）**

7. 光斑只在"边被激活"时出现：`flowActive = edgeFlowEnabled && isHighlighted && flowAllowedDuringDrag(...)`
   （:219-227）。isHighlighted = 临时 || 两端任一被选 || 本边被选 || props.selected（:110-116）。
8. **拖线压制**：拖线手势中只允许临时线本身流光，其余边（含选中高亮的）全部静止
   （edgeFlow.flowAllowedDuringDrag，edgeFlow.ts:83-101；用户报过"多选批量连线整片线都在流"）。
9. **固定 N 块几何**（edgeFlow.computeFlowBlocks，edgeFlow.ts:36-71）：整条路径均分 N 份、每份一个
   色块、块长=份长×占比%、相位对份长取模实现无缝循环、越界不夹取（头端滑入/尾端滑出交给渲染器
   按路径自然裁剪）。edgeFlow.test.ts 全组锁死。
10. **速度语义**（computeFlowAdvance，edgeFlow.ts:113-135）：前进量 = 线长 × (Δs/基准秒) × 倍数——
    走完一条线的时间固定（基准 2s / 倍数），与线长无关；短线长线同时出发同时到达。
    帧间隔 dt≥100ms（切页签回来）不推进，防跳变（:521-533）。
11. **渲染实现约束（文件头 :11-14 + :245-263 注释，全部是踩过的坑）**：
    - 禁用 SMIL `<animate>`：vdom patch 反复比较会把 path 的 d 清空、bbox=0、光斑不可见（浏览器实测）。
    - 禁用纯 CSS stroke-dashoffset keyframes：做不出两端渐隐。
    - 必须用"JS 直接 DOM 写入"（createElementNS + setAttribute）：块数量/属性**不进 Vue 响应式**，
      杜绝 patch 干扰（:257-259 注释）。
    - 每块一个 linearGradient 钉在块两端世界坐标（userSpaceOnUse），头尾渐隐占比 = flowFade（1~50）。
    - 每块配一支"隐形导轨"（stroke:none + stroke-width:0.001）承载块内弧长子路径（:252-254 注释；
      railHostEl 首条 = 主测长导轨，:574-596）。块长不用 linecap round 兜底（会把块撑大，:255 注释）。
    - 子路径 d 缓存按"导轨元素 → (a,b,totalLen,ox,oy)"记账（WeakMap，:400-416 注释：以元素为键
      防首帧回落主导轨的缓存被后续帧误命中）。
    - 宿主重挂载（flowActive 开关导致 v-if 重建）→ 池子归零重建（:460-470），防对无关宿主 removeChild。
    - 配置签名（含 edgePath）变化才整体重建；isHighlighted/辉光强度只逐帧改 style.filter 不进签名
      （:368-386 注释）。
12. 箭头：长度 = max(markerSize, lineWidth×3.5)，颜色 = **线色**（不是光斑色，:189-194 注释），
    用 :style 内联优先级压过全局 CSS（:15-16 注释）。

**交互**

13. 热区：加宽透明 stroke（max(12, lineWidth)）独立于可见性——隐藏连线时仍可选中/双击删除（:632-642）。
14. 双击剪切钮：定位 = findClosestPointOnPath（SVG CTM 换算，:147-163）；剪切优先走 ctx 命令
    `command:delete-edge`，缺省回落 `doc.removeEdges`（:172-184）。
    ⚠️ **2026-09-19 更新（步骤 5c）**：回落路径原为 `edgeStore.removeEdge + save.set(GRAPH_EDGES_KEY)`；
    四个老服务名（nodeStore/edgeStore/graph/history）下线后改为 `doc.removeEdges`。属**行为变化**（是修好，但要知情）：
    旧路不进历史、不清选中、直接写边域；新路经唯一图写入口 → **进撤销栈、清选中、整图信封落盘**（双击剪切现在可撤销）。
    另：`command:delete-edge` **全仓无注册点**（实际注册的是 `command:delete`），故这条「回落」是当前唯一生效路径。
15. 全局 click 关闭剪切钮（document 级，onMounted/onUnmounted 成对，:186-187）。

**遗留全局样式（改动前先读 §9-3）**

16. 文件底部还有一条全局（非 scoped）样式：`.vue-flow__edge.animated .custom-edge path.ef-base {
    stroke-dasharray: var(--ce-da) !important }`（:680-684）——但本组件 gStyle 已**不再提供** `--ce-da`
    （:232-237）。v1 里它用于覆盖 VueFlow animated 默认虚线；v2 现行没有任何代码设置 --ce-da
    （全仓 rg 仅 v1 canvas-core 与本文件此行），animated 边也不由本仓生成（canvas-render 不写
    edge.animated）。此行目前是**死样式**，动它之前先确认没有外部装配在用。

### 4.4 已知易碎点（作者注释明示）

1. "箭头颜色被覆盖为线色" 的历史 bug（:15-16 注释）：颜色必须 :style 内联绑定。
2. SMIL / vdom patch 清空 d 的坑（:11-14、:257-259 注释）——任何"优化回 v-for 响应式渲染"都会复发。
3. rAF 帧回调第一帧 rail 可能没渲染齐：`if (!rail || !transEl) continue` 下帧补齐（:495-496）。
4. getTotalLength 失败（几何未就绪）静默 return（:453-459），不许改成抛错。
5. props.visual 是浅合并覆盖（:66）：调用方只传覆盖字段；visual/geometry 由调用方（当前无人传）
   逐边定制用。
6. 临时线 cursor:default、正式边 cursor:pointer（CSS :647/:660）。

### 4.5 依赖方向 / 数据层关系

- **依赖**：canvas-render（useCanvasRender/EdgeVisual）、canvas-data（isTransient/DocService 类型；
  ⚠️ 2026-09-19 步骤 5c：原列 GRAPH_EDGES_KEY/EdgeStoreService/SaveService 已下线，统一走 doc）、
  同目录 edgeGeometry.ts/edgeFlow.ts。
- **被依赖**：ConnectionLine（委托渲染）、宿主 edgeTypes、index.ts 导出。
- **数据层**：外观 = 宿主注入 edgeVisual（实时对象）+ props.visual 合并，**不读 edge.data 的外观快照**；
  剪切写 `doc.removeEdges`（或命令；⚠️ 2026-09-19 步骤 5c 前是 edgeStore.removeEdge + save 域
  `graph.edges`）；选中集合 = 宿主 edgeSelection（内核 selection 投影，
  CanvasHost.vue:187-192）；connectionState 只读。

---

## 5. ConnectionLine.vue（48 行）— 拖线临时线壳

### 5.1 是什么 / 谁用

拖线期间 VueFlow `#connection-line` 槽的临时连线：薄壳，渲染**完全委托**给 CustomEdge
（temporary=true），使临时线与正式边视觉完全一致（文件头 :2-5）。装配：themeRegistry("connectionLine")
→ ConnectionLineHost 渲染（CanvasSurface.vue:349-356）；也被 plugin-multi-select 复用画批量引导线
（SelectionFrame.vue:1102-1121）。

### 5.2 对外接口

- **props**：sourceX/sourceY/targetX/targetY（number）、sourcePosition/targetPosition（string 可选）、
  `hasSnap`（仅保留 prop 兼容，CustomEdge 的高亮已覆盖，:19 注释）。
- **emits / slots / 注入：无**（CustomEdge 自己消费 useCanvasRender）。

### 5.3 不变量

1. **方向不许硬编码**：sourcePosition/targetPosition 必须用 vue-flow 透传值（fromHandle.position /
   toPosition）。硬编码 Right/Left 会让从 Left/Top 口拖出的贝塞尔反向弯折或压扁（:12-15 注释）——
   这是本组件存在的第一理由。
2. 委托渲染时固定 `id="__connection_line__"` + `temporary`（模板 :26-35）：CustomEdge 据此走临时线
   全套语义（永显、无热区、拖线中允许流光）。
3. 壳元素 `pointer-events:none`（CSS :41-43）：拖线中不许捕获任何画布交互。
4. **不消费 hasSnap**：吸附反馈的视觉由 CanvasHost 写 connectionState.hoverNode + CustomEdge 高亮
   完成（hasSnap prop 只是兼容保留）。

### 5.4 已知易碎点

1. 上游 ConnectionLineHost 决定端点：start = lineProps.sourceX/Y，end = dragFlowPoint（Host 每帧写的
   flow 坐标，优先）→ fallback lineProps.targetX/Y（ConnectionLineHost.vue:31-36）。改本组件 props
   语义时必须连着 Host 一起核对，避免双源端点。
2. 多选批量引导线复用本组件时（SelectionFrame），targetPosition 是手动按方向给的（"left"/"right"），
   依赖本组件"不硬编码、透传使用"的契约。

### 5.5 依赖方向 / 数据层关系

- **依赖**：仅 ./CustomEdge.vue。零 store、零注入。
- **被依赖**：ConnectionLineHost（themeRegistry 赢家）、plugin-multi-select、index.ts 导出。
- **数据层：不直接读**；吸附判定/落边全部在 CanvasHost（resolveFromAim / decideDropFromHover，
  CanvasHost.vue:724-762 + 627-677），本组件纯渲染。

---

## 6. DefaultBackground.vue（130 行）— 画布点状背景

### 6.1 是什么 / 谁用

主题插件提供的画布圆点网格背景。用 `<canvas>` 绘制取代"数千 SVG 圆点 + v-for"消除高节点数卡顿；
背景无 vue-flow 注册口，走"低层 child 叠加组件"通用法，宿主把它垫在节点/边之下（文件头 :2-5）。
装配：themeRegistry("background") → CanvasSurface 模板 VueFlow 默认插槽首元素（CanvasSurface.vue:346-347）。

### 6.2 对外接口

- **props / emits / slots：无**。
- **注入读取**：`useVueFlow()`（:11）只取 viewport（x/y/zoom）。

### 6.3 不变量

1. **层级**：`position:absolute; inset:0; pointer-events:none; z-index:0`（CSS :116-123）——
   铺满、绝不挡交互、垫在节点/边之下。加交互前先想清楚层级契约。
2. **只重绘可视区**：每帧用 `ctx.setTransform(dpr*z, 0, 0, dpr*z, dpr*vx, dpr*vy)` 把内容坐标
   直接映射设备像素，只画可视区内的格点（:63-104）；可视区外的点不画。这是它取代 v-for SVG 的核心。
3. **网格几何**：GRID=24（内容坐标）、屏幕步长下限 MIN_SCREEN_STEP=18（缩小画布时步长抬升为
   `18/zoom` 防点过密）、DOT_R=1.6（内容坐标，随 zoom 等比）、DOT_COLOR #cbd5e1 / BG #f8fafc
   （:14-19）。plugin-canvas-export 导出按 zoom=1 同参复刻这组常量（canvasExportPlugin.ts:89-91），
   改这里的值要连导出插件一起核对。
4. **重绘时机**：viewport(x/y/zoom) watch → 单帧重绘（:128-130，无 rAF 循环、非持续动画）；
   ResizeObserver 宿主尺寸变化 → fitCanvas + redraw（:106-114）；DPR 变化由 fitCanvas 重建位图（:32-42）。
5. **清理**：onBeforeUnmount 断开 ResizeObserver（:122-125）。canvas 位图尺寸至少 1px（:38-40）。

### 6.4 已知易碎点（作者注释明示）

1. moveTo 预留防止相邻点连线（:93 注释）——批量 arc 前必须 moveTo。
2. `zoom = max(viewport.zoom || 1, 0.01)`（:21）防零/负（与 BaseNode 同一套防除零习惯）。
3. fillRect 宽高多补一个 stepContent（:79-80）：缩放取整后边缘格点不缺角。
4. 颜色/网格参数硬编码不进 Config（settings-hierarchy 调查文档也记过这一点）：要参数化需同时改
   canvas-export 的复刻。

### 6.5 依赖方向 / 数据层关系

- **依赖**：vue（基础 API）、canvas-render（useVueFlow）。
- **被依赖**：无（叶子组件）。
- **数据层：零 store**。纯视口投影渲染。

---

## 7. 六件与数据层/注册表的关系一览

| 读 | 写 |
|---|---|
| nodeRegistry（BaseNode 区域路由：resolveSegment / nodeSegmentStackEntries；NodeSegment = NodeRegion 别名 = 十个区域词 in \| title \| out:top \| out:bottom \| out:left \| out:right \| on:top \| on:bottom \| over:inset \| over:outset，nodeRegistry.ts:34 = region.ts） | 无（六件都不写注册表；注册是插件 index.ts 的职责） |
| themeRegistry（间接：六件自己是被注册方；CanvasHost.applyTheme 消费） | 无 |
| doc.types（BaseNode 经 useNodeCapability；icon/frameless/transparent/resizable/inputs/outputs 全链；⚠️ 5c 前为 nodeStore.types，同一份只读投影） | 经 nodeWrite 间接（title label、resize 的 cardWidth/cardHeight + size） |
| selection 服务（BaseNode 多选判定；edgeSelection 投影给 CustomEdge 高亮） | 无 |
| settings 服务（BaseNode：titleOffset/titleScaleMinZoom/nodeLodLowDetailZoom/多选标记三键/multiSelectHideTitles；键全局平面、先声明者独占） | 无（只订阅） |
| nodeLayout / viewport 服务（BaseNode 改名聚焦） | viewport.setCenter（聚焦时） |
| edgeStore / save（CustomEdge 剪切回落路径） | removeEdge + save.set(GRAPH_EDGES_KEY, "canvas") |
**（2026-09-19 步骤 5c 后）** 上表这项已变：CustomEdge 的剪切回落路径改走 `doc.removeEdges`；
`edgeStore` / `save` / `nodeStore` / `graph` / `history` 五个名字中，前四个**已从 ctx 服务表下线**，
数据统一经 `ctx.get('doc')`。同时 BaseNode 的 `nodeStore.types` 读取改走 `doc.types`（同一份只读投影）。
| command 服务（CustomEdge 剪切优先路径 command:delete-edge） | execute |
| connectionState / interaction / debug / snapZone / handleParams / edgeVisual（渲染上下文只读对象） | connectionState.aimedTarget（BaseNode 是唯一写入方之一，见三区域规范 §四） |

NodeSegment 的解析层（nodeRenderer.ts）：resolveSegment 单值（基座）；nodeSegmentStackEntries 返回
"基座(固定 id=base) + contributions 按 order"的带 id 栈；activeSegments 供壳判断段是否有内容。
叠加层 API：NodeRegistry.registerContribution / unregisterContribution（nodeRegistry.ts:135-164）。

## 8. 行为契约测试网（改前跑、改后必须全绿）

- `pnpm -C packages/plugins/plugin-theme-default test`（STATUS.md 基线 158 条）。
- 与六件直接相关的测试文件：
  - node/__tests__/baseNodeSlotsRender.test.ts —— 插槽定位壳层契约、overlay 出卡片、多选压制、
    多选标记三配置、resize 拖柄反缩放（SSR 渲染真实 HTML 断言）。
  - node/__tests__/cardFrame.test.ts —— 边框/选中环/transparent/防坏 CSS。
  - node/__tests__/titleEdit.test.ts、titleLabel.test.ts、baseTitleIcon.test.ts —— 标题编辑纯逻辑与
    BaseTitle 图标位。
  - node/__tests__/handleFollow.test.ts、multiRadio.test.ts、multiRadioConfig.test.ts。
  - edge/__tests__/edgeGeometry.test.ts —— 几何"与 v1 逐字节一致"锚定（§4.3.4-6）。
  - edge/__tests__/edgeFlow.test.ts —— 固定 N 块/占比/循环/速度语义/拖线压制（§4.3.7-10）。
  - composables/__tests__/resizeDragSession.test.ts —— resize 会话。
  - 上游契约：canvas-render __tests__（connectionState/interactionContext/nodeLayoutSettings 等）。

## 9. 调查中发现的可疑之处（现状记录，不是本文建议）

1. **端口区默认值双源漂移**：宿主回落 `DEFAULT_HANDLE_VISUAL.portZoneWidth=86 / heightRatio=0.8 /
   arcRatio=1`（canvasHostCore.ts:268-277），主题插件 Config 默认 `portZoneWidth=10 / heightRatio=0.55 /
   arcRatio=0.8`（index.ts:66-75）。注释里"默认 86"的说法已与实际值 10 不符（d550a05 改 86→10 时
   注释没改）。宿主不装配该插件时端口区宽度差 8.6 倍。BaseNode.vue:566 注释仍写
   "DEFAULT_THEME_HANDLE.portZoneWidth = 86"。**动端口几何前必须先对齐这两处。**
2. **Cross-插件设置键弱耦合**：BaseNode 读 multi-select 插件声明的 `multiSelectHideTitles`（:76-78）。
   不是包依赖（§10 无环），但语义上是隐藏契约：multi-select 改键名会静默失效（settings 键全局表
   先声明者独占，撞名被静默跳过，multiRadio.ts:29-40 注释）。三区域规范之外的类似按名耦合还有
   multiRadio 三键（本插件自己声明，风险低）。
3. **CustomEdge 死样式**：`--ce-da` 全局规则（:680-684）引用的变量已无人提供（§4.3.16）。
   同类遗留：props.forceFlow（:53）声明后全组件未消费；props.hasSnap（ConnectionLine）仅兼容保留。
   BaseNode 的 `nextTick` import（:10）与 `showHandleDebugOverlay` computed（:553-555）当前均未在
   模板使用（端口调试直接经 MovingHandle :debug；showHandleDebugOverlay 若删注释也要一起核对）。
4. **aimedTarget 的写入方分散在 N 个节点实例**：每个 BaseNode 都 watch 并可能写 connectionState.aimedTarget
   （:473-499）。规则靠"只清自己的"维持正确性；如果未来出现第二个写入方（例如多选框批量端口），
   必须遵守同一规则（multi-select 目前走 host 的 onConnectStart 路径写 activeConnection，不写 aimed）。
5. **v1 金标准的章节引用已失效**：MovingHandle.vue:2 引用"§3"、CustomEdge.vue:2 引用"§6"、
   edgeGeometry.ts:4 引用"§6.3"，都是 v1 版文档的章节号；本文重建后章节号不同（§2=MovingHandle、
   §4=CustomEdge、§4.3 几何）。这些注释在下次触碰对应文件时顺手改指本文。
6. **debug 默认值全开**：宿主 `DEFAULT_DEBUG_VISUAL` 两个调试开关默认 true（canvasHostCore.ts:279-283），
   主题插件 Config 默认也是 true（index.ts:78-81）。生产画面默认叠加调试 SVG（端口半圆/吸附带），
   是否应该默认关值得跟用户确认——现状是"设计/排错方便优先"。
7. **panelImageWidth 等键名弱命名**：BaseNode 不直接读，但 theme-default 的布局键（toolbarTopOffset
   等）与 panel* 键都是全局平面名（index.ts:111-125），与 §9.2 同类风险。

## 10. 依赖方向核查结论（无环声明）

- **包级**：kernel ← canvas-data ← canvas-render ← plugin-theme-default（plugin-theme-default
  package.json：peerDependencies 含 canvas-render，dependencies 含 canvas-data/kernel）。六个件全部
  只 import 上游包与同目录文件；**无包级循环**。
- **已知插件间依赖（有意，非环）**：plugin-multi-select / plugin-node-image / plugin-node-text /
  plugin-node-video → plugin-theme-default（复用 MovingHandle/ConnectionLine/通用 UI）。反向不存在；
  theme-default 对 node-image/node-text 只有 **devDependencies 类型副作用**（plugin-theme-default/
  package.json devDependencies + index.ts:19-22 注释"纯类型副作用，运行时无 import"）。设计文档步骤 7
  （core-layers-and-registry.md:686-690）计划用独立场收编这批复用件；落地前本批件的对外导出形态
  （index.ts:671-673）不能变。
- **组件级**：BaseNode → {MovingHandle, BaseTitle, TitleLabel, cardFrame, titleEdit, multiRadio,
  useNodeCapability, useNodeCardSize, useNodeDebugOverlay}；MovingHandle → handleFollow；
  CustomEdge → {edgeGeometry, edgeFlow}；ConnectionLine → CustomEdge；DefaultBackground → 无。
  全部单向，无组件级环。

## 11. 未能确认的事项

1. `DEFAULT_THEME_HANDLE.portZoneWidth=10` 是否为期望终值（vs 宿主回落 86）：无迁移记录可查
   （d550a05 只改值没写理由），需产品/作者拍板；本文只如实记录差异。
2. `props.forceFlow`（CustomEdge）与 `props.hasSnap`（ConnectionLine）是否还有外部调用方传参：
   仓库内 rg 无生产调用；不排除外部装配（cloud-server 静态资产编译产物不算证据）。
3. `showHandleDebugOverlay`（BaseNode:553-555）是否为漏渲染的死代码：端口调试叠加由 MovingHandle
   自绘，本 computed 无模板引用；删除与否超出"重建契约"任务范围，仅记录。
4. ConnectionLine 是否曾消费 hasSnap 渲染吸附态视觉：现行代码无引用、v1 对照也无此视觉
   （v1 金标准 §6 描述的 hasSnap 用途为"吸附反馈"），无法从仓库确认历史视觉形态。
5. 640 行附近 BaseNode 模板的完整渲染顺序（本文按当前分支行号记录）：后续若步骤 3 插入新渲染位，
   行号会漂移；契约条目以语义描述为准。

---

*重建：2026-09-17，契约重建子代理。依据 = codex/registry-refactor 分支源码逐行精读；行号均为该分支现状。*
