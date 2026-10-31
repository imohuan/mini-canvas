
# CanvasHost / CanvasSurface / canvasHostCore

**一句话定位**：**`<CanvasHost>` 是「一行渲染出完整画布」的官方宿主组件；`CanvasSurface` 是它里层的渲染子树宿主（负责 provide 渲染上下文）；`canvasHostCore.ts` 是这两个组件背后的纯逻辑（数据 → 画面 的翻译规则）。**

**它属于哪一档**：**渲染层的三个入口件**。源码：packages/canvas-render/src/host/CanvasHost.vue、host/CanvasSurface.vue、host/canvasHostCore.ts。

## 它是什么

三份文件的分工很干净，记住这个比喻就够了：

| 文件 | 比喻 | 真正管什么 |
| --- | --- | --- |
| CanvasHost.vue | **总调度** | 建宿主、订阅数据、装配主题、接住交互、落盘、把内容安排给内层 |
| CanvasSurface.vue | **发放窗口** | 等 boot 完成后才挂载，把「渲染上下文」provide 给子树；真正渲染 `<VueFlow>` |
| canvasHostCore.ts | **翻译手册** | 把节点/边翻译成 VueFlow 认的形状；根据主题槽算出「每个类型用哪个壳」（纯函数，可单测） |

为什么要把 CanvasSurface 单独拆出来？因为 CanvasHost 在自己的 setup 期就得 provide —— 可那时内核还没建好，只能 provide 一个「盒子」（Ref），消费方拿到后还得 .value 再判空。CanvasSurface 只会在 **boot 完成后**（模板里 v-else）挂载，它 setup 的时候 props.host 已经就绪，于是它能 provide **裸 ctx / 裸 host**：消费方写 useCanvasRender().ctx.get('doc')，零 .value、零判空。

## 为什么需要它

在它之前，每个 demo 都自己手写一套约 340 行的装配：provide 一堆令牌、自己 mount VueFlow、自己把 store 变化映射成 nodes / edges 数组、自己处理删边 / 撤销 / 选中…… 十份 demo 就有十份同源但不一样（也各自不一样地漏）的实现。

具体会坏在哪：

- **数据同步漏了**：插件改完 store，画面不跟着变，用户以为「操作没生效」。
- **主题换不回来**：热卸了主题插件，节点壳还停在被替换的状态。
- **卸载不干净**：Vue 组件卸载了，但 window 上的键盘监听、store 订阅、VueFlow 内部状态还在。

CanvasHost 把这些收进一个组件，并给了三条硬保证：**数据一变画面就变**、**插件装卸画面自动重挂**、**卸载时全部回收**。

## 怎么用

### CanvasHost 的 props

源码：packages/canvas-render/src/host/CanvasHost.vue 的 defineProps。

| prop | 类型 | 缺省 | 干什么 |
| --- | --- | --- | --- |
| plugins | (PluginModule \| PluginClassLike)[] | 必填 | 冷启动插件，**顺序即装载顺序**。宿主负责给全：主题 + 业务节点 |
| manifest | PluginManifest | 无 | 装配清单冷启动；**与 plugins 二选一，给则走 manifest**（停用项 / 配置覆盖 / 同 id 换版本生效） |
| adapter | StorageAdapter | 内部建内存 adapter | 存储后端。想要刷新还在就传 LocalStorageAdapter |
| seed | () => CanvasNode[] | 无 | 首次（存储为空）生成默认画布 |
| nodeWrite | NodeWrite | 内置实现 | 覆盖「标题就地重命名 / 卡片 resize」的写回。缺省 = 改 store 的 data / size 并落盘 |
| edgeVisual | `Partial<EdgeVisual>` | DEFAULT_EDGE_VISUAL | 边外观覆盖。**传响应式对象**可实时生效 |
| handleVisual | CanvasParams | DEFAULT_HANDLE_VISUAL | 浮动端口尺寸覆盖。**要传含全部字段的响应式对象**（BaseNode 读它不做逐字段回落） |
| debugVisual | CanvasDebug | DEFAULT_DEBUG_VISUAL | 调试可视化开关（端口调试 / 吸附调试） |
| snapZoneVisual | SnapZoneConfig | DEFAULT_SNAP_ZONE_CONFIG | 吸附带配置（高占节点比例 / 宽 / 偏移 / 形状） |
| windowKey | string | 无（不挂） | 挂到 window 的调试 key（如 MiniCanvasUI） |
| persistViewport | boolean | true | 是否把视口（zoom + 平移）也落盘并在下次启动恢复 |
| dev | boolean | false | 落到 ctx.isDev：能力缺项 dev 抛错 / prod 只 warn。**必须由宿主显式传**（见坑 4） |

