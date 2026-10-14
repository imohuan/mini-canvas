# 气泡提示 Tooltip

**一句话**：鼠标悬停或键盘聚焦时浮出的小气泡提示。登记在 `ui` 目录名 `tooltip`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/Tooltip.vue`。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="tooltip" />

> 悬停或键盘聚焦（Tab 到按钮）都会出现气泡。

- **悬停与聚焦都触发**（`mouseenter` / `focusin`），所以键盘用户也看得到。
- **延迟出现**：默认 120ms —— 太灵敏会让鼠标扫过时到处闪。
- **四向定位加自动收边**：气泡不让贴边，箭头也不会顶出屏幕。
- **窗口滚动与尺寸变化自动重定位**（订了 `resize` 与捕获阶段的 `scroll`）。
- **可用 `#content` 插槽放富内容**（不止一行文字）。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `content` | `string?` | `''` | 提示文字；用 `#content` 插槽时可省略 |
| `placement` | `top / bottom / left / right` | `'top'` | 气泡贴着触发器哪一侧 |
| `offset` | `number` | `8` | 与触发器之间的间距（px） |
| `arrow` | `boolean` | `true` | 是否画指向触发器的小三角 |
| `delay` | `number` | `120` | 悬停多久才出现（ms） |
| `disabled` | `boolean` | `false` | 关掉气泡（条件性不提示时用它） |

## Slots / 插槽

| 插槽 | 说明 |
| --- | --- |
| 默认插槽 | **触发器**（被包在一个 `span class="tlt-trigger"` 里） |
| `content` | 气泡内容；给了就优先于 `content` 属性（可放图标与多行） |

## 事件、方法或暴露能力

**不 emit、不 defineExpose。** 显隐完全由它自己根据悬停与聚焦决定。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyToolbar.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：窄版工具栏 —— 只有图标、需要气泡补上文字说明 -->
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'

const Tooltip = useUiComponent('tooltip')
</script>

<template>
  <!-- 1 简单：一行文字 -->
  <Tooltip content="下载">
    <button type="button" aria-label="下载">下载</button>
  </Tooltip>

  <!-- 2 富内容：两行说明 -->
  <Tooltip placement="right">
    <button type="button" aria-label="帮助">?</button>
    <template #content>
      <strong>快捷键说明</strong>
      <div>选中节点后按 Delete 删除</div>
    </template>
  </Tooltip>

  <!-- 3 条件性不提示 -->
  <Tooltip content="已禁用" :disabled="enabled">
    <button type="button" :disabled="!enabled">动作</button>
  </Tooltip>
</template>
```

## 注意事项

1. **触发区是额外包的 span**：默认插槽里的元素是它的**子元素**，不是兄弟；布局受影响时要自己调样式。
2. **它是纯视觉提示，不是无障碍名称**：读屏软件念的是元素的 `aria-label` 与文案。只给 `Tooltip` 不给 `aria-label`，读屏用户仍然不知道那个图标钮是干什么的。
3. **`disabled` 是"不显示"而不是"删掉"**：切换它不会重挂触发器，状态保留。
4. **窄版才挂气泡是常见用法**：宽版本来就有文字文案，再挂气泡是重复信息。
