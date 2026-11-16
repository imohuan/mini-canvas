# `view` · 几何与视口

**一句话定位**：`view` 同时回答两件事：节点现在多大、在画布哪里；视野现在在哪、要怎么对准。

**它属于哪一档**：**渲染宿主**。由 `canvas-render` 建好并注入，纯数据层拿不到它。
源码：`packages/engine/canvas-render/src/view/viewService.ts`。

## 拿法

```ts
export const inject = ['view'] as string[]
const view = ctx.get('view')
```

```ts
// 可选：没起渲染宿主时跳过
const view = ctx.tryGet('view')
if (view) view.fitTo('selection')
```

## 读节点几何

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `nodeSize(id)` | `{ w, h }` | 实测尺寸 > 节点 `size` > 类型默认；都没有返回 `{0,0}` |
| `absolutePosition(id)` | `{ x, y }` | 沿父链累加成 flow 绝对坐标 |
| `getNodeRect(id)` | `LayoutRect \| null` | 绝对坐标 + 实际尺寸 |
| `getAllRects()` | `LayoutRect[]` | 全部存活节点，含子节点，顺序同 store |
| `childrenOf(parentId)` | `LayoutRect[]` | 某父节点的直属子节点 |

实测尺寸是内存态。刷新后要等节点 DOM 挂上、量测跑一轮，才拿得到真实值。

## 读写视口

| 方法 | 说明 |
| --- | --- |
| `getViewport()` | `{ x, y, zoom }`；后端没挂时是 `{0,0,1}` |
| `setViewport(v)` | 即时写，用于逐帧跟手 |
| `animateViewport(v, ms?)` | 带过渡，缺省 320ms |
| `setCenter(x, y, zoom?)` | 把画布坐标放到视野中心 |
| `fitView(padding?)` | 整图适配，缺省留白 0.1 |
| `focusAll(opts?)` | 把**全部节点**铺进可视区（F 键 / 云端换图后用）；与启动同一条算法，即时生效 |
| `solveStartupViewport(hostSize?, opts?)` | 只算不写：给出启动构图，宿主拿它作 `default-viewport` |
| `zoomIn` / `zoomOut` / `zoomTo` | 缩放控制 |
| `screenToFlow` / `flowToScreen` | 屏幕坐标与画布坐标互转 |
| `getRootEl` / `getPaneEl` / `getRendererEl` / `queryNodeEl` | 本画布实例的 DOM 锚点；没挂好返回 `null` |

## 取景只用一个入口：`fitTo`

```ts
view.fitTo('selection', { keepZoom: true })
view.fitTo(['n1', 'n2'], { padding: 0.1 })
view.fitTo('all', { heightRatio: 0.5 })
```

| 参数 | 用途 |
| --- | --- |
| `padding` | 内容四周留白。**比例与像素共用这一个参数**；可写 1~4 个值，顺序同 CSS |
| `heightRatio` | 让内容高度占视口比例；写了就不看 padding |
| `keepZoom` | 只平移，缩放不动 |
| `zoom` | 固定缩放（仍受 `minZoom` / `maxZoom` 夹取） |
| `onlyIfOutOfView` | 已经看得见就不动 |
| `margin` | 可见判定的额外边距（像素） |
| `select` | 只由 `canvas.focus` 消费；`view.fitTo` 不改选中 |
| `includeBars` | `'top'` / `'bottom'` / `'both'`：扣掉顶部菜单、底部状态栏占的位置 |
| `includeNodeTopBar` | `true` = 把节点自己的**顶部标题条**算进聚焦范围（底部控制栏不参与） |
| `animate` / `durationMs` | 是否过渡、过渡多久 |

返回 `true` 表示真的移动了视图；已可见或没有目标时返回 `false`。

### 启动构图：`solveStartupViewport`（只算不写）

`fitTo` 和 `focusAll` 都是**写**视口，只能在画布挂上之后用。启动那一次不行 ——
那时候画布还没挂，写了也会被 VueFlow 的初始化覆盖，于是先闪一帧。

```ts
const plan = view.solveStartupViewport({ w: 1600, h: 900 })
// plan = { x, y, zoom } 或 undefined（空画布）
```

它只依赖节点尺寸和容器尺寸，不碰 DOM，也不写视口。宿主的用法是把这个结果直接交给
VueFlow 的 `default-viewport`，让首帧就是终态。它和 F 键、`focusAll` 共用同一套取景算法
（留白 48、避开上下界面条、算上节点标题条、不做补间）。

画布已经挂上、需要重新构图时（例如云端整包换图后）才用 `focusAll()`：

```ts
view.focusAll()                 // 即时生效，不补间
view.focusAll({ padding: 24 })  // 需要时改单项，其余默认仍生效
```

### 异步插件：插件登记，画布统一决定时机

插件分两种：

| 类型 | 例子 | 画布怎么处理 |
| --- | --- | --- |
| 同步插件 | 主题、节点类型、底栏、自动布局 | `apply` 返回就等于装完。它们加载完，宿主才开始读画布 |
| 异步插件 | 云端连接、需要预热资源的插件 | 登记到 `canvasBoot`，由画布按固定顺序触发，插件不用自己排时序 |

`canvasBoot` 就是启动时序本身，只有两个登记口：

