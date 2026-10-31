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
| `padding` | 整块内容留白比例（0..0.49，缺省 0.1） |
| `heightRatio` | 让内容高度占视口比例；写了就不看 padding |
| `keepZoom` | 只平移，缩放不动 |
| `zoom` | 固定缩放（仍受 `minZoom` / `maxZoom` 夹取） |
| `onlyIfOutOfView` | 已经看得见就不动 |
| `margin` | 可见判定的额外边距（像素） |
| `select` | 只由 `canvas.focus` 消费；`view.fitTo` 不改选中 |
| `includeBars` | `'bottom'` / `'both'`：把底栏高度算进可视区 |
| `animate` / `durationMs` | 是否过渡、过渡多久 |

返回 `true` 表示真的移动了视图；已可见或没有目标时返回 `false`。

## 注意事项

1. **还没挂上时是「假可用」**：读得到默认值，控制方法不生效。插件 `apply` 里不要立刻读视口；等到交互时机再读，或改用 `useCanvasRender().flow` 的严格模式。
2. **取景统一走 `fitTo`**。9 套旧聚焦实现的差异已经收进参数里，不要在新代码里手算 `setCenter`。
3. **`animateViewport` 与 `setViewport` 分工不同**：逐帧跟手用即时写，一次性聚焦才用过渡。
4. **只读几何**。改节点尺寸用 `doc.setNodeSize`，改位置用 `doc.moveNode`。
