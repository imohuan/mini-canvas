# `viewport` · 视口

**一句话定位**：**`viewport` 是画布的"摄像机和坐标翻译员"—— 调它能缩放、平移、把镜头对准某个位置，还能把屏幕上的鼠标位置翻译成画布坐标。**

**它属于哪一档**：**渲染宿主**。由渲染层 `canvas-render` 建好并注入（源码：`packages/canvas-render/src/viewport/viewportService.ts`；装配点：`packages/canvas-render/src/host/createMiniCanvasHost.ts`，实际后端在 `packages/canvas-render/src/host/CanvasSurface.vue` 里 `attachBackend`）。**纯数据层拿不到它**——没有渲染宿主时 `ctx.get('viewport')` 返回 `undefined`。

## 用法

### 一个关键事实：后端可能还没挂上

`ViewportService` 是个**空壳 + 后端**结构：宿主先建壳并注入 ctx，等 `CanvasSurface` 挂载、拿到 VueFlow 实例之后才 `attachBackend`。所以在**后端挂上之前**：

- 读：返回默认值（`getViewport()` → `{ x: 0, y: 0, zoom: 1 }`；`screenToFlow` 原样返回入参）；
- 控制：全是 no-op（什么都不发生，也不抛错）。

**这就是"看着有服务、调了没反应"的最常见来源。** 症状与对策：

| 症状 | 原因 | 怎么办 |
| --- | --- | --- |
| 插件 `apply` 里立刻 `getViewport()` 拿到 `{0,0,1}` | 那时 CanvasSurface 还没挂载 | 等 `ctx:ready` 之后、或用户操作（点按钮/命令）时再读 |
| `fitView()` 没反应 | 后端未挂或画布空 | 确认在交互时机调用；画布没节点时 `fitView` 本就无内容可适配 |
| 拖文件落点偏了 | 调用的时机在挂载前 | 在事件处理里调（那时必然已挂载） |

### 拿法

```ts
// 硬依赖（渲染宿主一定在才启动）：模块级 inject
export const inject = ['viewport'] as string[]

// 可选（没有也能跑）：tryGet 探测
const vp = ctx.tryGet('viewport')
if (vp) vp.setCenter(x, y, 1)
```

真实对照：`packages/plugins/plugin-node-find/src/nodeFindPlugin.ts` 用 `inject`；`packages/plugins/plugin-clipboard/src/clipboardPlugin.ts` 与 `packages/plugins/plugin-canvas-export/src/canvasExportPlugin.ts` 用 `tryGet`。

### 方法逐个看

签名逐字来自 `packages/canvas-render/src/viewport/viewportService.ts`（契约在 `packages/canvas-data/src/canvas/renderServiceContracts.ts` 的 `ViewportContract`）。

**读：**

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `getViewport` | `getViewport(): ViewportState` | 当前视口 `{ x, y, zoom }`；后端未挂时返回 `{ x: 0, y: 0, zoom: 1 }` | 想"保持当前缩放"地移动视图（先读再写） |
| `screenToFlow` | `screenToFlow(clientX: number, clientY: number): FlowPoint` | 屏幕坐标 → 画布坐标 | 拖拽落点、鼠标位置建节点、浮层跟随 |
| `flowToScreen` | `flowToScreen(flowX: number, flowY: number): FlowPoint` | 画布坐标 → 屏幕坐标 | 自绘浮层要贴在某个画布位置上 |

**控视图：**

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `zoomIn` | `zoomIn(): void` | 放大一档 | 工具栏 `+` |
| `zoomOut` | `zoomOut(): void` | 缩小一档 | 工具栏 `−` |
| `zoomTo` | `zoomTo(level: number): void` | 缩放到指定倍数 | "缩放至 100%" |
| `fitView` | `fitView(padding = 0.1): void` | 让全部内容适配进视野（`padding` 是留白比例） | "适应视图"、首次打开画布 |
| `setCenter` | `setCenter(x: number, y: number, zoom?: number): void` | 把画布坐标 `(x, y)` 放到视野中心；`zoom` 不传则保持 | 搜索跳转、聚焦选中节点 |
| `setViewport` | `setViewport(v: ViewportState): void` | 即时写整个视口 | **"跟手"场景**：小地图拖拽、逐帧写 |
| `animateViewport` | `animateViewport?(v: ViewportState, durationMs?: number): void` | 带过渡地写视口（默认 320ms）；后端不支持时**自动退回即时** | 聚焦/取景这类一次性动作 |

`setViewport` 与 `animateViewport` 的分工是刻意设计的：小地图拖拽每帧都要写视口，如果每次都启动一次补间动画，实测会严重卡顿；所以"要不要动画"交给调用方选，两条路互不影响。

**DOM 锚点：**

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `getRootEl` | `getRootEl(): HTMLElement \| null` | 本画布实例根 DOM（多画布不串线） | 截图/导出找边界 |
| `getRendererEl` | `getRendererEl(): HTMLElement \| null` | VueFlow 的节点层容器 | 量测、导出 |
| `getPaneEl` | `getPaneEl(): HTMLElement \| null` | 视口 pane（坐标基准、浮层挂这里） | 浮层定位 |
| `queryNodeEl` | `queryNodeEl(nodeId: string): HTMLElement \| null` | 按节点 id 找它的 DOM | 需要具体元素的场景（导出、动画） |

后端未挂时这几个都返回 `null`。

### 视口还会被"落盘"

画布宿主会把视口存进 `save` 的 `canvas` 域（裸 key `graph-viewport`，见 `packages/canvas-data/src/storage/keys.ts` 的 `GRAPH_VIEWPORT_KEY`），启动时再 `setViewport` 恢复——"刷新之后回到上次看的位置"就是这条链路。这段逻辑在 `packages/canvas-render/src/host/CanvasHost.vue` 里，插件不用管。

## 注意事项

1. **纯数据层拿不到它（`undefined`，不抛）**。`viewport` 是渲染宿主注入的；headless 环境里 `ctx.get('viewport')` 是 `undefined`。要么写进 `inject`（保证渲染宿主在才启动），要么 `ctx.tryGet('viewport')` 后判空退化。
2. **后端挂载前，读的是默认值、写的是空操作**。服务对象在 `CanvasSurface` 挂载前就存在了，但 `attachBackend` 还没调：`getViewport()` 返回 `{0,0,1}`、控制类方法静默无效。插件 `apply` 里立刻读视口就会拿到这个"假"默认值——要读请在交互时机（命令/事件回调）里读。
3. **"跟手"用 `setViewport`，"取景"用 `animateViewport`**。小地图每帧 `animateViewport` 会每帧重启补间，实测会卡；反过来，一次性聚焦用 `setViewport` 就会显得很生硬。另外 `animateViewport` 是**可选方法**（接口里带 `?`），自己实现假后端做测试时可以不写，服务会自动退回即时写。
4. **`setCenter` 的 `zoom` 不传 = 保持当前缩放**。想"精准回到 100%"必须显式传 `1`（示例第 ④ 步）。传 `0` 之类的非法值属于调用方责任——服务不做校验，后端行为取决于 VueFlow。
5. **DOM 锚点方法在后端未挂载时返回 `null`**。`getPaneEl()` 拿到的元素是浮层定位的基准，取到 `null` 时说明画布还没挂好，别硬算坐标（示例第 ⑦ 步就先判空）。
6. **视口状态由宿主统一落盘**（`canvas/graph-viewport`）。插件**没有**写这条 key 的必要；自己另存一份视口就会出现两本账，刷新后到底看哪个位置就不确定了。