```ts
const boot = ctx.tryGet<{
  beforeRestore(fn: () => Promise<unknown> | void, label?: string): Promise<void>
  ready(fn: () => Promise<unknown> | void, label?: string): void
  restoreResult(): { nodes: unknown[]; edges: unknown[] } | undefined
}>('canvasBoot')

// ① 读画布之前：换数据源（云端把 save 的四格换成自己的后端）
boot?.beforeRestore(() => switchAdaptersToCloud(), 'cloud-client:adapters')

// ② 读画布之后、算构图之前：其它异步准备（拉清单、预热）
boot?.ready(warmup, 'my-plugin:warmup')
```

于是画布打开只有一条链路：

```text
加载同步插件 → canvasBoot.beforeRestore（换数据源）→ save.get 读一次 → canvasBoot.ready 落地
            → 算启动构图 → 挂载 VueFlow（首帧就是终态）
```

本地那份存档从头到尾不会被画出来，也不存在「先读本地再被覆盖」。
服务器上还没有这张画布时（首次上云），插件用 `boot.restoreResult()` 看这次读到了什么，
再决定要不要把本地那份推上去 —— 不必自己再 GET 一次。

`ready()` 的规则：

1. **只登记，不执行**。执行时机由画布统一触发，所以插件可以在很早的时候登记，
   不必反过来等「宿主是不是已经读完」。
2. 画布**等它完成**（成功或失败都算完成）才算构图 —— 只取一次景，不会先按旧图画一遍。
3. 失败不阻断：插件自己的错误照旧写进自己的状态，画布照常打开。
4. 有 **8 秒兜底**：插件卡死（网络挂起）时先按现状构图，不让画布永远不出现。
5. 画布呈现之后再登记的（用户临时装插件）**不参与等待**，不会把画布卡住。

改这里之前先看三条：

1. **必须在挂载之前给定构图**。VueFlow 的 `default-viewport` 只在初始化那一次生效；
   挂载之后再写视口，就必然先画错一帧再改对 —— 用户看到的就是闪烁。
   所以 `CanvasHost` 会先把构图算好，再让 `CanvasSurface` 挂载。
2. **插件装卸会让 VueFlow 整棵树重挂**，重挂后视口回到默认值。重挂时把**上次的视野原样恢复**
   （不重新取景）；用户自己平移/缩放后彻底停手。
3. **视口仍然落盘**（`graph-viewport`），但只在用户亲手平移/缩放后写 ——
   启动构图是按当前窗口重算的，不需要再往存储里记一份。

### 取景如何避开界面条

缩放不再按"整块画布"算，而是先算出**可用区域**：

1. 从整块画布扣掉 `includeBars` 指的界面条（高度由外壳实时上报，见下）；
2. 再扣掉 `padding` 的四边留白；
3. 缩放按这块可用区域算，内容也居中到它的中心。

`padding` 的写法和 CSS 一致：

```ts
padding: 0.1                  // 比例：每边留 10%（按较短边换算）
padding: 48                   // 像素：每边 48px
padding: [24, 48]             // 上下 24、左右 48
padding: [24, 48, 64]         // 上 24、左右 48、下 64
padding: [24, 48, 64, 96]     // 上 / 右 / 下 / 左
```

单位由值本身决定：整组都 ≤ 1 按比例，有任何一个 > 1 就整组按像素。
所以"顶部菜单算不算进来"和"四边各留多少"是两件独立的事，可以分别设置。
留白大于视口时会按比例收缩，不会算出负的可用区或 0 缩放。

外壳（`CanvasShell`）会把顶部工具栏、底部状态栏 / 底栏、左右抽屉的真实尺寸上报给
`view.setChromeBars()`。想先看按当前设置会扣掉多少，可以调 `view.focusInsets({ includeBars, padding })`。

### 按 F 聚焦时用哪套参数（用户可调）

左下角状态栏的「整理画布」按钮和 `F` 聚焦走的是同一套参数，取值来自设置面板
「布局 → 自动布局聚焦」这三项：

| 设置项 | 键 | 缺省 | 效果 |
| --- | --- | --- | --- |
| 避开界面条 | `focusIncludeBars` | `both` | `none` / `top` / `bottom` / `both`：聚焦时把顶栏、底部状态栏占的高度扣掉 |
| 聚焦留白（像素） | `focusPadding` | `48` | 在避开界面条之后再留的四边空白；值 ≤ 1 时按比例理解 |
| 聚焦含节点顶栏 | `focusIncludeNodeTopBar` | `true` | 把节点自己的标题条算进去，避免聚焦后标题被裁掉 |

这三项改完**下一次聚焦立刻生效**，不用重启插件。非法值会回落（`includeBars` 乱写当 `none`，
负数留白当 0）。

> 为什么聚焦只算「卡片 + 顶部标题条」：底部控制栏（输入框那一整块）很高、还会随内容变高，
> 算进聚焦范围会把卡片压得很小。所以它不参与，`includeNodeTopBar` 只开标题条那一条。

## 注意事项

1. **还没挂上时是「假可用」**：读得到默认值，控制方法不生效。插件 `apply` 里不要立刻读视口；等到交互时机再读，或改用 `useCanvasRender().flow` 的严格模式。
2. **取景统一走 `fitTo`**。9 套旧聚焦实现的差异已经收进参数里，不要在新代码里手算 `setCenter`。
3. **`animateViewport` 与 `setViewport` 分工不同**：逐帧跟手用即时写，一次性聚焦才用过渡。
4. **只读几何**。改节点尺寸用 `doc.setNodeSize`，改位置用 `doc.moveNode`。
