# 画布默认皮视觉完善 —— canvas-render 能力层 + plugin-theme-default UI 层

> 定调（用户确认）：**canvas-render 提供能力（拖线连接反馈状态机），plugin-theme-default 做 UI 渲染**。
> 本文档把两份任务合成一份双包方案。三份调研底稿在 `docs/tmp/theme-refactor/`（不删）。

## 0. 现状与目标（说人话）

**问题**：theme-default 的 BaseNode 视觉明显落后于 v1 canvas-core Decoration（用户心中金标准）——
卡片内容自适应无固定尺寸/resize、无 BaseTitle、端口不分节点类型能力、配色硬编码；最重的是**拖线三特效
（3D 倾斜 / 非法气泡 / 吸附带）完全没有**，因为它们依赖"拖线过程逐帧状态"而 canvas-render 没提供。

**定调架构**：canvas-render（能力层）接出"拖线连接反馈状态机"，把每一帧"鼠标在哪、悬停到哪个节点、
连不连得上(valid/invalid+reason)"投影成响应式 `connectionState`；theme-default（UI 层）消费它渲染
3D 倾斜/非法气泡/吸附带。MovingHandle/CustomEdge 已是 v1 等价，仅归类+配色变量化。

**目标**：theme-default 默认皮在**不依赖 v1 pinia store** 前提下，视觉/交互对齐 v1 Decoration 可用部分；
canvas-render 新增一块可复用的连接反馈能力。

## 1. 关键契约事实（已核实，带行号，详见三份 research doc）

- @vue-flow/core **1.48.2 没有 `@connect-stop`**（emits 只有 connect/connectStart/connectEnd + click 系）。
- `#connection-line` 槽 props 的 `targetX/Y` 就是**每帧鼠标 flow 坐标**，是算 hover 的首选来源；`ConnectionLineProps`
  无 v1 的 sourceHandleId/fromHandle 等字段，逆连以 `activeConnection.sourceHandle` 为准。
- `connectionMode` 默认 Loose；非法反馈必须能力层自算（VueFlow 不给 reason）。
- CanvasHost.isValidConnection（236-245）**丢了 reason**——非法反馈断链根因。
- themeRegistry 已预留 `connectionLine` 槽（第 29 行）但 assembleTheme（canvasHostCore 67-83）没读、CanvasSurface
  没渲染、theme-default 没注册。
- CanvasParams 只有 5 端口尺寸，**缺 v1 3 个 snap 比例**（outer .75 / inner .6 / height 1.35）。
- **在 connection-line 渲染里写 reactive 必须 rAF 节流 + hoverChanged 比对**，否则 Maximum recursive updates。
- 测试影响：仅 `canvasHostCore.test.ts`（assembleTheme 加 connectionLine 字段补 case）；fullchain 等不经 VueFlow 不受影响。

## 2. 交付文件总览

### canvas-render（能力层）
```
src/contracts/connectionContext.ts   // 新：ConnectionFeedbackState/HoverFeedback/ActiveConnection/FlowPoint + KEY
src/connection/geometry.ts           // 新：纯算法 zone/hitTest/节点 flow rect（Node 可测）
src/connection/reasonText.ts         // 新：InvalidReason 枚举 → 中文文案（纯）
src/connection/resolveFeedback.ts    // 新：每帧决策（snap/body 命中 + validateConnection）返回 end+hover（纯）
src/connection/connectionLineEngine.ts // 新：rAF 节流写 state 的副作用封装（给 CanvasHost/Surface 用）
src/host/canvasHostCore.ts           // 改：ThemeAssembly/assembleTheme 加 connectionLine
src/host/CanvasHost.vue              // 改：维护 reactive connectionState + onConnectStart/End + applyTheme 读 connectionLine
src/host/CanvasSurface.vue           // 改：绑 @connect-start/@connect-end + #connection-line 槽渲染 winner/默认 + 每帧 resolveFeedback
src/contracts/renderContext.ts       // 改：CanvasRenderContext 加 connectionState 字段
src/vueFlowBridge.ts                 // 改：补 ConnectionLineProps/OnConnectStartParams/ConnectionMode/ConnectionStatus/ValidConnectionFunc 具名类型
src/connection/__tests__/geometry.test.ts   // 新：zone/hitTest 单测
```

