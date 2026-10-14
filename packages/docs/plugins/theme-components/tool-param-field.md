# 参数控件 ToolParamField

**一句话**：**一个工具参数的渲染入口** —— 工具作者只声明"这个参数是什么"，
它负责挑出该用哪个控件（预设件或内置控件）。登记在 `ui` 目录名 `toolParamField`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/ToolParamField.vue`。
判定表在 `components/ui/paramKind.ts`（纯函数，可单测）。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="toolParamField" />

> 这里声明的是 `kind: 'quality'` —— 它自动换成了选项网格（预设件判定见本页说明）。

三条优先级（判定顺序固定）：

1. **作者自带 `component`** → 交给他（逃生口，永远最优先）。
2. **声明了 `kind` 且判定表认得** → 换成对应预设件：
   - `ratio` → [比例网格](/plugins/theme-components/tool-ratio-grid)
   - `quality` / `resolution` / `background` / `count` / `camera` → [选项网格](/plugins/theme-components/tool-option-grid)
   - `duration`（≤3 档）→ 选项网格；`duration`（连续或更多档）→ [参数滑块](/plugins/theme-components/tool-param-slider)
   - `speed` → 参数滑块
   - `model` / `style` / `speaker` / `format` → **明确回落**下拉（选项多、名字长）
3. **其余**（没声明 / 认不得）→ 回落内置 `type` 控件（`select` / `string` / `number` / `boolean`）。

> 认不得的 `kind` **不猜、也不炸**，安静回落内置控件。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `param` | `ToolParamDef` | 必填 | 参数的完整声明 |
| `modelValue` | `string / number / boolean` | `''` | 当前值 |
| `disabled` | `boolean` | `false` | 禁用 |
| `idPrefix` | `string` | `'tp'` | id 前缀（同一面板里多份参数时保证 label/for 唯一） |

`ToolParamDef`（定义在 `packages/kernel/src/toolRegistry.ts`）的关键字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 参数键（必填） |
| `label` | `string?` | 面板上显示的标签 |
| `description` | `string?` | 一句话说明（tooltip 或辅助文字） |
| `kind` | `ToolParamKind \| string` | **语义类型** —— UI 据此挑预设件 |
| `type` | `select / string / number / boolean` | 内置控件类型（没给 `component` 时按它渲染） |
| `unit` | `string?` | number 类的显示单位（如 `'秒'`） |
| `options` | `ToolParamOption[]?` | `select` 的候选值 |
| `default` | `string / number / boolean?` | 缺省值 |
| `min` / `max` / `step` | `number?` | number 类的范围与步长 |
| `placeholder` | `string?` | string 类输入提示 |
| `component` | `unknown?` | 作者自带组件（最高优先级逃生口） |

## Slots / 插槽

**没有插槽。** 换控件靠 `param.kind` 与 `param.component`，不靠插槽。

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string / number / boolean` | 值变化 |

没有 `defineExpose`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyParamPanel.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：渲染一个工具声明的参数列表 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'

const ToolParamField = useUiComponent('toolParamField')

// 工具作者只声明"是什么"：比例、清晰度、时长、张数、提示词
const params: ToolParamDef[] = [
  { key: 'ratio', label: '比例', kind: 'ratio', type: 'select', default: '16:9',
    options: [{ label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }, { label: '1:1', value: '1:1' }] },
  { key: 'quality', label: '清晰度', kind: 'quality', type: 'select', default: 'standard',
    options: [{ label: '标准', value: 'standard' }, { label: '高清', value: 'hd' }] },
  { key: 'count', label: '生成数量', kind: 'count', type: 'number', default: 1, min: 1, max: 4 },
  { key: 'prompt', label: '提示词', type: 'string', placeholder: '描述你想要的画面' },
]

const values = ref<Record<string, unknown>>({ ratio: '16:9', quality: 'standard', count: 1 })
</script>

<template>
  <ToolParamField
    v-for="p in params"
    :key="p.key"
    :param="p"
    :model-value="values[p.key]"
    @update:model-value="(v) => (values[p.key] = v)"
  />
</template>
```

## 注意事项

1. **`param.component` 优先级最高**：给了它就完全不认 `kind` ——
   想回落预设件就得把 `component` 去掉。
2. **`kind` 是"语义"不是"控件名"**：写 `kind: 'grid'` 不会生效（认不得的 kind 一律回落内置控件）。
3. **`idPrefix` 要传**：同一面板里有多份参数时，label 的 `for` 与输入框 id 会撞车。
4. **想加新的 kind 判定**：改 `paramKind.ts` 那张判定表（有单测守着），不要在组件里散条件分支。
