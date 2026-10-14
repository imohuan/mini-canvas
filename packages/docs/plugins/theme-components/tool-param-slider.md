# 参数滑块 ToolParamSlider

**一句话**：参数预设件之一 —— 「小标题 + 当前值 + 单位 + 滑块」，用在"取值多、要拖"的参数上
（连续时长、语速这类）。登记在 `ui` 目录名 `toolParamSlider`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/ToolParamSlider.vue`。
内部复用 [PrecisionSlider](/plugins/theme-components/precision-slider)，只是把标题、值、单位排成一行。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="toolParamSlider" />

> 标题、当前值、单位排成一行，下面是滑块。

- **一行三段**：左标题、右"值加单位"、下方滑块。
- **取值范围回落**：`param.min` 缺省 0、`param.max` 缺省 100、`param.step` 缺省 1。
- **非法值回落下限**：`modelValue` 不是有限数字时按 `min` 显示。
- **配色不用主题色**（用户口径）：轨道灰，填充与圆球走主按钮那档深墨，黑白两套主题各有一格。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `param` | `ToolParamDef` | 必填 | 参数声明（标题取 `label` 或 `key`；单位取 `unit`） |
| `modelValue` | `string / number / boolean` | `''` | 当前值 |
| `disabled` | `boolean` | `false` | 禁用 |
| `hideTitle` | `boolean` | `false` | 不显示标题（值仍然显示） |

## Slots / 插槽

**没有插槽。**

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string / number / boolean` | 值变化 |

没有 `defineExpose`。

## 使用方式与示例

通常**不直接用它** —— 声明 `kind: 'duration'`（连续型）或 `kind: 'speed'`
后由 [ToolParamField](/plugins/theme-components/tool-param-field) 自动选用：

```vue
<!-- 文件：packages/my-plugin/src/DurationPicker.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：直接用预设件渲染一个时长参数 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'

const ToolParamSlider = useUiComponent('toolParamSlider')

const duration = ref(8)
const param: ToolParamDef = {
  key: 'duration', label: '时长', kind: 'duration', type: 'number',
  unit: '秒', min: 1, max: 20, step: 1, default: 8,
}
</script>

<template>
  <ToolParamSlider v-model="duration" :param="param" />
</template>
```

## 注意事项

1. **两档以内别用它**：像 5 秒 / 10 秒这种只有两档的时长，判定表会选
   [选项网格](/plugins/theme-components/tool-option-grid)（点一下比拖一下好）。这条分档在 `paramKind.ts` 里。
2. **`kind: 'duration'` 才走它**：只给 `type: 'number'` 不声明 `kind`，会回落内置数字控件。
3. **单位只是后缀文案**：组件不做单位换算。
