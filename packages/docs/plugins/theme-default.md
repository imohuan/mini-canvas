# 核心插件：默认主题 theme-default

**一句话**：画布上"看得见的东西"长什么样，是这个插件说了算。

它是画布的**默认皮肤**。骨架（节点位置、连线数据）由数据层给，
但"节点卡片的圆角、端口的小耳朵、连线的流光、背景的圆点"这些外观，
全在它这儿。

## 它注册了什么（全部落点）

它只写主题槽，不写别的。真实落点如下：

| 种类 | 键 | 放的是什么组件 |
| --- | --- | --- |
| `theme` | `nodeShell` | `BaseNode` —— 节点的**外壳**（端口 / 标题就地改名 / 选中环 / 浮动端口） |
| `theme` | `edge` | `CustomEdge` —— 连线的**完整外观**（流光 / 箭头 / 双击剪切） |
| `theme` | `background` | `DefaultBackground` —— 跟随画布的圆点底 |
| `theme` | `connectionLine` | `ConnectionLine` —— 拖线时那根"橡皮筋" |
| `theme` | `edgeDefaultType` | 默认连线类型（bezier） |
| `ui` | 多个 | 设计系统组件目录：按钮 / 下拉 / 滑块 / 取色器 / 媒体查看器 / 拖拽手柄…… |

> 为什么这些要放进**注册场**而不是写死？因为要能被**换掉**。
> 换个主题插件，这些组件的 order 更小就顶替了默认皮。

## 它用了什么服务

**一个都没用。** `inject` 是空数组。

这不是巧合，是刻意设计：主题插件只负责"长什么样"，不需要读数据、不需要命令、
不需要选中态 —— 所以它不依赖任何服务。

它的工作方式很干净：

```ts
export const name = 'theme-default'
export const inject = [] as string[]   // 不依赖任何服务

export function apply(ctx) {
  // 往主题槽放默认组件（order 0；别人给更小的 order 就能顶替）
  ctx.theme.register('nodeShell', BaseNode)
  ctx.theme.register('edge', CustomEdge)
  ctx.theme.register('background', DefaultBackground)
  ctx.theme.register('connectionLine', ConnectionLine)
}
```

## 它声明的配置

外观参数全都走 `Config` schema，所以它们**自动出现在设置面板里**，
不用另外写 UI。分几组：

| 配置组 | 管什么 | 举例 |
| --- | --- | --- |
| 连线外观 | 线宽 / 虚线 / 箭头 / 流光 | `edgeLineWidth`、`edgeFlowEnabled`、`edgeFlowSpeed` |
| 端口外观 | 半圆耳朵的几何 | `portZoneWidth`、`portZoneHeightRatio`、`handleButtonSize` |
| 标题外观 | 标题显不显示、离卡片多远 | `titleVisible`、`titleOffset`、`titleScaleMinZoom` |
| 控制栏布局 | 上/下控制栏离卡片多远 | `toolbarTopOffset`、`toolbarBottomOffset` |
| 生成面板 | 输入框那一栏的尺寸 | `panelImageWidth`、`panelEditorMinHeight` |

> 这些默认值是**全仓唯一权威**。渲染层不再自己写一份默认值 ——
> 两边各写一份必然漂移，最后表现成"装不装主题插件，端口位置不一样"。

## 和它相关的红线组件

这个包里有一批**不能改坏**的组件（改了会破坏画布的核心行为）：

`BaseNode.vue` / `MovingHandle.vue` / `BaseTitle.vue` /
`CustomEdge.vue` / `ConnectionLine.vue` / `DefaultBackground.vue`

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
