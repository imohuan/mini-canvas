# canvas-render 开发手册 · contracts 六个注入令牌 + content 组件写法

> 来源：`packages/canvas-render/src/contracts/*.ts`（canvasParamKey / contentBridge / edgeContext / nodeRegistryKey / renderContext）、
> `host/CanvasSurface.vue`（provide 处）、插件 `plugin-node-text/src/TextContent.vue`、`plugin-theme-default/src/BaseNode.vue`。

## 一句话

"注入令牌"是 Vue 的 **provide/inject** 用的键（`InjectionKey<...>`）。`CanvasSurface`（boot 完成后挂载的那层）向整棵 VueFlow 子树 **provide** 这些东西；渲染插件组件（content / 节点壳 / 自定义边）在自己的 setup 里 **inject** 出来用。

新代码统一走 **`useCanvasRender()`**（只收一个令牌 `RENDER_CONTEXT_KEY`，返回整包上下文）；旧的 6 个 `*_KEY` 仍保留 provide（CanvasSurface 里逐个同引用 provide）以兼容未迁移组件。

---

## 六个令牌速查表

| KEY 常量 | provide 的值 | 用途 | 建议消费方式 |
|---------|-------------|------|------------|
| `RENDER_CONTEXT_KEY` | `CanvasRenderContext`（整包） | 渲染宿主的统一上下文 | `useCanvasRender()`（首选） |
| `HOST_KEY` | `Ref<CanvasHostHandle \| undefined>` | 宿主句柄的**响应式引用**（历史形态） | 兼容旧组件；新代码用 `useCanvasRender().host/.ctx` |
| `NODE_REGISTRY_KEY` | `NodeRegistry` | 节点展示注册表 type→段组件 | `useCanvasRender().registry` |
| `NODE_WRITE_KEY` | `NodeWrite`（回调） | 标题就地重命名写回 | `useCanvasRender().nodeWrite` |
| `CANVAS_PARAMS_KEY` | `CanvasParams`（响应式） | 浮动端口外观参数 | `useCanvasRender().handleParams` |
| `EDGE_VISUAL_KEY` | `Partial<EdgeVisual>`（响应式） | 边外观 | `useCanvasRender().edgeVisual` |
| `EDGE_SELECTION_KEY` | `Partial<EdgeSelection>` | 选中集合 | `useCanvasRender().edgeSelection` |

> 注：这里其实是 6+1 个令牌（RENDER_CONTEXT 是 2023 后加的收口）。renderContext.ts 的注释说它把 6 个旧令牌收成一个上下文对象，故文档标题用"六个注入令牌"沿项目习惯。

---

## 1) RENDER_CONTEXT_KEY —— 统一渲染上下文（新代码首选）

定义在 `contracts/renderContext.ts`。**provide 方是 CanvasSurface（boot 完成后才挂载）**，所以 ctx/host 都是**裸值**（非 Ref 非空）。