### plugin-theme-default（UI 层）
```
src/index.ts                    // 改：注册 connectionLine 默认皮；import node-theme.css
src/styles/node-theme.css       // 新：照搬 v1 :root --canvas-node-* 37 变量
src/components/node/BaseNode.vue    // 重构：消费 connectionState 做 3D/气泡/吸附带；固定卡+resize；端口按类型能力
src/components/node/BaseTitle.vue   // 新：照搬 v1
src/components/node/MovingHandle.vue // 移入 node/ + CSS 改回变量
src/components/edge/CustomEdge.vue  // 移入 edge/（不大改）
src/components/edge/edgeGeometry.ts // 移入 edge/
src/components/edge/ConnectionLine.vue // 新：默认拖线临时线（吃 ConnectionFeedbackState，画吸附线/流光/非法态）——注册进 connectionLine 槽
src/components/background/DefaultBackground.vue // 移入 background/
src/components/settings/...        // 从 src/components 平铺归位
src/composables/useNodeCapability.ts // 新：types.inputs/outputs → hasTarget/hasSource
src/composables/useNodeCardSize.ts   // 新：cardWidth/Height + resize 状态
src/__tests__/edgeGeometry.test.ts   // 随 edgeGeometry 移位
```

## 3. 能力层契约（connectionState）

坐标一律 **flow**；reason 透传走纯模块。

```ts
interface FlowPoint { x: number; y: number }

interface HoverFeedback {
  nodeId: string
  status: 'valid' | 'invalid'
  zone: 'snap' | 'body'
  flowPosition: FlowPoint
  reason?: string            // invalid 文案（reasonText 结果）
}
interface ActiveConnection { sourceNodeId: string; sourceHandle: 'source' | 'target' }
interface ConnectionFeedbackState {
  isConnecting: boolean
  activeConnection: ActiveConnection | null
  hoverNode: HoverFeedback | null
  suppressHandles: boolean
}
```
挂到 `CanvasRenderContext`（尾部字段 `connectionState`），CanvasSurface 组装 renderCtx + provide 同引用，
`useCanvasRender()` 自动返回；BaseNode 加 `const { connectionState } = useCanvasRender()` 即可消费（现有 BaseNode.vue:20 同模式）。

## 4. 纯几何（connection/geometry.ts，flow 坐标）

照 v1 抽纯版：
- `getNodeFlowRect(position, size)` → `{x,y,w,h}`；
- `computeSnapZones(nodes, {isReverse, handleRadius, snapOuterRatio=.75, snapInnerRatio=.6, snapHeightRatio=1.35})`：
  anchor 在 target 左缘/source 右缘中点，zone=`{id,x:anchor-outer,y:centerY-h/2,width:outer+inner,height,anchorX,anchorY}`；
- `computeBodyZones(nodes)` → 整卡 rect；
- `hitTest(zones, flowPoint)`；
- `reasonText(reason: InvalidReason)`（映射 type-not-accepted/duplicate/cycle/self-loop/bad-orientation/…→中文）；
- `resolveFeedback({sourceId, sourceHandle, nodes, flowPoint, validate, ratios})` → `{end:FlowPoint, hover:HoverFeedback|null}`
  （snap 命中合法→吸附端点；非法→invalid+reason；body→invalid 或悬空）。

## 5. 实施步骤（提交序列）

### Canvas-render 能力层（先做，基座）
1. `vueFlowBridge.ts` 补具名类型导出。commit。
2. `contracts/connectionContext.ts`（§3 类型 + KEY）。commit。
3. `connection/geometry.ts` + `reasonText.ts` + `resolveFeedback.ts` + vitest 单测。commit。
4. `canvasHostCore.ts` ThemeAssembly/assembleTheme 加 `connectionLine` + canvasHostCore.test 补 case。commit。
5. `connection/connectionLineEngine.ts`（rAF 节流写 state）。commit。
6. `renderContext.ts` 加字段；`CanvasHost.vue` 维护 reactive state + onConnectStart/onConnectEnd + applyTheme 读 connectionLine +
   现有 onConnect 加 finally 清空；`CanvasSurface.vue` 绑事件 + `#connection-line` 槽渲染 winner/默认 + 每帧 resolveFeedback。
   跑 canvas-render typecheck + test 全绿。commit。

### plugin-theme-default UI 层
7. 目录重构：建 components/{node,edge,background,settings}/、styles/、composables/，把现有文件归位（import 相对路径改好）；
   `edgeGeometry.test.ts` 随迁。commit（此步保持功能不变，先绿）。
8. `styles/node-theme.css`（照 v1）+ index.ts 顶部 import；MovingHandle/CustomEdge CSS 改回变量。commit。
9. `composables/useNodeCapability.ts` + `useNodeCardSize.ts`（resize）。commit。
10. BaseTitle 照搬。commit。
11. BaseNode 重构：消费 connectionState 做 3D/气泡/吸附带 + suppressHandles；固定卡 + content 裁剪层 + resize；
    端口用 useNodeCapability 决定显隐；CSS 全变量化；保留段组件装配 + 就地改名。commit。
12. `components/edge/ConnectionLine.vue`（默认拖线临时线）+ index.ts 注册 connectionLine 皮。
    吃 handleParams/edgeVisual/connectionState，画吸附线/流光/非法态。commit。