外观类 props 的用法（成品应用的真实写法，见 packages/ui/src/App.vue）：

```vue
<!-- 片段：外观参数从应用状态里取，改属性画布实时跟着变
     格式：Vue 单文件组件模板
     位置：应用层组件（在 CanvasHost 外面） -->
<CanvasHost
  :plugins="plugins"
  :adapter="adapter"
  :seed="seedDefaultCanvas"
  :edge-visual="ui.cfg.edge"
  :handle-visual="ui.cfg.handle"
  :debug-visual="ui.cfg.debug"
  :snap-zone-visual="ui.cfg.snapZone"
  :dev="DEV"
  window-key="MiniCanvasUI"
  @ready="onCanvasReady"
/>
```

### CanvasHost 的 emits
| 事件 | payload | 什么时候发 | 你该做什么 |
| --- | --- | --- | --- |
| context-menu | `{ kind: 'node' \| 'pane' \| 'edge', clientX, clientY, nodeId?, edgeId? }` | 用户在节点 / 空白 / 连线上点右键（内部已 preventDefault） | 弹你自己的业务菜单 |
| ready | `CanvasHostHandle` | 宿主就绪（boot 成功） | 存下 `host`，开始驱动业务（读 nodeStore、执行命令…） |
| boot-error | `Error` | boot 失败 | 显示错误；此时模板渲染的是错误文案 |
| plugin-issue | `{ name, lifecycle }` | **运行期**某插件装载失败（内核 `ctx:lifecycle-change` 报 error 时转发） | 提示用户「某插件坏了」，但画布本身照常用 |


### CanvasHost 暴露给父级的东西

它**不内置任何业务工具栏 / 右键菜单**（那是应用层的事），所以把内部状态经 defineExpose 摊出来：

```ts
// 片段：父级用 ref 拿宿主组件实例
const canvas = ref()
canvas.value.host          // CanvasHostHandle | undefined（boot 前是 undefined）
canvas.value.api           // MiniCanvasApi | undefined
canvas.value.manager       // PluginManager | undefined（统一安装句柄）
canvas.value.ready         // boolean：!booting && !bootError
canvas.value.bootErrorText // string：启动失败原因
```

### 模板结构（决定了你的 UI 该放哪）

```text
CanvasHost 渲染出来的结构（缩进代表示层级）：

<div class="chost">                    ← 占满父容器，自己 flex 竖排
  ├─ booting   : 「正在启动内核…」
  ├─ bootError : 「启动失败：…」
  └─ .chost-canvas                     ← boot 成功后才有
       └─ <CanvasSurface>
            ├─ <VueFlow>               ← 真正画布
            │     ├─ 主题背景组件（垫在节点之下）
            │     ├─ #connection-line → ConnectionLineHost（拖线临时线）
            │     └─ <slot />          ← 默认插槽：父级往 VueFlow 里塞东西
            ├─ .csurface-overlay → <SlotHost slot="overlay" />   画布级浮层
            └─ <slot name="ui" />      ★ 你的业务 UI 放这里
```

**两条插槽怎么选**：

- `<template #ui>`：宿主业务 UI（工具栏、设置面板、小地图定位容器、右键菜单…）。它在渲染子树**内**，所以里面的组件能 useCanvasRender() 读到 ctx。
- 默认插槽：会被塞进 `<VueFlow>` 内部（想加画布内的自定义背景 / 控件时用）。

