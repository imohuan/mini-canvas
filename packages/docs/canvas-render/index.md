
# 渲染层

**一句话定位**：**@mini-canvas/canvas-render 是「把数据层的数据画到屏幕上」的那一层 —— 它既渲染画布，又是整套插件系统的装配入口。**

**它属于哪一档**：三个包里的**渲染层**。依赖方向是单向的：`kernel ← canvas-data ← canvas-render ← plugins`。它上面是插件（`packages/plugins/*`），下面是数据层与内核；它自己**不定义任何画布数据**，只把数据层的节点/边翻译成 Vue 与 VueFlow 认的格式，再把画布画出来。

源码：`packages/canvas-render/src/`（本篇按 `src/index.ts` 的导出逐类清点）。

## 它是什么

把三层分工摆在一起，就知道这一层该管什么：

| 包 | 一句话 | 它管什么 |
| --- | --- | --- |
| `@mini-canvas/kernel` | 纯插件框架 | 装插件、排依赖、发事件、回收副作用、注册场。**零画布概念、零 Vue** |
| `@mini-canvas/canvas-data` | 数据 + 画布语义 | 节点/边数据、撤销历史、选中、落盘、连接校验、数据契约与上游遍历。**零 Vue** |
| **`@mini-canvas/canvas-render`（本包）** | **渲染层 + 装配入口** | 建宿主、把数据翻译成屏幕上的图形、给插件发「渲染上下文」、装配插件 |
| `packages/plugins/*` | 插件 | 真正的内容与外观：文本节点、图片节点、默认皮肤…… |

类比：数据层是**剧本**（谁在哪儿、谁和谁连着），渲染层是**舞台与灯光**（把剧本变成看得见的画面），插件是**演员**（谁演什么由插件决定）。剧本改了舞台不一定重搭，但舞台上的一切都必须从剧本里来。

## 为什么需要它

没有这一层，每写一个画布应用，你都要自己干三件重复的活。

**第一件：把数据翻译成图形。** 数据层里一个节点是 `{ id, type, position, data }`；VueFlow 要的是另一套形状（节点数组 + 边数组 + `node-types`/`edge-types` 组件表 + 一堆交互开关）。少了这层翻译，每个宿主都得手写一遍。

**第二件：把内核能力递给插件组件。** 插件里的 `.vue` 组件要读 ctx、要写回节点数据、要知道当前选中了什么 —— 这些都得有人 `provide` 出来。没人做，插件组件就只能靠全局变量。

**第三件：提供数据层给不了的两样东西。** 有两个服务**只有摸 DOM 才做得出来**：

- `nodeLayout`：节点在屏幕上的**真实尺寸**（要把 DOM 量出来）。数据层只知道「我声明我 300×200」。
- `viewport`：画布的缩放与平移（要挂上 VueFlow 的绘图后端才能动）。

所以这一层的手艺就四样：**建宿主 → 翻译数据 → 发放上下文 → 装配插件**。

## 怎么用：两大入口

`src/index.ts` 给两个入口，按场景挑一个：

| 入口 | 形态 | 什么时候用 |
| --- | --- | --- |
| `CanvasHost` | Vue 组件 | 你的项目本来就是 Vue。一行渲染出完整画布（含插件装配、上下文、交互、落盘） |
| `createMiniCanvasHost()` | 异步函数 | 不在 Vue 里（Node 测试、自己手写渲染），或者你要拿宿主句柄自己驱动数据 |

两个入口的关系：**`CanvasHost` 内部就是调 `createMiniCanvasHost()`**。所以「用哪个」其实是在问「要不要顺手把画面也给我画好」。

