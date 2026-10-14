# 参数组 ToolParamGroup

**一句话**：把**多个参数收敛成一个下拉** —— 平时显示成一行点分摘要加一个箭头
（「16:9 · 标准画质 · 2K · 1张 ⌄」），点开才在浮层里逐项改。登记在 `ui` 目录名 `toolParamGroup`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/ToolParamGroup.vue`。
底栏一条参数一个下拉会把底行挤爆，所以有了这一件（版式参考 LibTV 的画布底行）。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="toolParamGroup" />

> 平时显示成一行摘要（16:9 · 标准 · 2 张），点开才在浮层里逐项改。

- **摘要行**：把有值的参数用 `·` 连起来显示；参数都没值时显示 `placeholder`。
- **浮层内逐项改**：浮层里对每个参数渲染一个 [ToolParamField](/plugins/theme-components/tool-param-field)
  （于是 `kind` 判定、预设件全自动生效）。
- **两种版式自动切**：
  - 参数里有"预设件类"的（`ratio` / `quality` …）→ **整块竖排版式**
    （标题加按钮网格/滑块，一列竖排，宽 288，块间 gap 8）；
  - 只有普通参数 → 旧的"标签加控件"一行式。
- **下拉容器走目录**：优先用 `ui.dropdown` 里登记的那一份（成品应用顶替了就用它），取不到回落本包自带。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `params` | `ToolParamDef[]` | `[]` | 要收进来的参数列表 |
| `values` | `Record<string, unknown>` | `{}` | 各参数的当前值（键 = `ToolParamDef.key`） |
| `disabled` | `boolean` | `false` | 禁用 |
| `placeholder` | `string` | `'默认参数'` | 参数都没值时的占位文案 |
| `idPrefix` | `string` | `'tpg'` | id 前缀（同面板多份时保证 label 与 for 唯一） |

## Slots / 插槽

**没有插槽。** 摘要行与浮层都是数据驱动。

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `change` | `(key: string, value: string / number / boolean)` | 浮层里改了某一项（**不是 v-model**，是"哪一项改成了什么"） |

没有 `defineExpose`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/GenerationBar.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：节点底栏的参数区 —— 把一排参数收敛成一个下拉 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'

const ToolParamGroup = useUiComponent('toolParamGroup')

const params: ToolParamDef[] = [
  { key: 'ratio', label: '比例', kind: 'ratio', type: 'select',
    options: [{ label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }] },
  { key: 'quality', label: '画质', kind: 'quality', type: 'select',
    options: [{ label: '标准', value: 'standard' }, { label: '高清', value: 'hd' }] },
]

const values = ref<Record<string, unknown>>({ ratio: '16:9', quality: 'standard' })

// change 给的是 (key, value)：按 key 更新那一项
function onChange(key: string, value: string | number | boolean): void {
  values.value = { ...values.value, [key]: value }
}
</script>

<template>
  <ToolParamGroup :params="params" :values="values" placeholder="默认参数" @change="onChange" />
</template>
```

## 注意事项

1. **`change` 的载荷是"键加值"**，不是单个值 —— 因为一个浮层里有好几项，必须知道改的是哪一项。
2. **版式由参数内容自动决定**：想让某参数走"整块竖排"，就让它有 `kind`（且被判定表认得）。
3. **它不存状态**：`values` 是受控的，改完你得自己回写，否则摘要行不会变。
4. **下拉实现可能不是主题包那份**：成品应用里会取到 `AxDropdown`；这是刻意的（全应用只剩一份下拉实现）。