```vue
<!-- 文件：src/App.vue（节选，真实可参照 packages/ui/src/App.vue）
     格式：Vue 单文件组件
     位置：应用层 —— 用 #ui 插槽挂业务 UI，用 @ready 接住宿主 -->
<script setup lang="ts">
import { CanvasHost, SettingsHost, SlotHost } from '@mini-canvas/canvas-render'
import { APP_PLUGINS, createDefaultStorageAdapter, seedDefaultCanvas } from './assembly'
import { ref } from 'vue'

const settingsOpen = ref(false)
const adapter = createDefaultStorageAdapter()

function onCanvasReady(host: unknown) {
  // ① 宿主就绪：可以驱动业务了（示例只把句柄打出来）
  console.log('画布就绪', host)
}
</script>

<template>
  <div style="width: 100vw; height: 100vh">
    <CanvasHost
      :plugins="APP_PLUGINS"
      :adapter="adapter"
      :seed="seedDefaultCanvas"
      :dev="import.meta.env.DEV"
      window-key="MiniCanvasUI"
      @ready="onCanvasReady"
    >
      <!-- ② 业务 UI 放 #ui：这里在渲染子树内，组件拿得到 ctx -->
      <template #ui>
        <SettingsHost v-if="settingsOpen" />
        <SlotHost slot="mini-map" />
      </template>
    </CanvasHost>
  </div>
</template>
```

### CanvasSurface 的职责与 props

CanvasSurface 是 CanvasHost 的**内层**组件，它只做四件事：**接住 props → provide 裸渲染上下文 → 渲染 VueFlow → 转发交互回调**。官方不推荐你直接用它（CanvasHost 已经装好了），但自己接一套外层逻辑时可以：

| prop 分组 | 有哪些 |
| --- | --- |
| 宿主与数据 | host、registry、nodes、edges、nodeTypes、edgeTypes、backgroundComp、connectionLineComp |
| 写回与外观 | nodeWrite、handleParams、edgeVisual、debugVisual、snapZone、edgeSelection |
| 交互状态 | connectionState、interaction、dragFlowPoint、interactionSettings |
| 生命周期 | nodeEpoch（一变 → VueFlow 整树重挂）、isValidConnection |
| 回调 | onConnect、onConnectStart、onConnectEnd、onNodeClick、onEdgeClick、onNodeDrag、onNodeDragStart、onNodeDragStop、onMoveStart、onMoveEnd、onPaneClick、onNodeContextMenu、onEdgeContextMenu、onPaneContextMenu、validateEdge |

它对外**提供**的那个「渲染上下文」就是 CanvasRenderContext（useCanvasRender() 的返回值），字段一览：

| 字段 | 是什么 |
| --- | --- |
| ctx | 裸内核上下文（boot 后，可直接 ctx.get('doc')） |
| host | 裸宿主句柄（ctx 的超集：save / nodeStore / selection / stop() …） |
| flow | 有就绪状态的画布能力面（视口读写、坐标换算、DOM 锚点、节点视觉写） |
| registry | 节点展示注册表（content 与各区域段组件） |
| nodeWrite | 节点数据 / 尺寸写回回调 |
| handleParams / edgeVisual | 浮动端口外观 / 边外观（**响应式，改属性实时生效**） |
| edgeSelection | 选中集合（含 Ref，供「相连被选即高亮」追踪） |
| connectionState | 拖线过程反馈（悬停 / 合法目标 / 压端口） |
| interaction | 画布交互状态（拖节点 / pan / 缩放 / 框选 / resize） |
| debug / snapZone | 调试开关 / 吸附带配置 |
| renderNodes / renderEdges | 当前渲染态的只读快照 |
| visibleRect / visibleNodes(margin?) | 可视区矩形 / 可视区内（或外扩）的节点矩形 |

它挂载时还会做三件接后端的事（都在 onMounted 里）：