```vue
<!-- 文件：你的应用里的某个页面组件（例如 src/CanvasPage.vue）
     格式：Vue 单文件组件（声明式路线）
     位置：告诉它装哪些插件，剩下的它全包 -->
<script setup lang="ts">
import { CanvasHost } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'

// ① 顺序即装载顺序：先装「皮」（它提供节点壳/边/背景），再装业务节点
const plugins = [themeDefaultPlugin, nodeTextPlugin]
</script>

<template>
  <!-- ② CanvasHost 自己不吃尺寸，铺满谁由父容器决定 -->
  <div style="width: 100vw; height: 100vh">
    <CanvasHost :plugins="plugins" window-key="MiniCanvas" />
  </div>
</template>
```

```ts
// 文件：scripts/build-graph.ts
// 格式：TypeScript 模块（Node 环境直接跑）
// 位置：命令式路线 —— 不要画面，只要宿主句柄，自己建节点/存盘
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'

const { host, api, exposeToWindow } = await createMiniCanvasHost({
  coldPlugins: [nodeTextPlugin],   // ① 冷启动清单：不传就一个插件都不装
  dev: true,                       // ② 开发态：能力缺项当场抛错，而不是静默 undefined
})

// ③ 宿主句柄上的服务直接用（不经 Vue）
const id = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
  .addTextNode({ x: 0, y: 0 })
host.nodeStore.getNode(id)         // ④ 读节点
await host.save.flush()            // ⑤ 落盘
host.stop()                        // ⑥ 回收全部插件副作用 + 清掉 window 挂载
```

两篇专门的用法手册：[createMiniCanvasHost 用法](/canvas-render/create-host)、[CanvasHost / CanvasSurface](/canvas-render/canvas-host)。

## 它注入的三件服务

`createMiniCanvasHost` 的装配顺序是：**建 Context → 装基础插件（canvas-data 的画布服务）→ 注入渲染层三件 → 冷启动业务插件 → start**。

渲染层独有的三件（**内核与数据层都拿不到**，因为都要 DOM、或要管插件装卸）：

| ctx 服务名 | 谁建 | 为什么必须由渲染层给 | 插件拿它能干什么 |
| --- | --- | --- | --- |
| `nodeLayout` | `new NodeLayoutService(nodeStore)` | 节点**实测**尺寸只能量 DOM（ResizeObserver 上报） | 拿节点真实宽高、绝对坐标、父/子矩形 |
| `viewport` | `new ViewportService()` | 视口要等 VueFlow 实例就绪后 `attachBackend` 才能动 | 缩放、平移、把镜头对准某点、屏幕坐标 ↔ 画布坐标 |
| `pluginManager` | `createPluginManager(ctx, …)` | 热装/热卸/换版本要经统一句柄（带来源与装配清单） | 运行期装卸插件、按清单装配、诊断缺依赖 |

```ts
// 片段：插件里怎么硬依赖这三件（真实装配见 packages/canvas-render/src/host/createMiniCanvasHost.ts）
export const inject = ['nodeLayout', 'viewport'] as string[]   // ① 硬依赖：没有就不启动（停在 pending 等）
const layout = ctx.get('nodeLayout')                            // ② 拿到的是渲染层注入的那个实例
const rect = layout.getNodeRect(nodeId)                         // ③ { id, x, y, w, h }，flow 绝对坐标
```

三件里有**两件是「先给空壳，之后再接后端」**的结构，这点很重要：

- `viewport`：宿主先建空壳注入 ctx，等 `CanvasSurface` 挂载、拿到 VueFlow 实例之后才 `attachBackend`。在此之前**读的是默认值、写的是空操作**（详见 [viewport 服务](/services/viewport)）。
- `nodeLayout`：对象一建好就能读 store 里**声明**的尺寸，但「实测尺寸」要等节点 DOM 挂上、ResizeObserver 跑起来才有 —— 在那之前 `nodeSize` 返回的是「实测 > node.size > 类型默认」这条回退链上的后两项。

## index.ts 导出了什么（按功能分组清点）

`src/index.ts` 是包的唯一出口。逐组看它，就基本知道这个包的全部能力：

