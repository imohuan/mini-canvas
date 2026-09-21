# canvas-render 开发手册 · contracts 注入令牌 + content 组件写法

> 来源：`packages/canvas-render/src/contracts/*.ts`（contentBridge / nodeRegistryKey / canvasParamKey / edgeContext / debugContext / renderContext / contentComponentTypes）、
> `host/CanvasSurface.vue`（provide 处）、插件 `plugin-node-text/src/TextContent.vue`、`plugin-theme-default/src/components/node/BaseNode.vue`。

## 一句话

"注入令牌"是 Vue 的 **provide/inject** 用的键（`InjectionKey<...>`）。`CanvasSurface`（boot 完成后挂载的那层）向整棵 VueFlow 子树 **provide** 这些东西；渲染插件组件（content / 节点壳 / 自定义边）在自己的 setup 里 **inject** 出来用。

新代码统一走 **`useCanvasRender()`**（只收一个令牌 `RENDER_CONTEXT_KEY`，返回整包上下文）；旧的 6 个 `*_KEY` 仍保留 provide（CanvasSurface 里逐个同引用 provide）以兼容未迁移组件。

> **标题说明**：历史标题叫"六个注入令牌"。现行真实导出是 **统一上下文 1 个（`RENDER_CONTEXT_KEY`）+ 兼容令牌 6 个（`HOST_KEY` / `NODE_REGISTRY_KEY` / `NODE_WRITE_KEY` / `CANVAS_PARAMS_KEY` / `EDGE_VISUAL_KEY` / `EDGE_SELECTION_KEY`）+ 另有导出的 `DEBUG_KEY`（CanvasSurface 目前不逐个 provide，调试开关走 `useCanvasRender().debug`）**。逐令牌枚举见下表。

---

## 令牌速查表（以源码实际导出为准）

| KEY 常量 | 定义在 | provide 的值 | 用途 | 建议消费方式 |
|---------|-------|-------------|------|------------|
| `RENDER_CONTEXT_KEY` | `contracts/renderContext.ts` | `CanvasRenderContext`（整包） | 渲染宿主的统一上下文 | `useCanvasRender()`（首选） |
| `HOST_KEY` | `contracts/contentBridge.ts` | `Ref<CanvasHostHandle \| undefined>` | 宿主句柄的**响应式引用**（历史形态） | 兼容旧组件；新代码用 `useCanvasRender().host/.ctx` |
| `NODE_REGISTRY_KEY` | `contracts/nodeRegistryKey.ts` | `NodeRegistry` | 节点展示注册表 type→各区域组件 | `useCanvasRender().registry` |
| `NODE_WRITE_KEY` | `contracts/nodeRegistryKey.ts` | `NodeWrite`（回调） | 标题就地重命名 / 卡片 resize 尺寸写回 | `useCanvasRender().nodeWrite` |
| `CANVAS_PARAMS_KEY` | `contracts/canvasParamKey.ts` | `CanvasParams`（响应式） | 浮动端口外观参数 | `useCanvasRender().handleParams` |
| `EDGE_VISUAL_KEY` | `contracts/edgeContext.ts` | `Partial<EdgeVisual>`（响应式） | 边外观 | `useCanvasRender().edgeVisual` |
| `EDGE_SELECTION_KEY` | `contracts/edgeContext.ts` | `Partial<EdgeSelection>` | 选中集合（节点桶 + 边桶） | `useCanvasRender().edgeSelection` |
| `DEBUG_KEY` | `contracts/debugContext.ts` | `CanvasDebug` | 调试可视化开关（端口/吸附） | `useCanvasRender().debug`（CanvasSurface 不逐个 provide 这个 KEY） |
| `CAPABILITY_BAG_KEY` / `CAPABILITY_SCOPE_KEY` | `contracts/capabilities.ts` | 能力袋 / 作用域信息 | 由 `RegionEntryHost` provide，组件走 `useCapabilities()` | 不手写 inject |

---

## 1) RENDER_CONTEXT_KEY —— 统一渲染上下文（新代码首选）

定义在 `contracts/renderContext.ts`。**provide 方是 CanvasSurface（boot 完成后才挂载）**，所以 ctx/host 都是**裸值**（非 Ref 非空）。