1. 捕获本实例的 DOM 锚点（pane / renderer / 根元素）—— **在本实例根内查询**，多画布页面不串线；
2. 把 VueFlow 能力 attachBackend 给 view 服务（ctx.get('view') 的视口部分从此真正能动）；
3. 把同一份能力 attachFlow / attachDom 给 flow 能力面（useCanvasRender().flow）。

### canvasHostCore.ts 的纯函数

这份文件**不 import Vue 运行时、也不 import VueFlow**（类型用最小结构接口），所以能脱离 DOM 单测（host/__tests__/canvasHostCore.test.ts）。

| 导出 | 签名 | 干什么 |
| --- | --- | --- |
| nodesFromStore | `(store: NodeStoreService, selectedIds?: ReadonlySet<string>): FlowNode[]` | 把节点灌成 VueFlow 数组（data **浅拷贝**，避免共享引用被 Vue 改写污染内核） |
| edgesFromStore | `(edges, aliveNodeIds: ReadonlySet<string>): FlowEdge[]` | 把边灌成数组，顺带**滤掉端点已不存在的悬挂边**；保留 sourceHandle / targetHandle |
| pruneDanglingEdges | (edges, aliveNodeIds): T[] | 同上但更泛型的一版（只要带 source / target） |
| assembleTheme | (theme, storeTypes, shellField?): ThemeAssembly | 读主题槽 + node/shell 场，算出「每个类型用哪个壳」 |
| nodeShellSlot | `(type: string): string` | 某类型的「专属壳」槽名：`nodeShell:<type>` |
| splitNodeWritePatch | (patch: NodeWritePatch): { data, size? } | 把写回 patch 拆成 data 与正式尺寸两路（保留 key 是 size） |
| hitNodeIdAt | (point, rects): string \| null | 松手点是否落在某张卡片上（几何命中，不用 elementFromPoint） |
| DEFAULT_EDGE_VISUAL / DEFAULT_HANDLE_VISUAL / DEFAULT_DEBUG_VISUAL | 常量 | 宿主没传外观参数时的回落值 |
| NODE_Z / NODE_SELECTED_Z | 10 / 20 | 普通节点 / 选中节点的渲染层级（见 [画布层级 z-index](/canvas-render/z-index)） |

**assembleTheme 的解析顺序**（四级，自上而下第一个命中的赢）：

```text
① 场 node/shell/<type>      精确：某一类节点的壳（作者显式 opt-in）
② 场 node/shell/*           通配：一次性换掉所有节点的壳
③ theme 槽 nodeShell:<type> 某类型自带的壳
④ theme 槽 nodeShell        全局默认壳（例如 BaseNode 那层）
```

为什么把「场」排在「槽」前面：场**语义更窄、更是显式 opt-in**（作者在说「我就要这个」），槽是「默认皮」。这样特殊形态的节点由它自己的插件负责长相，默认壳不需要任何针对它的分支。

```ts
// 片段：手动调纯函数（测试 / 自定义宿主用；官方宿主已在内部调好）
import { edgesFromStore, nodesFromStore, assembleTheme } from '@mini-canvas/canvas-render'

const alive = new Set(host.nodeStore.getNodes().map((n) => n.id))
const flowNodes = nodesFromStore(host.nodeStore, host.selection.ids)        // ① 带上选中标记
const flowEdges = edgesFromStore(host.edgeStore.getEdges(), alive)           // ② 自动滤悬挂边
const asm = assembleTheme(host.themeRegistry, host.nodeStore.types.keys())   // ③ 主题装配
asm.nodeShells['text']   // → 文本类型最终使用的壳组件（undefined = 用默认壳）
```

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| packages/ui/src/App.vue | 成品应用一行 `<CanvasHost :plugins="APP_PLUGINS" …>`，`#ui` 插槽里放 SettingsHost / AgentPanel / 小地图容器 |
| packages/canvas-render/src/host/CanvasHost.vue | 引用 nodesFromStore / edgesFromStore / assembleTheme / splitNodeWritePatch / DEFAULT_* |
| packages/canvas-render/src/host/__tests__/canvasHostCore.test.ts | 纯函数的单测（层级断言、写回拆分、悬挂边过滤都在这里） |
| packages/canvas-render/src/host/__tests__/canvasBaseHost.test.ts | 宿主装配行为测试（主题换壳、写回、数据同步） |
| packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue | 壳组件：消费渲染上下文的 registry / nodeWrite / handleParams / connectionState / interaction |

