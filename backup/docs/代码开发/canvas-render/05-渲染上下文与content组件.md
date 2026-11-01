# canvas-render 开发手册 · 渲染上下文与 content 组件写法

> 来源：`packages/canvas-render/src/contracts/*.ts`（renderContext / canvasFlowApi / nodeRegistryKey / canvasParamKey / edgeContext / debugContext / contentComponentTypes / capabilities）、
> `host/CanvasSurface.vue`（provide 处）、插件 `plugin-node-text/src/TextContent.vue`、`plugin-theme-default/src/components/node/BaseNode.vue`。

## 一句话

渲染子树只有**一个注入令牌** `RENDER_CONTEXT_KEY`：`CanvasSurface`（boot 完成后挂载的那层）向整棵 VueFlow 子树 provide 一份整包渲染上下文，渲染插件组件（content / 节点壳 / 自定义边）在自己的 setup 里用 **`useCanvasRender()`** 取出来用。

**旧的六个 `*_KEY` 注入令牌与 `contentBridge`（HOST_KEY）已全部删除**：CanvasSurface 不再逐个 provide，canvas-render 也不再导出它们。所有消费方一律走 `useCanvasRender()`。

---

## 1) RENDER_CONTEXT_KEY —— 统一渲染上下文（唯一入口）

定义在 `contracts/renderContext.ts`。**provide 方是 CanvasSurface（boot 完成后才挂载）**，所以 ctx/host 都是**裸值**（非 Ref 非空）。

```ts
interface CanvasRenderContext {
  ctx: Context                      // 内核上下文：ctx.get('doc') 直取服务
  host: CanvasHostHandle            // ctx 的超集：save/doc/selection/command/… + stop()
  flow: CanvasFlowApi               // 画布 Flow/DOM 能力面（视口/DOM/坐标/视觉写读；有就绪状态）
  registry: NodeRegistry            // 节点展示注册表
  nodeWrite: NodeWrite              // 标题/尺寸写回
  handleParams: CanvasParams        // 浮动端口外观（响应式）
  edgeVisual: Partial<EdgeVisual>   // 边外观（响应式）
  edgeSelection: EdgeSelection      // 选中集合
  connectionState: ConnectionFeedbackState  // 拖线连接过程反馈
  interaction: CanvasInteractionState       // 画布交互状态 —— 见 10 号专档
  debug: CanvasDebug                // 调试可视化开关
  snapZone: SnapZoneConfig          // 吸附带配置
  renderNodes: Readonly<Ref<ReadonlyArray<FlowNode>>>   // 当前渲染节点只读快照
  renderEdges: Readonly<Ref<ReadonlyArray<{ id: string; type: string; source: string; target: string
                                            sourceHandle?: string; targetHandle?: string }>>>  // 当前渲染边只读快照
  visibleRect: Readonly<Ref<FlowRect | null>>  // 当前可视区（flow 坐标）
  visibleNodes(margin?: number): LayoutRect[]  // 可视区内节点矩形（方法式，调用时现算）
}

export function useCanvasRender(): CanvasRenderContext {
  const ctx = inject(RENDER_CONTEXT_KEY, null)
  if (!ctx) {
    throw new Error('[useCanvasRender] 缺少渲染上下文：请确保该组件渲染在 <CanvasHost> 之内…')
  }
  return ctx
}
```

**用法**：
```ts
const { ctx, host, flow, registry, nodeWrite, handleParams, edgeVisual } = useCanvasRender()
```

- 取服务：`ctx.get('doc')`（节点 + 边 + 事务/撤销的统一门面，content 组件改节点数据最常用）。
  > 老名 `nodeStore`/`edgeStore`/`graph`/`history` **已下线**（它们合并进 `doc`），拿老名去 `ctx.get` 取不到。