13. 全量验证：两包 typecheck + test 全绿 + `pnpm dev` 目验拖线三特效、resize、端口显隐、改名、背景、设置面板。

## 6. 测试与验证
- 能力层纯模块 Node 单测（zone/hitTest/resolveFeedback/reasonText）。
- canvasHostCore.test 补 connectionLine 装配 case。
- 现有 edgeGeometry 14 例保持绿（随迁不改）。Do-not-change-tests（新增可加，不删改现有）。
- 命令：canvas-render 与 plugin-theme-default 各 `pnpm typecheck` / `pnpm test`；plugin `pnpm dev` 目验。

## 7. 风险与注意
- 只在 connection-line 渲染里 rAF 节流写 reactive（防 Maximum recursive updates）。
- 1.48.2 无 connect-stop；清空放 connect-end/connect/onBeforeUnmount；留意 click 系点选连接（clickConnectStart/End）
  默认 connectOnClick=true，需连 @connect-end 一并清或实测覆盖。
- ConnectionLineProps 无 sourceHandleId 等字段，逆连用 activeConnection.sourceHandle。
- resize 尺寸字段沿用 `data.cardWidth/cardHeight/resizable`（v1 同名便于存量迁移），初值回落 nodeStore.types.defaultSize。
- 卡片从"内容撑开"改"固定尺寸"可能影响 node-text/image content 布局——dev 目验，必要时壳内调整 padding/content 适配。
- MovingHandle 端口锚点 absolute 于卡侧边，固定尺寸下确认垂直居中。

---
## 8. 执行完成记录（2026-09-06）