## 完整例子

一个自己接 CanvasHost 的小应用，把「host 句柄 + 命令 + 外观 props + #ui 插槽」四件事一次走完。

### 目录长这样

```text
canvas-host-demo/
├── index.html          # 挂载点（#app）
├── package.json        # 依赖 vue / canvas-render / 两个插件包
└── src/
    ├── main.ts         # createApp(App).mount('#app')
    ├── App.vue         # 一行 CanvasHost + 顶部三个按钮（加节点 / 撤销 / 换连线颜色）
    └── uiState.ts      # 那几个外观参数（响应式对象）
```

同样的文件在仓库里也放了一份，可直接打开对照：packages/docs/public/examples/canvas-render/canvas-host/。

### 文件一：外观参数

```ts
// 文件：canvas-host-demo/src/uiState.ts
// 格式：TypeScript 模块（导出响应式对象）
// 位置：外观参数的唯一住址；交给 CanvasHost 后改属性即实时生效
import { reactive } from 'vue'
import type { CanvasParams, EdgeVisual } from '@mini-canvas/canvas-render'

// ① 边外观：Partial 即可，没给的字段用宿主默认值
export const edge: Partial<EdgeVisual> = reactive({
  edgeColor: '#3b82f6',
  edgeLineWidth: 2,
  edgeOnTop: false,        // 关掉「连线显示在最上层」
})

// ② 浮动端口：必须是**含全部字段**的对象（BaseNode 读它不做逐字段回落）
export const handle: CanvasParams = reactive({
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 10,
  portZoneHeightRatio: 0.55,
  portZoneOffset: 0,
  portZoneShape: 'arc',
  portZoneArcRatio: 0.8,
})
```

### 文件二：应用组件

```vue
<!-- 文件：canvas-host-demo/src/App.vue
     格式：Vue 单文件组件
     位置：应用装配层 —— 挂画布 + 用 @ready 拿到的句柄驱动业务 -->
<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import { CanvasHost, type CanvasHostHandle } from '@mini-canvas/canvas-render'
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { edge, handle } from './uiState'

// ① 装配清单：顺序即装载顺序（皮在前，业务节点在后）
const plugins = [themeDefaultPlugin, nodeTextPlugin]
const adapter = new LocalStorageAdapter()   // 刷新后画布还在

// ② 宿主句柄：@ready 之后才有值，所以用 shallowRef（组件句柄不该深代理）
const host = shallowRef<CanvasHostHandle | undefined>()
const canvas = ref<{ manager?: { list(): Array<{ name: string }> } } | null>(null)

function onReady(h: CanvasHostHandle) {
  host.value = h
  // ③ 顺手把「装了哪些插件」打到控制台，验证装配顺序
  console.log('已装插件：', h.ctx.listPlugins())
}

function addText() {
  // ④ 走命令（等价于快捷键 / 右键菜单那条公共入口）
  host.value?.command.execute('command:create-node', {
    type: 'text',
    position: { x: 260, y: 200 },
  })
}

function undo() {
  host.value?.command.execute('command:undo')
}

function toggleEdgeColor() {
  // ⑤ 改响应式外观对象 → 画布上连线立刻变色（不用重建宿主）
  edge.edgeColor = edge.edgeColor === '#3b82f6' ? '#16a34a' : '#3b82f6'
}
</script>

<template>
  <div style="width: 100vw; height: 100vh">
    <CanvasHost
      ref="canvas"
      :plugins="plugins"
      :adapter="adapter"
      :edge-visual="edge"
      :handle-visual="handle"
      :dev="import.meta.env.DEV"
      window-key="MiniCanvasHostDemo"
      @ready="onReady"
      @plugin-issue="(p) => console.warn('插件出问题了：', p.name, p.lifecycle)"
    >
      <!-- ⑥ 业务 UI 放 #ui 里：这里的组件能 useCanvasRender() 读 ctx -->
      <template #ui>
        <div class="demo-bar">
          <button @click="addText">加文本节点</button>
          <button @click="undo">撤销</button>
          <button @click="toggleEdgeColor">换连线颜色</button>
        </div>
      </template>
    </CanvasHost>
  </div>
</template>

<style scoped>
/* 浮在画布左上角的一条小工具条：定位自己负责，CanvasHost 不提供布局 */
.demo-bar { position: absolute; left: 12px; top: 12px; display: flex; gap: 6px; z-index: 30; }
.demo-bar button { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--ui-line, #e2e5ea); cursor: pointer; }
</style>
```