```ts
interface CanvasRenderContext {
  ctx: Context                 // 内核上下文：ctx.get('nodeStore') / ctx.text 直访
  host: CanvasHostHandle       // ctx 的超集：save/nodeStore/selection/command/history/... + stop()
  registry: NodeRegistry       // 节点展示注册表
  nodeWrite: NodeWrite         // 标题重命名写回
  handleParams: CanvasParams   // 浮动端口外观（响应式）
  edgeVisual: Partial<EdgeVisual>  // 边外观（响应式）
  edgeSelection: EdgeSelection     // 选中集合
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
- 取服务：`ctx.get('nodeStore')`（content 组件最常用）。
- 需要在 CanvasHost 渲染子树之外调用会抛清晰错误——这些渲染组件本就依赖宿主能力。

---

## 2) HOST_KEY —— 拿宿主句柄（旧形态）

定义在 `contracts/contentBridge.ts`：

```ts
export const HOST_KEY: InjectionKey<Ref<any | undefined>> = Symbol('canvas-v2-host')
```

- 类型是 `Ref<CanvasHostHandle | undefined>`，即一个**可能为空的宿主引用**（内核异步 boot，provide 的是引用，boot 完成后填充）。
- **CanvasSurface 用 `provide(HOST_KEY, shallowRef(host))` 提供**（同引用）。
- 消费：content 组件 `const host = inject(HOST_KEY)`，然后 `host.value.ctx.get('nodeStore')`。因为要 `.value` + 判空，新组件改用 `useCanvasRender().ctx`。

> 想要 host 的**裸 ctx**（`.ctx` 直取服务），走 `useCanvasRender()` 最省事。

---

## 3) NODE_REGISTRY_KEY —— 节点展示注册表

定义在 `contracts/nodeRegistryKey.ts`：
```ts
export const NODE_REGISTRY_KEY: InjectionKey<NodeRegistry> = Symbol('canvas-v2-node-registry')
```
值：`NodeRegistry`（注册了 type→content/title/… 段组件的表）。节点壳 BaseNode 用它做 `resolveSegment(registry, type, 'content')` 解析该 type 的 content 组件。content 组件一般不需要它。

---

## 4) NODE_WRITE_KEY —— 节点数据写回回调

```ts
export type NodeWrite = (id: string, patch: Record<string, unknown>) => void
export const NODE_WRITE_KEY: InjectionKey<NodeWrite> = Symbol('canvas-v2-node-write')
```
宿主注入后，BaseNode 的就地编辑（标题重命名）才能把改动写回内核并落盘。**不注入则节点只读**（安全降级）。

CanvasHost 缺省实现 `defaultWrite`：
```ts
function defaultWrite(id: string, patch: Record<string, unknown>): void {
  const node = h.nodeStore.getNode(id)
  if (!node) return
  h.nodeStore.updateNodeData(id, patch)   // 触发 subscribe → 渲染态自动更新
  void h.save.set('graph', h.nodeStore.getNodes(), 'canvas')
}
```

---

## 5) CANVAS_PARAMS_KEY —— 浮动端口外观

定义在 `contracts/canvasParamKey.ts`：
```ts
interface CanvasParams {
  handleRadius: number       // 86
  handleRestOffset: number   // 36
  handleCursorGap: number    // 24
  handleButtonSize: number   // 32
  handleOverlap: number      // 16
}
export const CANVAS_PARAMS_KEY: InjectionKey<CanvasParams> = Symbol('canvas-v2-canvas-params')
```
BaseNode 等壳组件读它控制浮动端口（MovingHandle）尺寸。注入值须为 reactive 对象（属性改动被 computed 追踪实时生效）。**BaseNode 读这些字段不做默认回落**——所以 handleParams 要含全部 5 个字段（通常传一个全字段 reactive）。

---

## 6) EDGE_VISUAL_KEY / EDGE_SELECTION_KEY —— 边外观与选中

定义在 `contracts/edgeContext.ts`：

```ts
interface EdgeVisual {
  edgeType?: 'bezier'|'straight'|'step'|'smoothstep'
  edgeLineWidth?: number
  edgeColor?: string
  edgeDashed?: boolean
  edgeAnimated?: boolean
  edgeMarkerEnd?: boolean
  edgeMarkerSize?: number
  edgeVisible?: boolean
  edgeGlowEnabled?: boolean
  edgeGlowIntensity?: number
  edgeGlowColor?: string
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

## content 组件真实写法（照抄即可）

看真实的 `plugin-node-text/src/TextContent.vue`，它演示了 content 组件的完整套路：**声明 props → useCanvasRender 拿 ctx → 展示 data → 交互调服务写回**。

```vue
<script setup lang="ts">
// ① content 组件会收到 BaseNode 传的 { id, data }（id=节点id，data=该节点 data）
import { ref, nextTick } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const props = defineProps<{ id: string; data: { text?: string } }>()

// ② 拿裸 ctx（boot 后已就绪，零 .value 零判空）
const { ctx } = useCanvasRender()
function textService() {
  return ctx.text   // 类型来自插件对 Context 的 declare module 增强
}

// ③ 本地展示值：init 自 props.data，编辑后本地回显
const shown = ref(props.data.text ?? '')
const editing = ref(false)
const draft = ref('')

function startEdit() {
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
    textService().editText(props.id, next)   // 调服务改 data + 落盘
  }
}
</script>

<template>
  <div class="text-node">
    <textarea v-if="editing" v-model="draft" @blur="commit"
              @keydown.enter.prevent="commit" @keydown.escape.prevent="editing=false" />
    <div v-else class="preview" @dblclick.stop="startEdit">{{ shown || '（空）' }}</div>
  </div>
</template>
```

关键点：
1. **props = `{ id, data }`**（有的还带 `type`）。这是 BaseNode 渲染 content 段时传的固定形状。
2. **拿 ctx 用 `useCanvasRender()`**，取服务走 `ctx.get('服务名')` 或 `ctx.服务名`（后者靠插件 `declare module` 增强类型）。TextContent 里 `ctx.text.editText(props.id, next)` 把编辑写回内核并落盘（editText 内部 `nodeStore.updateNodeData` + `save.set('graph',...)`）。
3. **连接点 Handle 由 BaseNode（nodeShell）统一提供**，content 不画 Handle、不管端口。
4. 外层点击事件记得 `.stop`（`.stop` 阻止冒泡到画布的 pane 事件），双击进入编辑用 `.stop`。

---

## 节点壳 BaseNode 怎么用这些令牌（参考）

`plugin-theme-default/src/BaseNode.vue` 是 `nodeShell` 的实现，展示了壳组件的消费方式：

```ts
import { useCanvasRender } from '@mini-canvas/canvas-render'
const { registry, nodeWrite, handleParams } = useCanvasRender()

const content = computed(() => resolveSegment(registry, props.type, 'content'))
// 渲染 content 段
<component :is="content" v-if="content" :id="id" :data="data" />

// 就地重命名写回
if (nodeWrite) nodeWrite(props.id, { label: next })

// 浮动端口尺寸喂给 MovingHandle
<MovingHandle :radius="handleParams.handleRadius" ... />
```

- `useVueFlow`（来自 vueFlowBridge）拿画布 store 做 LOD（读 zoom）。
- 节点类型都指到 BaseNode（nodeTypes 铺满），它内部再用 registry 按 type 解析各段组件。

---

## 坑

1. **新代码别 inject 6 个旧 KEY 了**：它们还在（CanvasSurface 仍 provide），但取到的 HOST 是 Ref、其它也可能要判空。统一 `useCanvasRender()` 最干净。
2. **useCanvasRender 必须在 CanvasHost 子树内**：在 CanvasHost 之外（比如你 App 根组件直接调）会抛错。要读内核上下文，把代码放到 `<CanvasHost #ui>` 插槽、或你自己的内容/壳组件里。
3. **content 别反向依赖宿主**：content .vue 只 import `@mini-canvas/canvas-render`（拿 useCanvasRender / 令牌），不 import demo-web、不 import 其它插件。这样它才能被任何宿主复用。
4. **类型增强要 `declare module`**：想让 `ctx.text` 直访有类型，在插件逻辑里 `declare module '@mini-canvas/canvas-core-v2' { interface Context { text: TextService } }`。依赖方若要用到，得 import type 那个插件包（见 theme-default 顶部 `import type {} from '@mini-canvas/plugin-node-text'`）。
