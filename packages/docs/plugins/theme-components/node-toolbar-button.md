# 按钮 NodeToolbarButton

**一句话**：节点上/下控制栏里的通用按钮 —— 32×32 图标钮、或带文案的文本钮、或两者组合。
登记在 `ui` 目录名 `button`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/NodeToolbarButton.vue`。
**插件放按钮不必再自绘一套 32×32 / 圆角 / hover / focus** —— 这是默认主题给全画布的公共件。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="button" />

> 上面这些按钮就是画布里节点控制栏用的那一份（同一份实现，样式由主题 token 决定）。

- 两种形态：**纯图标钮**（没给默认插槽）/ **带文案钮**（给了默认插槽）。
- 三种视觉语义：`ghost`（缺省，图标=灰底、带文案=文本按钮）/ `primary`（主按钮）/ `danger`（悬停转红）。
- **开关态**：传 `active` 就是开关（会报 `aria-pressed`）；**不传**就不当开关。
- **图标句柄 opaque**：SVG 字符串或 Vue 组件都收（与节点类型 `icon` 同一写法）。
- **无障碍**：`aria-label` 缺省回落 `title`；纯图标按钮必须给 `title`。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 按钮文案；纯图标时它就是无障碍名称 |
| `ariaLabel` | `string?` | `undefined` | 单独的读屏名称；缺省 = `title` |
| `icon` | `unknown?` | `undefined` | 图标句柄（SVG 字符串或 Vue 组件）；不传则只渲染文案 |
| `variant` | `ghost / primary / danger` | `'ghost'` | 视觉语义（danger = 悬停转红） |
| `disabled` | `boolean` | `false` | 禁用 |
| `active` | `boolean?` | `undefined` | 开关类按钮的当前状态；**不传**就不报 `aria-pressed` |

## Slots / 插槽

| 插槽 | 说明 |
| --- | --- |
| 默认插槽 | 有内容 = 带文案的按钮（文案区）；空 = 纯图标按钮（按钮自动加 `is-icon-only` 类） |

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `click` | `MouseEvent` | 点击。**由组件自己 emit**，不是把原生事件直接透传 |

没有 `defineExpose`。渲染出的根是一个 `button type="button"`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyToolbar.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：节点上/下控制栏里的一条控件 —— 用默认主题的按钮 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const NodeToolbarButton = useUiComponent('toolbarButton')

const starred = ref(false)
// 图标句柄：SVG 字符串（也可以是 Vue 组件）
const STAR_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l3 6 6 .9-4.5 4.3 1 6-5.5-3-5.5 3 1-6L3 9.9 9 9z"/></svg>'
</script>

<template>
  <!-- 1 纯图标 + 开关态 -->
  <NodeToolbarButton title="收藏" :icon="STAR_ICON" :active="starred" @click="starred = !starred" />

  <!-- 2 带文案的按钮 -->
  <NodeToolbarButton title="下载" variant="primary">下载</NodeToolbarButton>

  <!-- 3 危险动作 -->
  <NodeToolbarButton title="删除" variant="danger">删除</NodeToolbarButton>
</template>
```

## 注意事项

1. **纯图标按钮必须给 `title`**：它是 `aria-label` 的回落值，缺了读屏软件念不出来。
2. **`active` 传 `undefined` 不等于传 `false`**：前者不当开关（不报 `aria-pressed`），后者是"开关关着"。这个区别是刻意留的。
3. **点击事件是重新 emit 的**：想拿原生事件用参数 `ev`。
4. **它只是"长得对"**：按钮不帮你做任何业务（不禁用重复点击、不管权限）—— 那些是调用方的事。
