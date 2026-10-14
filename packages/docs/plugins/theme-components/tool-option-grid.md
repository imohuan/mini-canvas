# 选项网格 ToolOptionGrid

**一句话**：参数预设件之一 —— 「一个小标题 + 一块按钮网格」（画质、清晰度、背景、生成数量那一排）。
登记在 `ui` 目录名 `toolParamGrid`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/ToolOptionGrid.vue`。
版式照参考站实测：区块标题高 20、12px/600 弱化色；网格 gap 8；按钮高 32、圆角 8、1px 发丝边、透明底；选中 = `--ui-hover-strong` 底。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="toolParamGrid" />

> 一参数一块：小标题 + 按钮网格，选中态跟着 `modelValue` 走。

- **一参数一块**：块内是小标题与按钮网格，选中态用 `aria-pressed` 表达。
- **列数可配**：默认 3 列（与参考站的画质/清晰度/背景/数量一致）。
- **可藏标题**：`hideTitle` 在"参数标签已在别处出现"时用。
- **与比例网格共用容器数值**：它抽出容器是为了让 [ToolRatioGrid](/plugins/theme-components/tool-ratio-grid)
  只覆写"每格画什么"，避免两份数值各写一遍后漂移。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `param` | `ToolParamDef` | 必填 | 参数声明（标题取 `param.label` 或 `param.key`） |
| `modelValue` | `string / number / boolean` | `''` | 当前值（与选项值做字符串比较判断选中） |
| `disabled` | `boolean` | `false` | 禁用全部按钮 |
| `columns` | `number` | `3` | 每行几格 |
| `hideTitle` | `boolean` | `false` | 不显示区块标题 |

## Slots / 插槽

**没有插槽。** 格子内容全部来自 `param.options`。

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string / number / boolean` | 选了某一格（配 `v-model`） |

没有 `defineExpose`。

## 使用方式与示例

通常**不直接用它** —— 声明参数 `kind` 后由 [ToolParamField](/plugins/theme-components/tool-param-field) 自动选用。
想单独用（比如面板里就想要一排按钮）：

```vue
<!-- 文件：packages/my-plugin/src/QualityPicker.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：直接用预设件渲染一个参数 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'

const ToolOptionGrid = useUiComponent('toolParamGrid')

const quality = ref('standard')
const param: ToolParamDef = {
  key: 'quality', label: '画质', kind: 'quality', type: 'select', default: 'standard',
  options: [{ label: '标准', value: 'standard' }, { label: '高清', value: 'hd' }, { label: '超清', value: 'uhd' }],
}
</script>

<template>
  <ToolOptionGrid v-model="quality" :param="param" :columns="3" />
</template>
```

## 注意事项

1. **选中判定是字符串比较**：`modelValue` 与 `option.value` 都会 `String()` 后再比，
   所以 `1` 与 `'1'` 视为同一格。
2. **它是表现件，不做业务**：选了哪格只是把值 emit 出去，存与用是调用方的事。
3. **选项过多时别用它**：超过一行太多（名字又长）的应该走 `Select` —— 判定表里的
   `model` / `style` / `speaker` / `format` 就是明确回落下拉的。