- **视口 / DOM / 坐标 / 节点视觉写读统一经 `flow`**（`CanvasFlowApi`），不再散落在上下文上：
  - 响应式：`flow.viewport` / `flow.pane` / `flow.paneRect` / `flow.root` / `flow.renderer`（都是 `Ref`）。
  - 方法：`screenToFlow` / `flowToScreen` / `viewportSnapshot` / `zoomIn` / `zoomOut` / `zoomTo` /
    `fitView` / `setCenter` / `setViewport` / `updateNodeVisual` / `updateNodeVisualSize` /
    `getNodeRenderPosition` / `queryNodeEl` / `rootEl` / `paneEl` / `rendererEl`。
  - 就绪状态：`flow.phase()` / `flow.ready()` / `flow.domReady()` / `flow.subscribe()`；
    未就绪调用会抛 `CanvasFlowNotReadyError`（不再用默认坐标 / 空操作掩盖"还没挂载"）。
- 在 CanvasHost 渲染子树之外调用会抛清晰错误——这些渲染组件本就依赖宿主能力。

---

## 2) 节点展示注册表（registry）

值：`NodeRegistry`（注册了 type→各区域组件的表）。节点壳 BaseNode 经 `nodeRegionStackEntries(registry, regionField, type, 'in')` 把该 type 的 `in` 区域组件摞解析出来（内含 registry 基座 + 区域贡献 + `node/region` 场）。content 组件一般不需要直接用它，取它走 `useCanvasRender().registry`。

---

## 3) 节点数据/尺寸写回回调（nodeWrite）

```ts
export type NodeWritePatch = Record<string, unknown> & { size?: { w: number; h: number } }
export type NodeWrite = (id: string, patch: NodeWritePatch) => void
```

宿主提供后，BaseNode 的就地编辑（标题重命名）与卡片 resize 才能把改动写回内核并落盘。**不提供则节点只读**（安全降级）。

- 普通 key 写进 `node.data`（标题/文本内容等）；
- 保留 key `size` 写进内核的**正式尺寸字段** `node.size`（不塞进 data）——保证 resize 一次只产生一条撤销记录。

取它走 `useCanvasRender().nodeWrite`。

---

## 4) 浮动端口外观（handleParams）

```ts
interface CanvasParams {
  handleRestOffset: number          // 36  圆球离区归位偏移
  handleCursorGap: number           // 24  圆球跟鼠标错开
  handleButtonSize: number          // 32  圆球尺寸
  portZoneWidth?: number            // 端口区域宽度
  portZoneHeightRatio?: number      // 端口区域高度占节点高度比例
  portZoneOffset?: number           // 端口区域相对锚点偏移
  portZoneShape?: 'rect' | 'arc'
  portZoneArcRatio?: number         // 弧垂直胖瘦系数
}
```

BaseNode 等壳组件读它控制浮动端口（MovingHandle）尺寸与端口吸附区几何。取值须为 reactive 对象（属性改动被 computed 追踪实时生效）。**BaseNode 读这些字段不做默认回落**——所以要传一个含全部字段的 reactive 对象（`DEFAULT_HANDLE_VISUAL` 就是全字段的一份，见《03》）。取它走 `useCanvasRender().handleParams`。

---

## 5) 边外观与选中（edgeVisual / edgeSelection）

```ts
interface EdgeVisual {
  edgeType?: 'bezier' | 'straight' | 'step' | 'smoothstep'
  edgeLineWidth?: number
  edgeColor?: string
  edgeDashed?: boolean
  edgeMarkerEnd?: boolean
  edgeMarkerSize?: number
  edgeVisible?: boolean
  edgeVisibleOnSelect?: boolean
  edgeOnTop?: boolean
  edgeGlowEnabled?: boolean
  edgeGlowIntensity?: number
  edgeGlowColor?: string
  // 光斑流动（导轨 + 色块）
  edgeFlowEnabled?: boolean
  edgeFlowCount?: number
  edgeFlowRatio?: number
  edgeFlowSpeed?: number
  edgeFlowFade?: number
  edgeFlowIntensity?: number
}

interface EdgeSelection {
  selectedNodeIds: Ref<ReadonlySet<string>>
  selectedEdgeIds: Ref<ReadonlySet<string>>
}
```

- 自定义边（CustomEdge）外观取自 `useCanvasRender().edgeVisual`；选中态（`edgeSelection`）给"相连被选即高亮"用。

---

## 6) 调试可视化开关（debug）

