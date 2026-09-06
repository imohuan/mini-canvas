# canvas-render 开发手册 · interactionState 画布交互状态契约

> 来源：`packages/canvas-render/src/contracts/interactionContext.ts`（契约 + 工厂 + 手势驱动辅助）、
> `host/CanvasHost.vue`（建状态 + 事件接线）、`host/CanvasSurface.vue`（塞进渲染上下文）、
> 消费方 `plugin-theme-default/src/components/node/BaseNode.vue` 与 `MovingHandle.vue`、
> 单测 `contracts/__tests__/interactionContext.test.ts`。

## 一句话

把"画布此刻在干什么"建成**可读、可订阅、可扩展**的共享响应式状态：拖节点 / pan / 缩放 / 拖边 / 框选
各自是一面"活动旗子"（可叠加），另附指向对象（节点 id / 边 id）与派生便捷读（`isBusyDragging` 等）。
theme / 插件读它决定显隐与行为——最典型的用途：**拖拽 / 拖线期间不冒端口加号按钮**。

与 `connectionState`（拖线 hover/合法目标/压端口那套连线专用反馈）是姊妹层：
`connectionState` 只管"拖线连到哪、合不合法"，本状态只管"有哪些手势在进行"。压端口显隐时两者一起读。

---

## 为什么需要它

- 节点拖拽此前只有 `nodeDragStop`（落盘用），**拖拽过程本身没有状态**——拖动中掠过别的节点，
  那个节点 hover 仍亮、端口照常冒出来。
- 画布 pan / 缩放 / edge 拖拽 / 框选都没暴露；全部在 CanvasHost 内部消化成"落盘 / 建边 / 选中"。
- VueFlow 1.48 其实已经提供全部原始事件，缺的是把它们**收敛成一层可订阅的状态**。

设计取向（需求方共识）：**不是单一 enum 开关**，而是多属性组合——手势可叠加（拖节点同时 hover 目标、
拖线同时掠过另一节点……），每面旗子附各自对象句柄。坐标一律 flow（画布）坐标。

---

## 状态形状

```ts
interface InteractionActivity {
  nodeDragging: boolean        // 正在拖动某节点
  nodeDragId: string | null    // 被拖节点 id（多选拖动时是代表节点）
  paneDragging: boolean        // 画布视图在动（pan 或 wheel/pinch 缩放——A 决策不拆位）
  zooming: boolean             // 正在缩放（保留位；A 决策下暂不驱动）
  edgeDragging: boolean        // 正在重连边（当前交互未启用，占位未来）
  edgeDragId: string | null
  selecting: boolean           // 正在框选 / 多选（占位未来）
}

interface CanvasInteractionState {
  activity: Ref<InteractionActivity>          // 活动位本体（响应式）
  isNodeDragging: ComputedRef<boolean>        // 派生便捷读
  isPanning: ComputedRef<boolean>
  isZooming: ComputedRef<boolean>
  isEdgeDragging: ComputedRef<boolean>
  isSelecting: ComputedRef<boolean>
  isBusyDragging: ComputedRef<boolean>        // 任一"物理拖拽"在动：node/pan/edge/selecting（不含 zooming）
  isBusy: ComputedRef<boolean>                // 任何活动在动（含 zooming，比 isBusyDragging 更宽）
}
```

### 派生位语义（消费方认准这些，别自己拼旗子）

| 派生位 | 含义 | 典型用途 |
|---|---|---|
| `isBusyDragging` | 有物理拖拽手势在动（node/pan/edge/selecting） | **"交互进行中"的显隐门**：拖拽期间不冒端口加号 |
| `isBusy` | 任何活动在动（含缩放） | 需要连缩放也算"忙"的场合（如禁快捷操作） |
| `isPanning` | 视图在平移 / 缩放 | 画布视角类 UI |
| `isNodeDragging` | 有节点被拖动 | 节点专属行为 |

`zooming` **不计入** `isBusyDragging`——它是为将来"想区分缩放手势"预留的位，当前统一归 `paneDragging`。

### 工厂与写入函数

```ts
createInteractionState(): CanvasInteractionState   // 建一份（ref + 派生 computed）
updateActivity(state, patch): void                 // 局部分片写，保留其它位
clearActivity(state): void                         // 全清（新引用，下游能感知）
emptyActivity(): InteractionActivity               // 一份"全 false + id 空"的基线
```

