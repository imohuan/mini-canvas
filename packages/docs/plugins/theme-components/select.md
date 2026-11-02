# 下拉选择器 Select

**一句话**：从一组选项里选一个值。项目统一使用 shadcn-vue 的 Select 分离件，
触发器、内容层、选项各写各的，想加图标、分组或自定义行都直接改模板。

```ts
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mini-canvas/ui-kit-shadcn'
```

源码在 `packages/ui-kit-shadcn/src/components/ui/select/`。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="select" />

- **分离件**：`SelectTrigger` 只放触发区，`SelectContent` 放浮层，`SelectItem` 放每一行。
- **键盘与无障碍**由 reka-ui 负责：上下键移动、Enter 选中、Esc 关闭。
- **当前值**：`SelectValue` 显示选项文字；首屏拿不到选项时可以像主题包一样
  直接用 `{{ label }}` 渲染已选中的文案。
- **尺寸**：触发器可传 `size="sm"` 或 `size="default"`，全站统一尺寸由默认主题的
  外观配置控制。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| 组件 | 字段 | 说明 |
| --- | --- | --- |
| `Select` | `modelValue` | 当前值（配 `v-model`） |
| `Select` | `disabled` | 整体禁用 |
| `SelectTrigger` | `size` | `sm` / `default` |
| `SelectContent` | `position` | `item-aligned` / `popper` |
| `SelectItem` | `value` / `disabled` | 选项值与禁用态 |

## Slots / 插槽

| 组件 | 插槽 | 说明 |
| --- | --- | --- |
| `SelectTrigger` | 默认 | 触发区内容，通常放 `SelectValue` |
| `SelectContent` | 默认 | 选项列表 |
| `SelectItem` | 默认 | 这一行的文字或图标 + 文字 |

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string / number` | 值变化（配 `v-model`） |

没有 `defineExpose`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/ModelPicker.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mini-canvas/ui-kit-shadcn'

const model = ref('fast')

const options = [
  { label: '快速', value: 'fast' },
  { label: '精细', value: 'fine' },
  { label: '实验', value: 'beta' },
]
</script>

<template>
  <Select v-model="model">
    <SelectTrigger size="sm" aria-label="选择模型">
      <SelectValue placeholder="选择模型" />
    </SelectTrigger>
    <SelectContent position="popper" :side-offset="4">
      <SelectItem v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
    </SelectContent>
  </Select>
</template>
```

## 注意事项

1. **别再按 `useUiComponent('select')` 取**：主题包不再登记旧 Select，业务插件直接
   `import ... from '@mini-canvas/ui-kit-shadcn'`。
2. **首屏文案**：reka-ui 的 `SelectValue` 在浮层首次挂载前可能拿不到选项文字；
   需要稳定显示时用当前值自己算 label，或直接写进默认插槽。
3. **需要搜索、图标、描述或分组**时，直接把那些 DOM 放进 `SelectItem` 或自定义
   `SelectContent`，不需要另造一套选择器。
