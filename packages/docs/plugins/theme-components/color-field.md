# 取色器 ColorField

**一句话**：颜色控件 —— 一个色块按钮，点开是色板与透明度调节；值就是 hex 字符串。
登记在 `ui` 目录名 `color`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/ColorField.vue`。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="color" />

> 点色块打开调色板；`clearable` 时可以把颜色清空（写空串 = 回落主题色）。

- **值形态是 hex 字符串**：不透明时保留 6 位（如 `#3b82f6`），用户真的调了透明才写 8 位（含 alpha）。
  —— 这样旧存档与旧消费方仍看到原来的值形态。
- **可选清空**（`clearable`）：清空写**空串**，消费方回落主题色（这是"让用户能撤销自定义色"的通道）。
- **入参宽松**：大写、缩写（3 位）、8 位都收，内部先规整成确定形态再渲染。
- **无障碍**：`ariaLabel` 缺省 `'选择颜色'`；`inputId` 可关联 `label`。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `string?` | `'#000000'` | 当前颜色（hex；调用方总会传真实值） |
| `disabled` | `boolean` | `false` | 禁用 |
| `ariaLabel` | `string` | `'选择颜色'` | 无障碍名称 |
| `inputId` | `string` | `''` | 关联 `label for` 用 |
| `clearable` | `boolean` | `false` | 允许清空（清空后回落主题色） |

## Slots / 插槽

**没有插槽。**

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string` | 颜色变化（配 `v-model`）；清空时是空串 |
| `change` | `string` | 颜色变化（非 v-model 用法的监听口） |

没有 `defineExpose`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyColorSetting.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：插件设置面板里的一个颜色项 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const ColorField = useUiComponent('color')

// 空串 = 用户没自定义，交给消费方回落主题色
const color = ref('')
</script>

<template>
  <ColorField v-model="color" clearable aria-label="描边颜色" />
</template>
```

消费侧对空串的处理（这是"可清空"的意义）：

```ts
// 文件：packages/my-plugin/src/renderColor.ts
// 格式：TypeScript 模块
// 位置：读配置颜色的地方 —— 空串回落主题色
const custom = ctx.get('settings').get('myBorderColor')
const stroke = typeof custom === 'string' && custom.trim() ? custom : useThemeColor('edgeRailColor').value
```

## 注意事项

1. **空串有明确语义**：代表"用户删掉了自定义色"，**不是**"颜色是黑"。消费方必须回落主题色，否则清空看起来没效果。
2. **值可能带透明通道**：只有用户真调了透明度才是 8 位，别假设长度固定。
3. **别把它当取色面板用**：它只输出一个颜色值，不负责"应用到哪"。
