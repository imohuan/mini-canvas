# 拖线临时线 ConnectionLine

**一句话**：从端口往外拖线时，那根跟着鼠标走的"待连预览线"就是它 ——
而且它把渲染**完全委托**给 [CustomEdge](/plugins/theme-components/custom-edge)，
所以拖出来的临时线和最终落成的正式边**长得一模一样**（流光、箭头、配置、动画全都同款）。

它注册在两处：主题槽 `connectionLine` 与 `ui` 目录名 `connectionLine`（同一个组件）。

源码：`packages/plugins/plugin-theme-default/src/components/edge/ConnectionLine.vue`（红线组件，仅 46 行）。

## 功能说明

## 活演示

`BaseNode` 是 VueFlow 渲染每个节点时套上的壳，**离开画布宿主渲染不出来** —— 所以下面嵌一块真画布（装了默认主题 + 示例节点），你在真环境里看它：

<script setup>
import MiniCanvasStage from '../../.vitepress/theme/demos/MiniCanvasStage.vue'
</script>

<MiniCanvasStage :height="360" />

> 从任一节点的圆点往外拖 —— 那根跟手的临时线就是它（与落成的正式边长得一模一样）。

- 把 canvas-render 的"起点/终点坐标"这套 props **适配**成 CustomEdge 的 props，并带上 `temporary` 语义。
- `pointer-events: none`：拖线过程中它不吃任何画布交互。
- 只做适配与外壳；**所有视觉都来自 CustomEdge** —— 想改临时线外观就改 CustomEdge 一处，两边同步变。

## Props

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sourceX` / `sourceY` | `number` | 起点坐标（**必填**） |
| `targetX` / `targetY` | `number` | 终点坐标（拖线时是鼠标位置，**必填**） |
| `sourcePosition` / `targetPosition` | `string?` | 两端端口方向 |
| `hasSnap` | `boolean?` | 预留字段：为兼容宿主 props 而保留；吸附高亮已由 CustomEdge 的 temporary 状态覆盖 |

> `sourcePosition` / `targetPosition` **必须来自 VueFlow**（`fromHandle.position` /
> `toPosition`），**不能写死**成 `Right` / `Left` ——
> 从左侧端口拖出时写死 `Right`，贝塞尔控制点会朝内，曲线就弯反了；Top/Bottom 端口同理会把曲线压扁。

## Slots / 插槽

**没有插槽。**

## 事件、方法或暴露能力

**不 emit、不 defineExpose。** 它只是一层薄适配，内部渲染一句 `<CustomEdge temporary ... />`。

## 使用方式与示例

宿主会自动把它接到 VueFlow 的拖线预览上（`#connection-line`）。当你想**自己画一根同款临时线**
（比如多选框上那个"批量连线"端口拖出的线），按名取它：

```vue
<!-- 文件：packages/my-plugin/src/MyBatchConnectPort.vue -->
<!-- 格式：Vue 单文件组件 -->
<!-- 位置：插件包里的浮层 —— 它自己画一根与画布同款的拖线预览线 -->
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'

// 按名取（不依赖主题包），换主题时这根线跟着一起换
const ConnectionLine = useUiComponent('connectionLine')
</script>

<template>
  <svg class="my-drag-layer">
    <component
      :is="ConnectionLine"
      :source-x="start.x" :source-y="start.y"
      :target-x="cursor.x" :target-y="cursor.y"
      source-position="right" target-position="left"
    />
  </svg>
</template>
```

同时它还支持 `MovingHandle` 的 `preview` 模式：只复用端口外观、不注册真实连接点，
并 emit `connectStart` —— 正好给"挂在自己浮层上的临时端口"用。

## 注意事项

1. **临时线必须不吃指针事件**：组件的根 `<g>` 恒定 `pointer-events: none`，
   否则拖线过程中会挡住画布。
2. **两处注册是同一个组件**：`theme.connectionLine` 供宿主装配，`ui.connectionLine` 供插件按名取；
   换皮时两处一起换。
3. **不要在这里重画一套线**：它的价值就是"与正式边完全一致"，
   自己画一套必然与 CustomEdge 漂移。
