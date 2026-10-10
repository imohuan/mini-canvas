
# 渲染上下文与 content 组件

**一句话定位**：**`useCanvasRender()` 是渲染子树里唯一的一把钥匙 —— 插件组件调它，就能拿到内核上下文、宿主句柄、外观参数、拖线反馈、交互状态；不用再逐个 `inject` 一堆令牌。**

**它属于哪一档**：**渲染层发给插件的「渲染上下文」**。源码：`packages/canvas-render/src/contracts/renderContext.ts`（上下文与消费函数）、`contracts/contentComponentTypes.ts`（content 组件的 props 形状）、`contracts/capabilities.ts`（能力包）、`contracts/nodeRegistryKey.ts`（写回回调类型）、`components/RegionEntryHost.vue`（区域条目宿主，能力包的 provide 点）。

## 它是什么

类比：`useCanvasRender()` 像**后台的工牌**。刷一下工牌，你可以进材料间（读数据）、进控制室（改数据）、看墙上的状态灯（外观参数 / 交互状态）。它**只发给在画布大楼里工作的人** —— 站在楼外（没渲染在 `<CanvasHost>` 子树里）的人刷卡会**直接报错**。

它一个对象里装了这些东西（`CanvasRenderContext`）：

| 字段 | 是什么 | 谁最常用 |
| --- | --- | --- |
| `ctx` | 内核上下文（裸值，已就绪） | content 组件：`ctx.get('doc')`、`ctx.get('text')` |
| `host` | 宿主句柄（ctx 的超集） | 需要 `save` / `nodeStore` / `stop()` 这类宿主级能力时 |
| `flow` | 有就绪状态的画布能力面（视口 / 坐标换算 / DOM 锚点 / 节点视觉写） | 需要屏幕 ↔ 画布坐标、要读缩放 |
| `registry` | 节点展示注册表 | 节点壳：按类型解析 content / 各区域段组件 |
| `nodeWrite` | 节点数据 / 尺寸写回回调 | 节点壳：标题就地重命名、卡片 resize |
| `handleParams` | 浮动端口外观（响应式对象） | 端口组件 |
| `edgeVisual` / `edgeSelection` | 边外观 / 选中集合 | 自定义边组件 |
| `connectionState` | 拖线过程反馈 | 节点壳 / 拖线临时线 |
| `interaction` | 画布交互状态（拖节点 / pan / 缩放 / 框选） | 需要「拖拽期间收起某些 UI」的组件 |
| `debug` / `snapZone` | 调试开关 / 吸附带配置 | 调试叠加层 |
| `renderNodes` / `renderEdges` | 当前渲染态的只读快照 | 小地图 / 生成面板这类要遍历节点的组件 |
| `visibleRect` / `visibleNodes(margin?)` | 可视区矩形 / 可视区内的节点矩形 | 对齐线这类要按可视区裁剪的组件 |

## 为什么需要它

早期不是这样的：`CanvasHost` 会**逐个 provide 六个独立令牌**（节点注册表、写回、画布参数、宿主、边外观、边选中）。结果是：

- 每个组件都要 `inject(某 KEY)!`，还要自己处理「取不到怎么办」；
- 少 inject 一个就报一堆看不懂的错；
- 插件组件想读 ctx 得先 inject `HOST_KEY` 再 `.value` 再判空（因为宿主 setup 期拿不到真值）。

现在收成一个口：`const { ctx, registry } = useCanvasRender()`。**旧的那六个令牌已全部删除**，只有这一条路。

## 怎么用

### 一、拿上下文

```ts
// 片段：任何渲染在 <CanvasHost> 子树里的组件
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { ctx, host, flow, registry, nodeWrite, handleParams, edgeVisual, edgeSelection,
        connectionState, interaction, debug, snapZone, renderNodes, renderEdges,
        visibleRect, visibleNodes } = useCanvasRender()
```

`ctx` 与 `host` 是**裸值**（不是 Ref、不是 undefined）：`CanvasSurface` 只在 boot 成功后才挂载，所以「有宿主」这件事由挂载时机保证。可以直接写 `ctx.get('doc')`，不需要 `.value`、不需要判空。

**不在树里会抛错**（故意的）：

```
[useCanvasRender] 缺少渲染上下文：请确保该组件渲染在 <CanvasHost> 之内（宿主未 provide RENDER_CONTEXT_KEY）
```

