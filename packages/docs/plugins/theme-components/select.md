# 下拉选择器 Select

**一句话**：带搜索、带键盘导航的下拉选择器 —— 「选一个值」的标准控件。登记在 `ui` 目录名 `select`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/Select.vue`。选项里的图标、描述、分组（分隔线）由 `SelectOption` 声明。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="select" />

> 试着点开搜索：输入"精细"会过滤选项；分组名变化处会画分隔线。

- **可选搜索**（`searchable`）：输入即过滤标签。
- **完整键盘导航**：`上键` / `下键` 移动、`Enter` 选中、`Esc` 关闭。
- **选项增强**：`icon`（28×28 图标托）、`description`（悬停或聚焦时从名称下方浮现）、`group`（相邻选项分组名不同就插分隔线）、`disabled`。
- **浮层宽度三档**：`'match'`（与触发框同宽，另受 `dropdownMinWidth` 下限约束）/ `'auto'`（内容自适应）/ 其它字符串（直接当 CSS 宽度）。
- **无障碍**：`role="listbox"` 加 `aria-selected` 加 `aria-expanded`。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `string / number` | `''` | 当前值（配 `v-model`） |
| `options` | `SelectOption[]` | `[]` | 候选列表 |
| `searchable` | `boolean` | `false` | 可否搜索 |
| `placeholder` | `string` | `'请选择'` | 未选时显示 |
| `searchPlaceholder` | `string` | `'搜索...'` | 搜索框占位 |
| `placement` | `string` | `'bottom-start'` | 浮层位置 |
| `dropdownWidth` | `string` | `'auto'` | `'match'` / `'auto'` / CSS 宽度 |
| `dropdownMaxWidth` | `string` | `'320px'` | 浮层最大宽 |
| `dropdownMinWidth` | `string` | `'200px'` | 浮层最小宽（**只在 `'match'` 时生效**；防止窄触发器把浮层挤成一条缝） |
| `dropdownMaxHeight` | `string` | `'320px'` | 浮层最大高；超出在浮层内滚动（还会与视口可用高度取小） |
| `inputId` | `string` | `''` | 给设置表单里的 `label for` 关联用 |

选项 `SelectOption` 形状（定义在 `packages/plugins/plugin-theme-default/src/components/ui/types.ts`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `label` | `string` | 显示名（必填） |
| `value` | `string / number` | 值（必填） |
| `disabled` | `boolean?` | 不可选 |
| `description` | `string?` | 一句话说明（悬停或聚焦时浮现） |
| `icon` | `unknown?` | 图标句柄（SVG 字符串或 Vue 组件）；有图标即变"图标加名称（加描述）"两段式 |
| `group` | `string?` | 分组名；相邻选项分组名不同就插一条分隔线。**都不给就一条线都不画** |

## Slots / 插槽

**没有插槽。** 选项内容全部由 `options` 数据驱动。

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string / number` | 值变化（配 `v-model`） |
| `change` | `string / number` | 值变化（非 v-model 用法的监听口） |

没有 `defineExpose`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/ModelPicker.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：插件面板里的模型选择 —— 用默认主题的下拉选择器 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const Select = useUiComponent('select')

const model = ref('fast')

// 选项可以带描述与分组（分组一变就画一条分隔线）
const options = [
  { label: '快速', value: 'fast', description: '便宜，适合草稿', group: '常用' },
  { label: '精细', value: 'fine', description: '慢一些，质量更好', group: '常用' },
  { label: '实验', value: 'beta', group: '实验' },
]
</script>

<template>
  <Select
    v-model="model"
    :options="options"
    searchable
    placeholder="选择模型"
    dropdown-width="match"
    dropdown-min-width="200px"
  />
</template>
```

## 注意事项

1. **`dropdownMinWidth` 只在 `dropdownWidth: 'match'` 时生效**：窄触发框（底栏那种约 100px）不设下限会把模型名全截断。
2. **`group` 只在相邻项分组名不同时画线**：整个列表都不给 `group`，就一条线都不画。
3. **搜索只匹配 `label`**（不匹配 `description` 与 `value`）。
4. **值可以是数字**：内部用严格相等比较，重开时按 `options` 找回 label；值不在列表里就原样字符串化显示。
5. **它是"选一个"，不是多选**：多选得自己叠。
6. **长名单有滚动**：缺省最大高 320px（`dropdownMaxHeight`），超出在浮层内滚 ——
   音色这种 20+ 项不会把面板一路撑到屏幕底（用户口径 2026-10-14：「为下拉框提供最大高度，支持滚动」）。
