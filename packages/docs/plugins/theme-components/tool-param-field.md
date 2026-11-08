# 参数控件 ToolParamField

**一句话**：**一个工具参数的渲染入口** —— 工具作者只声明"这个参数是什么"，
它负责按 `type` 画出对应的基础控件。登记在 `ui` 目录名 `toolParamField`。

源码：`packages/plugins/plugin-theme-components/src/components/ui/ToolParamField.vue`。
判定表在 `components/ui/paramKind.ts`（纯函数，可单测）。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="toolParamField" />

> 这里声明的是 `type: 'grid'` —— 按钮网格，点一下就切换。

## 判定顺序（固定）

1. **作者自带 `component`** → 交给他（逃生口，永远最优先）。
2. **`kind: 'ratio'`** → [比例网格](/plugins/theme-components/tool-ratio-grid)
   （每格按真实宽高比画小矩形，基础控件表达不了）。
3. **其余按 `type`** 画基础控件：

| type | 需要什么 | 画成什么 |
| --- | --- | --- |
| `select` | `options` | 下拉，永远下拉 |
| `grid` | `options`、可选 `columns` | 按钮网格 |
| `number` | `options` | 按钮网格 |
| `number` | `min` / `max`（可加 `step` / `unit`） | [参数滑块](/plugins/theme-components/tool-param-slider) |
| `number` | 都不给 | 数字输入框 |
| `string` | 可给 `placeholder` | 文本输入框 |
| `boolean` | 无 | 开关 |

> **`kind` 只剩 `ratio`。** 原先的 `quality` / `resolution` / `count` / `duration` /
> `speed` / `model` / `speaker` / `format` 等 11 个语义 kind 已删除 —— 它们画出来的东西
> 和基础控件完全一样，留着等于同一个 UI 有两个入口。写这些旧名字不会报错，只是不起作用。

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
| `type` | `select / grid / number / string / boolean` | **基础控件类型**（主体） |
| `kind` | `'ratio' \| string` | **专属 UI**，只认 `ratio` |
| `options` | `ToolParamOption[]?` | `select` / `grid` 的候选值；`number` 带它也会变成网格 |
| `columns` | `number?` | 按钮类控件一行几格（`grid` / `number`+options / `kind:ratio`） |
| `unit` | `string?` | 数值单位（如 `'秒'`），滑块显示在数值一侧 |
| `default` | `string / number / boolean?` | 缺省值 |
| `min` / `max` / `step` | `number?` | 数值范围与步长（有范围才画滑块） |
| `placeholder` | `string?` | `string` 与无范围 `number` 的输入提示 |
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
  { key: 'quality', label: '清晰度', type: 'grid', default: 'standard',
    options: [{ label: '标准', value: 'standard' }, { label: '高清', value: 'hd' }] },
  { key: 'count', label: '生成数量', type: 'number', default: 1, min: 1, max: 4 },
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

1. **`param.component` 优先级最高**：给了它就不再走 `kind` / `type`。
2. **按钮网格用 `type: 'grid'`**，不要写 `kind: 'quality'` 这类旧名字 —— 那些 kind 已删除，
   写了会按 `type` 画（没写 `type` 就是文本输入框）。
3. **`columns` 只对按钮类控件有意义**：`type: 'grid'`、`type: 'number'` 带 `options`、
   `kind: 'ratio'`。省略时按选项数排一行（最多 6 列）。
4. **`select` 永远是下拉**，不会因为选项少而变成按钮；想要按钮就显式写 `type: 'grid'`。
5. **在参数合并下拉（ToolParamGroup）里，若只有这一个参数且它是普通下拉**，
   它会**被直接铺到外面**（不再套面板）—— 相关判定见 `resolveInlineSoleSelect`。
6. **`idPrefix` 要传**：同一面板里有多份参数时，label 的 `for` 与输入框 id 会撞车。
7. **想加新的专属 UI**：改 `paramKind.ts` 的 `resolvePresetKind`（有单测守着），
   并在主题包按名登记组件，不要在组件里散条件分支。