```ts
interface CanvasRenderContext {
  ctx: Context                      // 内核上下文：ctx.get('doc') 直取服务
  host: CanvasHostHandle            // ctx 的超集：save/doc/nodeStore/selection/command/… + stop()
  registry: NodeRegistry            // 节点展示注册表
  nodeWrite: NodeWrite              // 标题/尺寸写回
  handleParams: CanvasParams        // 浮动端口外观（响应式）
  edgeVisual: Partial<EdgeVisual>   // 边外观（响应式）
  edgeSelection: EdgeSelection      // 选中集合
  connectionState: ConnectionFeedbackState  // 拖线连接过程反馈
  interaction: CanvasInteractionState       // 画布交互状态 —— 见 10 号专档
  debug: CanvasDebug                // 调试可视化开关
  snapZone: SnapZoneConfig          // 吸附带配置
  viewport: Readonly<Ref<ViewportState>>    // 当前视口变换（响应式）
  paneRect: Readonly<Ref<DOMRect | null>>   // 视口 pane 的 DOM 矩形
  pane: Readonly<Ref<HTMLElement | null>>   // 画布 pane DOM
  rootEl: Readonly<Ref<HTMLElement | null>> // 本画布实例根 DOM
  rendererEl: Readonly<Ref<HTMLElement | null>>  // 节点层 DOM
  renderNodes: Readonly<Ref<ReadonlyArray<FlowNode>>>   // 当前渲染节点只读快照
  renderEdges: Readonly<Ref<ReadonlyArray<{ id: string; type: string; source: string; target: string
                                            sourceHandle?: string; targetHandle?: string }>>>  // 当前渲染边只读快照
  visibleRect: Readonly<Ref<FlowRect | null>>  // 当前可视区（flow 坐标）
  visibleNodes(margin?: number): LayoutRect[]  // 可视区内节点矩形（方法式，调用时现算）
  screenToFlow(clientX: number, clientY: number): { x: number; y: number }
  flowToScreen(flowX: number, flowY: number): { x: number; y: number }
  updateNodeVisual(id: string, position: { x: number; y: number }): void
  updateNodeVisualSize(id: string, w: number, h: number): void
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
const { ctx, host, registry, nodeWrite, handleParams, edgeVisual } = useCanvasRender()
```

- 取服务：`ctx.get('doc')`（节点 + 边 + 事务/撤销的统一门面，content 组件改节点数据最常用）。
  > 老名 `nodeStore`/`edgeStore`/`graph`/`history` **已下线**（它们合并进 `doc`），拿老名去 `ctx.get` 取不到。
- 在 CanvasHost 渲染子树之外调用会抛清晰错误——这些渲染组件本就依赖宿主能力。

---

## 2) HOST_KEY —— 拿宿主句柄（旧形态）

定义在 `contracts/contentBridge.ts`：

```ts
export const HOST_KEY: InjectionKey<Ref<any | undefined>> = Symbol('canvas-v2-host')
```

- 类型是 `Ref<CanvasHostHandle | undefined>`，即一个**可能为空的宿主引用**（内核异步 boot，provide 的是引用，boot 完成后填充）。
- **CanvasSurface 用 `provide(HOST_KEY, shallowRef(host))` 提供**。
- 消费：content 组件 `const host = inject(HOST_KEY)`，然后 `host.value.ctx.get('doc')`。因为要 `.value` + 判空，新组件改用 `useCanvasRender().ctx`。

> 想要 host 的**裸 ctx**（`ctx` 直取服务），走 `useCanvasRender()` 最省事。

---

## 3) NODE_REGISTRY_KEY —— 节点展示注册表

定义在 `contracts/nodeRegistryKey.ts`：
```ts
export const NODE_REGISTRY_KEY: InjectionKey<NodeRegistry> = Symbol('canvas-v2-node-registry')
```

值：`NodeRegistry`（注册了 type→各区域组件的表）。节点壳 BaseNode 经 `nodeRegionStackEntries(registry, regionField, type, 'in')` 把该 type 的 `in` 区域组件摞解析出来（内含 registry 基座 + 区域贡献 + `node/region` 场）。content 组件一般不需要直接用它。

---

## 4) NODE_WRITE_KEY —— 节点数据/尺寸写回回调

```ts
export type NodeWritePatch = Record<string, unknown> & { size?: { w: number; h: number } }
export type NodeWrite = (id: string, patch: NodeWritePatch) => void
export const NODE_WRITE_KEY: InjectionKey<NodeWrite> = Symbol('canvas-v2-node-write')
```

宿主注入后，BaseNode 的就地编辑（标题重命名）与卡片 resize 才能把改动写回内核并落盘。**不注入则节点只读**（安全降级）。

- 普通 key 写进 `node.data`（标题/文本内容等）；
- 保留 key `size` 写进内核的**正式尺寸字段** `node.size`（不塞进 data）——保证 resize 一次只产生一条撤销记录。

CanvasHost 缺省实现 `defaultWrite`：
```ts
function defaultWrite(id: string, patch: NodeWritePatch): void {
  const h = hostRef.value
  if (!h) return
  const node = h.nodeStore.getNode(id)
  if (!node) return
  const { data, size } = splitNodeWritePatch(patch)
  // 统一走 graph：历史 + 提交落盘由唯一写入口负责
  h.graph.updateNode(id, size !== undefined ? { data, size } : { data })
}
```

---

## 5) CANVAS_PARAMS_KEY —— 浮动端口外观

定义在 `contracts/canvasParamKey.ts`：

```ts
interface CanvasParams {
  handleRestOffset: number          // 36  圆球离区归位偏移
  handleCursorGap: number           // 24  圆球跟鼠标错开
  handleButtonSize: number          // 32  圆球尺寸
  portZoneWidth?: number            // 86  端口区域宽度
  portZoneHeightRatio?: number      // 0.8 端口区域高度占节点高度比例
  portZoneOffset?: number           // 0   端口区域相对锚点偏移
  portZoneShape?: 'rect' | 'arc'    // 'arc'
  portZoneArcRatio?: number         // 1   弧垂直胖瘦系数
}
export const CANVAS_PARAMS_KEY: InjectionKey<CanvasParams> = Symbol('canvas-v2-canvas-params')
```