### 二、`nodeWrite`：把改动写回内核

签名（`contracts/nodeRegistryKey.ts`）：

```ts
type NodeWritePatch = Record<string, unknown> & { size?: { w: number; h: number } }
type NodeWrite = (id: string, patch: NodeWritePatch) => void
```

| 要点 | 说明 |
| --- | --- |
| 普通 key | 写进 `node.data`（标题、文本内容等） |
| 保留 key `size` | 写进**正式尺寸字段** `node.size`，**不**塞进 data |
| 为什么 size 特殊 | 卡片 resize 时 `data.cardWidth` 与 `node.size` 要在**同一个 patch** 里提交：否则一次 resize 记两条撤销记录，且两份尺寸可能不一致 |
| 谁触发历史 | 宿主内置的写回实现走 `graph.updateNode`（唯一图写入口）→ 自动进历史 + 提交落盘。插件不用自己 `save` |

```ts
// 片段：某个自定义节点的标题编辑完成
const { nodeWrite } = useCanvasRender()
nodeWrite(props.id, { label: '新标题' })                     // ① 普通字段 → node.data.label
nodeWrite(props.id, { size: { w: 320, h: 180 } })             // ② 正式尺寸 → node.size（保留 key）
nodeWrite(props.id, { cardWidth: 320, size: { w: 320, h: 180 } })  // ③ 两者同帧、同一条历史
```

### 三、能力包：`useCapabilities()` 与 `needs`

**问题**：一个挂在节点上的小组件，常常需要「这个节点是谁 / 改它的数据 / 当前缩放 / 我在不在选中集 / 调生成工具」。如果每个组件都自己 `ctx.get(...)` 拼一遍，代码会到处重复；更要紧的是**没法整体换实现**。

**做法**：宿主在 `registryOf('capability')` 里注册「标准四件 + selection」，组件在注册时声明 `needs`，然后用 `useCapabilities()` 取：

```ts
// 片段：在 ctx.nodes.attach(...) 里声明这条条目需要哪些能力
ctx.nodes.attach('image', {
  region: 'out:top',
  component: ImageTopToolbar,
  id: 'image-toolbar',
  needs: ['node', 'selected', 'tools'],     // ← 只拿得到声明过的那些
})
```

```vue
<!-- 片段：组件侧按名取（这是 packages/plugins 里各按钮组件的同一套写法） -->
<script setup lang="ts">
import { useCapabilities } from '@mini-canvas/canvas-render'

interface NodeCapability { label(): string | undefined; update(patch: Record<string, unknown>): void }
interface SelectedCapability { solo: { value: boolean } }

const caps = useCapabilities()
const node = caps['node'] as NodeCapability
const selected = caps['selected'] as SelectedCapability
</script>
```

标准能力包由宿主注册（`createStandardCapabilities`，`order: 100`），清单：

| 能力名 | 给了什么 |
| --- | --- |
| `node` | 本节点的 id / type / data（活引用）/ `label()` / `setLabel()` / `update(patch)` |
| `zoom` | 当前缩放（活引用）+ `viewport()` / `zoomIn` / `zoomOut` / `zoomTo` / `fitView` / `centerOn` |
| `selected` | `selected`（在不在选中集）与 `solo`（是不是**恰好**只选中我一个）—— 都是活引用 |
| `tools` | 生成工具：`list()` 与 `invoke(name, input, options?)` |
| `selection` | 选择集视角（不是某个节点）：`ids()` / `nodes()`，给多选框区域栏用 |

**关键性质**（源码 `contracts/capabilities.ts` 的注释逐条写了）：

- **每节点一份实例**：同一节点上两条条目（比如按钮和它打开的面板）声明同一个能力名，拿到的是**同一个实例**，状态共享；
- **热换自动重建**：主题插件放一条 `order` 更小的同名能力就顶替了它，缓存按「产出它的工厂」比对，工厂引用一变就重造（旧实例先回收）；
- **缺项裁决看 `ctx.isDev`**：dev 下**当场抛错**，prod 下 `warn` 一次并把这一格留空；
- **没声明 ≠ 没注册**：`useCapability('zoom')` 拿不到时会在 dev 提示「你这条条目的 needs 里没有 zoom」（这两类失效长得一样，是最难查的一类）。

### 四、`handleParams`：浮动端口的外观参数

