# 比例网格 ToolRatioGrid

**一句话**：参数预设件之一 —— 比例参数专用网格，每格画一个**按真实宽高比缩放的小描边矩形**，
一眼能看出 16:9 与 9:16 的区别。登记在 `ui` 目录名 `toolParamRatio`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/ToolRatioGrid.vue`。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="toolParamRatio" />

> 每格是按**真实宽高比**画的小矩形；`自适应` 解析不出比例，所以画虚线方框。

- **几何即信息**：每格是「17×17 图标位 + 12px 文案」，图标位里画 ≤12×12、按真实比例缩放的描边矩形（1.5px 边、圆角 2）。
- **认不出的比例画虚线方块**：`auto`、空值这类解析不出来的值用**虚线**方框，与"真比例"区分开。
- **短边有下限**：极端比例（21:9）短边也不小于 4px，不会塌成一条线。
- **配色不用主题色**（用户口径 2026-10-12）：只用灰阶 —— 未选透明底加发丝边，选中浅灰底加粗体加无边框。
  宽高比是**几何**，不是配色。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `param` | `ToolParamDef` | 必填 | 参数声明 |
| `modelValue` | `string / number / boolean` | `''` | 当前值（与选项值做字符串比较判断选中） |
| `disabled` | `boolean` | `false` | 禁用全部格子 |
| `columns` | `number` | `5` | 每行几格（参考站是 5） |

## Slots / 插槽

**没有插槽。**

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string / number / boolean` | 选了某一格 |

没有 `defineExpose`。

## 使用方式与示例

通常**不直接用它** —— 声明 `kind: 'ratio'` 后由 [ToolParamField](/plugins/theme-components/tool-param-field) 自动选用：

```vue
<!-- 文件：packages/my-plugin/src/RatioPicker.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：直接用预设件渲染一个比例参数 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'

const ToolRatioGrid = useUiComponent('toolParamRatio')

const ratio = ref('16:9')
const param: ToolParamDef = {
  key: 'ratio', label: '比例', kind: 'ratio', type: 'select', default: '16:9',
  options: [
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
    { label: '1:1', value: '1:1' },
    { label: '自适应', value: 'auto' },   // 解析不出比例 → 画虚线方框
  ],
}
</script>

<template>
  <ToolRatioGrid v-model="ratio" :param="param" :columns="5" />
</template>
```

## 注意事项

1. **值必须能被解析成 `a:b`**（`'16:9'` 这种）。其他形态一律画虚线方块 ——
   不是 bug，是"这个选项没有确定比例"的可见表达。
2. **5 列是照参考站实测的**：比例按钮比普通按钮矮而窄，5 列在底栏宽度下放得下。
3. **它不自造颜色**：主题色在这里是**故意不用**的（几何图形用灰阶更干净，
   与右键菜单「只用灰阶 + 黑白」同一口径）。
