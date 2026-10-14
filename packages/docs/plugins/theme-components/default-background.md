# 画布背景 DefaultBackground

**一句话**：画布上那层"跟着平移缩放走的点状网格"就是它。注册在主题槽 `background`。

源码：`packages/plugins/plugin-theme-default/src/components/background/DefaultBackground.vue`（红线组件）。

## 功能说明

## 活演示

`BaseNode` 是 VueFlow 渲染每个节点时套上的壳，**离开画布宿主渲染不出来** —— 所以下面嵌一块真画布（装了默认主题 + 示例节点），你在真环境里看它：

<script setup>
import MiniCanvasStage from '../../.vitepress/theme/demos/MiniCanvasStage.vue'
</script>

<MiniCanvasStage :height="360" />

> 画布里那层跟着平移缩放走的点状网格就是它（背后是 canvas 绘制，不是几千个 SVG 圆点）。

- 用 `<canvas>` 直接绘制，取代"生成几千个 SVG 圆点再 v-for 渲染"的老做法，
  节点多时不再卡。
- 画布位图尺寸 = 宿主可视区 × 设备像素比（DPR），所以高分屏不发虚。
- 视口（`x` / `y` / `zoom`）变化时**重绘一帧**，圆点与内容坐标严格对齐。
- 缩小画布时按"屏幕间距下限"抬升采样步长，避免点挤成一团。

## Props

**没有 props。** 它从渲染上下文取视口：`useCanvasRender().flow.viewport`。

## Slots / 插槽

**没有插槽。**

## 事件、方法或暴露能力

**不 emit、不 defineExpose。** 内部自己管三件事：

| 机制 | 作用 |
| --- | --- |
| `ResizeObserver` | 宿主可视区变化 → 重建 canvas 位图 |
| `watch(viewport)` | 视口变化 → 重绘一帧（非持续动画） |
| `onBeforeUnmount` | 卸载时断掉 observer，不留悬挂回调 |

## 使用方式与示例

它由主题槽装配，**你不直接用它**。要换背景就顶替这个槽。

```ts
// 文件：packages/my-plugin/src/myBackground.ts
// 格式：TypeScript 模块（插件入口）
// 位置：一个换皮插件 —— 把点状网格换成方格背景
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import GridBackground from './GridBackground.vue'

export const name = 'my-background'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  ctx.theme.add('background', GridBackground, { order: -1 })   // 顶替默认背景
}

export const myBackground: PluginModule = { name, inject, apply }
```

## 注意事项

1. **颜色是 canvas 绘制基色，不是主题色**：源码里写死了亮色值（`#cbd5e1` / `#f8fafc`），
   暗色主题由 `app.css` 的 `filter: invert(1)` 反相得到。
   **不要**改成暗色 token —— 那样反相后会变成近白，反而更糟。
2. **背景没有 VueFlow 注册口**，它是"低层 child 叠加组件"：宿主把它垫在节点/边之下渲染。
3. **重绘是事件驱动、不是持续动画**：不要在里面写 `requestAnimationFrame` 循环，
   会白烧 CPU。