```ts
interface CanvasDebug {
  handleDebug: boolean                 // 端口调试：画端口半圆交互区/圆心/rest/鼠标点
  connectionSnapDebugVisible: boolean  // 吸附调试：拖线悬停时画吸附带与卡片接收区
}
```

宿主 provide 后由 BaseNode / MovingHandle 消费。默认值 `DEFAULT_DEBUG_VISUAL` 两个都开。取它走 `useCanvasRender().debug`。

---

## 7) 渲染层两个内置服务（ctx.get('nodeLayout') / ctx.get('viewport')）

除渲染上下文外，渲染层还向内核 ctx 注入两个**服务名**（逻辑插件用 `ctx.get` 取；契约类型由 canvas-data 集中登记，只依赖 canvas-base 也能按名推导）：

| 服务名 | 契约 | 用途 |
|---|---|---|
| `nodeLayout` | `NodeLayoutContract`（canvas-data） | 节点矩形只读：`getNodeRect` / `getAllRects` / `nodeSize` / `absolutePosition` / `childrenOf` |
| `viewport` | `ViewportContract`（canvas-data） | 视口读/控 + 坐标换算 + 实例级 DOM 锚点（`getViewport`/`setCenter`/`screenToFlow`/`getRootEl`…） |

> 类型放 canvas-data（作者 SDK 上游）`renderServiceContracts.ts`：逻辑插件只引 `@mini-canvas/canvas-base` 就能 `ctx.get('viewport')` 按名推导，不必 import 渲染包、也不必手写窄端口。
> 渲染层内部写口（`setMeasuredSize` / `attachBackend`）与拖拽期视觉读写（`updateNodeVisual` / `getNodeRenderPosition`）**不进契约**——前者是渲染层内部面，后者走 `flow` facade。

---

## content 组件真实写法（照抄即可）

看真实的 `plugin-node-text/src/TextContent.vue`，它演示了 content 组件的完整套路：**声明 props → useCanvasRender 拿 ctx → 展示 data → 交互调服务写回**。

```vue
<script setup lang="ts">
// ① content 组件会收到 BaseNode 传的 { id, data }（id = 节点 id，data = 该节点 data）
import { ref, computed, nextTick, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { TextNodeService } from './nodeTextPlugin'

const props = defineProps<{ id: string; data: { text?: string } }>()

// ② 拿裸 ctx（boot 后已就绪，零 .value 零判空）+ 视口响应式 Ref
const { ctx, flow } = useCanvasRender()
const viewport = flow.viewport
// 根 Context 没有"服务属性 Proxy"（declare module 只增强类型），故用 ctx.get 取服务
function textService() {
  return ctx.get('text')
}

const shown = ref(props.data.text ?? '')
const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)

// 外部写回同步：撤销/重做、AI 或别的插件改 data.text 时，本地展示要跟着变
watch(() => props.data.text, (next) => {
  if (editing.value) return
  shown.value = typeof next === 'string' ? next : ''
})

function startEdit() {
  if (editing.value) return
  draft.value = shown.value
  editing.value = true
  void nextTick(() => inputEl.value?.focus())
}
function commit() {
  if (!editing.value) return
  editing.value = false
  const next = draft.value
  if (next !== shown.value) {
    shown.value = next
    textService().editText(props.id, next)   // 调服务改 data + 调度落盘（内部走 doc）
  }
}
const zoom = computed(() => Math.max(viewport.value?.zoom ?? 1, 0.01))
</script>

<template>
  <div class="text-node">
    <textarea v-if="editing" ref="inputEl" v-model="draft" class="editor nodrag nopan nowheel"
              @blur="commit" @keydown.esc.prevent="editing = false" @mousedown.stop />
    <div v-else class="preview" @dblclick.stop="startEdit">{{ shown || '（空）' }}</div>
  </div>
</template>
```

关键点：