| 组 | 关键导出 | 一句话 |
| --- | --- | --- |
| 渲染上下文 | `RENDER_CONTEXT_KEY`、`useCanvasRender`、`CanvasRenderContext` | 渲染子树里**唯一入口**：ctx / host / flow / registry / nodeWrite / 外观 / 交互 / 只读数据 |
| 宿主组件 | `CanvasHost`、`SettingsHost`、`SettingsShell`、`SlotHost`、`RegionEntryHost` | 一行渲染的官方宿主；设置面板宿主；通用槽宿主；区域条目宿主 |
| 宿主门面 | `createMiniCanvasHost`、`MiniCanvasOptions`、`MiniCanvasApi`、`CanvasHostHandle` | 建宿主 + `window.MiniCanvas` 那把 API |
| 插件安装 | `createPluginManager`、`sourceKind`、`PluginManager`、`PluginManifest` | 热装/热卸/重载/清单装配/外部来源 |
| store→flow 纯逻辑 | `nodesFromStore`、`edgesFromStore`、`pruneDanglingEdges`、`assembleTheme`、`nodeShellSlot`、`FlowNode`、`FlowEdge`、`ThemeAssembly` | 数据 → VueFlow 数组；主题槽 → 组件表 |
| 默认外观 | `DEFAULT_EDGE_VISUAL`、`DEFAULT_HANDLE_VISUAL`、`DEFAULT_DEBUG_VISUAL` | 宿主没传外观参数时的回落值 |
| 点选语义 | `clickNode`、`clickEdge`、`clickPane` | 单选 / Shift 加选 / 点空白清空（纯函数） |
| 渲染层服务 | `NodeLayoutService`、`ViewportService`、`ViewportBackend`、`ViewportState` | 三件里的两件（`pluginManager` 从 `createPluginManager` 出） |
| Flow/DOM 能力面 | `createCanvasFlowController`、`CanvasFlowNotReadyError`、`CanvasFlowApi` | 有就绪状态的视口/DOM 面：没就绪**抛错**，不静默降级 |
| VueFlow 精选出口 | `Handle`、`Position`、`getBezierPath`、`useVueFlow`、`useConnection`、`NodeProps`、`EdgeProps` | 渲染类插件统一从本包 import（见 [vueFlowBridge 与 coalesce](/canvas-render/vueflow-bridge)） |
| 拖线反馈 | `createConnectionState`、`beginConnection`、`endConnection`、`isConnectionSource`、`hoverWriter`、`getSourceHandle` | 「悬停到谁 / 合法不合法 / 压端口 / 我是不是本次的源」 |
| 拖线几何与决策 | `resolveFeedback`、`isReverse`、`computeSnapZones`、`hitTest`、`closestZone`、`DEFAULT_SNAP_ZONE_CONFIG` | 吸附带几何与命中（纯函数，可单测） |
| 内容类型与容量 | `contentTypeAccepted`、`decideCapacity`、`evaluateContentConnect`、`oldestIncomingToEvict`、`reasonText` | 端口类型能力、输入口满额挤出、拒绝文案 |
| 交互状态 | `createInteractionState`、`updateActivity`、`clearActivity`、`beginNodeDrag`、`endNodeDrag`、`beginViewportMove`、`beginSelecting`、`beginNodeResize`、`endNodeResize` | 「画布此刻在干什么」（见 [interactionState](/canvas-render/interaction-state)） |
| 能力包 | `useCapabilities`、`useCapability`、`createCapabilityCache`、`provideCapabilityBag`、`capabilityField`、`createStandardCapabilities` | 组件声明 `needs`，从 `registryOf('capability')` 按名取通用 hooks |
| 设计系统目录 | `useUiComponent`、`uiComponent`、`uiNames`、`UI_NAMES`、`uiComponentOutside`、`setUiCatalogHost` | 按名取「希望被主题整体换掉」的通用件 |
| 下拉互斥表 | `claimDropdownExclusive`、`closeAllDropdowns`、`DROPDOWN_CLOSE_ALL_EVENT`、`broadcastSubMenuOpen` | 全应用同一时刻只开一个下拉 |
| 节点外观设置 | `useToolbarOffsets`、`toolbarOffsetStyle`、`useGenPanelMetrics`、`resolveNodeSlotStyle`、`applyOffsetChange` | 控制栏贴边距离 / 生成面板尺寸（读设置实时生效） |
| 画布交互配置 | `CANVAS_INTERACTION_SCHEMA`、`resolveCanvasInteraction`、`applyCanvasInteractionChangeInto` | VueFlow 那批交互开关收编成设置项 |
| 主题 | `THEME_COLOR_TOKENS`、`buildThemeColorConfig`、`useThemeColor`、`installThemePalette`、`THEME_MODE_KEY`、`installThemeMode` | 可配置色板 + 亮/暗模式（落值到 `<html>`） |
| 媒体编辑浮层 | `MediaFrameOverlay`、`computeMediaFit`、`clampCropRect`、`CROP_RATIO_OPTIONS`、`fitEditingNodeIntoView` | 图片/视频共用的裁剪/扩展几何与组件 |
| 单一选中判定 | `useSoleNodeSelected`、`isSoleSelected` | 「恰好选中一个、就是我」（操作栏显隐的统一判据） |
| 事件桥 | `RenderEvents`、`toDragPayload`、`DragEventPayload` | 宿主广播的画布手势/数据事件名（插件 `ctx.on` 订阅） |
| 可视区几何 | `viewportRectInFlow`、`rectsOverlap`、`expandRect`、`FlowRect` | 视口变换 → flow 可视矩形 + 相交判定 |
| 合帧与日志 | `createCoalescer`、`rafScheduler`、`manualScheduler`、`createV2Logger` | 高频值合帧成一帧一次；统一诊断日志 |
| 设置面板数据 | `settingsSourceFrom`、`SettingsPanelSource`、`SETTINGS_FIELD_RENDERER`、`injectSettingsFieldRenderer` | 设置面板消费的最小接口 + 字段控件下发令牌（见 [SettingsHost / SlotHost](/canvas-render/settings-slot-host)） |

