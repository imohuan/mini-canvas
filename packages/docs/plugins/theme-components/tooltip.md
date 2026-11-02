# 气泡提示 Tooltip

**一句话**：鼠标悬停或键盘聚焦时浮出的小气泡。项目统一使用 shadcn-vue 的
`Tooltip / TooltipTrigger / TooltipContent` 分离件。

```ts
import { useUiComponent } from '@mini-canvas/canvas-render'

const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')
```

源码在 `packages/ui-kit-shadcn/src/components/ui/tooltip/`。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="tooltip" />

- **悬停与键盘聚焦都触发**，键盘用户也能看到提示。
- **四向定位**：`side` 取 `top / bottom / left / right`，`sideOffset` 控制间距。
- **富内容**：`TooltipContent` 的默认插槽可以放多行文字、图标或任意小布局。
- **同组只显示一个**：外层 `TooltipProvider` 统一管理延迟与互斥。

## Props

| 组件 | 字段 | 说明 |
| --- | --- | --- |
| `Tooltip` | `defaultOpen` / `delayDuration` | 默认开合与延迟 |
| `TooltipTrigger` | `as-child` | 让子元素成为触发器（常用） |
| `TooltipContent` | `side` / `sideOffset` / `align` | 气泡方向、间距与对齐 |

## Slots / 插槽

| 组件 | 插槽 | 说明 |
| --- | --- | --- |
| `TooltipTrigger` | 默认 | 触发器；常配 `as-child` 包一个按钮 |
| `TooltipContent` | 默认 | 气泡内容 |

## 事件、方法或暴露能力

**不 emit、不 defineExpose。** 显隐与定位由 reka-ui 负责。

## 使用方式与示例

```vue
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'

const Button = useUiComponent('Button')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-sm" aria-label="下载">↓</Button>
      </TooltipTrigger>
      <TooltipContent side="top">下载</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
```

## 注意事项

1. **触发器只包一个元素**：`as-child` 要求子节点是单个组件或元素，
   多段并列内容请先包一层容器。
2. **`TooltipProvider` 只在外层写一次**：同一块 UI 里的多个 Tooltip 共用一个 Provider 即可。
3. **不再有 `content` 属性与 `#content` 插槽**：旧主题 Tooltip 的写法已移除，
   改成 `TooltipContent` 的默认插槽。