### 文件三：入口

```ts
// 文件：canvas-host-demo/src/main.ts
// 格式：TypeScript 模块（应用入口）
// 位置：把应用挂到页面上；VueFlow 的两份样式必须由宿主自己引（本包刻意不 import CSS）
import { createApp } from 'vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import App from './App.vue'

createApp(App).mount('#app')
```

### 怎么验证跑起来了

1. 起开发服务打开页面：应看到一张空画布（这个例子没传 seed）。
2. 点「加文本节点」：画布上出现一个文本节点（走 command:create-node）。
3. 点「撤销」：节点消失（命令走的是 graph.undo()，一次操作一条历史）。
4. 点「换连线颜色」：从节点圆点拖出一条连线，颜色跟着按钮变（响应式外观对象生效）。
5. 控制台敲 MiniCanvasHostDemo.listPlugins()：应看到 ['theme-default', 'text']（不含被隐藏的 canvas-base）。

## 常见坑

1. **`useCanvasRender()` 扔在 `CanvasHost` 外面会抛错**。它找的是 `RENDER_CONTEXT_KEY`，只有 `CanvasSurface`（boot 后）才 provide。所以业务 UI 必须放在 `<template #ui>` 里，不能在外层随便挑个地方。
2. **nodeEpoch 会让 VueFlow 整棵树重挂，所以 DOM 锚点必须跟着重捕获**。插件装 / 卸 → 重装配 → bump epoch → pane 变成一个新的 DOM 元素；CanvasSurface 里专门有一段 refreshFlowDom() 处理这件事。若你只在自己写的组件里 onMounted 抓一次 .vue-flow__pane，热装插件后就会绑在一棵**已经不在文档里的旧 DOM** 上（现象：框选 / 移动类交互完全不响应）。
3. **nodeWrite 里 size 是保留 key**。卡片 resize 要写进内核的**正式尺寸字段** node.size（不是塞进 data），并且要和 data 的改动在**同一次 graph.updateNode** 里提交 —— 否则一次 resize 会记两条撤销记录，且两份尺寸可能不一致。splitNodeWritePatch 就是干这个拆分的。
4. **props.dev 必须显式传**。canvas-render 是独立 workspace 包，在它自己的 .vue 里读 import.meta.env.DEV 拿到的是 undefined（打包器的替换只作用于应用包自己的源码），于是 dev 判定会静默失效。成品应用是在 App.vue 里传 :dev="import.meta.env.DEV"。
5. **assembleTheme 要连孤儿类型一起传**。宿主调它时传的是 [...nodeStore.types.keys(), ...nodeStore.orphanTypes()]：第二项不能省 —— 孤儿类型（有存量节点但类型已注销）也映射到默认壳，于是卸载插件后节点仍在画布上占位（数据不丢），插件重装后自动恢复。
6. **CanvasHost 不做业务**。它不内置工具栏、不内置右键菜单、不决定「点空白要建什么节点」。想在空白处双击建节点，那是**你的应用层**（或插件）的事 —— 它只负责把 context-menu 事件与 RenderEvents 广播出来。