`CanvasParams` 字段（`contracts/canvasParamKey.ts`）：`handleRestOffset`、`handleCursorGap`、`handleButtonSize`、`portZoneWidth`、`portZoneHeightRatio`、`portZoneOffset`、`portZoneShape`（`'rect' | 'arc'`）、`portZoneArcRatio`。

它是**响应式对象**：宿主传的是 `reactive` 引用，属性一改端口立刻变。注意后四项是可选的，但**默认壳（BaseNode）读它不做逐字段回落**，所以宿主通常传一个含全部字段的对象（`DEFAULT_HANDLE_VISUAL` 就是全字段版）。

### 五、`edgeVisual` / `edgeSelection`：自定义边要读的两格

```ts
// 片段：自定义边组件（真实写法见 packages/plugins/plugin-theme-default/src/components/edge/CustomEdge.vue）
const { edgeVisual, edgeSelection } = useCanvasRender()

// ① 外观：响应式对象，属性可改；宿主已合并过 DEFAULT_EDGE_VISUAL
const color = computed(() => edgeVisual.edgeColor ?? '#3b82f6')

// ② 选中集合：两个都是 Ref<ReadonlySet<string>>，「相连被选即高亮」靠它
const selectedNodeIds = computed(() => edgeSelection.selectedNodeIds.value)
const selectedEdgeIds = computed(() => edgeSelection.selectedEdgeIds.value)
```

`EdgeVisual` 的字段远超「颜色线宽」：`edgeType`（`bezier | straight | step | smoothstep`）、`edgeLineWidth`、`edgeColor`、`edgeDashed`、`edgeMarkerEnd`、`edgeMarkerSize`、`edgeVisible`、`edgeVisibleOnSelect`、`edgeOnTop`、`edgeGlowEnabled/Intensity/Color`，以及新视觉那组 `edgeFlowEnabled` / `edgeFlowCount` / `edgeFlowRatio` / `edgeFlowSpeed` / `edgeFlowFade` / `edgeFlowIntensity`（导轨 + 光斑流动）。

### 六、`debug` 与 `snapZone`

```ts
const { debug, snapZone } = useCanvasRender()
debug.handleDebug                  // 端口调试：画半圆区 / 圆心 / rest 点 / 当前鼠标点
debug.connectionSnapDebugVisible   // 吸附调试：把目标节点的吸附带与 body 反馈区画出来
snapZone                           // 吸附带几何配置（高占节点比例 / 宽 / 偏移 / 形状）
```

两者默认都在宿主侧有「默认开/关」值（`DEFAULT_DEBUG_VISUAL` 两项都 `true`：方便设计/排错时直接看到端口几何与吸附范围），宿主可以传响应式对象实时开关。

### 七、区域条目宿主 `RegionEntryHost`（能力包的 provide 点）

`RegionEntryHost` 是**一条区域条目**的渲染壳：它按这条条目的 `needs` 取出能力包，`provide` 给子树，然后渲染 `entry.component`（**不加任何多余 DOM** —— 渲染结果就是组件本身）。

它有两个 prop 设计得很讲究：

| prop | 说明 |
| --- | --- |
| `entry` | 这条区域条目（带 `needs` / `props`） |
| `cache` | **本节点那份**能力实例缓存（由节点壳持有，节点卸载时统一 `dispose`） |
| `nodeId` / `data` | 下发给条目组件的 props；**可缺省** —— 多选框（选择集）也复用这套机制，但它没有「某一个节点」 |
| `isDev` | 让提示分 dev / prod |

### 八、content 组件的真实写法（完整可抄）

这一节是重点。content 组件就是「节点肚子里那块内容」的组件，它由节点壳（如 `BaseNode`）按 `type` 路由渲染，**壳统一给它注入 `:id` 与 `:data` 两个 props**。

#### 目录长这样

```
plugin-note-demo/
├── package.json            # 插件清单
└── src/
    ├── index.ts            # 插件入口：注册节点类型 + content 组件
    └── NoteContent.vue     # content 组件：展示 + 编辑，写回走 nodeWrite / 服务
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/canvas-render/render-context/`。

#### 文件一：清单

```json
// 文件：plugin-note-demo/package.json
// 格式：JSON（npm 包清单）
// 位置：插件包根目录
{
  "name": "plugin-note-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "便签节点",
    "description": "演示 content 组件的写法：props 收数据、nodeWrite 写回",
    "pluginName": "note-demo",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "dependencies": { "@mini-canvas/canvas-base": "workspace:*" },
  "peerDependencies": { "@mini-canvas/canvas-render": "workspace:*", "vue": "^3.5.34" }
}
```

