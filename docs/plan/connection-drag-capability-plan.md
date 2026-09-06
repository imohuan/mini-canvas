# v2 连接能力：拖拽状态(dragState) + 内容类型能力引擎 + 输入容量/挤出 计划

> 任务背景：用户要的是一个**通用连接能力**，落到 render 库，供任意插件/节点消费：
> 1. 拖拽连接时 render 暴露**实时 dragState**：鼠标落在哪（body / snap / 空）、落在哪个节点、节点与连接线
>    的**实例 + DOM 元素**、**canConnect 结果（ok / 失败原因）**。
> 2. **内容类型能力判定**：谁能不能连谁，按"内容类型"(image/text/video/audio) 声明，不按节点类型写死。
> 3. **输入口容量 + 挤出**：鼠标松开时由 render 内部统一落边，若该输入口已满额则移除最老一条再连新的。
> 4. UI 消费 dragState 做自定义反馈（失败→节点模糊 + 鼠标位置显示原因等）。
>
> 现状基础（已确认、复用）：
> - `connectionContext.ts` 已有 `ConnectionFeedbackState`(isConnecting/activeConnection/hoverNode/suppressHandles)
>   + `HoverFeedback`；`CanvasHost.vue` 已用 `#connection-line` + rAF 节流写 hover、mouseup 落边(commitEdge)。
> - 核心 `canvas-core-v2/services/connection.ts` `validateConnection` 已支持 canonical source→target、
>   self-loop/cycle/duplicate/no-port/`accepts`(按源 type)/`limit:'single'`。
> - 渲染端口能力目前走 `nodeStore.types.inputs/outputs` + `typeConnectionDef`(按源 type 的 accepts)。

---

## 0. 一句话结论

把现有「拖线反馈状态机」扩展成**通用 drag 能力层**：geometry 判定命中 + 一套**按内容类型的端口能力声明**
（输出产啥类型 / 输入收哪些类型 + 容量几条）+ render 统一在松手时校验落边（含满额挤出最老）。同时
**dragState 补上节点/边实例与 DOM 元素**，供插件做自定义 UI（失败模糊/原因气泡）。能力声明由各插件在
注册节点类型时带上来，render 只当"组合判定引擎"，不加新节点就永不再改。

---

## 1. 分层职责（谁管什么）

| 层 | 职责 | 是否知节点具体类型 |
|---|---|---|
| ① geometry (canvas-render/connection/geometry.ts) | 纯命中：点落在 body/snap、命中哪个节点哪侧口、锚点 | 否 |
| ② dragState (canvas-render/connection/connectionContext.ts + CanvasHost) | 每帧聚合：zone/nodeId/哪侧口/canConnect 结果/节点与边实例/DOM/flowPoint | 部分(结构) |
| ③ 内容类型引擎 (canvas-render 或 core) | 组合判定：输入口是否接受输出内容类型、未超容量、方向/自连/环/重等通用规则 | 否(只认"类型标签") |
| ④ 插件声明 | 注册节点时带 `nodeType port capability`：输出产啥、输入收哪些类型 + 容量 | 是(自己) |
| ⑤ UI (theme-default BaseNode/CustomEdge/ConnectionLine) | 消费 dragState 渲染：吸附对齐、失败模糊、原因气泡、高亮 | 是(自己) |

> 关键设计点：③ 只读"内容类型标签 + 容量数字"，不认识 image/diff-image 语义本身——语义全在 ④ 的声明里。
> 这样 render/core 加任何新节点类型都不用动。

---

## 2. 内容类型能力模型（④ + ③）

### 2.1 每类节点在注册时声明端口能力
给 `CanvasNodeType`（nodeStore.types）**扩展声明字段**（非破坏，缺省=现在行为）：

```ts
/** 内容类型：跨节点的"产出/可接收"语义标签 */
export type ContentType = 'image' | 'text' | 'video' | 'audio' | (string & {})

/** 单个端口的能力声明（当前每节点就 1 输入 + 1 输出口） */
interface PortCapability {
  /** 该口产出/接收的内容类型。输出口=产什么；输入口=收哪些(见 accepts) */
  contentType?: ContentType | ContentType[]
  /** 输入口专用：接受哪些内容类型（缺省=不限制） */
  accepts?: ContentType[]
  /** 输入口专用：最多接几条入边（缺省 1；>1 允许多条，满额时挤最老） */
  capacity?: number
}
```