**手势驱动辅助**（CanvasHost 事件回调的薄封装，语义可单测；新增手势照这个加）：

```ts
beginNodeDrag(state, nodeId)   // nodeDragStart → 亮 nodeDragging + 记 id
endNodeDrag(state)             // nodeDragStop → 灭 nodeDragging + 清 id
beginViewportMove(state)       // moveStart → 亮 paneDragging
endViewportMove(state)         // moveEnd → 灭 paneDragging
```

> 为什么做成成对 begin/end 而不是一个"开关"？保证 start/end 对称、可叠加、不误清别的位——
> 例如 pan 进行中又开始拖节点，`endNodeDrag` 不会把 `paneDragging` 一起灭掉。

---

## 事件接线（CanvasHost / CanvasSurface）

CanvasHost 持有状态实例，把 VueFlow 事件转成上面这些驱动调用；CanvasSurface 只负责转发与 provide。

```ts
// CanvasHost.vue
const interaction = createInteractionState()               // 建一份，随 CanvasSurface 塞进渲染上下文

function onNodeDragStart(e: NodeDragEvent) { beginNodeDrag(interaction, e.node.id) }
function onNodeDragStop(e: NodeDragEvent)  { endNodeDrag(interaction) }  // 原落盘逻辑照旧
function onMoveStart() { beginViewportMove(interaction) }
function onMoveEnd()   { endViewportMove(interaction) }
```

CanvasSurface props 增加 `interaction`（状态引用）与 `onNodeDragStart / onNodeDragStop / onMoveStart / onMoveEnd`
四个回调，模板绑定：

```html
<VueFlow
  @node-drag-start="onNodeDragStart"
  @node-drag-stop="onNodeDragStop"
  @move-start="onMoveStart"
  @move-end="onMoveEnd"
  ...
/>
```

并把 `interaction` 放进 `renderCtx`（`CanvasRenderContext.interaction`），theme / 插件经
`useCanvasRender().interaction` 拿到。

### 关于 pan 与缩放的 A 决策

VueFlow 里滚轮缩放、鼠标 pan、捏合缩放都走 **d3-zoom 同一套** `moveStart / move / moveEnd` 事件，
没有独立 emit 区分。若强行拆 `paneDragging` / `zooming` 两面旗子，还需处理"start 判成 pan、end 判成 zoom"
的清位错配问题。因此 A 决策：**不拆位**——视图在动统一亮 `paneDragging`（计入 `isBusyDragging`，
端口被压）。代价是滚轮缩放时端口也被压，缩放结束恢复；若将来想"缩放时仍可 hover 看端口"，再把 wheel
单独拆回 `zooming` 位（`event.sourceEvent?.type === 'wheel'` 可判）。

### 只接 start/end，不接 move 的原因

move 事件高频触发，状态只需要"在动 / 不在动"两态——start 亮、end 灭即可，逐帧 move 只会做无用写。
（VueFlow 内部对 move 已有自己的节流；若将来要逐帧坐标，也应在 handler 内做 rAF 合并，见 08 文档 coalesce。）

---

## theme 消费：拖拽 / 拖线期间不冒端口加号（本次要解决的可见需求）

### BaseNode：显隐门加"交互进行中"

`shouldShowHandles` 决定两个 MovingHandle 的 `visible`：

```ts
// plugin-theme-default BaseNode.vue
// 端口"允许显示"门（传给 MovingHandle 作上层压制）——真正的显隐在 MovingHandle 内部
const shouldShowHandles = computed(
  () =>
    !lowDetail.value &&
    !suppressHandles.value &&          // 拖线期间的全局压端口（connectionState）
    !isCurrentConnectingNode.value &&  // 拖线源自身
    !interaction.isBusyDragging.value && // 拖节点 / pan 期间的压制
    (isHovered.value || props.selected), // 卡片 hover 或选中时把"允许"抬到 true
)
```

```html
<!-- 端口按钮最终显隐规则：见下方 MovingHandle isShown -->
<MovingHandle ... :visible="shouldShowHandles" :selected="props.selected" ... />
```