顺手记两条**已下线**的东西，别照老文档写：

- `ctx.get('nodeStore' / 'edgeStore' / 'graph' / 'history')` 这四个服务名**已并进 `doc`**（那四个实例仍挂在宿主句柄 host 上，但不再是服务名）；
- 旧的六个注入令牌（HOST_KEY / NODE_REGISTRY_KEY / NODE_WRITE_KEY / CANVAS_PARAMS_KEY / EDGE_VISUAL_KEY / EDGE_SELECTION_KEY）**已全部删除**，只剩 `useCanvasRender()` 一个口。

## 一个把数据层接上 Vue 的最小心智模型

```
你的 Vue 组件
  └─ <CanvasHost :plugins="[皮肤, 业务节点…]" />
       │ ① onMounted 里 await createMiniCanvasHost() 建宿主 host（ctx 已 start）
       │ ② host.ctx 里服务齐了：doc/save/selection/command/…（数据层给的）
       │                            + nodeLayout/viewport/pluginManager（本包给的）
       │ ③ boot 完成后才挂载内层 <CanvasSurface>
       │       ├─ provide RENDER_CONTEXT_KEY（裸 ctx + host + flow + 外观 + 只读数据源）
       │       └─ 渲染一个 <VueFlow>
       │             ├─ node-types：assembleTheme 解析出的每个 type 的节点壳
       │             ├─ edge-types：themeRegistry 里 edge 槽的赢家（如 CustomEdge）
       │             └─ 背景 / 拖线临时线也从 themeRegistry 取
       └─ CanvasHost 订阅 nodeStore / edgeStore / selection → 数据一变就重灌渲染态
```