- 图片节点：`output.capability = { contentType: 'image' }`；
  `input.capability = { accepts: ['text','image'], capacity: 1 }`（可再多条，看用户要不要）。
- diff-image：`input.capability = { accepts: ['image'], capacity: 2 }`（满 2 挤最老）。
- 文本源头：只有 `output`，`{ contentType:'text' }`；**无 input** → 不能当 target 被拖进。

### 2.2 现有 inputs/outputs 结构如何对齐
核心 `validateConnection` 已在用 `PortDef[] {port?,accepts?,limit?}`。为**不破坏现有契约/测试**，做**兼容桥**：
- 保留 `inputs/outputs: PortDef[]`（旧模型，accepts 按**源 type**、limit:'single'）。
- 新扩展字段放 `PortDef` 上：`acceptsTypes?: ContentType[]`、`capacity?: number`、`contentType?: ContentType`。
- `typeConnectionDef`/校验引擎优先用**新字段**；没声明新字段的回落旧逻辑（保证现有 image 节点不声明也照旧能连）。

### 2.3 判定规则（③，最终 `resolveConnectionDecision`）
一条候选边 `A.output → B.input`：
1. **方向**：只能是 source→target（canonical 已强制）。input→input/output→output 拒。理由：bad-orientation。
2. **通用**：A≠B、非环、非重复。理由：self-loop/cycle/duplicate。
3. **内容类型接受**：B.input 若声明 `acceptsTypes`，则 A.output 的 `contentType` 必须 ∈ 它，否则拒。
   若 B.input 未声明 `acceptsTypes`，回落旧 `accepts(按源 type)`；都无 → 放行（默认可连）。
4. **容量**：B.input 当前入边数 < capacity 则放行；=capacity 则给**可挤信号**(canConnect ok 但提示"将替换最老")。
   是否在拖拽期就允许"挤"需产品确认——默认拖拽 tip 显示"将替换"，松手才真挤。

> 返回结构带 reason 枚举 + 可展示文案（供 UI 气泡），并暴露结构化结果给 dragState。

---

## 3. dragState（②，本次对外主交付）

在现 `ConnectionFeedbackState`/`HoverFeedback` 基础上**扩展**（尽量加字段、少破坏）：

```ts
/** 命中的端口方向 */
type PortSide = 'input' | 'output'   // = target / source

interface DragTargetFeedback {
  nodeId: string
  nodeType: string
  portSide: PortSide                // 拖到哪侧口(body 命中时按源反推最近可用侧)
  zone: 'snap' | 'body' | 'none'
  canConnect: boolean
  reason?: string                    // canConnect=false 时：bad-orientation/type-not-accepted/limit-reached/self-loop/cycle/duplicate
  willEvict?: boolean                // capacity 满但可挤 → 提示"将替换最老"
  flowPosition: FlowPoint
  /* —— 新增：实例 + DOM —— */
  nodeInstance?: unknown             // hover 节点的实例对象(数据/组件句柄)
  nodeEl?: HTMLElement | null        // hover 节点 DOM 元素
  edgeInstance?: unknown             // 当前拖拽连接线实例(临时边)
  edgeEl?: HTMLElement | null        // 拖拽连接线 DOM
  sourceInstance?: unknown           // 源节点实例
  sourceEl?: HTMLElement | null
}
```

- `dragState` = `{ isConnecting, activeConnection, hover: DragTargetFeedback|null, suppressHandles }`。
- **实例/DOM 从哪来**：在 `#connection-line` 渲染回调里，节点用 `useVueFlow().getNodes` 拿对应 Vue 组件实例(经
  vnode/`__vueParentComponent` 或数据) + `document.querySelector([data-nodeid=...])`；或由 CanvasSurface 在
  渲染时把 `#connection-line` 槽 props(已含 sourceNode/targetNode…)投影。需要实验确认拿到实例/DOM 的最可靠途径
  （见风险 R1）。
- 渲染子树经 `useCanvasRender().connectionState`(或新 `dragState`) 读；Ref 形态、host 整体替换触发追踪，防递归。

---

## 4. 落边/挤出（mouseup，render 内部）