#### 文件二：插件入口

```ts
// 文件：plugin-note-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import NoteContent from './NoteContent.vue'

export const name = 'note-demo'
export const inject = ['doc'] as string[]   // ① 建节点要写图，硬依赖 doc

/** 本节点要声明给画布的形状（尺寸、端口、是否可 resize） */
const NOTE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h14v12l-4 4H5z"/></svg>'

export function apply(ctx: Context): void {
  ctx.nodes.register({
    type: 'note',                                     // ② 节点类型名（数据里的 type）
    label: '便签',
    icon: NOTE_ICON,
    size: { w: 260, h: 160 },                         // ③ 类型默认尺寸（没实测、没 node.size 时的兜底）
    resizable: true,                                  // ④ 声明支持 resize → 壳显示右下拖柄
    in: NoteContent,                                  // ⑤ 【关键】content 组件：挂到区域词 in
    create(position) {                                // ⑥ 建节点：走 doc.transaction（自动进历史 + 落盘）
      return ctx.get<{ transaction<T>(name: string, fn: (tx: { createNode(t: string, p: { x: number; y: number }, data: Record<string, unknown>): string }) => T): T }>('doc')
        .transaction('add-note', (tx) => tx.createNode('note', position, { text: '双击编辑' }))
    },
  })
  // ⑦ 不用写清理：注册随本插件作用域自动回收（卸载即摘）
}

/** 兼容旧装配的 PluginModule 出口 */
export const noteDemoPlugin: PluginModule = { name, inject, apply }
```

#### 文件三：content 组件

```vue
<!-- 文件：plugin-note-demo/src/NoteContent.vue
     格式：Vue 单文件组件（节点 content 组件，被节点壳按 type 路由渲染）
     位置：插件包内部；它只知道「我是某个节点的内容」，不知道壳是谁 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

// ① 壳注进来的两个 props：id 与 data（响应式对象引用）
const props = defineProps<{ id: string; data: { text?: string } }>()

// ② 写回回调 + 只读数据源：都从渲染上下文来
const { nodeWrite, flow } = useCanvasRender()

// ③ 本地展示值：初值来自 props.data，外部改（撤销/重做/AI 写回）时跟着变
const shown = ref(props.data.text ?? '')
watch(() => props.data.text, (next) => { shown.value = typeof next === 'string' ? next : '' })

// ④ 编辑态：本地草稿，失焦提交（避免每敲一个字就写一次历史）
const editing = ref(false)
const draft = ref('')
function startEdit() { draft.value = shown.value; editing.value = true }
function commit() {
  editing.value = false
  if (draft.value === shown.value) return
  shown.value = draft.value
  nodeWrite(props.id, { text: draft.value })   // ⑤ 写回：宿主内置实现 → graph.updateNode → 历史 + 落盘
}

// ⑥ 缩放：flow.viewport 是响应式 Ref，缩到很小的时候换 LOD 渲染
const zoom = computed(() => Math.max(flow.viewport.value?.zoom ?? 1, 0.01))
const tooSmall = computed(() => zoom.value < 0.18)
</script>

<template>
  <div class="note">
    <!-- ⑦ LOD：太小就只画灰条，省重绘 -->
    <div v-if="tooSmall" class="note-skel" />

    <textarea
      v-else-if="editing"
      v-model="draft"
      class="note-editor nowheel nodrag nopan"
      aria-label="便签内容"
      @blur="commit"
      @wheel.stop
      @mousedown.stop
    />

    <div v-else class="note-preview" title="双击编辑" @dblclick.stop="startEdit">
      {{ shown || '（空）' }}
    </div>
  </div>
</template>

<style scoped>
.note { box-sizing: border-box; width: 100%; height: 100%; padding: 12px; overflow: hidden; }
.note-preview { width: 100%; height: 100%; white-space: pre-wrap; overflow: hidden; cursor: text; }
.note-editor {
  display: block; box-sizing: border-box; width: 100%; height: 100%;
  padding: 0; border: none; outline: none; background: transparent; resize: none;
  font: inherit; overflow-y: auto;
}
.note-skel { width: 100%; height: 100%; background: var(--canvas-node-surface, rgba(0, 0, 0, 0.04)); }
</style>
```