1. **props = `{ id, data }`**（有的还带 `type`）。这是 BaseNode 渲染 content 区域时传的固定形状；类型可复用 `contracts/contentComponentTypes.ts` 的 `SegmentContentProps` / `SegmentNodeData`。
2. **拿 ctx 用 `useCanvasRender()`**，取服务走 `ctx.get('服务名')`。`ctx.text.editText(...)` 这类**直接属性访问只对插件 scope 的 ctx 有效**（那边的 ctx 有服务解析 Proxy）——组件里拿到的是根 Context，要 `ctx.get`。
3. **连接点 Handle 由 BaseNode（nodeShell）统一提供**，content 不画 Handle、不管端口。
4. 外层点击事件记得 `.stop`（阻止冒泡到画布的 pane 事件）；编辑框加 `nodrag nopan nowheel` 类，避免在框里拖拽/滚轮被画布抢走。

---

## 节点壳 BaseNode 怎么用这些能力（参考）

`plugin-theme-default/src/components/node/BaseNode.vue` 是 `nodeShell` 的实现，展示了壳组件的消费方式：

```ts
import { useCanvasRender, useToolbarOffsets, resolveNodeSlotStyle } from '@mini-canvas/canvas-render'

const { ctx, registry, nodeWrite, handleParams, connectionState, interaction, debug, snapZone,
        visibleRect, flow } = useCanvasRender()
// 视口响应式 Ref 与视觉尺寸写回统一走 flow facade
const viewport = flow.viewport
const zoom = computed(() => Math.max(viewport.value?.zoom || 1, 0.01))
// …resize 期间：flow.updateNodeVisualSize(id, w, h)

// 按区域词解析该 type 的 `in` 区域组件摞（区域词：in/title/out:top/…，见 00 总览）
// regionEntries 内部调 nodeRegionStackEntries(registry, regionField, props.type, region)
const contentStack = computed(() => regionEntries('in'))

// 就地重命名写回
if (nodeWrite) nodeWrite(props.id, { label: next })

// 上/下控制栏贴边定位（壳统一负责定位 + 反缩放，插件只管内容）
const slotOffsets = useToolbarOffsets()
const topSlotsStyle = computed(() =>
  resolveNodeSlotStyle({ side: 'top', offset: slotOffsets.value.top, zoom: zoom.value }),
)

// 实时渲染位置（含拖动中未落盘的位移）：经 flow.getNodeRenderPosition(id)
const pos = flow.getNodeRenderPosition(props.id)
```

- 节点类型都指到 BaseNode（nodeTypes 铺满），它内部再用 registry 按 type 解析各区域组件。

---

## 坑

1. **旧 `*_KEY` 注入令牌已删除**：`HOST_KEY` / `NODE_REGISTRY_KEY` / `NODE_WRITE_KEY` / `CANVAS_PARAMS_KEY` / `EDGE_VISUAL_KEY` / `EDGE_SELECTION_KEY` / `DEBUG_KEY` 都不再导出。一律 `useCanvasRender()`。
2. **useCanvasRender 必须在 CanvasHost 子树内**：在 CanvasHost 之外（比如你 App 根组件直接调）会抛错。要读内核上下文，把代码放到 `<CanvasHost #ui>` 插槽、或你自己的内容/壳组件里。
3. **content 别反向依赖宿主**：content .vue 只 import `@mini-canvas/canvas-render`（拿 useCanvasRender），不 import 宿主应用、不 import 其它插件。这样它才能被任何宿主复用。
4. **类型增强要走 `declare module`**：想让 `ctx.text` 直访有类型，在插件逻辑里写 `declare module '@mini-canvas/canvas-data' { interface Context { text: TextService } }`。插件自有服务仍可显式泛型 `ctx.get<TextService>('text')`。
5. **内置服务名不再自己 declare**：`doc/selection/resources/save/command/…`（canvas-data）与 `nodeLayout/viewport`（canvas-data 的 `renderServiceContracts`）都已集中登记，按名 `ctx.get('doc')` 即推导；重复 declare 会冲突。
6. **视口 / DOM / 坐标 / 节点视觉写读一律走 `flow`**：不要再找 `ctx.viewport`（那是逻辑插件用的**服务名**，与组件里的 `flow` 是两件事）。组件里做响应式绑定用 `flow.viewport`；命令式读取用 `flow.screenToFlow(...)` 等；未挂载会抛 `CanvasFlowNotReadyError`。