### MovingHandle：`isShown` 必须分层（重要，别退回 OR 写法）

端口按钮最终显隐在 MovingHandle 内部，`visible` 只是"上层允许"。**不要把本地黏性态 `keepVisible`
与 `visible` 做成 OR**——否则拖线/拖节点时鼠标掠过端口 zone 触发 mouseenter 把 `keepVisible` 推 true，
按钮会"借 `keepVisible` 突破 `visible`"继续显示，并跟着鼠标飘到画面中央（曾真实出现的 bug）。

```ts
// MovingHandle.vue —— 分层 + 只亮"靠近的那个端口"
const isShown = computed(() => {
  if (props.disabled || !props.visible) return false   // 硬压制：拖线源 disabled / 上层压 visible → 永远藏
  return Boolean(props.selected) || keepVisible.value  // 软可见：节点选中(常显) 或 本端口 zone hover(+180ms 淡出)
})
```

关键语义：**不喂整卡 hover 给端口**。每个 MovingHandle 只看自己的 `keepVisible`（自己 zone 的
mouseenter）——鼠标靠近哪个 zone，就只亮哪个端口；两个端口不会因卡片整体 hover 而同亮。
`selected` 是节点选中态（BaseNode `props.selected`），选中时端口常显。

各场景对照：

| 场景 | visible | selected | keepVisible | 按钮 |
|---|---|---|---|---|
| 鼠标停卡片 body（未进任何 zone） | true | false | false | 不显示（只亮靠近的） |
| 鼠标进 target zone | true | false | true | 只 target 显示 |
| 鼠标进 source zone | true | false | true | 只 source 显示 |
| 节点选中（鼠标不在附近） | true | true | false | 两端口常显 |
| 拖线/拖节点中鼠标掠过 zone | false | — | true | **隐藏**（`visible` 硬压制） |
| 拖线源自身 | false（disabled=true） | — | — | 隐藏 |
| 离开 zone 后 180ms 内 | true | false | true→false | 显示→淡出 |

### 状态机内部提醒

- `keepVisible` 只作"进 zone 后短暂保持可见"的本地黏性，**不应凌驾于 `visible` 之上**。
- 新增手势（如未来 edge 拖拽 / 框选）要压端口时，同样走"把 `shouldShowHandles` 对应位压掉"的路径，
  不需要在 MovingHandle 里再加旁路。

---

## 测试

`contracts/__tests__/interactionContext.test.ts`（7 例）：

- 初始态：全 false + id 空，派生位均 false
- 局部分片写：开 nodeDragging 只动该位 + id，其它位保留
- 派生语义：纯 zoom 不计 `isBusyDragging`，但计 `isBusy`
- 叠加：node + pan 同时为真不互斥
- clearActivity：回到空态且换新引用（下游能感知）
- beginNodeDrag/endNodeDrag：往返对称；pan 进行中结束拖节点不误清 pan
- beginViewportMove/endViewportMove：驱动 paneDragging 往返对称

> 验证命令（.vue 必须走 vue-tsc，纯 `tsc --noEmit` 查不到 .vue 会假绿）：
> ```bash
> cd packages/canvas-render && node ./node_modules/vitest/vitest.mjs run
> cd packages/plugins/plugin-theme-default && node ../../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.json
> ```

---

## 坑

1. **`visible` 与 `keepVisible` 别用 OR**：本地黏性态不能突破上层压制；要用"硬压制 && 软可见"分层。
2. **别在 move 事件里逐帧写状态**：只 start/end 置位/清位即可，否则高频写 ref 白耗。
3. **`tsc --noEmit` 不查 .vue**：CanvasHost / CanvasSurface / BaseNode 的模板内 TS 必须用 vue-tsc 验证，
   否则字段缺失这类错会"假绿"漏过。
4. **别把 pan 和 zoom 拆成两个位接**：move 事件不区分来源，强行拆会有清位错配；A 决策统一归
   `paneDragging`，`zooming` 留给将来真要细分时再用。
5. **节点拖动不触发 move**：VueFlow 节点拖动走 nodeHooks，pan/缩放才走 d3-zoom——两者互不污染，
   可放心让 `nodeDragging` 与 `paneDragging` 独立存在（多选拖动会同时 emit nodeDrag* 事件，也覆盖到）。