插件那侧（例如文本节点插件的 `apply(ctx)`）干三件事：**注册节点类型**（`ctx.nodes.register({ type: 'text', in: TextContent, create })`）、**上架自己的服务**（`new TextService(ctx)` → `ctx.text`）、**注册命令**。它的 `TextContent.vue` 在 setup 里 `const { ctx } = useCanvasRender()`，然后 `ctx.get('text').editText(id, 文本)` 把改动写回内核。

这就是分工：**数据在 canvas-data、怎么画在插件、桥在 canvas-render、装配在 CanvasHost。**

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/ui/src/App.vue` | 成品应用：`<CanvasHost :plugins="APP_PLUGINS" …>` 一行挂真画布，`#ui` 插槽里塞 SettingsHost / 小地图 / Agent 面板 |
| `packages/ui/src/assembly.ts` | `APP_PLUGINS`：成品应用的装配清单（数组顺序即装载顺序） |
| `packages/canvas-render/src/host/CanvasHost.vue` | 建宿主 + 订阅数据自动重灌 + 主题装配 + 转发 VueFlow 事件 |
| `packages/canvas-render/src/host/__tests__/createMiniCanvasHost.test.ts` | 门面行为的测试：seed、热装热卸、manifest、`exposeToWindow` 清理 |
| `packages/plugins/plugin-theme-default/src/index.ts` | 往 `ctx.theme` 注册 nodeShell / edge / background / settingsPanel，再往 `ui` 目录注册通用件 |

## 阅读顺序

1. 想马上抄一个能跑的画布 → [端到端可运行 Demo](/canvas-render/demo)。
2. 想搞清两个装配入口 → [createMiniCanvasHost 用法](/canvas-render/create-host)、[CanvasHost / CanvasSurface](/canvas-render/canvas-host)。
3. 想写插件里的 `.vue` 组件（尤其节点内容） → [渲染上下文与 content 组件](/canvas-render/render-context)。
4. 想做设置面板、往画布上叠浮层 → [SettingsHost / SlotHost](/canvas-render/settings-slot-host)。
5. 想懂 VueFlow 桥接与性能合帧 → [vueFlowBridge 与 coalesce](/canvas-render/vueflow-bridge)。
6. 想查「画布此刻在干什么」 → [交互状态 interactionState](/canvas-render/interaction-state)。
7. 想查「谁盖住谁」 → [画布层级 z-index](/canvas-render/z-index)。

## 常见坑

1. **它不是「业务插件」，是包**。`packages/plugins/*` 里找不到 canvas-render；它和 kernel / canvas-data 一样是基础包：被插件依赖，不依赖插件。
2. **`nodeLayout` / `viewport` 在纯数据层拿不到（返回 `undefined`，不抛）**。Node 环境里用纯内核 `new Context()` 跑数据逻辑时这两个名字取不到东西；要用它们就得先建渲染宿主。
3. **`viewport` 在 CanvasSurface 挂载前是「假可用」**：读得到默认值 `{x:0,y:0,zoom:1}`、写什么都不发生。插件 `apply` 里立刻读视口就会踩这个 —— 详见 [viewport 服务](/services/viewport) 的坑 2；要「没就绪就报错」的严格语义，用 `useCanvasRender().flow`（`CanvasFlowNotReadyError`）。
4. **渲染组件必须在 `CanvasHost` 的渲染子树里**。`useCanvasRender()` 在子树外会**抛错**（这是故意的：这些组件本来就依赖宿主能力）。宿主自己的业务 UI 要放进 `<template #ui>`。
5. **组件句柄要 markRaw**。往 VueFlow 的 node-types/edge-types 塞 `.vue` 组件时必须包一层 `markRaw`（或整表放 `shallowRef`），否则 Vue 会深代理组件对象，控制台刷「组件被 reactive 化」警告。CanvasHost 已处理，你手写渲染时才要注意。
6. **theme-default 不是必需品**。不装它，画布里节点是「裸内容」（没有卡片壳、端口、背景）—— 架构上允许，「一行渲染出好看的画布」才是它的活。