BaseNode 等壳组件读它控制浮动端口（MovingHandle）尺寸与端口吸附区几何。注入值须为 reactive 对象（属性改动被 computed 追踪实时生效）。**BaseNode 读这些字段不做默认回落**——所以要传一个含全部 8 个字段的 reactive 对象（`DEFAULT_HANDLE_VISUAL` 就是全字段的一份，见《03》）。

---

## 6) EDGE_VISUAL_KEY / EDGE_SELECTION_KEY —— 边外观与选中

定义在 `contracts/edgeContext.ts`：

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
export const EDGE_VISUAL_KEY: InjectionKey<Partial<EdgeVisual>> = Symbol('canvas-edge-visual')

interface EdgeSelection {
  selectedNodeIds: Ref<ReadonlySet<string>>
  selectedEdgeIds: Ref<ReadonlySet<string>>
}
export const EDGE_SELECTION_KEY: InjectionKey<Partial<EdgeSelection>> = Symbol('canvas-edge-selection')
```

- 自定义边（CustomEdge）外观取自 `useCanvasRender().edgeVisual`；选中态给"相连被选即高亮"用。

---

## 7) DEBUG_KEY —— 调试可视化开关

定义在 `contracts/debugContext.ts`：

```ts
interface CanvasDebug {
  handleDebug: boolean                 // 端口调试：画端口半圆交互区/圆心/rest/鼠标点
  connectionSnapDebugVisible: boolean  // 吸附调试：拖线悬停时画吸附带与卡片接收区
}
export const DEBUG_KEY: InjectionKey<CanvasDebug> = Symbol('canvas-v2-debug-visual')
```

宿主 provide 后由 BaseNode / MovingHandle 消费。默认值 `DEFAULT_DEBUG_VISUAL` 是**两个都开**（方便直观看到端口几何与吸附范围）。组件里取它走 `useCanvasRender().debug`（CanvasSurface 未逐个 provide 这个 KEY）。

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

// ② 拿裸 ctx（boot 后已就绪，零 .value 零判空）+ 当前视口（响应式）
const { ctx, viewport } = useCanvasRender()
// 根 Context 没有"服务属性 Proxy"（declare module 只增强类型），故用 ctx.get 取服务
function textService() {
  return ctx.get<TextNodeService>('text')
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

## 节点壳 BaseNode 怎么用这些令牌（参考）

`plugin-theme-default/src/components/node/BaseNode.vue` 是 `nodeShell` 的实现，展示了壳组件的消费方式：

```ts
import { useCanvasRender, useVueFlow, useToolbarOffsets, resolveNodeSlotStyle } from '@mini-canvas/canvas-render'

const { registry, nodeWrite, handleParams, connectionState, interaction, debug, snapZone,
        updateNodeVisualSize, visibleRect } = useCanvasRender()

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

// 端口显隐门（drag 期间压制；多选时压掉自身端口，改用多选框的批量连线端口）
const shouldShowHandles = computed(() =>
  !lowDetail.value && !suppressHandles.value && !isCurrentConnectingNode.value &&
  !interaction.isNodeDragging.value && !isMultiSelected.value &&
  (isHovered.value || portHovered.value || props.selected),
)
```

- `useVueFlow`（来自 vueFlowBridge）拿画布 store 做 LOD（读 zoom）。
- 节点类型都指到 BaseNode（nodeTypes 铺满），它内部再用 registry 按 type 解析各区域组件。

---

## 坑

1. **新代码别 inject 那些旧 KEY 了**：它们还在（CanvasSurface 仍 provide），但取到的 HOST 是 Ref、其它也可能要判空。统一 `useCanvasRender()` 最干净。
2. **useCanvasRender 必须在 CanvasHost 子树内**：在 CanvasHost 之外（比如你 App 根组件直接调）会抛错。要读内核上下文，把代码放到 `<CanvasHost #ui>` 插槽、或你自己的内容/壳组件里。
3. **content 别反向依赖宿主**：content .vue 只 import `@mini-canvas/canvas-render`（拿 useCanvasRender / 令牌），不 import 宿主应用、不 import 其它插件。这样它才能被任何宿主复用。
4. **类型增强要走 `declare module`**：想让 `ctx.text` 直访有类型，在插件逻辑里写 `declare module '@mini-canvas/canvas-data' { interface Context { text: TextService } }`（`Context` 由 `canvas-data` 导出）。依赖方要用到该服务时，直接 `ctx.get<TextService>('text')` 即可，不必去 import 那个插件包。
5. **`nodeLayout` / `viewport` 的类型增强不要自己再写**：`packages/canvas-render/src/index.ts` 末尾已统一 `declare module '@mini-canvas/canvas-data'` 增强这两个，插件重复 declare 会冲突。
