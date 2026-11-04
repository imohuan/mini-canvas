# 核心插件：默认主题（theme-canvas）

**一句话**：画布上的节点卡片、连线、背景长什么样，由这个插件说了算。

默认主题现在拆成**两个独立的插件包**，各管一半：

| 包 | 插件名 | 管什么 | 何时启动 | 源码 |
| --- | --- | --- | --- | --- |
| `@mini-canvas/plugin-theme-canvas` | `theme-canvas` | 节点壳 / 连线 / 背景 / 拖线临时线 / 节点上下工具栏 | 进画布才启动（`inject: ['doc']`） | `packages/plugins/plugin-theme-canvas` |
| `@mini-canvas/plugin-theme-components` | `theme-components` | 通用组件目录 / 设置面板 / 外观变量 / 通知服务 | 应用级常驻 | `packages/plugins/plugin-theme-components` |

两边**互不 import**。要共用的纯数据（配置默认值、`Config` 分片、外观桥接、图标表）
放在 `packages/theme-contract`，只放 TS 数据与纯函数，不放 `.vue`。

本页讲**画布这一半**（theme-canvas）；组件那一半见 [默认主题组件库](/plugins/theme-components)。

## 它注册了什么

| 种类 | 键 | 放的是什么组件 |
| --- | --- | --- |
| `theme` | `nodeShell` | `BaseNode` —— 节点的**外壳**（端口 / 标题就地改名 / 选中环 / 浮动端口） |
| `theme` | `edge` | `CustomEdge` —— 连线的**完整外观**（流光 / 箭头 / 双击剪切） |
| `theme` | `background` | `DefaultBackground` —— 跟随画布的圆点底 |
| `theme` | `connectionLine` | `ConnectionLine` —— 拖线时那根“橡皮筋” |
| `theme` | `edgeDefaultType` | 默认连线类型（字符串 `'custom'`） |
| `nodes` | `out:top` / `out:bottom` | 节点上下的模式工具栏挂载点 |
| `ui` | `movingHandle` / `connectionLine` / `nodeModeTopBar` / `nodeModeBottomBar` | 给业务插件按名复用的外观件 |

> 为什么这些要放进**注册场**而不是写死？因为要能被**换掉**。
> 装一个 order 更小的插件占同一槽，就能顶替默认皮。

## 它用了什么服务

只 `inject: ['doc']`。原因很直接：这些槽最终都要挂在节点/画布上，
没有 doc 时启动只会注册一堆取不到数据的组件。

```ts
export const name = 'theme-canvas'
export const inject = ['doc'] as string[]
export const Config = CanvasConfig   // 来自 @mini-canvas/theme-contract

export function apply(ctx, config) {
  ctx.theme.register('nodeShell', BaseNode)
  ctx.theme.register('edge', CustomEdge)
  ctx.theme.register('background', DefaultBackground)
  ctx.theme.register('connectionLine', ConnectionLine)
  ctx.theme.register('edgeDefaultType', 'custom')
}
```

## 它声明的配置

画布这一半的配置键都住在 `theme-contract` 的 `CanvasConfig`：

| 配置组 | 管什么 | 举例 |
| --- | --- | --- |
| 节点 / 端口 | 浮动端口与命中区几何 | `portZoneWidth`、`portZoneHeightRatio`、`handleButtonSize` |
| 节点 / 标题 | 标题显不显示、离卡片多远 | `titleVisible`、`titleOffset`、`titleScaleMinZoom` |
| 节点 / 低细节、多选标记、吸附带 | LOD 与拖线吸附 | `nodeLodLowDetailZoom`、`nodeMultiRadioSize`、`heightRatio` |
| 布局 / 控制栏 | 上下控制栏贴边距离、生成栏尺寸 | `toolbarTopOffset`、`panelImageWidth` |
| 边 / 连线 | 线宽 / 虚线 / 箭头 / 流光 | `edgeLineWidth`、`edgeFlowEnabled`、`edgeFlowSpeed` |

外观形状 / 字体这类**与画布无关**的键在 `AppearanceConfig`（theme-components）。

> 这些默认值是**全仓唯一权威**。渲染层不再自己写一份默认值 ——
> 两边各写一份必然漂移，最后表现成“装不装主题插件，端口位置不一样”。

## 和它相关的红线组件

这个包里有一批**不能改坏**的组件（改了会破坏画布的核心行为）：

`BaseNode.vue` / `MovingHandle.vue` / `BaseTitle.vue` /
`CustomEdge.vue` / `ConnectionLine.vue` / `DefaultBackground.vue`

拆包只移动了位置，这六个文件的内容一字未改。
它们的行为契约有专门的金标准文档，动之前要先读。

## 想换一套皮肤

写一个新插件，`inject: []`，然后给更小的 order 顶替：

```ts
export function apply(ctx) {
  ctx.theme.add('nodeShell', MyNodeShell, { order: -1 })  // -1 < 0，顶替默认皮
  ctx.theme.add('edge', MyEdge, { order: -1 })
}
```

默认皮的组件**不会被删**，只是排到后面 —— 所以卸掉你的插件，默认皮立刻回来。

## 装配顺序

`packages/ui/src/assembly.ts` 里，theme-components 是应用级常驻，
theme-canvas 是画布级（进画布才装）：

```ts
import { themeComponentsPlugin } from '@mini-canvas/plugin-theme-components'
import { themeCanvasPlugin } from '@mini-canvas/plugin-theme-canvas'
```

项目页只装通用组件一半，所以点开项目列表时不会为了主题启动一整套画布外观。

