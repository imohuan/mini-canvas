# 精细滑块 PrecisionSlider

**一句话**：数值滑块，带"精细调节" —— 拖动时按住 Ctrl 变细（×0.1）、按住 Shift 变粗（×10）。
登记在 `ui` 目录名 `slider`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/PrecisionSlider.vue`。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="slider" />

> 拖动滑块：按住 Ctrl 变细、Shift 变粗；`change` 事件只在松手时发。

- **两段式事件**：拖动过程只发 `update:modelValue`，**松手才发 `change`** —— 后者是"真正写 store / 进撤销栈"的唯一通道。
- **修饰键调速**：Ctrl 乘 `ctrlMultiplier`（缺省 0.1，细）、Shift 乘 `shiftMultiplier`（缺省 10，粗）。
- **步长吸附带浮点修正**：按 `step` 的小数位规整，避开 `0.1 + 0.2` 那类尾巴。
- **值域夹紧**：自动夹在 `[min, max]`。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `number` | 必填 | 当前值 |
| `min` | `number` | 必填 | 下限 |
| `max` | `number` | 必填 | 上限 |
| `step` | `number` | `1` | 步长（小数位决定显示精度） |
| `ctrlMultiplier` | `number` | `0.1` | 按住 Ctrl 时的步长乘子（细调） |
| `shiftMultiplier` | `number` | `10` | 按住 Shift 时的步长乘子（粗调） |
| `disabled` | `boolean` | `false` | 禁用 |
| `ariaLabel` | `string` | `''` | 无障碍名称 |

## Slots / 插槽

**没有插槽。**

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `number` | 拖动中持续发（只更新画面） |
| `change` | `number` | **松手一次才发**：真正落盘/进历史的时机 |

没有 `defineExpose`。

## 使用方式与示例

```ts
// 文件：packages/my-plugin/src/components/MySizePanel.vue
// 格式：Vue 单文件组件（script setup lang="ts"）
// 位置：插件面板里的一个尺寸调节 —— 拖动只改本地，松手才写数据
```
```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent, useCanvasRender } from '@mini-canvas/canvas-render'

const PrecisionSlider = useUiComponent('slider')
const { ctx } = useCanvasRender()

const width = ref(320)

// 松手才写回：这里写 store（会进撤销栈），拖动过程只动本地的 width
function commit(v: number): void {
  ctx.doc.updateNode('some-node-id', { data: { cardWidth: v } })
}
</script>

<template>
  <PrecisionSlider v-model="width" :min="80" :max="2000" :step="10" aria-label="宽度" @change="commit" />
</template>
```

## 注意事项

1. **别在 `update:modelValue` 里写 store**：拖动中每帧都发，会灌爆历史栈。写数据只挂 `change`。
2. **修饰键是"按下时生效"**：拖动中途按 Ctrl/Shift 也立刻切档。
3. **`v-model` 与 `change` 要一起用**：前者驱动画面，后者提交；只接一个会有"拖完不生效"或"每帧都提交"的问题。
