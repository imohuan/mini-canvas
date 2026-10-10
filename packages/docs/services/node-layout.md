# `nodeLayout` · 实测尺寸

**一句话定位**：**`nodeLayout` 是画布的"卷尺"—— 问它一个节点现在有多大、在画布的哪个绝对位置，它给你量好的真实数字。**

**它属于哪一档**：**渲染宿主**。由渲染层 `canvas-render` 的宿主建好并注入（源码：`packages/canvas-render/src/layout/nodeLayout.ts`；装配点：`packages/canvas-render/src/host/createMiniCanvasHost.ts`）。**纯数据层拿不到它**——只 `new Context()` + 装基础插件、没起渲染宿主时，`ctx.get('nodeLayout')` 返回 `undefined`。

## 用法

### 拿法和依赖声明

```ts
// 硬依赖（需要渲染层一定在）：写进模块级 inject，缺提供方时插件停在 PENDING
export const inject = ['nodeLayout'] as string[]

// 可选依赖（没有也能跑，只是退化）：用 tryGet 探测，缺则 undefined
const layout = ctx.tryGet('nodeLayout')
```

仓库里两种写法都有，真实对照：

| 插件 | 写法 | 理由 |
| --- | --- | --- |
| `packages/plugins/plugin-node-find/src/nodeFindPlugin.ts` | `inject = ['doc', 'viewport', 'nodeLayout']` | 搜索跳转必须有实测矩形，没有就不该启动 |
| `packages/plugins/plugin-multi-select/src/BoxSelectLayer.vue` | `ctx.get('nodeLayout')` | 组件只在渲染子树里跑，宿主恒在 |
| `packages/plugins/plugin-clipboard/src/clipboardPlugin.ts` | `ctx.tryGet('nodeLayout')` | 无渲染层时退化成"把自身 position 当绝对坐标" |
| `packages/plugins/plugin-context-menu/src/contextMenuPlugin.ts` | `ctx.tryGet('nodeLayout')` | 拿不到服务时退化为"只等一帧" |

### 方法逐个看

签名逐字来自 `packages/canvas-render/src/layout/nodeLayout.ts`（契约定义在 `packages/canvas-data/src/canvas/renderServiceContracts.ts` 的 `NodeLayoutContract`）。**插件能用的只有这五个读口**：

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `nodeSize` | `nodeSize(id: string): { w: number; h: number }` | 某个节点的实际尺寸；节点不存在返回 `{ w: 0, h: 0 }` | 对齐、吸附、算包围盒 |
| `absolutePosition` | `absolutePosition(id: string): { x: number; y: number }` | 绝对坐标（逐级累加父链的 `position`）；节点不存在返回 `{ x: 0, y: 0 }` | 子节点参与框选/参考线/导出 |
| `getNodeRect` | `getNodeRect(id: string): LayoutRect \| null` | 上面两样合起来：绝对坐标 + 实际尺寸；节点不存在返回 `null` | 最常用，一个调用拿全 |
| `getAllRects` | `getAllRects(): LayoutRect[]` | 全部存活节点的矩形（含子节点；顺序同 store） | 整图导出、全图找空白、小地图 |
| `childrenOf` | `childrenOf(parentId: string): LayoutRect[]` | 某父节点的**直属**子节点矩形 | 组节点算自己的内容包围盒 |

`LayoutRect` 的形状：

```ts
export interface LayoutRect {
  id: string
  x: number        // flow 绝对坐标
  y: number
  w: number        // 实际宽度
  h: number
}
```

**尺寸的来源优先级**（`nodeSize` 内部就是这么判的）：

1. **实测值**（渲染层 ResizeObserver 量的）——最高优先；
2. 节点的 `size`（用户拖过右下角 resize 柄后写进数据的）；
3. 该类型注册时声明的 `defaultSize`；
4. 什么都没有 → `{ w: 0, h: 0 }`。

### 渲染层内部的那几个写口（插件不要用）

`NodeLayoutService` 上还有 `setMeasuredSize` / `clearMeasuredSize` / `reset`——**它们是渲染层的内部面，不写进给插件看的契约**。写口只有一个合法调用方：`packages/canvas-render/src/host/useNodeMeasure.ts`（ResizeObserver 量完就写、节点移除就清）。插件自己写会让"实测值"这个事实被污染，别人再量到的就不是真实 DOM 了。

## 注意事项

1. **纯数据层拿不到它（返回 `undefined`，不抛）**。`nodeLayout` 由渲染宿主注入；headless 测试、只跑 `canvas-data` 的逻辑测试里没有。对照写法：`packages/plugins/plugin-clipboard/src/clipboardPlugin.ts` 用 `ctx.tryGet('nodeLayout')`，缺服务时退化成"把自身 position 当绝对坐标"。
2. **实测尺寸是内存态，不入库、不落盘**。刷新后 ResizeObserver 要重新量一轮。所以别在"刚建完节点、还没渲染"那一刻问尺寸——真实做法是先确认量到了再动手（`packages/plugins/plugin-context-menu/src/contextMenuPlugin.ts` 的 `isNodeMeasured`：`nodeSize(id)` 宽高都大于 0 才算就绪）。
3. **它是只读的**。想改尺寸要用 `doc.setNodeSize(id, w, h)`（或 `ctx.nodes.setSize`）；想改位置用 `doc.moveNode`。往 `nodeLayout` 上写数据是没有方法的——`setMeasuredSize` 那几个写口属渲染层内部面，不在插件契约里。
4. **`getAllRects()` 里可能有 `{ w: 0, h: 0 }` 的条目**。节点刚建、还没渲染量测时就是这样。做版面计算要么跳过零尺寸项，要么先用 `nodeSize` 探一下。
5. **子节点坐标是相对的，别忘换算**。数据里 `child.position` 相对父；`absolutePosition` / `getNodeRect` 已经帮你累加了父链。要**写回**位置时（示例第 ⑥ 步）记得再减回父的绝对坐标——不减就会出现"组内节点一移动就飞走"。