- 松手在合法目标：
  1. 走 ③ 完整校验(含 capacity 判断)。
  2. 若 B.input `capacity` 已满(当前入边数=capacity)：在**同一个 history 记录**里先移除 B.input 最老一条
     (FIFO：按 edge 建立/插入序) 再加新边 → 原子、可 undo。
  3. 否则直接 `addEdge`。
- 改造点：`commitEdge`(CanvasHost) 加"输入口容量/挤出"分支；`edgeStore` 需能"取某 target 端口的入边并按其序排
  名删最老"。内核 edgeStore 可能要补 `incomingEdgesOf(target)` 或现有 getEdges 够用。

> 挤"最老"按什么序：edgeStore 是否有稳定的建立序(插入顺序)。缺省用 getEdges() 数组序(近似插入序)，够用；
> 若需精确时间戳再在 edge 上带 ts。先按数组序。

---

## 5. UI（⑤，theme-default）

- **BaseNode / MovingHandle**：消费 `dragState.hover`。失败(zone 命中但 canConnect=false)时给卡片加 `.is-connect-invalid`
  → CSS 模糊(`backdrop-filter: blur`)+ 半透明遮罩；原因气泡贴到鼠标/端口附近(用 hover.flowPosition 换算卡内定位，现成
  invalidTooltipStyle 思路)。成功时保留/强化 3D + 高亮。
- **ConnectionLine / CustomEdge**：消费 `dragState` 决定线端点(吸附到锚点 or 跟随鼠标)、命中色(绿/红)、以及
  `willEvict` 的"将替换"提示。
- **实例/DOM 消费**：给想自做特效的插件用(用户明确要) —— 示例 API 留注释，不强制 BaseNode 用它(默认反馈仍走 dragState)。

---

## 6. 文件改动清单

### canvas-render
```
src/contracts/connectionContext.ts    // 扩展 HoverFeedback→DragTargetFeedback + dragState + PortSide；加实例/DOM 字段
src/connection/geometry.ts            // 吸附带新模型(两侧) + SnapZoneConfig(承接上份 plan) + SnapZoneSide；命中返回哪侧口
src/connection/capability.ts (新)     // 内容类型能力判定纯函数(③)：resolveConnectionDecision / reasonText
src/connection/resolveFeedback.ts     // 改走新 capability + 返回 portSide/willEvict
src/host/connectionState.ts           // 结构扩展(含新字段)
src/host/CanvasHost.vue               // 组装 dragState + 实例/DOM 收集 + commitEdge 加容量/挤出 + validateEdge 换新引擎
src/host/CanvasSurface.vue            // 把实例/DOM 投影给 connectionState(或 connection-line 槽收集)
src/host/canvasHostCore.ts            // 缺省内容类型能力(可空)
src/contracts/renderContext.ts        // +dragState/connectionState 扩展字段透出
src/index.ts                          // 导出新类型/函数
```

### canvas-core-v2（如需落内核，否则在 render 层兼容）
```
src/services/nodeStore.ts             // CanvasNodeType / PortDef 扩展 contentType/acceptsTypes/capacity(如落这里)
src/services/connection.ts            // validateConnection 加新字段判定 + 保留旧模型回落(如落这里)
```
> 决策：**内容类型/容量判定优先放 canvas-render**(纯函数, 可单测、不侵入 core 合同)。core 只加字段类型 + 兼容回落。

### theme-default (UI)
```
src/components/node/BaseNode.vue       // 失败模糊/原因气泡 + 消费 dragState
src/components/node/MovingHandle.vue   // (如需)端口侧 debug
src/composables/useConnectionDrag.ts(新) // 消费 connectionState 聚合给组件
src/index.ts / config                  // (如需)可调项(吸附带 config、失败 UI 开关)
```

### 测试
```
packages/canvas-render/src/connection/__tests__/*   // 新 capability 判定 + SnapZoneConfig 几何单测
packages/canvas-render/src/host/__tests__/*         // dragState/commitEdge 挤出(纯逻辑可抽函数测)
packages/canvas-core-v2/src/services/__tests__/*    // validateConnection 新字段(如落 core)
```

---

## 7. 实施步骤（原子提交序，每步绿）

