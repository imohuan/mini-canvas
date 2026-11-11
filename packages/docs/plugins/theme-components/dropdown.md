# 下拉菜单 DropdownMenu

**一句话**：点一个按钮弹出一组可点的菜单项，也可以继续开二级菜单或自定义面板。
项目统一使用 shadcn-vue 的 DropdownMenu 分离件。

```ts
import { useUiComponent } from '@plume-canvas/canvas-render'

const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuSub = useUiComponent('DropdownMenuSub')
const DropdownMenuSubContent = useUiComponent('DropdownMenuSubContent')
const DropdownMenuSubTrigger = useUiComponent('DropdownMenuSubTrigger')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
```

源码在 `packages/ui-kit-shadcn/src/components/ui/dropdown-menu/`。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="dropdown" />

- **分离件**：触发器、内容层、每一行、二级菜单都各写各的，想加图标、说明、快捷方式直接写。
- **定位与翻边**由 reka-ui 负责：点外面关闭、Esc 关闭、键盘导航、出屏翻转都已内置。
- **二级菜单**：`DropdownMenuSub` + `DropdownMenuSubTrigger` + `DropdownMenuSubContent`。
- **自定义面板**：`DropdownMenuContent` / `DropdownMenuSubContent` 里可以直接放任意 DOM；
  工具栏那类「按钮 + 二级自定义面板」见下方示例。

## Props

| 组件 | 字段 | 说明 |
| --- | --- | --- |
| `DropdownMenu` | `open` | 受控开合（配 `v-model:open`） |
| `DropdownMenuTrigger` | `as-child` | 让子元素成为触发器 |
| `DropdownMenuContent` | `side` / `align` / `sideOffset` | 浮层方向、对齐与间距 |
| `DropdownMenuItem` | `disabled` / `variant` | 禁用与 `destructive` 红色态 |

## Slots / 插槽

| 组件 | 插槽 | 说明 |
| --- | --- | --- |
| `DropdownMenuTrigger` | 默认 | 触发器 |
| `DropdownMenuContent` | 默认 | 菜单内容或自定义面板 |
| `DropdownMenuItem` | 默认 | 这一行的内容 |

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:open` | `boolean` | 开关变化（配 `v-model:open`） |
| `DropdownMenuItem` 的 `select` | `Event` | 选中一行 |

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyMenu.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@plume-canvas/canvas-render'

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')

const open = ref(false)
const items = ['重命名', '复制', '删除']

function pick(label: string): void {
  // ... 你的业务
  open.value = false
}
</script>

<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button variant="outline">更多 {{ open ? '▲' : '▼' }}</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuItem v-for="it in items" :key="it" @select="pick(it)">{{ it }}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
```

## 注意事项

1. **按导出名取件**：`useUiComponent('DropdownMenu')`，不要用旧的 `dropdown` 小写名。
2. **二级菜单用 Sub 系列**：不必自己画浮层或处理悬停展开。
3. **内容层的内边距归 `DropdownMenuContent`**：需要贴边面板时在内容层写 `p-0`，
   不要再靠负 margin 抵消旧实现的 6px。