#### 三个必须记住的细节

| 细节 | 为什么 |
| --- | --- |
| `@dblclick.stop` / `@mousedown.stop` | 不 `stop`，双击会被画布当成「缩放」，按住拖会被当成「拖节点」 |
| `class="nowheel"`（编辑态） | VueFlow 的缩放手势会**跳过** `.nowheel` 子树；另外自己再 `@wheel.stop` 兜底（事件已在冒泡路径上被截住） |
| **不要自己画 Handle** | 端口由节点壳统一提供（它知道类型声明的 inputs/outputs）；content 只管内容 |

### 九、老服务名 / 老令牌对照

| 你可能在老文档里看到 | 现在怎么写 |
| --- | --- |
| `inject(NODE_WRITE_KEY)` | `useCanvasRender().nodeWrite` |
| `inject(NODE_REGISTRY_KEY)` | `useCanvasRender().registry` |
| `inject(CANVAS_PARAMS_KEY)` | `useCanvasRender().handleParams` |
| `inject(EDGE_VISUAL_KEY)` / `EDGE_SELECTION_KEY` | `useCanvasRender().edgeVisual` / `.edgeSelection` |
| `inject(HOST_KEY)` | `useCanvasRender().host` / `.ctx` |
| `ctx.get('nodeStore')` / `'graph'` / `'history'` | 都并进了 `doc`（那四个实例仍在 `host` 上，但不再是服务名） |

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/plugins/plugin-node-text/src/TextContent.vue` | 最典型的 content 组件：LOD 渲染 + 双击编辑 + `nodeWrite` 写回 |
| `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue` | 节点壳：用 `registry` 解析 content 段，用 `nodeWrite` 提交尺寸，读 `connectionState` / `interaction` |
| `packages/plugins/plugin-theme-default/src/components/edge/CustomEdge.vue` | 自定义边：读 `edgeVisual` / `edgeSelection` / `connectionState` |
| `packages/plugins/plugin-mini-map/src/MiniMapOverlay.vue` | 读 `renderNodes` + `flow` 画小地图 |
| `packages/plugins/plugin-align-guide/src/AlignGuideOverlay.vue` | 用 `interaction.isNodeDragging` 当门 + `visibleNodes` 裁剪候选 |
| `packages/canvas-render/src/components/RegionEntryHost.vue` | 能力包的 provide 点（每条区域条目一层） |
| `packages/canvas-render/src/contracts/capabilities.ts` | `useCapabilities` / `useCapability` / `createCapabilityCache` / `provideCapabilityBag` |

## 常见坑

1. **在 `CanvasHost` 之外调用 `useCanvasRender()` 会抛错**。宿主自己的业务 UI 要放进 `<template #ui>`；纯逻辑代码（不需要 Vue）请直接用 `ctx`（例如从 `host.ctx` 拿）。
2. **`props.data` 是响应式引用，但「写」不该直接改它**。直接 `props.data.text = 'x'` 会绕过唯一图写入口：不进历史、不落盘、别的订阅者也不知道。写一律走 `nodeWrite` 或 `ctx.get('服务')`。
3. **能力包只在区域子树内拿得到**。`useCapabilities()` 在「画布级浮层」（`ctx.slots.register('overlay', …)` 挂上去的组件）里返回 `{}`，dev 下会 warn 一次说明原因。浮层要数据就 `ctx.get(...)` 直接取服务。
4. **忘写 `needs` 会静默拿到 `undefined`**。`useCapability('zoom')` 在 dev 会提示「这条条目的 needs 里没有 zoom」；prod 只 warn。所以「我明明注册了能力却拿不到」先看两处：`needs` 写了没、能力名拼对没。
5. **`handleVisual` 要含全部字段**。默认壳读 `portZone*` 时**逐字段取用不做回落** —— 只传一半字段会让另一半变成 `undefined`，端口几何直接算错。要覆盖就传一个完整的 `reactive` 对象（照抄 `DEFAULT_HANDLE_VISUAL`）。
6. **`canvas:node:drag` 这类事件的坐标一律是 flow 绝对坐标**。分组子节点在 VueFlow 内部存的是**相对父**的位置，宿主已经统一归一化（`toDragPayload` 优先取 `computedPosition`）。你若自己从 VueFlow 拿 `position` 去算几何，多选/分组场景会算偏。