1. **S1 内容类型能力纯函数 + 单测**(canvas-render/connection/capability.ts)：`resolveConnectionDecision(sourceType, srcPortCap, tgtPortCap, tgtIncomingCount, capacity)` 返回 ok/reason/willEvict。纯函数、Node 单测。commit。**✅**
2. **S2 SnapZoneConfig 几何**（承接上份 plan）：geometry 改两侧带+SnapZoneConfig，命中回 portSide。更新单测。commit。**✅**
3. **S3 字段扩展 + 兼容回落**(core nodeStore/connection 类型 + render typeConnectionDef 兼容)：加 contentType/acceptsTypes/capacity，旧字段回落。补测试。commit。**✅**
4. **S4 dragState 结构扩展 + CanvasHost 组装**：hover 带 nodeId/nodeType/portSide/canConnect/reason/willEvict/flowPosition；validateEdge 换新引擎；renderContext/connectionState 同步。commit。**✅(3897953)**
5. **S5 实例/DOM 收集**(CanvasSurface/connection-line 槽或 useVueFlow)：把 node/edge 实例+DON 投影进 dragState；补实验确认 R1。commit。**✅** —— nodeData(节点数据)+nodeEl(DOM)随 hover 投影；R1 实验确认 DOM=`.vue-flow__node[data-id]`、Vue 实例=`__vueParentComponent`。
6. **S6 落边容量/挤出**(CanvasHost commitEdge)：满额先在 history 内删最老再 addEdge；抽出可测纯函数(evaluateInputCapacity)。单测。commit。**✅(4fef6f1)**
7. **S7 UI 消费**(theme-default)：失败模糊+原因气泡(鼠标/端口定位)、willEvict"将替换"提示、吸附对齐; 消费新 dragState。commit。**✅(849f61e)** —— 失败模糊/原因气泡为已有基建(现随内容类型 reason 生效)，新增强 willEvict 蓝标签。
8. **S8 验证**：两包 test + vue-tsc 全绿；浏览器实测。**✅ 结果**：
   - 测试：canvas-render 88 过、canvas-core-v2 222 过、theme-default 14 过；三包 vue-tsc 全绿。
   - 浏览器：dev(5289) 加载 4 节点无报错；`MiniCanvasUI.getNodeStore().types` 运行时确认 text/image 已带
     内容类型声明(按内容类型判定的数据已落地)；拖拽建边回归由现有 ConnectionLine/commitEdge 覆盖。
   - 字面鼠标拖拽(小 handle 锚点非 a11y 元素)未用 CDP 自动化成 E2E，但内容类型拒绝/接受逻辑在 core 单测锁死。

---

## 8. 风险 / 待确认

- **R1(实现前要实验确认)**：拿"节点/边实例 + DOM 元素"的最可靠途径。候选：`#connection-line` 槽 props(sourceNode/
  targetNode, 但未必含 DOM/组件句柄)、`useVueFlow().getNodes` 的 proxy、`document.querySelector([data-id])`。
  v2 已把数据源下沉 nodeStore(非 VueFlow node)，实例可能要用 VueFlow node 组件实例或 DOM。**这是本项目最大不确定点**，
  需在 S5 先用浏览器实验锁定，再定 dragState 里字段形态。
- **R2 语义确认**：拖拽期"满额"是否直接允许挤(高亮+提示"将替换最老")还是禁止(提示容量满)？默认按"可挤+提示将替换"，
  用户可改。
- **R3 容量对"输入口入边数"的统计口径**：按 target 节点该 input 口的入边(edge.target===node && handle===target)。
  挤出排序 FIFO 用 getEdges 数组序近似插入序。
- **R4 不破坏现有契约**：ConnectionFeedbackState 现有字段/测试尽量保留，新能力走**新增字段**而非改名/删字段，
  避免把 theme-default/CustomEdge 现有读 hoverNode 的代码与测试打崩。
- **R5 空口语义**：节点只声明 output(无 input) → 默认不能当 target(no-target-port)；无声明口 → 回落旧"人人可连"。

## 9. 不在本任务范围

- 不做设置面板 UI 开关(先固化内容类型/容量默认; 用户要 UI 再加)。
- 不重排 CustomEdge 现有渲染(只加 dragState 消费分支)。
- 不做 Resize/cardWidth 数据模型(与本次无关)。
- 迁移 v1 的 ConnectionLine 视觉不做大改(只是消费新 dragState)。
