# `view` · 几何与视口

**一句话定位**：`view` 同时回答两件事：节点现在多大、在画布哪里；视野现在在哪、要怎么对准。

**它属于哪一档**：**渲染宿主**。由 `canvas-render` 建好并注入，纯数据层拿不到它。
源码：`packages/canvas-render/src/view/viewService.ts`。

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