**全部 Phase（能力层 + UI 层）已实现，12 个原子 commit（见 git log）。**
- canvas-render 能力层：vueFlowBridge 类型/useConnection 导出 → connectionContext 契约 → connection/ 纯几何+决策+文案
  (15 单测) → assembleTheme 读 connectionLine → connectionState 工厂(4 单测) → renderContext + CanvasHost/Surface 接线
  + ConnectionLineHost(#connection-line 每帧 resolveFeedback + rAF 写 hoverNode) → isValidConnection reason 不再丢。
- plugin-theme-default UI 层：目录分层(node/edge/background/settings + composables + styles) → node-theme.css 主题变量
  → MovingHandle 变量化 → BaseTitle → composables(useNodeCapability/useNodeCardSize) → BaseNode 重构
  (固定卡+resize+端口按类型能力+连接反馈 3D倾斜/非法气泡/压源口) → ConnectionLine(默认拖线线) 注册 connectionLine 槽。

**验证**：canvas-render 68 测试绿 + vue-tsc 0 错；plugin 14 测试绿 + vue-tsc 0 错；plugin `pnpm build` 32 模块成功。
**未验证**：拖线反馈的**运行时**行为（#connection-line 插槽每帧触发 + rAF 写 hoverNode）需浏览器目验，
  纯几何已单测、reactive 接线仅类型/编译通过。下一步应起 `pnpm dev` 目验：拖线 3D 倾斜/非法气泡/吸附线/resize/端口显隐。

---
## 9. 运行时诊断补记（2026-09-06，chrome-devtools 实测 packages/ui @ 5289）

起 ui dev server + 浏览器工具实测，暴露并修复两处**运行时功能 bug**（源码/类型/单测都绿但实机坏）：

### A. 拖线连不上 → 已修（commit 81b3c82，canvas-render/CanvasHost）
- 症状：拖线 connect 后连线不出现（要刷新才见）；任意 resync（加节点/拖节点）已连的边全部消失。
- 根因：VueFlow 每次 setEdges 全量重喂都走 `isValidConnection` 再校验一遍**已存在边**，
  CanvasHost checkConnection 按"重复"驳回（EDGE_INVALID 警告），把已落盘的边丢掉。
  首次 boot 因校验未激活侥幸存活，后续每次 resync 全灭。
- 修法：checkConnection 幂等——连接已真实存在于内核 edgeStore(=已提交历史边)则放行；
  真正的新候选仍走完整重复/环校验。内核天然按端点去重，不影响唯一性。
- 验证：拖线 connect 后边即时渲染成 CustomEdge（Bézier path 在 DOM）；加节点 resync 边存活；
  环(2→1 当 1→2 存在)仍判非法。68 测试绿。
- 注意：副作用=已存在的连接再拖会显示 valid（内核去重 no-op），可接受。

### B. resize 拖柄恒显示且无效 → 已修（commit cd6332d，theme-default/BaseNode+useNodeCardSize）
- 症状：无 data.resizable 的节点也出拖柄；有 resizable 拖拽也不改尺寸；is-resizing 卡死。
- 根因①（模板恒真）：`v-if="card.resizable"` 引的是 useNodeCardSize 返回对象里的**嵌套 ref**，
  模板只解包顶层 ref，嵌套 ref 对象恒真 → 拖柄无条件出 + is-resizing 卡死。
  修：顶层解包 `cardResizable/cardIsResizing` 再进模板。
- 根因②（数据过期）：useNodeCardSize 收 data **对象快照**，VueFlow 重渲染换新 props.data → 读到过期引用，
  resizable/尺寸永不更新。修：改收惰性 getter `() => props.data`，内部 computed 依赖 props.data 响应式。
- 验证：无 resizable 节点不再出拖柄；设 resizable:true 后拖柄出现，拖拽实时 300x200→400x260 并写回 data.cardWidth/Height。14 测试绿。

### 诊断手段备忘
- @vue-flow/core Handle 用 `onMousedown`（非 pointerdown）启连；拖线中监 doc `mousemove/mouseup`。
- VueFlow `createGraphEdges` 对 setEdges 每个边跑 isValidConnection → EDGE_INVALID("An edge needs a source and a target" 易误导)。
- 合成 pointer/mouse 事件可驱动；`drag` 工具不给真实 mousemove/mouseup，用 document 派发 mousemove/up 补。
- dev server 久跑后 HMR/模块可能陈旧 → 重启 vite + 新 isolatedContext 页面测最干净。
- 模板 ref 解包坑：setup 顶层 ref 自动解包，**返回对象内嵌套 ref 不解包**。

### C. 拖线临时线终点与 hover 判定不一致 → 已修（commit d0d8d08，canvas-render/connection/resolveFeedback）
- 症状（用户实测截图）：从右侧 image 卡片上方拖线，3D 倾斜动效正常（hover 判 valid），
  但临时连接线终点没落在 image 的 target handle（左边缘）上、落点偏右，线与 3D 不一致。
- 根因：ConnectionLineHost 的 `end = feedback?.end ?? 鼠标`，而 resolveFeedback **只在命中"端口吸附带"
  （snappedToId!=null）时才把 end 对齐锚点**；鼠标落在卡片 body（非吸附带内、但合法 → 触发 3D）时，
  end 跟随鼠标原位置 → 线终点停在偏远处，看起来没对准。
- 修法：resolveFeedback 第 2 步——body 合法命中且未吸附时，end 也吸到该节点对应端口锚点
  （forward=target 左缘 / reverse=source 右缘）；非法 body 仍跟随鼠标。
- 验证：connection 单测 18 绿（新增/改写 case：合法 body → end 对齐左缘锚点；非法 body → 不吸）。
- 边界说明：真实落点是否建边仍取决于 VueFlow 的 handle 吸附（connectionRadius 20px），
  本修复只让"拖线中的视觉终点"与"hover 判定的目标端口"一致，不做 body 落点即建边（那是另一层语义）。

### D. 默认外观对齐目标金标准 → 已修（commit d6ddfe0，theme-default/index + node-theme.css）
- 目标（用户给出的 目标.png）：连线细、深灰近黑 (#1f2937)、贝塞尔带轻微虚线、无箭头无辉光；
  节点卡纯白+1px 极浅灰边+极小圆角/投影；标题在卡片上方 top-left 外。
- 改：
  - `DEFAULT_THEME_EDGE`：`edgeColor #3b82f6→#1f2937` / `edgeLineWidth 2→1.5` / `edgeDashed true` / `edgeAnimated false` /
    `edgeGlowEnabled false` / `edgeGlowColor #1f2937`（跟随线色）。仍是 bezier，无箭头（与目标一致）。
  - `--canvas-node-border`：`rgb(209 213 219 / 0.95) → #e5e7eb`（让卡片边框更浅贴近目标）。
- 不动：
  - engine `DEFAULT_EDGE_VISUAL`（金标准合同，canvasHostCore 测试断言保持绿：`#3b82f6` 等）。
  - `ConnectionLine`（拖线临时线仍按 hover 合法性着色带流光箭头，按既有视觉方案——目标图无拖线态）。
  - 卡片阴影保持 `0 1px 3px rgba(0,0,0,0.06)`（贴近目标微投影）。
- 验证：实机 DOM 探查（chrome-devtools）——
  - `.v2-card` 背景 `rgb(249,250,251)`、边框 `rgb(229,231,235)`、阴影 `0 1px 3px rgba(0,0,0,0.06)`。
  - `.custom-edge .ef-base` 颜色 `rgb(31,41,55)`、宽度 `1.5px`、dasharray `6px 3px`、animation `none`。
  - `--canvas-node-border: #e5e7eb`。
- 测试：canvas-render 71 绿；plugin-theme-default 14 绿；plugin-theme-default vue-tsc 0 错。
